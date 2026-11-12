// M06 step 2: mujocoArmPorts against the real MuJoCo worker session over a fake cell engine (tests/support/mujoco_doubles/fake_cell_plant.py). No MuJoCo is imported.
import { afterEach, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MockArmPlant } from '../../packages/cell-adapters/src/mock-arm';
import { MockCoffeePlant } from '../../packages/cell-adapters/src/mock-coffee';
import type { CellCommand, CellReport } from '../../packages/cell-adapters/src/contract';
import { lockDigestOf } from '../../packages/lab-runtime/src/engineering/linkforge';
import { loadOracleProfile } from '../../packages/lab-runtime/src/v2/algorithm/checker';
import type { CoffeeContext, CoffeeState } from '../../packages/lab-runtime/src/v2/scenarios/coffee';
import type { CoffeePlantPorts } from '../../packages/lab-runtime/src/v2/beverage/coffee-ports';
import { activeRunCount } from '../../packages/lab-runtime/src/v2/navigation2d/runner';
import { composePose, qrotate } from '../../packages/lab-runtime/src/v2/frames';
import { forwardKinematics, XARM6_SI } from '../../packages/lab-runtime/src/v2/models/arm-kinematics';
import { DEFAULT_ARM_GEOMETRY } from '../../packages/lab-runtime/src/v2/models/arm-collision';
import { readXArmFixture, XARM_FIXTURE_ID } from '../../packages/lab-runtime/src/v2/simulation3d/arm-cell-scene';
import { MUJOCO_ARM_RELEASE_TIMEOUT_TICKS, mujocoArmPorts, mujocoProgramSet } from '../../packages/lab-runtime/src/v2/simulation3d/mujoco-arm-ports';
import { MUJOCO_SLOT, type MujocoRuntimeOptions } from '../../packages/lab-runtime/src/v2/simulation3d/mujoco';
import { validateTwinSampleV2, type LabProjectV2 } from '../../packages/lab-runtime/src/v2/contracts';
import { projectSamples } from '../../packages/lab-runtime/src/v2/twin-projection';

const python = resolve('.venv-mujoco/bin/python'), workerRoot = resolve('robotics/simulation-mujoco'), double = resolve('tests/support/mujoco_doubles/fake_cell_plant.py');
const FX = join(workerRoot, 'fixtures', XARM_FIXTURE_ID), fixture = readXArmFixture(workerRoot), oracle = loadOracleProfile().profile.mujocoArm!;
const project = async () => JSON.parse(await readFile(join(FX, 'coffee-cell-project.json'), 'utf8')) as LabProjectV2;
const dirs: string[] = [], open: CoffeePlantPorts[] = [];
afterEach(async () => { for (const p of open.splice(0)) await p.close().catch(() => {}); for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });

const command = (id: string, program: 'cup-pick' | 'cup-place'): CellCommand => ({ runId: 'run-a', commandId: id, deviceId: 'arm-1', controlEpoch: 1, expiresAt: '2026-11-06T00:00:00Z', recipeRevision: 1,
  programRef: { id: program, hash: 'a'.repeat(64) }, payloadHash: 'a'.repeat(64), capability: 'start_job', payload: { jobId: 'j' } });
async function runtime(mode = 'ok', at = 0): Promise<MujocoRuntimeOptions> {
  return { python, workerRoot, schemaDir: resolve('packages/contracts/schemas'), lockDigest: await lockDigestOf(join(workerRoot, 'requirements.lock')), engineVersion: '3.17.0', maxActiveRuns: 1, entry: [double, mode, String(at)] };
}
async function ports(rt: MujocoRuntimeOptions, runId = 'run-a', proj?: LabProjectV2) {
  const directory = await mkdtemp(join(tmpdir(), 'mujoco-ports-')); dirs.push(directory);
  const st = { stationId: 'coffee-pickup', cellId: 'cell-1', armId: 'arm-1', registered: false, sessions: {}, workload: [{ cupId: 'cup-1' }, { cupId: 'cup-2' }], plant: MockCoffeePlant.initial('cell-1'),
    arm: MockArmPlant.initial('arm-1'), trays: {} } as unknown as CoffeeState;
  const ctx = { runId, nowMs: () => Date.parse('2026-11-05T00:00:00Z'), tick: () => 0, receiver: () => ({ robotId: 'amr-1', slot: 1 }) } as unknown as CoffeeContext;
  const p = await mujocoArmPorts(rt, { project: proj ?? await project(), seed: 42 })(st, ctx, () => 'boot-1', directory);
  open.push(p);
  return { p, st, directory, log: async () => (await readFile(join(directory, 'mujoco-arm', 'run', 'steps.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as Step) };
}
type Pose = { position: number[]; quaternionXyzw: number[] };
type Step = { n: number; targets: number[]; opening: number | null; placements: [string, Pose | null][] };
const state = (st: CoffeeState, id: string) => st.arm.programs.find((x) => x.commandId === id)?.state;
const advance = async (p: CoffeePlantPorts, k: number) => { for (let i = 0; i < k; i++) await p.advance(); };
const workers = (directory: string) => { try { return execFileSync('pgrep', ['-f', `fake_cell_plant.py.*${directory}`], { encoding: 'utf8' }).trim().split('\n').filter(Boolean); } catch { return []; } };

describe('mujocoProgramSet', () => {
  test('the fixture programs verbatim, contact from physics and the oracle, collision from the capsule radii, the cup and the scene\'s allowed contacts', () => {
    const set = mujocoProgramSet(fixture, oracle, [{ a: 'gripper', b: 'nozzle-stand' }, { a: 'held_prop', b: 'tray' }]);
    expect({ ...set, contact: undefined, collision: undefined }).toEqual({ ...fixture.programs, contact: undefined, collision: undefined });
    expect(set.contact).toEqual({ openM: 0.0889, closedM: 0, gripSettleTicks: oracle.gripSettleTicks, dropTicks: oracle.dropTicks, liftMinM: oracle.liftMinM, releaseTimeoutTicks: 200 });
    expect(MUJOCO_ARM_RELEASE_TIMEOUT_TICKS).toBe(200);
    expect(set.collision!.geometry).toMatchObject({ ...DEFAULT_ARM_GEOMETRY, provenance: 'assumed', linkRadiiM: fixture.physics.capsuleRadiusM, cupRadiusM: 0.04, cupHeightM: 0.1 });
    expect(set.collision!.allowedPairs).toEqual([['gripper', 'nozzle-stand'], ['held-cup', 'tray']]);
  });
  test('the held cup lies along the map vertical at the pick pose: the side grip\'s cup axis in the tool frame comes from the grasp frame', () => {
    const axis = mujocoProgramSet(fixture, oracle, []).collision!.geometry.cupAxisInTool!;
    for (const w of ['pick', 'lift']) {
      const tcp = forwardKinematics(XARM6_SI, fixture.programs.waypoints[w]!).tcp, up = qrotate(tcp.quaternionXyzw, axis);
      expect(Math.abs(up[2]!), w).toBeCloseTo(1, 6); expect(Math.hypot(up[0]!, up[1]!), w).toBeLessThan(1e-6);
    }
    expect(Math.abs(axis[2]!)).toBeLessThan(1e-9); // the tool approaches horizontally, so the cup is across the tool axis
  });
});

describe.skipIf(!existsSync(python))('mujocoArmPorts over a fake cell engine', () => {
  test('each advance sends exactly one step (the tick advances by one); a nozzle cup is placed once on the stand, a delivered cup is parked once', async () => {
    const { p, st, directory, log } = await ports(await runtime());
    expect(st.arm.plantId).toBe('mujoco_arm'); expect(st.arm.q).toEqual(fixture.programs.waypoints.home);
    const bundle = join(directory, 'mujoco-arm', 'bundle');
    expect(readdirSync(bundle).sort()).toEqual(['arm-cell-scene.json', 'blobs', 'component.json', 'physics.json']);
    for (const f of [...['arm-cell-scene.json', 'component.json', 'physics.json'], ...readdirSync(join(bundle, 'blobs')).map((b) => `blobs/${b}`)]) expect(lstatSync(join(bundle, f)).isFile(), f).toBe(true);
    const scene = JSON.parse(await readFile(join(bundle, 'arm-cell-scene.json'), 'utf8'));
    expect(scene.props.map((x: { propId: string }) => x.propId)).toEqual(['cup-1', 'cup-2']);
    p.coffeePlant!.placeCup('cup-1', 'paper');
    expect(p.mockArm!.execute(command('p1', 'cup-pick')).accepted).toBe(true);
    await advance(p, 30);
    let steps = await log();
    expect(steps.map((s) => s.n)).toEqual(Array.from({ length: 31 }, (_, i) => i + 1)); // the create's priming step, then exactly one per advance, none refused
    expect(st.arm.stop).toBeUndefined(); expect(state(st, 'p1')).toBe('running');
    expect(st.arm.tracking!.trace.map((t) => t.commandedRad)).toEqual(steps.slice(1).map((s) => s.targets)); // what was sent is what the arm commanded
    expect(steps.slice(1).every((s) => s.opening === 0.0889)).toBe(true);
    const placed = steps.flatMap((s) => s.placements.filter(([id]) => id === 'cup-1').map(([, pose]) => ({ n: s.n, pose })));
    expect(placed).toHaveLength(1); expect(placed[0]!.n).toBe(2);
    const L = fixture.layout, base = (await project()).armCollisionProfile!.baseInMap;
    const on = composePose(base, { position: [L.nozzleStand.centerM[0], L.nozzleStand.centerM[1], L.nozzleStand.centerM[2] + L.nozzleStand.sizeM[2] / 2 + L.cup.heightM / 2 + 0.001], quaternionXyzw: [0, 0, 0, 1] });
    placed[0]!.pose!.position.forEach((v, i) => expect(v).toBeCloseTo(on.position[i]!, 12)); expect(placed[0]!.pose!.quaternionXyzw).toEqual([...base.quaternionXyzw]);
    // what the arm saw: the cup in its base frame, with the map pose kept beside it; the measured opening
    const seen = st.arm.props!.find((x) => x.propId === 'cup-1')!;
    seen.position.forEach((v, i) => expect(v).toBeCloseTo([L.nozzleStand.centerM[0], L.nozzleStand.centerM[1], 0.151][i]!, 9));
    expect(seen.inMap!.positionM).toEqual(placed[0]!.pose!.position); expect(st.arm.gripperOpeningM).toBe(0.0889);
    // telemetry: the arm sample names the plant and the measured opening; the cup is a map-frame sample owned by the cell while it stands under the nozzle
    const samples = projectSamples({ runId: '6f1c7a52-3d0e-4b8a-9c1d-2e5f7a8b9c0d', seq: '1', simTimeNs: '0', nowMs: 0, robots: [], coffee: st }, '1');
    for (const x of samples) expect(validateTwinSampleV2(x).ok, x.entityId).toBe(true);
    expect(samples.find((x) => x.entityId === 'arm-1')).toMatchObject({ providerId: 'mujoco_arm', origin: 'physics_sim', frameId: 'arm_base', observed: { gripperOpeningM: 0.0889 } });
    expect(samples.find((x) => x.entityId === 'cup-1')).toMatchObject({ providerId: 'mujoco_arm', origin: 'physics_sim', frameId: 'map', commanded: null,
      observed: { ownerKind: 'cell', ownerId: 'cell-1', positionM: placed[0]!.pose!.position, quaternionXyzw: [...base.quaternionXyzw], restingOn: null } });
    // the cup leaves the nozzle and is delivered: it is parked exactly once
    st.plant.cups.find((c) => c.cupId === 'cup-1')!.at = 'taken'; st.trays['amr-1'] = 'cup-1';
    await advance(p, 10);
    steps = await log();
    const parked = steps.flatMap((s) => s.placements.filter(([id, pose]) => id === 'cup-1' && pose === null));
    expect(parked).toHaveLength(1); expect(steps).toHaveLength(41);
    expect(steps.flatMap((s) => s.placements)).toHaveLength(2);
    expect(p.report().armPlant).toMatchObject({ engine: 'mujoco_3d', engineVersion: '3.17.0', control: 'position_actuator', grip: 'contact', dynamics: 'manufacturer_nominal+assumed', calibration: 'not_calibrated' });
    expect(p.report().armPlant!.tracking.samples).toBe(40);
  }, 60_000);

  test('a refused placement (PROP_PLACEMENT_OCCUPIED) latches the arm, the program is unknown, and every later step holds the arm and the gripper command', async () => {
    const { p, st, log } = await ports(await runtime());
    p.coffeePlant!.placeCup('cup-1', 'paper');
    p.mockArm!.execute(command('p1', 'cup-pick'));
    await advance(p, 20);
    p.coffeePlant!.placeCup('cup-2', 'paper'); // a second cup under the nozzle while the first still stands there
    await p.advance();
    expect(st.arm.stop).toMatchObject({ latched: true, reason: 'PROP_PLACEMENT_OCCUPIED' }); expect(state(st, 'p1')).toBe('unknown');
    const hold = [...st.arm.commandedQ!], before = (await log()).length;
    expect(before).toBe(21); // the refused step never reached the engine
    await advance(p, 15);
    const after = (await log()).slice(before);
    expect(after).toHaveLength(15); // the tick stayed consistent: the next steps are accepted
    for (const s of after) { expect(s.targets).toEqual(hold); expect(s.opening).toBe(0.0889); expect(s.placements).toEqual([]); }
  }, 60_000);

  test('a cup the scene does not know at the nozzle halts the arm as PROP_UNKNOWN; it is never sent', async () => {
    const { p, st, log } = await ports(await runtime());
    p.mockArm!.execute(command('p1', 'cup-pick'));
    await advance(p, 5);
    p.coffeePlant!.placeCup('cup-9', 'paper');
    await advance(p, 5);
    expect(st.arm.stop).toMatchObject({ latched: true, reason: 'PROP_UNKNOWN' }); expect(state(st, 'p1')).toBe('unknown');
    const steps = await log();
    expect(steps).toHaveLength(11); expect(steps.flatMap((s) => s.placements)).toEqual([]);
  }, 60_000);

  test('a worker lost mid-program leaves the program unknown and the arm latched; nothing is resent and no worker is started in its place', async () => {
    const { p, st, directory, log } = await ports(await runtime('quit', 12));
    const reports: CellReport[] = []; p.adapters[1]!.observe((r) => reports.push(r));
    p.mockArm!.execute(command('p1', 'cup-pick'));
    await advance(p, 20);
    expect(state(st, 'p1')).toBe('unknown'); expect(st.arm.stop).toMatchObject({ latched: true, reason: 'WORKER_LOST' });
    expect(reports.some((r) => r.observation?.result === 'outcome_unknown')).toBe(true);
    expect(await log()).toHaveLength(12);
    await advance(p, 10);
    expect(await log()).toHaveLength(12); expect(workers(directory)).toEqual([]);
  }, 60_000);

  test('close ends the worker and gives the slot back; the host has one MuJoCo slot', async () => {
    const rt = await runtime();
    expect(activeRunCount(MUJOCO_SLOT)).toBe(0);
    const first = await ports(rt, 'run-a');
    expect(activeRunCount(MUJOCO_SLOT)).toBe(1); expect(workers(first.directory)).toHaveLength(1);
    await expect(ports(rt, 'run-b')).rejects.toThrow('MUJOCO_CAPACITY');
    await first.p.close();
    expect(activeRunCount(MUJOCO_SLOT)).toBe(0); expect(workers(first.directory)).toEqual([]);
    expect((await ports(rt, 'run-b')).p).toBeDefined();
  }, 60_000);

  test('a failed create or a project without a cell scene gives the slot back, with the code, and leaves no worker', async () => {
    await expect(ports(await runtime('badcreate'))).rejects.toThrow('MUJOCO_ARM_CREATE_FAILED: MESH_BLOB_MISSING');
    expect(activeRunCount(MUJOCO_SLOT)).toBe(0); expect(workers(dirs.at(-1)!)).toEqual([]);
    const bad = await project(); delete (bad as { armCollisionProfile?: unknown }).armCollisionProfile;
    await expect(ports(await runtime(), 'run-a', bad)).rejects.toThrow('ARM_SCENE_UNAVAILABLE');
    expect(activeRunCount(MUJOCO_SLOT)).toBe(0);
  }, 60_000);
});
