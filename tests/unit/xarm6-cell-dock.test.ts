// M06b: the xArm coffee cell as declared is ARM03-clean with a robot docked at coffee_pickup. The world is built as a scenario run builds it (declareArmScene + materializeArmScene with the
// robot at the pickup point) plus the cell's supports and the program set's collision block exactly as mujocoArmPorts uses them; the path is the fixture programs' commanded quintic path.
// No engine: this runs everywhere.
import { expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { quinticSegment } from '../../packages/cell-adapters/src/arm-motion';
import { MOCK_ARM_PARAMS } from '../../packages/cell-adapters/src/mock-arm';
import { compileAsset } from '../../packages/lab-runtime/src/v2/assets';
import { loadOracleProfile } from '../../packages/lab-runtime/src/v2/algorithm/checker';
import type { LabProjectV2 } from '../../packages/lab-runtime/src/v2/contracts';
import { checkArmSweep, type SweepResult } from '../../packages/lab-runtime/src/v2/models/arm-collision';
import { XARM6_SI } from '../../packages/lab-runtime/src/v2/models/arm-kinematics';
import { composePose, type Pose, type Quat, type Vec3 } from '../../packages/lab-runtime/src/v2/frames';
import { declareArmScene, materializeArmScene } from '../../packages/lab-runtime/src/v2/models/arm-scene';
import { buildArmCellScene, readXArmFixture, XARM_FIXTURE_ID } from '../../packages/lab-runtime/src/v2/simulation3d/arm-cell-scene';
import { cellSupports, mujocoProgramSet } from '../../packages/lab-runtime/src/v2/simulation3d/mujoco-arm-ports';
import { amrAsset } from '../support/lab-v2';

const workerRoot = resolve('robotics/simulation-mujoco'), fixture = readXArmFixture(workerRoot);
const project = async () => JSON.parse(await readFile(join(workerRoot, 'fixtures', XARM_FIXTURE_ID, 'coffee-cell-project.json'), 'utf8')) as LabProjectV2;
// The project's robot is the Lab's service-robot-asset@1 (bf15015a…, lab/fixtures/twins/coffee-cell-v2.json); compiled, its collision radius is 0.40697051490249264 m, the same as this
// support asset's (the scenario runner's radius is compileAsset(asset).collision.radiusM).
const RADIUS = compileAsset(amrAsset).collision.radiusM;

/** Every interval of cup-pick then cup-place as the state machine commands it (quintic-sync-v1 segments), the cup held from the grip step to the release step. */
function sweep(p: LabProjectV2): { from: string; to: string; k: number; r: SweepResult }[] {
  const scene = buildArmCellScene(p, fixture, 1, { armId: 'arm-1', propIds: ['cup-1'] }), set = mujocoProgramSet(fixture, loadOracleProfile().profile.mujocoArm!, scene.allowedContacts);
  const pickup = p.world.points.find((x) => x.kind === 'coffee_pickup')!, robot = { id: 'amr-1', radiusM: RADIUS, pose: { x: pickup.x, y: pickup.y, yawRad: 0 } };
  const docked = materializeArmScene(declareArmScene(p, { 'amr-1': RADIUS }, ['amr-1'], XARM6_SI), [robot], 0);
  expect(docked.available).toBe(true);
  const world = [...docked.world, ...cellSupports(fixture.layout)], W = set.waypoints, m = set.motion as { maxAccelerationRadS2: number[]; speedFraction: number };
  const lim = { maxVelocity: XARM6_SI.limits.map((l) => l.maxVelocity), maxAcceleration: m.maxAccelerationRadS2, speedFraction: m.speedFraction, dtS: MOCK_ARM_PARAMS.dtS };
  const legs: [string, string, boolean][] = [['home', 'pickApproach', false], ['pickApproach', 'pick', false], ['pick', 'pick', true], ['pick', 'lift', true], ['lift', 'placeApproach', true],
    ['placeApproach', 'place', true], ['place', 'place', true], ['place', 'home', false]];
  const out: { from: string; to: string; k: number; r: SweepResult }[] = [];
  for (const [a, b, held] of legs) {
    const seg = quinticSegment(W[a]!, W[b]!, lim);
    for (let k = 1; k <= seg.ticks; k++) out.push({ from: a, to: b, k, r: checkArmSweep(XARM6_SI, seg.at(k - 1), seg.at(k), { world, heldCup: held, ...set.collision! }) });
  }
  return out;
}

test('the robot radius is the project robot asset\'s', () => expect(RADIUS).toBe(0.40697051490249264));

test('with a robot docked at coffee_pickup, every interval of the commanded cup-pick and cup-place is ARM03-clean in the declared cell', async () => {
  const p = await project(), runs = sweep(p);
  expect(runs.length).toBeGreaterThan(200);
  expect(runs.filter((x) => !x.r.ok).map((x) => [x.from, x.to, x.k, x.r.pair, x.r.clearanceM])).toEqual([]);
  expect(runs.some((x) => x.r.allowed?.inContact.length)).toBe(true); // the held cup does reach the stand and the tray, through the allowed pairs only
});

test('negative control: an AMR body as high as the arm base plane (robotHeightM 0.7) is a link-1 collision with the docked robot', async () => {
  const p = await project(); p.armCollisionProfile!.robotHeightM = 0.7;
  const bad = sweep(p).filter((x) => !x.r.ok);
  expect(bad.length).toBeGreaterThan(0); expect(bad[0]!.r).toMatchObject({ reason: 'COLLISION', pair: ['link-1', 'robot:amr-1'] });
});

test('the gripper palm beside the TCP cannot pass through a tall AMR body', async () => {
  const p = await project(); p.armCollisionProfile!.robotHeightM = 0.9; p.world.obstacles = [];
  const scene = buildArmCellScene(p, fixture, 1, { armId: 'arm-1', propIds: ['cup-1'] });
  const robot = { id: 'amr-1', radiusM: RADIUS, pose: { x: 3.4469705149024925, y: 1.1019705149024928, yawRad: 0 } };
  const declared = materializeArmScene(declareArmScene(p, { 'amr-1': RADIUS }, ['amr-1'], XARM6_SI), [robot], 0);
  expect(declared.available).toBe(true);
  const set = mujocoProgramSet(fixture, loadOracleProfile().profile.mujocoArm!, scene.allowedContacts), pick = set.waypoints.pick!;
  const result = checkArmSweep(XARM6_SI, pick, pick, { world: [...declared.world, ...cellSupports(fixture.layout)], ...set.collision! });
  expect(result).toMatchObject({ ok: false, reason: 'COLLISION', pair: ['gripper', 'robot:amr-1'] });
});

test('the proxy encloses the fixture palm and both moving pads from open to closed', () => {
  const geometry = mujocoProgramSet(fixture, loadOracleProfile().profile.mujocoArm!, []).collision!.geometry!;
  const { joints } = JSON.parse(fixture.componentText) as { joints: { id: string; parent: string; child: string; kind: string; axis: Vec3; origin: { xyzM: Vec3; quaternionXyzw: Quat } }[] };
  const identity: Pose = { position: [0, 0, 0], quaternionXyzw: [0, 0, 0, 1] };
  function pose(link: string, drive: number): Pose {
    if (link === 'link6') return identity;
    const joint = joints.find(j => j.child === link)!;
    const ratio = joint.id === fixture.physics.gripper.driveJoint ? 1 : fixture.physics.gripper.mimic.find(m => m.joint === joint.id)?.multiplier ?? 0;
    const angle = drive * ratio / 2, rotation: Quat = [...joint.axis.map(v => v * Math.sin(angle)), Math.cos(angle)] as Quat;
    return composePose(composePose(pose(joint.parent, drive), { position: joint.origin.xyzM, quaternionXyzw: joint.origin.quaternionXyzw }), { ...identity, quaternionXyzw: rotation });
  }
  // Transform the independently declared plant boxes through the component's revolute joints, rather than reconstructing them from the proxy.
  for (let step = 0; step <= 100; step++) for (const box of [fixture.physics.palm, ...fixture.physics.pads]) {
    const transform = pose(box.link, fixture.physics.gripper.closedRad * step / 100);
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      const corner = composePose(transform, { ...identity, position: box.centerM.map((v, i) => v + [x, y, z][i]! * box.sizeM[i]! / 2) as Vec3 }).position;
      const axisStart = XARM6_SI.toolM[2] - geometry.gripperBackM!, axisEnd = XARM6_SI.toolM[2] + geometry.gripperLengthM;
      const distance = Math.hypot(corner[0], corner[1], Math.max(axisStart - corner[2], 0, corner[2] - axisEnd));
      expect(distance, `${box.link} at gripper step ${step}`).toBeLessThanOrEqual(geometry.gripperRadiusM + 1e-12);
    }
  }
});
