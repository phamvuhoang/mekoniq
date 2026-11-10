// W02 / G-ALG1: Robotics Toolbox 1.5.0 (independent, in the pinned .venv-algorithm) cross-checks arm-kinematics.ts on both PUMA560 tables.
// Skipped, with the reason, where the pinned venv is not provisioned (node scripts/bootstrap-portable-simulation.mjs algorithm).
import { beforeAll, describe, expect, test } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createAlgorithmChecker, loadOracleProfile } from '../../packages/lab-runtime/src/v2/algorithm/checker';
import { runKinematicsCases } from '../../packages/lab-runtime/src/v2/algorithm/kinematics-cases';
import { validateAlgorithmResult } from '../../packages/lab-runtime/src/v2/navigation2d/contracts';

const python = resolve('.venv-algorithm/bin/python'), root = resolve('robotics/algorithm');
const real = createAlgorithmChecker({ python, root });
const { profile } = loadOracleProfile();
type Checker = ReturnType<typeof createAlgorithmChecker>;

describe.skipIf(!existsSync(python))('RTB kinematics oracle', () => {
  const run = (checker: Checker = real) => runKinematicsCases(checker, profile, 7);
  let base: Awaited<ReturnType<typeof run>>;
  beforeAll(async () => { base = await run(); }, 300_000);
  const only = (rs: Awaited<ReturnType<typeof run>>, id: string) => { const r = rs.filter((x) => x.caseId === id); expect(r.length, id).toBeGreaterThan(0); return r; };

  test('every result is a valid AlgorithmResultV1 with the pinned tool versions', async () => {
    const rs = base;
    expect(rs.map((r) => r.caseId)).toEqual(['ALG01', 'ALG02', 'ALG03', 'ALG05']);
    for (const r of rs) { expect(validateAlgorithmResult(r).ok, r.caseId).toBe(true); expect(r.toolVersions['roboticstoolbox-python']).toBe('1.5.0'); }
  }, 300_000);

  test('ALG01 both tables agree with RTB and their own golden', async () => {
    for (const r of only(base, 'ALG01')) {
      expect(r.reasons, 'ALG01').toEqual([]);
      expect(r.verdict).toBe('pass');
      expect(r.metrics.maxTranslationErrorM!).toBeLessThanOrEqual(1e-6);
      expect(r.metrics.maxRotationErrorRad!).toBeLessThanOrEqual(1e-6);
      expect(r.metrics.goldenPoses!).toBeGreaterThanOrEqual(10);
      expect(r.metrics.seededPoses!).toBe(profile.seededPoses * 2);
    }
  }, 300_000);

  test('ALG02 round trip both directions', async () => {
    for (const r of only(base, 'ALG02')) {
      expect(r.reasons).toEqual([]);
      expect(r.verdict).toBe('pass');
      expect(r.metrics.limitViolations).toBe(0);
      expect(r.metrics.tsSolved!).toBeGreaterThan(0); expect(r.metrics.rtbSolved!).toBeGreaterThan(0);
    }
  }, 300_000);

  test('ALG03 jacobian and condition number', async () => {
    for (const r of only(base, 'ALG03')) {
      expect(r.reasons).toEqual([]);
      expect(r.verdict).toBe('pass');
      expect(r.metrics.singularFlaggedBoth).toBe(1);
      expect(r.metrics.singularFlagMismatch).toBe(0);
    }
  }, 300_000);

  test('ALG05 beyond-reach, over-limit, corrupt DH and near-singular cases are rejected by both sides', async () => {
    for (const r of only(base, 'ALG05')) {
      expect(r.verdict, r.reasons.join()).toBe('pass');
      for (const c of ['beyond-reach', 'over-limit', 'corrupt-dh', 'near-singular']) {
        expect(r.reasons.some((x) => x.startsWith(`${c}:TS:`)), `${c} TS`).toBe(true);
        expect(r.reasons.some((x) => x.startsWith(`${c}:RTB:`)), `${c} RTB`).toBe(true);
      }
    }
  }, 300_000);

  test('a perturbed DH row on the Python side only makes ALG01 fail', async () => {
    const skewed: Checker = { call: (op, payload) => {
      const p = JSON.parse(JSON.stringify(payload)) as { dh?: { a: number }[] };
      if (p.dh?.[2]) p.dh[2].a += 0.001;
      return real.call(op, p);
    } };
    const [alg01] = only(await run(skewed), 'ALG01');
    expect(alg01!.verdict).toBe('fail');
    expect(alg01!.reasons.length).toBeGreaterThan(0);
  }, 300_000);
});
