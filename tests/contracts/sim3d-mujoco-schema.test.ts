// M01 (MuJoCo arm): the sim3d wire gains an optional gripper and props, twin-sample-v2 an optional gripper opening and cup pose, and arm-cell-scene-v1 describes the MuJoCo cell. Everything written before stays valid.
import { expect, test } from 'vitest';
import { sealDocument, validateArmCellScene, validateSim3DRequest, validateSim3DResponse } from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import { validateTwinSampleV2 } from '../../packages/lab-runtime/src/v2/contracts';
import type { ArmCellSceneV1 } from '../../packages/lab-runtime/src/v2/navigation2d/contracts';

const H = (c: string) => c.repeat(64);
const request = (op: string, payload: Record<string, unknown>) => ({ protocol: 'mekoniq-sim3d/1', requestId: 'r1', runId: 'run-a', expectedTick: 0, op, payload });
const step = (over: Record<string, unknown> = {}) => request('step', { targetTick: 1, velocities: [], actorUpdates: [], ...over });
const robot3d = { robotId: 'amr-1', poseDriveMap: [1, 1, 0], bodyVelocity: [0, 0], scans: [], collisionIds: [], pose3d: { z: 0.09, roll: 0, pitch: 0 }, wheels: { leftRadS: 0, rightRadS: 0 } };
const arm = { armId: 'arm-1', positionsRad: [0, -0.6, 1.2, 0, 0.6, 0], velocitiesRadS: [0, 0, 0, 0, 0, 0], collisionIds: [] as string[] };
const response = (result: Record<string, unknown> = {}) => ({ protocol: 'mekoniq-sim3d/1', requestId: 'r1', runId: 'run-a', bootId: 'boot-a', tick: 0, ok: true,
  result: { schemaVersion: 1, runId: 'run-a', bootId: 'boot-a', tick: 0, simTimeNs: '0', seq: '0', sceneDigest: H('f'), robots: [], ...result } });
const pose = { position: [0.1, 0.2, 0.3], quaternionXyzw: [0, 0, 0, 1] };
const prop = { propId: 'cup-1', position: [0.1, 0.2, 0.3], quaternionXyzw: [0, 0, 0, 1], restingOn: 'tray' };

test('every AMR and Webots arm request and response written before M01 is still valid', () => {
  expect(validateSim3DRequest(request('create', { sceneRef: 'scene.json', seed: 7 })).ok).toBe(true);
  expect(validateSim3DRequest(request('create', { sceneRef: 'scene.json', seed: 7, arms: [{ armId: 'arm-1', sceneRef: 'arm-scene.json' }] })).ok).toBe(true);
  expect(validateSim3DRequest(step({ velocities: [{ robotId: 'amr-1', vMps: 0.3, omegaRadps: 0 }] })).ok).toBe(true);
  expect(validateSim3DRequest(step({ jointTargets: [{ armId: 'arm-1', positionsRad: [0, 0, 0, 0, 0, 0] }] })).ok).toBe(true);
  expect(validateSim3DResponse(response({ robots: [robot3d] })).ok).toBe(true);
  expect(validateSim3DResponse(response({ arms: [arm] })).ok).toBe(true);
  expect(validateSim3DResponse(response({ robots: [robot3d], arms: [{ ...arm, collisionIds: ['obstacle-1'] }] })).ok).toBe(true);
});

test('step may carry one gripper target and up to eight prop placements, a null pose taking the prop off the scene', () => {
  expect(validateSim3DRequest(step({ gripperTargets: [{ armId: 'arm-1', openingM: 0.04 }] })).ok).toBe(true);
  expect(validateSim3DRequest(step({ gripperTargets: [{ armId: 'arm-1', openingM: 0 }] })).ok).toBe(true);
  expect(validateSim3DRequest(step({ propPlacements: [{ propId: 'cup-1', pose: null }] })).ok).toBe(true);
  expect(validateSim3DRequest(step({ propPlacements: [{ propId: 'cup-1', pose }] })).ok).toBe(true);
  expect(validateSim3DRequest(step({ jointTargets: [{ armId: 'arm-1', positionsRad: [0, 0, 0, 0, 0, 0] }], gripperTargets: [{ armId: 'arm-1', openingM: 0.04 }], propPlacements: [{ propId: 'cup-1', pose: null }] })).ok).toBe(true);
  expect(validateSim3DRequest(step({ propPlacements: Array.from({ length: 8 }, (_, i) => ({ propId: `cup-${i}`, pose: null })) })).ok).toBe(true);
});

test('step refuses a negative or non-finite opening, two grippers, nine placements and a three-part quaternion', () => {
  const g = (openingM: number) => step({ gripperTargets: [{ armId: 'arm-1', openingM }] });
  expect(validateSim3DRequest(g(-0.001)).ok).toBe(false);
  expect(validateSim3DRequest(g(Number.NaN)).ok).toBe(false);
  expect(validateSim3DRequest(g(Number.POSITIVE_INFINITY)).ok).toBe(false);
  expect(validateSim3DRequest(step({ gripperTargets: [{ armId: 'arm-1', openingM: 0.04 }, { armId: 'arm-2', openingM: 0.04 }] })).ok).toBe(false);
  expect(validateSim3DRequest(step({ gripperTargets: [{ armId: 'arm-1', openingM: 0.04, extra: 1 }] })).ok).toBe(false);
  expect(validateSim3DRequest(step({ propPlacements: Array.from({ length: 9 }, (_, i) => ({ propId: `cup-${i}`, pose: null })) })).ok).toBe(false);
  expect(validateSim3DRequest(step({ propPlacements: [{ propId: 'cup-1', pose: { ...pose, quaternionXyzw: [0, 0, 1] } }] })).ok).toBe(false);
  expect(validateSim3DRequest(step({ propPlacements: [{ propId: 'cup-1' }] })).ok).toBe(false);
});

test('a snapshot may report the gripper of the arm and the props, and only in that shape', () => {
  expect(validateSim3DResponse(response({ arms: [{ ...arm, gripper: { openingM: 0.04, heldPropIds: [] } }] })).ok).toBe(true);
  expect(validateSim3DResponse(response({ arms: [{ ...arm, gripper: { openingM: 0.012, heldPropIds: ['cup-1'] } }], props: [prop, { ...prop, propId: 'cup-2', restingOn: null }] })).ok).toBe(true);
  expect(validateSim3DResponse(response({ arms: [{ ...arm, gripper: { openingM: -0.1, heldPropIds: [] } }] })).ok).toBe(false);
  expect(validateSim3DResponse(response({ arms: [{ ...arm, gripper: { openingM: 0.04 } }] })).ok).toBe(false);
  expect(validateSim3DResponse(response({ props: [{ ...prop, quaternionXyzw: [0, 0, 1] }] })).ok).toBe(false);
  expect(validateSim3DResponse(response({ props: [{ ...prop, position: [0, 0] }] })).ok).toBe(false);
  expect(validateSim3DResponse(response({ props: Array.from({ length: 9 }, (_, i) => ({ ...prop, propId: `cup-${i}` })) })).ok).toBe(false);
});

const cell = (over: Record<string, unknown> = {}): ArmCellSceneV1 => sealDocument({ schemaVersion: 1, sceneDigest: '',
  arm: { armId: 'arm-1', modelId: 'xarm6-g2-v1', modelRevision: H('a'), baseInMap: { position: [0, 0, 0.75], quaternionXyzw: [0, 0, 0, 1] }, homeRad: [0, -0.6, 1.2, 0, 0.6, 0] },
  statics: [{ id: 'table-1', kind: 'box', min: [-0.5, -0.5, 0], max: [0.5, 0.5, 0.74] }],
  supports: [{ id: 'nozzle-stand', centerM: [0.4, 0, 0.8], sizeM: [0.1, 0.1, 0.1] }, { id: 'tray', centerM: [0, 0.4, 0.8], sizeM: [0.2, 0.2, 0.02] }],
  props: [{ propId: 'cup-1', kind: 'cup', radiusM: 0.035, heightM: 0.09, massKg: 0.02, provenance: 'assumed' }],
  graspFrames: { pick: pose, place: pose }, allowedContacts: [{ a: 'gripper', b: 'nozzle-stand' }, { a: 'held_prop', b: 'tray' }],
  world3d: { padFriction: 1, propFriction: 0.6, supportFriction: 0.6, provenance: 'assumed' }, engine: { id: 'mujoco_3d', timestepMs: 2, substeps: 10 }, engineSeed: 7, ...over } as unknown as ArmCellSceneV1, 'sceneDigest');

test('ArmCellSceneV1 validates, is sealed by its digest and keeps engineSeed in 0..2^31-1', () => {
  expect(validateArmCellScene(cell()).ok).toBe(true);
  expect(validateArmCellScene(cell({ engineSeed: 2 ** 31 - 1 })).ok).toBe(true);
  expect(validateArmCellScene(cell({ engineSeed: 2 ** 31 })).ok).toBe(false);
  expect(validateArmCellScene(cell({ engineSeed: -1 })).ok).toBe(false);
  const r = validateArmCellScene({ ...cell(), engineSeed: 8 });
  expect(r.ok ? [] : r.issues.map((i) => i.code)).toContain('DIGEST_MISMATCH');
});

test('ArmCellSceneV1 refuses a missing tray, timestepMs 20, a contact against the floor, a non-unit quaternion and an open object', () => {
  const [stand] = cell().supports;
  expect(validateArmCellScene(cell({ supports: [stand] })).ok).toBe(false);
  expect(validateArmCellScene(cell({ supports: [stand, { ...stand, id: 'floor' }] })).ok).toBe(false);
  expect(validateArmCellScene(cell({ engine: { id: 'mujoco_3d', timestepMs: 20, substeps: 10 } })).ok).toBe(false);
  expect(validateArmCellScene(cell({ allowedContacts: [{ a: 'gripper', b: 'floor' }] })).ok).toBe(false);
  expect(validateArmCellScene(cell({ props: [] })).ok).toBe(false);
  expect(validateArmCellScene(cell({ statics: [{ id: 'b', kind: 'box', min: [1, 1, 1], max: [1, 2, 2] }] })).ok).toBe(false);
  const r = validateArmCellScene(cell({ graspFrames: { pick: { ...pose, quaternionXyzw: [0, 0, 0, 2] }, place: pose } }));
  expect(r.ok ? [] : r.issues.map((i) => i.code)).toContain('QUATERNION_NOT_NORMALIZED');
  expect(validateArmCellScene({ ...cell(), extra: 1 }).ok).toBe(false);
});

const sample = (observed: Record<string, unknown>, frameId = 'arm_base') => ({ schemaVersion: 2, runId: '00000000-0000-4000-8000-000000000001', entityId: 'arm-1', providerId: 'mujoco_arm', bootId: 'b', seq: '1', simTimeNs: '0', observedAt: null,
  receivedMonotonicNs: '1', frameId, origin: 'controller_sim', quality: 'valid', reasonCodes: [], commanded: null, observed, estimated: null, causationId: null });
const armObs = { jointsRad: [0, 0, 0, 0, 0, 0] };
const cupObs = { ownerKind: 'cell', ownerId: null };

test('twin-sample-v2 samples written before M01 stay valid; the arm gains gripperOpeningM and the cup a pose', () => {
  expect(validateTwinSampleV2(sample(armObs)).ok).toBe(true);
  expect(validateTwinSampleV2(sample({ xM: 1, yM: 2, yawRad: 0.1, moving: false, hold: null }, 'map')).ok).toBe(true);
  expect(validateTwinSampleV2(sample({ cycleState: 'brew', cupPresent: true, machineStatus: 'ready' }, 'cell_base')).ok).toBe(true);
  expect(validateTwinSampleV2(sample(cupObs, 'map')).ok).toBe(true);
  expect(validateTwinSampleV2(sample({ ...armObs, gripper: 'open' })).ok).toBe(true);
  expect(validateTwinSampleV2(sample({ ...armObs, gripperOpeningM: 0.04 })).ok).toBe(true);
  expect(validateTwinSampleV2(sample({ ...cupObs, positionM: [0.1, 0.2, 0.3], quaternionXyzw: [0, 0, 0, 1], restingOn: 'tray' }, 'map')).ok).toBe(true);
  expect(validateTwinSampleV2(sample({ ...cupObs, restingOn: null }, 'map')).ok).toBe(true);
});

test('twin-sample-v2 refuses a negative gripper opening and a two-part cup position', () => {
  expect(validateTwinSampleV2(sample({ ...armObs, gripperOpeningM: -1 })).ok).toBe(false);
  expect(validateTwinSampleV2(sample({ ...cupObs, positionM: [0.1, 0.2] }, 'map')).ok).toBe(false);
  expect(validateTwinSampleV2(sample({ ...cupObs, quaternionXyzw: [0, 0, 1] }, 'map')).ok).toBe(false);
});
