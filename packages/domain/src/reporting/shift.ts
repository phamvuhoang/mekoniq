import type { JsonObject } from '../../../contracts/src/index';
import type { Snapshot } from '../../../contracts/src/index';
import { shiftLedger } from '../cash/ledger';
import { big, dayOf, ofKind, paymentAppliedAt, sumOf, undatedFacts } from './sales';
const COLUMNS = ['kind', 'id', 'businessDate', 'cashierId', 'status', 'openedAt', 'closedAt', 'openingMinor', 'receiptsMinor', 'cashInMinor', 'cashOutMinor', 'refundsMinor', 'changeMinor', 'expectedMinor', 'countedMinor', 'varianceMinor', 'adjustmentMinor', 'approvedBy', 'reason'];
/**
 * Cash shifts opened on the business date. Expected cash is the cash ledger's own computation (cash/ledger.shiftLedger), never re-derived here.
 * A closed shift shows what was frozen at close; `recomputedExpectedMinor` re-reads the facts so drift is visible, and adjustments recorded after the
 * close are listed beside it (with their applied time), never folded into the closed figures.
 * Per method, every captured payment and refund carrying the shift's id is summed (non-cash tenders carry the shift open for the recording actor at
 * capture; non-cash refunds the shift of the payment they reverse); `late` counts those recorded after the shift closed. Payments/refunds of the day
 * that carry no shift (older facts, an actor without an open shift) are listed as unattributed, never dropped.
 */
export function shiftReport(s: Snapshot[], date: string, tz: string): JsonObject {
  const shifts = ofKind(s, 'shift').filter(x => dayOf(x.state.openedAt, tz) === date).sort((a, b) => String(a.state.openedAt).localeCompare(String(b.state.openedAt)));
  const rows = shifts.map(shift => {
    const L = shiftLedger(s, shift), closed = shift.state.status === 'closed', st = shift.state;
    const adjustments = ofKind(s, 'cash-movement').filter(m => m.state.shiftId === shift.ref.id && m.state.adjustment === true)
      .map(m => ({ id: m.ref.id, direction: String(m.state.direction), amountMinor: String(m.state.amountMinor), reason: String(m.state.reason ?? ''), actorRef: String(m.state.actorRef ?? ''), effectiveBusinessDate: date, appliedAt: String(m.state.recordedAt ?? ''), appliedBusinessDate: dayOf(m.state.recordedAt, tz) }));
    const variance = closed ? String(st.varianceMinor ?? '0') : null, closedAt = closed ? String(st.closedAt ?? '') : null, after = (at: unknown) => closedAt !== null && String(at ?? '') > closedAt;
    const pays = ofKind(s, 'payment').filter(p => p.state.shiftId === shift.ref.id && p.state.status === 'captured'), refunds = ofKind(s, 'refund').filter(r => r.state.shiftId === shift.ref.id);
    const methods = [...new Set([...pays, ...refunds].map(x => String(x.state.method)))].sort().map(method => {
      const p = pays.filter(x => x.state.method === method), r = refunds.filter(x => x.state.method === method);
      return { method, payments: p.length, capturedMinor: sumOf(p, x => x.state.capturedMinor ?? x.state.appliedMinor), appliedMinor: sumOf(p, x => x.state.appliedMinor), refunds: r.length, refundsMinor: sumOf(r, x => x.state.amountMinor),
        netMinor: String(big(sumOf(p, x => x.state.appliedMinor)) - big(sumOf(r, x => x.state.appliedMinor ?? x.state.amountMinor))), late: p.filter(x => after(paymentAppliedAt(x))).length + r.filter(x => after(x.state.recordedAt)).length };
    });
    return { id: shift.ref.id, cashierId: String(st.cashierId), status: String(st.status), currency: String(st.currency ?? 'VND'), openedAt: String(st.openedAt ?? ''), closedAt: closed ? String(st.closedAt ?? '') : null,
      openingMinor: String(L.opening), receiptsMinor: String(L.receipts), cashInMinor: String(L.in), cashOutMinor: String(L.out), refundsMinor: String(L.refunds), changeMinor: String(L.change),
      expectedMinor: closed ? String(st.expectedMinor) : L.expectedMinor, recomputedExpectedMinor: L.expectedMinor, countedMinor: closed ? String(st.countedMinor) : null, varianceMinor: variance,
      reconciled: closed && (big(variance) === 0n || typeof st.approvedBy === 'string'), approvedBy: (st.approvedBy ?? null) as string | null, varianceReason: (st.varianceReason ?? null) as string | null,
      adjustmentMinor: L.adjustmentMinor, adjustments, methods };
  });
  const closed = rows.filter(r => r.status === 'closed'), total = (k: 'expectedMinor' | 'countedMinor' | 'varianceMinor') => String(closed.reduce((a, r) => a + big(r[k]), 0n));
  return {
    columns: COLUMNS, shifts: rows,
    unattributed: [...ofKind(s, 'payment').filter(p => p.state.status === 'captured' && typeof p.state.shiftId !== 'string' && dayOf(p.state.occurredAt, tz) === date).map(p => ({ kind: 'payment', id: p.ref.id, method: String(p.state.method), amountMinor: String(p.state.appliedMinor ?? '0'), at: String(paymentAppliedAt(p) ?? '') })),
      ...ofKind(s, 'refund').filter(r => typeof r.state.shiftId !== 'string' && dayOf(r.state.occurredAt, tz) === date).map(r => ({ kind: 'refund', id: r.ref.id, method: String(r.state.method), amountMinor: String(r.state.amountMinor), at: String(r.state.recordedAt ?? '') }))],
    undatedFacts: undatedFacts(ofKind(s, 'shift'), x => x.state.openedAt, tz),
    totals: { shifts: rows.length, open: rows.length - closed.length, closed: closed.length, unreconciled: closed.filter(r => !r.reconciled).length, expectedMinor: total('expectedMinor'), countedMinor: total('countedMinor'), varianceMinor: total('varianceMinor'), adjustmentMinor: String(rows.reduce((a, r) => a + big(r.adjustmentMinor), 0n)) },
    rows: rows.map(r => ({ kind: 'shift', businessDate: date, ...r, reason: r.varianceReason ?? '', adjustments: undefined, methods: undefined })).map(r => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)) as JsonObject),
  };
}
