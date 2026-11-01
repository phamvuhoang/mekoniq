import type { JsonObject } from '../../../contracts/src/index';
import type { Snapshot } from '../../../contracts/src/index';
import { shiftLedger } from '../cash/ledger';
import { big, dayOf, ofKind } from './sales';
const COLUMNS = ['kind', 'id', 'businessDate', 'cashierId', 'status', 'openedAt', 'closedAt', 'openingMinor', 'receiptsMinor', 'cashInMinor', 'cashOutMinor', 'refundsMinor', 'changeMinor', 'expectedMinor', 'countedMinor', 'varianceMinor', 'adjustmentMinor', 'approvedBy', 'reason'];
/**
 * Cash shifts opened on the business date. Expected cash is the cash ledger's own computation (cash/ledger.shiftLedger), never re-derived here.
 * A closed shift shows what was frozen at close; `recomputedExpectedMinor` re-reads the facts so drift is visible, and adjustments recorded after the
 * close are listed beside it (with their applied time), never folded into the closed figures.
 */
export function shiftReport(s: Snapshot[], date: string, tz: string): JsonObject {
  const shifts = ofKind(s, 'shift').filter(x => dayOf(x.state.openedAt, tz) === date).sort((a, b) => String(a.state.openedAt).localeCompare(String(b.state.openedAt)));
  const rows = shifts.map(shift => {
    const L = shiftLedger(s, shift), closed = shift.state.status === 'closed', st = shift.state;
    const adjustments = ofKind(s, 'cash-movement').filter(m => m.state.shiftId === shift.ref.id && m.state.adjustment === true)
      .map(m => ({ id: m.ref.id, direction: String(m.state.direction), amountMinor: String(m.state.amountMinor), reason: String(m.state.reason ?? ''), actorRef: String(m.state.actorRef ?? ''), effectiveBusinessDate: date, appliedAt: String(m.state.recordedAt ?? ''), appliedBusinessDate: dayOf(m.state.recordedAt, tz) }));
    const variance = closed ? String(st.varianceMinor ?? '0') : null;
    return { id: shift.ref.id, cashierId: String(st.cashierId), status: String(st.status), currency: String(st.currency ?? 'VND'), openedAt: String(st.openedAt ?? ''), closedAt: closed ? String(st.closedAt ?? '') : null,
      openingMinor: String(L.opening), receiptsMinor: String(L.receipts), cashInMinor: String(L.in), cashOutMinor: String(L.out), refundsMinor: String(L.refunds), changeMinor: String(L.change),
      expectedMinor: closed ? String(st.expectedMinor) : L.expectedMinor, recomputedExpectedMinor: L.expectedMinor, countedMinor: closed ? String(st.countedMinor) : null, varianceMinor: variance,
      reconciled: closed && (big(variance) === 0n || typeof st.approvedBy === 'string'), approvedBy: (st.approvedBy ?? null) as string | null, varianceReason: (st.varianceReason ?? null) as string | null,
      adjustmentMinor: L.adjustmentMinor, adjustments };
  });
  const closed = rows.filter(r => r.status === 'closed'), total = (k: 'expectedMinor' | 'countedMinor' | 'varianceMinor') => String(closed.reduce((a, r) => a + big(r[k]), 0n));
  return {
    columns: COLUMNS, shifts: rows,
    totals: { shifts: rows.length, open: rows.length - closed.length, closed: closed.length, unreconciled: closed.filter(r => !r.reconciled).length, expectedMinor: total('expectedMinor'), countedMinor: total('countedMinor'), varianceMinor: total('varianceMinor'), adjustmentMinor: String(rows.reduce((a, r) => a + big(r.adjustmentMinor), 0n)) },
    rows: rows.map(r => ({ kind: 'shift', businessDate: date, ...r, reason: r.varianceReason ?? '', adjustments: undefined })).map(r => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)) as JsonObject),
  };
}
