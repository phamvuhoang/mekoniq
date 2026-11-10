import { expect, test } from 'vitest';
import { castScan, lidarAgrees } from '../../packages/lab-runtime/src/v2/simulation3d/lidar-oracle';

const scene = (obstacles: [number, number][][], boundaries: [number, number][][] = []) => ({ world: { obstacles: obstacles.map((verticesM, i) => ({ id: `o${i}`, verticesM })), boundaries: boundaries.map((verticesM, i) => ({ id: `b${i}`, verticesM })) } }) as never;
const sensor = { beams: 360, minM: 0.05, maxM: 10 };
const angle = (k: number) => -Math.PI + (k + 0.5) * (2 * Math.PI / 360);

test('a wall straight ahead is hit at its distance by the two beams either side of the heading', () => {
  const wall: [number, number][] = [[3, -5], [3.1, -5], [3.1, 5], [3, 5]];
  const r = castScan(scene([wall]), { x: 1, y: 0, yaw: 0 }, sensor);
  expect(r).toHaveLength(360);
  // beams 179 and 180 straddle angle 0; cos(0.5 deg) is the only difference from the perpendicular distance 2
  for (const k of [179, 180]) expect(r[k]).toBeCloseTo(2 / Math.cos(angle(k)), 9);
  expect(r[0]).toBe(Infinity); // behind the sensor nothing is within 10 m
});

test('beam angles are counter-clockwise from -pi + delta/2 in the sensor frame, rotated by the sensor yaw', () => {
  const wall: [number, number][] = [[-0.1, 2], [0.1, 2], [0.1, 2.1], [-0.1, 2.1]]; // 2 m north of the origin
  const north = castScan(scene([wall]), { x: 0, y: 0, yaw: 0 }, sensor).map((v, k) => [v, k] as const).filter(([v]) => Number.isFinite(v)).map(([, k]) => k);
  expect(north.every((k) => Math.abs(angle(k) - Math.PI / 2) < 0.06)).toBe(true);
  const turned = castScan(scene([wall]), { x: 0, y: 0, yaw: Math.PI / 2 }, sensor).map((v, k) => [v, k] as const).filter(([v]) => Number.isFinite(v)).map(([, k]) => k);
  expect(turned.every((k) => Math.abs(angle(k) - 0) < 0.06)).toBe(true); // the wall is now straight ahead of a sensor facing north
});

test('hits outside [minM, maxM] and an empty world are no return', () => {
  const near: [number, number][] = [[0.01, -1], [0.02, -1], [0.02, 1], [0.01, 1]];
  expect(castScan(scene([near]), { x: 0, y: 0, yaw: 0 }, sensor)[180]).toBe(Infinity);
  expect(castScan(scene([]), { x: 0, y: 0, yaw: 0 }, sensor).every((v) => v === Infinity)).toBe(true);
  const far: [number, number][] = [[20, -1], [21, -1], [21, 1], [20, 1]];
  expect(castScan(scene([], [far]), { x: 0, y: 0, yaw: 0 }, sensor)[180]).toBe(Infinity);
});

// A rendered depth sensor gives each beam the depth of a pixel, so on a slanted surface a beam may report what its neighbour should see: agreement is within the true
// range over the beam and its neighbours, plus a small tolerance, and the median error stays small.
const flat = (n: number, v: number) => Array<number>(n).fill(v);
const rule = { toleranceM: 0.02, windowBeams: 1, medianM: 0.01, maxM: 10 };
test('lidarAgrees: an exact copy, and a copy shifted by one beam on a slanted surface, agree', () => {
  const ramp = Array.from({ length: 360 }, (_, k) => 2 + k * 0.01);
  expect(lidarAgrees(ramp, ramp, rule)).toMatchObject({ violations: [] });
  const shifted = ramp.map((_, k) => ramp[Math.min(359, k + 1)]!);
  expect(lidarAgrees(shifted, ramp, rule).violations).toEqual([]);
});
test('lidarAgrees: a flat wall reported 0.3 m off, or a hit reported as no return, is a violation', () => {
  const wall = flat(360, 3);
  const off = wall.map((v, k) => (k === 100 ? v + 0.3 : v));
  expect(lidarAgrees(off, wall, rule).violations.map((x) => x.k)).toEqual([100]);
  const missing = wall.map((v, k) => (k === 50 ? null : v));
  expect(lidarAgrees(missing, wall, rule).violations.map((x) => x.k)).toEqual([50]);
});
test('lidarAgrees: no return where the ray-cast sees nothing within range is agreement; a systematic offset fails the median', () => {
  expect(lidarAgrees(flat(360, null as never), flat(360, Infinity), rule).violations).toEqual([]);
  const wall = flat(360, 3);
  const r = lidarAgrees(wall.map((v) => v + 0.015), wall, rule);
  expect(r.violations).toEqual([]); expect(r.medianAbsM).toBeCloseTo(0.015, 9); expect(r.medianOk).toBe(false);
});
