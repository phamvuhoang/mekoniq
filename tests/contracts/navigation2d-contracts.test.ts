import { expect, test } from 'vitest';
import { defaultNavigationPolicy, documentDigest, polygonIssues, sealDocument, validateNavigationDocument } from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import type { ModelValidationReportV1, NavigationModel2DV1, NavigationSceneV1, RobotPhysicalModelV1 } from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import { prepareEngineeringCompileInput, resolveAssembly } from '../../packages/lab-runtime/src/engineering/assembly';
import { projectPhysicalModel } from '../../packages/lab-runtime/src/engineering/physical-model';
import { validateEngineeringProject, validateResolvedAssembly, validateSensorModel } from '../../packages/lab-runtime/src/engineering/contracts';
import { engineeringFixture, makeLidarModel } from '../support/engineering';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const H = (c: string) => c.repeat(64);
const policy = defaultNavigationPolicy();
const inputs = { project: { id: 'p', revision: 1, digest: H('1') }, assemblyDigest: H('2'), world: { id: 'w', revision: 1, hash: H('3') } };
const pose = { xyzM: [0, 0, 0] as [number, number, number], quaternionXyzw: [0, 0, 0, 1] as [number, number, number, number] };
const model = (over: Partial<NavigationModel2DV1> = {}): NavigationModel2DV1 => sealDocument({
  schemaVersion: 1, documentType: 'navigation-model-2d', modelDigest: '', inputs, robotId: 'amr-1', physicalModelDigest: H('5'), baseFrameId: 'r/base', driveFrameInBase: pose,
  kinematics: { type: 'differential_drive', wheelRadiusM: 0.09, wheelSeparationM: 0.36, maxLinearMps: 0.5, maxAngularRadps: 1, maxWheelRadps: { left: 5, right: 5 } },
  footprint: { frame: 'drive', verticesM: [[-0.3, -0.27], [0.4, -0.27], [0.4, 0.27], [-0.3, 0.27]], method: 'convex-hull-primitive-bounds-v1', contributingShapeIds: ['r:base:c0'], conservative: true },
  navigationPolicyRef: { id: policy.id, revision: policy.revision, hash: policy.hash },
  sensors: [{ id: 'lidar', type: 'lidar_2d', sourceModelDigest: H('6'), parentLinkId: 'r/base', poseInDrive: [0.1, 0, 0], heightM: 0.2, rangeMinM: 0.05, rangeMaxM: 10, fieldOfViewRad: 2 * Math.PI, beamCount: 360, publishEveryTicks: 5, noise: { distribution: 'none', stddevM: 0, seed: 7 } }],
  limitations: ['planar'], ...over,
}, 'modelDigest');
const scene = (over: Partial<NavigationSceneV1> = {}): NavigationSceneV1 => sealDocument({
  schemaVersion: 1, documentType: 'navigation-scene', sceneDigest: '', inputs, compilerVersion: 'test', schemaHash: H('7'),
  robots: [{ robotId: 'amr-1', model: model(), initialPoseMap: [1, 1, 0], targetBindings: [] }],
  world: { id: 'w', revision: 1, hash: H('3'), widthM: 8, heightM: 6, obstacles: [{ id: 'o1', verticesM: [[3, 2], [4, 2], [4, 3], [3, 3]] }], boundaries: [] },
  actors: [], zones: [], clock: { tickMs: 20 }, engine: { id: 'irsim_2d', version: '2.12.0', collisionMode: 'stop' }, policy, files: [], limitations: [], ...over,
}, 'sceneDigest');
const report = (over: Partial<ModelValidationReportV1> = {}): ModelValidationReportV1 => sealDocument({
  schemaVersion: 1, documentType: 'model-validation-report', reportDigest: '', physicalModelDigest: H('5'), assemblyDigest: H('2'), robotId: 'amr-1', execution: 'ran', result: 'pass', mode: 'shadow',
  engine: { package: 'linkforge-core', packageVersion: '1.6.0', pythonVersion: '3.11.15', lockDigest: H('8'), adapterVersion: '1', policyVersion: '1' },
  checks: [{ id: 'LF-PARITY', source: 'parity', result: 'pass', coverageScope: 'links,joints' }], issues: [], nameMapRef: null, inputUrdfRef: null, referenceUrdfRef: null, referenceSrdfRef: null, assumptions: [], limitations: [], ...over,
}, 'reportDigest');
const codes = (v: unknown) => { const r = validateNavigationDocument(v); return r.ok ? [] : r.issues.map((i) => i.code); };
const physical = () => {
  const f = clone(engineeringFixture('two-amr'));
  const r = resolveAssembly(f.project, f.components, { models: f.models as never });
  return projectPhysicalModel(prepareEngineeringCompileInput(f.project, r.resolved!, []), 'amr-1', H('a'));
};
const reseal = (m: RobotPhysicalModelV1) => sealDocument(m, 'modelDigest');

test('well-formed documents validate and carry the policy server-owned defaults', () => {
  for (const doc of [model(), scene(), report(), physical()]) { const r = validateNavigationDocument(doc); expect(r.ok ? [] : r.issues, doc.documentType).toEqual([]); }
  expect(policy.parameters).toMatchObject({ safetyMarginM: 0.02, controller: 'grid-diff-v1', headingCount: 8, scanFreshnessTicks: 5, goalDeadlineTicks: 6000 });
  expect(documentDigest(policy, 'hash')).toBe(policy.hash);
});

test('digest, unknown fields and unknown document types are refused', () => {
  expect(codes({ ...model(), robotId: 'amr-2' })).toContain('DIGEST_MISMATCH');
  expect(codes({ ...model(), operator: 'admin' })).toContain('UNKNOWN_FIELD');
  expect(codes({ documentType: 'nope' })).toEqual(['DOCUMENT_TYPE_UNKNOWN']);
  expect(codes(null)).toEqual(['DOCUMENT_TYPE_UNKNOWN']);
});

test('non-finite numbers, unit drift and non-normalised quaternions fail before anything runs', () => {
  expect(codes(model({ kinematics: { ...model().kinematics, wheelRadiusM: Number.NaN } }))).toContain('INVALID_FIELD');
  const p = clone(physical());
  p.drive!.wheelRadiusM.unit = 'mm';
  expect(codes(reseal(p))).toContain('UNIT_NOT_ALLOWED');
  const q = clone(physical());
  q.drive!.driveFrameInBase.quaternionXyzw = [0, 0, 0, 2];
  expect(codes(reseal(q))).toContain('QUATERNION_NOT_NORMALIZED');
});

test('a reversed inertia order is a non-physical tensor, not a different convention', () => {
  const p = clone(physical());
  const link = p.links.find((l) => l.id === 'r1-chassis/base')!;
  const [ixx, ixy, ixz, iyy, iyz, izz] = link.inertiaKgM2!;
  link.inertiaKgM2 = [ixx, iyy, izz, ixy, ixz, iyz]; // ixx,iyy,izz first, the order other tools use
  expect(codes(reseal(p))).toContain('INERTIA_INVALID');
});

test('provenance is mandatory: a LiDAR beam count without its source, or a scalar without one, is refused', () => {
  const lidar = clone(makeLidarModel()) as Record<string, unknown>;
  delete (lidar.lidar2d as Record<string, unknown>).beamCountSource;
  expect(validateSensorModel(lidar).ok).toBe(false);
  const p = clone(physical());
  delete (p.drive!.wheelRadiusM as unknown as Record<string, unknown>).source;
  expect(codes(reseal(p))).toContain('FIELD_REQUIRED');
});

test('LiDAR sensor type and beam count are bounded; sensorType and lidar2d only appear together', () => {
  expect(validateSensorModel(makeLidarModel()).ok).toBe(true);
  expect(validateSensorModel({ ...makeLidarModel(), sensorType: 'radar' }).ok).toBe(false);
  expect(validateSensorModel(makeLidarModel('x', 5000)).ok).toBe(false);
  expect(validateSensorModel(makeLidarModel('x', 1)).ok).toBe(false);
  const { lidar2d: _l, ...noBeams } = makeLidarModel(); void _l;
  expect(validateSensorModel(noBeams).ok).toBe(false);
  expect(validateSensorModel({ ...makeLidarModel(), fieldOfView: { ...makeLidarModel().fieldOfView, value: 7 } }).ok).toBe(false); // > 2π rad
  expect(validateSensorModel({ ...makeLidarModel(), range: { ...makeLidarModel().range, max: { ...makeLidarModel().range.max, unit: 'mm' } } }).ok).toBe(false);
});

test('scene/world/policy mismatches and duplicate robots are refused', () => {
  expect(codes(scene({ world: { ...scene().world, hash: H('9') } }))).toContain('WORLD_MISMATCH');
  expect(codes(scene({ robots: [...scene().robots, ...scene().robots] }))).toContain('DUPLICATE_ID');
  expect(codes(scene({ robots: [{ ...scene().robots[0]!, model: model({ inputs: { ...inputs, assemblyDigest: H('9') } }) }] }))).toContain('INPUT_IDENTITY_MISMATCH');
  expect(codes(scene({ robots: [{ ...scene().robots[0]!, model: model({ navigationPolicyRef: { id: 'other', revision: 1, hash: H('9') } }) }] }))).toContain('POLICY_MISMATCH');
  expect(codes(scene({ policy: { ...policy, parameters: { ...policy.parameters, maxLinearMps: 5 } } }))).toContain('DIGEST_MISMATCH');
});

test('footprints must be simple counter-clockwise hulls without a repeated closing vertex', () => {
  const sq: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
  expect(polygonIssues(sq, '/f')).toEqual([]);
  expect(polygonIssues([...sq].reverse(), '/f').map((i) => i.code)).toEqual(['POLYGON_NOT_CCW']);
  expect(polygonIssues([...sq, sq[0]!], '/f').map((i) => i.code)).toContain('POLYGON_CLOSED');
  expect(polygonIssues([[0, 0], [1, 1], [1, 0], [0, 1]], '/f', false).map((i) => i.code)).toContain('POLYGON_SELF_INTERSECTING');
  expect(codes(model({ footprint: { ...model().footprint, verticesM: [[0, 0], [1, 0]] } }))).toContain('INVALID_FIELD'); // fewer than 3 vertices
});

test('a pass report needs execution=ran, no error issue and every check passing', () => {
  expect(codes(report({ execution: 'not_run' }))).toContain('REPORT_INCONSISTENT');
  expect(codes(report({ checks: [{ id: 'c', source: 'parity', result: 'inconclusive', coverageScope: 's' }] }))).toContain('REPORT_INCONSISTENT');
  expect(codes(report({ issues: [{ code: 'LF_IMPORT_LOSS', severity: 'error', path: '/links', entityId: 'amr-1', source: 'parity', detail: 'x' }] }))).toContain('REPORT_INCONSISTENT');
  expect(validateNavigationDocument(report({ execution: 'not_run', result: 'inconclusive', engine: null, checks: [] }))).toMatchObject({ ok: true });
  const optional = [...report().checks, { id: 'SRDF', source: 'linkforge' as const, result: 'not_run' as const, coverageScope: 'SEMANTIC_PROFILE_NOT_SUPPLIED' }];
  expect(validateNavigationDocument(report({ checks: optional }))).toMatchObject({ ok: true });
  expect(codes(report({ checks: [{ id: 'LF-PARITY', source: 'parity', result: 'not_run', coverageScope: 's' }] }))).toContain('REPORT_INCONSISTENT');
});

test('driveBindingsVersion and drivesByEntity travel together; legacy projects still validate', () => {
  const f = engineeringFixture('two-amr');
  const resolved = clone(resolveAssembly(f.project, f.components, { models: f.models as never }).resolved!);
  expect(validateResolvedAssembly(resolved).ok).toBe(true);
  delete resolved.models.drivesByEntity;
  expect(validateResolvedAssembly(resolved).ok).toBe(false);
  expect(validateEngineeringProject(engineeringFixture('valid').project).ok).toBe(true);
  expect(validateEngineeringProject({ ...engineeringFixture('valid').project, requestedProfile: 'engineering-irsim-2d-v1' }).ok).toBe(true);
  expect(validateEngineeringProject({ ...engineeringFixture('valid').project, requestedProfile: 'engineering-irsim-3d-v9' }).ok).toBe(false);
});
