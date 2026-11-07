// The runtime offers engineering only when its operator opted in with a catalog and a working compiler; otherwise the capability is simply absent.
import { afterEach, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { startLabGateway, type LabGateway } from '../../packages/lab-runtime/src/gateway';
import { engineeringFromOptions } from '../../packages/lab-runtime/src/engineering/runtime-options';

const venv = resolve('.venv/bin/python'), python = process.env.ENGINEERING_PYTHON ?? (existsSync(venv) ? venv : 'python3');
const available = (() => { try { execFileSync(python, ['-c', 'import rfc8785, jsonschema, referencing, yaml'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const roots: string[] = [], gateways: LabGateway[] = [];
afterEach(async () => { for (const g of gateways.splice(0)) await g.close(); for (const d of roots.splice(0)) await rm(d, { recursive: true, force: true }); });
const temp = async () => { const d = await mkdtemp(join(tmpdir(), 'eng-opts-')); roots.push(d); return d; };
const pair = async (g: LabGateway) => { const r = await fetch(g.url + '/lab/v2/sessions', { method: 'POST', headers: { origin: 'http://127.0.0.1:4175', 'content-type': 'application/json' }, body: JSON.stringify({ token: g.pairingToken }) }); return { cookie: r.headers.get('set-cookie')!.split(';')[0]!, origin: 'http://127.0.0.1:4175', 'content-type': 'application/json', 'x-csrf-token': String((await r.json()).csrfToken) }; };

test('without opt-in flags there is no engineering service and no capability', async () => {
  expect(await engineeringFromOptions({ directory: await temp() })).toBeUndefined();
  const g = await startLabGateway({ port: 0, directory: await temp(), sourceCommit: 'c', schemaHash: 'a'.repeat(64) }); gateways.push(g);
  expect((await (await fetch(g.url + '/lab/v2/health')).json()).capabilities).toEqual([]);
});
test('half-configured or broken options fail loudly instead of advertising a capability that cannot work', async () => {
  const directory = await temp();
  await expect(engineeringFromOptions({ directory, catalogRoot: resolve('robotics/catalog') })).rejects.toThrow(/ENGINEERING_SIMULATION_ROOT_REQUIRED/);
  await expect(engineeringFromOptions({ directory, catalogRoot: resolve('robotics/catalog'), simulationRoot: '/nonexistent' })).rejects.toThrow(/ENGINEERING_SIMULATION_ROOT_INVALID/);
  await expect(engineeringFromOptions({ directory, catalogRoot: '/nonexistent', simulationRoot: resolve('robotics/simulation'), python })).rejects.toThrow(/ENGINEERING_CATALOG_UNREADABLE/);
  await expect(engineeringFromOptions({ directory, catalogRoot: resolve('robotics/catalog'), simulationRoot: resolve('robotics/simulation'), python: '/nonexistent/python' })).rejects.toThrow(/ENGINEERING_COMPILER_UNAVAILABLE/);
});
test.skipIf(!available)('with a catalog and a working compiler the runtime compiles the reference project, serves the scene, and still refuses to start a native run', async () => {
  const directory = await temp();
  const engineering = await engineeringFromOptions({ directory, catalogRoot: resolve('robotics/catalog'), simulationRoot: resolve('robotics/simulation'), python });
  const g = await startLabGateway({ port: 0, directory: join(directory, 'runs'), sourceCommit: 'c', schemaHash: 'a'.repeat(64), v2: { engineering } }); gateways.push(g);
  const h = await pair(g);
  expect((await (await fetch(g.url + '/lab/v2/health')).json()).capabilities).toEqual(['engineering_bundle_v1']);
  const project = JSON.parse(await readFile('tests/fixtures/engineering/fd01.project.json', 'utf8'));
  const receipt = await (await fetch(g.url + '/lab/v2/engineering/compile', { method: 'POST', headers: h, body: JSON.stringify({ project }) })).json();
  expect(receipt).toMatchObject({ state: 'compiled', runnable: false });
  const manifest = await (await fetch(g.url + `/lab/v2/engineering/bundles/${receipt.bundleDigest}/manifest`, { headers: { cookie: h.cookie } })).json();
  const scene = manifest.files.find((f: { path: string }) => f.path === 'scene.json');
  const blob = await fetch(g.url + `/lab/v2/engineering/blobs/${scene.sha256}`, { headers: { cookie: h.cookie } });
  expect(JSON.parse(await blob.text()).wheelBindings).toHaveLength(2);
  const run = await fetch(g.url + '/lab/v2/runs', { method: 'POST', headers: h, body: JSON.stringify({ engineeringRef: { bundleDigest: receipt.bundleDigest, projectDigest: receipt.projectDigest }, scenarioId: 'FD01', scenarioRevision: 1, seed: 23, mode: 'simulation', access: 'simulated', backendSetId: 'engineering-rigid-v1', runtimeIdentity: { sourceCommit: 'c', schemaHash: 'a'.repeat(64) } }) });
  expect(run.status).toBeGreaterThanOrEqual(422);   // gazebo_nav2 is not installed here: Start stays blocked, never falls back
  expect((await run.json()).error).toMatch(/BACKEND_UNAVAILABLE/);
});
