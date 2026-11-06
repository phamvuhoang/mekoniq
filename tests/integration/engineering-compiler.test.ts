// Spawns the real Python compiler (no ROS): proves the TS pipeline, the schemas and compiler/engineering.py agree. Skipped, with the reason, where the pinned Python deps are absent.
import { afterEach, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createPythonCompiler } from '../../packages/lab-runtime/src/engineering/compiler';
import { createEngineeringService } from '../../packages/lab-runtime/src/engineering/gateway';
import { engineeringFixture, writeFixtureCatalog } from '../support/engineering';

const venv = resolve('.venv/bin/python'), python = process.env.ENGINEERING_PYTHON ?? (existsSync(venv) ? venv : 'python3');
const available = (() => { try { execFileSync(python, ['-c', 'import rfc8785, jsonschema, referencing, yaml'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const roots: string[] = [];
afterEach(async () => { for (const d of roots.splice(0)) await rm(d, { recursive: true, force: true }); });
const temp = async (p: string) => { const d = await mkdtemp(join(tmpdir(), p)); roots.push(d); return d; };
const compiler = () => createPythonCompiler({ python, simulationRoot: 'robotics/simulation' });

test.skipIf(!available)('the TypeScript pipeline output is accepted by the Python compiler and published as a bundle', async () => {
  const directory = await temp('eng-py-'), catalogRoot = await temp('eng-py-cat-'), f = engineeringFixture('valid');
  await writeFixtureCatalog(catalogRoot, f);
  const service = createEngineeringService({ directory, catalogRoot, compiler: compiler() });
  const receipt = await service.compileEngineeringProject(f.project, 'session');
  expect(receipt.problems.filter((p) => p.blocking)).toEqual([]);
  expect(receipt.state).toBe('compiled');
  if (receipt.state !== 'compiled') return;
  expect(receipt.runnable).toBe(false);
  const manifest = await service.readManifest('session', receipt.bundleDigest);
  expect(manifest.files.map((x) => x.path)).toEqual(expect.arrayContaining(['robots/amr-1.urdf', 'controllers/amr-1.yaml', 'nav2/amr-1.yaml', 'scene.json', 'map.pgm', 'world.sdf', 'engineering-project.json', 'bom.json']));
  const scene = JSON.parse(Buffer.from(await service.readBlob('session', manifest.files.find((x) => x.path === 'scene.json')!.sha256)).toString());
  expect(scene.wheelBindings.map((b: { id: string; radiusM: number }) => [b.id, b.radiusM])).toEqual([['amr-1/left', 0.1], ['amr-1/right', 0.1]]);
  // the same project compiles to the same bundle
  expect((await service.compileEngineeringProject(f.project, 'other')).bundleDigest).toBe(receipt.bundleDigest);
});

test.skipIf(!available)('a compiler refusal becomes a blocked receipt carrying the compiler code', async () => {
  const directory = await temp('eng-py-'), catalogRoot = await temp('eng-py-cat-'), f = engineeringFixture('valid');
  await writeFixtureCatalog(catalogRoot, f);
  const project = structuredClone(f.project);
  project.runtimeProject.world.points[0]!.x = 0.15; // inside the boundary-wall clearance of a robot footprint
  const receipt = await createEngineeringService({ directory, catalogRoot, compiler: compiler() }).compileEngineeringProject(project, 'session');
  expect(receipt.state).toBe('blocked');
  expect(receipt.problems.find((p) => p.code === 'COMPILER_FAILED')?.detail).toMatch(/TARGET_CLEARANCE/);
  expect(existsSync(join(directory, 'bundles'))).toBe(false);
});
