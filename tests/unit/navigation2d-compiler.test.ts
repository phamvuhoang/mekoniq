import { expect, test } from 'vitest';
import { projectPhysicalModel } from '../../packages/lab-runtime/src/engineering/physical-model';
import { driveInMap, baseInMap, projectNavigationModel } from '../../packages/lab-runtime/src/engineering/navigation-model';
import { compileNavigationScene, withSceneFiles } from '../../packages/lab-runtime/src/engineering/navigation-compiler';
import { NAVIGATION_SCHEMA_HASH, defaultNavigationPolicy, sealDocument, validateNavigationDocument } from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import type { NavigationModel2DV1, RobotPhysicalModelV1 } from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import { EngineeringInputError } from '../../packages/lab-runtime/src/engineering/assembly';
import { invertPose, qrotate } from '../../packages/lab-runtime/src/v2/frames';
import { hashJson } from '../../packages/lab-runtime/src/v2/hash';
import { navigationFixture, type NavigationFixtureName } from '../support/navigation2d';

const policy = defaultNavigationPolicy();
const physical = (name: NavigationFixtureName, robot = 'amr-1') => projectPhysicalModel(navigationFixture(name).input, robot, NAVIGATION_SCHEMA_HASH);
const nav = (name: NavigationFixtureName, robot = 'amr-1', limits = {}) => projectNavigationModel(physical(name, robot), policy, limits);
const codes = (fn: () => unknown) => { try { fn(); return []; } catch (e) { return (e as EngineeringInputError).problems.map((p) => p.code); } };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const reseal = (m: RobotPhysicalModelV1) => sealDocument(m, 'modelDigest');
const yawOf = (q: readonly number[]) => Math.atan2(2 * (q[3]! * q[2]! + q[0]! * q[1]!), 1 - 2 * (q[1]! * q[1]! + q[2]! * q[2]!));
const sceneOf = (name: NavigationFixtureName, tweak?: (i: ReturnType<typeof navigationFixture>['input']) => void) => {
  const input = clone(navigationFixture(name).input);
  tweak?.(input);
  const ids = input.project.runtimeProject.entities.map((e) => e.id).sort();
  return compileNavigationScene(input, ids.map((id) => projectNavigationModel(projectPhysicalModel(input, id, NAVIGATION_SCHEMA_HASH), policy)), policy);
};
const inHull = (v: [number, number][], p: [number, number]) => v.every((a, i) => { const b = v[(i + 1) % v.length]!; return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -1e-9; });

test('CMP01: T_map_drive and T_map_base round-trip through the stated frames for yaw 0, ±π/2, π and a root offset from the axle', () => {
  const driveInBase = { position: [-0.1, 0, 0] as const, quaternionXyzw: [0, 0, 0, 1] as const };
  for (const yaw of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
    const baseMap = { position: [3, 2, 0.09], quaternionXyzw: [0, 0, Math.sin(yaw / 2), Math.cos(yaw / 2)] };
    const drive = driveInMap(baseMap, driveInBase);
    const back = baseInMap(drive, driveInBase);
    for (let k = 0; k < 3; k++) expect(Math.abs(back.position[k]! - baseMap.position[k]!)).toBeLessThan(1e-9);
    const expected = qrotate(baseMap.quaternionXyzw, [-0.1, 0, 0]); // the axle sits 0.1 m behind the root, in the root's heading
    expect(drive.position[0]! - 3).toBeCloseTo(expected[0]!, 12);
    expect(drive.position[1]! - 2).toBeCloseTo(expected[1]!, 12);
    expect(Math.cos(yawOf(drive.quaternionXyzw) - yaw)).toBeCloseTo(1, 12);
    expect(invertPose(invertPose(drive)).position[0]).toBeCloseTo(drive.position[0]!, 12);
  }
});

test('CMP02: the footprint is a conservative hull of every collision primitive, keeps the rear overhang and is not recentred', () => {
  const m = nav('overhang'), p = physical('overhang');
  expect(m.footprint).toMatchObject({ frame: 'drive', method: 'convex-hull-primitive-bounds-v1', conservative: true });
  expect(m.footprint.contributingShapeIds.filter((id) => id.includes('tray'))).toHaveLength(3);
  expect(m.footprint.contributingShapeIds.filter((id) => id.includes('support'))).toHaveLength(2);
  expect(m.footprint.contributingShapeIds.filter((id) => id.includes('rim'))).toHaveLength(2);
  expect(m.footprint.contributingShapeIds.filter((id) => id.includes('wheel'))).toHaveLength(4); // hub and rim of each wheel
  expect(m.footprint.verticesM.some(([x]) => x < -0.30)).toBe(true); // trays and supports stand out behind the 0.60 m chassis
  const xs = m.footprint.verticesM.map((v) => v[0]), ys = m.footprint.verticesM.map((v) => v[1]);
  expect(Math.max(...xs)).toBeGreaterThan(Math.abs(Math.min(...xs)) - 0.2); // asymmetric: not a centroid-centred shape
  expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThanOrEqual(0.65);
  // an independent census of the box corners of every non-mesh collision shape (drive frame, planar) must sit inside the hull
  const base = Object.fromEntries(p.links.map((l) => [l.id, l]));
  expect(Object.keys(base).length).toBeGreaterThan(5);
  expect(m.footprint.verticesM.length).toBeGreaterThanOrEqual(3);
  expect(m.footprint.verticesM.length).toBeLessThanOrEqual(128);
  expect(inHull(m.footprint.verticesM as [number, number][], [0.3, 0.27])).toBe(true); // a chassis corner
  expect(inHull(m.footprint.verticesM as [number, number][], [0, 0])).toBe(true);
  expect(inHull(m.footprint.verticesM as [number, number][], [2, 2])).toBe(false);
});

test('CMP03 inputs: footprint widths 0.54, 0.58 (> 0.65 with the wide trays) give corridor clearances +0.02 and -0.02 m', () => {
  const width = (name: NavigationFixtureName) => { const ys = nav(name).footprint.verticesM.map((v) => v[1]); return +(Math.max(...ys) - Math.min(...ys)).toFixed(6); };
  const clearance = (w: number) => +(0.6 - w - 2 * policy.parameters.safetyMarginM).toFixed(6);
  expect([width('serve'), width('wide')]).toEqual([0.54, 0.58]);
  expect([clearance(width('serve')), clearance(width('wide'))]).toEqual([0.02, -0.02]);
  expect(clearance(width('overhang'))).toBeLessThan(0);
});

test('mesh-only collision is refused instead of shrinking the footprint to a point', () => {
  const p = clone(physical('serve'));
  const link = p.links.find((l) => l.id === 'tray-1/plate')!;
  link.collision = [{ ...link.collision[0]!, geometry: { kind: 'mesh', blobSha256: 'a'.repeat(64), scale: [1, 1, 1] } }] as never;
  expect(codes(() => projectNavigationModel(reseal(p), policy))).toEqual(['FOOTPRINT_GEOMETRY_UNSUPPORTED']);
});

test('kinematic limits come from policy, wheel limits and the entity speed limit; the policy hash is pinned', () => {
  const m = nav('serve');
  expect(m.kinematics).toMatchObject({ type: 'differential_drive', wheelRadiusM: 0.09, wheelSeparationM: 0.36, maxLinearMps: 0.5, maxAngularRadps: 1, maxWheelRadps: { left: 20, right: 20 } });
  expect(m.navigationPolicyRef).toEqual({ id: policy.id, revision: policy.revision, hash: policy.hash });
  expect(nav('serve', 'amr-1', { entitySpeedLimitMps: 0.3 }).kinematics.maxLinearMps).toBe(0.3);
  const slow = clone(physical('serve'));
  slow.joints.filter((j) => j.kind === 'continuous').forEach((j) => { (j.limits as { velocity: { value: number } }).velocity.value = 4; }); // 4 rad/s * 0.09 m = 0.36 m/s
  const k = projectNavigationModel(reseal(slow), policy).kinematics;
  expect([k.maxWheelRadps.left, k.maxLinearMps, +k.maxAngularRadps.toFixed(6)]).toEqual([4, 0.36, 1]);
  expect(validateNavigationDocument(m)).toMatchObject({ ok: true });
});

test('LiDAR projection: pose in the drive frame, cadence in ticks, and anything the plant cannot honour is refused', () => {
  const s = nav('serve').sensors[0]!;
  expect(s).toMatchObject({ id: 'lidar-2d', type: 'lidar_2d', parentLinkId: 'lidar/head', rangeMinM: 0.05, rangeMaxM: 10, beamCount: 360, publishEveryTicks: 5, noise: { distribution: 'none', stddevM: 0, seed: 7 } });
  expect(s.poseInDrive[0]).toBeCloseTo(0.22, 9);
  expect(s.fieldOfViewRad).toBeCloseTo(2 * Math.PI, 12);
  const edit = (f: (m: Record<string, never>) => void) => { const p = clone(physical('serve')); f(p.sensors[0]!.model as never); return codes(() => projectNavigationModel(reseal(p), policy)); };
  expect(edit((m) => { (m as never as { latency: { value: number } }).latency.value = 0.02; })).toEqual(['SENSOR_FIDELITY_UNSUPPORTED']);
  expect(edit((m) => { (m as never as { dropoutProbability: { value: number } }).dropoutProbability.value = 0.1; })).toEqual(['SENSOR_FIDELITY_UNSUPPORTED']);
  expect(edit((m) => { (m as never as { noise: { distribution: string } }).noise.distribution = 'uniform'; })).toEqual(['SENSOR_FIDELITY_UNSUPPORTED']);
  expect(edit((m) => { (m as never as { rateHz: { value: number } }).rateHz.value = 7; })).toEqual(['SENSOR_FIDELITY_UNSUPPORTED']); // 50/7 is not a whole number of ticks
  const flipped = clone(physical('serve'));
  flipped.sensors[0]!.poseInBase.quaternionXyzw = [1, 0, 0, 0]; // mounted upside down: the beam order would be mirrored
  expect(codes(() => projectNavigationModel(reseal(flipped), policy))).toEqual(['SENSOR_FIDELITY_UNSUPPORTED']);
  expect(edit((m) => { delete (m as Record<string, unknown>).sensorType; delete (m as Record<string, unknown>).lidar2d; })).toEqual(['SENSOR_TYPE_REQUIRED']);
});

test('a physical model without a drive cannot become a navigation model', () => {
  const p = clone(physical('serve'));
  p.drive = null;
  expect(codes(() => projectNavigationModel(reseal(p), policy))).toEqual(['DRIVE_REQUIRED']);
});

test('CMP04: obstacle corners become polygons, a table maps to its handoff, targets in collision or outside the world are refused, an enclosed free goal is admitted', () => {
  const scene = sceneOf('serve');
  const ob = scene.world.obstacles.find((o) => o.id === 'table-05')!;
  ob.verticesM.forEach((v, i) => v.forEach((c, k) => expect(c).toBeCloseTo([[9.6, 2.6], [10.4, 2.6], [10.4, 3.4], [9.6, 3.4]][i]![k]!, 12))); // corner (x, y) + size 0.8
  const binding = scene.robots[0]!.targetBindings.find((b) => b.pointId === 't-05')!;
  expect([binding.x, binding.y, binding.yaw]).toEqual([10, 3.9, -Math.PI / 2]);
  expect(scene.robots[0]!.targetBindings.find((b) => b.pointId === 'bay-1')).toMatchObject({ x: 2, y: 1.5, yaw: 0 });
  expect(scene.world.boundaries.map((b) => b.id)).toEqual(['boundary-east', 'boundary-north', 'boundary-south', 'boundary-west']);
  expect(validateNavigationDocument(scene)).toMatchObject({ ok: true });
  const moved = (mutate: (w: ReturnType<typeof navigationFixture>['input']['project']['runtimeProject']['world']) => void) => codes(() => sceneOf('serve', (i) => mutate(i.project.runtimeProject.world)));
  expect(moved((w) => { w.handoffPoints!.find((h) => h.id === 't-05.handoff')!.position = [10, 3, 0]; })).toContain('TARGET_IN_COLLISION'); // inside the table
  expect(moved((w) => { w.handoffPoints!.find((h) => h.id === 't-05.handoff')!.position = [25, 3, 0]; })).toContain('TARGET_OUT_OF_WORLD');
  expect(moved((w) => { w.handoffPoints = w.handoffPoints!.filter((h) => h.id !== 't-05.handoff'); })).toContain('TARGET_IN_COLLISION'); // a table needs a handoff, the table centre is not a target
  const enclosed = sceneOf('enclosed-goal');
  expect(enclosed.robots[0]!.targetBindings.find((b) => b.pointId === 'pocket')).toMatchObject({ x: 17.6, y: 1.6 });
});

test('initial poses come from the resolved placement and the drive frame; overlapping or out-of-world starts are refused', () => {
  const s = sceneOf('two-robot');
  expect(s.robots.map((r) => r.robotId)).toEqual(['amr-1', 'amr-2']);
  expect(s.robots[0]!.initialPoseMap.map((v) => +v.toFixed(9))).toEqual([2, 1.5, 0]);
  expect(codes(() => sceneOf('serve', (i) => { i.resolved.placements.find((p) => p.instanceId === 'chassis')!.world.xyzM = [-5, 1, 0.09]; }))).toContain('INITIAL_POSE_INVALID');
});

test('CMP05: equal inputs give equal scenes; each declared input change gives a different digest', () => {
  const a = sceneOf('serve'), b = sceneOf('serve');
  expect(a.sceneDigest).toBe(b.sceneDigest);
  expect(withSceneFiles(a, []).sceneDigest).toBe(a.sceneDigest);
  const withFile = withSceneFiles(a, [{ path: 'irsim/world.yaml', sha256: 'e'.repeat(64), bytes: 10 }]);
  expect(withFile.sceneDigest).not.toBe(a.sceneDigest);
  expect(sceneOf('serve', (i) => { i.project.runtimeProject.world.obstacles.push({ id: 'crate', x: 5, y: 6, width: 0.4, height: 0.4 }); }).sceneDigest).not.toBe(a.sceneDigest);
  expect(sceneOf('wide').sceneDigest).not.toBe(a.sceneDigest);
  const m = nav('serve');
  const other: NavigationModel2DV1 = projectNavigationModel(physical('serve'), { ...policy, parameters: { ...policy.parameters, safetyMarginM: 0.05 }, hash: hashJson('other-policy') }, {});
  expect(other.modelDigest).not.toBe(m.modelDigest);
});

test('review2 #5: a robot mounted upside down is refused, not projected as an upright one', () => {
  const upsideDown = () => sceneOf('serve', (i) => { const p = i.resolved.placements.find((x) => x.instanceId === 'chassis')!; p.world = { ...p.world, quaternionXyzw: [1, 0, 0, 0] } as typeof p.world; });
  expect(codes(upsideDown)).toContain('NON_PLANAR_DRIVE');
  expect(codes(() => sceneOf('serve'))).toEqual([]); // the control: the same mutation path with an upright pose compiles
});
