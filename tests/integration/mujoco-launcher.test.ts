// lab:mujoco boundary (U06): the pinned tool closure and .venv-mujoco against its lock, a data directory outside every tool root, then the runtime with only the
// MuJoCo arm on top of the mocks. Anything missing exits 1 with a code before a port is opened; nothing is installed and no other backend stands in.
import {freePort} from '../support/free-port';
import { afterEach, expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error CLI JavaScript boundary
import { checkMujocoHealth, checkMujocoMobileHealth, irsimOptions } from '../../scripts/start-irsim.mjs';

const lab = fileURLToPath(new URL('../../', import.meta.url)), launcher = join(lab, 'scripts/start-irsim.mjs');
const dirs: string[] = [];
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
const temp = async () => { const d = await mkdtemp(join(tmpdir(), 'mujoco-launcher-')); dirs.push(d); return d; };
const listening = (port: number) => new Promise<boolean>((ok) => { const s = createConnection({ port, host: '127.0.0.1' }); s.once('connect', () => { s.destroy(); ok(true); }); s.once('error', () => ok(false)); });
async function run(args: string[]) {
  const [ui,runtime]=await Promise.all([freePort(),freePort()]);
  const p = spawn(process.execPath, [launcher, '--provider', 'mujoco', '--ui-port', String(ui), '--runtime-port', String(runtime), ...args], { cwd: lab, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = ''; p.stdout.on('data', (c) => { out += c; }); p.stderr.on('data', (c) => { err += c; });
  const timer = setTimeout(() => p.kill('SIGKILL'), 90_000);
  const exit = await new Promise<number>((r) => p.once('exit', (c) => r(c ?? 1)));
  clearTimeout(timer);
  return { exit, out, err, ui, runtime };
}
const b = (id: string, on: boolean) => ({ id, modes: ['simulation'], accesses: ['simulated'], installed: on, compatible: on, reachable: on, enabled: on, commissioned: true });
const lock = { sourceCommit: 'c'.repeat(40), schemaHash: 'a'.repeat(64) };

test('checkMujocoHealth wants a live mujoco_arm and sim3d_arm_contact_v1, and the rest of the runtime exactly the mock backends', () => {
  const mock = ['mock_amr', 'mock_coffee', 'mock_arm'].map((id) => ({ ...b(id, true), modes: ['mock'] }));
  const health = { protocolMajors: [1, 2], sourceCommit: lock.sourceCommit, schemaHash: lock.schemaHash, capabilities: ['sim3d_arm_contact_v1'], backends: [...mock, b('irsim_2d', false), b('mujoco_arm', true)] };
  expect(() => checkMujocoHealth(health, lock)).not.toThrow();
  expect(() => checkMujocoHealth({ ...health, backends: [...mock, { ...b('mujoco_arm', false), reason: 'MUJOCO_DISABLED: x' }] }, lock)).toThrow(/MUJOCO_PROVIDER_UNAVAILABLE:MUJOCO_DISABLED/);
  expect(() => checkMujocoHealth({ ...health, backends: mock }, lock)).toThrow(/MUJOCO_PROVIDER_UNAVAILABLE:not offered/);
  expect(() => checkMujocoHealth({ ...health, capabilities: [] }, lock)).toThrow('CAPABILITY_MISSING:sim3d_arm_contact_v1');
  expect(() => checkMujocoHealth({ ...health, backends: [...mock, b('irsim_2d', true), b('mujoco_arm', true)] }, lock)).toThrow(/NON_MOCK_BACKEND_ENABLED:irsim_2d/);
  expect(() => checkMujocoHealth({ ...health, sourceCommit: 'd'.repeat(40) }, lock)).toThrow('RUNTIME_IDENTITY_MISMATCH');
});

test('--provider mujoco: .venv-mujoco of the source by default, --mujoco-python overrides it', () => {
  expect(irsimOptions(['--provider', 'mujoco', '--source', '/x/src'])).toMatchObject({ provider: 'mujoco', mujocoPython: '/x/src/.venv-mujoco/bin/python' });
  expect(irsimOptions(['--provider', 'mujoco', '--mujoco-python', '/x/py']).mujocoPython).toBe('/x/py');
});

test('without the MuJoCo Python the launcher exits MUJOCO_PYTHON_MISSING before any port is opened', async () => {
  const d = await temp();
  const r = await run(['--mujoco-python', join(d, 'none/python'), '--data-dir', join(d, 'runs')]);
  expect(r.exit, r.err).toBe(1); expect(r.err).toContain('MUJOCO_PYTHON_MISSING'); expect(r.out).not.toMatch(/Ready in/);
  expect(await listening(r.ui)).toBe(false); expect(await listening(r.runtime)).toBe(false);
}, 120_000);

test('a data directory inside a tool root is refused (the worker would write into the pinned closure) before any port is opened', async () => {
  // a missing Python too: if the check ever regressed, the launcher stops at the venv instead of starting a runtime that writes into the tool root
  const d = await temp();
  const r = await run(['--mujoco-python', join(d, 'none/python'), '--data-dir', resolve(lab, '../source/robotics/simulation-mujoco/runs-u06')]);
  expect(r.exit, r.err).toBe(1); expect(r.err).toContain('DATA_DIR_IN_TOOL_ROOT'); expect(r.out).not.toMatch(/Ready in/);
  expect(await listening(r.ui)).toBe(false); expect(await listening(r.runtime)).toBe(false);
}, 120_000);

test('a data directory that reaches a tool root through a symbolic link is refused too', async () => {
  const d = await temp(); const { symlink } = await import('node:fs/promises');
  await symlink(resolve(lab, '../source/robotics/simulation-mujoco'), join(d, 'link'));
  const r = await run(['--mujoco-python', join(d, 'none/python'), '--data-dir', join(d, 'link/runs-u06')]);
  expect(r.exit, r.err).toBe(1); expect(r.err).toContain('DATA_DIR_IN_TOOL_ROOT'); expect(r.out).not.toMatch(/Ready in/);
}, 120_000);

test('mobile opt-in adds exact engineering/mobile capability checks, arm-only remains separate',()=>{
 expect(irsimOptions(['--provider','mujoco','--mujoco-mobile']).mujocoMobile).toBe(true);expect(irsimOptions(['--provider','mujoco']).mujocoMobile).toBe(false);
 const health={protocolMajors:[1,2],...lock,capabilities:['engineering_bundle_v1','sim3d_payload_experiments_v1','sim3d_arm_contact_v1'],backends:[...['mock_amr','mock_coffee','mock_arm'].map(id=>({...b(id,true),modes:['mock']})),b('mujoco_arm',true),b('mujoco_3d',true)]};
 expect(()=>checkMujocoMobileHealth(health,lock)).not.toThrow();expect(()=>checkMujocoMobileHealth({...health,capabilities:['sim3d_arm_contact_v1']},lock)).toThrow('CAPABILITY_MISSING:engineering_bundle_v1');
});
