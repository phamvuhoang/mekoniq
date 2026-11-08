// Portable bundles: the real Python helpers and the real IR-SIM loader. Skipped, with the reason, where the pinned venvs are not provisioned.
import { afterEach, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createPythonCompiler } from '../../packages/lab-runtime/src/engineering/compiler';
import { createEngineeringService } from '../../packages/lab-runtime/src/engineering/gateway';
import { createNavigationCompiler } from '../../packages/lab-runtime/src/engineering/navigation-compiler';
import { validateNavigationDocument } from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import { engineeringFixture, writeFixtureCatalog } from '../support/engineering';
import { navigationFixture, type NavigationFixtureName } from '../support/navigation2d';

const simPython = resolve('.venv/bin/python'), irPython = resolve('.venv-irsim/bin/python');
const ok = (py: string, code: string) => { try { execFileSync(py, ['-c', code], { stdio: 'ignore' }); return true; } catch { return false; } };
const available = existsSync(simPython) && existsSync(irPython) && ok(simPython, 'import rfc8785, jsonschema, referencing, yaml') && ok(irPython, 'import irsim, yaml, rfc8785');
const roots: string[] = [];
afterEach(async () => { for (const d of roots.splice(0)) await rm(d, { recursive: true, force: true }); });
const temp = async (p: string) => { const d = await mkdtemp(join(tmpdir(), p)); roots.push(d); return d; };
const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const native = () => createPythonCompiler({ python: simPython, simulationRoot: 'robotics/simulation' });
const portable = () => createNavigationCompiler({ python: irPython, workerRoot: resolve('robotics/navigation-2d'), descriptionHelperRoot: resolve('robotics/simulation') });

async function service(f: { project: unknown; components: Record<string, unknown>; models: Record<string, unknown> }, withPortable = true) {
  const catalogRoot = await temp('nav-cat-');
  await writeFixtureCatalog(catalogRoot, f as never);
  return createEngineeringService({ directory: await temp('nav-'), catalogRoot, compiler: native(), ...(withPortable ? { compilers: { 'engineering-irsim-2d-v1': portable() } } : {}) });
}
const read = async (s: Awaited<ReturnType<typeof service>>, digest: string, path: string) => {
  const m = await s.readManifest('s', digest);
  return Buffer.from(await s.readBlob('s', m.files.find((f) => f.path === path)!.sha256));
};

test.skipIf(!available)('CMP01-05 bundle: two robots with different drives compile to URDFs, a CompiledScene, projections and an IR-SIM world that the real engine loads', async () => {
  const f = navigationFixture('two-robot').fixture, s = await service(f);
  const receipt = await s.compileEngineeringProject(f.project, 's');
  expect(receipt.problems.filter((p) => p.blocking), JSON.stringify(receipt.problems)).toEqual([]);
  if (receipt.state !== 'compiled') throw new Error('NOT_COMPILED');
  const manifest = await s.readManifest('s', receipt.bundleDigest);
  expect(manifest.profile).toBe('engineering-irsim-2d-v1');
  const paths = manifest.files.map((x) => x.path);
  expect(paths).toEqual(expect.arrayContaining(['robots/amr-1.urdf', 'robots/amr-2.urdf', 'scene.json', 'navigation-scene.json', 'navigation-policy.json', 'irsim/world.yaml', 'irsim/name-map.json', 'physical-model/amr-1.json', 'physical-model/amr-2.json', 'navigation-model/amr-1.json', 'navigation-model/amr-2.json', 'resolved-assembly.json']));
  expect(paths.some((p) => p.startsWith('nav2/') || p.startsWith('controllers/') || p === 'world.sdf')).toBe(false); // nothing that would fake native readiness
  const scene = JSON.parse((await read(s, receipt.bundleDigest, 'scene.json')).toString());
  expect(scene.wheelBindings.map((b: { id: string; radiusM: number }) => [b.id, b.radiusM])).toEqual([['amr-1/left', 0.09], ['amr-1/right', 0.09], ['amr-2/left', 0.1], ['amr-2/right', 0.1]]);
  expect(receipt.sceneDigest).toBe(manifest.files.find((x) => x.path === 'scene.json')!.sha256); // receipt.sceneDigest hashes the CompiledScene, not the navigation scene
  const nav = JSON.parse((await read(s, receipt.bundleDigest, 'navigation-scene.json')).toString());
  expect(validateNavigationDocument(nav)).toMatchObject({ ok: true });
  expect(nav.sceneDigest).not.toBe(receipt.sceneDigest);
  for (const ref of nav.files) expect(manifest.files.find((x) => x.path === ref.path)).toMatchObject({ sha256: ref.sha256 }); // the scene's file refs are the bundle's
  const dir = await temp('nav-yaml-');
  await mkdir(join(dir, 'irsim'));
  await writeFile(join(dir, 'irsim/world.yaml'), await read(s, receipt.bundleDigest, 'irsim/world.yaml'));
  const out = execFileSync(irPython, ['-c', `import irsim,sys;e=irsim.make(sys.argv[1],display=False);print(sorted(r.name for r in e.robot_list), len(e.obstacle_list));e.end()`, join(dir, 'irsim/world.yaml')], { encoding: 'utf8' });
  expect(out).toMatch(/\['r_[0-9a-f]{16}', 'r_[0-9a-f]{16}'\] 15/); // 2 robots, 10 tables + counter + 4 walls
  // the robot URDF is the one LinkForge validates in A02: same ids, same bytes for the same inputs
  expect(sha(await read(s, receipt.bundleDigest, 'robots/amr-1.urdf'))).toBe(manifest.files.find((x) => x.path === 'robots/amr-1.urdf')!.sha256);
  expect((await s.compileEngineeringProject(f.project, 'other')).bundleDigest).toBe(receipt.bundleDigest); // deterministic
});

test.skipIf(!available)('no fallback: the IR-SIM profile is blocked without its own compiler, and native profiles still use the native one', async () => {
  const f = navigationFixture('serve').fixture;
  const blocked = await (await service(f, false)).compileEngineeringProject(f.project, 's');
  expect(blocked.state).toBe('blocked');
  expect(blocked.problems.map((p) => p.code)).toContain('PROFILE_COMPILER_UNAVAILABLE');
  const legacy = engineeringFixture('valid'), both = await service(legacy);
  const receipt = await both.compileEngineeringProject(legacy.project, 's');
  expect(receipt.state).toBe('compiled');
  const manifest = await both.readManifest('s', receipt.bundleDigest!);
  expect(manifest.files.map((x) => x.path)).toEqual(expect.arrayContaining(['nav2/amr-1.yaml', 'world.sdf']));
  expect(manifest.files.some((x) => x.path.startsWith('irsim/'))).toBe(false);
});

test.skipIf(!available)('wrong world or targets are refused with the compiler code, not corrected', async () => {
  const mutate = async (edit: (w: NonNullable<ReturnType<typeof navigationFixture>['fixture']['project']['runtimeProject']['world']['handoffPoints']>) => void) => {
    const f = structuredClone(navigationFixture('serve').fixture);
    edit(f.project.runtimeProject.world.handoffPoints!);
    return (await service(f)).compileEngineeringProject(f.project, 's');
  };
  const into = await mutate((h) => { h.find((x) => x.id === 't-05.handoff')!.position = [10, 3, 0]; });
  expect(into.state).toBe('blocked');
  expect(into.problems.map((p) => p.detail).join(' ')).toMatch(/TARGET_IN_COLLISION/);
  const outside = await mutate((h) => { h.find((x) => x.id === 't-05.handoff')!.position = [40, 3, 0]; });
  expect(outside.problems.map((p) => p.detail).join(' ')).toMatch(/TARGET_OUT_OF_WORLD/);
});

test.skipIf(!available)('the 2D profile refuses entities it does not simulate', async () => {
  const f = structuredClone(navigationFixture('serve').fixture);
  f.project.runtimeProject.entities[0]!.kind = 'arm' as never;
  const receipt = await (await service(f)).compileEngineeringProject(f.project, 's');
  expect(receipt.state).toBe('blocked');
});

test.skipIf(!available)('every named fixture compiles through the portable profile', async () => {
  for (const name of ['serve', 'wide', 'overhang', 'enclosed-goal'] as NavigationFixtureName[]) {
    const f = navigationFixture(name).fixture;
    const receipt = await (await service(f)).compileEngineeringProject(f.project, 's');
    expect(receipt.problems.filter((p) => p.blocking), name + JSON.stringify(receipt.problems)).toEqual([]);
  }
});
