// W03 / G-ALG2: pid-v1 (TypeScript) against the independent Python reference and, where the loop is linear, against scipy's dlsim.
import { beforeAll, describe, expect, test } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createAlgorithmChecker, loadOracleProfile } from '../../packages/lab-runtime/src/v2/algorithm/checker';
import { runPidCases, servePlant } from '../../packages/lab-runtime/src/v2/algorithm/pid-cases';
import { validateAlgorithmResult } from '../../packages/lab-runtime/src/v2/navigation2d/contracts';

const python = resolve('.venv-algorithm/bin/python'), root = resolve('robotics/algorithm');
const real = createAlgorithmChecker({ python, root });
const { profile } = loadOracleProfile();
type Checker = ReturnType<typeof createAlgorithmChecker>;
const get = (rs: Awaited<ReturnType<typeof runPidCases>>, id: string) => rs.find((r) => r.caseId === id)!;

describe('the plant is derived from the Serve fixture, not typed in', () => {
  test('gain, time constant and torque limit follow from mass, wheel radius and the torque-speed table', () => {
    const p = servePlant();
    expect(p.gain).toBeCloseTo(20 / 2.5, 12); // omega_max / tau_max
    expect(p.outLimit).toBe(2.5);
    expect(p.tauS).toBeGreaterThan(0.05); expect(p.tauS).toBeLessThan(5);
  });
});

describe.skipIf(!existsSync(python))('PID reference oracle', () => {
  let base: Awaited<ReturnType<typeof runPidCases>>;
  beforeAll(async () => { base = await runPidCases(real, profile, 11); }, 120_000);

  test('every result is a valid AlgorithmResultV1', () => {
    expect(base.map((r) => r.caseId)).toEqual(['PID01', 'PID02', 'PID03']);
    for (const r of base) { expect(validateAlgorithmResult(r).ok, r.caseId).toBe(true); expect(r.checkerId).toBe('pid_reference'); }
  });

  test('PID01 step response P, PI, PID unsaturated', () => {
    const r = get(base, 'PID01');
    expect(r.reasons).toEqual([]);
    expect(r.verdict).toBe('pass');
    expect(r.metrics.maxSampleError!).toBeLessThanOrEqual(1e-9);
    expect(r.metrics.maxLinearError!).toBeLessThanOrEqual(1e-9); // P and PI have a closed-form linear solution
    expect(r.metrics.overshootDelta!).toBeLessThanOrEqual(1e-9);
    expect(r.metrics.settlingTimeDeltaS!).toBeLessThanOrEqual(1e-9);
    expect(r.metrics.overshootPi!).toBeGreaterThan(0); // the comparison is not vacuous: the PI loop really overshoots
  });

  test('PID02 saturation and recovery', () => {
    const r = get(base, 'PID02');
    expect(r.reasons).toEqual([]);
    expect(r.verdict).toBe('pass');
    expect(r.metrics.maxAbsU!).toBeLessThanOrEqual(2.5);
    expect(r.metrics.maxSampleError!).toBeLessThanOrEqual(1e-9);
    expect(r.metrics.integralClampedSteps!).toBeGreaterThan(0);
    expect(r.metrics.recoveryTimeDeltaS!).toBeLessThanOrEqual(1e-9);
  });

  test('PID03 delay 3 steps + seeded noise + load step, repeatable by seed', async () => {
    const r = get(base, 'PID03');
    expect(r.reasons).toEqual([]);
    expect(r.verdict).toBe('pass');
    expect(r.metrics.maxSampleError!).toBeLessThanOrEqual(1e-9);
    const again = await runPidCases(real, profile, 11), other = await runPidCases(real, profile, 12);
    expect(get(again, 'PID03').inputDigest).toBe(r.inputDigest);
    expect(get(other, 'PID03').inputDigest).not.toBe(r.inputDigest);
  }, 120_000);

  test('anti-windup removed on the Python side only makes PID02 fail', async () => {
    const off: Checker = { call: (op, payload) => real.call(op, op === 'pid_response' ? { ...(payload as object), antiWindup: false } : payload) };
    const rs = await runPidCases(off, profile, 11);
    expect(get(rs, 'PID02').verdict).toBe('fail');
    expect(get(rs, 'PID02').reasons.length).toBeGreaterThan(0);
  }, 120_000);
});
