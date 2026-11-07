import { expect, test } from 'vitest';
import { assessEngineeringEvidence, calibrationDigest, type CalibrationEvidence, type EngineeringRunManifest } from '../../packages/lab-runtime/src/engineering/evidence';
import type { PhysicsSample } from '../../packages/lab-runtime/src/engineering/physics-adapter';

const B = 'a'.repeat(64);
const manifest = (over: Partial<EngineeringRunManifest> = {}): EngineeringRunManifest => ({ schemaVersion: 1, execution: 'completed', runId: 'run-1', bundleDigest: B, configDigest: 'd'.repeat(64), expectedEpoch: 1, profile: 'engineering-rigid-v1', lastSequence: 19, window: { startSimTimeNs: '0', endSimTimeNs: '190000000' },
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
const passing = (over: Partial<CalibrationEvidence['result']> = {}, cfg = 'd'.repeat(64)): CalibrationEvidence => {
  const result = { status: 'pass' as const, reasons: [], residuals: {}, domain: {}, calibratedCapabilities: ['rigidBody'], invalidatedBy: null, ...over };
  return { configDigest: cfg, result, digest: calibrationDigest(cfg, result) };
};
const claimsVerified = { ...manifest().claims, actuator: 'verified' as const, rigidBody: 'verified' as const };
test('simulation reaches modeled; verified only through a real, passing, matching calibration record', () => {
  const record = passing();
  const m = manifest({ claims: claimsVerified, calibrationRefs: { rigidBody: record.digest } });
  const r = assessEngineeringEvidence(m, good(), [record]);
  expect(r.status).toBe('pass');
  expect(r.capabilities).toMatchObject({ rigidBody: 'verified', actuator: 'modeled', geometry: 'modeled', grasp: 'unsupported', calibration: 'verified' });
});
test('an arbitrary digest, or a record that is failing, stale, for another model or another capability, earns nothing', () => {
  const ref = (digest: string) => manifest({ claims: claimsVerified, calibrationRefs: { rigidBody: digest } });
  const level = (m: EngineeringRunManifest, records: CalibrationEvidence[]) => assessEngineeringEvidence(m, good(), records).capabilities;
  expect(level(ref('c'.repeat(64)), []).rigidBody).toBe('modeled');                                    // no record behind the digest
  const failing = passing({ status: 'fail', reasons: ['RESIDUAL_EXCEEDS_TOLERANCE:speed'] });
  expect(level(ref(failing.digest), [failing]).rigidBody).toBe('modeled');
  const otherModel = passing({}, 'e'.repeat(64));
  expect(level(ref(otherModel.digest), [otherModel]).rigidBody).toBe('modeled');                       // calibrated a different configuration
  const wrongCapability = passing({ calibratedCapabilities: ['actuator'] });
  expect(level(ref(wrongCapability.digest), [wrongCapability]).rigidBody).toBe('modeled');
  const stale = passing({ invalidatedBy: 'f'.repeat(64) });
  expect(level(ref(stale.digest), [stale]).rigidBody).toBe('modeled');
  const tampered = { ...passing(), digest: 'a'.repeat(64) };
  expect(level(ref(tampered.digest), [tampered]).rigidBody).toBe('modeled');                           // digest must be the hash of the record
  const narrow = passing({ domain: { velocity: { min: 0, max: 0.3 } } });                               // observed joint velocity is 0.4
  expect(level(ref(narrow.digest), [narrow]).rigidBody).toBe('modeled');
});
test('cutting the end off a run cannot turn a failure into a pass', () => {
  const violating = good().map((s) => s.kind === 'joint' && s.sequence >= 15 ? { ...s, values: { ...s.values, velocity: 0.9 } } : s);
  expect(assessEngineeringEvidence(manifest(), violating).status).toBe('fail');
  const truncated = violating.filter((s) => s.sequence < 14);   // the violating second half is simply missing
  const r = assessEngineeringEvidence(manifest(), truncated);
  expect(r.status).toBe('fail');
  expect(r.reasons).toContain('EVIDENCE_TRUNCATED');
  expect(assessEngineeringEvidence(manifest({ lastSequence: 13, window: { startSimTimeNs: '0', endSimTimeNs: '130000000' } }), truncated).status).toBe('pass'); // only when the manifest said the run ended there
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

test('an aborted run is a failure even when the samples that exist look fine', () => {
  const r = assessEngineeringEvidence(manifest({ execution: 'aborted' }), good());
  expect(r.status).toBe('fail');
  expect(r.reasons).toContain('EXECUTION_ABORTED');
  expect(Object.values(r.capabilities).every((l) => l === 'unsupported')).toBe(true);
});
test('repeated, replayed or skipped sequences do not count towards coverage', () => {
  const copies = Array.from({ length: 5 }, () => sample(0, 'pose', POSE));
  const dup = assessEngineeringEvidence(manifest(), [...good().filter((s) => s.kind === 'joint'), ...copies]);
  expect(dup.status).toBe('fail');
  expect(dup.reasons).toContain('DUPLICATE_SEQUENCE');
  const skipped = assessEngineeringEvidence(manifest(), good().filter((s) => s.sequence !== 7));
  expect(skipped.reasons).toContain('SEQUENCE_GAP');
});
test('coverage must span the run: a stream that stops early is an EVIDENCE_GAP', () => {
  // pose stops at 60 ms while joints run to 190 ms; sequences are renumbered so the stream itself is contiguous and only the coverage window can tell
  const early = good().filter((s) => s.kind !== 'pose' || s.sequence < 8).map((s, i) => ({ ...s, sequence: i }));
  const r = assessEngineeringEvidence(manifest({ coverage: [{ id: 'odom', kind: 'pose', entityId: 'amr-1', minSamples: 4, maxGapNs: 20_000_000 }] }), early);
  expect(r.status).toBe('fail');
  expect(r.caseResults.find((c) => c.id === 'odom')!.status).toBe('fail');
});
