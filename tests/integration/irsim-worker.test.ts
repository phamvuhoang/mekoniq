// Real IR-SIM worker processes (the pinned venv); skipped with the reason where it is not provisioned.
import { afterEach, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createNavigationCompiler } from '../../packages/lab-runtime/src/engineering/navigation-compiler';
import { lockDigestOf } from '../../packages/lab-runtime/src/engineering/linkforge';
import { WorkerLostError, spawnIRSimWorker, type IRSimWorkerClient } from '../../packages/lab-runtime/src/v2/navigation2d/worker-client';
import type { IRSimRequestV1, IRSimSnapshotV1 } from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import { navigationFixture, type NavigationFixtureName } from '../support/navigation2d';

const irPython = resolve('.venv-irsim/bin/python'), workerRoot = resolve('robotics/navigation-2d'), schemaDir = resolve('packages/contracts/schemas');
const available = existsSync(irPython) && (() => { try { execFileSync(irPython, ['-c', 'import irsim, yaml, rfc8785, jsonschema, referencing'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const roots: string[] = [], clients: IRSimWorkerClient[] = [];
afterEach(async () => { for (const c of clients.splice(0)) await c.close('test over'); for (const d of roots.splice(0)) await rm(d, { recursive: true, force: true }); });
const temp = async (p: string) => { const d = await mkdtemp(join(tmpdir(), p)); roots.push(d); return d; };
const double = (name: string) => resolve('tests/support/irsim_doubles', name);
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const gone = async (pid: number) => { for (let i = 0; i < 40 && alive(pid); i++) await new Promise((r) => setTimeout(r, 50)); return !alive(pid); };

async function bundle(name: NavigationFixtureName) {
  const dir = await temp('irsim-bundle-');
  await createNavigationCompiler({ python: irPython, workerRoot, descriptionHelperRoot: resolve('robotics/simulation') }).compileResolved(navigationFixture(name).input, dir);
  return dir;
}
async function start(name: NavigationFixtureName = 'serve', over: { entry?: string[]; deadlinesMs?: Record<string, number>; sceneDigest?: string } = {}) {
  const bundleRoot = await bundle(name), runDirectory = await temp('irsim-run-');
  const client = await spawnIRSimWorker({ python: irPython, workerRoot, runId: 'run-1', bundleRoot, runDirectory, lockDigest: await lockDigestOf(join(workerRoot, 'requirements.lock')), schemaDir, ...over });
  clients.push(client);
  let n = 0, tick = 0;
  const ask = async (op: IRSimRequestV1['op'], payload: Record<string, unknown> = {}, extra: { expectedTick?: number; requestId?: string } = {}) => {
    const r = await client.request({ protocol: 'mekoniq-irsim/1', requestId: extra.requestId ?? `q${++n}`, runId: 'run-1', expectedTick: extra.expectedTick ?? tick, op, payload } as IRSimRequestV1);
    tick = r.tick;
    return r;
  };
  return { client, ask, bundleRoot, tick: () => tick };
}
const snapshot = (r: { ok: boolean; result?: unknown }) => { expect(r.ok).toBe(true); return r.result as IRSimSnapshotV1; };
const zero = (ids: string[]) => ids.map((robotId) => ({ robotId, vMps: 0, omegaRadps: 0 }));

test.skipIf(!available)('IR-SIM plant over the wire: two robots with different models move independently under explicit commands, time is integer ticks', async () => {
  const { client, ask } = await start('two-robot');
  expect((await ask('describe')).ok).toBe(true);
  const created = snapshot(await ask('create', { sceneRef: 'navigation-scene.json', seed: 17 }));
  expect(created.tick).toBe(0);
  expect(created.robots.map((r) => r.robotId)).toEqual(['amr-1', 'amr-2']);
  expect(created.robots[0]!.scans[0]!.rangesM).toHaveLength(360);
  await ask('start');
  let last = created;
  for (let k = 1; k <= 10; k++) last = snapshot(await ask('step', { targetTick: k, velocities: [{ robotId: 'amr-1', vMps: 0.2, omegaRadps: 0 }, { robotId: 'amr-2', vMps: 0, omegaRadps: 0.5 }], actorUpdates: [] }));
  expect([last.tick, last.simTimeNs]).toEqual([10, '200000000']);
  const [a0, a1] = [created.robots[0]!.poseDriveMap, last.robots[0]!.poseDriveMap], [b0, b1] = [created.robots[1]!.poseDriveMap, last.robots[1]!.poseDriveMap];
  expect(a1[0]! - a0[0]!).toBeCloseTo(0.02 * 0.01 * 55, 9); // engine acceleration limit 0.5 m/s^2 ramps 0.01 m/s per tick
  expect(a1[2]! - a0[2]!).toBeCloseTo(0, 12);
  expect(b1[0]! - b0[0]!).toBeCloseTo(0, 12);
  expect(b1[2]! - b0[2]!).toBeCloseTo(0.02 * 0.03 * 55, 9); // angular limit 1.5 rad/s^2
  expect(client.bootId).toBe(last.bootId);
  await client.close('done');
  await client.close('again'); // idempotent
  expect(client.state).toBe('closed');
  expect(await gone(client.pid!)).toBe(true);
});

test.skipIf(!available)('pause, read and resume; duplicate ids replay the receipt; a changed payload under the same id is refused', async () => {
  const { ask } = await start();
  snapshot(await ask('create', { sceneRef: 'navigation-scene.json', seed: 1 }));
  await ask('start');
  const step = { targetTick: 1, velocities: zero(['amr-1']), actorUpdates: [] };
  const first = await ask('step', step, { requestId: 'dup', expectedTick: 0 });
  const again = await ask('step', step, { requestId: 'dup', expectedTick: 0 });
  expect(again).toEqual(first);
  const conflict = await ask('step', { ...step, velocities: [{ robotId: 'amr-1', vMps: 0.1, omegaRadps: 0 }] }, { requestId: 'dup', expectedTick: 0 });
  expect(conflict).toMatchObject({ ok: false, error: { code: 'IDEMPOTENCY_CONFLICT' } });
  expect((await ask('pause')).ok).toBe(true);
  const held = snapshot(await ask('getState'));
  for (let i = 0; i < 3; i++) expect(snapshot(await ask('getState'))).toEqual(held);
  expect((await ask('step', { targetTick: 2, velocities: zero(['amr-1']), actorUpdates: [] })).ok).toBe(false);
  expect(snapshot(await ask('step', { targetTick: 2, velocities: zero(['amr-1']), actorUpdates: [], singleStep: true })).tick).toBe(2);
  expect((await ask('resume')).ok).toBe(true);
  const bad = await ask('create', { sceneRef: '../etc/passwd', seed: 1 }, { expectedTick: 2 });
  expect(bad).toMatchObject({ ok: false });
});

test.skipIf(!available)('a path outside the bundle is refused and the run stays usable', async () => {
  const { ask } = await start();
  expect(await ask('create', { sceneRef: '../outside.json', seed: 1 })).toMatchObject({ ok: false, error: { code: 'SCENE_PATH_REJECTED' } });
  expect((await ask('create', { sceneRef: 'navigation-scene.json', seed: 1 })).ok).toBe(true);
});

test.skipIf(!available)('a process killed after applying a step but before acknowledging it leaves the outcome unknown, and no replacement is ever started', async () => {
  const { client, ask } = await start('serve', { entry: [double('crash_after_step.py')] });
  snapshot(await ask('create', { sceneRef: 'navigation-scene.json', seed: 1 }));
  await ask('start');
  const pid = client.pid!;
  const lost = await ask('step', { targetTick: 1, velocities: zero(['amr-1']), actorUpdates: [] }).catch((e) => e);
  expect(lost).toBeInstanceOf(WorkerLostError);
  expect(lost).toMatchObject({ code: 'WORKER_EXITED', outcome: 'unknown' });
  expect(client.state).toBe('failed');
  const after = await ask('getState').catch((e) => e);
  expect(after).toMatchObject({ code: 'WORKER_LOST', outcome: 'not_sent' });
  expect(client.pid).toBe(pid); // same dead process: nothing was respawned
  expect(await gone(pid)).toBe(true);
});

test.skipIf(!available)('fail closed: garbage output, a late or foreign reply, a changing boot id, a missed deadline and schema-invalid requests', async () => {
  const run = async (mode: string, deadlinesMs: Record<string, number> = {}) => {
    const { client, ask } = await start('serve', { entry: [double('scripted.py'), '--mode', mode], deadlinesMs });
    const e = await ask('describe').catch((x) => x);
    return { client, e, ask };
  };
  for (const mode of ['garbage', 'late']) {
    const { client, e } = await run(mode);
    expect(e, mode).toMatchObject({ code: 'WORKER_PROTOCOL', outcome: 'unknown' });
    expect(client.state).toBe('failed');
    expect(await gone(client.pid!)).toBe(true);
  }
  const boot = await run('boot');
  expect(boot.e).not.toBeInstanceOf(WorkerLostError); // the first reply is fine
  expect(await boot.ask('getState').catch((x) => x)).toMatchObject({ code: 'WORKER_PROTOCOL' });
  const hung = await run('hang', { describe: 300 });
  expect(hung.e).toMatchObject({ code: 'WORKER_TIMEOUT', outcome: 'unknown' });
  expect(await gone(hung.client.pid!)).toBe(true);
  const { ask, client } = await start();
  expect(await ask('step', { targetTick: 0, velocities: [], actorUpdates: [] }).catch((x) => x)).toMatchObject({ code: 'INVALID_REQUEST', outcome: 'not_sent' });
  expect(client.state).toBe('ready'); // nothing reached the worker
});

test.skipIf(!available)('queue overflow is refused before it is sent; the worker environment is an allowlist', async () => {
  const { client, ask } = await start('serve', { entry: [double('scripted.py'), '--mode', 'hang'], deadlinesMs: { getState: 60_000 } });
  const first = ask('getState').catch((e) => e);
  const waiting = Array.from({ length: 64 }, () => ask('getState').catch((e) => e));
  const overflow = await ask('getState').catch((e) => e);
  expect(overflow).toMatchObject({ code: 'WORKER_QUEUE_FULL', outcome: 'not_sent' });
  await client.close('overflow test');
  await first; await Promise.all(waiting);
  process.env.SECRET_TOKEN = 'must-not-leak'; process.env.ROS_DOMAIN_ID = '7';
  try {
    const probe = await start('serve', { entry: [double('scripted.py'), '--mode', 'env'] });
    const r = await probe.ask('describe');
    const keys = (r as { error: { detail: string } }).error.detail.split(',');
    expect(keys).not.toContain('SECRET_TOKEN');
    expect(keys).not.toContain('ROS_DOMAIN_ID');
    expect(keys).toEqual(expect.arrayContaining(['PATH', 'PYTHONPATH']));
  } finally { delete process.env.SECRET_TOKEN; delete process.env.ROS_DOMAIN_ID; }
});

test('review #6: a worker that cannot be spawned fails the request and close() still returns', async () => {
  const bundleRoot = await bundle('serve');
  const client = await spawnIRSimWorker({ python: '/nonexistent/python', workerRoot, runId: 'run-1', bundleRoot, runDirectory: await temp('irsim-run-'), lockDigest: '1'.repeat(64), schemaDir });
  clients.push(client);
  const lost = await client.request({ protocol: 'mekoniq-irsim/1', requestId: 'q1', runId: 'run-1', expectedTick: 0, op: 'describe', payload: {} }).catch((e) => e);
  expect(lost).toBeInstanceOf(WorkerLostError);
  await Promise.race([client.close('never started'), new Promise((_, no) => setTimeout(() => no(new Error('close() hung')), 5000))]);
  expect(client.state).toBe('failed');
});

test('review2 #1: a snapshot that contradicts the envelope, the run or the bound scene is never accepted', async () => {
  for (const [mode, why] of [['tick', 'tick'], ['run', 'run'], ['boot', 'boot'], ['scene', 'scene']] as const) {
    const { client, ask } = await start('serve', { entry: [double('snapshot.py'), '--mode', mode], sceneDigest: 'a'.repeat(64) });
    const lost = await ask('getState', {}, { expectedTick: 0 }).catch((e) => e);
    expect(lost, why).toBeInstanceOf(WorkerLostError);
    expect((lost as WorkerLostError).code).toBe('WORKER_PROTOCOL');
    expect(client.state).toBe('failed');
  }
  const { client, ask } = await start('serve', { entry: [double('snapshot.py'), '--mode', 'ok'], sceneDigest: 'a'.repeat(64) });
  expect((await ask('getState', {}, { expectedTick: 0 })).ok).toBe(true); // the control: a consistent snapshot passes
  expect(client.state).toBe('ready');
});
