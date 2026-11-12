// M06 step 1: the MuJoCo arm cell scene from a project and the xarm6-g2-v1 fixture; the fixture reader verifies every file against the fixture manifest.
import { afterEach, expect, test } from 'vitest';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildArmCellScene, readXArmFixture, XARM_FIXTURE_ID } from '../../packages/lab-runtime/src/v2/simulation3d/arm-cell-scene';
import { validateArmCellScene } from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import { declareArmScene, validateArmCollisionProfile } from '../../packages/lab-runtime/src/v2/models/arm-scene';
import { XARM6_SI } from '../../packages/lab-runtime/src/v2/models/arm-kinematics';
import { qmul, qrotate } from '../../packages/lab-runtime/src/v2/frames';
import type { LabProjectV2 } from '../../packages/lab-runtime/src/v2/contracts';
import { coffeeProject } from '../support/lab-v2';

const workerRoot = resolve('robotics/simulation-mujoco'), FX = join(workerRoot, 'fixtures', XARM_FIXTURE_ID);
const project = async () => JSON.parse(await readFile(join(FX, 'coffee-cell-project.json'), 'utf8')) as LabProjectV2;
const opts = { armId: 'arm-1', propIds: ['cup-1', 'cup-2'] };
const dirs: string[] = [];
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
const near = (a: readonly number[], b: readonly number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 9));

test('the fixture reader returns the verified fixture: id, the manifest model revision, the program set and the waypoint table', async () => {
  const f = readXArmFixture(workerRoot), manifest = JSON.parse(await readFile(join(FX, 'manifest.json'), 'utf8')), programs = JSON.parse(await readFile(join(FX, 'programs.json'), 'utf8'));
  expect(f.id).toBe('xarm6-g2-v1'); expect(f.revision).toBe(manifest.modelRevision); expect(f.revision).toBe(XARM6_SI.revision);
  expect(f.programs).toEqual(programs.programs); expect(f.waypoints).toEqual({ table: programs.table, digest: programs.digest });
  expect(f.physics.gripper.openingMaxM).toBe(0.0889); expect(f.layout.cup.radiusM).toBe(0.04);
  expect(JSON.parse(f.componentText).joints.length).toBeGreaterThan(6); expect(f.blobDir).toBe(join(FX, 'blobs'));
});

test.each(['physics.json', 'cell-layout.json', 'component.json', 'blobs/7604bde7881dc09ce16db57007bfc03e3885abe9d12da18e63b91cb1569d6d4f.stl'])('a fixture whose %s differs from its manifest is ARM_MODEL_MISMATCH', async (file) => {
  const root = await mkdtemp(join(tmpdir(), 'xarm-fx-')); dirs.push(root);
  await cp(FX, join(root, 'fixtures', XARM_FIXTURE_ID), { recursive: true });
  const path = join(root, 'fixtures', XARM_FIXTURE_ID, file), bytes = await readFile(path);
  bytes[bytes.length - 2] = bytes[bytes.length - 2]! ^ 1; await writeFile(path, bytes);
  expect(() => readXArmFixture(root)).toThrow(/^ARM_MODEL_MISMATCH/);
});

test('the scene of the xArm coffee project is schema-valid and deterministic; supports and grasp frames are the layout in the map frame', async () => {
  const f = readXArmFixture(workerRoot), p = await project(), scene = buildArmCellScene(p, f, 42, opts);
  expect(validateArmCellScene(scene).ok).toBe(true);
  expect(buildArmCellScene(p, f, 42, opts).sceneDigest).toBe(scene.sceneDigest);
  expect(buildArmCellScene(p, f, 43, opts).sceneDigest).not.toBe(scene.sceneDigest);
  expect(scene.arm).toMatchObject({ armId: 'arm-1', modelId: 'xarm6-g2-v1', modelRevision: f.revision, baseInMap: p.armCollisionProfile!.baseInMap, homeRad: f.programs.waypoints.home });
  const base = p.armCollisionProfile!.baseInMap.position;
  const tray = scene.supports.find((s) => s.id === 'tray')!, stand = scene.supports.find((s) => s.id === 'nozzle-stand')!;
  near(tray.centerM, f.layout.tray.centerM.map((v, i) => v + base[i]!)); expect(tray.sizeM).toEqual(f.layout.tray.sizeM);
  near(stand.centerM, f.layout.nozzleStand.centerM.map((v, i) => v + base[i]!));
  near(scene.graspFrames.pick.position, f.layout.grasp.pick.position.map((v, i) => v + base[i]!));
  expect(scene.props.map((x) => x.propId)).toEqual(['cup-1', 'cup-2']);
  expect(scene.props[0]).toEqual({ propId: 'cup-1', kind: 'cup', radiusM: 0.04, heightM: 0.1, massKg: 0.32, provenance: 'assumed' });
  expect(scene.allowedContacts).toEqual([{ a: 'gripper', b: 'nozzle-stand' }, { a: 'gripper', b: 'tray' }, { a: 'held_prop', b: 'nozzle-stand' }, { a: 'held_prop', b: 'tray' }]);
  expect(scene.statics.map((s) => s.id)).toEqual(['fixture:counter']);
  expect(scene.world3d).toMatchObject({ padFriction: 1, propFriction: 0.6, provenance: 'assumed' });
  expect(scene.engine).toEqual({ id: 'mujoco_3d', timestepMs: 2, substeps: 10 }); expect(scene.engineSeed).toBe(42);
});

test('without an arm collision profile the scene is ARM_SCENE_UNAVAILABLE; the PUMA coffee project is ARM_MODEL_MISMATCH', async () => {
  const f = readXArmFixture(workerRoot), p = await project(); delete (p as { armCollisionProfile?: unknown }).armCollisionProfile;
  expect(() => buildArmCellScene(p, f, 1, opts)).toThrow(/^ARM_SCENE_UNAVAILABLE/);
  const puma = coffeeProject() as unknown as LabProjectV2;
  expect(puma.armCollisionProfile!.modelId).toBe('puma560-reference');
  expect(() => buildArmCellScene(puma, f, 1, opts)).toThrow(/^ARM_MODEL_MISMATCH/);
  const xarm = await project();
  expect(() => buildArmCellScene(xarm, { ...f, id: 'arm-ref-3d-v1' }, 1, opts)).toThrow(/^ARM_MODEL_MISMATCH/);
});

test('a coffee pickup point 0.2 m away from where the tray lands is ARM_CELL_LAYOUT_MISMATCH', async () => {
  const f = readXArmFixture(workerRoot), p = await project();
  p.world.points.find((x) => x.kind === 'coffee_pickup')!.x += 0.2;
  expect(() => buildArmCellScene(p, f, 1, opts)).toThrow(/^ARM_CELL_LAYOUT_MISMATCH/);
});

test('a base turned 90 degrees about z turns the supports and the grasp frames with it', async () => {
  const f = readXArmFixture(workerRoot), p = await project(), qz: [number, number, number, number] = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
  p.armCollisionProfile!.baseInMap.quaternionXyzw = qz;
  const base = p.armCollisionProfile!.baseInMap.position, at = (v: readonly number[]) => qrotate(qz, v).map((x, i) => x + base[i]!);
  const pickup = p.world.points.find((x) => x.kind === 'coffee_pickup')!, trayAt = at(f.layout.tray.centerM);
  pickup.x = trayAt[0]!; pickup.y = trayAt[1]!; // the tray still lands on the pickup point
  const scene = buildArmCellScene(p, f, 1, opts);
  near(scene.supports.find((s) => s.id === 'tray')!.centerM, trayAt);
  near(scene.supports.find((s) => s.id === 'nozzle-stand')!.centerM, at(f.layout.nozzleStand.centerM));
  near(scene.graspFrames.pick.position, at(f.layout.grasp.pick.position)); near(scene.graspFrames.place.position, at(f.layout.grasp.place.position));
  near(scene.graspFrames.pick.quaternionXyzw, qmul(qz, f.layout.grasp.pick.quaternionXyzw)); near(scene.graspFrames.place.quaternionXyzw, qmul(qz, f.layout.grasp.place.quaternionXyzw));
  expect(scene.supports.find((s) => s.id === 'tray')!.sizeM).toEqual(f.layout.tray.sizeM); // sizes stay along the base axes (the worker turns the box with the base)
});

test('validateArmCollisionProfile and declareArmScene keep refusing an xArm profile by default and accept it with the xArm model', async () => {
  const p = await project();
  expect(() => validateArmCollisionProfile(p.armCollisionProfile!)).toThrow('ARM_COLLISION_MODEL_MISMATCH');
  expect(() => validateArmCollisionProfile(p.armCollisionProfile!, XARM6_SI)).not.toThrow();
  expect(() => declareArmScene(p, {})).toThrow('ARM_COLLISION_MODEL_MISMATCH');
  expect(declareArmScene(p, {}, undefined, XARM6_SI).profile).toEqual(p.armCollisionProfile);
  const puma = coffeeProject() as unknown as LabProjectV2;
  expect(() => validateArmCollisionProfile(puma.armCollisionProfile!)).not.toThrow();
  expect(() => validateArmCollisionProfile(puma.armCollisionProfile!, XARM6_SI)).toThrow('ARM_COLLISION_MODEL_MISMATCH');
});
