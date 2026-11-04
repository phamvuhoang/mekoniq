import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { readMeasuredLoadReport } from '../support/load-report';
const profile = JSON.parse(readFileSync('deploy/profiles/supabase-free.json', 'utf8')) as { warningRatio: number; criticalRatio: number; quotas: { metric: string; limit: number }[] };
type Projection = Record<string, { used: number; limit: number; state: string }>;
test('Free-compatible fixture: 7 simulated days of the agreed workload fit the Free quotas with room to spare (projected 30 days, local numbers)', () => {
  const report = readMeasuredLoadReport('supabase-free-compatible', 12 * 3600_000);
  expect(report).toMatchObject({ profile: 'supabase-free-compatible', ordersPerDay: 100, hostedStatus: 'not_verified' });
  expect(report.simulatedDays as number).toBeGreaterThanOrEqual(7);
  expect(report.rejected).toBe(0); expect(report.commands as number).toBeGreaterThanOrEqual(7 * 100 * 6);
  const states = report.projection30Days as Projection;
  for (const [metric, s] of Object.entries(states)) {
    expect(s.limit, metric).toBe(profile.quotas.find(q => q.metric === metric)!.limit); // limits come from the profile, not from the run
    expect(s.state, `${metric} projected ${s.used}/${s.limit}`).not.toBe('critical'); // above 85 % of a Free quota is a failed gate
  }
  expect(Object.keys(states)).toEqual(expect.arrayContaining(['databaseBytes', 'egressBytes', 'realtimeMessagesMonth', 'realtimeConnections']));
});
test('what was not measured stays unknown: no invented provider usage, no hosted claim, an honest overhead factor', () => {
  const report = readMeasuredLoadReport('supabase-free-compatible', 12 * 3600_000);
  expect(report.providerUsage).toMatchObject({ storageBytes: null, egressBytes: null, realtimeMessages: null });
  expect(String(report.providerUsage!.source)).toMatch(/local Supabase PostgreSQL[\s\S]*NOT a hosted project/);
  expect(report.providerUsage!.dbBytes).toBeGreaterThan(0);
  expect(report.measuredOverheadFactor as number).toBeGreaterThan(1); expect(report.measuredOverheadFactor as number).toBeLessThan(10); // heap + indexes over the useful bytes, measured
  expect((report.unmeasured as string[]).join()).toMatch(/hosted database baseline/); expect((report.unmeasured as string[]).join()).toMatch(/Storage objects/);
  expect(String(report.claim)).toMatch(/hosted Free project must be measured separately/);
  expect(String(report.tabletModel)).toMatch(/^none/);
});
test('quota thresholds in the report are the profile\'s 70 % / 85 %', () => {
  expect(profile.warningRatio).toBe(0.7); expect(profile.criticalRatio).toBe(0.85);
});
