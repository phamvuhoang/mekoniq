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
