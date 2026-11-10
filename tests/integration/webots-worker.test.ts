// W06 on the real Webots R2025a: the plant worker through the TypeScript client. Skipped, with the reason, where Webots or the .venv-webots interpreter is missing.
import { afterEach, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { lockDigestOf } from '../../packages/lab-runtime/src/engineering/linkforge';
import { sealDocument, type NavigationSceneV1, type Sim3DSnapshotV1 } from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import { WorkerLostError } from '../../packages/lab-runtime/src/v2/navigation2d/plant';
import { loadOracleProfile } from '../../packages/lab-runtime/src/v2/algorithm/checker';
import { castScan, lidarAgrees } from '../../packages/lab-runtime/src/v2/simulation3d/lidar-oracle';
import { spawnSim3DWorker } from '../../packages/lab-runtime/src/v2/simulation3d/worker-client';

const HOME = process.env.MEKONIQ_WEBOTS_HOME ?? '/Applications/Webots.app', python = resolve('.venv-webots/bin/python'), workerRoot = resolve('robotics/simulation-3d'), FX = join(workerRoot, 'fixtures', 'serve-3d-v1');
const exe = join(HOME, 'Contents', 'MacOS', 'webots');
const webotsReady = existsSync(exe) && existsSync(python) && (() => { try { return execFileSync(exe, ['--version'], { encoding: 'utf8', timeout: 30_000 }).includes('R2025a'); } catch { return false; } })();

const dirs: string[] = [];
const opened: { close(r: string): Promise<void> }[] = [];
afterEach(async () => { for (const w of opened.splice(0)) await w.close('test done').catch(() => {}); for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
// anchored at the start of the command line: only the Webots executable and the controller scripts started with the interpreter, never a shell that merely mentions them
const running = () => { try { return execFileSync('pgrep', ['-f', '^[^ ]*/Contents/MacOS/webots |^[^ ]+ -I -B -X utf8 [^ ]*webots_worker/(supervisor|robot_controller)\\.py'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean); } catch { return []; } };

/** The single-robot scene as a bundle: the scene lists its physical model with the sha the worker checks. */
async function bundle() {
  const root = await mkdtemp(join(tmpdir(), 'webots-w-')); dirs.push(root);
  const scene = JSON.parse(await readFile(join(FX, 'navigation-scene.json'), 'utf8')) as NavigationSceneV1;
  const model = await readFile(join(FX, 'physical-model-amr-1.json'));
  await mkdir(join(root, 'bundle', 'physical-model'), { recursive: true });
  await cp(join(FX, 'physical-model-amr-1.json'), join(root, 'bundle', 'physical-model', 'amr-1.json'));
  const sealed = sealDocument({ ...scene, files: [{ path: 'physical-model/amr-1.json', sha256: createHash('sha256').update(model).digest('hex'), bytes: model.length }] } as NavigationSceneV1, 'sceneDigest');
  await writeFile(join(root, 'bundle', 'navigation-scene.json'), JSON.stringify(sealed));
  return { root, scene: sealed, physical: JSON.parse(model.toString()) as { links: { id: string; massKg: { value: number } }[]; joints: { parent: string; child: string; origin: { xyzM: number[]; quaternionXyzw: number[] } }[]; baseFrameId: string } };
}
async function start() {
  const b = await bundle(), runId = 'wb-1';
  const w = await spawnSim3DWorker({ python, workerRoot, runId, bundleRoot: join(b.root, 'bundle'), runDirectory: join(b.root, 'run'), lockDigest: await lockDigestOf(join(workerRoot, 'requirements.lock')), schemaDir: resolve('packages/contracts/schemas'), sceneDigest: b.scene.sceneDigest, webotsHome: HOME });
  opened.push(w);
  let n = 0;
  const ask = (op: string, payload: unknown, tick: number) => w.request({ protocol: 'mekoniq-sim3d/1', requestId: `${op}-${++n}`, runId, expectedTick: tick, op, payload });
  const create = async () => { const r = await ask('create', { sceneRef: 'navigation-scene.json', seed: 7 }, 0); if (!r.ok) throw new Error(JSON.stringify(r)); await ask('start', {}, 0); return r.result as Sim3DSnapshotV1; };
  const step = async (tick: number, v = 0, omega = 0) => { const r = await ask('step', { targetTick: tick + 1, velocities: [{ robotId: 'amr-1', vMps: v, omegaRadps: omega }], actorUpdates: [] }, tick); if (!r.ok) throw new Error(JSON.stringify(r)); return r.result as Sim3DSnapshotV1; };
  return { ...b, w, ask, create, step };
}

describe.skipIf(!webotsReady)('Webots plant worker', () => {
  test('WB08 clock: ticks are monotonic, simTimeNs is tick x 20 ms, the bootId never changes, and a step queued behind another waits for its ACK', async () => {
    const t = await start();
    let snap = await t.create();
    expect(snap.tick).toBe(0); expect(snap.simTimeNs).toBe('0');
    const boot = snap.bootId;
    for (let k = 0; k < 500; k++) {
      snap = await t.step(k);
      expect(snap.tick).toBe(k + 1); expect(snap.simTimeNs).toBe(String((k + 1) * 20_000_000)); expect(snap.bootId).toBe(boot);
    }
    const [a, b] = await Promise.all([t.step(500), t.step(501)]); // the second is queued by the client and sent after the first is acknowledged
    expect([a.tick, b.tick]).toEqual([501, 502]);
  }, 180_000);

  test('WB01 model parity: what the engine loaded matches the physical model', async () => {
    const t = await start();
    const snap = await t.create();
    const state = await t.ask('getState', {}, 0);
    if (!state.ok) throw new Error(JSON.stringify(state));
    const m = (state.result as Sim3DSnapshotV1).model!.robots[0]!;
    const byName = new Map(m.links.map((l) => [l.name, l])), nameOf = (id: string) => (id === t.physical.baseFrameId ? 'amr-1' : id.replace('/', '_')); // the root link is the Robot node, named by the robot id
    for (const l of t.physical.links) expect(byName.get(nameOf(l.id))?.massKg ?? NaN, l.id).toBeCloseTo(l.massKg.value, 6);
    // link positions relative to the base, in the base frame: compose the joint origins of the model, rotate the engine's world offsets back by the base orientation
    const base = byName.get('amr-1')!.positionMap, { roll, pitch } = snap.robots[0]!.pose3d, yaw = snap.robots[0]!.poseDriveMap[2];
    const R = rotationZyx(yaw, pitch, roll), rel = (p: number[]) => matT(R, [p[0]! - base[0]!, p[1]! - base[1]!, p[2]! - base[2]!]);
    const expected = linkPositions(t.physical);
    for (const [id, pos] of expected) { const got = rel(byName.get(nameOf(id))!.positionMap); for (let i = 0; i < 3; i++) expect(Math.abs(got[i]! - pos[i]!), `${id}[${i}]`).toBeLessThanOrEqual(1e-4); }
    expect(m.wheelRadiusM).toBeCloseTo(0.09, 4); expect(m.wheelSeparationM).toBeCloseTo(0.36, 4);
    for (const axis of m.wheelAxes) expect(Math.hypot(axis[0]!, axis[1]! - 1, axis[2]!)).toBeLessThanOrEqual(1e-6);
  }, 120_000);

  test('WB01 stands: 250 ticks at rest do not tip or drift it', async () => {
    const t = await start();
    const first = (await t.create()).robots[0]!;
    let last = first;
    for (let k = 0; k < 250; k++) last = (await t.step(k)).robots[0]!;
    expect(Math.abs(last.pose3d.roll)).toBeLessThanOrEqual(0.02); expect(Math.abs(last.pose3d.pitch)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(last.poseDriveMap[0]! - first.poseDriveMap[0]!)).toBeLessThanOrEqual(1e-3); expect(Math.abs(last.poseDriveMap[1]! - first.poseDriveMap[1]!)).toBeLessThanOrEqual(1e-3);
  }, 180_000);

  test('WB02 lidar: the scan at the spawn agrees with the independent ray-cast of the scene', async () => {
    const t = await start();
    const r = (await t.create()).robots[0]!, scan = r.scans[0]!;
    const sensor = t.scene.robots[0]!.model.sensors[0]!, [x, y, yaw] = r.poseDriveMap, [dx] = sensor.poseInDrive;
    const cast = castScan(t.scene, { x: x! + Math.cos(yaw!) * dx!, y: y! + Math.sin(yaw!) * dx!, yaw: yaw! }, { beams: sensor.beamCount, minM: sensor.rangeMinM, maxM: sensor.rangeMaxM });
    expect(scan.rangesM).toHaveLength(360); expect(scan.states.every((s) => ['hit', 'no_return'].includes(s))).toBe(true);
    const w = loadOracleProfile().profile.webots!, verdict = lidarAgrees(scan.rangesM, cast, { toleranceM: w.lidarRangeToleranceM, windowBeams: w.lidarWindowBeams, medianM: w.lidarMedianM, maxM: sensor.rangeMaxM });
    expect(verdict.violations).toEqual([]);
    expect(verdict.medianOk, `median error ${verdict.medianAbsM}`).toBe(true);
    expect(scan.rangesM.filter((v) => v !== null).length).toBeGreaterThan(30); // the room is really in view
  }, 120_000);

  test('it drives straight: [0.3, 0] for 100 ticks moves it 0.6 m along its heading', async () => {
    const t = await start();
    const first = (await t.create()).robots[0]!;
    let last = first;
    for (let k = 0; k < 100; k++) last = (await t.step(k, 0.3)).robots[0]!;
    expect(last.poseDriveMap[0]! - first.poseDriveMap[0]!).toBeGreaterThan(0.55); expect(last.poseDriveMap[0]! - first.poseDriveMap[0]!).toBeLessThan(0.65);
    expect(Math.abs(last.poseDriveMap[1]! - first.poseDriveMap[1]!)).toBeLessThanOrEqual(0.02);
    expect(last.bodyVelocity[0]).toBeGreaterThan(0.25);
  }, 120_000);

  test('killing Webots mid-run loses the worker within 5 s as unknown and leaves no process behind', async () => {
    const t = await start();
    await t.create();
    await t.step(0, 0.1);
    const pids = execFileSync('pgrep', ['-f', `Webots.app/Contents/MacOS/webots.*${t.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    expect(pids.length).toBe(1);
    const started = Date.now();
    process.kill(Number(pids[0]), 'SIGKILL');
    const answer = await t.ask('step', { targetTick: 2, velocities: [{ robotId: 'amr-1', vMps: 0.1, omegaRadps: 0 }], actorUpdates: [] }, 1).catch((e: unknown) => e);
    expect(Date.now() - started).toBeLessThanOrEqual(5000);
    // the worker notices first and answers once with the engine fault, or the client loses the worker: either way the step is not an applied tick and nothing resends it
    if (answer instanceof WorkerLostError) expect(answer.outcome).toBe('unknown');
    else expect((answer as { ok: boolean; error?: { code: string } }).ok === false && ['ENGINE_LOST', 'ENGINE_TIMEOUT'].includes((answer as { error: { code: string } }).error.code)).toBe(true);
    await expect(t.ask('step', { targetTick: 2, velocities: [{ robotId: 'amr-1', vMps: 0.1, omegaRadps: 0 }], actorUpdates: [] }, 1)).rejects.toBeInstanceOf(WorkerLostError);
    await t.w.close('after kill');
    await new Promise((r) => setTimeout(r, 500));
    expect(running()).toEqual([]);
  }, 120_000);
});

// ---- small rigid-body helpers for the parity check (quaternions x y z w) ----
function rotationZyx(yaw: number, pitch: number, roll: number) {
  const [cy, sy, cp, sp, cr, sr] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch), Math.cos(roll), Math.sin(roll)];
  return [[cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr], [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr], [-sp, cp * sr, cp * cr]];
}
const matT = (R: number[][], v: number[]) => [0, 1, 2].map((i) => R[0]![i]! * v[0]! + R[1]![i]! * v[1]! + R[2]![i]! * v[2]!);
const quatMat = ([x, y, z, w]: number[]) => [[1 - 2 * (y! * y! + z! * z!), 2 * (x! * y! - z! * w!), 2 * (x! * z! + y! * w!)], [2 * (x! * y! + z! * w!), 1 - 2 * (x! * x! + z! * z!), 2 * (y! * z! - x! * w!)], [2 * (x! * z! - y! * w!), 2 * (y! * z! + x! * w!), 1 - 2 * (x! * x! + y! * y!)]];
function linkPositions(model: { joints: { parent: string; child: string; origin: { xyzM: number[]; quaternionXyzw: number[] } }[]; baseFrameId: string }) {
  const out = new Map<string, number[]>([[model.baseFrameId, [0, 0, 0]]]), rot = new Map<string, number[][]>([[model.baseFrameId, [[1, 0, 0], [0, 1, 0], [0, 0, 1]]]]);
  for (let progress = true; progress;) {
    progress = false;
    for (const j of model.joints) if (out.has(j.parent) && !out.has(j.child)) {
      const R = rot.get(j.parent)!, p = out.get(j.parent)!, t = j.origin.xyzM;
      out.set(j.child, [0, 1, 2].map((i) => p[i]! + R[i]![0]! * t[0]! + R[i]![1]! * t[1]! + R[i]![2]! * t[2]!));
      const q = quatMat(j.origin.quaternionXyzw);
      rot.set(j.child, [0, 1, 2].map((i) => [0, 1, 2].map((c) => R[i]![0]! * q[0]![c]! + R[i]![1]! * q[1]![c]! + R[i]![2]! * q[2]![c]!)));
      progress = true;
    }
  }
  return out;
}
