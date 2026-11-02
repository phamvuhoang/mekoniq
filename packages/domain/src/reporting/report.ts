import type { JsonObject, Snapshot } from '../../../contracts/src/index';
import { salesReport } from './sales';
import { shiftReport } from './shift';
import { robotKpiReport } from './robot-kpi';
/**
 * Where a report's facts come from and how far they reach. appliedAt: newest fact this projection has applied (null: it never received any);
 * pending: facts known to exist but not yet applied (cloud inbox backlog, a tablet's unacknowledged journal); mode 'isolated': the device lost its coordinator.
 */
export type Watermark = { source: 'coordinator' | 'tablet' | 'cloud-projection'; asOf: string; appliedAt: string | null; pending: number; mode?: string; maxAgeMs?: number };
/** The cloud projection is stale when no fact has arrived for this long (a coordinator silent for hours must not read as current). */
export const CLOUD_STALE_AFTER_MS = 15 * 60 * 1000;
export type ReportStatus = 'current' | 'stale' | 'offline' | 'unsynced';
export const REPORT_KINDS = ['sales', 'shifts', 'robot-kpi'] as const;
/** Snapshot kinds the reports read (the cloud route loads only these from its projection). */
export const REPORT_SOURCE_KINDS = ['bill', 'payment', 'refund', 'order', 'historical-receipt', 'historical-amendment', 'payment-observation', 'shift', 'cash-movement', 'mission', 'robot-command', 'robot', 'venue-layout'];
export function freshness(w: Watermark): ReportStatus {
  return staleness(w).status;
}
export function staleness(w: Watermark): { status: ReportStatus; reason: string | null } {
  if (!w.appliedAt) return { status: 'unsynced', reason: 'never-synced' };
  if (w.mode === 'isolated') return { status: 'offline', reason: 'coordinator-unreachable' };
  if (w.pending > 0) return { status: 'stale', reason: 'backlog' };
  const age = Date.parse(w.asOf) - Date.parse(w.appliedAt);
  if (w.maxAgeMs !== undefined && !(age <= w.maxAgeMs)) return { status: 'stale', reason: 'no-recent-sync' };
  return { status: 'current', reason: null };
}
/** The venue's configured zone; `assumed` when no venue layout says so (UTC is then a guess the report must disclose). */
export function venueZone(s: Snapshot[]): { timeZone: string; assumed: boolean } {
  const zone = s.find(x => x.ref.kind === 'venue-layout' && x.ref.id === 'current')?.state.timezone;
  return typeof zone === 'string' && zone ? { timeZone: zone, assumed: false } : { timeZone: 'UTC', assumed: true };
}
export const venueTimeZone = (s: Snapshot[]): string => venueZone(s).timeZone;
export function isBusinessDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().startsWith(v);
}
/**
 * A derived, rebuildable report: recomputed from the facts on every call, it never writes to or "corrects" the ledger. A projection that never synced
 * returns its header with every figure null, so no screen or export can show 0 in place of missing data.
 */
export function buildReport(kind: string, s: Snapshot[], o: { businessDate: string; timeZone?: string; watermark: Watermark }): JsonObject {
  if (!isBusinessDate(o.businessDate)) throw new Error('INVALID_BUSINESS_DATE');
  // without an explicit zone the venue layout decides; a missing layout is reported as an assumed zone, never silently
  const zone = o.timeZone ? { timeZone: o.timeZone, assumed: false } : venueZone(s), timeZone = zone.timeZone;
  try { new Intl.DateTimeFormat('en', { timeZone }).format(0); } catch { throw new Error('INVALID_TIMEZONE'); }
  const make = kind === 'sales' ? salesReport : kind === 'shifts' ? shiftReport : kind === 'robot-kpi' ? robotKpiReport : undefined;
  if (!make) throw new Error('UNKNOWN_REPORT');
  const { status, reason } = staleness(o.watermark), body = make(s, o.businessDate, timeZone);
  const head = { kind, businessDate: o.businessDate, timeZone, timeZoneAssumed: zone.assumed, status, statusReason: reason, watermark: o.watermark as unknown as JsonObject, columns: body.columns! };
  return status === 'unsynced' ? { ...Object.fromEntries(Object.keys(body).map(k => [k, null])), ...head, rows: [] } : { ...body, ...head };
}
/** One CSV cell: formula-looking text (= + - @ tab CR first) gets a leading apostrophe; quotes doubled; quoted when needed. Plain integers stay numbers. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const raw = String(v);
  if (/^-?\d+$/.test(raw)) return raw;
  const risky = /^[=+\-@\t\r]/.test(raw), text = risky ? "'" + raw : raw;
  return risky || /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
export function reportCsv(r: JsonObject): string {
  const columns = (r.columns ?? []) as string[], rows = (r.rows ?? []) as JsonObject[];
  return [columns.join(','), ...rows.map(row => columns.map(c => csvCell(row[c])).join(','))].join('\r\n') + '\r\n';
}
