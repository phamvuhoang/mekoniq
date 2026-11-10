// X01 (R1.1): the sim3d wire opens additively for one arm (D25) and arm-scene-3d-v1 describes its world (D26). AMR requests and responses stay valid.
import { expect, test } from 'vitest';
import { sealDocument, validateArmScene3D, validateSim3DRequest, validateSim3DResponse } from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import { loadOracleProfile } from '../../packages/lab-runtime/src/v2/algorithm/checker';
import type { ArmScene3DV1 } from '../../packages/lab-runtime/src/v2/navigation2d/contracts';

const H = (c: string) => c.repeat(64);
const request = (op: string, payload: Record<string, unknown>) => ({ protocol: 'mekoniq-sim3d/1', requestId: 'r1', runId: 'run-a', expectedTick: 0, op, payload });
const step = (over: Record<string, unknown> = {}) => request('step', { targetTick: 1, velocities: [], actorUpdates: [], ...over });
const robot3d = { robotId: 'amr-1', poseDriveMap: [1, 1, 0], bodyVelocity: [0, 0], scans: [], collisionIds: [], pose3d: { z: 0.09, roll: 0, pitch: 0 }, wheels: { leftRadS: 0, rightRadS: 0 } };
const arm = { armId: 'arm-1', positionsRad: [0, -0.6, 1.2, 0, 0.6, 0], velocitiesRadS: [0, 0, 0, 0, 0, 0], collisionIds: [] as string[] };
const response = (result: Record<string, unknown> = {}) => ({ protocol: 'mekoniq-sim3d/1', requestId: 'r1', runId: 'run-a', bootId: 'boot-a', tick: 0, ok: true,
  result: { schemaVersion: 1, runId: 'run-a', bootId: 'boot-a', tick: 0, simTimeNs: '0', seq: '0', sceneDigest: H('f'), robots: [], ...result } });
const target = (over: Record<string, unknown> = {}) => ({ armId: 'arm-1', positionsRad: [0, 0, 0, 0, 0, 0], ...over });

test('AMR-only create, step and snapshot written before the arm branch are still valid', () => {
  expect(validateSim3DRequest(request('create', { sceneRef: 'scene.json', seed: 7 })).ok).toBe(true);
  expect(validateSim3DRequest(step({ velocities: [{ robotId: 'amr-1', vMps: 0.3, omegaRadps: 0 }] })).ok).toBe(true);
  expect(validateSim3DResponse(response({ robots: [robot3d] })).ok).toBe(true);
});

test('step carries at most one arm of 1..8 finite joint targets', () => {
  expect(validateSim3DRequest(step({ jointTargets: [target()] })).ok).toBe(true);
  expect(validateSim3DRequest(step({ jointTargets: [target({ positionsRad: [0, 0, 0, 0, 0, 0, 0, 0] })] })).ok).toBe(true);
  expect(validateSim3DRequest(step({ jointTargets: [target({ positionsRad: new Array(9).fill(0) })] })).ok).toBe(false);
  expect(validateSim3DRequest(step({ jointTargets: [target({ positionsRad: [] })] })).ok).toBe(false);
  expect(validateSim3DRequest(step({ jointTargets: [target({ positionsRad: [0, Number.NaN, 0, 0, 0, 0] })] })).ok).toBe(false);
  expect(validateSim3DRequest(step({ jointTargets: [target({ positionsRad: [0, Number.POSITIVE_INFINITY, 0, 0, 0, 0] })] })).ok).toBe(false);
  expect(validateSim3DRequest(step({ jointTargets: [target(), target({ armId: 'arm-2' })] })).ok).toBe(false);
  const { armId: _a, ...noArm } = target(); void _a;
  expect(validateSim3DRequest(step({ jointTargets: [noArm] })).ok).toBe(false);
  expect(validateSim3DRequest(step({ jointTargets: [target({ extra: 1 })] })).ok).toBe(false);
});

test('create names at most one arm scene and only the fixed arm-scene.json', () => {
  expect(validateSim3DRequest(request('create', { sceneRef: 'scene.json', seed: 7, arms: [{ armId: 'arm-1', sceneRef: 'arm-scene.json' }] })).ok).toBe(true);
  expect(validateSim3DRequest(request('create', { sceneRef: 'scene.json', seed: 7, arms: [{ armId: 'arm-1', sceneRef: '../etc/passwd' }] })).ok).toBe(false);
  expect(validateSim3DRequest(request('create', { sceneRef: 'scene.json', seed: 7, arms: [{ armId: 'a', sceneRef: 'arm-scene.json' }, { armId: 'b', sceneRef: 'arm-scene.json' }] })).ok).toBe(false);
});

test('a snapshot may report one arm with positions, velocities and collision ids, and only in that shape', () => {
  expect(validateSim3DResponse(response({ arms: [arm] })).ok).toBe(true);
  expect(validateSim3DResponse(response({ robots: [robot3d], arms: [{ ...arm, collisionIds: ['obstacle-1'] }] })).ok).toBe(true);
  expect(validateSim3DResponse(response({ arms: [arm, { ...arm, armId: 'arm-2' }] })).ok).toBe(false);
  expect(validateSim3DResponse(response({ arms: [{ ...arm, positionsRad: [Number.NaN, 0, 0, 0, 0, 0] }] })).ok).toBe(false);
  const { velocitiesRadS: _v, ...noVel } = arm; void _v;
  expect(validateSim3DResponse(response({ arms: [noVel] })).ok).toBe(false);
});

const scene = (over: Record<string, unknown> = {}): ArmScene3DV1 => sealDocument({ schemaVersion: 1, sceneDigest: '', arm: { armId: 'arm-1', modelId: 'arm-ref-3d-v1', modelRevision: H('a'),
  baseInMap: { position: [2, 1, 0.75], quaternionXyzw: [0, 0, 0, 1] }, homeRad: [0, -0.6, 1.2, 0, 0.6, 0] },
  statics: [{ id: 'table-1', kind: 'box', min: [1.6, 0.6, 0], max: [2.4, 1.4, 0.74] }, { id: 'pillar', kind: 'sphere', center: [3, 3, 0.5], radiusM: 0.2 }],
  world3d: { floorFriction: 0.8, provenance: 'assumed' }, engine: { id: 'webots_3d', basicTimeStepMs: 20 }, engineSeed: 7, ...over } as unknown as ArmScene3DV1, 'sceneDigest');

test('ArmScene3DV1 validates, is sealed by its digest and keeps engineSeed inside the SFInt32 range', () => {
  expect(validateArmScene3D(scene()).ok).toBe(true);
  expect(validateArmScene3D(scene({ engineSeed: 2 ** 31 - 1 })).ok).toBe(true);
  expect(validateArmScene3D(scene({ engineSeed: 2 ** 31 })).ok).toBe(false);
  expect(validateArmScene3D(scene({ engineSeed: -1 })).ok).toBe(false);
  const tampered = { ...scene(), engineSeed: 8 };
  const r = validateArmScene3D(tampered);
  expect(r.ok ? [] : r.issues.map((i) => i.code)).toContain('DIGEST_MISMATCH');
});

test('ArmScene3DV1 refuses a wrong model, too many joints, a degenerate box and a non-unit base quaternion', () => {
  const arm1 = (over: Record<string, unknown>) => scene({ arm: { ...scene().arm, ...over } });
  expect(validateArmScene3D(arm1({ modelId: 'serve-3d-v1' })).ok).toBe(false);
  expect(validateArmScene3D(arm1({ homeRad: new Array(9).fill(0) })).ok).toBe(false);
  expect(validateArmScene3D(scene({ statics: [{ id: 'b', kind: 'box', min: [1, 1, 1], max: [1, 2, 2] }] })).ok).toBe(false);
  const r = validateArmScene3D(arm1({ baseInMap: { position: [0, 0, 0], quaternionXyzw: [0, 0, 0, 2] } }));
  expect(r.ok ? [] : r.issues.map((i) => i.code)).toContain('QUATERNION_NOT_NORMALIZED');
  expect(validateArmScene3D({ ...scene(), extra: 1 }).ok).toBe(false);
});

test('the oracle profile carries the X00 arm thresholds and leaves the R1 ones as they were', () => {
  const { profile } = loadOracleProfile();
  expect(profile.webotsArm).toMatchObject({ reachTolRad: 0.01, settleTicks: 10, followTolRad: 0.05, followTicks: 10, repeatJointRad: 1e-6 });
  expect(profile.webots).toEqual({ lidarRangeToleranceM: 0.02, lidarWindowBeams: 1, lidarMedianM: 0.01, repeatPoseM: 1e-6, note: expect.any(String) });
  expect(profile.pid).toEqual({ sample: 1e-9 });
  expect(profile.fk).toEqual({ translationM: 1e-6, rotationRad: 1e-6 });
});
