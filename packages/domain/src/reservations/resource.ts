import type { CommandEnvelope, DomainEvent, Snapshot } from '../../../contracts/src/index';
import { all, changed, created, fail, find, text } from '../restaurant-context';
import { utcEpochMs } from '../shared/clock';
export function rangesOverlap(a: { start: number; end: number }, b: { start: number; end: number }) {
  return a.start < b.end && b.start < a.end;
}
export const MAX_BOOKING_MS = 8 * 3600_000;
export const policyOf = (s: Snapshot[]) => ({ graceMinutes: 15, earlyMinutes: 30, noShowForfeit: false, ...(find(s, 'reservation-policy', 'current')?.state ?? {}) }) as { graceMinutes: number; earlyMinutes: number; noShowForfeit: boolean };
/** A UTC instant `...Z` in epoch ms; anything else is an invalid range (a naive local time would silently mean a different moment per device). */
export const instant = (v: unknown): number => { try { return utcEpochMs(text(v as string, 'INVALID_RANGE')); } catch { return fail('INVALID_RANGE'); } };
export const paidDeposits = (s: Snapshot[], bookingId: string): Snapshot[] => all(s, 'deposit').filter(d => d.state.bookingId === bookingId && (d.state.status === undefined || d.state.status === 'paid'));
export const unresolvedDeposit = (s: Snapshot[], bookingId: string): boolean => all(s, 'deposit').some(d => d.state.bookingId === bookingId && ['pending', 'unknown'].includes(String(d.state.status)));
/**
 * Does this booking keep the table out of reach right now? Confirmed / checked-in always. A merely requested one only holds while its hold is live — or for as long as a deposit
 * for it is unresolved (an unknown payment must never free the table by itself). A provisional (isolated) booking guarantees nothing, so it never blocks.
 */
export function blocks(s: Snapshot[], b: Snapshot, nowMs: number): boolean {
  if (['confirmed', 'checked_in'].includes(String(b.state.status))) return true;
  if (b.state.status !== 'requested' || b.state.provisional === true) return false;
  return nowMs < Number(b.state.holdUntilMs ?? 0) || unresolvedDeposit(s, b.ref.id);
}
export function tableBusy(s: Snapshot[], tableId: string, start: number, end: number, nowMs: number, exceptId?: string): boolean {
  return all(s, 'booking').some(b => b.ref.id !== exceptId && b.state.tableId === tableId && blocks(s, b, nowMs) && rangesOverlap({ start, end }, { start: Number(b.state.startMs), end: Number(b.state.endMs) }));
}
/**
 * Every change that takes or frees a table's time also bumps this per-table aggregate. Two racing bookings of one table would otherwise create two different booking ids and
 * both commit; with the shared calendar row the store's version check lets exactly one through (the other is rejected and re-checks against the winner).
 */
export function touchCalendar(s: Snapshot[], c: CommandEnvelope, tableId: string): DomainEvent {
  const cal = find(s, 'table-calendar', tableId);
  return cal ? changed('TableCalendarTouched', cal, { revision: Number(cal.state.revision) + 1, lastBy: c.actorRef }) : created('TableCalendarTouched', 'table-calendar', tableId, { revision: 1, lastBy: c.actorRef });
}
export function tableFor(s: Snapshot[], tableId: string, partySize: number): Snapshot {
  const table = find(s, 'table', tableId) ?? fail('TABLE_UNKNOWN');
  if (typeof table.state.seats === 'number' && partySize > table.state.seats) return fail('CAPACITY_EXCEEDED');
  return table;
}
export const party = (v: unknown): number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 200 ? v as number : fail('INVALID_PARTY');
