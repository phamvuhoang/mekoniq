import type { ModuleRegistry } from '../modules';
import type { JsonObject } from '../../../contracts/src/index';
import { componentRefundMinor, liveComponents } from '../pricing/combo';
import { all, amount, changed, created, done, expectVersion, fail, find, handle, note, record, requireState, stableId, text } from '../restaurant-context';

export function refundableMinor(captured: string, refunded: string) {
  return String(BigInt(captured) - BigInt(refunded));
}
export function canRefund(captured: string, refunded: string, request: string) {
  return BigInt(request) > 0n && BigInt(request) <= BigInt(refundableMinor(captured, refunded));
}
const METHODS = ['cash', 'transfer', 'card-terminal'];
/**
 * Refund.Record {paymentId,expectedVersion,amountMinor,reason,method?,shiftId?,evidenceRef?}: money only. It never touches orders, kitchen or stock,
 * never voids the payment (it stays captured) and never exceeds its unrefunded captured part. It consumes the payment's unapplied (overpaid) part
 * first, then the applied part, which reopens the bill's balance (bill.refundedMinor). A closed bill stays closed. Cash leaves an open shift's drawer
 * (explicit shiftId, else the shift that took it if still open, else the actor's); other methods need the refund's external evidence reference.
 */
export function registerRefunds(registry: ModuleRegistry): void {
  handle(registry, 'Refund.Record', (c, s) => {
    const payment = requireState(s, 'payment', text(c.payload.paymentId)); expectVersion(c, payment);
    if (payment.state.status !== 'captured') return fail('PAYMENT_NOT_CAPTURED');
    const request = amount(c.payload.amountMinor, true), reason = note(c.payload.reason, 'REASON_REQUIRED');
    const captured = String(payment.state.capturedMinor ?? payment.state.appliedMinor), refunded = String(payment.state.refundedMinor ?? '0');
    if (!canRefund(captured, refunded, request)) return fail('REFUND_EXCEEDS_CAPTURED');
    const bill = requireState(s, 'bill', String(payment.state.billId));
    // an offline grant holds exclusive collection on the bill and pins its version; money moves only after it is reconciled
    if (bill.state.collectionLocked === true || all(s, 'grant').some(g => g.state.billId === bill.ref.id && g.state.status !== 'reconciled')) return fail('GRANT_UNRECONCILED');
    // component {lineId,itemId}: refunding ONE part of a combo line returns exactly its frozen share (price share minus its share of the discount), once
    let component: JsonObject | undefined;
    if (c.payload.component !== undefined) {
      const r = record(c.payload.component), lineId = text(r.lineId), itemId = text(r.itemId);
      const line = ((bill.state.lines ?? []) as JsonObject[]).find(l => l.id === lineId && Array.isArray(l.components)) ?? fail('COMPONENT_NOT_FOUND');
      let expected: string; try { expected = componentRefundMinor({ components: liveComponents(line) }, itemId); } catch { return fail('COMPONENT_NOT_FOUND'); }
      if (request !== expected) return fail('COMPONENT_AMOUNT_MISMATCH');
      if (all(s, 'refund').some(x => x.state.billId === bill.ref.id && (x.state.component as JsonObject | undefined)?.lineId === lineId && (x.state.component as JsonObject | undefined)?.itemId === itemId)) return fail('COMPONENT_ALREADY_REFUNDED');
      component = { lineId, itemId };
    }
    const currency = String(payment.state.currency ?? bill.state.currency ?? 'VND');
    const method = c.payload.method === undefined ? String(payment.state.method) : text(c.payload.method);
    if (!METHODS.includes(method)) return fail('INVALID_METHOD');
    const open = (id: unknown) => { const x = typeof id === 'string' ? find(s, 'shift', id) : undefined; return x?.state.status === 'open' ? x : undefined; };
    const shift = method !== 'cash' ? undefined : c.payload.shiftId !== undefined ? open(text(c.payload.shiftId)) ?? fail('SHIFT_NOT_OPEN')
      // the payment's own drawer only when that payment was cash; cash handed back for a card/transfer leaves the refunding actor's drawer
      : (payment.state.method === 'cash' ? open(payment.state.shiftId) : undefined) ?? all(s, 'shift').find(x => x.state.cashierId === c.actorRef && x.state.status === 'open') ?? fail('ACTIVE_SHIFT_REQUIRED');
    if (shift && shift.state.currency !== currency) return fail('CURRENCY_MISMATCH');
    // non-cash money never touches a drawer; it is reported on the shift of the payment it reverses (else the actor's open shift, else unattributed)
    const shiftId = shift?.ref.id ?? (method === 'cash' ? null : typeof payment.state.shiftId === 'string' ? payment.state.shiftId : all(s, 'shift').find(x => x.state.cashierId === c.actorRef && x.state.status === 'open')?.ref.id ?? null);
    const evidenceRef = c.payload.evidenceRef !== undefined || method !== 'cash' ? note(c.payload.evidenceRef, 'EVIDENCE_REQUIRED') : null;
    const req = BigInt(request), unapplied = BigInt(String(payment.state.unappliedMinor ?? '0')), fromUnapplied = req < unapplied ? req : unapplied, fromApplied = req - fromUnapplied;
    const billUnapplied = BigInt(String(bill.state.unappliedMinor ?? '0'));
    if (billUnapplied < fromUnapplied) return fail('BILL_BALANCE_CORRUPT');
    const refundId = stableId('refund', c);
    return done([
      created('RefundRecorded', 'refund', refundId, { paymentId: payment.ref.id, billId: bill.ref.id, currency, amountMinor: request, ...(component ? { component } : {}), appliedMinor: String(fromApplied), unappliedMinor: String(fromUnapplied), method, shiftId, reason, evidenceRef, actorRef: c.actorRef, billStatus: bill.state.status!, occurredAt: c.occurredAt, recordedAt: c.recordedAt }),
      changed('PaymentRefunded', payment, { refundedMinor: String(BigInt(refunded) + req), unappliedMinor: String(unapplied - fromUnapplied), refundIds: [...((payment.state.refundIds ?? []) as string[]), refundId] }),
      changed('BillRefunded', bill, { refundedMinor: String(BigInt(String(bill.state.refundedMinor ?? '0')) + fromApplied), unappliedMinor: String(billUnapplied - fromUnapplied) }),
      ...(shift ? [changed('ShiftCashRefunded', shift, { cashRefundedMinor: String(BigInt(String(shift.state.cashRefundedMinor ?? '0')) + req) })] : []),
    ], { refundId, paymentId: payment.ref.id, amountMinor: request, refundableMinor: refundableMinor(captured, String(BigInt(refunded) + req)) });
  });
}
