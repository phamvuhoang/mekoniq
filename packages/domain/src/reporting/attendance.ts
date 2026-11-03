import type { JsonObject, Snapshot } from '../../../contracts/src/index';
import { attendanceDuration, effectiveTimes } from '../workforce/attendance';
import { dayOf, ofKind, undatedFacts } from './sales';
const COLUMNS = ['kind', 'id', 'businessDate', 'userId', 'status', 'clockInAt', 'clockOutAt', 'durationMs', 'lateMs', 'corrected', 'sourceClockInAt', 'sourceClockOutAt', 'deviceMismatch'];
/**
 * Operational attendance of the business date (the day the punch STARTED in venue time, so a night shift is one row). The latest approved amendment overrides a time but
 * the source punch is shown beside it. Lateness is measured against the user's schedule starting that day; scheduled people with no punch are listed as no-shows.
 * Hours here are an operations figure — this is not payroll and carries no pay, tax or overtime rules.
 */
export function attendanceReport(s: Snapshot[], date: string, tz: string): JsonObject {
  const eff = (a: Snapshot) => effectiveTimes(s, a);
  const schedules = ofKind(s, 'shift-schedule').filter(x => dayOf(x.state.startsAt, tz) === date);
  const mine = ofKind(s, 'attendance').map(a => ({ a, ...eff(a) })).filter(x => dayOf(x.inAt, tz) === date).sort((x, y) => x.inAt.localeCompare(y.inAt) || x.a.ref.id.localeCompare(y.a.ref.id));
  const rows = mine.map(({ a, inAt, out, corrected }) => {
    const plan = schedules.find(x => x.state.userId === a.state.userId), late = plan ? Math.max(0, Date.parse(inAt) - Date.parse(String(plan.state.startsAt))) : null;
    return { kind: 'attendance', id: a.ref.id, businessDate: date, userId: String(a.state.userId), status: out ? 'closed' : 'open', clockInAt: inAt, clockOutAt: out, durationMs: out ? String(attendanceDuration(Date.parse(inAt), Date.parse(out))) : null, lateMs: late === null ? null : String(late),
      corrected, sourceClockInAt: String(a.state.clockInAt), sourceClockOutAt: (a.state.clockOutAt ?? null) as string | null, deviceMismatch: a.state.deviceMismatch === true };
  });
  const present = new Set(rows.map(r => r.userId));
  return { columns: COLUMNS, rows, totals: { staff: present.size, totalDurationMs: String(rows.reduce((a, r) => a + BigInt(r.durationMs ?? '0'), 0n)), open: rows.filter(r => r.status === 'open').length, corrected: rows.filter(r => r.corrected).length,
    deviceMismatch: rows.filter(r => r.deviceMismatch).length, noShows: [...new Set(schedules.map(x => String(x.state.userId)).filter(u => !present.has(u)))].sort() as unknown as JsonObject },
  basis: 'operational attendance hours from immutable punches and manager amendments — not payroll', undatedFacts: undatedFacts(ofKind(s, 'attendance'), a => a.state.clockInAt, tz) };
}
