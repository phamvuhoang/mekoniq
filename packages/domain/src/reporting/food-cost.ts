import type { JsonObject, Snapshot } from '../../../contracts/src/index';
import { big, dayOf, ofKind, salesReport, undatedFacts } from './sales';
import { movementValue } from './stock';
const COLUMNS = ['kind', 'id', 'businessDate', 'effectiveAt', 'itemId', 'recipeVersion', 'quantity', 'costMinor', 'costKnown', 'costEstimated', 'reference'];
/**
 * Food cost of the business date from the stock ledger: goods consumed by preparation (each consumption keeps the recipe version and the weighted-average cost it left at),
 * raw waste, and count adjustments. Prepared waste is shown but is already inside "consumed" (the stock left at preparation). Lines without a known cost are COUNTED
 * (`missingCostLines`), adjustments valued at an average are flagged `costEstimated` — a percentage is only given when there is a net sales figure to divide by.
 */
export function foodCostReport(s: Snapshot[], date: string, tz: string): JsonObject {
  const on = (at: unknown) => dayOf(at, tz) === date;
  const cons = ofKind(s, 'consumption').filter(c => on(c.state.occurredAt)), prepared = ofKind(s, 'stock-waste').filter(w => on(w.state.occurredAt));
  const exceptions = ofKind(s, 'stock-exception').filter(x => on(x.state.openedAt)), moves = ofKind(s, 'stock-movement').filter(m => on(m.state.occurredAt)), raw = moves.filter(m => m.state.kind === 'waste'), adj = moves.filter(m => m.state.kind === 'adjustment');
  const lines = (x: Snapshot) => (x.state.lines ?? []) as JsonObject[], cost = (x: Snapshot) => lines(x).reduce((a, l) => a + big(l.costMinor), 0n), known = (x: Snapshot) => lines(x).every(l => l.costKnown !== false);
  const row = (kind: string, x: Snapshot, effectiveAt: unknown, extra: JsonObject): JsonObject => ({ kind, id: x.ref.id, businessDate: date, effectiveAt: String(effectiveAt ?? ''), itemId: '', recipeVersion: '', quantity: '', costKnown: true, costEstimated: false, reference: String(x.state.sourceEventId ?? ''), ...extra });
  const rows = [
    ...cons.map(c => row('consumption', c, c.state.occurredAt, { itemId: String(c.state.itemId ?? ''), recipeVersion: String(c.state.recipeVersion), quantity: String(c.state.portions), costMinor: String(cost(c)), costKnown: known(c) })),
    ...prepared.map(w => row('waste-prepared', w, w.state.occurredAt, { recipeVersion: String(w.state.recipeVersion), quantity: String(Number(w.state.quantityMilli) / 1000), costMinor: String(cost(w)), costKnown: known(w), reference: String(w.state.consumedSourceEventId) })),
    ...raw.map(m => row('waste', m, m.state.occurredAt, { itemId: String(m.state.ingredientId), costMinor: String(-big(movementValue(m))), costKnown: m.state.costKnown !== false })),
    // cost of units sold before their stock arrived, learned when it did (the part of a receipt that repaid a negative balance)
    ...moves.filter(m => big(m.state.backfillMinor) > 0n).map(m => row('backfill', m, m.state.occurredAt, { itemId: String(m.state.ingredientId), costMinor: String(big(m.state.backfillMinor)) })),
    // cooked food whose stock could not be booked: listed with no cost until someone resolves it (consume = booked at that time's cost, waive = never costed)
    ...exceptions.map(x => row('stock-exception', x, x.state.openedAt, { itemId: String(x.state.ticketItemId ?? ''), recipeVersion: String(x.state.recipeVersion ?? ''), quantity: String(Number(x.state.quantity) / 1000), costMinor: '0', costKnown: x.state.status === 'resolved' && x.state.disposition === 'consume' })),
    ...adj.map(m => row('adjustment', m, m.state.occurredAt, { itemId: String(m.state.ingredientId), costMinor: String(-big(movementValue(m))), costKnown: m.state.costKnown !== false, costEstimated: m.state.costEstimated === true })),
  ];
  const sum = (kind: string) => rows.filter(r => r.kind === kind).reduce((a, r) => a + big(r.costMinor), 0n);
  const backfill = sum('backfill'), consumed = sum('consumption'), preparedWaste = sum('waste-prepared'), rawWaste = sum('waste'), adjustmentLoss = sum('adjustment'), foodCost = consumed + rawWaste + adjustmentLoss + backfill;
  const net = big((salesReport(s, date, tz).totals as JsonObject).netMinor);
  return { columns: COLUMNS, rows, totals: { consumedCostMinor: String(consumed), preparedWasteCostMinor: String(preparedWaste), rawWasteCostMinor: String(rawWaste), backfillCostMinor: String(backfill), openStockExceptions: exceptions.filter(x => x.state.status === 'open').length, wasteCostMinor: String(preparedWaste + rawWaste), adjustmentLossMinor: String(adjustmentLoss), foodCostMinor: String(foodCost),
    netSalesMinor: String(net), foodCostBasisPoints: net > 0n ? String((foodCost * 10000n * 2n + net) / (2n * net)) : null,
    missingCostLines: rows.filter(r => !r.costKnown).length, estimatedLines: rows.filter(r => r.costEstimated === true).length },
  basis: 'cost of goods consumed at the weighted-average cost on each stock movement; each consumption is matched to the recipe version it was prepared with',
  undatedFacts: [...undatedFacts(cons, c => c.state.occurredAt, tz), ...undatedFacts(moves, m => m.state.occurredAt, tz)] };
}
