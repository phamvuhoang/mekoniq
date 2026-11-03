import type { ModuleRegistry } from '../modules';
import { all, changed, created, done, fail, find, handle, note, requireState, text } from '../restaurant-context';
import { party, tableBusy, tableFor, touchCalendar } from './resource';
export function registerWaitlist(registry: ModuleRegistry): void {
  handle(registry, 'Waitlist.Join', (c, s) => {
    const id = text(c.payload.waitId), size = party(c.payload.partySize), name = text(typeof c.payload.name === 'string' ? c.payload.name.trim() : c.payload.name, 'NAME_REQUIRED');
    if (find(s, 'waitlist', id)) return fail('WAIT_EXISTS');
    return done([created('WaitlistJoined', 'waitlist', id, { name, partySize: size, ...(typeof c.payload.phone === 'string' ? { phone: c.payload.phone } : {}), status: 'waiting', joinedAt: c.occurredAt, joinedMs: Date.parse(c.occurredAt) })], { waitId: id });
  });
  // Waitlist.Promote {waitId,tableId,durationMinutes?,skipReason?}: seats the party the venue is calling next. First come, first served among the parties the table fits: leaving an
  // earlier party behind needs a written `skipReason` (kept on the record). The table must be free now for the whole stay (no active session, no blocking booking); the promotion creates a
  // confirmed booking for that slot so nobody else can take it.
  handle(registry, 'Waitlist.Promote', (c, s) => {
    const w = requireState(s, 'waitlist', text(c.payload.waitId));
    if (w.state.status !== 'waiting') return fail('WAIT_STATE_CONFLICT');
    const tableId = text(c.payload.tableId), table = tableFor(s, tableId, Number(w.state.partySize)), minutes = c.payload.durationMinutes === undefined ? 90 : Number.isInteger(c.payload.durationMinutes) && (c.payload.durationMinutes as number) >= 15 && (c.payload.durationMinutes as number) <= 480 ? c.payload.durationMinutes as number : fail('INVALID_RANGE');
    const seats = typeof table.state.seats === 'number' ? table.state.seats : Infinity;
    const ahead = all(s, 'waitlist').filter(o => o.state.status === 'waiting' && o.ref.id !== w.ref.id && Number(o.state.partySize) <= seats && (Number(o.state.joinedMs) < Number(w.state.joinedMs) || (Number(o.state.joinedMs) === Number(w.state.joinedMs) && o.ref.id < w.ref.id)));
    const skip = c.payload.skipReason === undefined ? undefined : note(c.payload.skipReason, 'REASON_REQUIRED');
    if (ahead.length && !skip) return fail('WAITLIST_ORDER');
    const now = Date.parse(c.occurredAt), end = now + minutes * 60_000;
    if (table.state.activeSessionId || tableBusy(s, tableId, now, end, now)) return fail('TABLE_UNAVAILABLE');
    const bookingId = `bk-wait-${w.ref.id}`;
    return done([changed('WaitlistPromoted', w, { status: 'promoted', tableId, bookingId, promotedAt: c.occurredAt, promotedBy: c.actorRef, ...(skip ? { skipReason: skip, skippedOver: ahead.map(o => o.ref.id) } : {}) }),
      created('BookingConfirmed', 'booking', bookingId, { tableId, startsAt: new Date(now).toISOString(), endsAt: new Date(end).toISOString(), startMs: now, endMs: end, partySize: w.state.partySize!, name: w.state.name!, depositRequiredMinor: '0', status: 'confirmed', provisional: false, holdUntilMs: 0, channel: 'waitlist', waitId: w.ref.id, createdBy: c.actorRef, createdAt: c.occurredAt }),
      touchCalendar(s, c, tableId)], { bookingId });
  });
}
