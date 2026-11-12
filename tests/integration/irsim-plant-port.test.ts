// W04: the fixed-step runner moves behind a plant port without changing what IR-SIM records. The golden below was written BEFORE the split:
// the sha256 of every stored evidence chunk (decompressed NDJSON, by stream and index) of IR-FD01 (seed 5) and IR-FD07 (seed 7) on the real IR-SIM worker.
// UPDATE_GOLDEN=1 rewrites it. Skipped, with the reason, where the pinned IR-SIM venv is not provisioned.
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createFixedStepScenarioRun, createIRSimScenarioRun } from '../../packages/lab-runtime/src/v2/navigation2d/runner';
import { irsimPlant, type PlantPort } from '../../packages/lab-runtime/src/v2/navigation2d/plant';
import { plantDispatcher, portableCatalog } from '../../packages/lab-runtime/src/v2/navigation2d/readiness';
import type { ScenarioRun } from '../../packages/lab-runtime/src/v2/scenario-runner';
import type { WallClock } from '../../packages/lab-runtime/src/v2/pace';
import { act, double, finish, irsimAvailable, irsimBundle, irsimInput, irsimProviders, openRun, removeBundles, temp } from '../support/irsim-mission';

const GOLDEN = 'tests/fixtures/navigation2d/ir-chunk-hashes.json';
let serve: Awaited<ReturnType<typeof irsimBundle>>, fleet: Awaited<ReturnType<typeof irsimBundle>>;
const runs: ScenarioRun[] = [], dirs: string[] = [];
beforeAll(async () => { if (irsimAvailable) { serve = await irsimBundle(); fleet = await irsimBundle('fleet'); } }, 240_000);
afterAll(removeBundles);
afterEach(async () => { for (const r of runs.splice(0)) await r.close().catch(() => {}); for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

/** `stream-index` -> sha256 of the decompressed NDJSON of that chunk (the file names carry a random suffix and are not part of the identity). */
async function chunkHashes(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const f of (await readdir(join(dir, 'evidence'))).sort()) {
    const m = /^(trajectory|sensors|control|collisions)-(\d{6})-[0-9a-f]{8}\.ndjson\.gz$/.exec(f);
    if (m) out[`${m[1]}-${m[2]}`] = sha(gunzipSync(await readFile(join(dir, 'evidence', f))));
  }
  return out;
}
async function runFd01() {
  const dir = await temp('irsim-port-'); dirs.push(dir);
  const run = await openRun(dir, serve, {}, 5); runs.push(run);
  await run.start(); await finish(run, 500, 30000);
  return { dir, report: await run.report() };
}
async function runFd07() {
  const dir = await temp('irsim-port-'); dirs.push(dir);
  const run = await createIRSimScenarioRun({ project: fleet.locked.runtimeProjection.project, scenarioId: 'IR-FD07', scenarioRevision: 1, seed: 7, mode: 'simulation', access: 'simulated', backendSetId: 'engineering-irsim-2d-v1', sourceCommit: 'test-commit', engineering: fleet.locked }, await irsimProviders(dir, fleet.service));
  runs.push(run); await run.start(); await finish(run, 500, 12000);
  return { dir, report: await run.report() };
}

test.skipIf(!irsimAvailable)('IR-FD01 and IR-FD07 write the same evidence chunks as before the plant-port split', async () => {
  const [a, b] = [await runFd01(), await runFd07()];
  expect(a.report.outcome.status).toBe('completed'); expect(b.report.outcome.status).toBe('completed');
  const actual = { 'IR-FD01@5': await chunkHashes(a.dir), 'IR-FD07@7': await chunkHashes(b.dir) };
  for (const k of Object.keys(actual)) expect(Object.keys(actual[k as keyof typeof actual]).length, k).toBeGreaterThan(0);
  if (process.env.UPDATE_GOLDEN === '1') { await writeFile(GOLDEN, JSON.stringify(actual, null, 2) + '\n'); return; }
  expect(actual).toEqual(JSON.parse(await readFile(GOLDEN, 'utf8')));
}, 600_000);

test('the dispatcher refuses a portable set whose amr provider has no plant', async () => {
  const catalog = portableCatalog(true);
  const set = catalog.sets['engineering-irsim-2d-v1']!;
  const odd = { ...catalog, sets: { ...catalog.sets, 'odd-set': { ...set, providers: { ...set.providers, amr: 'no_such_plant' } } } };
  const run = plantDispatcher(odd, { irsim_2d: { port: irsimPlant(), runtime: { python: 'p', workerRoot: 'w', schemaDir: 's', lockDigest: 'l' } } });
  await expect(run({ backendSetId: 'odd-set' } as never, {} as never)).rejects.toThrow('BACKEND_EXECUTION_DISABLED');
  const none = plantDispatcher(catalog, undefined);
  await expect(none({ backendSetId: 'engineering-irsim-2d-v1' } as never, {} as never)).rejects.toThrow('BACKEND_EXECUTION_DISABLED');
});

test.skipIf(!irsimAvailable)('the plant, not the runner, names the backend, limitations and coverage a run reports', async () => {
  const dir = await temp('irsim-port-'); dirs.push(dir);
  const base = irsimPlant();
  const marked: PlantPort = { ...base, identity: { ...base.identity, limitations: ['PLANT-DOUBLE-LIMITATION'], coverage: { dynamics: true } } };
  const providers = await irsimProviders(dir, serve.service);
  const run = await createFixedStepScenarioRun({ project: serve.locked.runtimeProjection.project, scenarioId: 'IR-FD01', scenarioRevision: 1, seed: 5, mode: 'simulation', access: 'simulated', backendSetId: 'engineering-irsim-2d-v1', sourceCommit: 'test-commit', engineering: serve.locked }, { ...providers, plant: marked, runtime: providers.irsim });
  runs.push(run);
  const r = await run.report();
  expect(r.limitations).toContain('PLANT-DOUBLE-LIMITATION');
  expect(r.limitations.some((l) => l.startsWith('irsim_2d simulated plant'))).toBe(false);
  expect(r.coverage.dynamics).toBe(true);
  expect(r.manifest.backends).toEqual([{ ...base.identity.amr }]);
});

test.skipIf(!irsimAvailable)('a plant with another backend id is refused by the set that names a different provider', async () => {
  const dir = await temp('irsim-port-'); dirs.push(dir);
  const base = irsimPlant(), other: PlantPort = { ...base, identity: { ...base.identity, amr: { ...base.identity.amr, id: 'other_plant' } } };
  const providers = await irsimProviders(dir, serve.service);
  await expect(createFixedStepScenarioRun({ project: serve.locked.runtimeProjection.project, scenarioId: 'IR-FD01', scenarioRevision: 1, seed: 5, mode: 'simulation', access: 'simulated', backendSetId: 'engineering-irsim-2d-v1', sourceCommit: 'test-commit', engineering: serve.locked }, { ...providers, plant: other, runtime: providers.irsim })).rejects.toThrow('BACKEND_EXECUTION_DISABLED');
});

// N02 (D57): the fixed-step runner takes the same `pace`; pacing only delays a tick, so the evidence it records is the unpaced run's, byte for byte.
test.skipIf(!irsimAvailable)('a paced step sleeps each tick to its slot; without pace the wall is never touched and the chunks keep the golden', async () => {
  const clock = () => { const w = { t: 0, calls: 0, sleeps: [] as number[] }; const wall: WallClock = { now: () => { w.calls++; return w.t; }, sleep: async (ms) => { w.calls++; w.sleeps.push(ms); w.t += ms; } }; return { w, wall }; };
  const open = async (wall: WallClock) => { const dir = await temp('irsim-pace-'); dirs.push(dir); const run = await createIRSimScenarioRun(irsimInput(serve.locked, 5), { ...await irsimProviders(dir, serve.service, { entry: [double('logged.py')] }), wall }); runs.push(run); await run.start(); return { dir, run }; };
  const paced = clock(), plain = clock(), golden = clock();
  const a = await open(paced.wall), b = await open(plain.wall);
  for (let i = 0; i < 10; i++) { await act(a.run, 'step', { ticks: 20, pace: { factor: 4 } }); await act(b.run, 'step', { ticks: 20 }); }
  expect((await a.run.snapshot()).tick).toBe(200); expect((await b.run.snapshot()).tick).toBe(200);
  // 200 ticks at 4x: 1000 ms of wall time, the first tick (the anchor) starting at once
  const slept = paced.w.sleeps.reduce((x, y) => x + y, 0); expect(Math.abs(slept - 1000)).toBeLessThanOrEqual(20); expect(paced.w.sleeps.length).toBe(199);
  expect(plain.w.calls).toBe(0);
  await a.run.close(); await b.run.close();
  const ha = await chunkHashes(a.dir); expect(Object.keys(ha).length).toBeGreaterThan(0); expect(ha).toEqual(await chunkHashes(b.dir));
  // the golden run, unpaced, with a counting wall: not one call, every chunk as recorded before
  const dir = await temp('irsim-pace-'); dirs.push(dir);
  const run = await createIRSimScenarioRun(irsimInput(serve.locked, 5), { ...await irsimProviders(dir, serve.service), wall: golden.wall }); runs.push(run);
  await run.start(); await finish(run, 500, 30000); expect((await run.report()).outcome.status).toBe('completed');
  expect(golden.w.calls).toBe(0);
  expect(await chunkHashes(dir)).toEqual(JSON.parse(await readFile(GOLDEN, 'utf8'))['IR-FD01@5']);
}, 600_000);
