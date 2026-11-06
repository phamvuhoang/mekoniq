import { expect, test } from 'vitest';
import { classifyDocument, validateBundleReceipt, validateComponentRevision, validateEngineeringArchive, validateEngineeringCandidate, validateEngineeringProject } from '../../packages/lab-runtime/src/engineering/contracts';
import { engineeringFixture } from '../support/engineering';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const firstComponent = (name = 'valid') => Object.values(engineeringFixture(name).components)[0]!;
const wheelComponent = () => Object.values(engineeringFixture('valid').components).find((c) => c.joints.length > 0)!;
const codes = (r: { problems: { code: string }[] }) => r.problems.map((p) => p.code);

test('rejects authority and invalid scalar input', () => {
  const { project } = engineeringFixture('valid');
  expect(validateEngineeringProject(project).ok).toBe(true);
  expect(validateEngineeringProject({ ...project, operator: 'admin' }).ok).toBe(false);
  expect(validateEngineeringProject({ ...project, revision: NaN }).ok).toBe(false);
});

test('fixture helper only serves registered ids and covers every named case', () => {
  for (const name of ['valid', 'missing-inertia', 'cycle', 'voltage-mismatch', 'battery-offset']) {
    const f = engineeringFixture(name);
    expect(validateEngineeringProject(f.project).ok, name).toBe(true);
    for (const c of Object.values(f.components)) expect(validateComponentRevision(c).ok, `${name}/${c.id}`).toBe(true);
  }
  expect(() => engineeringFixture('nope')).toThrow(/UNKNOWN_ENGINEERING_FIXTURE/);
});

test('instances must reference components by their canonical digest', () => {
  const f = engineeringFixture('valid');
  for (const i of f.project.assembly.instances) expect(f.components[i.componentDigest]).toBeDefined();
});

test('joint kinds are discriminated: fixed, continuous and bounded need exactly their fields', () => {
  const c = clone(wheelComponent());
  const joint = c.joints[0]!;
  const lim = (value: number, unit: string) => ({ value, unit, source: c.links[0]!.inertialSource });
  const base = { id: joint.id, parent: joint.parent, child: joint.child, origin: joint.origin, axis: [0, 0, 1] as [number, number, number] };
  const withJoint = (j: unknown) => validateComponentRevision({ ...c, joints: [j] });
  expect(withJoint({ ...base, kind: 'fixed' }).ok).toBe(true);
  expect(withJoint({ ...base, kind: 'fixed', limits: {} }).ok).toBe(false);
  expect(withJoint({ ...base, kind: 'continuous', limits: { velocity: lim(20, 'rad/s'), effort: lim(5, 'N*m') } }).ok).toBe(true);
  expect(withJoint({ ...base, kind: 'continuous', limits: { lower: lim(-1, 'rad'), upper: lim(1, 'rad'), velocity: lim(20, 'rad/s'), effort: lim(5, 'N*m') } }).ok).toBe(false);
  expect(withJoint({ ...base, kind: 'revolute' }).ok).toBe(false);
  expect(withJoint({ ...base, kind: 'revolute', limits: { lower: lim(-1, 'rad'), upper: lim(1, 'rad'), velocity: lim(2, 'rad/s'), effort: lim(5, 'N*m') } }).ok).toBe(true);
  const inverted = withJoint({ ...base, kind: 'revolute', limits: { lower: lim(1, 'rad'), upper: lim(-1, 'rad'), velocity: lim(2, 'rad/s'), effort: lim(5, 'N*m') } });
  expect(inverted.ok).toBe(false);
  expect(codes(inverted)).toContain('JOINT_LIMITS_INVERTED');
  const wrongUnit = withJoint({ ...base, kind: 'prismatic', limits: { lower: lim(0, 'rad'), upper: lim(1, 'm'), velocity: lim(2, 'm/s'), effort: lim(5, 'N') } });
  expect(codes(wrongUnit)).toContain('UNIT_NOT_ALLOWED');
});

test('rejects a non-normalised or non-finite quaternion and unknown units', () => {
  const c = clone(firstComponent());
  const bad = clone(c);
  bad.links[0]!.visual[0]!.pose.quaternionXyzw = [0, 0, 0, 2];
  const r = validateComponentRevision(bad);
  expect(r.ok).toBe(false);
  expect(codes(r)).toContain('QUATERNION_NOT_NORMALIZED');
  const nan = clone(c);
  nan.links[0]!.massKg.value = NaN;
  expect(validateComponentRevision(nan).ok).toBe(false);
  const unit = clone(c);
  unit.links[0]!.massKg.unit = 'lb';
  expect(codes(validateComponentRevision(unit))).toContain('UNIT_NOT_ALLOWED');
});

test('duplicate ids and bad digests are blocking problems', () => {
  const { project } = engineeringFixture('valid');
  const dup = clone(project);
  dup.assembly.instances.push(clone(dup.assembly.instances[0]!));
  const r = validateEngineeringProject(dup);
  expect(r.ok).toBe(false);
  expect(codes(r)).toContain('DUPLICATE_ID');
  expect(r.problems.every((p) => p.blocking)).toBe(true);
  const digest = clone(project);
  digest.assembly.instances[0]!.componentDigest = 'ABC';
  expect(validateEngineeringProject(digest).ok).toBe(false);
});

test('missing inertia is explicit null, never a zero tensor', () => {
  const c = Object.values(engineeringFixture('missing-inertia').components).find((x) => x.links.some((l) => l.inertiaKgM2 === null))!;
  expect(c).toBeDefined();
  expect(validateComponentRevision(c).ok).toBe(true);
  const zeros = clone(c);
  zeros.links.forEach((l) => { if (l.inertiaKgM2 === null) (l as { inertiaKgM2: unknown }).inertiaKgM2 = undefined; });
  expect(validateComponentRevision(zeros).ok).toBe(false);
});

test('document type is checked before schemaVersion so v1 projects are not mistaken for engineering', () => {
  const { project } = engineeringFixture('valid');
  expect(classifyDocument(project)).toBe('engineering-project');
  expect(classifyDocument(project.runtimeProject)).toBe('lab-project-v2');
  expect(classifyDocument({ schemaVersion: 1, id: 'p', name: 'x', robots: [] })).toBe('lab-project-v1');
  expect(classifyDocument({ documentType: 'engineering-project-archive', schemaVersion: 1 })).toBe('engineering-project-archive');
  expect(classifyDocument({ documentType: 'engineering-project', schemaVersion: 2 })).toBe('unknown');
  expect(classifyDocument(null)).toBe('unknown');
});

test('receipt states keep digests consistent with blocked/compiled', () => {
  const d = 'a'.repeat(64);
  const base = { projectDigest: d, profile: 'engineering-rigid-v1', problems: [] };
  expect(validateBundleReceipt({ ...base, state: 'blocked', bundleDigest: null, assemblyDigest: null, sceneDigest: null, runnable: false }).ok).toBe(true);
  expect(validateBundleReceipt({ ...base, state: 'blocked', bundleDigest: d, assemblyDigest: null, sceneDigest: null, runnable: false }).ok).toBe(false);
  expect(validateBundleReceipt({ ...base, state: 'compiled', bundleDigest: d, assemblyDigest: d, sceneDigest: d, runnable: false }).ok).toBe(true);
  expect(validateBundleReceipt({ ...base, state: 'compiled', bundleDigest: null, assemblyDigest: d, sceneDigest: d, runnable: true }).ok).toBe(false);
});

test('candidate and archive never claim hardware validation, authority or secrets', () => {
  const d = 'b'.repeat(64);
  const { project } = engineeringFixture('valid');
  const candidate = { documentType: 'engineering-candidate', schemaVersion: 1, status: 'draft', hardwareValidated: false, controlAuthority: false, project, projectDigest: d, assemblyDigest: null, bundleDigest: null, problems: [], evidenceRefs: [], historicalEvidenceRefs: [], checksum: d };
  expect(validateEngineeringCandidate(candidate).ok).toBe(true);
  expect(validateEngineeringCandidate({ ...candidate, hardwareValidated: true }).ok).toBe(false);
  expect(validateEngineeringCandidate({ ...candidate, controlAuthority: true }).ok).toBe(false);
  expect(validateEngineeringCandidate({ ...candidate, sessionProof: 'x' }).ok).toBe(false);
  const f = engineeringFixture('valid');
  const archive = { documentType: 'engineering-project-archive', schemaVersion: 1, project: f.project, components: Object.values(f.components), assets: [], recipes: [], blobs: [], missingDigests: [] };
  expect(validateEngineeringArchive(archive).ok).toBe(true);
  expect(validateEngineeringArchive({ ...archive, blobs: [{ digest: d, file: '../etc/passwd', mediaType: 'model/gltf-binary', license: 'MIT', sizeBytes: 1 }] }).ok).toBe(false);
  expect(validateEngineeringArchive({ ...archive, controllerEndpoint: 'http://x' }).ok).toBe(false);
});
