import { expect, test } from 'vitest';
import { combineInertia, inertiaProblems } from '../../packages/lab-runtime/src/engineering/inertia';
import { boxInertia, boxLink, pose } from '../support/engineering';

const close = (a: number[], b: number[], tol = 1e-9) => a.forEach((v, i) => expect(Math.abs(v - b[i]!), `index ${i}: ${v} vs ${b[i]}`).toBeLessThan(tol));

test('battery offset: COM shift and tensor match the independent parallel-axis reference', () => {
  // chassis 20 kg box 0.5x0.4x0.15 at the origin; battery 6 kg box 0.2x0.15x0.1 at (-0.3, 0, 0.125). Reference computed separately in plain python.
  const chassis = boxLink('c', [0.5, 0.4, 0.15], 20), battery = boxLink('b', [0.2, 0.15, 0.1], 6);
  const r = combineInertia([chassis, battery], [pose(0, 0, 0), pose(-0.3, 0, 0.125)]);
  expect(r.massKg).toBe(26);
  close(r.comM, [-0.06923076923076922, 0, 0.028846153846153848]);
  close(r.inertiaKgM2!, [0.39253205128205126, 0, 0.17307692307692307, 0.9666666666666667, 0, 1.1299679487179488]);
});

test('rotating a link rotates its tensor (90 degrees about Z swaps Ixx and Iyy)', () => {
  const link = boxLink('x', [0.4, 0.2, 0.1], 3);
  const [ixx, , , iyy] = boxInertia(3, [0.4, 0.2, 0.1])!;
  const q: [number, number, number, number] = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
  const r = combineInertia([link], [pose(0, 0, 0, q)]);
  close(r.inertiaKgM2!, [iyy!, 0, 0, ixx!, 0, boxInertia(3, [0.4, 0.2, 0.1])![5]!], 1e-12);
});

test('combining refuses a link with unknown inertia instead of treating it as zero', () => {
  const unknown = boxLink('u', [0.1, 0.1, 0.1], 1, { inertiaKgM2: null });
  expect(() => combineInertia([unknown], [pose()])).toThrow(/INERTIA_UNKNOWN/);
});

test('inertia validity: positive definite and triangle inequalities, strictly', () => {
  expect(inertiaProblems([1, 0, 0, 1, 0, 1])).toEqual([]);
  expect(inertiaProblems([1, 0, 0, 1, 0, 3])).toContain('TRIANGLE_INEQUALITY'); // 1 + 1 < 3
  expect(inertiaProblems([0, 0, 0, 1, 0, 1])).toContain('NOT_POSITIVE_DEFINITE');
  expect(inertiaProblems([1, 2, 0, 1, 0, 1])).toContain('NOT_POSITIVE_DEFINITE'); // |Ixy| > Ixx*Iyy bound
  expect(inertiaProblems([1, 0, 0, 1, 0, Number.NaN])).toContain('NOT_FINITE');
  // a flat plate is the legal limit case: Ixx + Iyy = Izz exactly
  expect(inertiaProblems(boxInertia(2, [0.4, 0.3, 1e-3])!)).toEqual([]);
});
