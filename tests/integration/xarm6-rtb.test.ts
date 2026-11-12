// M02: Robotics Toolbox 1.5.0 (pinned .venv-algorithm) recomputes the flange of the UFACTORY xArm 6 modified D-H table at every fk-golden.json pose.
// Skipped (not_run, never a pass) where the venv is not provisioned (node scripts/bootstrap-portable-simulation.mjs algorithm).
import { describe, expect, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createAlgorithmChecker } from '../../packages/lab-runtime/src/v2/algorithm/checker';
import { forwardKinematics, XARM6_SI } from '../../packages/lab-runtime/src/v2/models/arm-kinematics';

const python = resolve('.venv-algorithm/bin/python');
const golden = JSON.parse(readFileSync('robotics/simulation-mujoco/fixtures/xarm6-g2-v1/fk-golden.json', 'utf8')) as { poses: { q: number[] }[] };

describe.skipIf(!existsSync(python))('xArm 6 D-H table against RTB', () => {
  test('rtb_fk equals forwardKinematics(XARM6_SI).flange within 1e-6 m and 1e-6 rad at the 20 golden poses', async () => {
    const checker = createAlgorithmChecker({ python, root: resolve('robotics/algorithm') });
    const qs = golden.poses.map((p) => p.q);
    const { result: { T } } = await checker.call<{ T: number[][][] }>('rtb_fk', { dh: XARM6_SI.links.map((l) => ({ a: l.a, alpha: l.alpha, d: l.d, offset: l.thetaOffset })), q: qs });
    expect(T).toHaveLength(20);
    qs.forEach((q, i) => {
      const f = forwardKinematics(XARM6_SI, q).flange, [x, y, z, w] = f.quaternionXyzw, M = T[i]!;
      const R = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]];
      expect(Math.hypot(M[0]![3]! - f.position[0], M[1]![3]! - f.position[1], M[2]![3]! - f.position[2]), `pose ${i}`).toBeLessThanOrEqual(1e-6);
      expect(Math.max(...R.flatMap((row, r) => row.map((v, c) => Math.abs(v - M[r]![c]!)))), `pose ${i} rotation`).toBeLessThanOrEqual(1e-6);
    });
  }, 120_000);
});
