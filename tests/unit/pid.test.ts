import { expect, test } from 'vitest';
import { pidInit, pidStep, type PidConfig } from '../../packages/lab-runtime/src/v2/control/pid';

const cfg = (over: Partial<PidConfig> = {}): PidConfig => ({ kp: 2, ki: 0, kd: 0, dtS: 0.02, derivativeFilterHz: 10, outMin: -2.5, outMax: 2.5, ...over });

test('P only: u = kp*e', () => {
  const r = pidStep(cfg(), pidInit(), 1, 0.4);
  expect(r.u).toBeCloseTo(2 * 0.6, 15);
  expect(r.saturated).toBe(false);
});

test('output never leaves [outMin,outMax] while the setpoint is far away', () => {
  const c = cfg({ ki: 5, kd: 0.1 });
  let s = pidInit();
  for (let k = 0; k < 1000; k++) {
    const r = pidStep(c, s, 100, 0);
    expect(r.u).toBeLessThanOrEqual(2.5); expect(r.u).toBeGreaterThanOrEqual(-2.5);
    s = r.state;
  }
});

test('integral is frozen while saturated in the error direction and resumes when the error flips', () => {
  const c = cfg({ kp: 1, ki: 1, dtS: 0.1, outMin: -100, outMax: 1 });
  let s = pidInit();
  for (let k = 0; k < 20; k++) { const r = pidStep(c, s, 10, 0); expect(r.saturated).toBe(true); s = r.state; }
  expect(s.integral).toBe(0); // 20 saturated steps added nothing
  const flipped = pidStep(c, s, 10, 12); // e = -2: unsaturated again, so the integral moves
  expect(flipped.saturated).toBe(false);
  expect(flipped.state.integral).toBeCloseTo(-0.2, 15);
});

test('the first step has zero derivative; the derivative acts on the measurement, not the setpoint', () => {
  const c = cfg({ kp: 0, kd: 1 });
  const first = pidStep(c, pidInit(), 5, 1);
  expect(first.u).toBe(0);
  expect(first.state.prevMeasurement).toBe(1);
  const setpointJump = pidStep(c, first.state, 50, 1); // measurement unchanged: no derivative kick
  expect(setpointJump.u).toBe(0);
  const moving = pidStep(c, first.state, 5, 1.1); // measurement rises: negative derivative term
  expect(moving.u).toBeLessThan(0);
});

test('same inputs give identical outputs', () => {
  const run = () => { let s = pidInit(); const out: number[] = []; for (let k = 0; k < 200; k++) { const r = pidStep(cfg({ ki: 1, kd: 0.05 }), s, Math.sin(k / 10), Math.cos(k / 7)); s = r.state; out.push(r.u); } return out; };
  expect(run()).toEqual(run());
});

test('an unusable configuration is refused, not run', () => {
  for (const bad of [{ dtS: 0 }, { dtS: Number.NaN }, { derivativeFilterHz: 0 }, { outMin: 3 }, { kp: Number.POSITIVE_INFINITY }]) expect(() => pidStep(cfg(bad), pidInit(), 1, 0), JSON.stringify(bad)).toThrow('PID_CONFIG_INVALID');
  expect(() => pidStep(cfg(), pidInit(), Number.NaN, 0)).toThrow('PID_INPUT_INVALID');
});
