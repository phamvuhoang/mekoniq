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
  expect(PORTABLE_TOOL_PATHS).toEqual(['robotics/navigation-2d', 'robotics/model-validation', 'robotics/algorithm', 'robotics/simulation-3d', 'robotics/simulation-mujoco', 'robotics/simulation/compiler', 'robotics/simulation/actors', 'robotics/simulation/worlds', 'packages/contracts/schemas']);
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

// review5 #6: the closure digest binds the source files, so the interpreter must run them, never bytecode planted beside them
const plant = `import os,py_compile,sys
d=sys.argv[1];os.makedirs(d,exist_ok=True);src=os.path.join(d,'m.py')
open(src,'w').write("print('planted')\\n");py_compile.compile(src,cfile=os.path.join(d,'__pycache__','m.cpython-%d%d.pyc'%sys.version_info[:2]))
st=os.stat(src);open(src,'w').write("print('source!')\\n");os.utime(src,ns=(st.st_atime_ns,st.st_mtime_ns))`;
test.skipIf(!available)('review5 #6: a planted __pycache__ whose header matches the source is ignored by every tool interpreter launch', async () => {
  const { bytecodeEnv } = await import('../../packages/lab-runtime/src/engineering/python-env');
  const tree = await mkdtemp(join(tmpdir(), 'pycache-plant-')); roots.push(tree);
  execFileSync(irPython, ['-I', '-c', plant, tree]);
  const runM = (env: object) => execFileSync(irPython, ['-c', 'import m'], { cwd: tree, env: { PATH: '/usr/bin:/bin', PYTHONPATH: tree, ...env } as unknown as NodeJS.ProcessEnv, encoding: 'utf8' }).trim();
  expect(runM({ PYTHONDONTWRITEBYTECODE: '1' })).toBe('planted'); // the attack: writing is off, reading is not
  expect(runM(bytecodeEnv())).toBe('source!');
  expect(bytecodeEnv().PYTHONPYCACHEPREFIX).toBe(bytecodeEnv().PYTHONPYCACHEPREFIX);
});
test('review5 #6: every spawn site of a pinned Python tool sets the bytecode environment', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const f of ['packages/lab-runtime/src/v2/navigation2d/worker-client.ts', 'packages/lab-runtime/src/engineering/linkforge.ts', 'packages/lab-runtime/src/engineering/navigation-compiler.ts', 'packages/lab-runtime/src/engineering/runtime-options.ts', 'packages/lab-runtime/src/engineering/compiler.ts']) {
    const text = await readFile(resolve(f), 'utf8'), spawns = text.match(/\b(spawn|execFile|run)\(/g)?.length ?? 0;
    expect(spawns, f).toBeGreaterThan(0);
    expect(text.match(/bytecodeEnv\(\)/g)?.length ?? 0, f).toBeGreaterThanOrEqual(f.endsWith('runtime-options.ts') ? 3 : 1);
  }
});

// ---- C02 fix pass F3: a sitecustomize.py / usercustomize.py planted in a tool root never runs in the worker or the compiler ----
import { spawnIRSimWorker } from '../../packages/lab-runtime/src/v2/navigation2d/worker-client';
import { lockDigestOf } from '../../packages/lab-runtime/src/engineering/linkforge';
import { writeFile } from 'node:fs/promises';
test.skipIf(!available)('F3: an untracked sitecustomize.py/usercustomize.py in the worker and helper roots is not imported by the worker or the portable compiler (isolated start, roots added after site)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mekoniq-sitecustomize-')); roots.push(root);
  // a copy of the closure files, plus the plants: each writes a marker file if it is ever imported
  for (const f of closure().files) { await mkdir(dirname(join(root, f.path)), { recursive: true }); await copyFile(resolve(f.path), join(root, f.path)); }
  const markers = join(root, 'markers');await mkdir(markers);
  for (const dir of ['robotics/navigation-2d', 'robotics/simulation']) for (const name of ['sitecustomize', 'usercustomize'])
    await writeFile(join(root, dir, `${name}.py`), `import pathlib\npathlib.Path(${JSON.stringify(markers)}, ${JSON.stringify(`${dir.replace('/', '_')}_${name}`)}).write_text("ran")\n`);
  const workerRoot = join(root, 'robotics/navigation-2d'), bundle = join(root, 'bundle'); await mkdir(bundle);
  const w = await spawnIRSimWorker({ python: irPython, workerRoot, runId: 'plant', bundleRoot: bundle, runDirectory: join(root, 'run'), lockDigest: await lockDigestOf(join(workerRoot, 'requirements.lock')), schemaDir: join(root, 'packages/contracts/schemas') });
  try { const r = await w.request({ protocol: 'mekoniq-irsim/1', requestId: 'd', runId: 'plant', expectedTick: 0, op: 'describe', payload: {} }); expect(r.ok).toBe(true); } finally { await w.close('done'); }
  const { input } = navigationFixture('serve');
  await createNavigationCompiler({ python: irPython, workerRoot, descriptionHelperRoot: join(root, 'robotics/simulation') }).compileResolved(input, join(root, 'out'));
  expect(existsSync(join(root, 'out', 'navigation-scene.json'))).toBe(true);
  expect(execFileSync('ls', [markers], { encoding: 'utf8' }).trim()).toBe('');
}, 180_000);
