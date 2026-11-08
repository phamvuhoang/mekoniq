import { expect, test } from 'vitest';
import { place, polygonsOverlap, sweptHulls, type P } from '../../packages/lab-runtime/src/v2/navigation2d/geometry';

const square: P[] = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
const dot = (x: number, y: number): P[] => [[x - 1e-4, y - 1e-4], [x + 1e-4, y - 1e-4], [x + 1e-4, y + 1e-4], [x - 1e-4, y + 1e-4]];

test('review2 #8: the swept area of a turn covers the arc of every corner, not just the chord between sampled poses', () => {
  for (const [dyaw, steps] of [[0.4, 2], [0.02, 1], [-0.19, 1], [0.8, 4]] as const) {
    const hulls = sweptHulls(square, [1, 2, 0], [1, 2, dyaw]);
    expect(hulls).toHaveLength(steps);
    // a corner passes through every intermediate yaw: a pin placed exactly on its path (0.3 mm inside the arc) must be inside some hull
    for (let k = 0; k <= 200; k++) {
      const [x, y] = place([[0.5 * 0.9995, 0.5 * 0.9995]], 1, 2, (dyaw * k) / 200)[0]!;
      expect(hulls.some((h) => polygonsOverlap(h, dot(x, y))), `dyaw ${dyaw} at ${k}/200`).toBe(true);
    }
  }
});

test('a pure translation is still the plain hull of the two poses, and a turn adds nothing at zero rotation', () => {
  const [h] = sweptHulls(square, [0, 0, 0], [1, 0, 0]);
  expect(h!.length).toBeLessThanOrEqual(6);
  expect(polygonsOverlap(h!, dot(0.5, 0.45))).toBe(true);
  expect(polygonsOverlap(h!, dot(0.5, 0.6))).toBe(false);
});
