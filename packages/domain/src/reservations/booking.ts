import type { ModuleRegistry } from '../modules';
import type { DomainEvent, Snapshot } from '../../../contracts/src/index';
import { amount, changed, created, done, expectVersion, fail, find, handle, note, requireState, stableId, text } from '../restaurant-context';
import { liability } from './deposit';
import { MAX_BOOKING_MS, instant, paidDeposits, party, policyOf, tableBusy, tableFor, touchCalendar } from './resource';
const big = (v: unknown): bigint => BigInt(String(v ?? '0'));
const live = (b: Snapshot, ...statuses: string[]): void => { if (!statuses.includes(String(b.state.status))) fail('BOOKING_STATE_CONFLICT'); };
export function registerBookings(registry: ModuleRegistry): void {
  // Booking.Create {bookingId,tableId,startsAt,endsAt,partySize,name,phone?,customerId?,depositRequiredMinor?,holdMinutes?,isolated?}: a request (`requested`) that holds the table for
  // `holdMinutes` (default 15). The hold only matters for overlap checks — the clock never cancels anything. An `isolated` booking (taken while the venue's owner was unreachable) is
  // provisional: it guarantees nothing and does not block, until Booking.Confirm re-checks it against the real calendar.
  handle(registry, 'Booking.Create', (c, s) => {
    const id = text(c.payload.bookingId), start = instant(c.payload.startsAt), end = instant(c.payload.endsAt), size = party(c.payload.partySize), now = Date.parse(c.occurredAt);
    if (end <= start || end - start > MAX_BOOKING_MS) return fail('INVALID_RANGE');
    if (find(s, 'booking', id)) return fail('BOOKING_EXISTS');
    const tableId = text(c.payload.tableId); tableFor(s, tableId, size);
    if (start < now - 15 * 60_000) return fail('BOOKING_IN_PAST');
    const hold = c.payload.holdMinutes === undefined ? 15 : Number.isInteger(c.payload.holdMinutes) && (c.payload.holdMinutes as number) >= 1 && (c.payload.holdMinutes as number) <= 1440 ? c.payload.holdMinutes as number : fail('INVALID_HOLD');
    const isolated = c.payload.isolated === true;
    if (!isolated && tableBusy(s, tableId, start, end, now)) return fail('TABLE_UNAVAILABLE');
    const name = text(typeof c.payload.name === 'string' ? c.payload.name.trim() : c.payload.name, 'NAME_REQUIRED');
    return done([created('BookingRequested', 'booking', id, { tableId, startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), startMs: start, endMs: end, partySize: size, name, ...(typeof c.payload.phone === 'string' ? { phone: c.payload.phone } : {}), ...(typeof c.payload.customerId === 'string' ? { customerId: c.payload.customerId } : {}),
      depositRequiredMinor: c.payload.depositRequiredMinor === undefined ? '0' : amount(c.payload.depositRequiredMinor), depositCurrency: typeof c.payload.currency === 'string' ? c.payload.currency : 'VND', status: 'requested', provisional: isolated, holdUntilMs: isolated ? 0 : now + hold * 60_000, channel: String(c.payload.channel ?? 'venue'), createdBy: c.actorRef, createdAt: c.occurredAt }),
      touchCalendar(s, c, tableId)], { bookingId: id });
  });
  // Booking.Confirm {bookingId,expectedVersion}: the venue accepts the booking. Re-checks the table (a lapsed hold or an isolated booking may have lost its slot) and that the required
  // deposit is still HELD in full across receipts of the booking's currency: paid and not since returned, applied or forfeited (pending/unknown money does not count).
  handle(registry, 'Booking.Confirm', (c, s) => {
    const b = requireState(s, 'booking', text(c.payload.bookingId)); live(b, 'requested'); expectVersion(c, b);
    const cur = String(b.state.depositCurrency ?? 'VND'), paid = paidDeposits(s, b.ref.id).filter(d => String(d.state.currency ?? 'VND') === cur).reduce((a, d) => a + liability(d), 0n);
    if (paid < big(b.state.depositRequiredMinor)) return fail('DEPOSIT_REQUIRED');
    if (tableBusy(s, String(b.state.tableId), Number(b.state.startMs), Number(b.state.endMs), Date.parse(c.occurredAt), b.ref.id)) return fail('TABLE_UNAVAILABLE');
    return done([changed('BookingConfirmed', b, { status: 'confirmed', provisional: false, confirmedBy: c.actorRef, confirmedAt: c.occurredAt }), touchCalendar(s, c, String(b.state.tableId))], { bookingId: b.ref.id });
  });
  // Booking.CheckIn {bookingId,expectedVersion,sessionId?}: from `earlyMinutes` before the start to the end of the slot, onto a FREE table; opens the table session (same shape as Session.Open)
  // and records how late the party was.
  handle(registry, 'Booking.CheckIn', (c, s) => {
    const b = find(s, 'booking', text(c.payload.bookingId)) ?? fail('NOT_FOUND');
    if (b.state.status !== 'confirmed') return fail('BOOKING_NOT_CONFIRMED');
    expectVersion(c, b);
    const now = Date.parse(c.occurredAt), start = Number(b.state.startMs);
    if (now < start - policyOf(s).earlyMinutes * 60_000) return fail('CHECK_IN_TOO_EARLY');
    if (now > Number(b.state.endMs)) return fail('CHECK_IN_EXPIRED');
    const table = requireState(s, 'table', String(b.state.tableId));
    if (table.state.activeSessionId) return fail('TABLE_OCCUPIED');
    const sessionId = c.payload.sessionId === undefined ? stableId('session', c) : text(c.payload.sessionId);
    if (find(s, 'session', sessionId)) return fail('SESSION_EXISTS');
    return done([created('SessionOpened', 'session', sessionId, { tableId: table.ref.id, status: 'open', orderIds: [], revision: 0, openedBy: c.actorRef, openedAt: c.recordedAt, bookingId: b.ref.id }), changed('TableOccupied', table, { activeSessionId: sessionId }),
      changed('BookingCheckedIn', b, { status: 'checked_in', sessionId, checkedInAt: c.occurredAt, lateMs: Math.max(0, now - start) })], { sessionId });
  });
  // Booking.NoShow {bookingId,expectedVersion,reason,forfeitDeposit?}: only after start + grace. The slot is freed; the deposit stays a liability until a manager returns it — or, if the venue
  // policy allows (`noShowForfeit`) and the actor has deposit.manage, forfeits it. Nothing is decided by the clock.
  handle(registry, 'Booking.NoShow', (c, s) => {
    const reason = note(c.payload.reason, 'REASON_REQUIRED'), b = requireState(s, 'booking', text(c.payload.bookingId)); live(b, 'confirmed'); expectVersion(c, b);
    const policy = policyOf(s);
    if (Date.parse(c.occurredAt) < Number(b.state.startMs) + policy.graceMinutes * 60_000) return fail('NO_SHOW_TOO_EARLY');
    const forfeit = c.payload.forfeitDeposit === true;
    if (forfeit && !policy.noShowForfeit) return fail('FORFEIT_NOT_PERMITTED');
    const events: DomainEvent[] = [changed('BookingNoShow', b, { status: 'no_show', noShowReason: reason, noShowAt: c.occurredAt, noShowBy: c.actorRef }), touchCalendar(s, c, String(b.state.tableId))];
    if (forfeit) for (const d of paidDeposits(s, b.ref.id)) { const left = big(d.state.paidMinor) - big(d.state.appliedMinor) - big(d.state.returnedMinor) - big(d.state.forfeitedMinor); if (left > 0n) events.push(changed('DepositForfeited', d, { forfeitedMinor: String(big(d.state.forfeitedMinor) + left), forfeitReason: reason })); }
    return done(events, { bookingId: b.ref.id });
  });
  handle(registry, 'Booking.Cancel', (c, s) => {
    const b = requireState(s, 'booking', text(c.payload.bookingId)); live(b, 'requested', 'confirmed'); expectVersion(c, b);
    return done([changed('BookingCancelled', b, { status: 'cancelled', cancelReason: note(c.payload.reason, 'REASON_REQUIRED'), cancelledAt: c.occurredAt, cancelledBy: c.actorRef }), touchCalendar(s, c, String(b.state.tableId))], { bookingId: b.ref.id });
  });
}
