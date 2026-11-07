import { expect, test } from 'vitest';
import { assessCalibration, type CalibrationDataset, type PredictionSeries } from '../../packages/lab-runtime/src/engineering/calibration';

// Synthetic arrays exercise the validator only; they are never promoted to measured evidence (sourceKind says so).
const D = 'a'.repeat(64);
const times = Array.from({ length: 11 }, (_, i) => i * 100_000_000);
const line = (k: number) => times.map((t) => (t / 1e9) * k);
const trial = (trialId: string, split: 'tune' | 'validation', condition: string, k = 2) => ({ trialId, split, condition, timesNs: times, channels: { speed: line(k) } });
const dataset = (over: Partial<CalibrationDataset> = {}): CalibrationDataset => ({
  schemaVersion: 1, configDigest: D, instrument: { id: 'encoder', revision: 'A' }, units: { speed: 'm/s' }, clockMapping: { domain: 'sim', offsetNs: 0 }, uncertainty: { speed: 0.01 }, rawDigest: 'b'.repeat(64), sourceKind: 'measured',
  policy: { channels: { speed: { absoluteTolerance: 0.05, relativeTolerance: 0.05 } }, minTrialsPerCondition: 3, maxClockGapNs: 250_000_000, capabilities: { speed: 'actuator' } },
  trials: [trial('t1', 'tune', 'empty'), trial('v1', 'validation', 'empty'), trial('v2', 'validation', 'empty'), trial('v3', 'validation', 'empty')], ...over });
const prediction = (k = 2): PredictionSeries => ({ configDigest: D, clockDomain: 'sim', units: { speed: 'm/s' }, trials: ['t1', 'v1', 'v2', 'v3'].map((trialId) => ({ trialId, timesNs: times, channels: { speed: line(k) } })) });

test('a clean measured dataset with a matching prediction passes and names what it calibrated', () => {
  const r = assessCalibration(dataset(), prediction());
  expect(r).toMatchObject({ status: 'pass', reasons: [], calibratedCapabilities: ['actuator'], invalidatedBy: null });
  expect(r.residuals.speed).toMatchObject({ withinTolerance: true, maxAbs: 0 });
  expect(r.domain.speed).toEqual({ min: 0, max: 2 });
});
test('synthetic or simulated data is never measured evidence', () => {
  const simulatedDataset = dataset({ sourceKind: 'simulated' });
  expect(assessCalibration(simulatedDataset, prediction()).reasons).toContain('MEASURED_DATA_REQUIRED');
  expect(assessCalibration(dataset({ sourceKind: 'synthetic' }), prediction())).toMatchObject({ status: 'fail', calibratedCapabilities: [] });
});
test('no dataset is not_run with CALIBRATION_DATA_REQUIRED, never a pass', () => {
  expect(assessCalibration(null, prediction())).toMatchObject({ status: 'not_run', reasons: ['CALIBRATION_DATA_REQUIRED'], calibratedCapabilities: [] });
});
test('the same trial in tune and validation, or too few validation trials, is rejected', () => {
  const overlappingTrials = dataset({ trials: [trial('t1', 'tune', 'empty'), trial('t1', 'validation', 'empty'), trial('v2', 'validation', 'empty'), trial('v3', 'validation', 'empty')] });
  expect(assessCalibration(overlappingTrials, prediction()).reasons).toContain('CALIBRATION_SPLIT_LEAKAGE');
  expect(assessCalibration(dataset({ trials: [trial('t1', 'tune', 'empty'), trial('v1', 'validation', 'empty')] }), prediction()).reasons).toContain('TRIALS_INSUFFICIENT');
  expect(assessCalibration(dataset({ trials: [trial('t1', 'tune', 'empty'), trial('t2', 'tune', 'empty')] }), prediction()).reasons).toContain('NO_VALIDATION_SPLIT');
});
test('clock, unit and model-hash differences are reported and never converted or ignored', () => {
  expect(assessCalibration(dataset(), { ...prediction(), clockDomain: 'wall' }).reasons).toContain('CLOCK_MISMATCH');
  expect(assessCalibration(dataset(), { ...prediction(), units: { speed: 'km/h' } }).reasons).toContain('UNIT_MISMATCH');
  const altered = assessCalibration(dataset(), { ...prediction(), configDigest: 'c'.repeat(64) });
  expect(altered.reasons).toContain('CONFIG_DIGEST_MISMATCH');
  expect(altered.invalidatedBy).toBe('c'.repeat(64));
  expect(altered.calibratedCapabilities).toEqual([]);
});
test('a validation value outside the tuned range is out of domain', () => {
  const wide = dataset({ trials: [trial('t1', 'tune', 'empty', 1), trial('v1', 'validation', 'empty', 2), trial('v2', 'validation', 'empty', 2), trial('v3', 'validation', 'empty', 2)] });
  expect(assessCalibration(wide, prediction()).reasons).toContain('OUT_OF_DOMAIN');
});
test('residuals use max(absolute, relative * |measured|) and a miss fails the channel', () => {
  const off = assessCalibration(dataset(), prediction(2.5));
  expect(off.status).toBe('fail');
  expect(off.reasons).toContain('RESIDUAL_EXCEEDS_TOLERANCE:speed');
  expect(off.residuals.speed!.withinTolerance).toBe(false);
  expect(assessCalibration(dataset(), prediction(2.09)).status).toBe('pass'); // 0.09 m/s at 1 s: relative 5 % of 2 = 0.1 allows it
});
test('no interpolation across a clock gap larger than the sample policy', () => {
  const sparse = prediction();
  sparse.trials[1]!.timesNs = [0, 1_000_000_000];
  sparse.trials[1]!.channels = { speed: [0, 2] };
  const r = assessCalibration(dataset(), sparse);
  expect(r.reasons).toContain('CLOCK_GAP_TOO_LARGE');
  expect(r.status).toBe('fail');
});
test('a channel or trial the model did not predict is missing, not zero', () => {
  const noChannel = prediction(); noChannel.trials[1]!.channels = {};
  expect(assessCalibration(dataset(), noChannel).reasons).toContain('CHANNEL_MISSING:speed');
  const noTrial = prediction(); noTrial.trials.pop();
  expect(assessCalibration(dataset(), noTrial).reasons).toContain('PREDICTION_TRIAL_MISSING:v3');
});

test('a validation trial without measured data is not a trial: it cannot satisfy the minimum or pass quietly', () => {
  const empty = (id: string) => ({ trialId: id, split: 'validation' as const, condition: 'empty', timesNs: times, channels: {} });
  const oneOfThree = dataset({ trials: [trial('t1', 'tune', 'empty'), trial('v1', 'validation', 'empty'), empty('v2'), empty('v3')] });
  const r = assessCalibration(oneOfThree, prediction());
  expect(r.status).toBe('fail');
  expect(r.reasons).toEqual(expect.arrayContaining(['TRIAL_WITHOUT_DATA:v2', 'TRIAL_WITHOUT_DATA:v3', 'TRIALS_INSUFFICIENT']));
  expect(r.calibratedCapabilities).toEqual([]);
  const none = dataset({ trials: [trial('t1', 'tune', 'empty'), empty('v1'), empty('v2'), empty('v3')] });
  expect(assessCalibration(none, prediction())).toMatchObject({ status: 'fail', calibratedCapabilities: [] });
  const misaligned = dataset({ trials: [trial('t1', 'tune', 'empty'), { ...trial('v1', 'validation', 'empty'), channels: { speed: [0, 1] } }, trial('v2', 'validation', 'empty'), trial('v3', 'validation', 'empty')] });
  expect(assessCalibration(misaligned, prediction()).reasons).toContain('TRIAL_WITHOUT_DATA:v1');
});
