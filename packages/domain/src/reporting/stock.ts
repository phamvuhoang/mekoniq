import type { JsonObject, Snapshot } from '../../../contracts/src/index';
import { stockValuation } from '../inventory/valuation';
import { big, dayOf, ofKind, undatedFacts } from './sales';
const COLUMNS = ['kind', 'id', 'businessDate', 'effectiveAt', 'ingredientId', 'movementKind', 'deltaBase', 'valueMinor', 'costKnown', 'costEstimated', 'reference'];
/** Signed stock value of a movement: receipts/returns/adjustments carry `valueMinor`, consumption and waste carry the cost that left (`costMinor`). */
export const movementValue = (m: Snapshot): string => String(m.state.valueMinor === undefined ? (m.state.costMinor === undefined ? 0n : -big(m.state.costMinor)) : big(m.state.valueMinor) - big(m.state.backfillMinor)); // value that only repaid sold units is cost, not shelf value
/**
 * Stock movements of the business date, current balances at weighted-average value, and a ledger check per ingredient: onHand must equal the sum of ALL its movements
 * (`driftBase` ≠ 0 means a balance has no movement behind it — e.g. an opening balance loaded without a receipt — and is shown, never hidden).
 */
export function stockReport(s: Snapshot[], date: string, tz: string): JsonObject {
  const moves = ofKind(s, 'stock-movement'), day = moves.filter(m => dayOf(m.state.occurredAt, tz) === date).sort((a, b) => String(a.state.occurredAt).localeCompare(String(b.state.occurredAt)) || a.ref.id.localeCompare(b.ref.id));
  const rows = day.map(m => ({ kind: 'stock-movement', id: m.ref.id, businessDate: date, effectiveAt: String(m.state.occurredAt), ingredientId: String(m.state.ingredientId), movementKind: String(m.state.kind), deltaBase: String(m.state.deltaBase), valueMinor: movementValue(m), costKnown: m.state.costKnown !== false, costEstimated: m.state.costEstimated === true, reference: String(m.state.sourceEventId ?? '') }));
  const ledger = ofKind(s, 'stock-item').sort((a, b) => a.ref.id.localeCompare(b.ref.id)).map(i => {
    const sum = moves.filter(m => m.state.ingredientId === i.ref.id).reduce((a, m) => a + big(m.state.deltaBase), 0n);
    return { ingredientId: i.ref.id, onHand: String(i.state.onHand), movementSumBase: String(sum), driftBase: String(big(i.state.onHand) - sum) };
  });
  const byKind: Record<string, { count: number; valueMinor: string }> = {};
  for (const r of rows) { const k = byKind[r.movementKind] ?? { count: 0, valueMinor: '0' }; k.count++; k.valueMinor = String(big(k.valueMinor) + big(r.valueMinor)); byKind[r.movementKind] = k; }
  return { columns: COLUMNS, rows, balances: stockValuation(s), ledger, totals: { movements: rows.length, valueByKind: byKind as unknown as JsonObject, unbackedBalances: ledger.filter(l => l.driftBase !== '0').length, missingCostMovements: rows.filter(r => !r.costKnown).length },
    basis: 'stock movements on the venue business date; balances are current at weighted-average cost', undatedFacts: undatedFacts(moves, m => m.state.occurredAt, tz) };
}
