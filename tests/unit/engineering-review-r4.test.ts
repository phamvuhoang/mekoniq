import { afterEach, expect, test } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBundleStore } from '../../packages/lab-runtime/src/engineering/bundle-store';
import { validateActuatorModel, validateEngineeringProject, validateProcessModel, validateSensorModel } from '../../packages/lab-runtime/src/engineering/contracts';
import { engineeringFixture, makeDriveModel, scalar } from '../support/engineering';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const dirs: string[] = [];
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
const codes = (r: { problems: { code: string }[] }) => r.problems.map((p) => p.code);

test('actuator model units and ranges are enforced, not just shape', () => {
  expect(validateActuatorModel(makeDriveModel())).toMatchObject({ ok: true });
  const mut = (patch: (m: ReturnType<typeof makeDriveModel>) => void) => { const m = clone(makeDriveModel()); patch(m); return validateActuatorModel(m); };
  expect(codes(mut((m) => { m.drive.wheelRadiusM = scalar(0.1, 'cm'); }))).toContain('UNIT_NOT_ALLOWED');
  expect(codes(mut((m) => { m.currentLimit = scalar(10, 'kg'); }))).toContain('UNIT_NOT_ALLOWED');
  expect(codes(mut((m) => { m.voltageLimit = scalar(-24, 'V'); }))).toContain('MODEL_PARAMETER_RANGE');
  expect(codes(mut((m) => { m.transmission.ratio = scalar(10, 'm'); }))).toContain('UNIT_NOT_ALLOWED');
  expect(codes(mut((m) => { m.torqueSpeedTable[0]!.speed = scalar(0, 'N'); }))).toContain('UNIT_NOT_ALLOWED');
  expect(codes(mut((m) => { m.torqueSpeedTable[0]!.torque = scalar(-3, 'N*m'); }))).toContain('MODEL_PARAMETER_RANGE');
  expect(codes(mut((m) => { m.drive.wheelSeparationM = scalar(0, 'm'); }))).toContain('MODEL_PARAMETER_RANGE');
  expect(codes(mut((m) => { m.friction = scalar(-0.02, 'N*m'); }))).toContain('MODEL_PARAMETER_RANGE');
});

test('sensor and process model ranges are enforced', () => {
  const sensor = { schemaVersion: 1, kind: 'sensor', id: 'lidar', frame: 'laser', rateHz: scalar(10, 'Hz'), range: { min: scalar(0.1, 'm'), max: scalar(10, 'm') }, fieldOfView: scalar(6.28, 'rad'), noise: { distribution: 'gaussian', stddev: scalar(0.01, 'm'), seed: 1 }, latency: scalar(0.05, 's'), dropoutProbability: scalar(0.01, '1') };
  expect(validateSensorModel(sensor as never)).toMatchObject({ ok: true });
  const bad = (patch: (s: typeof sensor) => void) => { const s = clone(sensor); patch(s); return validateSensorModel(s as never); };
  expect(codes(bad((s) => { s.rateHz = scalar(10, 'm'); }))).toContain('UNIT_NOT_ALLOWED');
  expect(codes(bad((s) => { s.rateHz = scalar(0, 'Hz'); }))).toContain('MODEL_PARAMETER_RANGE');
  expect(codes(bad((s) => { s.dropoutProbability = scalar(1.5, '1'); }))).toContain('MODEL_PARAMETER_RANGE');
  expect(codes(bad((s) => { s.latency = scalar(-1, 's'); }))).toContain('MODEL_PARAMETER_RANGE');
  const process = clone(JSON.parse(readFileSync(join(__dirname, '../fixtures/engineering/process-200ml.json'), 'utf8')));
  const model = process.model ?? process;
  expect(validateProcessModel(model)).toMatchObject({ ok: true });
  const over = clone(model); over.reservoirs[0].initialMl.value = over.reservoirs[0].capacityMl.value + 1;
  expect(codes(validateProcessModel(over))).toContain('MODEL_PARAMETER_RANGE');
  const slow = clone(model); slow.flowMlPerSec.value = 0;
  expect(codes(validateProcessModel(slow))).toContain('MODEL_PARAMETER_RANGE');
});

test('an instance id containing a path separator is refused, so ownership by id prefix cannot lose a part', () => {
  const f = clone(engineeringFixture('valid'));
  f.project.assembly.instances[4]!.id = 'aux/tray';
  expect(validateEngineeringProject(f.project).ok).toBe(false);
});

test('a component-local id containing a separator is refused by the component contract', async () => {
  const { validateComponentRevision } = await import('../../packages/lab-runtime/src/engineering/contracts');
  const c = clone(Object.values(engineeringFixture('valid').components).find((x) => x.id === 'service-tray')!);
  c.links[0]!.id = 'pl/ate';
  expect(codes(validateComponentRevision(c))).toContain('ID_SEPARATOR');
  const p = clone(Object.values(engineeringFixture('valid').components).find((x) => x.id === 'service-tray')!);
  p.ports[0]!.id = 'mo/unt';
  expect(codes(validateComponentRevision(p))).toContain('ID_SEPARATOR');
});

test('publishing again repairs a corrupted blob and a corrupted manifest instead of reporting success over damage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eng-store-')); dirs.push(root);
  const store = createBundleStore(root), meta = { projectDigest: 'a'.repeat(64), assemblyDigest: 'b'.repeat(64), sceneDigest: 'c'.repeat(64), profile: 'p', compilerVersion: 'v1' };
  const files = [{ path: 'scene.json', bytes: new TextEncoder().encode('{"ok":true}') }];
  const first = await store.publish('s1', files, meta);
  expect(await store.verifyClosure(first.bundleDigest)).toEqual([]);
  const blob = join(root, 'blobs', first.manifest.files[0]!.sha256);
  await writeFile(blob, 'tampered');
  expect(await store.verifyClosure(first.bundleDigest)).toEqual(['BLOB_CORRUPT scene.json']);
  const again = await store.publish('s2', files, meta);
  expect(again.bundleDigest).toBe(first.bundleDigest);
  expect(await store.verifyClosure(first.bundleDigest)).toEqual([]);
  expect(await readFile(blob, 'utf8')).toBe('{"ok":true}');
  await writeFile(join(root, 'bundles', first.bundleDigest, 'manifest.json'), '{"broken":true}');
  expect(await store.readManifest(first.bundleDigest)).toBeNull();
  await store.publish('s3', files, meta);
  expect(await store.readManifest(first.bundleDigest)).not.toBeNull();
});
