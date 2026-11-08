import { expect, test } from 'vitest';
import { EngineeringInputError, prepareEngineeringCompileInput, resolveAssembly } from '../../packages/lab-runtime/src/engineering/assembly';
import { projectPhysicalModel } from '../../packages/lab-runtime/src/engineering/physical-model';
import { hashJson } from '../../packages/lab-runtime/src/v2/hash';
import { validateNavigationDocument } from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import { engineeringFixture } from '../support/engineering';

const SCHEMA_HASH = 'a'.repeat(64);
const input = (name: string, mutate?: (f: ReturnType<typeof engineeringFixture>) => void) => {
  const f = JSON.parse(JSON.stringify(engineeringFixture(name))) as ReturnType<typeof engineeringFixture>;
  mutate?.(f);
  const r = resolveAssembly(f.project, f.components, { models: f.models as never });
  expect(r.problems, name).toEqual([]);
  return { compile: prepareEngineeringCompileInput(f.project, r.resolved!, []), resolved: r.resolved! };
};
const thrownCodes = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as EngineeringInputError).problems.map((p) => p.code); } return []; };

test('each robot gets only its own links and joints, with exactly one root', () => {
  const { compile } = input('two-amr');
  const a = projectPhysicalModel(compile, 'amr-1', SCHEMA_HASH), b = projectPhysicalModel(compile, 'amr-2', SCHEMA_HASH);
  expect(a.links.every((l) => l.id.startsWith('r1-'))).toBe(true);
  expect(b.links.every((l) => l.id.startsWith('r2-'))).toBe(true);
  expect(a.baseFrameId).toBe('r1-chassis/base');
  const ids = new Set(a.links.map((l) => l.id));
  expect(a.joints.every((j) => ids.has(j.parent) && ids.has(j.child))).toBe(true);
  expect(a.joints.map((j) => j.id)).toContain('mount:r1-chassis/left-axle:r1-wheel-left/mount');
  const children = new Set(a.joints.map((j) => j.child));
  expect(a.links.filter((l) => !children.has(l.id)).map((l) => l.id)).toEqual(['r1-chassis/base']);
});

test('links keep the resolved mass, COM and inertia order [ixx,ixy,ixz,iyy,iyz,izz] bit for bit', () => {
  const { compile, resolved } = input('two-amr');
  const model = projectPhysicalModel(compile, 'amr-2', SCHEMA_HASH);
  for (const l of model.links) expect(l).toEqual(resolved.links.find((x) => x.id === l.id));
  const chassis = model.links.find((l) => l.id === 'r2-chassis/base')!;
  expect(chassis.inertiaKgM2).toEqual([20 * (0.4 ** 2 + 0.15 ** 2) / 12, 0, 0, 20 * (0.5 ** 2 + 0.15 ** 2) / 12, 0, 20 * (0.5 ** 2 + 0.4 ** 2) / 12]);
});

test('the drive frame is the wheel-axle midpoint in the base frame: x forward, y from right to left wheel, z up', () => {
  const { compile } = input('two-amr');
  const one = projectPhysicalModel(compile, 'amr-1', SCHEMA_HASH).drive!, two = projectPhysicalModel(compile, 'amr-2', SCHEMA_HASH).drive!;
  expect(one.driveFrameInBase.xyzM.map((v) => +v.toFixed(9))).toEqual([0, 0, 0]);
  expect(two.driveFrameInBase.xyzM.map((v) => +v.toFixed(9))).toEqual([-0.1, 0, 0]); // axle sits 0.1 m behind the root link origin
  expect(two.driveFrameInBase.quaternionXyzw.map((v) => +v.toFixed(9))).toEqual([0, 0, 0, 1]);
  expect([one.wheelRadiusM.value, one.wheelSeparationM.value, two.wheelRadiusM.value, two.wheelSeparationM.value]).toEqual([0.075, 0.36, 0.1, 0.42]);
  expect([one.leftJointId, two.rightJointId]).toEqual(['r1-wheel-left/axle', 'r2-wheel-right/axle']);
});

test('sensors belong to their own robot and keep the authored model and mount pose', () => {
  const { compile } = input('two-amr');
  const a = projectPhysicalModel(compile, 'amr-1', SCHEMA_HASH), b = projectPhysicalModel(compile, 'amr-2', SCHEMA_HASH);
  expect(b.sensors).toEqual([]);
  expect(a.sensors).toHaveLength(1);
  expect(a.sensors[0]).toMatchObject({ sensorId: 'lidar-front', sourceInstanceId: 'r1-chassis', parentLinkId: 'r1-chassis/base' });
  expect(a.sensors[0]!.model.lidar2d!.beamCount).toBe(360);
  expect(a.sensors[0]!.poseInBase.xyzM).toEqual([0, 0, 0]);
});

test('the digest covers everything but itself, is stable, and differs per robot', () => {
  const { compile } = input('two-amr');
  const a = projectPhysicalModel(compile, 'amr-1', SCHEMA_HASH), again = projectPhysicalModel(compile, 'amr-1', SCHEMA_HASH), b = projectPhysicalModel(compile, 'amr-2', SCHEMA_HASH);
  const { modelDigest, ...rest } = a;
  expect(modelDigest).toBe(hashJson(rest));
  expect(again).toEqual(a);
  expect(b.modelDigest).not.toBe(a.modelDigest);
  expect(projectPhysicalModel(compile, 'amr-1', 'b'.repeat(64)).modelDigest).not.toBe(a.modelDigest);
  expect(a.inputs).toMatchObject({ assemblyDigest: compile.resolved.assemblyDigest, project: { id: 'fixture-amr', revision: 1, digest: compile.projectDigest }, world: { id: 'fixture-world' } });
  expect(validateNavigationDocument(a)).toMatchObject({ ok: true });
});

test('refuses what it cannot project instead of guessing', () => {
  const { compile } = input('two-amr');
  expect(thrownCodes(() => projectPhysicalModel(compile, 'amr-9', SCHEMA_HASH))).toEqual(['UNKNOWN_ROBOT']);
  const legacy = input('valid').compile;
  expect(thrownCodes(() => projectPhysicalModel(legacy, 'amr-1', SCHEMA_HASH))).toEqual(['DRIVE_BINDINGS_REQUIRED']);
  const badFrame = input('lidar-bad-frame', (f) => { f.project.requestedProfile = 'engineering-irsim-2d-v1'; });
  expect(thrownCodes(() => projectPhysicalModel(badFrame.compile, 'amr-1', SCHEMA_HASH))).toEqual(['SENSOR_FRAME_MISSING']);
  const skew = input('skew-axle', (f) => { f.project.requestedProfile = 'engineering-irsim-2d-v1'; });
  expect(thrownCodes(() => projectPhysicalModel(skew.compile, 'amr-1', SCHEMA_HASH))).toEqual(['NON_PLANAR_DRIVE']);
  const swapped = input('swapped-axle', (f) => { f.project.requestedProfile = 'engineering-irsim-2d-v1'; });
  expect(thrownCodes(() => projectPhysicalModel(swapped.compile, 'amr-1', SCHEMA_HASH))).toEqual(['DRIVE_SIDES_SWAPPED']);
});
