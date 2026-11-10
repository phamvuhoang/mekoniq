// W05: the serve-3d-v1 fixture (Serve + two passive casters, all `assumed`) and the webots scene options of the navigation compiler.
// serve-demo-v1 is not touched: IR-SIM keeps its digests.
import { expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { NAVIGATION_SCHEMA_HASH, validateNavigationDocument } from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import { projectPhysicalModel } from '../../packages/lab-runtime/src/engineering/physical-model';
import { exportedFixtureFiles3d, navigationFixture, navigationScene, navigationScene3d, WORLD3D } from '../support/navigation2d';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const DEMO = 'robotics/navigation-2d/fixtures/serve-demo-v1', D3 = 'robotics/simulation-3d/fixtures/serve-3d-v1';

test('serve-demo-v1 manifest hashes are untouched', () => {
  const manifest = JSON.parse(readFileSync(`${DEMO}/manifest.json`, 'utf8')) as { files: { path: string; sha256: string }[] };
  const by = (p: string) => manifest.files.find((f) => f.path === p)!.sha256;
  // the values the candidate-03 native handoff (§2.1) quotes
  expect(by('serve-project.json').startsWith('5ca48410be47efe5')).toBe(true);
  expect(by('navigation-scene.json').startsWith('4aff7df1b8daa33b')).toBe(true);
  for (const f of manifest.files) expect(sha(readFileSync(`${DEMO}/${f.path}`, 'utf8')), f.path).toBe(f.sha256);
});

test('serve-3d-v1 resolves, has two caster links per robot, and its footprint equals the 2D footprint', () => {
  const { input } = navigationFixture('serve-3d');
  const model = projectPhysicalModel(input, 'amr-1', NAVIGATION_SCHEMA_HASH);
  const casters = model.links.filter((l) => l.id.endsWith('/ball'));
  expect(casters.map((c) => c.collision[0]!.geometry.kind)).toEqual(['sphere', 'sphere']);
  expect(casters.every((c) => c.massKg.value === 0.15 && c.massKg.source.kind === 'assumed')).toBe(true);
  expect(navigationScene('serve-3d').robots[0]!.model.footprint.verticesM).toEqual(navigationScene('serve').robots[0]!.model.footprint.verticesM);
  // every caster touches the floor plane the wheels touch: the lowest point of each sphere is the wheel's lowest point
  const wheelR = model.drive!.wheelRadiusM.value;
  const baseOf = (id: string) => { const j = model.joints.find((x) => x.child === id)!; return j.origin.xyzM; };
  for (const c of casters) {
    const r = (c.collision[0]!.geometry as { radiusM: number }).radiusM, z = baseOf(c.id)[2]! + c.collision[0]!.pose.xyzM[2]!;
    expect(z - r).toBeCloseTo(-wheelR, 9);
  }
});

test('the fleet variant gives the second robot its own casters', () => {
  const { input } = navigationFixture('fleet-3d');
  for (const id of ['robot01', 'robot02']) expect(projectPhysicalModel(input, id, NAVIGATION_SCHEMA_HASH).links.filter((l) => l.id.endsWith('/ball'))).toHaveLength(2);
});

test('scene compiled for webots carries engine.id webots_3d and world3d and validates', () => {
  const scene = navigationScene3d('serve-3d');
  expect(scene.engine).toEqual({ id: 'webots_3d', version: 'R2025a', basicTimeStepMs: 20 });
  expect((scene as unknown as { world3d: unknown }).world3d).toEqual(WORLD3D);
  const r = validateNavigationDocument(scene);
  expect(r.ok ? [] : r.issues).toEqual([]);
  // the IR-SIM scene of the same robot still has no world3d and still says irsim_2d
  expect(navigationScene('serve').engine).toMatchObject({ id: 'irsim_2d' });
  expect('world3d' in navigationScene('serve')).toBe(false);
});

test('LiDAR mount height is below obstacleHeightM', () => {
  const { input } = navigationFixture('serve-3d');
  const model = projectPhysicalModel(input, 'amr-1', NAVIGATION_SCHEMA_HASH);
  const planeM = model.drive!.wheelRadiusM.value + model.sensors[0]!.poseInBase.xyzM[2]!;
  expect(planeM).toBeLessThan(WORLD3D.obstacleHeightM);
  expect(planeM).toBeGreaterThan(0);
});

test('the committed serve-3d-v1 files are exactly what the generator writes', () => {
  const files = exportedFixtureFiles3d();
  const manifest = JSON.parse(readFileSync(`${D3}/manifest.json`, 'utf8')) as { files: { path: string; sha256: string }[] };
  expect(manifest.files.map((f) => f.path).sort()).toEqual(Object.keys(files).sort());
  for (const [name, content] of Object.entries(files)) {
    const text = JSON.stringify(content, null, 2) + '\n';
    expect(readFileSync(`${D3}/${name}`, 'utf8'), name).toBe(text);
    expect(manifest.files.find((f) => f.path === name)!.sha256, name).toBe(sha(text));
  }
});
