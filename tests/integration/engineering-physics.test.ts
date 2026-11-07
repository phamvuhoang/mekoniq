import { expect, test } from 'vitest';
import { createPhysicsIngest, ingestPhysicsSample, type PhysicsSample } from '../../packages/lab-runtime/src/engineering/physics-adapter';

const expected = { runId: 'run-1', bundleDigest: 'a'.repeat(64), epoch: 3 };
const sample = (over: Partial<PhysicsSample> = {}): PhysicsSample => ({ runId: 'run-1', bundleDigest: 'a'.repeat(64), epoch: 3, sequence: 0, simTimeNs: '1000000', receivedMonotonicNs: '5000000', entityId: 'amr-1', frameId: 'amr-1/odom', kind: 'pose',
  values: { x: 1, y: 2, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 }, ...over });

test('a sample for another bundle, run or epoch is rejected with its own reason', () => {
  expect(ingestPhysicsSample(sample({ bundleDigest: 'f'.repeat(64) }), expected)).toEqual({ accepted: false, reason: 'BUNDLE_MISMATCH' });
  expect(ingestPhysicsSample(sample({ runId: 'run-2' }), expected)).toEqual({ accepted: false, reason: 'RUN_MISMATCH' });
  expect(ingestPhysicsSample(sample({ epoch: 2 }), expected)).toEqual({ accepted: false, reason: 'EPOCH_MISMATCH' });
  expect(ingestPhysicsSample(sample(), expected)).toEqual({ accepted: true, reason: null });
});

test('values are schema-locked per kind: unknown names, missing names and non-finite numbers are invalid', () => {
  expect(ingestPhysicsSample(sample({ values: { x: 1, y: 2, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, extra: 5 } }), expected).reason).toBe('INVALID_SAMPLE');
  expect(ingestPhysicsSample(sample({ values: { x: 1 } }), expected).reason).toBe('INVALID_SAMPLE');
  expect(ingestPhysicsSample(sample({ values: { x: Number.NaN, y: 2, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 } }), expected).reason).toBe('INVALID_SAMPLE');
  expect(ingestPhysicsSample(sample({ kind: 'joint', values: { position: 0.1, velocity: 0, effort: 0.5 } }), expected).accepted).toBe(true);
  expect(ingestPhysicsSample(sample({ kind: 'contact', values: { normalForceN: 4, durationNs: 2_000_000 } }), expected).accepted).toBe(true);
  expect(ingestPhysicsSample(sample({ kind: 'process', values: { volumeMl: 30, massKg: 0.03 } }), expected).accepted).toBe(true);
  expect(ingestPhysicsSample(sample({ simTimeNs: '-1' }), expected).reason).toBe('INVALID_SAMPLE');
  expect(ingestPhysicsSample({ ...sample(), kind: 'ground_truth_write' }, expected).reason).toBe('INVALID_SAMPLE');
  expect(ingestPhysicsSample('nope', expected).reason).toBe('INVALID_SAMPLE');
});

test('a stream accepts consecutive sequences and fails on duplicate, reorder or gap', () => {
  const dup = createPhysicsIngest(expected);
  expect(dup.ingest(sample({ sequence: 0 })).accepted).toBe(true);
  expect(dup.ingest(sample({ sequence: 0 }))).toEqual({ accepted: false, reason: 'DUPLICATE_SEQUENCE' });
  const gap = createPhysicsIngest(expected);
  gap.ingest(sample({ sequence: 0 }));
  expect(gap.ingest(sample({ sequence: 2 }))).toEqual({ accepted: false, reason: 'SEQUENCE_GAP' });
  expect(gap.state()).toMatchObject({ failed: 'SEQUENCE_GAP' });
  expect(gap.ingest(sample({ sequence: 1 }))).toEqual({ accepted: false, reason: 'STREAM_FAILED' }); // a gap is never repaired by a late sample
  const reorder = createPhysicsIngest(expected);
  reorder.ingest(sample({ sequence: 0 })); reorder.ingest(sample({ sequence: 1 }));
  expect(reorder.ingest(sample({ sequence: 0, simTimeNs: '2000000' }))).toEqual({ accepted: false, reason: 'DUPLICATE_SEQUENCE' });
});

test('sim time never runs backwards within an epoch', () => {
  const s = createPhysicsIngest(expected);
  s.ingest(sample({ sequence: 0, simTimeNs: '2000' }));
  expect(s.ingest(sample({ sequence: 1, simTimeNs: '1000' }))).toEqual({ accepted: false, reason: 'CLOCK_REGRESSION' });
});

test('a full evidence queue is EVIDENCE_GAP, never silently dropped samples', () => {
  const s = createPhysicsIngest(expected, { queueLimit: 2 });
  expect(s.ingest(sample({ sequence: 0 })).accepted && s.ingest(sample({ sequence: 1 })).accepted).toBe(true);
  expect(s.ingest(sample({ sequence: 2 }))).toEqual({ accepted: false, reason: 'EVIDENCE_GAP' });
  expect(s.state().failed).toBe('EVIDENCE_GAP');
  const drained = s.drain();
  expect(drained.map((x) => x.sequence)).toEqual([0, 1]);
  expect(s.ingest(sample({ sequence: 2 })).reason).toBe('STREAM_FAILED'); // draining does not hide the gap
});

test('draining frees the queue for the next sample', () => {
  const s = createPhysicsIngest(expected, { queueLimit: 2 });
  s.ingest(sample({ sequence: 0 })); s.ingest(sample({ sequence: 1 }));
  s.drain();
  expect(s.ingest(sample({ sequence: 2 })).accepted).toBe(true);
});
