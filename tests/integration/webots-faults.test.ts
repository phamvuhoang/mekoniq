// WB05 + Review Focus #2/#4: operator cancel, a lost or slow worker, a lost or quit engine, and a robot that tips over. Every one of them ends the run honestly:
// unknown / needs_attention with the exact reason, nothing served, nothing resent, no second engine, no process left behind.
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import { rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import type { ScenarioRun } from '../../packages/lab-runtime/src/v2/scenario-runner';
import { act, openWebotsRun, removeBundles, stepUntil, temp, webotsAvailable, webotsBundle, webotsDouble, webotsProcesses } from '../support/webots-mission';

let bundle: Awaited<ReturnType<typeof webotsBundle>>;
const runs: ScenarioRun[] = [], dirs: string[] = [];
beforeAll(async () => { if (webotsAvailable) bundle = await webotsBundle(); }, 120_000);
afterEach(async () => { for (const r of runs.splice(0)) await r.close().catch(() => {}); for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
afterAll(removeBundles);
async function open(over: Parameters<typeof openWebotsRun>[2] = {}) { const dir = await temp('webots-faults-'); dirs.push(dir); const run = await openWebotsRun(dir, bundle, over); runs.push(run); return { run, dir }; }
const fake = (mode: string, n: number) => [webotsDouble('fake_plant.py'), mode, String(n)];
const reasons = (v: { attention?: { reason: string; subjectId?: string }[] }) => (v.attention ?? []).map((a) => a.reason);
const settle = () => new Promise((r) => setTimeout(r, 500));

// the doubles need the .venv-webots interpreter (they import the worker), not Webots itself
test.skipIf(!webotsAvailable)('PLANT_UNSTABLE: a robot that tips over ends the run at that tick with that code, not at the mission timeout with a wrong reason', async () => {
  const { run } = await open({ entry: fake('unstable', 12) });
  await run.start();
  let v = await run.snapshot();
  while (v.run.status === 'running' && v.tick < 100) v = await act(run, 'step', { ticks: 5 });
  expect(v.run.status).toBe('needs_attention');
  expect(reasons(v)).toContain('PLANT_UNSTABLE');
  expect(v.tick).toBeLessThanOrEqual(14); // the first unstable tick is 11 (the priming step counts as engine step 1)
  const r = await run.report();
  expect(r.outcome.served).toBe('0');
  await expect(act(run, 'step', { ticks: 1 })).rejects.toThrow(/INVALID_STATE/);
});

test.skipIf(!webotsAvailable)('an engine step that misses the ACK deadline makes the leg unknown: a recorded gap, no resend, no second worker', async () => {
  const { run } = await open({ entry: fake('lag', 10), deadlinesMs: { step: 200 } });
  await run.start();
  let v = await run.snapshot();
  while (v.run.status === 'running' && v.tick < 100) v = await act(run, 'step', { ticks: 5 });
  expect(v.run.status).toBe('needs_attention');
  expect(reasons(v)).toContain('WORKER_LOST');
  const r = await run.report();
  expect(r.navigation2d!.recording!.gaps.some((g) => g.reason === 'STEP_ACK_LOST')).toBe(true);
  expect(r.outcome.served).toBe('0');
});

test.skipIf(!webotsAvailable)('Webots quit cleanly in the middle of a run (exit 0): the run is unknown and suspended, never restarted', async () => {
  const { run } = await open({ entry: fake('quit', 10) });
  await run.start();
  let v = await run.snapshot();
  while (v.run.status === 'running' && v.tick < 100) v = await act(run, 'step', { ticks: 5 });
  expect(v.run.status).toBe('needs_attention');
  expect(reasons(v)).toContain('WORKER_LOST');
  const tick = v.tick;
  await expect(act(run, 'step', { ticks: 1 })).rejects.toThrow(/INVALID_STATE/);
  expect((await run.snapshot()).tick).toBe(tick); // nothing advanced, nothing restarted
});

test.skipIf(!webotsAvailable)('WB05 cancel mid-route on the real plant: cancelled, nothing served, the robot stopped, no process left', async () => {
  const { run } = await open();
  await run.start();
  await stepUntil(run, async () => (await run.report()).businessEvents.some((e) => e.type === 'RobotGoalAccepted' || e.type === 'MissionStarted'), 25, 3000).catch(() => undefined);
  let v = await stepUntil(run, async (x) => x.tick >= 300, 50, 3000);
  expect(v.run.status).toBe('running');
  v = await act(run, 'cancel');
  for (let i = 0; i < 40 && v.run.status !== 'cancelled'; i++) v = await act(run, 'step', { ticks: 25 });
  expect(v.run.status).toBe('cancelled');
  const r = await run.report();
  expect(r.outcome).toMatchObject({ status: 'cancelled', served: '0' });
  await run.close(); runs.length = 0; await settle();
  expect(webotsProcesses()).toEqual([]);
}, 300_000);

test.skipIf(!webotsAvailable)('WB05 killing Webots on the real plant mid-run: the leg is unknown, nothing is resent, no second engine starts, nothing is left running', async () => {
  const { run, dir } = await open();
  await run.start();
  await stepUntil(run, async (x) => x.tick >= 200, 50, 3000);
  const pids = execFileSync('pgrep', ['-f', `Webots.app/Contents/MacOS/webots.*${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  expect(pids).toHaveLength(1);
  process.kill(Number(pids[0]), 'SIGKILL');
  let v = await run.snapshot();
  for (let i = 0; i < 10 && v.run.status === 'running'; i++) v = await act(run, 'step', { ticks: 5 });
  expect(v.run.status).toBe('needs_attention');
  expect(reasons(v)).toContain('WORKER_LOST');
  const r = await run.report();
  expect(r.outcome.served).toBe('0');
  expect(r.navigation2d!.recording!.gaps.some((g) => g.reason === 'STEP_ACK_LOST')).toBe(true);
  await run.close(); runs.length = 0; await settle();
  expect(webotsProcesses()).toEqual([]);
}, 300_000);

test.skipIf(!webotsAvailable)('a 3D plant puts the base height and tilt into the twin samples; a planar sample has none', async () => {
  const { run } = await open({ entry: fake('ok', 1000) });
  await run.start();
  await act(run, 'step', { ticks: 10 });
  const sample = run.telemetry.latest().find((x) => x.entityId === 'amr-1')!;
  expect(sample.observed).toMatchObject({ zM: 0.09, rollRad: 0, pitchRad: 0 });
});
