// M04 on the real MuJoCo 3.17.0 (.venv-mujoco): the arm cell worker through the TypeScript client. Skipped, with the reason, where .venv-mujoco is missing (not_run, never a pass).
import { afterEach, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { lockDigestOf } from '../../packages/lab-runtime/src/engineering/linkforge';
import { loadOracleProfile } from '../../packages/lab-runtime/src/v2/algorithm/checker';
import { qrotate } from '../../packages/lab-runtime/src/v2/frames';
import type { Sim3DSnapshotV1 } from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import { spawnMujocoWorker } from '../../packages/lab-runtime/src/v2/simulation3d/worker-client';
import { XARM6_FX, armCellScene, writeArmCellBundle } from '../support/arm-cell-scene';

const python = resolve('.venv-mujoco/bin/python'), workerRoot = resolve('robotics/simulation-mujoco');
const mujocoReady = existsSync(python) && (() => { try { return execFileSync(python, ['-I', '-B', '-c', 'import mujoco;print(mujoco.__version__)'], { encoding: 'utf8', timeout: 30_000 }).trim() === '3.17.0'; } catch { return false; } })();
const running = () => { try { return execFileSync('pgrep', ['-f', 'mujoco_worker --run-id'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean); } catch { return []; } };

type Component = { links: { id: string; massKg: { value: number } }[]; joints: { id: string; kind: string; origin: { quaternionXyzw: [number, number, number, number] }; axis: number[]; limits: { lower: { value: number }; upper: { value: number }; effort: { value: number } } }[] };
const component = JSON.parse(await readFile(join(XARM6_FX, 'component.json'), 'utf8')) as Component;
const dirs: string[] = [];
const opened: { close(r: string): Promise<void> }[] = [];
afterEach(async () => { for (const w of opened.splice(0)) await w.close('test done').catch(() => {}); for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });

async function start() {
  const root = await mkdtemp(join(tmpdir(), 'mujoco-arm-w-')); dirs.push(root);
  const scene = await armCellScene(['cup-1'], 7);
  await writeArmCellBundle(join(root, 'bundle'), scene);
  const runId = 'ma-1';
  const w = await spawnMujocoWorker({ python, workerRoot, runId, bundleRoot: join(root, 'bundle'), runDirectory: join(root, 'run'), lockDigest: await lockDigestOf(join(workerRoot, 'requirements.lock')), schemaDir: resolve('packages/contracts/schemas'), sceneDigest: scene.sceneDigest });
  opened.push(w);
  let n = 0;
  const ask = (op: string, payload: unknown, tick: number) => w.request({ protocol: 'mekoniq-sim3d/1', requestId: `${op}-${++n}`, runId, expectedTick: tick, op, payload });
  const create = async () => { const r = await ask('create', { sceneRef: 'arm-cell-scene.json', seed: 7, arms: [{ armId: 'xarm-1', sceneRef: 'arm-cell-scene.json' }] }, 0); if (!r.ok) throw new Error(JSON.stringify(r)); await ask('start', {}, 0); return r.result as Sim3DSnapshotV1; };
  const step = (tick: number, q: number[]) => ask('step', { targetTick: tick + 1, velocities: [], actorUpdates: [], jointTargets: [{ armId: 'xarm-1', positionsRad: q }] }, tick);
  return { scene, w, ask, create, step };
}

describe.skipIf(!mujocoReady)('MuJoCo arm worker', () => {
  test('MA03 clock and hold: 50 ticks at home stay within reachTolRad, simTimeNs is tick x 20 ms, nothing collides; a target past a limit is refused without a tick', async () => {
    const t = await start(), home = t.scene.arm.homeRad;
    const snap = await t.create();
    expect(snap.tick).toBe(0); expect(snap.simTimeNs).toBe('0'); expect(snap.props).toEqual([]);
    const tol = loadOracleProfile().profile.mujocoArm!.reachTolRad;
    for (let k = 0; k < 50; k++) {
      const r = await t.step(k, home);
      if (!r.ok) throw new Error(JSON.stringify(r));
      const s = r.result as Sim3DSnapshotV1, arm = s.arms![0]!;
      expect(s.tick).toBe(k + 1); expect(s.simTimeNs).toBe(String((k + 1) * 20_000_000));
      expect(arm.collisionIds).toEqual([]); expect(arm.gripper!.heldPropIds).toEqual([]);
      arm.positionsRad.forEach((q, i) => expect(Math.abs(q - home[i]!), `tick ${k + 1} J${i + 1}`).toBeLessThanOrEqual(tol));
    }
    const bad = await t.step(50, [component.joints[0]!.limits.upper.value + 1e-6, ...home.slice(1)]);
    expect(bad.ok).toBe(false); expect((bad as { error: { code: string } }).error.code).toBe('JOINT_TARGET_OUT_OF_RANGE'); expect(bad.tick).toBe(50);
    expect((await t.step(50, home)).tick).toBe(51);
  }, 60_000);

  test('MA02 readback: link masses, hinge axes, limits and actuator force limits are the fixture\'s', async () => {
    const t = await start();
    await t.create();
    const state = await t.ask('getState', {}, 0);
    if (!state.ok) throw new Error(JSON.stringify(state));
    const arm = (state.result as Sim3DSnapshotV1).model!.arm!;
    const chain = component.joints.filter((j) => /^J[1-6]$/.test(j.id)), mass = new Map(component.links.map((l) => [l.id, l.massKg.value]));
    expect(arm.links.map((l) => l.name)).toEqual(['link1', 'link2', 'link3', 'link4', 'link5', 'link6']);
    arm.links.forEach((l) => expect(l.massKg, l.name).toBeCloseTo(mass.get(l.name)!, 12));
    expect(arm.joints.map((j) => j.name)).toEqual(chain.map((j) => j.id));
    arm.joints.forEach((j, i) => {
      const f = chain[i]!, axis = qrotate(f.origin.quaternionXyzw, f.axis as [number, number, number]); // the hinge axis in the parent frame
      axis.forEach((a, k) => expect(j.axis[k]!, `${j.name} axis ${k}`).toBeCloseTo(a, 9));
      expect(j.lower).toBeCloseTo(f.limits.lower.value, 12); expect(j.upper).toBeCloseTo(f.limits.upper.value, 12); expect(j.forceN).toBeCloseTo(f.limits.effort.value, 12);
    });
  }, 60_000);

  test('after close no worker process is left and no bytecode appears under the tool root', async () => {
    const t = await start();
    await t.create();
    for (let k = 0; k < 5; k++) expect((await t.step(k, t.scene.arm.homeRad)).ok).toBe(true);
    expect(running()).toContain(String(t.w.pid));
    await t.w.close('done');
    expect(running()).toEqual([]);
    expect(execFileSync('find', [workerRoot, '(', '-name', '__pycache__', '-o', '-name', '.pytest_cache', ')'], { encoding: 'utf8' }).trim()).toBe('');
  }, 60_000);
});
