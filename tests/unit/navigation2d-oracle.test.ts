import { expect, test } from 'vitest';
import { assessTrajectory } from '../../packages/lab-runtime/src/v2/navigation2d/oracle';
import { place, polygonDistance, polygonsOverlap, sweptHulls } from '../../packages/lab-runtime/src/v2/navigation2d/geometry';
import type { IRSimSnapshotV1, NavigationSceneV1 } from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import { navigationScene } from '../support/navigation2d';

const serve = navigationScene('serve'), two = navigationScene('two-robot');
const snap = (scene: NavigationSceneV1, tick: number, poses: Record<string, [number, number, number]>, collisions: Record<string, string[]> = {}): IRSimSnapshotV1 => ({
  schemaVersion: 1, runId: 'r', bootId: 'b', tick, simTimeNs: String(tick * 20_000_000), seq: String(tick + 1), sceneDigest: scene.sceneDigest,
  robots: scene.robots.map((r) => ({ robotId: r.robotId, poseDriveMap: poses[r.robotId] ?? r.initialPoseMap, bodyVelocity: [0, 0], scans: [], collisionIds: collisions[r.robotId] ?? [] })),
});
const run = (scene: NavigationSceneV1, n: number, at: (k: number) => Record<string, [number, number, number]>) => Array.from({ length: n }, (_, k) => snap(scene, k, at(k)));
const hullOf = (scene: NavigationSceneV1, id = 'amr-1') => scene.robots.find((r) => r.robotId === id)!.model.footprint.verticesM as [number, number][];

test('geometry: overlap, touching and surface distance are exact on axis-aligned boxes', () => {
  const a: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]], b = (dx: number): [number, number][] => a.map(([x, y]) => [x + dx, y]);
  expect([polygonsOverlap(a, b(0.5)), polygonsOverlap(a, b(1)), polygonsOverlap(a, b(1.5))]).toEqual([true, false, false]); // touching is not overlap
  expect(polygonDistance(a, b(1.5))).toBeCloseTo(0.5, 12);
  expect(polygonDistance(a, b(0.5))).toBe(0);
  expect(polygonDistance(a, [[2, 2], [3, 2], [3, 3], [2, 3]])).toBeCloseTo(Math.SQRT2, 12); // corner to corner
  expect(sweptHulls(a, [0, 0, 0], [0, 0, 1]).length).toBeGreaterThan(4); // 1 rad needs several yaw samples
});

test('a clean drive along the aisle is complete coverage with no contact and no robot-robot metric for one robot', () => {
  const a = assessTrajectory(serve, run(serve, 51, (k) => ({ 'amr-1': [3 + k * 0.02, 6, 0] })));
  expect(a).toEqual({ contacts: [], minSeparationM: null, minClearanceM: expect.any(Number), coverage: 'complete' });
  expect(a.minClearanceM!).toBeGreaterThan(1); // nearest solid is the kitchen counter, well clear of the aisle
});

test('engine contacts, overlaps found here and margin breaches are three different kinds of evidence', () => {
  const table = serve.world.obstacles.find((o) => o.id === 'table-05')!, top = Math.max(...table.verticesM.map((v) => v[1]));
  const fp = hullOf(serve);
  const atGap = (gap: number) => { const y = top + gap - Math.min(...place(fp, 0, 0, 0).map((v) => v[1])); return [10, y, 0] as [number, number, number]; };
  const engine = assessTrajectory(serve, [snap(serve, 0, { 'amr-1': atGap(0.5) }, { 'amr-1': ['table-05'] })]);
  expect(engine.contacts).toEqual([{ tick: 0, pair: ['amr-1', 'table-05'], source: 'engine_discrete' }]);
  const overlap = assessTrajectory(serve, [snap(serve, 0, { 'amr-1': atGap(-0.05) })]);
  expect(overlap.contacts.map((c) => c.source)).toContain('swept_oracle');
  const near = assessTrajectory(serve, [snap(serve, 0, { 'amr-1': atGap(0.01) })]);
  expect(near.contacts).toEqual([{ tick: 0, pair: ['amr-1', 'table-05'], source: 'safety_envelope' }]); // inside the 0.02 m margin, not touching
  expect(assessTrajectory(serve, [snap(serve, 0, { 'amr-1': atGap(0.05) })]).contacts).toEqual([]);
});

test('IR07: a thin wall between two ticks is found by the swept check although no snapshot overlaps it', () => {
  const thin = structuredClone(serve);
  thin.world.obstacles.push({ id: 'thin', verticesM: [[5.0, 5.5], [5.002, 5.5], [5.002, 6.5], [5.0, 6.5]] });
  const jump = [snap(thin, 0, { 'amr-1': [4, 6, 0] }), snap(thin, 1, { 'amr-1': [6.2, 6, 0] })]; // a 2.2 m step through x = 5.0
  for (const s of jump) expect(assessTrajectory(thin, [s]).contacts.filter((c) => c.pair.includes('thin'))).toEqual([]);
  const crossing = assessTrajectory(thin, jump).contacts.filter((c) => c.pair.includes('thin'));
  expect(crossing).toEqual([{ tick: 1, pair: ['amr-1', 'thin'], source: 'swept_oracle' }]);
  const beside = [snap(thin, 0, { 'amr-1': [4, 4.5, 0] }), snap(thin, 1, { 'amr-1': [6.2, 4.5, 0] })];
  expect(assessTrajectory(thin, beside).contacts.filter((c) => c.pair.includes('thin'))).toEqual([]);
});

test('coverage gaps never become a clean pass: missing ticks, robots or a foreign scene make everything unavailable', () => {
  const ok = run(two, 3, () => ({ 'amr-1': [2, 1.5, 0], 'amr-2': [3.5, 1.5, 0] }));
  expect(assessTrajectory(two, ok).coverage).toBe('complete');
  expect(assessTrajectory(two, [ok[0]!, ok[2]!]).coverage).toBe('incomplete'); // tick 1 missing
  expect(assessTrajectory(two, [ok[0]!, ok[0]!]).coverage).toBe('incomplete'); // duplicate
  expect(assessTrajectory(two, [{ ...ok[0]!, robots: ok[0]!.robots.slice(0, 1) }]).coverage).toBe('incomplete');
  expect(assessTrajectory(two, [{ ...ok[0]!, sceneDigest: 'f'.repeat(64) }]).coverage).toBe('incomplete');
  const gap = assessTrajectory(two, [ok[0]!, ok[2]!]);
  expect(gap.minSeparationM).toBeNull();
  expect(gap.minClearanceM).toBeNull();
  expect(assessTrajectory(two, []).coverage).toBe('incomplete');
});

test('robot-robot separation is surface to surface (overhang included), not centre distance', () => {
  const a = hullOf(two, 'amr-1'), b = hullOf(two, 'amr-2'), maxA = Math.max(...a.map((v) => v[0])), minB = Math.min(...b.map((v) => v[0]));
  const result = assessTrajectory(two, [snap(two, 0, { 'amr-1': [6, 6, 0], 'amr-2': [8, 6, 0] })]);
  expect(result.minSeparationM).toBeCloseTo(8 + minB - (6 + maxA), 9);
  expect(result.minSeparationM).not.toBeCloseTo(2, 3);
  expect(assessTrajectory(two, [snap(two, 0, { 'amr-1': [6, 6, 0], 'amr-2': [6.2, 6, 0] })]).contacts.map((c) => c.pair.join('|'))).toContain('amr-1|amr-2');
});

test('C02 actors: a scripted person is a solid for the oracle at its pose of each tick: overlap and sweep are swept_oracle contacts of (robot, actor), a near pass is a margin breach, a far one nothing', () => {
  // the robot drives east along y 6 at 2 cm/tick; the person stands still at x0 on the same line (radius 0.25)
  const drive = run(serve, 51, (k) => ({ 'amr-1': [3 + k * 0.02, 6, 0] }));
  const at = (x: number, y: number) => () => [{ id: 'person-1', x, y, radiusM: 0.25 }];
  const pairs = (a: ReturnType<typeof assessTrajectory>) => [...new Set(a.contacts.map((c) => `${c.pair.join('|')}/${c.source}`))];
  expect(pairs(assessTrajectory(serve, drive, at(4.2, 6)))).toEqual(expect.arrayContaining(['amr-1|person-1/swept_oracle']));
  // abreast at 0.25 + half width + 1 cm: inside the 2 cm safety margin, never touching
  const half = Math.max(...hullOf(serve).map((v) => v[1]));
  expect(pairs(assessTrajectory(serve, drive, at(3.5, 6 + half + 0.25 + 0.01)))).toEqual(['amr-1|person-1/safety_envelope']);
  expect(assessTrajectory(serve, drive, at(3.5, 9)).contacts).toEqual([]);
  // without the actor feed the same trajectory is clean: the contact above comes from the actor, not from the scene
  expect(assessTrajectory(serve, drive).contacts).toEqual([]);
  // a person moving through between two ticks (no snapshot overlap) is caught by the sweep: robot from x 3.0 to 3.4 in one tick, person at 3.65 only then
  const jump = [snap(serve, 0, { 'amr-1': [3, 6, 0] }), snap(serve, 1, { 'amr-1': [3.4, 6, 0] })], front = Math.max(...hullOf(serve).map((v) => v[0]));
  expect(pairs(assessTrajectory(serve, jump, (t) => t === 1 ? [{ id: 'p', x: 3.0 + front + 0.2, y: 6, radiusM: 0.1 }] : []))).toContain('amr-1|p/swept_oracle');
});
