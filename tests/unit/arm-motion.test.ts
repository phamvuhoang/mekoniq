// M05: quintic-sync-v1, a rest-to-rest quintic per segment where every joint shares one duration, rounded up to whole 20 ms ticks.
import { expect, test } from 'vitest';
import { quinticSegment, type MotionLimits } from '../../packages/cell-adapters/src/arm-motion';

const LIM: MotionLimits = { maxVelocity: [1, 1], maxAcceleration: [2, 2], speedFraction: 0.5, dtS: 0.02 };

test('the segment starts at from, ends at to exactly, and every joint arrives on the last tick together', () => {
  const from = [0, 0], to = [1, 0.2], seg = quinticSegment(from, to, LIM);
  expect(seg.ticks).toBe(188); // T = max(1.875*1/(1*0.5), sqrt(5.7735*1/(2*0.5))) = 3.75 s -> 187.5 ticks, rounded up
  expect(seg.at(0)).toEqual(from); expect(seg.at(seg.ticks)).toEqual(to);
  const before = seg.at(seg.ticks - 1);
  to.forEach((v, i) => expect(before[i], `joint ${i}`).not.toBe(v));
});

test('first and second differences stay inside the scaled velocity and acceleration limits at every tick', () => {
  const seg = quinticSegment([0, 0], [1, 0.2], LIM), f = LIM.speedFraction, dt = LIM.dtS;
  const q = Array.from({ length: seg.ticks + 3 }, (_, k) => seg.at(Math.min(k, seg.ticks))); // two ticks resting after the end
  const pre = [seg.at(0), ...q]; // and one resting before the start
  for (let k = 1; k < pre.length; k++) for (let i = 0; i < 2; i++) expect(Math.abs(pre[k]![i]! - pre[k - 1]![i]!)).toBeLessThanOrEqual(LIM.maxVelocity[i]! * f * dt * (1 + 1e-9));
  for (let k = 1; k < pre.length - 1; k++) for (let i = 0; i < 2; i++) expect(Math.abs(pre[k + 1]![i]! - 2 * pre[k]![i]! + pre[k - 1]![i]!)).toBeLessThanOrEqual(LIM.maxAcceleration[i]! * f * dt * dt * (1 + 1e-6));
});

test('a zero-length segment is one tick, and the result is deterministic', () => {
  const still = quinticSegment([0.3, -0.1], [0.3, -0.1], LIM);
  expect(still.ticks).toBe(1); expect(still.at(1)).toEqual([0.3, -0.1]);
  const a = quinticSegment([0, 0], [1, 0.2], LIM), b = quinticSegment([0, 0], [1, 0.2], LIM);
  expect(b.ticks).toBe(a.ticks);
  for (let k = 0; k <= a.ticks; k++) expect(b.at(k)).toEqual(a.at(k));
  expect(a.at(37)).toEqual(a.at(37));
});
