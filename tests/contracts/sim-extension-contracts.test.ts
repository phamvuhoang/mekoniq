// W01: additive contracts for the algorithm result and the sim3d plant. The IR-SIM branch of every schema stays byte-for-byte what it was.
import { afterEach, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildNavigationEvidence, navigationMetrics, openNavigationRecorder, readNavigationEvidence } from '../../packages/lab-runtime/src/v2/navigation2d/evidence';
import { validateTwinSampleV2 } from '../../packages/lab-runtime/src/v2/contracts';
import { sealDocument, validateAlgorithmResult, validateNavigationDocument, validateNavigationEvidence, validateSim3DRequest, validateSim3DResponse } from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import type { IRSimSnapshotV1, NavigationSceneV1 } from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import { navigationScene } from '../support/navigation2d';

const FIXTURES = new URL('../../robotics/navigation-2d/fixtures/serve-demo-v1/', import.meta.url);
const H = (c: string) => c.repeat(64);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const serve = navigationScene('serve');
const world3d = { obstacleHeightM: 0.75, wallHeightM: 1.2, floorFriction: 0.8, casterFriction: 0.02, provenance: 'assumed' as const };
const webotsEngine = { id: 'webots_3d', version: 'R2025a', basicTimeStepMs: 20 };
const sceneWith = (over: Record<string, unknown>) => sealDocument({ ...clone(serve), ...over } as NavigationSceneV1, 'sceneDigest');
const codes = (v: unknown) => { const r = validateNavigationDocument(v); return r.ok ? [] : r.issues.map((i) => i.code); };

test('existing IR-SIM scenes keep their digest and still validate', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', FIXTURES), 'utf8')) as { files: { path: string; sha256: string }[] };
  const scenes = manifest.files.filter((f) => f.path.startsWith('navigation-scene'));
  expect(scenes.length).toBeGreaterThan(0);
  for (const f of scenes) {
    const bytes = await readFile(new URL(f.path, FIXTURES));
    expect(createHash('sha256').update(bytes).digest('hex'), f.path).toBe(f.sha256);
    const r = validateNavigationDocument(JSON.parse(bytes.toString()));
    expect(r.ok ? [] : r.issues, f.path).toEqual([]);
  }
});

test('IR-SIM branch rejects world3d', () => {
  expect(codes(sceneWith({ world3d }))).toContain('INVALID_FIELD');
});

test('webots branch requires world3d and basicTimeStepMs', () => {
  const ok = validateNavigationDocument(sceneWith({ engine: webotsEngine, world3d }));
  expect(ok.ok ? [] : ok.issues).toEqual([]);
  expect(codes(sceneWith({ engine: webotsEngine }))).toContain('FIELD_REQUIRED');
  expect(codes(sceneWith({ engine: { id: 'webots_3d', version: 'R2025a' }, world3d })).length).toBeGreaterThan(0);
  expect(codes(sceneWith({ engine: { ...webotsEngine, basicTimeStepMs: 7 }, world3d })).length).toBeGreaterThan(0);
});

// An IR-SIM evidence document built by the real recorder from three ticks; the webots variants are derived from it.
const dirs: string[] = [];
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
async function irsimEvidence(profile?: Parameters<typeof buildNavigationEvidence>[7]) {
  const dir = await mkdtemp(join(tmpdir(), 'sim-ext-evidence-')); dirs.push(dir);
  const scan = (tick: number, sensorId: string) => ({ sensorId, frameId: 'lidar', tick, simTimeNs: String(tick * 20_000_000), angleMinRad: 0, angleIncrementRad: 2 * Math.PI / 360, rangeMinM: 0.05, rangeMaxM: 10, rangesM: Array.from({ length: 360 }, () => 3), states: Array.from({ length: 360 }, () => 'hit' as const) });
  const snap = (tick: number): IRSimSnapshotV1 => ({ schemaVersion: 1, runId: 'run-a', bootId: 'boot-a', tick, simTimeNs: String(tick * 20_000_000), seq: String(tick), sceneDigest: serve.sceneDigest,
    robots: serve.robots.map((r) => ({ robotId: r.robotId, poseDriveMap: [3 + tick * 0.01, 6, 0] as [number, number, number], bodyVelocity: [0.5, 0] as [number, number], scans: r.model.sensors.map((s) => scan(tick, s.id)), collisionIds: [] })) });
  const rec = await openNavigationRecorder({ directory: dir, scene: serve, runId: 'run-a', chunkTicks: 40 });
  for (let t = 0; t < 3; t++) await rec.append(snap(t), t ? { targetTick: t, velocities: [{ robotId: 'amr-1', vMps: 0.5, omegaRadps: 0 }], actorUpdates: [] } : null);
  await rec.flush();
  const c = rec.committed(), r = await readNavigationEvidence(dir, c, { scene: serve });
  return buildNavigationEvidence(serve, { runId: 'run-a', sourceCommit: 'c0ffee', sceneRef: { path: 'bundle/navigation-scene.json', sha256: H('b'), bytes: 100 }, lockDigest: H('a'), engine: { version: '2.12.0', pythonVersion: '3.11.9' }, numpyVersion: '2.4.6', runSeed: 5, actorRng: { algorithm: 'xoshiro128** v1', seed: 5 }, controller: { id: 'grid-diff-v1', version: '1' }, businessEpochMs: 1 }, c, r, navigationMetrics(serve, r), null, undefined, profile);
}
type Doc = Record<string, unknown> & { engine: Record<string, unknown>; seed: Record<string, unknown> };
const webotsEvidence = async () => {
  const e = clone(await irsimEvidence()) as unknown as Doc;
  e.engine = { id: 'webots_3d', engineVersion: 'R2025a', executableSha256: H('c'), basicTimeStepMs: 20, pythonVersion: '3.11.15', platform: 'darwin-arm64', lockDigest: H('a') };
  e.seed = { ...e.seed, engineSeedAlgorithm: 'webots-worldinfo-seed-v1' };
  delete e.seed.engineRng;
  return e;
};

test('the IR-SIM evidence the recorder writes still validates', async () => {
  const r = validateNavigationEvidence(await irsimEvidence());
  expect(r.ok ? [] : r.issues).toEqual([]);
});

test('evidence webots branch accepts its identity and requires executableSha256', async () => {
  const ok = validateNavigationEvidence(await webotsEvidence());
  expect(ok.ok ? [] : ok.issues).toEqual([]);
  const bad = await webotsEvidence(); delete bad.engine.executableSha256;
  expect(validateNavigationEvidence(bad).ok).toBe(false);
});

test('evidence irsim branch rejects engineVersion, and the seed algorithm must match the engine', async () => {
  const e = clone(await irsimEvidence()) as unknown as Doc;
  expect(validateNavigationEvidence({ ...e, engine: { ...e.engine, engineVersion: 'R2025a' } }).ok).toBe(false);
  expect(validateNavigationEvidence({ ...e, seed: { ...e.seed, engineSeedAlgorithm: 'webots-worldinfo-seed-v1' } }).ok).toBe(false);
  const w = await webotsEvidence();
  expect(validateNavigationEvidence({ ...w, seed: { ...w.seed, engineSeedAlgorithm: 'irsim-env-seed-v1' } }).ok).toBe(false);
});

const result = (over: Record<string, unknown> = {}) => ({ schemaVersion: 1, checkerId: 'rtb_kinematics', caseId: 'ALG01', verdict: 'pass', metrics: { maxTranslationErrorM: 1e-9 }, oracleProfileDigest: H('d'), inputDigest: H('e'), toolVersions: { 'roboticstoolbox-python': '1.5.0' }, reasons: [], ...over });

test('AlgorithmResultV1 accepts a pass and rejects NaN metric and unknown verdict', () => {
  expect(validateAlgorithmResult(result()).ok).toBe(true);
  expect(validateAlgorithmResult(result({ metrics: { m: null } })).ok).toBe(true);
  expect(validateAlgorithmResult(result({ metrics: { m: Number.NaN } })).ok).toBe(false);
  expect(validateAlgorithmResult(result({ verdict: 'maybe' })).ok).toBe(false);
  expect(validateAlgorithmResult(result({ checkerId: 'other' })).ok).toBe(false);
  expect(validateAlgorithmResult(result({ extra: 1 })).ok).toBe(false);
});

const request = (over: Record<string, unknown> = {}) => ({ protocol: 'mekoniq-sim3d/1', requestId: 'r1', runId: 'run-a', expectedTick: 0, op: 'getState', payload: {}, ...over });
const robot3d = (over: Record<string, unknown> = {}) => ({ robotId: 'amr-1', poseDriveMap: [1, 1, 0], bodyVelocity: [0, 0], scans: [], collisionIds: [], pose3d: { z: 0.09, roll: 0, pitch: 0 }, wheels: { leftRadS: 0, rightRadS: 0 }, ...over });
const response = (robot: Record<string, unknown>) => ({ protocol: 'mekoniq-sim3d/1', requestId: 'r1', runId: 'run-a', bootId: 'boot-a', tick: 0, ok: true,
  result: { schemaVersion: 1, runId: 'run-a', bootId: 'boot-a', tick: 0, simTimeNs: '0', seq: '0', sceneDigest: H('f'), robots: [robot] } });

test('sim3d requests use their own protocol and the irsim protocol is refused on that wire', () => {
  expect(validateSim3DRequest(request()).ok).toBe(true);
  expect(validateSim3DRequest(request({ protocol: 'mekoniq-irsim/1' })).ok).toBe(false);
});

test('sim3d response needs pose3d and wheels; the base fields are the IR-SIM ones', () => {
  expect(validateSim3DResponse(response(robot3d())).ok).toBe(true);
  const { pose3d: _p, ...noPose } = robot3d(); void _p;
  expect(validateSim3DResponse(response(noPose)).ok).toBe(false);
  const { wheels: _w, ...noWheels } = robot3d(); void _w;
  expect(validateSim3DResponse(response(noWheels)).ok).toBe(false);
  expect(validateSim3DResponse(response(robot3d({ pose3d: { z: Number.NaN, roll: 0, pitch: 0 } }))).ok).toBe(false);
});

test('a sim3d snapshot may carry the model read back from the engine (getState), and only in that shape', () => {
  const model = { robots: [{ robotId: 'amr-1', links: [{ name: 'chassis_base', massKg: 14, positionMap: [2, 1.5, 0.09] }], wheelRadiusM: 0.09, wheelSeparationM: 0.36, wheelAxes: [[0, 1, 0], [0, 1, 0]] }] };
  const withModel = response(robot3d());
  (withModel.result as Record<string, unknown>).model = model;
  expect(validateSim3DResponse(withModel).ok).toBe(true);
  (withModel.result as Record<string, unknown>).model = { robots: [{ ...model.robots[0], extra: 1 }] };
  expect(validateSim3DResponse(withModel).ok).toBe(false);
});

test('evidence built with the Webots plant profile is the webots branch of the schema: its engine identity, its seed derivation, no NumPy stream', async () => {
  const profile = { engine: (d: { version: string; pythonVersion: string; platform: string; lockDigest: string }) => ({ id: 'webots_3d', engineVersion: 'R2025a', executableSha256: H('c'), basicTimeStepMs: 20, pythonVersion: d.pythonVersion, platform: d.platform, lockDigest: d.lockDigest }), seedAlgorithm: 'webots-worldinfo-seed-v1', limitation: 'webots_3d simulated plant (test)' };
  const e = await irsimEvidence(profile) as unknown as { engine: Record<string, unknown>; seed: Record<string, unknown>; limitations: string[] };
  const checked = validateNavigationEvidence(e);
  expect(checked.ok ? [] : checked.issues).toEqual([]);
  expect(e.engine).toMatchObject({ id: 'webots_3d', engineVersion: 'R2025a', executableSha256: H('c'), basicTimeStepMs: 20 });
  expect(e.seed.engineSeedAlgorithm).toBe('webots-worldinfo-seed-v1'); expect('engineRng' in e.seed).toBe(false);
  expect(e.limitations[0]).toBe('webots_3d simulated plant (test)');
  // without a profile the evidence is the IR-SIM one, as before
  const plain = await irsimEvidence() as unknown as { engine: { id: string }; seed: Record<string, unknown> };
  expect(plain.engine.id).toBe('irsim_2d'); expect(plain.seed.engineSeedAlgorithm).toBe('irsim-env-seed-v1'); expect('engineRng' in plain.seed).toBe(true);
});

const twinSample = (observed: Record<string, unknown>) => ({ schemaVersion: 2, runId: '00000000-0000-4000-8000-000000000001', entityId: 'amr-1', providerId: 'webots_3d', bootId: 'b', seq: '1', simTimeNs: '0', observedAt: '2026-11-01T00:00:00.000Z', receivedMonotonicNs: '1', frameId: 'map', origin: 'controller_sim', quality: 'valid', reasonCodes: [], commanded: null, observed, estimated: null, causationId: null });
test('an AMR twin sample may carry the 3D pose of a 3D plant (z, roll, pitch) and nothing else new', () => {
  const planar = { xM: 1, yM: 2, yawRad: 0.1, moving: false, hold: null };
  expect(validateTwinSampleV2(twinSample(planar)).ok).toBe(true);
  expect(validateTwinSampleV2(twinSample({ ...planar, zM: 0.09, rollRad: 0.001, pitchRad: -0.002 })).ok).toBe(true);
  expect(validateTwinSampleV2(twinSample({ ...planar, zM: Number.NaN })).ok).toBe(false);
  expect(validateTwinSampleV2(twinSample({ ...planar, zM: 0.09, tiltDeg: 3 })).ok).toBe(false);
});
