// X05 / WA04 (R1.1) on the real Webots R2025a: cup-pick and cup-place run through webotsArmPorts. Skipped, with the reason, where Webots or .venv-webots is missing.
import { afterEach, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MockArmPlant } from '../../packages/cell-adapters/src/mock-arm';
import { MockCoffeePlant } from '../../packages/cell-adapters/src/mock-coffee';
import type { CellCommand } from '../../packages/cell-adapters/src/contract';
import { lockDigestOf } from '../../packages/lab-runtime/src/engineering/linkforge';
import { loadOracleProfile } from '../../packages/lab-runtime/src/v2/algorithm/checker';
import type { CoffeeContext, CoffeeState } from '../../packages/lab-runtime/src/v2/scenarios/coffee';
import type { CoffeePlantPorts } from '../../packages/lab-runtime/src/v2/beverage/coffee-ports';
import { webotsArmPorts } from '../../packages/lab-runtime/src/v2/simulation3d/arm-ports';
import type { WebotsRuntimeOptions } from '../../packages/lab-runtime/src/v2/simulation3d/webots';
import type { LabProjectV2 } from '../../packages/lab-runtime/src/v2/contracts';
import { coffeeProject } from '../support/lab-v2';

const HOME = process.env.MEKONIQ_WEBOTS_HOME ?? '/Applications/Webots.app', python = resolve('.venv-webots/bin/python'), workerRoot = resolve('robotics/simulation-3d');
const exe = join(HOME, 'Contents', 'MacOS', 'webots');
const webotsReady = existsSync(exe) && existsSync(python) && (() => { try { return execFileSync(exe, ['--version'], { encoding: 'utf8', timeout: 30_000 }).includes('R2025a'); } catch { return false; } })();
const running = () => { try { return execFileSync('pgrep', ['-f', '^[^ ]*/Contents/MacOS/webots |^[^ ]+ -I -B -X utf8 [^ ]*webots_worker/(supervisor|robot_controller|arm_controller)\\.py'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean); } catch { return []; } };

const dirs: string[] = [], open: CoffeePlantPorts[] = [];
afterEach(async () => { for (const p of open.splice(0)) await p.close().catch(() => {}); for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
const command = (id: string, program: 'cup-pick' | 'cup-place'): CellCommand => ({ runId: 'run-a', commandId: id, deviceId: 'arm', controlEpoch: 1, expiresAt: '2026-11-06T00:00:00Z', recipeRevision: 1,
  programRef: { id: program, hash: 'a'.repeat(64) }, payloadHash: 'a'.repeat(64), capability: 'start_job', payload: { jobId: 'j' } });
const state = (st: CoffeeState, id: string) => st.arm.programs.find((x) => x.commandId === id)?.state;

async function ports() {
  const runtime: WebotsRuntimeOptions = { python, workerRoot, schemaDir: resolve('packages/contracts/schemas'), lockDigest: await lockDigestOf(join(workerRoot, 'requirements.lock')), webotsHome: HOME,
    executableSha256: 'a'.repeat(64), basicTimeStepMs: 20, maxActiveRuns: 1 };
  const directory = await mkdtemp(join(tmpdir(), 'arm-programs-')); dirs.push(directory);
  const st = { stationId: 'coffee-pickup', cellId: 'cell-1', armId: 'arm-1', registered: false, sessions: {}, workload: [], plant: MockCoffeePlant.initial('cell-1'), arm: MockArmPlant.initial('arm-1'), trays: {} } as unknown as CoffeeState;
  const ctx = { runId: 'run-a', nowMs: () => Date.parse('2026-11-05T00:00:00Z'), tick: () => 0, receiver: () => ({ robotId: 'amr-1', slot: 1 }) } as unknown as CoffeeContext;
  const p = await webotsArmPorts(runtime, { project: coffeeProject() as unknown as LabProjectV2, seed: 42 })(st, ctx, () => 'boot-1', directory);
  open.push(p);
  return { p, st };
}
async function drive(p: CoffeePlantPorts, st: CoffeeState, id: string, program: 'cup-pick' | 'cup-place') {
  expect(p.mockArm!.execute(command(id, program)).accepted).toBe(true);
  let n = 0;
  while (n < 3000 && state(st, id) === 'running') { n++; await p.advance(); }
  return n;
}

describe.skipIf(!webotsReady)('Webots arm programs (WA04)', () => {
  test('cup-pick and cup-place complete on the real engine, follow within followTolRad, collide with nothing, and leave the evidence the mock leaves', async () => {
    const { p, st } = await ports();
    const profile = loadOracleProfile().profile.webotsArm!;
    const pick = await drive(p, st, 'p1', 'cup-pick'), place = await drive(p, st, 'p2', 'cup-place');
    expect(state(st, 'p1')).toBe('completed'); expect(state(st, 'p2')).toBe('completed');
    expect(st.arm.stop).toBeUndefined(); expect(st.arm.holding).toBeNull(); expect(st.arm.gripper).toBe('open');
    // following: the peak |actual - commanded| of every joint stays inside the threshold
    const stats = p.report().armPlant!;
    expect(stats.tracking.samples).toBe(pick + place); expect(stats.tracking.peakRad).toHaveLength(6);
    stats.tracking.peakRad.forEach((v, i) => expect(v, `J${i + 1} peak`).toBeLessThanOrEqual(profile.followTolRad));
    expect(Math.max(...stats.tracking.peakRad)).toBeGreaterThan(0); // a real plant lags: this is not the mock's exact tracking
    // ARM03 geometry on the real (actual) joints: every interval was checked clear
    const ev = st.arm.collision!.evidence!;
    expect(ev.intervals.length).toBeGreaterThan(100); expect(ev.firstFailure).toBeUndefined(); expect(ev.droppedIntervals).toBe(0);
    expect(ev.intervals.every((i) => i.result.ok)).toBe(true); expect(st.arm.limitsOk).toBe(true);
    // the trace is the actual one, from tick 1 of pick
    const trace = st.arm.tracking!.trace;
    expect(trace).toHaveLength(pick + place); expect(trace[0]!.tick).toBe(1);
    expect(trace.every((t) => t.actualRad.length === 6 && t.actualRad.every(Number.isFinite))).toBe(true);
    // the TransferEvidence is the mock's (grip is an event, not physics)
    const mock = MockArmPlant.initial('arm-1'), twin = new MockArmPlant(mock, () => Date.parse('2026-11-05T00:00:00Z'), () => 'boot-1', { take: () => null, put: () => {} }, () => ({ robotId: 'amr-1', slot: 1 }));
    for (const [id, program] of [['p1', 'cup-pick'], ['p2', 'cup-place']] as const) { twin.execute(command(id, program)); for (let i = 0; i < 4000 && twin.reconcile(id).status === 'running'; i++) twin.advance(); }
    // (no coffee job here, so neither arm takes a cup: the same programs, the same evidence)
    for (const id of ['p1', 'p2']) expect(p.mockArm!.reconcile(id).evidence, id).toEqual(twin.reconcile(id).evidence);
    expect(p.report().armPlant).toMatchObject({ engine: 'webots_3d', control: 'position_servo', grip: 'event', dynamics: 'assumed', calibration: 'not_calibrated' });
  }, 180_000);

  test('close leaves no Webots, no controller and no held slot', async () => {
    const { p } = await ports();
    expect(running().length).toBeGreaterThanOrEqual(3);
    await p.close();
    await new Promise((r) => setTimeout(r, 700));
    expect(running()).toEqual([]);
  }, 120_000);
});
