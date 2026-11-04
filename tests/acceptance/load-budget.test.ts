import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { readMeasuredLoadReport, reportPath } from '../support/load-report';
test('load gate uses measured local and kitchen latency', () => {
  const report = readMeasuredLoadReport();
  expect(report.localAckP95Ms).toBeLessThanOrEqual(500);
  expect(report.kitchenDeliveryP95Ms).toBeLessThanOrEqual(1000);
  expect(report.duplicateFinancialEffects).toBe(0);
});
test('the run really offered the target load and says what it did not measure', () => {
  const report = readMeasuredLoadReport();
  expect(report.durationSeconds).toBeGreaterThanOrEqual(Number(process.env.LOAD_SECONDS ?? 30) * 0.9);
  expect(report.achievedRatePerSecond as number).toBeGreaterThanOrEqual((report.targetRatePerSecond as number) * 0.9); // a slow system must not pass by receiving less load
  expect(report).toMatchObject({ logicalTablets: 20, tables: 100, seededRobots: 10, targetRatePerSecond: 10 });
  expect(Object.keys(report.rejected as object)).toEqual([]); // no unexpected refusals in the happy workload; a refused request never counts as latency
  expect(report.commandsAccepted).toBe(report.commandsSent);
  // no device or network claim without a device or network
  expect(String(report.tabletModel)).toMatch(/^none/); expect(String(report.networkProfile)).toMatch(/^none/);
  expect(String(report.claim)).toMatch(/not a tablet, radio or soak/); expect(report.robotMissionTraffic).toBe(false);
});
test('the reader refuses a missing, stale or foreign artifact (no default thresholds, no fixture PASS)', () => {
  expect(() => readMeasuredLoadReport('supabase-free-compatible', -1)).toThrow(/LOAD_REPORT_STALE|LOAD_REPORT_MISSING|LOAD_REPORT_WRONG_COMMIT/);
  expect(() => readMeasuredLoadReport('lan-scale', -1)).toThrow('LOAD_REPORT_STALE');
  expect(reportPath('lan-scale')).toBe('.lab/load/lan-scale.json');
  expect(readFileSync('docs/operations/service-levels.md', 'utf8')).toMatch(/Nothing here is promised until a measured artifact says so/);
});
