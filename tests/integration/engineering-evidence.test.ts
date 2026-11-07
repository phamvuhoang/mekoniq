import { expect, test } from 'vitest';
import { assessEngineeringEvidence, type EngineeringRunManifest } from '../../packages/lab-runtime/src/engineering/evidence';
import type { PhysicsSample } from '../../packages/lab-runtime/src/engineering/physics-adapter';

const B = 'a'.repeat(64);
const manifest = (over: Partial<EngineeringRunManifest> = {}): EngineeringRunManifest => ({ schemaVersion: 1, execution: 'completed', runId: 'run-1', bundleDigest: B, expectedEpoch: 1, profile: 'engineering-rigid-v1',
  coverage: [{ id: 'odom', kind: 'pose', entityId: 'amr-1', minSamples: 5, maxGapNs: 20_000_000 }],
  checks: [{ id: 'speed-limit', kind: 'joint', entityId: 'amr-1', value: 'velocity', rule: 'max', limit: 0.6 }],
  claims: { geometry: 'modeled', rigidBody: 'modeled', actuator: 'unsupported', sensor: 'unsupported', grasp: 'unsupported', process: 'unsupported', calibration: 'unsupported' }, calibrationRefs: {}, artifacts: ['report.json'], ...over });
const sample = (sequence: number, kind: PhysicsSample['kind'], values: Record<string, number>, over: Partial<PhysicsSample> = {}): PhysicsSample =>
  ({ runId: 'run-1', bundleDigest: B, epoch: 1, sequence, simTimeNs: String(sequence * 10_000_000), receivedMonotonicNs: String(sequence * 10_000_000), entityId: 'amr-1', frameId: 'amr-1/odom', kind, values, ...over });
const POSE = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
const good = (): PhysicsSample[] => Array.from({ length: 10 }, (_, i) => [sample(2 * i, 'pose', POSE), sample(2 * i + 1, 'joint', { position: 0, velocity: 0.4, effort: 1 })]).flat();

test('an executed run with no samples is a fail, never a pass', () => {
  expect(assessEngineeringEvidence(manifest(), []).status).not.toBe('pass');
  expect(assessEngineeringEvidence(manifest(), []).reasons).toContain('EVIDENCE_GAP');
});
test('prerequisites that prevented execution are not_run, not fail', () => {
  const r = assessEngineeringEvidence(manifest({ execution: 'not_started' }), []);
  expect(r).toMatchObject({ status: 'not_run', reasons: ['EXECUTION_NOT_STARTED'] });
  expect(Object.values(r.capabilities).every((l) => l === 'unsupported')).toBe(true);
});
test('complete, current samples within every threshold pass and are described by hash, count and bounds', () => {
  const r = assessEngineeringEvidence(manifest(), good());
  expect(r.status).toBe('pass');
  expect(r.artifactRefs).toMatchObject({ sampleCount: 20, firstSimTimeNs: '0', lastSimTimeNs: '190000000' });
  expect(r.artifactRefs.samplesSha256).toMatch(/^[0-9a-f]{64}$/);
  expect(r.caseResults.map((c) => [c.id, c.status])).toEqual([['odom', 'pass'], ['speed-limit', 'pass']]);
});
test('a hole in the pose stream is an EVIDENCE_GAP, not a quiet pass', () => {
  const holey = good().filter((s) => !(s.kind === 'pose' && s.sequence >= 6 && s.sequence <= 12));
  const r = assessEngineeringEvidence(manifest(), holey);
  expect(r.status).toBe('fail');
  expect(r.reasons).toContain('EVIDENCE_GAP');
  expect(assessEngineeringEvidence(manifest(), good().slice(0, 4)).reasons).toContain('EVIDENCE_GAP'); // too few samples
});
test('samples of another run, bundle or epoch never count', () => {
  const foreign = good().map((s) => ({ ...s, bundleDigest: 'f'.repeat(64) }));
  const r = assessEngineeringEvidence(manifest(), foreign);
  expect(r.status).toBe('fail');
  expect(r.reasons).toEqual(expect.arrayContaining(['BUNDLE_MISMATCH', 'EVIDENCE_GAP']));
  expect(assessEngineeringEvidence(manifest(), good().map((s) => ({ ...s, epoch: 0 }))).reasons).toContain('EPOCH_MISMATCH');
});
test('a threshold breach fails with the check id; a check with no samples is unavailable, not zero', () => {
  const fast = good().map((s) => s.kind === 'joint' ? { ...s, values: { ...s.values, velocity: 0.9 } } : s);
  expect(assessEngineeringEvidence(manifest(), fast).reasons).toContain('CHECK_FAILED:speed-limit');
  const noJoint = good().filter((s) => s.kind !== 'joint');
  const r = assessEngineeringEvidence(manifest(), noJoint);
  expect(r.reasons).toContain('UNAVAILABLE:speed-limit');
  expect(r.caseResults.find((c) => c.id === 'speed-limit')!.status).toBe('fail');
});
test('simulation reaches at most modeled; verified needs a calibration reference for that capability', () => {
  const claims = { ...manifest().claims, actuator: 'verified' as const, rigidBody: 'verified' as const };
  const r = assessEngineeringEvidence(manifest({ claims, calibrationRefs: { rigidBody: 'c'.repeat(64) } }), good());
  expect(r.status).toBe('pass');
  expect(r.capabilities).toMatchObject({ rigidBody: 'verified', actuator: 'modeled', geometry: 'modeled', grasp: 'unsupported' });
  expect(r.capabilities.calibration).toBe('verified');
});
test('a failed run claims nothing', () => {
  const r = assessEngineeringEvidence(manifest(), []);
  expect(Object.values(r.capabilities).every((l) => l === 'unsupported')).toBe(true);
});
test('a manifest that is not a complete schema document is refused, not interpreted', () => {
  const partial: Record<string, unknown> = { ...manifest() };
  delete partial.claims;
  expect(() => assessEngineeringEvidence(partial as never, good())).toThrow(/MANIFEST_INVALID/);
  expect(() => assessEngineeringEvidence({ ...manifest(), extra: 1 } as never, good())).toThrow(/MANIFEST_INVALID/);
});
