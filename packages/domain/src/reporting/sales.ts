import type { JsonObject, JsonValue, Snapshot } from '../../../contracts/src/index';
import { businessDateAt } from '../shared/clock';
/** Pure report helpers shared by the coordinator lab, the tablet (local snapshots) and the cloud route (projection). Never write anything. */
export const big = (v: unknown): bigint => BigInt(String(v ?? '0'));
export const sumOf = (xs: Snapshot[], f: (x: Snapshot) => unknown): string => String(xs.reduce((a, x) => a + big(f(x)), 0n));
export const ofKind = (s: Snapshot[], kind: string): Snapshot[] => s.filter(x => x.ref.kind === kind);
/** Venue-local business date of a UTC wire timestamp; null when the fact carries none. */
export function dayOf(at: unknown, timeZone: string): string | null {
  if (typeof at !== 'string' || !at.endsWith('Z')) return null;
  try { return businessDateAt(at, timeZone); } catch { return null; }
}
/** Facts whose timestamp cannot be placed on a business day (missing, not UTC `...Z`, unparseable): listed, never silently dropped. */
export function undatedFacts(xs: Snapshot[], field: (x: Snapshot) => unknown, tz: string): JsonObject[] {
  return xs.filter(x => dayOf(field(x), tz) === null).map(x => ({ kind: x.ref.kind, id: x.ref.id, at: String(field(x) ?? '') }));
}
export function netSales(gross:string, discount:string, returns:string) {
  return String(BigInt(gross) - BigInt(discount) - BigInt(returns));
}
const SALES_COLUMNS = ['kind', 'id', 'businessDate', 'effectiveAt', 'appliedAt', 'method', 'status', 'amountMinor', 'reference', 'reason'];
const reference = (v: JsonValue | undefined): string => v && typeof v === 'object' && !Array.isArray(v) ? [v.provider, v.merchantId, v.transactionId].filter(Boolean).join('/') : String(v ?? '');
/** An imported receipt counts on its own business date (row field, else its occurredAt in the venue zone), never on the import date. */
const receiptDay = (r: Snapshot, tz: string): string | null => typeof r.state.businessDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.state.businessDate) ? r.state.businessDate : dayOf(r.state.occurredAt, tz);
export const paymentAppliedAt = (p: Snapshot): JsonValue | undefined => p.state.verifiedAt ?? ((p.state.observations ?? []) as JsonObject[]).at(-1)?.at ?? p.state.occurredAt;

/**
 * Sales for one business date, derived from ledger facts only:
 * - revenue: CLOSED bills (closedAt) — split parents, merged sources and voided bills never close, so nothing counts twice — plus historical receipts
 *   and their amendments on the receipt's own business date;
 * - money: payments (occurredAt) by method, refunds (occurredAt) by method; returns = the refunded APPLIED part (an overpayment refund is not a return);
 * - units: from the orders of the closed bills (equal-split child lines keep full quantity + a portion), each order once, on its first closing day.
 * Totals carry no tax/service reallocation for refunds (refunds record money, not a charge breakdown): net = gross - discount - returns.
 */
export function salesReport(s: Snapshot[], date: string, tz: string): JsonObject {
  const on = (at: unknown) => dayOf(at, tz) === date;
  const bills = ofKind(s, 'bill'), closed = bills.filter(b => b.state.status === 'closed' && on(b.state.closedAt));
  const receipts = ofKind(s, 'historical-receipt').filter(r => receiptDay(r, tz) === date), receiptIds = new Set(receipts.map(r => r.ref.id));
  const amendments = ofKind(s, 'historical-amendment').filter(a => receiptIds.has(String(a.state.receiptId)));
  const payments = ofKind(s, 'payment').filter(p => on(p.state.occurredAt)), captured = payments.filter(p => p.state.status === 'captured');
  const refunds = ofKind(s, 'refund').filter(r => on(r.state.occurredAt));
  const part = (key: string) => sumOf(closed, b => ((b.state.summary ?? { subtotalMinor: b.state.totalMinor }) as JsonObject)[key]);
  const imported = sumOf(receipts, r => r.state.totalMinor), amended = sumOf(amendments, a => a.state.deltaMinor);
  const grossMinor = String(big(part('subtotalMinor')) + big(imported) + big(amended)), discountMinor = part('discountMinor');
  const salesTotalMinor = String(big(sumOf(closed, b => b.state.totalMinor)) + big(imported) + big(amended));
  const returnsMinor = sumOf(refunds, r => r.state.appliedMinor ?? r.state.amountMinor), netMinor = netSales(grossMinor, discountMinor, returnsMinor);
  const methods = [...new Set([...payments, ...refunds].map(x => String(x.state.method)))].sort();
  const byMethod = methods.flatMap(method => { const xs = captured.filter(p => p.state.method === method); return xs.length ? [{ method, count: xs.length,
    capturedMinor: sumOf(xs, p => p.state.capturedMinor ?? p.state.appliedMinor), appliedMinor: sumOf(xs, p => p.state.appliedMinor), unappliedMinor: sumOf(xs, p => p.state.unappliedMinor),
    feeMinor: sumOf(xs, p => p.state.feeMinor), tenderedMinor: sumOf(xs, p => p.state.tenderedMinor ?? p.state.capturedMinor ?? p.state.appliedMinor), changeMinor: sumOf(xs, p => p.state.changeMinor) }] : []; });
  const refundsByMethod = methods.flatMap(method => { const xs = refunds.filter(r => r.state.method === method); return xs.length ? [{ method, count: xs.length, amountMinor: sumOf(xs, r => r.state.amountMinor), appliedMinor: sumOf(xs, r => r.state.appliedMinor ?? r.state.amountMinor), unappliedMinor: sumOf(xs, r => r.state.unappliedMinor) }] : []; });
  // Units: an order belongs to the first business day one of its bills closed (split children share the parent's orders).
  const firstClose = new Map<string, string | null>();
  for (const b of bills.filter(x => x.state.status === 'closed').sort((x, y) => String(x.state.closedAt).localeCompare(String(y.state.closedAt))))
    for (const id of (b.state.orderIds ?? []) as string[]) if (!firstClose.has(id)) firstClose.set(id, dayOf(b.state.closedAt, tz));
  const units = new Map<string, { itemId: string; name: string; quantity: bigint }>();
  for (const order of ofKind(s, 'order').filter(o => firstClose.get(o.ref.id) === date)) for (const l of (order.state.lines ?? []) as JsonObject[]) {
    const id = String(l.itemId ?? l.name), u = units.get(id) ?? { itemId: id, name: String(l.name ?? id), quantity: 0n };
    u.quantity += big(l.quantity) - big(l.cancelledQuantity); units.set(id, u);
  }
  // Reconciliation is per bill, not per payment day: the bills closed on this date against every payment/refund on THOSE bills, whenever it happened
  // (a payment at 23:50 on a bill closed at 00:10 belongs to the closing day). At close a bill satisfies paid - refunded = total, so afterwards
  // collected = total - refunds recorded after close; any other difference is a ledger inconsistency to investigate.
  const closedIds = new Set(closed.map(b => b.ref.id)), onClosed = (x: Snapshot) => closedIds.has(String(x.state.billId));
  const billRefunds = ofKind(s, 'refund').filter(onClosed), applied = (r: Snapshot) => r.state.appliedMinor ?? r.state.amountMinor;
  const expectedMinor = String(big(salesTotalMinor) - big(sumOf(billRefunds.filter(r => r.state.billStatus === 'closed'), applied)));
  const collectedMinor = String(big(sumOf(ofKind(s, 'payment').filter(p => p.state.status === 'captured' && onClosed(p)), p => p.state.appliedMinor)) - big(sumOf(billRefunds, applied)) + big(sumOf(receipts, r => r.state.paidCashMinor)));
  const late = (kind: string, x: Snapshot, amountMinor: unknown, businessDate: string, effectiveAt: unknown, appliedAt: unknown, reason?: unknown) => {
    const appliedBusinessDate = dayOf(appliedAt, tz);
    return appliedBusinessDate && appliedBusinessDate > businessDate ? [{ kind, id: x.ref.id, amountMinor: String(amountMinor), businessDate, effectiveAt: String(effectiveAt ?? ''), appliedAt: String(appliedAt), appliedBusinessDate, ...(reason ? { reason: String(reason) } : {}) }] : [];
  };
  const lateAdjustments = [
    ...receipts.flatMap(r => late('historical-receipt', r, r.state.totalMinor, date, r.state.occurredAt, r.state.importedAt)),
    ...amendments.flatMap(a => late('historical-amendment', a, a.state.deltaMinor, date, a.state.occurredAt, a.state.recordedAt, a.state.reason)),
    ...payments.flatMap(p => late('payment', p, p.state.capturedMinor ?? p.state.amountMinor, date, p.state.occurredAt, paymentAppliedAt(p))),
    ...refunds.flatMap(r => late('refund', r, r.state.amountMinor, date, r.state.occurredAt, r.state.recordedAt, r.state.reason)),
  ];
  const row = (kind: string, x: Snapshot, effectiveAt: unknown, appliedAt: unknown, amountMinor: unknown, extra: JsonObject = {}): JsonObject => ({ kind, id: x.ref.id, businessDate: date, effectiveAt: String(effectiveAt ?? ''), appliedAt: String(appliedAt ?? ''), method: '', status: String(x.state.status ?? ''), amountMinor: String(amountMinor ?? '0'), reference: '', reason: '', ...extra });
  const rows = [
    ...closed.map(b => row('bill', b, b.state.closedAt, b.state.closedAt, b.state.totalMinor, { reference: String(b.state.parentBillId ?? ((b.state.mergedFrom ?? []) as string[]).join(' ')) })),
    ...payments.map(p => row('payment', p, p.state.occurredAt, paymentAppliedAt(p), p.state.status === 'captured' ? p.state.capturedMinor ?? p.state.appliedMinor : p.state.amountMinor, { method: String(p.state.method), reference: `${String(p.state.billId)} ${reference(p.state.reference)}`.trim() })),
    ...refunds.map(r => row('refund', r, r.state.occurredAt, r.state.recordedAt, r.state.amountMinor, { method: String(r.state.method), status: 'recorded', reference: `${String(r.state.paymentId)} ${String(r.state.evidenceRef ?? '')}`.trim(), reason: String(r.state.reason ?? '') })),
    ...receipts.map(r => row('historical-receipt', r, r.state.occurredAt, r.state.importedAt, r.state.totalMinor, { status: 'imported', reference: String(r.state.sourceKey ?? '') })),
    ...amendments.map(a => row('historical-amendment', a, a.state.occurredAt, a.state.recordedAt, a.state.deltaMinor, { status: 'amended', reference: String(a.state.receiptId), reason: String(a.state.reason ?? '') })),
  ];
  const open = bills.filter(b => b.state.status === 'prepared');
  return {
    netMinor, columns: SALES_COLUMNS,
    totals: { grossMinor, discountMinor, returnsMinor, netMinor, serviceMinor: part('serviceMinor'), taxMinor: part('taxMinor'), taxIncludedMinor: part('taxIncludedMinor'), salesTotalMinor, feesMinor: sumOf(captured, p => p.state.feeMinor), unappliedMinor: sumOf(captured, p => p.state.unappliedMinor) },
    bills: { closed: closed.length, voided: bills.filter(b => b.state.status === 'voided' && on(b.state.voidedAt)).length, open: open.length, openTotalMinor: sumOf(open, b => b.state.totalMinor) },
    // payments/refunds below are by their own occurredAt day (cash-flow view); reconciliation above joins them to the bills closed on this day
    paymentsBasis: 'occurredAt', payments: byMethod, refunds: refundsByMethod,
    cash: { appliedMinor: sumOf(captured.filter(p => p.state.method === 'cash'), p => p.state.appliedMinor), tenderedMinor: byMethod.find(m => m.method === 'cash')?.tenderedMinor ?? '0', changeMinor: byMethod.find(m => m.method === 'cash')?.changeMinor ?? '0', refundedMinor: refundsByMethod.find(m => m.method === 'cash')?.amountMinor ?? '0' },
    // pending/unknown external charges are real states, never counted as money; a guest's "I paid" claim is not a payment
    unresolved: { payments: payments.filter(p => ['pending', 'unknown'].includes(String(p.state.status))).map(p => ({ id: p.ref.id, method: String(p.state.method), status: String(p.state.status), amountMinor: String(p.state.amountMinor ?? '0') })), failedPayments: payments.filter(p => p.state.status === 'failed').length, unverifiedClaims: ofKind(s, 'payment-observation').filter(o => o.state.status === 'unverified' && on(o.state.occurredAt)).length },
    historical: { count: receipts.length, totalMinor: imported, paidCashMinor: sumOf(receipts, r => r.state.paidCashMinor), amendmentMinor: amended },
    units: [...units.values()].filter(u => u.quantity !== 0n).sort((a, b) => a.itemId.localeCompare(b.itemId)).map(u => ({ ...u, quantity: String(u.quantity) })),
    reconciliation: { basis: 'bills closed on this date, payments and refunds joined by bill', expectedMinor, collectedMinor, differenceMinor: String(big(expectedMinor) - big(collectedMinor)) },
    undatedFacts: [...undatedFacts(bills.filter(b => b.state.status === 'closed'), b => b.state.closedAt, tz), ...undatedFacts(ofKind(s, 'payment'), p => p.state.occurredAt, tz), ...undatedFacts(ofKind(s, 'refund'), r => r.state.occurredAt, tz),
      ...ofKind(s, 'historical-receipt').filter(r => receiptDay(r, tz) === null).map(r => ({ kind: r.ref.kind, id: r.ref.id, at: String(r.state.occurredAt ?? '') }))],
    lateAdjustments, rows,
  };
}
