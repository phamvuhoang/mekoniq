// Webots runs through the real /lab/v2 gateway: the server locks the bundle's projections by session ownership; a caller cannot supply the Webots home, a port, a world file,
// an interpreter, an entry or code, cannot borrow another session's bundle or run, and a WB scenario never lands on another set (or another on the Webots set).
import { afterEach, expect, test } from 'vitest';
import { readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startLabGateway, type LabGateway } from '../../packages/lab-runtime/src/gateway';
import { createEngineeringService } from '../../packages/lab-runtime/src/engineering/gateway';
import { createWebotsCompiler } from '../../packages/lab-runtime/src/engineering/webots-compiler';
import { portableSimulationFromOptions } from '../../packages/lab-runtime/src/v2/navigation2d/readiness';
import { webotsFromOptions } from '../../packages/lab-runtime/src/v2/simulation3d/readiness';
import { navigationFixture } from '../support/navigation2d';
import { coffeeProject } from '../support/lab-v2';
import { testCompiler, writeFixtureCatalog } from '../support/engineering';
import { WEBOTS_HOME, temp, webotsAvailable, webotsProcesses, webotsPython, webotsRoot } from '../support/webots-mission';

const WB = 'engineering-webots-3d-v1', runtimeIdentity = { sourceCommit: 'test-commit', schemaHash: 'a'.repeat(64) };
const gateways: LabGateway[] = [], dirs: string[] = [];
afterEach(async () => { for (const g of gateways.splice(0)) await g.close(); for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
async function pair(g: LabGateway) {
  const r = await fetch(g.url + '/lab/v2/sessions', { method: 'POST', headers: { origin: 'http://127.0.0.1:4175', 'content-type': 'application/json' }, body: JSON.stringify({ token: g.issuePairingToken() }) });
  return { cookie: r.headers.get('set-cookie')!.split(';')[0]!, origin: 'http://127.0.0.1:4175', 'content-type': 'application/json', 'x-csrf-token': String((await r.json()).csrfToken) };
}
const post = (g: LabGateway, h: Record<string, string>, path: string, body: unknown) => fetch(g.url + '/lab/v2' + path, { method: 'POST', headers: h, body: JSON.stringify(body) });
const get = (g: LabGateway, h: Record<string, string>, path: string) => fetch(g.url + '/lab/v2' + path, { headers: { cookie: h.cookie! } });
const runBody = (over: Record<string, unknown>) => ({ scenarioId: 'WB-FD01', scenarioRevision: 1, seed: 5, mode: 'simulation', access: 'simulated', backendSetId: WB, runtimeIdentity, ...over });

async function gateway(on: boolean) {
  const root = await temp('webots-sec-'); dirs.push(root);
  const f = navigationFixture('serve-3d').fixture, catalogRoot = join(root, 'catalog');
  await writeFixtureCatalog(catalogRoot, f as never);
  const engineering = createEngineeringService({ directory: join(root, 'engineering'), catalogRoot, compiler: testCompiler, compilers: { [WB]: createWebotsCompiler() } });
  const bundleFile = (d: string, x: string) => engineering.bundleFile(d, x);
  const webots = await webotsFromOptions({ enabled: on, python: webotsPython, workerRoot: webotsRoot, lockPath: join(webotsRoot, 'requirements.lock'), webotsHome: WEBOTS_HOME, directory: join(root, 'runs'), bundleFile });
  const p = await portableSimulationFromOptions({ enabled: false, python: 'python3', workerRoot: resolve('robotics/navigation-2d'), lockPath: resolve('robotics/navigation-2d/requirements.lock'), directory: join(root, 'runs'), bundleFile, webots });
  const g = await startLabGateway({ port: 0, directory: join(root, 'runs'), sourceCommit: 'test-commit', schemaHash: 'a'.repeat(64), v2: { catalog: p.catalog, enabledBackends: ['mock_amr', 'mock_coffee', 'mock_arm', ...p.enabledBackends], simulationFactory: p.simulationFactory, ...p.readinessChecks ? { portableChecks: p.readinessChecks } : {}, engineering } });
  gateways.push(g);
  return { g, f, root };
}

test.skipIf(!webotsAvailable)('Webots runs: server-locked projections, no caller home/port/world/code, bundle and run ownership, no cross-set scenarios', async () => {
  const { g, f, root } = await gateway(true), a = await pair(g), b = await pair(g);
  const health = await (await get(g, a, '/health')).json() as { capabilities: string[]; backends: { id: string; installed: boolean; enabled: boolean }[]; backendSets: { id: string; execution?: { host: string } }[] };
  expect(health.capabilities).toEqual(expect.arrayContaining(['engineering_bundle_v1', 'sim3d_navigation_v1', 'sim3d_arm_v1']));
  expect(health.backends.find((x) => x.id === 'webots_3d')).toMatchObject({ installed: true, enabled: true });
  expect(health.backendSets.find((s) => s.id === WB)!.execution).toMatchObject({ host: 'portable_python', clock: 'source_fixed_step' });
  const receipt = await (await post(g, a, '/engineering/compile', { project: f.project })).json() as { state: string; bundleDigest: string; projectDigest: string };
  expect(receipt.state).toBe('compiled');
  const ref = { bundleDigest: receipt.bundleDigest, projectDigest: receipt.projectDigest };
  // caller-supplied Webots home, port, world file, executable, interpreter, entry or code are not fields of a run or a readiness request
  for (const extra of [{ webotsHome: '/tmp/evil.app' }, { port: 1234 }, { wbtPath: '/tmp/evil.wbt' }, { worldFile: 'x.wbt' }, { executable: '/bin/sh' }, { python: '/bin/sh' }, { workerRoot: '/tmp' }, { entry: ['-c', 'print(1)'] }, { scene: { documentType: 'navigation-scene' } }, { controller: 'evil.py' }]) {
    const r = await post(g, a, '/runs', runBody({ engineeringRef: ref, ...extra }));
    expect(r.status, JSON.stringify(extra)).toBe(422); expect((await r.json()).error).toBe('INVALID_RUN_REQUEST');
    expect((await post(g, a, '/readiness', { scenarioId: 'WB-FD01', backendSetId: WB, engineeringRef: ref, ...extra })).status, JSON.stringify(extra)).toBe(400);
  }
  // another session's bundle, a project that is not the bundle's projection, no bundle at all
  expect((await post(g, b, '/runs', runBody({ engineeringRef: ref }))).status).toBe(403);
  const forged = structuredClone(f.project.runtimeProject) as { world: { width: number } }; forged.world.width = 30;
  const mismatch = await post(g, a, '/runs', runBody({ engineeringRef: ref, project: forged }));
  expect(mismatch.status).toBe(409); expect((await mismatch.json()).error).toBe('ENGINEERING_IDENTITY_MISMATCH');
  const noRef = await post(g, a, '/runs', runBody({ project: f.project.runtimeProject }));
  expect(noRef.status).toBe(422); expect((await noRef.json()).reasonCodes).toEqual(['ENGINEERING_REF_REQUIRED']);
  // the Webots set runs only its own scenarios, and a WB scenario never runs on another set
  const legacy = await post(g, a, '/runs', runBody({ engineeringRef: ref, scenarioId: 'FD01' }));
  expect(legacy.status).toBe(422); expect((await legacy.json()).reasonCodes).toEqual(['SCENARIO_UNSUPPORTED_BY_SET']);
  const ir = await post(g, a, '/runs', runBody({ engineeringRef: ref, scenarioId: 'IR-FD01' }));
  expect(ir.status).toBe(422); expect((await ir.json()).reasonCodes).toEqual(['SCENARIO_UNSUPPORTED_BY_SET']);
  const wbOnMock = await post(g, a, '/runs', runBody({ project: f.project.runtimeProject, mode: 'mock', backendSetId: 'mock-amr' }));
  expect(wbOnMock.status).toBe(422); expect((await wbOnMock.json()).reasonCodes).toEqual(['SCENARIO_UNSUPPORTED_BY_SET']);
  // the owner's run executes on webots_3d with the bundle's own projection; the other session sees nothing
  const created = await post(g, a, '/runs', runBody({ engineeringRef: ref }));
  expect(created.status, await created.clone().text()).toBe(201);
  const run = await created.json() as { run: { id: string; backends: string[]; runRevision: number } };
  expect(run.run.backends).toEqual(['webots_3d']);
  expect((await get(g, b, `/runs/${run.run.id}`)).status).toBe(404);
  expect((await post(g, b, `/runs/${run.run.id}/actions`, { actionId: 'x', expectedRevision: run.run.runRevision, kind: 'start', payload: {} })).status).toBe(404);
  const started = await post(g, a, `/runs/${run.run.id}/actions`, { actionId: 's', expectedRevision: run.run.runRevision, kind: 'start', payload: {} });
  expect(started.status, await started.clone().text()).toBe(200);
  const report = await (await get(g, a, `/runs/${run.run.id}/report`)).json() as { manifest: { engineering: unknown; backends: { id: string }[]; scenario: { id: string } } };
  expect(report.manifest).toMatchObject({ engineering: ref, scenario: { id: 'WB-FD01' } }); expect(report.manifest.backends.map((x) => x.id)).toEqual(['webots_3d']);
  // the run's locked scene is its own copy of the bundle's, not something a request could point at
  const runDirs = (await readdir(join(root, 'runs'), { withFileTypes: true })).filter((d) => d.isDirectory() && d.name !== 'webots-probe');
  expect(runDirs).toHaveLength(1);
  expect((await readdir(join(root, 'runs', runDirs[0]!.name, 'bundle'))).sort()).toEqual(['navigation-scene.json', 'physical-model']);
  await g.close(); gateways.length = 0;
  await new Promise((r) => setTimeout(r, 500));
  expect(webotsProcesses()).toEqual([]);
}, 180_000);

test.skipIf(!webotsAvailable)('without the provider configured nothing is advertised and a Webots run is refused, never moved to mock, native or IR-SIM', async () => {
  const { g, f } = await gateway(false), a = await pair(g);
  const health = await (await get(g, a, '/health')).json() as { capabilities: string[]; backends: { id: string; installed: boolean; enabled: boolean }[] };
  expect(health.capabilities).not.toContain('sim3d_navigation_v1');
  expect(health.capabilities).not.toContain('sim3d_arm_v1');
  expect(health.backends.find((x) => x.id === 'webots_3d')).toMatchObject({ installed: false, enabled: false });
  const receipt = await (await post(g, a, '/engineering/compile', { project: f.project })).json() as { bundleDigest: string; projectDigest: string };
  const refused = await post(g, a, '/runs', runBody({ engineeringRef: { bundleDigest: receipt.bundleDigest, projectDigest: receipt.projectDigest } }));
  expect(refused.status).toBe(422); expect((await refused.json()).reasonCodes).toEqual(expect.arrayContaining(['BACKEND_NOT_INSTALLED']));
}, 120_000);

// R1.1: the arm set runs from the request's own project (its scene is built from it): no bundle, so no engineering ref, while the bundle sets keep requiring one
test.skipIf(!webotsAvailable)('the arm set answers readiness for a project without an engineering ref (grip is an event, not a provider); a bundle set still refuses without one', async () => {
  const { g } = await gateway(true), a = await pair(g);
  const ready = await post(g, a, '/readiness', { scenarioId: 'WB-BV01', backendSetId: 'engineering-webots-arm-v1', project: coffeeProject() });
  expect(ready.status).toBe(200);
  const answer = await ready.json() as { canStart: boolean; checks: { id: string; reasonCodes: string[] }[] };
  expect(answer.checks.filter((c) => c.reasonCodes.length)).toEqual([]); expect(answer.canStart).toBe(true);
  const bundleSet = await post(g, a, '/readiness', { scenarioId: 'WB-FD01', backendSetId: WB, project: coffeeProject() });
  expect(bundleSet.status).toBe(422); expect((await bundleSet.json()).error).toBe('ENGINEERING_REF_REQUIRED');
  const run = await post(g, a, '/runs', { scenarioId: 'WB-FD01', scenarioRevision: 1, seed: 5, mode: 'simulation', access: 'simulated', backendSetId: WB, runtimeIdentity, project: coffeeProject() });
  expect(run.status).toBe(422); expect((await run.json()).error).toBe('ENGINEERING_REF_REQUIRED');
}, 180_000);
