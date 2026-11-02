import type { ModuleRegistry } from '../modules';
import type { DomainEvent, JsonObject, Snapshot } from '../../../contracts/src/index';
import { changed, created, done, expectVersion, fail, find, handle, text, all } from '../restaurant-context';
import { movementId, toBase } from './movement';
import { adjust } from './adjustment';
/** Counted minus what the ledger said at the count checkpoint: the sheet records a difference, never a new absolute quantity. */
export function stocktakeAdjustment(s: { atCheckpoint: string; counted: string }) {
  return String(BigInt(s.counted) - BigInt(s.atCheckpoint));
}
/** The delta joins the CURRENT balance, so sales and receipts after the checkpoint are preserved. */
export function applyAdjustment(s: { current: string; delta: string }) {
  return String(BigInt(s.current) + BigInt(s.delta));
}
type SheetItem = { ingredientId: string; atCheckpoint: string; checkpointSeq: number; counted?: string; delta?: string; reasonCode?: string; evidence?: string; needsReview?: boolean; countedBy?: string; countedAt?: string; recounts?: number; applied?: boolean };
const REASONS = ['waste', 'spoilage', 'count_correction'];
const CLOCK_SKEW_MS = 5 * 60 * 1000;
export function registerStocktake(registry: ModuleRegistry): void {
  // Stocktake.Open {stocktakeId,ingredientIds?}: freezes each ingredient's balance and movement sequence — the checkpoint the counters' numbers refer to.
  handle(registry, 'Stocktake.Open', (c, s) => {
    const id = text(c.payload.stocktakeId);
    if (find(s, 'stocktake', id)) return fail('STOCKTAKE_EXISTS');
    const wanted = Array.isArray(c.payload.ingredientIds) ? c.payload.ingredientIds.map(v => text(v)) : all(s, 'stock-item').map(i => i.ref.id);
    if (!wanted.length) return fail('NO_INGREDIENTS');
    const items = wanted.map((ingredientId): JsonObject => { const i = find(s, 'stock-item', ingredientId) ?? fail('INGREDIENT_UNKNOWN'); return { ingredientId, atCheckpoint: String(i.state.onHand), checkpointSeq: Number(i.state.movementSeq) }; });
    return done([created('StocktakeOpened', 'stocktake', id, { status: 'open', items, openedBy: c.actorRef, openedAt: c.occurredAt })], { stocktakeId: id });
  });
  // Stocktake.Count {stocktakeId,ingredientId,counted,unit?,reasonCode?,evidence?,clockConfidence?,expectedVersion}: a recount replaces the number while the sheet is open.
  handle(registry, 'Stocktake.Count', (c, s) => {
    const sheet = find(s, 'stocktake', text(c.payload.stocktakeId)) ?? fail('NOT_FOUND');
    if (sheet.state.status !== 'open') return fail('STOCKTAKE_NOT_OPEN');
    expectVersion(c, sheet);
    const items = sheet.state.items as unknown as SheetItem[], target = items.find(i => i.ingredientId === c.payload.ingredientId) ?? fail('ITEM_NOT_ON_SHEET'), stock = find(s, 'stock-item', target.ingredientId) ?? fail('INGREDIENT_UNKNOWN');
    const counted = toBase(stock.state, text(c.payload.counted, 'INVALID_QUANTITY'), c.payload.unit === undefined ? undefined : text(c.payload.unit, 'UNKNOWN_UNIT'));
    const reasonCode = String(c.payload.reasonCode ?? 'count_correction');
    if (!REASONS.includes(reasonCode)) return fail('REASON_CODE_INVALID');
    const evidence = c.payload.evidence === undefined ? undefined : text(c.payload.evidence, 'EVIDENCE_INVALID');
    if (target.counted === counted && target.reasonCode === reasonCode && target.evidence === evidence) return done([], { duplicate: true });
    const skewed = !(Math.abs(Date.parse(c.recordedAt) - Date.parse(c.occurredAt)) <= CLOCK_SKEW_MS);
    const next: SheetItem = { ...target, counted, delta: stocktakeAdjustment({ atCheckpoint: target.atCheckpoint, counted }), reasonCode, ...(evidence ? { evidence } : {}), needsReview: c.payload.clockConfidence === 'low' || skewed, countedBy: c.actorRef, countedAt: c.occurredAt, recounts: (target.recounts ?? 0) + (target.counted === undefined ? 0 : 1) };
    return done([changed('StocktakeCounted', sheet, { items: items.map(i => i === target ? next : i) as unknown as JsonObject[] })], { stocktakeId: sheet.ref.id });
  });
  // Stocktake.Approve {stocktakeId,expectedVersion,acknowledgeReview?}: approves exactly the sheet version the approver saw. By default the opener and the counters cannot approve their own sheet.
  handle(registry, 'Stocktake.Approve', (c, s) => {
    const sheet = find(s, 'stocktake', text(c.payload.stocktakeId)) ?? fail('NOT_FOUND'); expectVersion(c, sheet);
    if (sheet.state.status !== 'open') return fail('STOCKTAKE_STATE_CONFLICT');
    const items = (sheet.state.items as unknown as SheetItem[]).filter(i => i.counted !== undefined);
    if (!items.length) return fail('NOTHING_COUNTED');
    const separate = find(s, 'inventory-policy', 'current')?.state.separateApproval !== false;
    if (separate && (sheet.state.openedBy === c.actorRef || items.some(i => i.countedBy === c.actorRef))) return fail('SELF_APPROVAL_FORBIDDEN');
    if (items.some(i => i.needsReview) && c.payload.acknowledgeReview !== true) return fail('REVIEW_REQUIRED');
    return done([changed('StocktakeApproved', sheet, { status: 'approved', approvedBy: c.actorRef, approvedAt: c.occurredAt })], { stocktakeId: sheet.ref.id });
  });
  // Stocktake.Apply {stocktakeId,expectedVersion,ingredientIds?}: appends one adjustment movement per counted item (delta at the checkpoint, added to the current balance). Items already applied
  // are skipped, so an interrupted apply is finished by running it again; the sheet becomes `applied` when every counted item is.
  handle(registry, 'Stocktake.Apply', (c, s) => {
    const sheet = find(s, 'stocktake', text(c.payload.stocktakeId)) ?? fail('NOT_FOUND'); expectVersion(c, sheet);
    if (sheet.state.status !== 'approved') return fail('STOCKTAKE_STATE_CONFLICT');
    const only = Array.isArray(c.payload.ingredientIds) ? new Set(c.payload.ingredientIds.map(v => text(v))) : undefined;
    const events: DomainEvent[] = [], items = sheet.state.items as unknown as SheetItem[];
    const next = items.map(i => {
      if (i.counted === undefined || i.applied || (only && !only.has(i.ingredientId))) return i;
      if (BigInt(String(i.delta)) !== 0n) {
        const item: Snapshot = find(s, 'stock-item', i.ingredientId) ?? fail('INGREDIENT_UNKNOWN'), r = adjust(item.state, BigInt(String(i.delta))), mid = movementId(sheet.ref.id, i.ingredientId, 'adjustment');
        events.push(created('StockAdjusted', 'stock-movement', mid, { kind: 'adjustment', ingredientId: i.ingredientId, sourceEventId: sheet.ref.id, deltaBase: i.delta!, valueMinor: String(r.valueMinor), costKnown: r.costKnown, costEstimated: r.estimated, reasonCode: i.reasonCode!, seq: r.next.movementSeq!, atCheckpoint: i.atCheckpoint, counted: i.counted, actorRef: c.actorRef, occurredAt: c.occurredAt }), changed('StockLevelChanged', item, r.next));
      }
      return { ...i, applied: true };
    });
    const finished = next.every(i => i.counted === undefined || i.applied);
    return done([changed('StocktakeApplied', sheet, { items: next as unknown as JsonObject[], status: finished ? 'applied' : 'approved', ...(finished ? { appliedBy: c.actorRef, appliedAt: c.occurredAt } : {}) }), ...events], { stocktakeId: sheet.ref.id, applied: finished });
  });
}
