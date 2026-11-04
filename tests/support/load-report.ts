import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
export type LoadReport = {
  localAckP95Ms: number; kitchenDeliveryP95Ms: number; duplicateFinancialEffects: number; durationSeconds: number;
  tabletModel: string; appCommit: string; networkProfile: string;
  profile: 'lan-scale' | 'supabase-free-compatible';
  providerUsage?: { measuredAt: string; source: string; dbBytes: number | null; storageBytes: number | null; egressBytes: number | null; realtimeMessages: number | null };
  [detail: string]: unknown;
};
export const reportPath = (profile: LoadReport['profile']) => `.lab/load/${profile}.json`;
export const currentCommit = () => execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
/**
 * Reads the artifact the load run JUST produced. It rejects a missing, stale (older than `maxAgeMs`) or wrong-commit artifact and any report that is not fully measured: there are no default
 * thresholds and no fixture that can stand in for a measurement.
 */
export function readMeasuredLoadReport(profile: LoadReport['profile'] = 'lan-scale', maxAgeMs = 6 * 3600_000): LoadReport {
  let report: LoadReport & { measuredAt?: string };
  try { report = JSON.parse(readFileSync(reportPath(profile), 'utf8')); } catch { throw new Error(`LOAD_REPORT_MISSING: run the load first (${reportPath(profile)})`); }
  if (report.appCommit !== currentCommit()) throw new Error(`LOAD_REPORT_WRONG_COMMIT: measured ${String(report.appCommit).slice(0, 8)}, HEAD is ${currentCommit().slice(0, 8)}`);
  if (!report.measuredAt || Date.now() - Date.parse(report.measuredAt) > maxAgeMs) throw new Error('LOAD_REPORT_STALE');
  for (const k of ['localAckP95Ms', 'kitchenDeliveryP95Ms', 'duplicateFinancialEffects', 'durationSeconds'] as const) if (typeof report[k] !== 'number' || !Number.isFinite(report[k])) throw new Error(`LOAD_REPORT_INCOMPLETE: ${k}`);
  if (report.profile !== profile) throw new Error('LOAD_REPORT_WRONG_PROFILE');
  return report;
}
