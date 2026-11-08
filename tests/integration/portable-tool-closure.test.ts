// The portable tool closure is sufficient: a tree holding ONLY its files runs the real IR-SIM compile path (import closure of irsim_worker.compile → compiler → worlds/actors).
import { afterEach, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createNavigationCompiler } from '../../packages/lab-runtime/src/engineering/navigation-compiler';
import { navigationFixture } from '../support/navigation2d';
import { portableToolClosure, PORTABLE_TOOL_PATHS } from '../../scripts/native-sim/tool-identity.mjs';

const irPython = resolve('.venv-irsim/bin/python');
const available = existsSync(irPython) && (() => { try { execFileSync(irPython, ['-c', 'import irsim, yaml, rfc8785, jsonschema, referencing'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const roots: string[] = [];
afterEach(async () => { for (const d of roots.splice(0)) await rm(d, { recursive: true, force: true }); });
const closure = () => portableToolClosure(resolve('.')) as { files: { path: string }[] };

test('portable closure lists every module the IR-SIM compile path imports from robotics/simulation', () => {
  expect(PORTABLE_TOOL_PATHS).toEqual(['robotics/navigation-2d', 'robotics/model-validation', 'robotics/simulation/compiler', 'robotics/simulation/actors', 'robotics/simulation/worlds', 'packages/contracts/schemas']);
  const paths = closure().files.map((f) => f.path);
  expect(paths).toEqual(expect.arrayContaining(['robotics/simulation/compiler/__init__.py', 'robotics/simulation/compiler/compile_world.py', 'robotics/simulation/worlds/__init__.py', 'robotics/simulation/worlds/generate_restaurant.py',
    'robotics/simulation/actors/__init__.py', 'robotics/simulation/actors/blocker.py', 'robotics/simulation/actors/scenario.py', 'robotics/simulation/actors/pedestrian.py']));
  expect(paths.filter((p) => p.startsWith('robotics/simulation/') && !/^robotics\/simulation\/(compiler|actors|worlds)\//.test(p))).toEqual([]);
});

test.skipIf(!available)('a tree holding only the closure files imports and runs the real IR-SIM compile', async () => {
  const tree = await mkdtemp(join(tmpdir(), 'portable-closure-')); roots.push(tree);
  for (const { path } of closure().files) { await mkdir(dirname(join(tree, path)), { recursive: true }); await copyFile(resolve(path), join(tree, path)); }
  const workerRoot = join(tree, 'robotics/navigation-2d'), helper = join(tree, 'robotics/simulation');
  // isolated interpreter, only the closure on sys.path: an out-of-closure import raises ImportError here
  execFileSync(irPython, ['-I', '-B', '-c', `import sys;sys.path[:0]=[${JSON.stringify(workerRoot)},${JSON.stringify(helper)}];import compiler.description, irsim_worker.compile, irsim_worker.__main__`], { cwd: tree, stdio: 'pipe' });
  const out = join(tree, 'bundle');
  const files = await createNavigationCompiler({ python: irPython, workerRoot, descriptionHelperRoot: helper }).compileResolved(navigationFixture('serve').input, out);
  expect(JSON.stringify(files)).toContain('navigation-scene.json');
}, 120000);
