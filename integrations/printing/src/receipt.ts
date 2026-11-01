import type { JsonObject, Snapshot } from '../../../packages/contracts/src/index';
export type ReceiptLine = { name: string; quantity: string; modifiers: string[]; totalMinor: string };
export type Receipt = {
  billId: string; kind: 'bill' | 'receipt'; currency: string; lines: ReceiptLine[];
  charges: { subtotalMinor: string; discountMinor: string; serviceMinor: string; taxMinor: string; taxIncludedMinor: string };
  totalMinor: string; paidMinor: string; refundedMinor: string; dueMinor: string;
  payments: { method: string; capturedMinor: string; tenderedMinor: string; changeMinor: string; refundedMinor: string }[];
  refunds: { method: string; amountMinor: string }[];
};
const big = (v: unknown): bigint => { try { return BigInt(String(v ?? '0')); } catch { return 0n; } };
/**
 * Receipt model from the bill's frozen snapshot (its priced lines and charges from W05-T01) plus the payments, change and refunds recorded for it (W05-T03).
 * Money stays integer strings. A `prepared` bill prints as a provisional bill; anything else as a receipt. Missing fields read as zero/empty so a sparse bill still prints.
 */
export function buildReceipt(bill: Snapshot, snapshots: Snapshot[]): Receipt {
  const s = bill.state, lines = ((s.lines ?? []) as JsonObject[]).flatMap<ReceiptLine>(l => {
    const quantity = big(l.quantity) - big(l.cancelledQuantity);
    if (quantity <= 0n) return [];
    const net = (k: string) => big(l[k]) - big((l.cancelled as JsonObject | undefined)?.[k]);
    return [{ name: String(l.name ?? l.itemId ?? ''), quantity: String(quantity), modifiers: ((l.modifiers ?? []) as JsonObject[]).map(m => String(m.name ?? '')).filter(Boolean), totalMinor: String(net('totalMinor')) }];
  });
  const sum = (s.summary ?? {}) as JsonObject, ofBill = (kind: string) => snapshots.filter(x => x.ref.kind === kind && x.state.billId === bill.ref.id);
  const total = big(s.totalMinor), paid = big(s.paidMinor), refunded = big(s.refundedMinor);
  return {
    billId: bill.ref.id, kind: s.status === 'prepared' ? 'bill' : 'receipt', currency: String(s.currency ?? 'VND'), lines,
    charges: { subtotalMinor: String(big(sum.subtotalMinor)), discountMinor: String(big(sum.discountMinor)), serviceMinor: String(big(sum.serviceMinor)), taxMinor: String(big(sum.taxMinor)), taxIncludedMinor: String(big(sum.taxIncludedMinor)) },
    totalMinor: String(total), paidMinor: String(paid), refundedMinor: String(refunded), dueMinor: String(total - paid + refunded),
    payments: ofBill('payment').filter(p => p.state.status === 'captured').map(p => ({ method: String(p.state.method), capturedMinor: String(big(p.state.capturedMinor ?? p.state.appliedMinor)), tenderedMinor: String(big(p.state.tenderedMinor ?? p.state.capturedMinor)), changeMinor: String(big(p.state.changeMinor)), refundedMinor: String(big(p.state.refundedMinor)) })),
    refunds: ofBill('refund').map(r => ({ method: String(r.state.method), amountMinor: String(big(r.state.amountMinor)) })),
  };
}
