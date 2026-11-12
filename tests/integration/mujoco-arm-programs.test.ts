// M06 / MA04 on the real MuJoCo 3.17.0 (.venv-mujoco): cup-pick and cup-place run through mujocoArmPorts on the xArm coffee cell; the cup is gripped, lifted and released by contact.
// Skipped, with the reason, where .venv-mujoco is missing (not_run, never a pass).
import { afterEach, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MockArmPlant } from '../../packages/cell-adapters/src/mock-arm';
import { MockCoffeePlant } from '../../packages/cell-adapters/src/mock-coffee';
import type { CellCommand } from '../../packages/cell-adapters/src/contract';
import { lockDigestOf } from '../../packages/lab-runtime/src/engineering/linkforge';
import { loadOracleProfile } from '../../packages/lab-runtime/src/v2/algorithm/checker';
import { armCollisionRecord } from '../../packages/lab-runtime/src/v2/beverage/arm-plant-report';
import type { CoffeeContext, CoffeeState } from '../../packages/lab-runtime/src/v2/scenarios/coffee';
import type { CoffeePlantPorts } from '../../packages/lab-runtime/src/v2/beverage/coffee-ports';
import type { LabProjectV2 } from '../../packages/lab-runtime/src/v2/contracts';
import { XARM6_SI } from '../../packages/lab-runtime/src/v2/models/arm-kinematics';
import { XARM_FIXTURE_ID } from '../../packages/lab-runtime/src/v2/simulation3d/arm-cell-scene';
import { mujocoArmPorts } from '../../packages/lab-runtime/src/v2/simulation3d/mujoco-arm-ports';
import type { MujocoRuntimeOptions } from '../../packages/lab-runtime/src/v2/simulation3d/mujoco';

const python = resolve('.venv-mujoco/bin/python'), workerRoot = resolve('robotics/simulation-mujoco'), FX = join(workerRoot, 'fixtures', XARM_FIXTURE_ID);
const mujocoReady = existsSync(python) && (() => { try { return execFileSync(python, ['-I', '-B', '-c', 'import mujoco;print(mujoco.__version__)'], { encoding: 'utf8', timeout: 30_000 }).trim() === '3.17.0'; } catch { return false; } })();
const running = () => { try { return execFileSync('pgrep', ['-f', 'mujoco_worker --run-id'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean); } catch { return []; } };
const dirs: string[] = [], open: CoffeePlantPorts[] = [];
afterEach(async () => { for (const p of open.splice(0)) await p.close().catch(() => {}); for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
const command = (id: string, program: 'cup-pick' | 'cup-place'): CellCommand => ({ runId: 'run-a', commandId: id, deviceId: 'arm-1', controlEpoch: 1, expiresAt: '2026-11-06T00:00:00Z', recipeRevision: 1,
  programRef: { id: program, hash: 'a'.repeat(64) }, payloadHash: 'a'.repeat(64), capability: 'start_job', payload: { jobId: 'j' } });
const state = (st: CoffeeState, id: string) => st.arm.programs.find((x) => x.commandId === id)?.state;

async function ports() {
  const runtime: MujocoRuntimeOptions = { python, workerRoot, schemaDir: resolve('packages/contracts/schemas'), lockDigest: await lockDigestOf(join(workerRoot, 'requirements.lock')), engineVersion: '3.17.0', maxActiveRuns: 1 };
  const directory = await mkdtemp(join(tmpdir(), 'mujoco-programs-')); dirs.push(directory);
  const st = { stationId: 'coffee-pickup', cellId: 'cell-1', armId: 'arm-1', registered: false, sessions: {}, workload: [{ cupId: 'cup-1' }], plant: MockCoffeePlant.initial('cell-1'), arm: MockArmPlant.initial('arm-1'), trays: {} } as unknown as CoffeeState;
  const ctx = { runId: 'run-a', nowMs: () => Date.parse('2026-11-05T00:00:00Z'), tick: () => 0, receiver: () => ({ robotId: 'amr-1', slot: 1 }) } as unknown as CoffeeContext;
  const project = JSON.parse(await readFile(join(FX, 'coffee-cell-project.json'), 'utf8')) as LabProjectV2;
  const p = await mujocoArmPorts(runtime, { project, seed: 42 })(st, ctx, () => 'boot-1', directory);
  open.push(p);
  return { p, st, directory };
}
type Seen = { tick: number; holding: string | null; z: number | null; restingOn: string | null };
async function drive(p: CoffeePlantPorts, st: CoffeeState, id: string, program: 'cup-pick' | 'cup-place', seen: Seen[]) {
  expect(p.mockArm!.execute(command(id, program)).accepted).toBe(true);
  let n = 0;
  while (n < 3000 && state(st, id) === 'running') {
    n++; await p.advance();
    const cup = st.arm.props?.find((x) => x.propId === 'cup-1');
    seen.push({ tick: st.arm.tick, holding: st.arm.holding, z: cup ? cup.position[2]! : null, restingOn: cup?.restingOn ?? null });
  }
  return n;
}

describe.skipIf(!mujocoReady)('MuJoCo arm programs (MA04)', () => {
  test('cup-pick and cup-place complete on the real engine: the cup is held by contact, lifted, kept without slipping, released onto the tray; tracking and ARM03 pass', async () => {
    const { p, st, directory } = await ports();
    const profile = loadOracleProfile().profile.mujocoArm!, seen: Seen[] = [];
    p.coffeePlant!.placeCup('cup-1', 'paper');
    const pick = await drive(p, st, 'p1', 'cup-pick', seen), place = await drive(p, st, 'p2', 'cup-place', seen);
    const ev1 = p.mockArm!.reconcile('p1').evidence as Record<string, unknown>, ev2 = p.mockArm!.reconcile('p2').evidence as Record<string, unknown>;
    const stats = p.report().armPlant!, heldAt = seen.find((s) => s.holding === 'cup-1'), liftFrom = heldAt?.z ?? NaN, pickEnd = seen[pick - 1]!;
    const trayAt = seen.find((s) => s.restingOn === 'tray'), lastSeen = [...seen].reverse().find((s) => s.z !== null)!;
    const ev = st.arm.collision!.evidence!, arm03 = armCollisionRecord(st.arm, { id: 'w', revision: 1, hash: 'h' } as never, { id: 'arm' });
    console.log('MA04', JSON.stringify({ pickTicks: pick, placeTicks: place, peakRad: stats.tracking.peakRad, rmsRad: stats.tracking.rmsRad, followTolRad: profile.followTolRad, heldTick: heldAt?.tick,
      liftM: pickEnd.z! - liftFrom, liftMinM: profile.liftMinM, maxSlipM: ev2.maxSlipM ?? ev1.maxSlipM, slipTolM: profile.slipTolM, trayTick: trayAt?.tick, lastSeen, stop: st.arm.stop?.reason ?? null,
      states: [state(st, 'p1'), state(st, 'p2')], ev1, ev2, arm03: { result: arm03.result, reasonCodes: arm03.reasonCodes, modelRevision: arm03.modelRevision, coverage: arm03.coverage, allowedContacts: arm03.allowedContacts,
        contactIntervals: ev.intervals.filter((i) => i.result.allowed?.inContact.length).map((i) => [i.firstTick, i.lastTick, i.result.allowed!.inContact.map((x) => x.join('/')).join(',')]) } }));
    expect(state(st, 'p1')).toBe('completed'); expect(state(st, 'p2')).toBe('completed');
    expect(st.arm.stop).toBeUndefined(); expect(st.arm.holding).toBeNull(); expect(st.arm.gripper).toBe('open');
    expect(ev1).toMatchObject({ grip: 'contact', gripperClosed: true, objectPresent: true, cupId: 'cup-1', liftPoseReached: true });
    expect(ev2).toMatchObject({ released: true, receiverId: 'amr-1', slot: 1, cupId: 'cup-1' });
    stats.tracking.peakRad.forEach((v, i) => expect(v, `J${i + 1} peak`).toBeLessThanOrEqual(profile.followTolRad));
    expect(pickEnd.z! - liftFrom).toBeGreaterThanOrEqual(profile.liftMinM);
    for (const e of [ev1, ev2]) { expect(typeof e.maxSlipM).toBe('number'); expect(e.maxSlipM as number).toBeLessThanOrEqual(profile.slipTolM); }
    // the cup ends at rest on the tray: the last pose the cell reported before the delivered cup left it, after gripSettleTicks resting ticks
    expect(lastSeen.restingOn).toBe('tray'); expect(st.trays['amr-1']).toBe('cup-1');
    // ARM03 on the actual joints passes with the cell's allowed contacts applied to the sweep
    const scene = JSON.parse(await readFile(join(directory, 'mujoco-arm', 'bundle', 'arm-cell-scene.json'), 'utf8'));
    expect(scene.allowedContacts).toEqual([{ a: 'gripper', b: 'nozzle-stand' }, { a: 'gripper', b: 'tray' }, { a: 'held_prop', b: 'nozzle-stand' }, { a: 'held_prop', b: 'tray' }]);
    expect(arm03.result).toBe('pass'); expect(ev.firstFailure).toBeUndefined(); expect(ev.droppedIntervals).toBe(0); expect(ev.intervals.some((i) => i.heldCupId === 'cup-1')).toBe(true);
    // the record names what was swept: the xArm model, the cell's allowed contacts and how often they were in contact; every swept world held both supports
    expect(arm03.modelRevision).toBe(XARM6_SI.revision);
    expect(arm03.allowedContacts.map((c) => c.pair)).toEqual([['gripper', 'nozzle-stand'], ['gripper', 'tray'], ['held-cup', 'nozzle-stand'], ['held-cup', 'tray']]);
    expect(Object.values(ev.worlds).every((w) => ['nozzle-stand', 'tray'].every((id) => w.some((o) => o.id === id)))).toBe(true);
    expect(arm03.coverage!.allowedContactsApplied).toBeGreaterThan(0);
    expect(stats).toMatchObject({ engine: 'mujoco_3d', engineVersion: '3.17.0', control: 'position_actuator', grip: 'contact', calibration: 'not_calibrated' });
    expect(stats.tracking.samples).toBe(pick + place);
  }, 180_000);

  test('close leaves no worker process and no MuJoCo log in the tool root', async () => {
    const { p } = await ports();
    expect(running().length).toBe(1);
    await p.close();
    expect(running()).toEqual([]);
    expect(existsSync(join(workerRoot, 'MUJOCO_LOG.TXT'))).toBe(false);
  }, 60_000);
});
