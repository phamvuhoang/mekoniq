import type { ModuleRegistry } from '../modules';
import type { DomainEvent, Snapshot } from '../../../contracts/src/index';
import { hashPayload } from '../../../contracts/src/canonical';
import { all, amount, changed, created, done, fail, find, handle, note, requireState, stableId, text } from '../restaurant-context';
import { assertCollectable } from '../billing/bill';
import { dueMinor } from '../billing/settlement';
import { shiftLedger } from '../cash/ledger';
const big = (v: unknown): bigint => BigInt(String(v ?? '0'));
/** What the venue still owes for this deposit: paid - applied to bills - returned - forfeited. A liability, never sales. */
export const liability = (d: Snapshot): bigint => big(d.state.paidMinor) - big(d.state.appliedMinor) - big(d.state.returnedMinor) - big(d.state.forfeitedMinor);
const methodOf = (v: unknown): string => v === 'cash' || v === 'transfer_manual' ? v : fail('INVALID_METHOD');
/** Cash that crosses the counter for a deposit is a drawer movement exactly like Cash.RecordMovement (the cashbook and the shift report see it); nothing is sales. */
function drawer(s: Snapshot[], shift: Snapshot, c: { actorRef: string; occurredAt: string; recordedAt: string; operationId: string }, direction: 'in' | 'out', minor: string, reason: string, depositId: string): DomainEvent[] {
  const key = direction === 'in' ? 'cashInMinor' : 'cashOutMinor', id = `move-${hashPayload({ operationId: c.operationId, depositId, direction }).slice(0, 32)}`;
  void s;
  return [created('CashMovementRecorded', 'cash-movement', id, { shiftId: shift.ref.id, direction, amountMinor: minor, currency: String(shift.state.currency ?? 'VND'), reason, adjustment: false, afterClose: false, actorRef: c.actorRef, occurredAt: c.occurredAt, recordedAt: c.recordedAt, depositId }),
    changed('ShiftCashMoved', shift, { [key]: String(big(shift.state[key]) + big(minor)) })];
}
export function registerDeposits(registry: ModuleRegistry): void {
  // Deposit.Receive {depositId,amountMinor,method:cash|transfer_manual,bookingId?,reference?,status?:paid|pending|unknown}: staff attest money received. Only `paid` counts; pending/unknown is a real
  // state that keeps a booking's hold and can later be resolved by sending the same deposit as paid/failed. Cash goes through the drawer; a customer's "I paid" is not a command here.
  handle(registry, 'Deposit.Receive', (c, s) => {
    const id = text(c.payload.depositId), minor = amount(c.payload.amountMinor, true), method = methodOf(c.payload.method), status = c.payload.status === undefined ? 'paid' : ['paid', 'pending', 'unknown', 'failed'].includes(String(c.payload.status)) ? String(c.payload.status) : fail('INVALID_STATUS');
    const bookingId = c.payload.bookingId === undefined ? undefined : text(c.payload.bookingId);
    if (bookingId && !['requested', 'confirmed'].includes(String(requireState(s, 'booking', bookingId).state.status))) return fail('BOOKING_STATE_CONFLICT');
    const reference = method === 'transfer_manual' ? note(c.payload.reference, 'REFERENCE_REQUIRED') : undefined, existing = find(s, 'deposit', id);
    if (existing) {
      if (existing.state.amountMinor !== minor || existing.state.method !== method || existing.state.bookingId !== bookingId) return fail('DEPOSIT_CONFLICT');
      if (existing.state.status === status) return done([], { depositId: id, duplicate: true });
      if (!['pending', 'unknown'].includes(String(existing.state.status))) return fail('DEPOSIT_CONFLICT');
      return done([changed('DepositResolved', existing, { status, paidMinor: status === 'paid' ? minor : '0' })], { depositId: id, status });
    }
    const shift = method === 'cash' ? all(s, 'shift').find(x => x.state.cashierId === c.actorRef && x.state.status === 'open') ?? fail('ACTIVE_SHIFT_REQUIRED') : undefined;
    const events: DomainEvent[] = [created('DepositReceived', 'deposit', id, { ...(bookingId ? { bookingId } : {}), method, ...(reference ? { reference } : {}), currency: String(shift?.state.currency ?? c.payload.currency ?? 'VND'), amountMinor: minor, paidMinor: status === 'paid' ? minor : '0', appliedMinor: '0', returnedMinor: '0', forfeitedMinor: '0', status, ...(shift ? { shiftId: shift.ref.id } : {}), receivedBy: c.actorRef, occurredAt: c.occurredAt })];
    if (shift && status === 'paid') events.push(...drawer(s, shift, c, 'in', minor, `deposit ${id}`, id));
    return done(events, { depositId: id, status });
  });
  // Deposit.Apply {depositId,billId,amountMinor}: pays part of a prepared bill with the deposit. It is a tender on the bill (payment method `deposit`, no drawer movement — the cash
  // came in when the deposit was taken), so revenue is still recognised once, when the bill closes. One application per deposit+bill.
  handle(registry, 'Deposit.Apply', (c, s) => {
    const dep = find(s, 'deposit', text(c.payload.depositId)) ?? fail('NOT_FOUND'), billId = text(c.payload.billId), minor = amount(c.payload.amountMinor, true);
    if (dep.state.status !== undefined && dep.state.status !== 'paid') return fail('DEPOSIT_NOT_CONFIRMED');
    const appId = `depapp-${hashPayload({ depositId: dep.ref.id, billId }).slice(0, 32)}`, prior = find(s, 'deposit-application', appId);
    if (prior) return prior.state.amountMinor === minor ? done([], { applicationId: appId, duplicate: true }) : fail('DEPOSIT_APPLICATION_CONFLICT');
    const bill = requireState(s, 'bill', billId); assertCollectable(s, bill);
    const currency = String(bill.state.currency ?? 'VND');
    if (currency !== String(dep.state.currency ?? 'VND')) return fail('CURRENCY_MISMATCH');
    if (big(minor) > big(dueMinor(String(bill.state.totalMinor), String(bill.state.paidMinor ?? '0'), String(bill.state.refundedMinor ?? '0')))) return fail('AMOUNT_EXCEEDS_DUE');
    if (big(minor) > liability(dep)) return fail('DEPOSIT_EXCEEDS_BALANCE');
    const payId = `pay-${hashPayload({ depositId: dep.ref.id, billId }).slice(0, 32)}`;
    return done([created('DepositApplied', 'deposit-application', appId, { depositId: dep.ref.id, billId, amountMinor: minor, paymentId: payId, actorRef: c.actorRef, occurredAt: c.occurredAt }),
      changed('DepositBalanceChanged', dep, { appliedMinor: String(big(dep.state.appliedMinor) + big(minor)) }),
      created('DepositTenderCaptured', 'payment', payId, { billId, method: 'deposit', depositId: dep.ref.id, currency, amountMinor: minor, capturedMinor: minor, appliedMinor: minor, unappliedMinor: '0', refundedMinor: '0', feeMinor: '0', status: 'captured', shiftId: null, actorRef: c.actorRef, occurredAt: c.occurredAt }),
      changed('BillTenderObserved', bill, { paidMinor: String(big(bill.state.paidMinor) + big(minor)) })], { applicationId: appId, paymentId: payId });
  });
  // Deposit.Return {depositId,amountMinor,method,reason,reference?}: gives money back (manager, deposit.manage), never more than the liability. Cash leaves the drawer of the shift that took it
  // (if still open) or of the actor's open shift, and only what the drawer holds.
  handle(registry, 'Deposit.Return', (c, s) => {
    const reason = note(c.payload.reason, 'REASON_REQUIRED'), dep = find(s, 'deposit', text(c.payload.depositId)) ?? fail('NOT_FOUND'), minor = amount(c.payload.amountMinor, true), method = methodOf(c.payload.method);
    if (big(minor) > liability(dep)) return fail('DEPOSIT_EXCEEDS_BALANCE');
    const reference = method === 'transfer_manual' ? note(c.payload.reference, 'REFERENCE_REQUIRED') : undefined;
    const events: DomainEvent[] = [];
    if (method === 'cash') {
      const open = (id: unknown) => all(s, 'shift').find(x => x.ref.id === id && x.state.status === 'open');
      const shift = open(dep.state.shiftId) ?? all(s, 'shift').find(x => x.state.cashierId === c.actorRef && x.state.status === 'open') ?? fail('ACTIVE_SHIFT_REQUIRED');
      if (big(minor) > big(shiftLedger(s, shift).expectedMinor)) return fail('INSUFFICIENT_CASH');
      events.push(...drawer(s, shift, c, 'out', minor, `deposit return ${dep.ref.id}`, dep.ref.id));
    }
    return done([created('DepositReturned', 'deposit-return', stableId('dret', c), { depositId: dep.ref.id, amountMinor: minor, method, ...(reference ? { reference } : {}), reason, actorRef: c.actorRef, occurredAt: c.occurredAt }), changed('DepositBalanceChanged', dep, { returnedMinor: String(big(dep.state.returnedMinor) + big(minor)) }), ...events], { depositId: dep.ref.id });
  });
}
