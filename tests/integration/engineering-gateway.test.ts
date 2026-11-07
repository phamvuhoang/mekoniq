// Portable engineering admission only: a test compiler and a protocol-double run stand in for Gazebo, so nothing here claims native execution.
import { afterEach, expect, test, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { startLabGateway, type LabGateway } from '../../packages/lab-runtime/src/gateway';
import { defaultCatalog } from '../../packages/lab-runtime/src/v2/capabilities';
import { createEngineeringService, type CompilerPort } from '../../packages/lab-runtime/src/engineering/gateway';
import { hashJson } from '../../packages/lab-runtime/src/v2/hash';
import type { ReadinessCheck } from '../../packages/lab-runtime/src/v2/readiness';
import type { RunProviders, ScenarioRun } from '../../packages/lab-runtime/src/v2/scenario-runner';
import { TelemetryRecorder } from '../../packages/lab-runtime/src/v2/telemetry';
import { engineeringFixture, testCompiler, writeFixtureCatalog } from '../support/engineering';

const roots: string[] = [], gateways: LabGateway[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const g of gateways.splice(0)) await g.close(); for (const d of roots.splice(0)) await rm(d, { recursive: true, force: true }); });
const temp = async (p: string) => { const d = await mkdtemp(join(tmpdir(), p)); roots.push(d); return d; };
const sha = (b: string | Uint8Array) => createHash('sha256').update(b).digest('hex');

const ids = ['gazebo_nav2'];
const catalog = () => ({ ...structuredClone(defaultCatalog), backends: defaultCatalog.backends.map((b) => ids.includes(b.id) ? { ...b, installed: true, compatible: true, reachable: true, commissioned: true } : b),
  sets: { ...defaultCatalog.sets, 'engineering-rigid-v1': { mode: 'simulation' as const, access: 'simulated' as const, backends: ['gazebo_nav2'] } } });
const checks = (): ReadinessCheck[] => ['model', 'clock', 'fixture', 'profile', 'runner', 'gripper'].map((id) => ({ id, status: 'ready', reasonCodes: [], evidenceRef: 'protocol_double' }));
const runtimeIdentity = { sourceCommit: 'test-commit', schemaHash: 'a'.repeat(64) };

/** A run double that keeps its id in the run directory, so a reclaim reopens the same run exactly like a native factory would. */
function factory(spy: { inputs: unknown[]; providers: RunProviders[] }) {
  return async (input: unknown, providers: RunProviders) => {
    spy.inputs.push(input); spy.providers.push(providers);
    await mkdir(providers.directory, { recursive: true });
    const idFile = join(providers.directory, 'run-id.txt');
    const id = await readFile(idFile, 'utf8').catch(async () => { const fresh = randomUUID(); await writeFile(idFile, fresh); return fresh; });
    const view = { run: { schemaVersion: 2, id, mode: 'simulation', access: 'simulated', backendSetId: 'engineering-rigid-v1', backends: ids, status: 'ready', runRevision: 0, eventCursor: null, telemetryCursor: null, fidelity: 'modeled', ageMs: 0, sourceCommit: 'test-commit', scenarioId: 'FD01', scenarioRevision: 1, seed: 7 }, tick: 0, simTimeNs: '0', model: 'physics_sim', entities: [], workload: [], awaiting: [], attention: [], served: '0', coffee: null };
    return { id, start: async () => view, action: async () => view, report: async () => ({ manifest: { runId: id } }), snapshot: async () => view, holdForReclaim: async () => view, close: async () => {}, telemetry: new TelemetryRecorder(), journal: async () => [], pulse: () => ({ tick: 0, paused: true, runRevision: 0 }) } as unknown as ScenarioRun;
  };
}

async function setup(opts: { compiler?: CompilerPort; limits?: { timeoutMs?: number; maxBundleBytes?: number }; withEngineering?: boolean; fixture?: string; directory?: string; catalogRoot?: string } = {}) {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
  const directory = opts.directory ?? await temp('eng-gw-'), catalogRoot = opts.catalogRoot ?? await temp('eng-cat-');
  const f = engineeringFixture(opts.fixture ?? 'valid');
  if (!opts.catalogRoot) await writeFixtureCatalog(catalogRoot, f);
  const spy = { inputs: [] as unknown[], providers: [] as RunProviders[] };
  const start = async () => {
    const engineering = opts.withEngineering === false ? undefined : createEngineeringService({ directory: join(directory, 'engineering'), catalogRoot, compiler: opts.compiler ?? testCompiler, limits: opts.limits });
    const g = await startLabGateway({ port: 0, directory: join(directory, 'runs'), sourceCommit: 'test-commit', schemaHash: 'a'.repeat(64), v2: { catalog: catalog(), enabledBackends: ids, simulationFactory: factory(spy), nativeChecks: async () => checks(), engineering } });
    gateways.push(g); return g;
  };
  return { f, directory, catalogRoot, spy, start };
}
async function pair(g: LabGateway) {
  const r = await fetch(g.url + '/lab/v2/sessions', { method: 'POST', headers: { origin: 'http://127.0.0.1:4175', 'content-type': 'application/json' }, body: JSON.stringify({ token: g.issuePairingToken() }) });
  return { cookie: r.headers.get('set-cookie')!.split(';')[0]!, origin: 'http://127.0.0.1:4175', 'content-type': 'application/json', 'x-csrf-token': String((await r.json()).csrfToken) };
}
const post = (g: LabGateway, h: Record<string, string>, path: string, body: unknown) => fetch(g.url + '/lab/v2' + path, { method: 'POST', headers: h, body: JSON.stringify(body) });
const get = (g: LabGateway, h: Record<string, string>, path: string) => fetch(g.url + '/lab/v2' + path, { headers: { cookie: h.cookie! } });
const runBody = (ref: unknown, over: Record<string, unknown> = {}) => ({ engineeringRef: ref, scenarioId: 'FD01', scenarioRevision: 1, seed: 7, mode: 'simulation', access: 'simulated', backendSetId: 'engineering-rigid-v1', runtimeIdentity, ...over });
const published = async (directory: string) => (await readdir(join(directory, 'engineering', 'bundles')).catch(() => [])).filter((n) => !n.startsWith('.'));

test('compile, read and create-run roundtrip through /lab/v2 with one pairing', async () => {
  const s = await setup(); const g = await s.start(); const h = await pair(g);
  expect((await (await get(g, h, '/health')).json()).capabilities).toContain('engineering_bundle_v1');
  const response = await post(g, h, '/engineering/compile', { project: s.f.project });
  expect(response.status).toBe(200);
  const compileReceipt = await response.json();
  expect(compileReceipt.state).toBe('compiled');
  if (compileReceipt.state !== 'compiled') throw new Error('EXPECTED_COMPILED_FIXTURE');
  expect(compileReceipt.runnable).toBe(false); // injected test compiler has no native qualification
  expect(compileReceipt.projectDigest).toBe(hashJson(s.f.project));
  const manifest = await (await get(g, h, `/engineering/bundles/${compileReceipt.bundleDigest}/manifest`)).json();
  expect(manifest.projectDigest).toBe(compileReceipt.projectDigest);
  expect(manifest.profile).toBe('engineering-rigid-v1');
  const scene = manifest.files.find((f: { path: string }) => f.path === 'scene.json');
  const blob = await get(g, h, `/engineering/blobs/${scene.sha256}`);
  expect(blob.status).toBe(200);
  expect(sha(new Uint8Array(await blob.arrayBuffer()))).toBe(scene.sha256);
  const ref = { bundleDigest: compileReceipt.bundleDigest, projectDigest: compileReceipt.projectDigest };
  const created = await post(g, h, '/runs', runBody(ref));
  expect(created.status, JSON.stringify(await created.clone().json())).toBe(201);
  const input = s.spy.inputs[0] as { project: unknown; engineering: { ref: unknown; project: unknown } };
  expect(input.engineering.ref).toEqual(ref);
  expect(input.engineering.project).toEqual(s.f.project);
  expect(hashJson(input.project)).toBe(hashJson((input.engineering as unknown as { runtimeProjection: { project: unknown } }).runtimeProjection.project));
  expect(s.spy.providers[0]!.assets!.length).toBe(1);
  const mismatched = await post(g, h, '/runs', runBody(ref, { project: { ...(input.project as object), name: 'edited elsewhere' } }));
  expect(mismatched.status).toBe(409);
  expect((await mismatched.json()).error).toBe('ENGINEERING_IDENTITY_MISMATCH');
});

test('a bundle belongs to the compiling session, and digests alone grant nothing', async () => {
  const s = await setup(); const g = await s.start(); const owner = await pair(g), other = await pair(g);
  const receipt = await (await post(g, owner, '/engineering/compile', { project: s.f.project })).json();
  const ref = { bundleDigest: receipt.bundleDigest, projectDigest: receipt.projectDigest };
  expect((await get(g, other, `/engineering/bundles/${receipt.bundleDigest}/manifest`)).status).toBe(403);
  expect((await post(g, other, '/runs', runBody(ref))).status).toBe(403);
  expect((await post(g, owner, '/runs', runBody({ ...ref, projectDigest: 'f'.repeat(64) }))).status).toBe(409);
  expect((await post(g, owner, '/runs', runBody({ ...ref, bundleDigest: 'e'.repeat(64) }))).status).toBe(403);
  expect((await post(g, owner, '/runs', runBody(ref, { backendSetId: 'coffee-simulation' }))).status).toBeGreaterThanOrEqual(409);
  expect((await post(g, owner, '/runs', runBody(ref, { mode: 'mock', backendSetId: 'mock-amr' }))).status).toBe(422);
});

test('a runtime without the capability refuses engineering requests instead of running a preset', async () => {
  const s = await setup({ withEngineering: false }); const g = await s.start(); const h = await pair(g);
  expect((await (await get(g, h, '/health')).json()).capabilities ?? []).not.toContain('engineering_bundle_v1');
  const response = await post(g, h, '/runs', runBody({ bundleDigest: 'a'.repeat(64), projectDigest: 'b'.repeat(64) }));
  expect(response.status).toBe(400);
  expect((await response.json()).error).toBe('ENGINEERING_CAPABILITY_REQUIRED');
  expect((await post(g, h, '/engineering/compile', { project: s.f.project })).status).toBe(400);
  expect(s.spy.inputs).toEqual([]);
});

test('missing catalog data yields a blocked receipt with null digests and publishes nothing', async () => {
  const s = await setup(); const g = await s.start(); const h = await pair(g);
  const broken = structuredClone(s.f.project); broken.assembly.instances[0]!.componentDigest = 'd'.repeat(64);
  const r = await (await post(g, h, '/engineering/compile', { project: broken })).json();
  expect(r).toMatchObject({ state: 'blocked', runnable: false, bundleDigest: null, assemblyDigest: null, sceneDigest: null, projectDigest: hashJson(broken) });
  expect(r.problems.map((p: { code: string }) => p.code)).toContain('COMPONENT_UNAVAILABLE');
  const noInertia = await setup({ fixture: 'missing-inertia' }); const g2 = await noInertia.start(); const h2 = await pair(g2);
  const r2 = await (await post(g2, h2, '/engineering/compile', { project: noInertia.f.project })).json();
  expect(r2.state).toBe('blocked');
  expect(r2.problems.map((p: { code: string }) => p.code)).toContain('PARAMETER_MISSING');
  expect(await published(s.directory)).toEqual([]);
  expect(await published(noInertia.directory)).toEqual([]);
});

test('structurally invalid projects are HTTP 400, not receipts', async () => {
  const s = await setup(); const g = await s.start(); const h = await pair(g);
  const response = await post(g, h, '/engineering/compile', { project: { ...s.f.project, revision: 'x' } });
  expect(response.status).toBe(400);
});

test('compile timeout returns 503 and leaves no published bundle', async () => {
  const hang: CompilerPort = { version: 'hang', compileResolved: () => new Promise(() => {}) };
  const s = await setup({ compiler: hang, limits: { timeoutMs: 40 } }); const g = await s.start(); const h = await pair(g);
  const response = await post(g, h, '/engineering/compile', { project: s.f.project });
  expect(response.status).toBe(503);
  expect(await published(s.directory)).toEqual([]);
});

test('byte budget exhaustion is a blocked receipt and publishes no incomplete bundle', async () => {
  const s = await setup({ limits: { maxBundleBytes: 200 } }); const g = await s.start(); const h = await pair(g);
  const r = await (await post(g, h, '/engineering/compile', { project: s.f.project })).json();
  expect(r.state).toBe('blocked');
  expect(r.problems.map((p: { code: string }) => p.code)).toContain('BUNDLE_BUDGET_EXCEEDED');
  expect(await published(s.directory)).toEqual([]);
});

test('a compiler that returns inconsistent output is rejected before anything is published', async () => {
  const bad: CompilerPort = { version: 'bad', async compileResolved(_i, outDir) { await writeFile(join(outDir, 'scene.json'), 'x'); return { sceneDigest: 'c'.repeat(64), files: [{ path: 'scene.json', sha256: sha('x') }] }; } };
  const s = await setup({ compiler: bad }); const g = await s.start(); const h = await pair(g);
  const r = await (await post(g, h, '/engineering/compile', { project: s.f.project })).json();
  expect(r.state).toBe('blocked');
  expect(r.problems.map((p: { code: string }) => p.code)).toContain('COMPILER_OUTPUT_INVALID');
  expect(await published(s.directory)).toEqual([]);
});

test('V19 lifecycle: edit draft, restart, new pairing, proof reclaim restores read access and reset makes a new run from the locked ref', async () => {
  const s = await setup(); let g = await s.start(); let h = await pair(g);
  const receipt = await (await post(g, h, '/engineering/compile', { project: s.f.project })).json();
  const ref = { bundleDigest: receipt.bundleDigest, projectDigest: receipt.projectDigest };
  const created = await (await post(g, h, '/runs', runBody(ref))).json();
  const first = await (await get(g, h, `/engineering/bundles/${ref.bundleDigest}/manifest`)).json();
  // an unrelated draft edit changes the project digest of the draft, never the run's bundle
  const edited = structuredClone(s.f.project); edited.revision += 1;
  expect(hashJson(edited)).not.toBe(ref.projectDigest);
  await g.close(); gateways.pop();
  g = await s.start(); h = await pair(g);
  expect((await get(g, h, `/engineering/bundles/${ref.bundleDigest}/manifest`)).status).toBe(403); // pairing alone grants nothing
  expect((await post(g, h, `/runs/${created.run.id}/reclaim`, { proof: 'wrong' })).status).toBe(404);
  expect((await get(g, h, `/engineering/bundles/${ref.bundleDigest}/manifest`)).status).toBe(403);
  const reclaimed = await (await post(g, h, `/runs/${created.run.id}/reclaim`, { proof: created.reclaimToken })).json();
  expect(reclaimed.controlAccess).toBe('view_reconcile');
  expect(reclaimed.lockedInput.engineering.ref).toEqual(ref);
  expect(reclaimed.lockedInput.engineering.project).toEqual(s.f.project);
  expect(reclaimed.lockedInput.engineering.runtimeProjection.project).toEqual(reclaimed.lockedInput.project);
  const again = await get(g, h, `/engineering/bundles/${ref.bundleDigest}/manifest`);
  expect(again.status).toBe(200);
  expect(await again.json()).toEqual(first);
  const scene = first.files.find((f: { path: string }) => f.path === 'scene.json');
  expect((await get(g, h, `/engineering/blobs/${scene.sha256}`)).status).toBe(200);
  expect((await get(g, h, `/runs/${created.run.id}/report`)).status).toBe(200);
  // reset: a different run id, same project/bundle/seed; it is created but not started
  const reset = await post(g, h, '/runs', runBody(reclaimed.lockedInput.engineering.ref, { seed: reclaimed.lockedInput.seed }));
  expect(reset.status).toBe(201);
  const resetView = await reset.json();
  expect(resetView.run.id).not.toBe(created.run.id);
  expect(resetView.run.status).toBe('ready');
  const lockedAgain = s.spy.inputs.at(-1) as { seed: number; engineering: { ref: unknown } };
  expect([lockedAgain.seed, lockedAgain.engineering.ref]).toEqual([7, ref]);
  // a missing blob blocks reset but never touches the stored evidence
  await rm(join(s.directory, 'engineering', 'blobs', scene.sha256));
  const blocked = await post(g, h, '/runs', runBody(ref));
  expect(blocked.status).toBe(409);
  expect((await blocked.json()).error).toBe('ENGINEERING_CLOSURE_MISSING');
  expect((await get(g, h, `/runs/${created.run.id}/report`)).status).toBe(200);
});

test('engineering readiness uses the bundle projection and refuses what create would refuse', async () => {
  const s = await setup(); const g = await s.start(); const h = await pair(g), other = await pair(g);
  const receipt = await (await post(g, h, '/engineering/compile', { project: s.f.project })).json();
  const ref = { bundleDigest: receipt.bundleDigest, projectDigest: receipt.projectDigest };
  const ok = await post(g, h, '/readiness', { scenarioId: 'FD01', backendSetId: 'engineering-rigid-v1', engineeringRef: ref });
  expect(ok.status).toBe(200);
  const snapshot = await ok.json();
  expect(snapshot.checks.find((c: { id: string }) => c.id === 'world')?.evidenceRef).toContain('world:fixture-world');
  expect((await post(g, h, '/readiness', { scenarioId: 'FD01', backendSetId: 'engineering-rigid-v1', engineeringRef: ref, project: { not: 'the projection' } })).status).toBe(409);
  expect((await post(g, h, '/readiness', { scenarioId: 'FD01', backendSetId: 'engineering-contact-v1', engineeringRef: ref })).status).toBe(409);
  expect((await post(g, other, '/readiness', { scenarioId: 'FD01', backendSetId: 'engineering-rigid-v1', engineeringRef: ref })).status).toBe(403);
  expect((await post(g, h, '/readiness', { scenarioId: 'FD01', backendSetId: 'engineering-rigid-v1' })).status).toBe(400);
  const bare = await setup({ withEngineering: false }); const g2 = await bare.start(); const h2 = await pair(g2);
  expect((await post(g2, h2, '/readiness', { scenarioId: 'FD01', backendSetId: 'engineering-rigid-v1', engineeringRef: ref })).status).toBe(400);
});
