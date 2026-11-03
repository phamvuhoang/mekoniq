import type { ModuleRegistry } from '../modules';
import type { JsonValue } from '../../../contracts/src/index';
import { hashPayload } from '../../../contracts/src/canonical';
import type { Snapshot } from '../../../contracts/src/index';
import { changed, created, done, fail, find, handle, note, text, all } from '../restaurant-context';
export function attendanceDuration(startMs: number, endMs: number) {
  if (endMs < startMs) throw new Error('NEGATIVE_DURATION');
  return endMs - startMs;
}
/** The times that count for a punch: the source times with every approved amendment applied in approval order (the latest amendment of a time wins; the source is never edited). */
export function effectiveTimes(s: Snapshot[], a: Snapshot): { inAt: string; out: string | null; corrected: boolean } {
  let inAt = String(a.state.clockInAt), out = (a.state.clockOutAt ?? null) as string | null, corrected = false;
  const fixes = all(s, 'attendance-correction').filter(x => x.state.attendanceId === a.ref.id).sort((x, y) => String(x.state.approvedAt).localeCompare(String(y.state.approvedAt)) || x.ref.id.localeCompare(y.ref.id));
  for (const f of fixes) { corrected = true; if (f.state.clockInAt) inAt = String(f.state.clockInAt); if (f.state.clockOutAt) out = String(f.state.clockOutAt); }
  return { inAt, out, corrected };
}
/** The user a punch is for: oneself, or — with the extra permission requiredPermissions adds for any explicit userId — someone else, on the record with a reason. */
export function punchUser(c: { actorRef: string; payload: { userId?: JsonValue; reason?: JsonValue } }): { userId: string; reason?: string } {
  if (c.payload.userId === undefined || c.payload.userId === c.actorRef) return { userId: c.actorRef };
  return { userId: text(c.payload.userId), reason: note(c.payload.reason, 'REASON_REQUIRED') };
}
export function registerAttendance(registry: ModuleRegistry): void {
  // Staff.ClockIn {punchId,userId?,reason?}: the punch is an immutable source fact keyed by (user, punchId) — the same punch replayed from the queue, a second device or a retry is
  // a no-op, a different punch while one is open is ALREADY_CLOCKED_IN. `staff-clock/<user>` is the one-open-punch gate (two racing punches: the store CAS lets one win).
  handle(registry, 'Staff.ClockIn', (c, s) => {
    const who = punchUser(c), punch = text(c.payload.punchId, 'PUNCH_REQUIRED'), id = `att-${hashPayload({ userId: who.userId, punchId: punch }).slice(0, 32)}`;
    if (find(s, 'attendance', id)) return done([], { attendanceId: id, duplicate: true });
    const clock = find(s, 'staff-clock', who.userId);
    if (clock?.state.openAttendanceId) return fail('ALREADY_CLOCKED_IN');
    const state = { userId: who.userId, status: 'open', clockInAt: c.occurredAt, clockInRecordedAt: c.recordedAt, clockInDevice: c.deviceId, clockInBy: c.actorRef, clockInPunch: punch, ...(who.reason ? { clockInReason: who.reason } : {}) };
    return done([created('StaffClockedIn', 'attendance', id, state), clock ? changed('StaffClockChanged', clock, { openAttendanceId: id }) : created('StaffClockChanged', 'staff-clock', who.userId, { openAttendanceId: id })], { attendanceId: id });
  });
  handle(registry, 'Staff.ClockOut', (c, s) => {
    const who = punchUser(c), punch = text(c.payload.punchId, 'PUNCH_REQUIRED');
    if (all(s, 'attendance').some(a => a.state.userId === who.userId && a.state.clockOutPunch === punch)) return done([], { duplicate: true });
    const clock = find(s, 'staff-clock', who.userId), open = clock?.state.openAttendanceId ? find(s, 'attendance', String(clock.state.openAttendanceId)) : undefined;
    if (!clock || !open) return fail('NOT_CLOCKED_IN');
    try { attendanceDuration(Date.parse(String(open.state.clockInAt)), Date.parse(c.occurredAt)); } catch { return fail('NEGATIVE_DURATION'); }
    return done([changed('StaffClockedOut', open, { status: 'closed', clockOutAt: c.occurredAt, clockOutRecordedAt: c.recordedAt, clockOutDevice: c.deviceId, clockOutBy: c.actorRef, clockOutPunch: punch, deviceMismatch: open.state.clockInDevice !== c.deviceId, ...(who.reason ? { clockOutReason: who.reason } : {}) }),
      changed('StaffClockChanged', clock, { openAttendanceId: null })], { attendanceId: open.ref.id });
  });
}
