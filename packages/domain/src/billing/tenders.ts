import type { ModuleRegistry } from '../modules';
import type { JsonObject, Snapshot } from '../../../contracts/src/index';
import { all, amount, changed, created, done, expectVersion, externalPaymentId, externalReference, fail, find, handle, note, requireState, text } from '../restaurant-context';
import { assertCollectable } from './bill';
import { dueMinor } from './settlement';

const TERMINAL_STATUSES = ['captured', 'pending', 'unknown', 'failed'];
/** Captured money is applied up to what the bill still owes; the rest is kept as unapplied (never dropped, refundable). A non-prepared bill owes nothing. */
function capture(bill: Snapshot, minor: bigint): { applied: bigint; unapplied: bigint } {
  const due = bill.state.status === 'prepared' ? BigInt(dueMinor(String(bill.state.totalMinor), String(bill.state.paidMinor ?? '0'), String(bill.state.refundedMinor ?? '0'))) : 0n;
  const applied = due <= 0n ? 0n : minor < due ? minor : due;
  return { applied, unapplied: minor - applied };
}
const billMoney = (bill: Snapshot, applied: bigint, unapplied: bigint): JsonObject => ({ paidMinor: String(BigInt(String(bill.state.paidMinor ?? '0')) + applied), unappliedMinor: String(BigInt(String(bill.state.unappliedMinor ?? '0')) + unapplied) });
/** Worst unresolved external state over the bill's payments once `paymentId` has `status`: any unknown blocks, then pending. */
function externalState(s: Snapshot[], billId: string, paymentId: string, status: string): string | null {
  const states = [...all(s, 'payment').filter(p => p.state.billId === billId && p.ref.id !== paymentId).map(p => String(p.state.status)), status];
  return states.includes('unknown') ? 'unknown' : states.includes('pending') ? 'pending' : null;
}
function tenderBasics(c: { payload: JsonObject }, bill: Snapshot) {
  const currency = String(bill.state.currency ?? 'VND');
  if (c.payload.currency !== undefined && c.payload.currency !== currency) return fail('CURRENCY_MISMATCH');
  const reference = externalReference(c.payload.reference);
  return { currency, reference, id: externalPaymentId(reference), minor: amount(c.payload.amountMinor, true) };
}
/**
 * Non-cash tenders. Each is one payment aggregate keyed by its external reference (provider+merchant+transaction), so a repeated observation is
 * idempotent and the same transaction can never pay twice or pay a second bill. Fees are recorded beside the payment, never netted from it.
 */
export function registerTenders(registry: ModuleRegistry): void {
  // Payment.RecordTerminal {billId,amountMinor,currency,status,reference,feeMinor?}: what a standalone card terminal (or later its webhook) reported.
  // pending/unknown is a real state: it blocks every other collection on the bill until the same reference is observed captured or failed.
  handle(registry, 'Payment.RecordTerminal', (c, s) => {
    const bill = requireState(s, 'bill', text(c.payload.billId));
    const status = TERMINAL_STATUSES.includes(String(c.payload.status)) ? String(c.payload.status) : fail('INVALID_STATUS');
    const { currency, reference, id, minor } = tenderBasics(c, bill), existing = find(s, 'payment', id);
    if (existing) {
      if (existing.state.method !== 'card-terminal' || existing.state.billId !== bill.ref.id || existing.state.amountMinor !== minor || existing.state.currency !== currency) return fail('PAYMENT_REFERENCE_CONFLICT');
      if (existing.state.status === status) return done([], { paymentId: id, status, duplicate: true });
      if (!['pending', 'unknown'].includes(String(existing.state.status))) return fail('PAYMENT_ALREADY_FINAL');
    } else assertCollectable(s, bill);
    const { applied, unapplied } = status === 'captured' ? capture(bill, BigInt(minor)) : { applied: 0n, unapplied: 0n };
    const state: JsonObject = {
      billId: bill.ref.id, method: 'card-terminal', reference, currency, amountMinor: minor, capturedMinor: status === 'captured' ? minor : '0', appliedMinor: String(applied), unappliedMinor: String(unapplied),
      refundedMinor: '0', feeMinor: c.payload.feeMinor === undefined ? String(existing?.state.feeMinor ?? '0') : amount(c.payload.feeMinor), status, actorRef: c.actorRef, occurredAt: c.occurredAt,
      observations: [...((existing?.state.observations ?? []) as JsonObject[]), { status, by: c.actorRef, at: c.recordedAt, operationId: c.operationId }],
    };
    const type = `CardPayment${status[0]!.toUpperCase()}${status.slice(1)}`;
    return done([existing ? changed(type, existing, state) : created(type, 'payment', id, state), changed('BillTenderObserved', bill, { ...billMoney(bill, applied, unapplied), externalPaymentState: externalState(s, bill.ref.id, id, status) })],
      { paymentId: id, status, appliedMinor: String(applied), unappliedMinor: String(unapplied) });
  });
  // Payment.VerifyManual {billId,expectedVersion,amountMinor,currency,reference,reason,evidenceRef,claimId?}: a manager attests a bank transfer arrived.
  // This is a human attestation, not a bank integration: it needs no `bank` readiness and never turns a customer claim into money by itself.
  handle(registry, 'Payment.VerifyManual', (c, s) => {
    const bill = requireState(s, 'bill', text(c.payload.billId));
    const { currency, reference, id, minor } = tenderBasics(c, bill), existing = find(s, 'payment', id);
    if (existing) return existing.state.method === 'transfer' && existing.state.billId === bill.ref.id && existing.state.amountMinor === minor ? done([], { paymentId: id, status: existing.state.status!, duplicate: true }) : fail('PAYMENT_REFERENCE_CONFLICT');
    expectVersion(c, bill); assertCollectable(s, bill);
    const reason = note(c.payload.reason, 'REASON_REQUIRED'), evidenceRef = note(c.payload.evidenceRef, 'EVIDENCE_REQUIRED');
    const claim = c.payload.claimId === undefined ? undefined : requireState(s, 'payment-observation', text(c.payload.claimId));
    if (claim && (claim.state.billId !== bill.ref.id || claim.state.status !== 'unverified')) return fail('CLAIM_MISMATCH');
    const { applied, unapplied } = capture(bill, BigInt(minor));
    return done([
      created('ManualTransferVerified', 'payment', id, {
        billId: bill.ref.id, method: 'transfer', verification: 'manual', reference, currency, amountMinor: minor, capturedMinor: minor, appliedMinor: String(applied), unappliedMinor: String(unapplied), refundedMinor: '0',
        feeMinor: c.payload.feeMinor === undefined ? '0' : amount(c.payload.feeMinor), status: 'captured', verifiedBy: c.actorRef, reason, evidenceRef, claimId: claim?.ref.id ?? null, actorRef: c.actorRef, occurredAt: c.occurredAt, verifiedAt: c.recordedAt,
      }),
      changed('BillTenderVerified', bill, billMoney(bill, applied, unapplied)),
      ...(claim ? [changed('PaymentClaimVerified', claim, { status: 'verified', paymentId: id, verifiedBy: c.actorRef })] : []),
    ], { paymentId: id, status: 'captured', appliedMinor: String(applied), unappliedMinor: String(unapplied) });
  });
}
