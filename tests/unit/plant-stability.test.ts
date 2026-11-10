import { expect, test } from 'vitest';
import { poseUnstable } from '../../packages/lab-runtime/src/v2/navigation2d/runner';

const wheel = 0.1;
test('review R1 #2: the height window is relative to where the robot first stood, so a base frame on the floor (z = 0) or on the axle (z = wheel radius) is both stable', () => {
  for (const rest of [0, wheel, 0.35]) expect(poseUnstable({ z: rest, roll: 0, pitch: 0 }, wheel, rest)).toBe(false);
});
test('review R1 #2: sinking by more than 0.6 wheel radii, rising by more than 4, a tilt over 0.35 rad or a non-finite pose is unstable', () => {
  const rest = 0.5;
  expect(poseUnstable({ z: rest - 0.7 * wheel, roll: 0, pitch: 0 }, wheel, rest)).toBe(true);
  expect(poseUnstable({ z: rest + 4.1 * wheel, roll: 0, pitch: 0 }, wheel, rest)).toBe(true);
  expect(poseUnstable({ z: rest, roll: 0.36, pitch: 0 }, wheel, rest)).toBe(true);
  expect(poseUnstable({ z: rest, roll: 0, pitch: -0.36 }, wheel, rest)).toBe(true);
  expect(poseUnstable({ z: NaN, roll: 0, pitch: 0 }, wheel, rest)).toBe(true);
  expect(poseUnstable({ z: rest - 0.5 * wheel, roll: 0.3, pitch: 0 }, wheel, rest)).toBe(false);
});
