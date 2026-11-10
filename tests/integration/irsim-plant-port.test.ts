// W04: the fixed-step runner moves behind a plant port without changing what IR-SIM records. The golden below was written BEFORE the split:
// the sha256 of every stored evidence chunk (decompressed NDJSON, by stream and index) of IR-FD01 (seed 5) and IR-FD07 (seed 7) on the real IR-SIM worker.
// UPDATE_GOLDEN=1 rewrites it. Skipped, with the reason, where the pinned IR-SIM venv is not provisioned.
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createIRSimScenarioRun } from '../../packages/lab-runtime/src/v2/navigation2d/runner';
import type { ScenarioRun } from '../../packages/lab-runtime/src/v2/scenario-runner';
import { finish, irsimAvailable, irsimBundle, irsimProviders, openRun, removeBundles, temp } from '../support/irsim-mission';

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
