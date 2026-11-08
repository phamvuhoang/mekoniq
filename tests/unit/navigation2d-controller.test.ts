import { expect, test } from 'vitest';
import { createNavigationController } from '../../packages/lab-runtime/src/v2/navigation2d/controller';
import type { Decision } from '../../packages/lab-runtime/src/v2/navigation2d/controller';
import { assessTrajectory } from '../../packages/lab-runtime/src/v2/navigation2d/oracle';
import { place, polygonsOverlap } from '../../packages/lab-runtime/src/v2/navigation2d/geometry';
import type { IRSimSnapshotV1, NavigationSceneV1 } from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import { hashJson } from '../../packages/lab-runtime/src/v2/hash';
import { navigationScene, type NavigationFixtureName } from '../support/navigation2d';

const DT = 0.02;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
/** The same scene without LiDAR: pure planning and following, no sensor dependence. */
const blind = (name: NavigationFixtureName) => { const s = clone(navigationScene(name)); s.robots.forEach((r) => { r.model.sensors = []; }); return s; };
const target = (s: NavigationSceneV1, id: string, robot = 0) => { const b = s.robots[robot]!.targetBindings.find((t) => t.pointId === id)!; return [b.x, b.y, b.yaw] as [number, number, number]; };

type Body = { x: number; y: number; yaw: number; v: number; w: number };
interface Run { snapshots: IRSimSnapshotV1[]; decisions: (Decision & { tick: number })[]; commands: { tick: number; robotId: string; v: number; w: number }[]; bodies: Record<string, Body> }
/** A kinematic stand-in for the engine: unicycle, acceleration limits, the new velocity applied before the pose integrates (as IR-SIM does). */
function simulate(scene: NavigationSceneV1, goals: Record<string, [number, number, number]>, ticks: number, opts: { scan?: (tick: number, b: Body) => IRSimSnapshotV1['robots'][number]['scans']; reservations?: Record<string, string | null>; stopWhen?: (r: Run) => boolean } = {}): Run {
  const c = createNavigationController(scene), p = scene.policy.parameters;
  const bodies: Record<string, Body> = Object.fromEntries(scene.robots.map((r) => [r.robotId, { x: r.initialPoseMap[0], y: r.initialPoseMap[1], yaw: r.initialPoseMap[2], v: 0, w: 0 }]));
  for (const [robotId, t] of Object.entries(goals)) c.setGoal({ robotId, commandId: `cmd-${robotId}`, target: t });
  const run: Run = { snapshots: [], decisions: [], commands: [], bodies };
  for (let tick = 0; tick < ticks; tick++) {
    const snap: IRSimSnapshotV1 = { schemaVersion: 1, runId: 'r', bootId: 'b', tick, simTimeNs: String(tick * 20_000_000), seq: String(tick + 1), sceneDigest: scene.sceneDigest,
      robots: scene.robots.map((r) => { const b = bodies[r.robotId]!; return { robotId: r.robotId, poseDriveMap: [b.x, b.y, ((b.yaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI], bodyVelocity: [b.v, b.w], scans: opts.scan?.(tick, b) ?? [], collisionIds: [] }; }) };
    run.snapshots.push(snap);
    const out = c.advance(snap, opts.reservations ?? {});
    out.decisions.forEach((d) => run.decisions.push({ ...d, tick }));
    for (const cmd of out.velocities) {
      run.commands.push({ tick, robotId: cmd.robotId, v: cmd.vMps, w: cmd.omegaRadps });
      const b = bodies[cmd.robotId]!;
      b.v = Math.max(b.v - p.maxAccelerationMps2 * DT, Math.min(b.v + p.maxAccelerationMps2 * DT, cmd.vMps));
      b.w = Math.max(b.w - p.maxAngularAccelerationRadps2 * DT, Math.min(b.w + p.maxAngularAccelerationRadps2 * DT, cmd.omegaRadps));
      b.yaw += b.w * DT; b.x += b.v * Math.cos(b.yaw) * DT; b.y += b.v * Math.sin(b.yaw) * DT;
    }
    if (opts.stopWhen?.(run)) break;
  }
  return run;
}
const terminal = (r: Run, robot = 'amr-1') => r.decisions.find((d) => d.robotId === robot && d.status !== 'executing');
const doneAll = (r: Run) => r.decisions.some((d) => d.status !== 'executing');
/** A fake LiDAR over world-fixed discs (people): ray-circle intersection for each of 360 beams. The sensor sits 0.22 m ahead of the axle, like the fixture's. */
const discScan = (tick: number, b: Body, discs: { x: number; y: number; r: number }[]): IRSimSnapshotV1['robots'][number]['scans'] => {
  const n = 360, inc = (2 * Math.PI) / (n - 1), min = -Math.PI, sx = b.x + 0.22 * Math.cos(b.yaw), sy = b.y + 0.22 * Math.sin(b.yaw);
  const ranges = Array.from({ length: n }, (_, i) => {
    const a = b.yaw + min + i * inc, dx = Math.cos(a), dy = Math.sin(a);
    let best: number | null = null;
    for (const d of discs) {
      const fx = sx - d.x, fy = sy - d.y, B = fx * dx + fy * dy, C = fx * fx + fy * fy - d.r * d.r, disc = B * B - C;
      if (disc < 0) continue;
      const t = -B - Math.sqrt(disc);
      if (t > 0.05 && t < 10 && (best === null || t < best)) best = t;
    }
    return best;
  });
  return [{ sensorId: 'lidar-2d', frameId: 'f', tick, simTimeNs: String(tick * 20_000_000), angleMinRad: min, angleIncrementRad: inc, rangeMinM: 0.05, rangeMaxM: 10, rangesM: ranges, states: ranges.map((r) => (r === null ? 'no_return' : 'hit')) }];
};
/** A 360-beam scan whose only hit is `ahead` metres in front of the sensor (beam at angle 0). */
const scanHit = (tick: number, ahead: number | null): IRSimSnapshotV1['robots'][number]['scans'] => {
  const n = 360, inc = (2 * Math.PI) / (n - 1), min = -Math.PI, i0 = Math.round(-min / inc), ranges = Array.from({ length: n }, (_, i) => (ahead !== null && i === i0 ? ahead : null));
  return [{ sensorId: 'lidar-2d', frameId: 'f', tick, simTimeNs: String(tick * 20_000_000), angleMinRad: min, angleIncrementRad: inc, rangeMinM: 0.05, rangeMaxM: 10, rangesM: ranges, states: ranges.map((r) => (r === null ? 'no_return' : 'hit')) }];
};

test('IR01 leg: bay to a table handoff arrives within tolerance, never touches anything and never exceeds a limit', () => {
  const s = blind('serve'), goal = target(s, 't-05');
  const r = simulate(s, { 'amr-1': goal }, 6000, { stopWhen: doneAll });
  expect(terminal(r)).toMatchObject({ status: 'arrived', reason: null });
  const b = r.bodies['amr-1']!;
  expect(Math.hypot(b.x - goal[0], b.y - goal[1])).toBeLessThanOrEqual(0.05);
  expect(Math.abs(Math.atan2(Math.sin(b.yaw - goal[2]), Math.cos(b.yaw - goal[2])))).toBeLessThanOrEqual(0.05);
  const a = assessTrajectory(s, r.snapshots);
  expect(a.contacts).toEqual([]);
  expect(a.coverage).toBe('complete');
  const k = s.robots[0]!.model.kinematics;
  let prev = { v: 0, w: 0 };
  for (const c of r.commands) {
    expect(Math.abs(c.v)).toBeLessThanOrEqual(k.maxLinearMps + 1e-9); expect(Math.abs(c.w)).toBeLessThanOrEqual(k.maxAngularRadps + 1e-9);
    expect(Math.abs((c.v - c.w * k.wheelSeparationM / 2) / k.wheelRadiusM)).toBeLessThanOrEqual(k.maxWheelRadps.left + 1e-9);
    expect(Math.abs(c.v - prev.v)).toBeLessThanOrEqual(0.5 * DT * 2 + 1e-9); // a step of the commanded velocity stays within about two ticks of acceleration
    prev = c;
  }
});

test('arriving at the right place with the wrong heading is not arrival; the final rotation completes it', () => {
  const s = blind('serve'), start = s.robots[0]!.initialPoseMap, goal: [number, number, number] = [start[0], start[1], start[2] + 1.2];
  const r = simulate(s, { 'amr-1': goal }, 3000, { stopWhen: doneAll });
  expect(r.decisions.filter((d) => d.status === 'arrived').length).toBe(1);
  const when = terminal(r)!.tick;
  expect(when).toBeGreaterThan(50); // 1.2 rad at <= 1 rad/s with ramps cannot be instant
  expect(r.decisions.slice(0, 5).every((d) => d.status === 'executing')).toBe(true);
  expect(Math.abs(r.bodies['amr-1']!.yaw - goal[2])).toBeLessThanOrEqual(0.05);
});

test('IR03 / CMP04: a free goal sealed off by geometry is no_path at once, zero velocity, and different from a temporary block', () => {
  const s = blind('enclosed-goal');
  const r = simulate(s, { 'amr-1': target(s, 'pocket') }, 50, { stopWhen: doneAll });
  expect(terminal(r)).toMatchObject({ status: 'no_path', reason: 'NO_PATH', tick: 0 });
  expect(r.commands.at(-1)).toMatchObject({ v: 0, w: 0 });
});

/** A 4 m partition across the whole restaurant with a single gap of 0.60 m at y = 5.7..6.3: the only way from x = 6 to x = 14 on the ground floor. */
const partition = (s: NavigationSceneV1) => {
  s.world.obstacles.push({ id: 'partition-a', verticesM: [[8, 0.1], [12, 0.1], [12, 5.7], [8, 5.7]] }, { id: 'partition-b', verticesM: [[8, 6.3], [12, 6.3], [12, 11.9], [8, 11.9]] });
  s.robots[0]!.initialPoseMap = [6, 6, 0];
  return s;
};
test('CMP03: a 0.60 m corridor passes the 0.54 m robot (+0.02 m) and refuses the 0.58 m one (-0.02 m), margin 0.02 m each side', () => {
  const through = (name: NavigationFixtureName) => simulate(partition(blind(name)), { 'amr-1': [14, 6, 0] }, 4000, { stopWhen: doneAll });
  const ok = through('serve');
  expect(terminal(ok)).toMatchObject({ status: 'arrived' });
  expect(assessTrajectory(partition(blind('serve')), ok.snapshots).contacts).toEqual([]);
  expect(terminal(through('wide'))).toMatchObject({ status: 'no_path' });
});

test('a lost or stale LiDAR means no clear path: zero velocity and attention, never a guess', () => {
  const s = clone(navigationScene('serve')), p = s.policy.parameters;
  p.noProgressTicks = 40;
  const r = simulate(s, { 'amr-1': target(s, 't-05') }, 200, { stopWhen: doneAll }); // the model has a LiDAR but the snapshots carry no scan
  expect(r.commands.every((c) => c.v === 0 && c.w === 0)).toBe(true);
  expect(r.decisions.find((d) => d.status === 'executing')).toMatchObject({ reason: 'SENSOR_STALE' });
  expect(terminal(r)).toMatchObject({ status: 'blocked', reason: 'SENSOR_STALE' });
  const stale = simulate(s, { 'amr-1': target(s, 't-05') }, 10, { scan: (tick) => scanHit(tick - 20, null) });
  expect(stale.commands.every((c) => c.v === 0)).toBe(true);
});

test('IR02: a person standing in the aisle stops the robot short of contact (not a no_path); when they leave it carries on to the goal', () => {
  const s = clone(navigationScene('serve')), person = { x: 6, y: 6, r: 0.25 };
  s.robots[0]!.initialPoseMap = [3, 6, 0];
  s.policy.parameters.noProgressTicks = 3000;
  const r = simulate(s, { 'amr-1': [14, 6, 0] }, 9000, { scan: (tick, b) => discScan(tick, b, tick < 700 ? [person] : []), stopWhen: doneAll });
  // it reacts to what only the sensor shows: it holds, then (the aisle is wide) replans around the person instead of waiting
  expect(r.decisions.filter((d) => d.reason === 'DYNAMIC_OBSTACLE').length).toBeGreaterThanOrEqual(1);
  expect(r.decisions.some((d) => d.status === 'no_path')).toBe(false);
  expect(terminal(r)).toMatchObject({ status: 'arrived' });
  // never closer than the safety margin to the person, measured on surfaces (disc approximated by its bounding square, a conservative stand-in)
  const square: [number, number][] = [[person.x - person.r, person.y - person.r], [person.x + person.r, person.y - person.r], [person.x + person.r, person.y + person.r], [person.x - person.r, person.y + person.r]];
  for (const snap of r.snapshots.filter((x) => x.tick < 700)) {
    const body = place(s.robots[0]!.model.footprint.verticesM as [number, number][], ...(snap.robots[0]!.poseDriveMap as [number, number, number]));
    expect(polygonsOverlap(body, square)).toBe(false);
  }
});

test('a person that never leaves a one-lane corridor makes the goal blocked (path existed, no progress), not no_path', () => {
  const s = partition(clone(navigationScene('serve'))), person = { x: 10, y: 6, r: 0.25 };
  s.policy.parameters.noProgressTicks = 300;
  const r = simulate(s, { 'amr-1': [14, 6, 0] }, 6000, { scan: (tick, b) => discScan(tick, b, [person]), stopWhen: doneAll });
  expect(terminal(r)).toMatchObject({ status: 'blocked' });
  expect(r.decisions.every((d) => d.status !== 'no_path')).toBe(true);
  expect(r.bodies['amr-1']!.x).toBeLessThan(10 - 0.25);
});

test('a denied zone is planned around; once the reservation is granted to this robot the straight way is used', () => {
  const build = () => { const s = blind('serve'); s.robots[0]!.initialPoseMap = [6, 6, 0]; s.zones.push({ id: 'corridor', polygonM: [[9, 4.3], [10, 4.3], [10, 7.7], [9, 7.7]], entryPoints: [], exitPoints: [] }); return s; };
  const zone = [[9, 4.3], [10, 4.3], [10, 7.7], [9, 7.7]] as [number, number][];
  const enters = (r: Run, s: NavigationSceneV1) => r.snapshots.some((x) => polygonsOverlap(place(s.robots[0]!.model.footprint.verticesM as [number, number][], ...(x.robots[0]!.poseDriveMap as [number, number, number])), zone));
  const s1 = build(), denied = simulate(s1, { 'amr-1': [14, 6, 0] }, 8000, { reservations: { corridor: null }, stopWhen: doneAll });
  const s2 = build(), granted = simulate(s2, { 'amr-1': [14, 6, 0] }, 8000, { reservations: { corridor: 'amr-1' }, stopWhen: doneAll });
  expect(terminal(denied)).toMatchObject({ status: 'arrived' });
  expect(terminal(granted)).toMatchObject({ status: 'arrived' });
  expect(enters(denied, s1)).toBe(false);
  expect(enters(granted, s2)).toBe(true);
  expect(terminal(denied)!.tick).toBeGreaterThan(terminal(granted)!.tick);
  expect(simulate(build(), { 'amr-1': [14, 6, 0] }, 8000, { reservations: { corridor: 'amr-2' }, stopWhen: doneAll }).snapshots.some((x) => polygonsOverlap(place(s1.robots[0]!.model.footprint.verticesM as [number, number][], ...(x.robots[0]!.poseDriveMap as [number, number, number])), zone))).toBe(false); // granted to someone else is denied too
});

test('wheel limits scale a command before it is sent', () => {
  const s = blind('serve');
  s.robots[0]!.model.kinematics.maxWheelRadps = { left: 2, right: 2 }; // 2 rad/s * 0.09 m = 0.18 m/s
  const r = simulate(s, { 'amr-1': target(s, 'pass') }, 400);
  const k = s.robots[0]!.model.kinematics;
  for (const c of r.commands) {
    expect(Math.abs((c.v - c.w * k.wheelSeparationM / 2) / k.wheelRadiusM)).toBeLessThanOrEqual(2 + 1e-9);
    expect(Math.abs((c.v + c.w * k.wheelSeparationM / 2) / k.wheelRadiusM)).toBeLessThanOrEqual(2 + 1e-9);
  }
  expect(Math.max(...r.commands.map((c) => c.v))).toBeGreaterThan(0.1);
});

test('same inputs, same decisions, same velocities; a tiny state budget is blocked, a short deadline is blocked, cancel is one terminal event', () => {
  const s = blind('serve'), goal = target(s, 't-05');
  const a = simulate(s, { 'amr-1': goal }, 600), b = simulate(s, { 'amr-1': goal }, 600);
  expect(hashJson(a.commands)).toBe(hashJson(b.commands));
  const tiny = clone(s); tiny.policy.parameters.maxPlannerStates = 30;
  expect(terminal(simulate(tiny, { 'amr-1': goal }, 10))).toMatchObject({ status: 'blocked', reason: 'PLANNER_BUDGET_EXCEEDED' });
  const short = clone(s); short.policy.parameters.goalDeadlineTicks = 120;
  expect(terminal(simulate(short, { 'amr-1': goal }, 400))).toMatchObject({ status: 'blocked', reason: 'GOAL_DEADLINE' });
  const c = createNavigationController(s);
  c.setGoal({ robotId: 'amr-1', commandId: 'c1', target: goal });
  c.cancel('amr-1', 'c1'); c.cancel('amr-1', 'c1');
  const out = c.advance({ schemaVersion: 1, runId: 'r', bootId: 'b', tick: 0, simTimeNs: '0', seq: '1', sceneDigest: s.sceneDigest, robots: [{ robotId: 'amr-1', poseDriveMap: s.robots[0]!.initialPoseMap, bodyVelocity: [0, 0], scans: [], collisionIds: [] }] }, {});
  expect(out.decisions).toEqual([{ robotId: 'amr-1', commandId: 'c1', status: 'cancelled', reason: null }]);
  expect(out.velocities).toEqual([{ robotId: 'amr-1', vMps: 0, omegaRadps: 0 }]);
});
