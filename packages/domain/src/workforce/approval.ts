import type { ModuleRegistry } from '../modules';
import type { JsonValue } from '../../../contracts/src/index';
import { hashPayload } from '../../../contracts/src/canonical';
import { created, done, fail, find, handle, note, text } from '../restaurant-context';
import { utcEpochMs } from '../shared/clock';
import { attendanceDuration } from './attendance';
const instant = (v: JsonValue | undefined): string => { try { const s = text(v, 'INVALID_TIME'); utcEpochMs(s); return new Date(s).toISOString(); } catch { return fail('INVALID_TIME'); } };
export function registerApproval(registry: ModuleRegistry): void {
  // Staff.ApproveCorrection {attendanceId,clockInAt?,clockOutAt?,reason}: a manager amends a late/forgotten punch. The source punch is never edited — the amendment is a separate
  // record and the report shows the amended time next to the original. A manager cannot amend their own attendance.
  handle(registry, 'Staff.ApproveCorrection', (c, s) => {
    const att = find(s, 'attendance', text(c.payload.attendanceId)) ?? fail('NOT_FOUND'), reason = note(c.payload.reason, 'REASON_REQUIRED');
    if (c.payload.clockInAt === undefined && c.payload.clockOutAt === undefined) return fail('NOTHING_TO_CORRECT');
    if (att.state.userId === c.actorRef) return fail('SELF_APPROVAL_FORBIDDEN');
    const clockInAt = c.payload.clockInAt === undefined ? undefined : instant(c.payload.clockInAt), clockOutAt = c.payload.clockOutAt === undefined ? undefined : instant(c.payload.clockOutAt);
    const start = clockInAt ?? String(att.state.clockInAt), end = clockOutAt ?? (att.state.clockOutAt as string | undefined);
    if (end) { try { attendanceDuration(Date.parse(start), Date.parse(end)); } catch { return fail('NEGATIVE_DURATION'); } }
    const id = `corr-${hashPayload({ attendanceId: att.ref.id, clockInAt: clockInAt ?? null, clockOutAt: clockOutAt ?? null }).slice(0, 32)}`;
    if (find(s, 'attendance-correction', id)) return done([], { correctionId: id, duplicate: true });
    return done([created('AttendanceCorrected', 'attendance-correction', id, { attendanceId: att.ref.id, userId: att.state.userId, ...(clockInAt ? { clockInAt } : {}), ...(clockOutAt ? { clockOutAt } : {}), reason, approvedBy: c.actorRef, approvedAt: c.occurredAt })], { correctionId: id });
  });
  // Permissions and station rights live in the cloud identity workflow (Supabase Auth + MEKONIQ grants), not in venue commands: this command exists so the attempt is an explicit,
  // audited refusal for the kitchen (FORBIDDEN) and a pointer for managers, rather than a silent UNKNOWN_COMMAND.
  handle(registry, 'Staff.SetPermissions', () => fail('IDENTITY_WORKFLOW_REQUIRED'));
}
