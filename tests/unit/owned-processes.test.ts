import { afterEach, expect, test, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as ownership from '../support/owned-processes';

const children: ChildProcess[] = [], dirs: string[] = [];
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
afterEach(async () => {
  vi.restoreAllMocks();
  for (const c of children.splice(0)) { if (c.pid) { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* already exited */ } c.kill('SIGKILL'); } }
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
async function temp() { const d = await mkdtemp(join(tmpdir(), 'owned-process-')); dirs.push(d); return d; }
async function sentinel(directory: string, descendants = false) {
  const code = descendants ? "const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(c.pid);setInterval(()=>{},1000)" : "console.log(process.pid);\nsetInterval(()=>{},1000)";
  const c = spawn(process.execPath, ['-e', code, '--', '--bundle-root', join(directory, 'bundle'), '--run-id', 'same-id'], { detached: true, stdio: ['ignore', 'pipe', 'inherit'] }); children.push(c);
  const [line] = await once(c.stdout!, 'data');
  return { child: c, descendant: Number(String(line).trim()) };
}

test('an owned fault kills only its exact run family; a sibling with the same run id and directory prefix survives', async () => {
  expect(ownership.OwnedProcesses).toBeTypeOf('function');
  const directory = join(await temp(), 'run with spaces'), unrelated = directory + '-other';
  const scope = new ownership.OwnedProcesses(); scope.addDirectory(directory);
  const own = await sentinel(directory), sibling = await sentinel(unrelated);
  const targets = scope.kill(directory, /--run-id same-id(?: |$)/);
  expect(targets.map(p => p.pid)).toEqual([own.child.pid]);
  await once(own.child, 'exit');
  expect(alive(sibling.child.pid!)).toBe(true);
  expect(scope.processes()).toEqual([]);
});

test('owned detached group retains reparented children after worker-only death and detects a cleanup leak', async () => {
  expect(ownership.OwnedProcesses).toBeTypeOf('function');
  const directory = await temp(), scope = new ownership.OwnedProcesses(); scope.addDirectory(directory);
  const own = await sentinel(directory, true), sibling = await sentinel(await temp());
  const before = scope.processes();
  expect(before.map(p => p.pid)).toEqual(expect.arrayContaining([own.child.pid, own.descendant]));
  scope.kill(directory, /--run-id same-id(?: |$)/);
  await once(own.child, 'exit');
  expect(scope.processes().map(p => p.pid)).toContain(own.descendant);
  expect(alive(sibling.child.pid!)).toBe(true);
  process.kill(own.descendant, 'SIGKILL');
  // macOS reaps promptly; Linux may retain a zombie under PID 1, which is not a live worker.
  for (let i = 0; i < 50 && scope.processes().length; i++) await new Promise(r => setTimeout(r, 20));
  expect(scope.processes()).toEqual([]);
});

test('matching bundle arguments outside the test ancestry never grant ownership', () => {
  const directory = '/tmp/owned-ancestry', scope = new ownership.OwnedProcesses(() => [
    { pid: 1001, ppid: 1, pgid: 1001, started: 'old', command: `python -m webots_worker --bundle-root ${directory}/bundle --run-id same` },
    { pid: 1002, ppid: process.pid, pgid: 1002, started: 'old', command: `python -m webots_worker --bundle-root ${directory}-other/bundle --run-id same` },
  ]);
  scope.addDirectory(directory);
  expect(scope.processes()).toEqual([]);
});

test('PPID traversal includes children in separate groups and retains them after reparenting', () => {
  const root = { pid: 1001, ppid: process.pid, pgid: 1001, started: 'old', command: 'python --bundle-root /tmp/owned-tree/bundle' };
  const controller = { pid: 1002, ppid: 1001, pgid: 1002, started: 'old', command: 'controller' };
  let rows = [root, controller];
  const scope = new ownership.OwnedProcesses(() => rows); scope.addDirectory('/tmp/owned-tree');
  expect(scope.processes().map(p => p.pid)).toEqual([1001, 1002]);
  rows = [{ ...controller, ppid: 1 }];
  expect(scope.processes().map(p => p.pid)).toEqual([1002]);
});

test('reused root PID/group and reused controller PID do not extend a stale family', () => {
  const root = { pid: 1001, ppid: process.pid, pgid: 1001, started: 'old', command: 'python --bundle-root /tmp/owned-reuse/bundle' };
  const controller = { pid: 1002, ppid: 1001, pgid: 1001, started: 'old', command: 'controller' };
  let rows = [root, controller];
  const scope = new ownership.OwnedProcesses(() => rows); scope.addDirectory('/tmp/owned-reuse');
  expect(scope.processes()).toHaveLength(2);
  rows = [{ ...root, ppid: 1, started: 'new', command: 'unrelated' }, { ...controller, ppid: 1, started: 'new' }];
  expect(scope.processes()).toEqual([]);
});

test('observing a whole operation retains children when the worker exits before the operation returns', async () => {
  const directory = await temp(), scope = new ownership.OwnedProcesses(); scope.addDirectory(directory);
  let descendant = 0;
  await scope.observe(async () => {
    const own = await sentinel(directory, true); descendant = own.descendant;
    await new Promise(r => setTimeout(r, 180));
    own.child.kill('SIGKILL'); await once(own.child, 'exit');
  });
  expect(scope.processes().map(p => p.pid)).toContain(descendant);
  process.kill(descendant, 'SIGKILL');
});


test('a newly seen orphan in a remembered group fails cleanup without granting signal authority', () => {
  const root = { pid: 1001, ppid: process.pid, pgid: 1001, started: 'old', command: 'python --bundle-root /tmp/owned-gap/bundle' };
  let rows: ownership.ProcessRow[] = [root];
  const scope = new ownership.OwnedProcesses(() => rows); scope.addDirectory('/tmp/owned-gap');
  expect(scope.processes().map(p => p.pid)).toEqual([1001]);
  rows = [{ pid: 1002, ppid: 1, pgid: 1001, started: 'later', command: 'controller' }];
  expect(() => scope.processes()).toThrow('OWNED_PROCESS_OBSERVATION_UNCERTAIN');
  const signal = vi.spyOn(process, 'kill').mockImplementation(() => true);
  expect(scope.kill('/tmp/owned-gap', /controller/)).toEqual([]);
  expect(signal).not.toHaveBeenCalled();
});

for (const priorRoot of [false, true]) test(`an operation with a whole unobserved worker lifetime fails cleanup (prior sampled root: ${priorRoot})`, async () => {
  const directory = await temp();
  const rows = priorRoot ? [{ pid: 1001, ppid: process.pid, pgid: 1001, started: 'old', command: `python --bundle-root ${directory}/old-bundle` }] : [];
  const scope = new ownership.OwnedProcesses(() => rows); scope.addDirectory(directory);
  await expect(scope.observe(async () => {
    const c = spawn(process.execPath, ['-e', '', '--', '--bundle-root', join(directory, 'short-bundle'), '--run-id', 'short'], { detached: true, stdio: 'ignore' }); children.push(c);
    await once(c, 'exit');
  })).rejects.toThrow('OWNED_PROCESS_OBSERVATION_UNCERTAIN');
  expect(() => scope.processes()).toThrow('OWNED_PROCESS_OBSERVATION_UNCERTAIN');
  const signal = vi.spyOn(process, 'kill').mockImplementation(() => true);
  expect(scope.kill(directory, /short-bundle/)).toEqual([]);
  expect(signal).not.toHaveBeenCalled();
});

test('a reused group and previously unseen members never gain signal authority', () => {
  const root = { pid: 1001, ppid: process.pid, pgid: 1001, started: 'old', command: 'python --bundle-root /tmp/owned-new-group/bundle' };
  let rows: ownership.ProcessRow[] = [root];
  const scope = new ownership.OwnedProcesses(() => rows); scope.addDirectory('/tmp/owned-new-group');
  expect(scope.processes()).toHaveLength(1);
  rows = [{ ...root, ppid: 1, started: 'new', command: 'unrelated' }, { pid: 1002, ppid: 1, pgid: 1001, started: 'new', command: 'controller' }];
  const signal = vi.spyOn(process, 'kill').mockImplementation(() => true);
  expect(scope.processes()).toEqual([]);
  expect(scope.kill('/tmp/owned-new-group', /unrelated|controller/)).toEqual([]);
  expect(signal).not.toHaveBeenCalled();
});


test('a sampled direct root cannot certify a worker created in another process', () => {
  const direct = { pid: 1001, ppid: process.pid, pgid: 1001, started: 'old', command: 'python --bundle-root /tmp/owned-external/direct' };
  const scope = new ownership.OwnedProcesses(() => [direct,
    { pid: 1002, ppid: process.pid, pgid: 1002, started: 'old', command: 'external worker creator' },
    { pid: 1003, ppid: 1002, pgid: 1003, started: 'old', command: 'python --bundle-root /tmp/owned-external/indirect' },
  ]); scope.addDirectory('/tmp/owned-external');
  expect(() => scope.processes()).toThrow('OWNED_PROCESS_OBSERVATION_UNCERTAIN');
});

test('a lifecycle callback observation error is latched without escaping the spawn callback', async () => {
  const directory = await temp(); let broken = true;
  const scope = new ownership.OwnedProcesses(() => { if (broken) throw new Error('table unavailable'); return []; }); scope.addDirectory(directory);
  await sentinel(directory);
  broken = false;
  expect(() => scope.processes()).toThrow('OWNED_PROCESS_OBSERVATION_UNCERTAIN');
});
