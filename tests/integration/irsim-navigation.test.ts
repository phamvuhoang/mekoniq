// The controller drives the real IR-SIM plant through the worker, tick by tick; the oracle judges the observed trace on its own.
import { afterEach, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createNavigationCompiler } from '../../packages/lab-runtime/src/engineering/navigation-compiler';
import { lockDigestOf } from '../../packages/lab-runtime/src/engineering/linkforge';
import { createNavigationController } from '../../packages/lab-runtime/src/v2/navigation2d/controller';
import type { Decision } from '../../packages/lab-runtime/src/v2/navigation2d/controller';
import { assessTrajectory } from '../../packages/lab-runtime/src/v2/navigation2d/oracle';
import { spawnIRSimWorker, type IRSimWorkerClient } from '../../packages/lab-runtime/src/v2/navigation2d/worker-client';
import type { IRSimRequestV1, IRSimSnapshotV1, NavigationSceneV1 } from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import { navigationFixture, type NavigationFixtureName } from '../support/navigation2d';

const irPython = resolve('.venv-irsim/bin/python'), workerRoot = resolve('robotics/navigation-2d'), schemaDir = resolve('packages/contracts/schemas');
const available = existsSync(irPython) && (() => { try { execFileSync(irPython, ['-c', 'import irsim, yaml, rfc8785, jsonschema, referencing'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const roots: string[] = [], clients: IRSimWorkerClient[] = [];
afterEach(async () => { for (const c of clients.splice(0)) await c.close('test over'); for (const d of roots.splice(0)) await rm(d, { recursive: true, force: true }); });
const temp = async (p: string) => { const d = await mkdtemp(join(tmpdir(), p)); roots.push(d); return d; };

/** Compiles the fixture (optionally after editing the compile input), starts a worker on the bundle and returns a per-tick stepper. */
async function plant(name: NavigationFixtureName, edit?: (input: ReturnType<typeof navigationFixture>['input']) => void) {
  const input = structuredClone(navigationFixture(name).input);
  edit?.(input);
  const bundleRoot = await temp('irsim-nav-');
  await createNavigationCompiler({ python: irPython, workerRoot, descriptionHelperRoot: resolve('robotics/simulation') }).compileResolved(input, bundleRoot);
  const scene = JSON.parse(readFileSync(join(bundleRoot, 'navigation-scene.json'), 'utf8')) as NavigationSceneV1;
  const client = await spawnIRSimWorker({ python: irPython, workerRoot, runId: 'run-1', bundleRoot, runDirectory: await temp('irsim-nav-run-'), lockDigest: await lockDigestOf(join(workerRoot, 'requirements.lock')), schemaDir, sceneDigest: scene.sceneDigest });
  clients.push(client);
  let n = 0, tick = 0;
  const ask = async (op: IRSimRequestV1['op'], payload: Record<string, unknown> = {}) => {
    const r = await client.request({ protocol: 'mekoniq-irsim/1', requestId: `q${++n}`, runId: 'run-1', expectedTick: tick, op, payload } as IRSimRequestV1);
    if (!r.ok) throw new Error(`${op}: ${(r as { error: { code: string } }).error.code}`);
    tick = r.tick;
    return r.result as IRSimSnapshotV1;
  };
  let snap = await ask('create', { sceneRef: 'navigation-scene.json', seed: 5 });
  await ask('start', {});
  const trace: IRSimSnapshotV1[] = [snap];
  const step = async (velocities: { robotId: string; vMps: number; omegaRadps: number }[]) => { snap = await ask('step', { targetTick: tick + 1, velocities, actorUpdates: [] }); trace.push(snap); return snap; };
  return { scene, trace, step, snapshot: () => snap };
}
/** The runner's job in miniature: observe, decide, send, repeat until every goal has a terminal decision. */
async function drive(p: Awaited<ReturnType<typeof plant>>, goals: Record<string, [number, number, number]>, maxTicks = 6000) {
  const c = createNavigationController(p.scene), done: Decision[] = [];
  for (const [robotId, target] of Object.entries(goals)) c.setGoal({ robotId, commandId: `leg-${robotId}`, target });
  for (let i = 0; i < maxTicks && done.length < Object.keys(goals).length; i++) {
    const out = c.advance(p.snapshot(), {});
    done.push(...out.decisions.filter((d) => d.status !== 'executing'));
    await p.step(out.velocities);
  }
  return done;
}
const bind = (s: NavigationSceneV1, id: string): [number, number, number] => { const b = s.robots[0]!.targetBindings.find((t) => t.pointId === id)!; return [b.x, b.y, b.yaw]; };

test.skipIf(!available)('IR01: bay -> kitchen pass -> table 05 by body velocities only; the oracle sees no contact and the engine never reports one', async () => {
  const p = await plant('serve');
  for (const id of ['pass', 't-05']) {
    const target = bind(p.scene, id);
    const done = await drive(p, { 'amr-1': target });
    expect(done, id).toMatchObject([{ status: 'arrived' }]);
    const pose = p.snapshot().robots[0]!.poseDriveMap;
    expect(Math.hypot(pose[0]! - target[0], pose[1]! - target[1]), id).toBeLessThanOrEqual(0.05);
    expect(Math.abs(Math.atan2(Math.sin(pose[2]! - target[2]), Math.cos(pose[2]! - target[2]))), id).toBeLessThanOrEqual(0.05);
  }
  const a = assessTrajectory(p.scene, p.trace);
  expect(a.coverage).toBe('complete');
  expect(a.contacts).toEqual([]);
  expect(p.trace.every((s) => s.robots[0]!.collisionIds.length === 0)).toBe(true);
  expect(p.trace.length).toBeGreaterThan(300);
  const travelled = p.trace.slice(1).reduce((d, s, i) => d + Math.hypot(s.robots[0]!.poseDriveMap[0]! - p.trace[i]!.robots[0]!.poseDriveMap[0]!, s.robots[0]!.poseDriveMap[1]! - p.trace[i]!.robots[0]!.poseDriveMap[1]!), 0);
  expect(travelled).toBeGreaterThan(Math.hypot(10 - 2, 3.9 - 1.5)); // distance comes from the observations, and a detour around the tables is longer than the straight line
});

test.skipIf(!available)('IR03: a free goal sealed off by walls is no_path before the first step, and the robot never moves', async () => {
  const p = await plant('enclosed-goal');
  const done = await drive(p, { 'amr-1': bind(p.scene, 'pocket') }, 5);
  expect(done[0]).toMatchObject({ status: 'no_path', reason: 'NO_PATH' });
  const start = p.trace[0]!.robots[0]!.poseDriveMap;
  expect(p.trace.every((s) => Math.hypot(s.robots[0]!.poseDriveMap[0]! - start[0]!, s.robots[0]!.poseDriveMap[1]! - start[1]!) < 1e-9)).toBe(true);
});

test.skipIf(!available)('IR06: with the controller bypassed (test only) the engine reports contact with the table, stops the robot, and the oracle agrees from the trace', async () => {
  // chassis at (10, 2.0) heading north (+y): the front edge meets table-05 (y = 2.6) after ~0.3 m
  const p = await plant('serve', (i) => { const c = i.resolved.placements.find((x) => x.instanceId === 'chassis')!; c.world = { xyzM: [10, 2.0, 0.09], quaternionXyzw: [0, 0, Math.SQRT1_2, Math.SQRT1_2] }; });
  for (let k = 0; k < 400; k++) await p.step([{ robotId: 'amr-1', vMps: 0.4, omegaRadps: 0 }]); // no controller, no guard: a raw velocity into the table
  const contactTick = p.trace.findIndex((s) => s.robots[0]!.collisionIds.includes('table-05'));
  expect(contactTick).toBeGreaterThan(0);
  const a = assessTrajectory(p.scene, p.trace);
  expect(a.coverage).toBe('complete');
  expect(a.contacts.filter((c) => c.source === 'engine_discrete').map((c) => c.pair.join('|'))).toContain('amr-1|table-05');
  expect(a.contacts.some((c) => c.source === 'swept_oracle' || c.source === 'safety_envelope')).toBe(true); // found independently of the engine
  const y = p.trace.map((s) => s.robots[0]!.poseDriveMap[1]!);
  expect(y.at(-1)! - y[contactTick]!).toBeLessThan(0.05); // collision_mode stop: it does not drive on through
});
