// M05: per-link radii and a cup held across the tool axis (side grip). Without the two new fields every number of checkArmSweep stays what it was.
import { expect, test } from 'vitest';
import { PUMA560_SI, type ArmModelSI } from '../../packages/lab-runtime/src/v2/models/arm-kinematics';
import { checkArmSweep, DEFAULT_ARM_GEOMETRY, type ArmObstacle } from '../../packages/lab-runtime/src/v2/models/arm-collision';

// the synthetic one-metre arm of tests/integration/lab-v2-arm-safety-model.test.ts: one 1 m link (link-2) along x, TCP at [1,0,0], tool z = world z at q=0
const simple: ArmModelSI = { ...PUMA560_SI, revision: 'synthetic-one-metre-arm', toolM: [0, 0, 0],
  links: Array.from({ length: 6 }, (_, i) => ({ alpha: 0, a: i === 1 ? 1 : 0, d: 0, thetaOffset: 0 })), limits: Array.from({ length: 6 }, () => ({ min: -Math.PI, max: Math.PI, maxVelocity: 2 })) };
const q = (angle: number) => [angle, 0, 0, 0, 0, 0];
const sphere = (id: string, center: [number, number, number]): ArmObstacle => ({ id, kind: 'sphere', center, radiusM: 0.005 });

test('DEFAULT_ARM_GEOMETRY gives the very same SweepResult as before M05 on the three inputs of the safety-model test', () => {
  // recorded at 630c646, before arm-collision.ts changed
  expect(checkArmSweep(simple, q(-1.2), q(1.2), { world: [{ id: 'fixture-pin', kind: 'sphere', center: [0.955336489, -0.295520207, 0], radiusM: 0.003 }] })).toEqual(
    { ok: false, engine: 'capsule-sweep-v1', modelRevision: 'synthetic-one-metre-arm', geometryRevision: 'af749cfa7915ba464e3c6be65b2aab3019e5e88f7b5fd8b9c3455c724c4c1962', toleranceM: 0.0005, evaluations: 8, reason: 'COLLISION', pair: ['link-2', 'fixture-pin'], fraction: 0.375, clearanceM: -0.027999999639346285 });
  expect(checkArmSweep(simple, q(0), q(0), { world: [{ id: 'cup-stop', kind: 'box', min: [0.99, -0.005, 0.075], max: [1.01, 0.005, 0.085] }], heldCup: true })).toEqual(
    { ok: false, engine: 'capsule-sweep-v1', modelRevision: 'synthetic-one-metre-arm', geometryRevision: '947c20862037e5dd3241f5ce4e107ebfa8841cd073c09ca7ecd74770bdbf9c72', toleranceM: 0.0005, evaluations: 1, reason: 'COLLISION', pair: ['held-cup', 'cup-stop'], fraction: 0, clearanceM: -0.035 });
  expect(checkArmSweep(simple, q(-1), q(1), { world: [{ id: 'far', kind: 'sphere', center: [5, 5, 5], radiusM: 0.1 }] })).toEqual(
    { ok: true, engine: 'capsule-sweep-v1', modelRevision: 'synthetic-one-metre-arm', geometryRevision: 'ce07c4426c48709b5d8ae5ba967470e1ec610757c5c68bee196a7b9d3330f7c6', toleranceM: 0.0005, evaluations: 3 });
  // passing the default explicitly is the same as omitting it
  expect(checkArmSweep(simple, q(-1), q(1), { world: [{ id: 'far', kind: 'sphere', center: [5, 5, 5], radiusM: 0.1 }], geometry: DEFAULT_ARM_GEOMETRY }).geometryRevision).toBe('ce07c4426c48709b5d8ae5ba967470e1ec610757c5c68bee196a7b9d3330f7c6');
});

test('linkRadiiM: link 2 twice as thick turns a clear input into a COLLISION on that link only', () => {
  const world = [sphere('beside-link-2', [0.5, 0.04, 0])]; // 40 mm from the link axis: 10 mm clear at 25 mm, inside at 50 mm
  expect(checkArmSweep(simple, q(0), q(0), { world }).ok).toBe(true);
  const r = DEFAULT_ARM_GEOMETRY.linkRadiusM, geometry = { ...DEFAULT_ARM_GEOMETRY, linkRadiiM: [r, 2 * r, r, r, r, r] };
  const thick = checkArmSweep(simple, q(0), q(0), { world, geometry });
  expect(thick).toMatchObject({ ok: false, reason: 'COLLISION', pair: ['link-2', 'beside-link-2'] });
  expect(() => checkArmSweep(simple, q(0), q(0), { world, geometry: { ...geometry, linkRadiiM: [r, r] } })).toThrow('COLLISION_GEOMETRY_INVALID');
  expect(() => checkArmSweep(simple, q(0), q(0), { world, geometry: { ...geometry, linkRadiiM: [r, -r, r, r, r, r] } })).toThrow('COLLISION_GEOMETRY_INVALID');
});

test('cupAxisInTool [1,0,0]: the held cup lies across the tool axis, centred on the TCP; allowedPairs clears that contact', () => {
  const geometry = { ...DEFAULT_ARM_GEOMETRY, cupAxisInTool: [1, 0, 0] as [number, number, number], provenance: 'assumed' as const };
  const ahead = [sphere('ahead', [1, 0, 0.06])], beside = [sphere('beside', [1.04, 0, 0])];
  expect(checkArmSweep(simple, q(0), q(0), { world: ahead, heldCup: true }).ok).toBe(false); // the default upright cup would hit it
  expect(checkArmSweep(simple, q(0), q(0), { world: ahead, heldCup: true, geometry }).ok).toBe(true);
  expect(checkArmSweep(simple, q(0), q(0), { world: beside, heldCup: true, geometry })).toMatchObject({ ok: false, reason: 'COLLISION', pair: ['held-cup', 'beside'] });
  expect(checkArmSweep(simple, q(0), q(0), { world: beside, heldCup: true, geometry, allowedPairs: [['held-cup', 'beside']] }).ok).toBe(true);
  expect(checkArmSweep(simple, q(0), q(0), { world: beside, heldCup: false, geometry }).ok).toBe(true);
  expect(() => checkArmSweep(simple, q(0), q(0), { world: ahead, geometry: { ...geometry, cupAxisInTool: [0, 0, 0] } })).toThrow('COLLISION_GEOMETRY_INVALID');
});
