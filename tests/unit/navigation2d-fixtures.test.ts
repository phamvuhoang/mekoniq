import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { linkWorldPoses } from '../../packages/lab-runtime/src/engineering/assembly';
import { projectPhysicalModel } from '../../packages/lab-runtime/src/engineering/physical-model';
import { inertiaProblems } from '../../packages/lab-runtime/src/engineering/inertia';
import { NAVIGATION_SCHEMA_HASH, validateNavigationDocument } from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import { hashJson } from '../../packages/lab-runtime/src/v2/hash';
import { exportedFixtureFiles, navigationFixture, type NavigationFixtureName } from '../support/navigation2d';

const NAMES: NavigationFixtureName[] = ['serve', 'wide', 'overhang', 'two-robot', 'enclosed-goal', 'fleet', 'enclosed-table'];
const model = (name: NavigationFixtureName, robot = 'amr-1') => projectPhysicalModel(navigationFixture(name).input, robot, NAVIGATION_SCHEMA_HASH);
const shapes = (name: NavigationFixtureName) => navigationFixture(name).input.resolved.links.flatMap((l) => l.collision.map((c) => ({ link: l.id, ...c })));
const sourcesIn = (v: unknown, out: { kind: string; documentId: string }[] = []) => {
  if (Array.isArray(v)) v.forEach((x) => sourcesIn(x, out));
  else if (v && typeof v === 'object') { const o = v as Record<string, unknown>; if (typeof o.kind === 'string' && typeof o.documentId === 'string' && 'contentSha256' in o) out.push(o as never); else Object.values(o).forEach((x) => sourcesIn(x, out)); }
  return out;
};
const inside = (x: number, y: number, r: { x: number; y: number; width: number; height: number }, m = 0) => x > r.x - m && x < r.x + r.width + m && y > r.y - m && y < r.y + r.height + m;

test('every fixture resolves through the source resolver and projects a valid physical model for each robot', () => {
  for (const name of NAMES) {
    const f = navigationFixture(name);
    expect(f.input.resolved.models.driveBindingsVersion, name).toBe(1);
    for (const e of f.input.project.runtimeProject.entities) expect(validateNavigationDocument(model(name, e.id)), `${name}/${e.id}`).toMatchObject({ ok: true });
  }
});

test('LF01 census: three trays, two tilted supports, two wheels, one LiDAR; one connected tree rooted at the chassis', () => {
  const links = navigationFixture('serve').input.resolved.links.map((l) => l.id);
  expect(links.filter((l) => /^tray-\d\/plate$/.test(l))).toHaveLength(3);
  expect(links.filter((l) => /^support-(left|right)\/rod$/.test(l))).toHaveLength(2);
  expect(links.filter((l) => /^wheel-(left|right)\/rim$/.test(l))).toHaveLength(2);
  expect(links.filter((l) => l === 'lidar/head')).toHaveLength(1);
  const m = model('serve');
  expect(m.baseFrameId).toBe('chassis/base');
  expect(m.sensors).toHaveLength(1);
  expect(m.sensors[0]).toMatchObject({ sourceInstanceId: 'lidar', parentLinkId: 'lidar/head' });
  const poses = linkWorldPoses(navigationFixture('serve').input.resolved);
  for (const rod of ['support-left/rod', 'support-right/rod']) expect(Math.abs(poses.get(rod)!.quaternionXyzw[1]!)).toBeGreaterThan(0.05); // tilted
  for (const t of ['tray-1/plate', 'tray-2/plate', 'tray-3/plate']) expect(poses.get(t)!.quaternionXyzw.map((v) => +v.toFixed(9))).toEqual([0, 0, 0, 1]); // trays stay level
});

test('base dimensions, wheels and drive frame match the stated fixture values', () => {
  const box = (name: NavigationFixtureName, link: string) => (shapes(name).find((s) => s.link === link)!.geometry as { sizeM: number[] }).sizeM;
  expect(box('serve', 'chassis/base').slice(0, 2)).toEqual([0.6, 0.54]);
  expect(box('wide', 'chassis/base').slice(0, 2)).toEqual([0.6, 0.58]);
  const d = model('serve').drive!;
  expect([d.wheelRadiusM.value, d.wheelSeparationM.value]).toEqual([0.09, 0.36]);
  expect(d.driveFrameInBase.xyzM.map((v) => +v.toFixed(9))).toEqual([0, 0, 0]);
  const placement = navigationFixture('serve').input.resolved.placements.find((p) => p.instanceId === 'chassis')!;
  expect(placement.world.xyzM).toEqual([2, 1.5, 0.09]); // axle height = wheel radius
});

test('CMP02/03 inputs: trays and supports stand out behind the chassis; the overhang variant is 0.65 m wide', () => {
  const widthOf = (name: NavigationFixtureName) => {
    const poses = linkWorldPoses(navigationFixture(name).input.resolved);
    const ys = shapes(name).filter((s) => s.link !== 'chassis/base' && s.geometry.kind === 'box').flatMap((s) => {
      const p = poses.get(s.link)!, g = s.geometry as { sizeM: number[] };
      return [p.position[1]! + s.pose.xyzM[1]! - g.sizeM[1]! / 2, p.position[1]! + s.pose.xyzM[1]! + g.sizeM[1]! / 2];
    });
    return +(Math.max(...ys) - Math.min(...ys)).toFixed(6);
  };
  expect(widthOf('overhang')).toBeGreaterThanOrEqual(0.65);
  expect(widthOf('serve')).toBeLessThan(0.54);
  const poses = linkWorldPoses(navigationFixture('serve').input.resolved);
  const rearEdge = poses.get('tray-3/plate')!.position[0]! - 0.2;
  expect(rearEdge).toBeLessThan(2 - 0.3); // beyond the chassis rear edge (x = 2.0 - 0.30)
});

test('provenance: only assumed or derived sources, inertia derived from the formulas, and every tensor is physical', () => {
  for (const name of NAMES) {
    const kinds = new Set(sourcesIn(navigationFixture(name).input.resolved).map((s) => s.kind));
    expect([...kinds].every((k) => k === 'assumed' || k === 'derived'), name).toBe(true);
  }
  const resolved = navigationFixture('serve').input.resolved;
  for (const l of resolved.links) { expect(l.inertialSource.kind, l.id).toBe('derived'); expect(l.massKg.source.kind, l.id).toBe('assumed'); expect(inertiaProblems(l.inertiaKgM2!), l.id).toEqual([]); }
  const tray = resolved.links.find((l) => l.id === 'tray-1/plate')!, [x, y, z] = [0.4, 0.46, 0.02];
  expect(tray.inertiaKgM2).toEqual([tray.massKg.value * (y * y + z * z) / 12, 0, 0, tray.massKg.value * (x * x + z * z) / 12, 0, tray.massKg.value * (x * x + y * y) / 12]);
  const lidar = resolved.models.sensor.lidar!.parameters as { range: { min: { value: number }; max: { value: number } }; fieldOfView: { value: number }; rateHz: { value: number }; noise: { distribution: string }; latency: { value: number }; dropoutProbability: { value: number }; lidar2d: { beamCount: number; beamCountSource: { kind: string; locator: string } } };
  expect([lidar.range.min.value, lidar.range.max.value, lidar.fieldOfView.value, lidar.rateHz.value, lidar.lidar2d.beamCount]).toEqual([0.05, 10, 2 * Math.PI, 10, 360]);
  expect([lidar.noise.distribution, lidar.latency.value, lidar.dropoutProbability.value]).toEqual(['none', 0, 0]);
  expect(lidar.lidar2d.beamCountSource.kind).toBe('assumed');
  expect(JSON.stringify(resolved.models.sensor)).not.toMatch(/rplidar|slamtec/i); // not a vendor-locked part
});

test('restaurant world: 20 x 12 m, ten table obstacles each with an outside handoff, stable ids', () => {
  const w = navigationFixture('serve').input.project.runtimeProject.world;
  expect([w.width, w.height]).toEqual([20, 12]);
  const tables = w.obstacles.filter((o) => /^table-\d\d$/.test(o.id));
  expect(tables).toHaveLength(10);
  expect(w.points.map((p) => p.id)).toEqual(expect.arrayContaining(['pass', 'bay-1', 'bay-2', ...tables.map((_, i) => `t-${String(i + 1).padStart(2, '0')}`)]));
  for (let i = 1; i <= 10; i++) {
    const id = String(i).padStart(2, '0'), point = w.points.find((p) => p.id === `t-${id}`)!, table = w.obstacles.find((o) => o.id === `table-${id}`)!, handoff = w.handoffPoints!.find((h) => h.id === `t-${id}.handoff`)!;
    expect(inside(point.x, point.y, table), `table point ${id} sits on its table`).toBe(true);
    expect(w.obstacles.some((o) => inside(handoff.position[0]!, handoff.position[1]!, o, 0.3)), `handoff ${id} is clear of every obstacle by 0.3 m`).toBe(false);
    expect(handoff.yawRad).not.toBeNull();
  }
  const pass = w.handoffPoints!.find((h) => h.id === 'pass.handoff')!;
  expect(w.obstacles.some((o) => inside(pass.position[0]!, pass.position[1]!, o, 0.3))).toBe(false);
});

test('two-robot: independent namespaces with different drive values and models', () => {
  const f = navigationFixture('two-robot');
  const drives = f.input.resolved.models.drivesByEntity!;
  expect(Object.keys(drives)).toEqual(['amr-1', 'amr-2']);
  const read = (e: string) => model('two-robot', e).drive!;
  expect([read('amr-1').wheelRadiusM.value, read('amr-2').wheelRadiusM.value]).toEqual([0.09, 0.1]);
  expect([read('amr-1').wheelSeparationM.value, read('amr-2').wheelSeparationM.value]).toEqual([0.36, 0.42]);
  expect(model('two-robot', 'amr-1').links.every((l) => l.id.startsWith('r1-'))).toBe(true);
  expect(model('two-robot', 'amr-1').modelDigest).not.toBe(model('two-robot', 'amr-2').modelDigest);
});

test('C02 fleet: robot01 and robot02 have their own drive values, LiDAR beam counts and ranges (two physical models, never a singleton)', () => {
  const read = (e: string) => model('fleet', e);
  expect(Object.keys(navigationFixture('fleet').input.resolved.models.drivesByEntity!)).toEqual(['robot01', 'robot02']);
  expect([read('robot01').drive!.wheelRadiusM.value, read('robot02').drive!.wheelRadiusM.value]).toEqual([0.09, 0.1]);
  expect([read('robot01').drive!.wheelSeparationM.value, read('robot02').drive!.wheelSeparationM.value]).toEqual([0.36, 0.42]);
  expect(JSON.stringify(read('robot01').sensors)).toMatch(/"beamCount":360/);expect(JSON.stringify(read('robot02').sensors)).toMatch(/"beamCount":180/);
  expect(read('robot01').modelDigest).not.toBe(read('robot02').modelDigest);
});

for (const [name, pointId] of [['enclosed-goal', 'pocket'], ['enclosed-table', 't-01']] as const) test(`CMP04 input (${name}): the ${pointId} handoff is free space (admissible) that no path from the bay can reach`, () => {
  const w = navigationFixture(name).input.project.runtimeProject.world;
  const goal = w.handoffPoints!.find((h) => h.id === `${pointId}.handoff`)!, start = w.points.find((p) => p.id === 'bay-1')!;
  expect(w.obstacles.some((o) => inside(goal.position[0]!, goal.position[1]!, o, 0.3))).toBe(false); // not in collision
  const res = 0.05, nx = Math.round(w.width / res), ny = Math.round(w.height / res);
  // cells closer to an obstacle than the Serve chassis' half width (0.27 m) cannot hold its centre (the T01 pocket has 0.4 m slits beside the table)
  const blocked = (i: number, j: number) => w.obstacles.some((o) => inside((i + 0.5) * res, (j + 0.5) * res, o, 0.27));
  const seen = new Set<number>(), stack = [[Math.floor(start.x / res), Math.floor(start.y / res)] as [number, number]];
  while (stack.length) {
    const [i, j] = stack.pop()!, k = j * nx + i;
    if (i < 0 || j < 0 || i >= nx || j >= ny || seen.has(k) || blocked(i, j)) continue;
    seen.add(k); stack.push([i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]);
  }
  expect(seen.has(Math.floor(goal.position[1]! / res) * nx + Math.floor(goal.position[0]! / res))).toBe(false);
  expect(seen.size).toBeGreaterThan(1000); // the rest of the restaurant is connected
});

test('fixtures are deterministic, and the committed JSON is exactly what the builders produce', () => {
  for (const name of NAMES) {
    expect(navigationFixture(name).input.resolved.assemblyDigest, name).toBe(navigationFixture(name).input.resolved.assemblyDigest);
    expect(hashJson(navigationFixture(name).input.project), name).toBe(navigationFixture(name).input.projectDigest);
  }
  for (const [file, content] of Object.entries(exportedFixtureFiles())) expect(JSON.parse(readFileSync(new URL(`../fixtures/navigation2d/${file}`, import.meta.url), 'utf8')), file).toEqual(JSON.parse(JSON.stringify(content)));
});
