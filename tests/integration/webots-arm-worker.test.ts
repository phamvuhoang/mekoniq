// X04 (R1.1) on the real Webots R2025a: the plant worker steps an arm by joint targets through the TypeScript client. Skipped, with the reason, where Webots or .venv-webots is missing.
import { afterEach, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { lockDigestOf } from '../../packages/lab-runtime/src/engineering/linkforge';
import { sealDocument, validateArmScene3D, type ArmScene3DV1, type Sim3DSnapshotV1 } from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import { loadOracleProfile } from '../../packages/lab-runtime/src/v2/algorithm/checker';
import { qrotate } from '../../packages/lab-runtime/src/v2/frames';
import { spawnSim3DWorker } from '../../packages/lab-runtime/src/v2/simulation3d/worker-client';

const HOME_DIR = process.env.MEKONIQ_WEBOTS_HOME ?? '/Applications/Webots.app', python = resolve('.venv-webots/bin/python'), workerRoot = resolve('robotics/simulation-3d'), FX = join(workerRoot, 'fixtures', 'arm-ref-3d-v1');
const exe = join(HOME_DIR, 'Contents', 'MacOS', 'webots');
const webotsReady = existsSync(exe) && existsSync(python) && (() => { try { return execFileSync(exe, ['--version'], { encoding: 'utf8', timeout: 30_000 }).includes('R2025a'); } catch { return false; } })();
const HOME = [0, -0.6, 1.2, 0, 0.6, 0];

const dirs: string[] = [];
const opened: { close(r: string): Promise<void> }[] = [];
afterEach(async () => { for (const w of opened.splice(0)) await w.close('test done').catch(() => {}); for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
// anchored at the start of the command line: only the Webots executable and the controller scripts started with the interpreter, never a shell that merely mentions them
const running = () => { try { return execFileSync('pgrep', ['-f', '^[^ ]*/Contents/MacOS/webots |^[^ ]+ -I -B -X utf8 [^ ]*webots_worker/(supervisor|robot_controller|arm_controller)\\.py'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean); } catch { return []; } };
const webotsStateDirs = () => { try { return readdirSync('/tmp/webots/default').sort(); } catch { return []; } };

type Component = { links: { id: string; massKg: { value: number } }[]; joints: { id: string; origin: { xyzM: number[]; quaternionXyzw: [number, number, number, number] }; axis: number[]; limits: { lower: { value: number }; upper: { value: number } } }[] };
const manifest = JSON.parse(await readFile(join(FX, 'manifest.json'), 'utf8')) as { componentDigest: string };
const component = JSON.parse(await readFile(join(FX, 'component.json'), 'utf8')) as Component;
const golden = JSON.parse(await readFile(join(FX, 'fk-golden.json'), 'utf8')) as { poses: { q: number[]; flangeM: number[] }[] };

/** An arm bundle: the sealed arm scene and the component whose digest it names. */
async function bundle(statics: ArmScene3DV1['statics'] = []) {
  const root = await mkdtemp(join(tmpdir(), 'webots-arm-w-')); dirs.push(root);
  const scene = sealDocument({ schemaVersion: 1, sceneDigest: '', arm: { armId: 'arm-1', modelId: 'arm-ref-3d-v1', modelRevision: manifest.componentDigest, baseInMap: { position: [2, 1, 0.75], quaternionXyzw: [0, 0, 0, 1] }, homeRad: HOME },
    statics, world3d: { floorFriction: 0.8, provenance: 'assumed' }, engine: { id: 'webots_3d', basicTimeStepMs: 20 }, engineSeed: 7 } as ArmScene3DV1, 'sceneDigest');
  expect(validateArmScene3D(scene).ok).toBe(true);
  await mkdir(join(root, 'bundle'), { recursive: true });
  await writeFile(join(root, 'bundle', 'arm-scene.json'), JSON.stringify(scene));
  await writeFile(join(root, 'bundle', 'arm-component.json'), await readFile(join(FX, 'component.json')));
  return { root, scene };
}
async function start(statics?: ArmScene3DV1['statics']) {
  const b = await bundle(statics), runId = 'wa-1';
  const w = await spawnSim3DWorker({ python, workerRoot, runId, bundleRoot: join(b.root, 'bundle'), runDirectory: join(b.root, 'run'), lockDigest: await lockDigestOf(join(workerRoot, 'requirements.lock')), schemaDir: resolve('packages/contracts/schemas'), sceneDigest: b.scene.sceneDigest, webotsHome: HOME_DIR });
  opened.push(w);
  let n = 0;
  const ask = (op: string, payload: unknown, tick: number) => w.request({ protocol: 'mekoniq-sim3d/1', requestId: `${op}-${++n}`, runId, expectedTick: tick, op, payload });
  const create = async () => { const r = await ask('create', { sceneRef: 'arm-scene.json', seed: 7, arms: [{ armId: 'arm-1', sceneRef: 'arm-scene.json' }] }, 0); if (!r.ok) throw new Error(JSON.stringify(r)); await ask('start', {}, 0); return r.result as Sim3DSnapshotV1; };
  const step = (tick: number, q: number[]) => ask('step', { targetTick: tick + 1, velocities: [], actorUpdates: [], jointTargets: [{ armId: 'arm-1', positionsRad: q }] }, tick);
  return { ...b, w, ask, create, step };
}

describe.skipIf(!webotsReady)('Webots arm worker', () => {
  test('WA03 clock and hold: 50 ticks at home stay within reachTolRad, simTimeNs is tick x 20 ms, and nothing collides', async () => {
    const t = await start();
    const snap = await t.create();
    expect(snap.tick).toBe(0); expect(snap.simTimeNs).toBe('0'); expect(snap.robots).toEqual([]);
    const tol = loadOracleProfile().profile.webotsArm!.reachTolRad;
    expect(snap.arms![0]!.positionsRad.every((q, i) => Math.abs(q - HOME[i]!) <= tol)).toBe(true);
    for (let k = 0; k < 50; k++) {
      const r = await t.step(k, HOME);
      if (!r.ok) throw new Error(JSON.stringify(r));
      const s = r.result as Sim3DSnapshotV1, arm = s.arms![0]!;
      expect(s.tick).toBe(k + 1); expect(s.simTimeNs).toBe(String((k + 1) * 20_000_000)); // the worker also checks engine time = (tick + 1) x 20 ms and ends the run on drift
      expect(arm.positionsRad).toHaveLength(6); expect(arm.collisionIds).toEqual([]);
      arm.positionsRad.forEach((q, i) => expect(Math.abs(q - HOME[i]!), `tick ${k + 1} J${i + 1}`).toBeLessThanOrEqual(tol));
    }
  }, 120_000);

  test('WA02 readback: link masses, hinge axes and joint limits are the fixture\'s', async () => {
    const t = await start();
    await t.create();
    const state = await t.ask('getState', {}, 0);
    if (!state.ok) throw new Error(JSON.stringify(state));
    const arm = (state.result as Sim3DSnapshotV1).model!.arm!;
    expect(arm.links.map((l) => l.name)).toEqual(['link1', 'link2', 'link3', 'link4', 'link5', 'link6']);
    arm.links.forEach((l, i) => expect(l.massKg, l.name).toBeCloseTo(component.links[i + 1]!.massKg.value, 9));
    expect(arm.joints.map((j) => j.name)).toEqual(['J1', 'J2', 'J3', 'J4', 'J5', 'J6']);
    arm.joints.forEach((j, i) => {
      const f = component.joints[i]!, axis = qrotate(f.origin.quaternionXyzw, f.axis as [number, number, number]); // Webots wants the axis in the parent frame
      axis.forEach((a, k) => expect(j.axis[k]!, `${j.name} axis ${k}`).toBeCloseTo(a, 9));
      expect(j.lower).toBeCloseTo(f.limits.lower.value, 9); expect(j.upper).toBeCloseTo(f.limits.upper.value, 9);
    });
  }, 120_000);

  test('a target past a joint limit is refused by the worker, the run goes on, and the engine never saw it', async () => {
    const t = await start();
    await t.create();
    const upper = component.joints[0]!.limits.upper.value;
    const bad = await t.step(0, [upper + 1e-6, ...HOME.slice(1)]);
    expect(bad.ok).toBe(false); expect((bad as { error: { code: string } }).error.code).toBe('JOINT_TARGET_OUT_OF_RANGE'); expect(bad.tick).toBe(0);
    const short = await t.step(0, HOME.slice(0, 5));
    expect((short as { error: { code: string } }).error.code).toBe('JOINT_TARGET_SHAPE');
    const ok = await t.step(0, HOME);
    expect(ok.ok).toBe(true); expect(ok.tick).toBe(1);
  }, 120_000);

  test('a static box on the flange is named in collisionIds, and only then', async () => {
    const flange = golden.poses[1]!.flangeM; // the flange at home, arm base frame
    const t = await start([{ id: 'table-1', kind: 'box', min: flange.map((v) => v - 0.06) as [number, number, number], max: flange.map((v) => v + 0.06) as [number, number, number] }]);
    await t.create();
    const seen = new Set<string>();
    for (let k = 0; k < 40; k++) {
      const r = await t.step(k, HOME);
      if (!r.ok) throw new Error(JSON.stringify(r));
      for (const id of (r.result as Sim3DSnapshotV1).arms![0]!.collisionIds) seen.add(id);
    }
    expect([...seen]).toContain('table-1');
  }, 120_000);

  test('D31: after close no Webots, controller or Webots state directory is left, and no bytecode appears under the tool root', async () => {
    const before = webotsStateDirs();
    const t = await start();
    await t.create();
    for (let k = 0; k < 5; k++) { const r = await t.step(k, HOME); expect(r.ok).toBe(true); }
    expect(running().length).toBeGreaterThanOrEqual(3); // Webots, the supervisor and the arm controller
    expect(webotsStateDirs().length).toBeGreaterThan(before.length); // the state dir Webots makes is the one the worker probes
    await t.w.close('done');
    await new Promise((r) => setTimeout(r, 700));
    expect(running()).toEqual([]);
    expect(webotsStateDirs()).toEqual(before);
    expect(execFileSync('find', [workerRoot, '-name', '__pycache__', '-not', '-path', '*/node_modules/*'], { encoding: 'utf8' }).trim()).toBe('');
  }, 120_000);
});
