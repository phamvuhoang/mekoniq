// Provider-specific readiness and registration of the Webots 3D provider. The flag, interpreter, worker and Webots home are operator options; test doubles qualify the wiring
// and never make the provider installed. Nothing here starts Webots.
import { afterAll, afterEach, expect, test } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defaultCatalog } from '../../packages/lab-runtime/src/v2/capabilities';
import { portableSimulationFromOptions } from '../../packages/lab-runtime/src/v2/navigation2d/readiness';
import { webotsFromOptions } from '../../packages/lab-runtime/src/v2/simulation3d/readiness';
import { hashJson } from '../../packages/lab-runtime/src/v2/hash';

const root = resolve('robotics/simulation-3d'), lockPath = join(root, 'requirements.lock'), FX = join(root, 'fixtures', 'serve-3d-v1');
const dirs: string[] = [];
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
afterAll(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
const temp = async () => { const d = await mkdtemp(join(tmpdir(), 'webots-ready-')); dirs.push(d); return d; };
const double = (mode: string) => [resolve('tests/support/webots_doubles/wire.py'), mode];
/** A directory that looks like an installed Webots.app to the existence check only. */
async function fakeHome() { const d = await temp(), exe = join(d, 'Webots.app', 'Contents', 'MacOS', 'webots'); await mkdir(join(d, 'Webots.app', 'Contents', 'MacOS'), { recursive: true }); await writeFile(exe, '#!/bin/sh\n'); await chmod(exe, 0o755); return join(d, 'Webots.app'); }
const opts = async (over: Partial<Parameters<typeof webotsFromOptions>[0]> = {}) => ({ enabled: true, python: 'python3', workerRoot: root, lockPath, webotsHome: await fakeHome(), directory: await temp(), ...over });
const state = (c: { backends: readonly { id: string }[] }) => c.backends.find((b) => b.id === 'webots_3d') as unknown as { installed: boolean; reachable: boolean; compatible: boolean; reason?: string };

test('flag off: the backend is the catalog entry of a runtime never given the option, and the rest of the catalog and the enabled backends are untouched', async () => {
  const off = await webotsFromOptions(await opts({ enabled: false }));
  expect(off.capability.reason?.startsWith('WEBOTS_DISABLED')).toBe(true);
  expect(off.plant).toBeUndefined();
  const base = { enabled: false, python: 'python3', workerRoot: resolve('robotics/navigation-2d'), lockPath: resolve('robotics/navigation-2d/requirements.lock'), directory: await temp() };
  const without = await portableSimulationFromOptions(base), withOff = await portableSimulationFromOptions({ ...base, webots: off });
  expect(withOff.catalog).toEqual(without.catalog);
  expect(withOff.enabledBackends).toEqual(without.enabledBackends);
  expect(state(defaultCatalog)).toMatchObject({ installed: false, reachable: false, compatible: false });
  expect(Object.keys(without.catalog.sets)).toEqual(Object.keys(defaultCatalog.sets));
});

test('Webots missing at the configured home is WEBOTS_NOT_INSTALLED, before any worker starts', async () => {
  const p = await webotsFromOptions(await opts({ webotsHome: join(await temp(), 'Webots.app'), python: '/nonexistent/python' }));
  expect(p.capability).toMatchObject({ installed: false, reachable: false });
  expect(p.capability.reason?.startsWith('WEBOTS_NOT_INSTALLED')).toBe(true);
});

test('a worker that reports Webots R2025b is WEBOTS_VERSION_MISMATCH', async () => {
  const p = await webotsFromOptions(await opts({ entry: double('r2025b') }));
  expect(p.capability.reason?.startsWith('WEBOTS_VERSION_MISMATCH')).toBe(true);
  expect(p.plant).toBeUndefined();
});

test('a worker admitted with a different lock is WEBOTS_LOCK_MISMATCH', async () => {
  const p = await webotsFromOptions(await opts({ entry: double('lock') }));
  expect(p.capability.reason).toBe('WEBOTS_LOCK_MISMATCH');
});

test('an unusable interpreter is WEBOTS_WORKER_UNAVAILABLE', async () => {
  const p = await webotsFromOptions(await opts({ python: '/nonexistent/python' }));
  expect(p.capability.reason?.startsWith('WEBOTS_WORKER_UNAVAILABLE')).toBe(true);
});

test('a test double passes the describe but never makes the backend installed or enabled', async () => {
  const p = await webotsFromOptions(await opts({ entry: double('ok') }));
  expect(p.capability).toMatchObject({ installed: false, reachable: false });
  expect(p.capability.reason?.startsWith('WEBOTS_TEST_DOUBLE')).toBe(true);
  expect(p.plant).toBeDefined(); // the wiring can be exercised ...
  const merged = await portableSimulationFromOptions({ enabled: false, python: 'python3', workerRoot: resolve('robotics/navigation-2d'), lockPath: resolve('robotics/navigation-2d/requirements.lock'), directory: await temp(), webots: p });
  expect(state(merged.catalog).installed).toBe(false);
  expect(merged.enabledBackends).not.toContain('webots_3d'); // ... but the backend stays unavailable
});

// the per-request rows, on a synthetic admitted bundle (the fixture scene and project; no engineering service)
async function context() {
  const scene = JSON.parse(await readFile(join(FX, 'navigation-scene.json'), 'utf8')) as { inputs: { project: { digest: string } } };
  const project = (JSON.parse(await readFile(join(FX, 'serve-3d-project.json'), 'utf8')) as { runtimeProject: unknown }).runtimeProject;
  const bytes = new TextEncoder().encode(JSON.stringify(scene));
  return { bundleFile: async (_d: string, path: string) => { if (path !== 'navigation-scene.json') throw new Error('NOT_FOUND'); return bytes; }, ctx: { scenarioId: 'IR-FD01', backendSetId: 'engineering-webots-3d-v1', project, engineering: { bundleDigest: 'b'.repeat(64), projectDigest: scene.inputs.project.digest } } };
}
const runnerRow = async (mode: string) => {
  const { bundleFile, ctx } = await context();
  const p = await webotsFromOptions(await opts({ entry: double(mode), bundleFile }));
  const rows = await p.readinessChecks!(ctx, new AbortController().signal);
  return rows.find((r) => r.id === 'runner')!;
};

test('the smoke create names a missing window-server session and a busy port', async () => {
  expect((await runnerRow('nogui')).reasonCodes).toEqual(['WEBOTS_NO_GUI_SESSION']);
  expect((await runnerRow('portbusy')).reasonCodes).toEqual(['WEBOTS_PORT_IN_USE']);
});

test('a scene that names another engine is refused before any worker starts', async () => {
  const { ctx } = await context();
  const irsim = JSON.parse(await readFile(join('robotics/navigation-2d/fixtures/serve-demo-v1', 'navigation-scene.json'), 'utf8')) as { inputs: { project: { digest: string } } };
  const bytes = new TextEncoder().encode(JSON.stringify(irsim));
  const p = await webotsFromOptions(await opts({ entry: double('ok'), bundleFile: async () => bytes }));
  const rows = await p.readinessChecks!({ ...ctx, engineering: { ...ctx.engineering, projectDigest: irsim.inputs.project.digest } }, new AbortController().signal);
  expect(rows.find((r) => r.id === 'model')!.reasonCodes).toContain('NAVIGATION_SCENE_ENGINE_MISMATCH');
  expect(hashJson(rows.map((r) => r.id))).toBe(hashJson(['profile', 'model', 'fixture', 'clock', 'runner']));
});
