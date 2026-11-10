// X05 (R1.1 D19, D24): webotsArmPorts against the real worker session over a fake arm engine (tests/support/webots_doubles/fake_arm_plant.py). No Webots needed.
import { afterEach, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MockArmPlant } from '../../packages/cell-adapters/src/mock-arm';
import { MockCoffeePlant } from '../../packages/cell-adapters/src/mock-coffee';
import type { CellCommand, CellReport } from '../../packages/cell-adapters/src/contract';
import { lockDigestOf } from '../../packages/lab-runtime/src/engineering/linkforge';
import type { CoffeeContext, CoffeeState } from '../../packages/lab-runtime/src/v2/scenarios/coffee';
import type { CoffeePlantPorts } from '../../packages/lab-runtime/src/v2/beverage/coffee-ports';
import { buildArmScene3D, engineSeedOf, readArmFixture } from '../../packages/lab-runtime/src/v2/simulation3d/arm-scene';
import { webotsArmPorts } from '../../packages/lab-runtime/src/v2/simulation3d/arm-ports';
import type { WebotsRuntimeOptions } from '../../packages/lab-runtime/src/v2/simulation3d/webots';
import { validateArmScene3D } from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import { activeRunCount } from '../../packages/lab-runtime/src/v2/navigation2d/runner';
import type { LabProjectV2 } from '../../packages/lab-runtime/src/v2/contracts';
import { coffeeProject } from '../support/lab-v2';

const python = resolve('.venv-webots/bin/python'), workerRoot = resolve('robotics/simulation-3d'), double = resolve('tests/support/webots_doubles/fake_arm_plant.py');
const project = () => coffeeProject() as unknown as LabProjectV2;
const dirs: string[] = [], open: CoffeePlantPorts[] = [];
afterEach(async () => { for (const p of open.splice(0)) await p.close().catch(() => {}); for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });

const command = (id: string, program: 'cup-pick' | 'cup-place'): CellCommand => ({ runId: 'run-a', commandId: id, deviceId: 'arm', controlEpoch: 1, expiresAt: '2026-11-06T00:00:00Z', recipeRevision: 1,
  programRef: { id: program, hash: 'a'.repeat(64) }, payloadHash: 'a'.repeat(64), capability: 'start_job', payload: { jobId: 'j' } });

async function runtime(mode = 'ok', at = 0, maxActiveRuns = 1): Promise<WebotsRuntimeOptions> {
  return { python, workerRoot, schemaDir: resolve('packages/contracts/schemas'), lockDigest: await lockDigestOf(join(workerRoot, 'requirements.lock')), webotsHome: '/nonexistent', executableSha256: 'a'.repeat(64),
    basicTimeStepMs: 20, maxActiveRuns, entry: [double, mode, String(at)] };
}
async function ports(rt: WebotsRuntimeOptions, runId = 'run-a', proj = project()) {
  const directory = await mkdtemp(join(tmpdir(), 'arm-ports-')); dirs.push(directory);
  const st = { stationId: 'coffee-pickup', cellId: 'cell-1', armId: 'arm-1', registered: false, sessions: {}, workload: [], plant: MockCoffeePlant.initial('cell-1'), arm: MockArmPlant.initial('arm-1'), trays: {} } as unknown as CoffeeState;
  const ctx = { runId, nowMs: () => Date.parse('2026-11-05T00:00:00Z'), tick: () => 0, receiver: () => ({ robotId: 'amr-1', slot: 1 }) } as unknown as CoffeeContext;
  const p = await webotsArmPorts(rt, { project: proj, seed: 42 })(st, ctx, () => 'boot-1', directory);
  open.push(p);
  return { p, st, directory, arm: p.mockArm!, stepsLog: join(directory, 'webots-arm', 'run', 'steps.jsonl') };
}
const state = (st: CoffeeState, id: string) => st.arm.programs.find((x) => x.commandId === id)?.state;
async function drive(p: CoffeePlantPorts, st: CoffeeState, id: string, program: 'cup-pick' | 'cup-place', limit = 1500) {
  expect(p.mockArm!.execute(command(id, program)).accepted).toBe(true);
  let n = 0;
  while (n < limit && state(st, id) === 'running') { n++; await p.advance(); }
  return n;
}

describe.skipIf(!existsSync(python))('webotsArmPorts on a fake arm engine', () => {
  test('each advance sends exactly one step whose jointTargets are the commanded joints, and cup-pick then cup-place complete', async () => {
    const { p, st, stepsLog } = await ports(await runtime());
    const a = await drive(p, st, 'p1', 'cup-pick'), b = await drive(p, st, 'p2', 'cup-place');
    expect(state(st, 'p1')).toBe('completed'); expect(state(st, 'p2')).toBe('completed');
    const log = (await readFile(stepsLog, 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as { n: number; targets: number[] });
    expect(log.length).toBe(1 + a + b); // the worker's priming step, then one per advance
    expect(log.map((l) => l.n)).toEqual(log.map((_, i) => i + 1));
    const trace = st.arm.tracking!.trace;
    expect(trace.length).toBeGreaterThan(100);
    expect(trace.map((t) => t.commandedRad)).toEqual(log.slice(1, 1 + trace.length).map((l) => l.targets)); // what was sent is what the tracking trace calls commanded
    expect(p.report().armPlant).toMatchObject({ engine: 'webots_3d', control: 'position_servo', grip: 'event', dynamics: 'assumed', calibration: 'not_calibrated' });
    expect(p.report().armPlant!.tracking.samples).toBe(trace.length);
    expect(Math.max(...p.report().armPlant!.tracking.peakRad)).toBeLessThan(1e-9); // this engine reaches every target at once
  }, 60_000);

  test('a plant that lags a tick and sits 5 mrad off still completes, and the tracking stats say how far off it was', async () => {
    const { p, st } = await ports(await runtime('lag'));
    await drive(p, st, 'p1', 'cup-pick');
    expect(state(st, 'p1')).toBe('completed');
    const peak = p.report().armPlant!.tracking.peakRad;
    expect(peak[0]).toBeGreaterThan(0.004); expect(peak[0]).toBeLessThan(0.02);
  }, 60_000);

  test('a plant that does not move is a following error and the program stops unknown', async () => {
    const { p, st } = await ports(await runtime('stuck'));
    const n = await drive(p, st, 'p1', 'cup-pick');
    expect(st.arm.stop).toMatchObject({ latched: true, reason: 'ARM_FOLLOWING_ERROR' }); expect(state(st, 'p1')).toBe('unknown');
    expect(n).toBeLessThan(80);
  }, 60_000);

  test('a contact the engine reports stops the arm as ARM_COLLISION', async () => {
    const { p, st } = await ports(await runtime('floor', 5));
    await drive(p, st, 'p1', 'cup-pick');
    expect(st.arm.stop).toMatchObject({ latched: true, reason: 'ARM_COLLISION' }); expect(state(st, 'p1')).toBe('unknown');
  }, 60_000);

  test('a worker that is lost mid-program leaves the program unknown, the arm latched, and nothing started in its place', async () => {
    const { p, st, directory } = await ports(await runtime('quit', 30));
    const reports: CellReport[] = []; p.adapters[1]!.observe((r) => reports.push(r));
    await drive(p, st, 'p1', 'cup-pick', 200);
    expect(state(st, 'p1')).toBe('unknown'); expect(st.arm.stop).toMatchObject({ latched: true, reason: 'WORKER_LOST' });
    expect(reports.some((r) => r.observation?.result === 'outcome_unknown')).toBe(true);
    const before = (await readFile(join(directory, 'webots-arm', 'run', 'steps.jsonl'), 'utf8')).trim().split('\n').length;
    for (let i = 0; i < 20; i++) await p.advance(); // later ticks neither resend nor respawn
    expect((await readFile(join(directory, 'webots-arm', 'run', 'steps.jsonl'), 'utf8')).trim().split('\n').length).toBe(before);
  }, 60_000);

  test('an engine that reports NaN is PLANT_UNSTABLE for the worker, which the ports treat as a lost plant', async () => {
    const { p, st } = await ports(await runtime('nan', 10));
    await drive(p, st, 'p1', 'cup-pick', 200);
    expect(state(st, 'p1')).toBe('unknown'); expect(st.arm.stop?.latched).toBe(true);
    expect(st.arm.q.every(Number.isFinite)).toBe(true);
  }, 60_000);

  test('close ends the worker process and gives the Webots slot back; the host has one slot, shared with webots_3d', async () => {
    const rt = await runtime();
    expect(activeRunCount('webots_3d')).toBe(0);
    const first = await ports(rt, 'run-a');
    expect(activeRunCount('webots_3d')).toBe(1);
    await expect(ports(rt, 'run-b')).rejects.toThrow('WEBOTS_CAPACITY');
    await first.p.close();
    expect(activeRunCount('webots_3d')).toBe(0);
    expect(() => execFileSync('pgrep', ['-f', `fake_arm_plant.py.*${first.directory}`], { encoding: 'utf8' })).toThrow(); // no worker left
    const again = await ports(rt, 'run-b');
    expect(again.p).toBeDefined();
  }, 60_000);

  test('a failed create gives the slot back and surfaces the worker\'s code', async () => {
    const rt = await runtime();
    const bad = project(); (bad as { armCollisionProfile?: unknown }).armCollisionProfile = undefined;
    await expect(ports(rt, 'run-a', bad)).rejects.toThrow('ARM_SCENE_UNAVAILABLE');
    expect(activeRunCount('webots_3d')).toBe(0);
  }, 60_000);
});

describe('buildArmScene3D', () => {
  const fixture = () => { const f = readArmFixture(workerRoot); return { id: f.id, revision: f.revision }; };
  test('builds a sealed, valid arm scene from the project: base pose, fixed obstacles in the arm frame, reduced seed', () => {
    const scene = buildArmScene3D(project(), fixture(), 2 ** 32 - 1);
    expect(validateArmScene3D(scene).ok).toBe(true);
    expect(scene.engineSeed).toBe(engineSeedOf(2 ** 32 - 1)); expect(scene.engineSeed).toBe(2 ** 31 - 1);
    expect(scene.arm).toMatchObject({ armId: 'arm-1', modelId: 'arm-ref-3d-v1', modelRevision: fixture().revision, baseInMap: project().armCollisionProfile!.baseInMap });
    expect(scene.arm.homeRad).toEqual(MockArmPlant.initial('arm-1').q);
    expect(scene.statics.every((o) => o.id.startsWith('fixture:'))).toBe(true);
    expect(buildArmScene3D(project(), fixture(), 42)).toEqual(buildArmScene3D(project(), fixture(), 42)); // deterministic
    expect(buildArmScene3D(project(), fixture(), 42, { homeRad: [0.1, -0.5, 1.1, 0, 0.7, 0] }).arm.homeRad[0]).toBe(0.1);
  });
  test('a project without an arm collision profile is ARM_SCENE_UNAVAILABLE', () => {
    const p = project() as { armCollisionProfile?: unknown }; delete p.armCollisionProfile;
    expect(() => buildArmScene3D(p as LabProjectV2, fixture(), 1)).toThrow(/^ARM_SCENE_UNAVAILABLE/);
  });
  test('a profile or fixture for another model is ARM_MODEL_MISMATCH', () => {
    const p = project(); (p.armCollisionProfile as { modelId: string }).modelId = 'other-arm';
    expect(() => buildArmScene3D(p, fixture(), 1)).toThrow(/ARM_MODEL_MISMATCH/);
    expect(() => buildArmScene3D(project(), { id: 'serve-3d-v1', revision: fixture().revision }, 1)).toThrow(/ARM_MODEL_MISMATCH/);
    const q = project(); (q.armCollisionProfile as { modelRevision: string }).modelRevision = 'f'.repeat(64);
    expect(() => buildArmScene3D(q, fixture(), 1)).toThrow(/ARM_MODEL_MISMATCH/);
  });
});
