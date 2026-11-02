import type { ModuleRegistry } from '../modules';
import type { JsonObject, Snapshot } from '../../../contracts/src/index';
import { changed, created, done, fail, find, handle, note, text } from '../restaurant-context';
import { issue, movementId, sourceId, toBase } from './movement';
import { milli } from './uom';
const parse = (v: unknown): bigint => { try { return milli(v); } catch (e) { return fail((e as Error).message); } };
const portionsOf = (milliPortions: bigint): string => `${milliPortions / 1000n}${milliPortions % 1000n ? '.' + String(milliPortions % 1000n).padStart(3, '0').replace(/0+$/, '') : ''}`;
/** line base quantity per portion x portions, exact in whole base units */
function scaled(baseQuantity: string, portionsMilli: bigint): bigint {
  const total = BigInt(baseQuantity) * portionsMilli;
  if (total % 1000n !== 0n) return fail('INEXACT_QUANTITY');
  return total / 1000n;
}
export function registerConsumption(registry: ModuleRegistry): void {
  // Inventory.Consume {sourceEventId,recipeVersion|itemId,quantity:portions,historical?}: stock leaves once per source event (the kitchen-prepared event). The same source
  // replayed is a no-op; the same source with another recipe version / quantity is SOURCE_CONSUMED_DIFFERENTLY (never a second deduction). A historical source whose recipe
  // version is gone opens an exception — today's recipe is never substituted for a past sale.
  handle(registry, 'Inventory.Consume', (c, s) => {
    const source = text(c.payload.sourceEventId), portions = parse(c.payload.quantity), historical = c.payload.historical === true;
    if (portions <= 0n) return fail('INVALID_QUANTITY');
    const version = typeof c.payload.recipeVersion === 'string' ? c.payload.recipeVersion : String(find(s, 'recipe-pointer', text(c.payload.itemId, 'RECIPE_REQUIRED'))?.state.recipeVersion ?? '');
    const id = sourceId('cons', source), existing = find(s, 'consumption', id);
    if (existing) return existing.state.recipeVersion === version && existing.state.portionsMilli === String(portions) ? done([], { consumptionId: id, duplicate: true }) : fail('SOURCE_CONSUMED_DIFFERENTLY');
    const exceptionId = sourceId('exc', source);
    const recipe = version ? find(s, 'recipe', version) : undefined;
    const except = (reason: string) => find(s, 'stock-exception', exceptionId) ? done([], { exception: true, duplicate: true }) : done([created('StockExceptionOpened', 'stock-exception', exceptionId, { sourceEventId: source, recipeVersion: version, quantity: String(portions), reason, status: 'open', openedAt: c.occurredAt })], { exception: true, exceptionId });
    if (!recipe) return historical ? except('RECIPE_VERSION_MISSING') : fail('RECIPE_NOT_FOUND');
    const lines = (recipe.state.lines as JsonObject[]).map(line => ({ line, item: find(s, 'stock-item', String(line.ingredientId)) }));
    if (lines.some(l => !l.item)) return historical ? except('INGREDIENT_MISSING') : fail('INGREDIENT_UNKNOWN');
    const events = [], out: JsonObject[] = [];
    for (const { line, item } of lines as { line: JsonObject; item: Snapshot }[]) {
      const qty = scaled(String(line.baseQuantity), portions), r = issue(item.state, qty), mid = movementId(source, version, String(line.ingredientId), 'consume');
      out.push({ ingredientId: line.ingredientId, baseQuantity: String(qty), costMinor: String(r.costMinor), costKnown: r.costKnown, movementId: mid });
      events.push(created('StockMovementRecorded', 'stock-movement', mid, { kind: 'consume', ingredientId: line.ingredientId, sourceEventId: source, recipeVersion: version, deltaBase: String(-qty), costMinor: String(r.costMinor), costKnown: r.costKnown, seq: r.next.movementSeq!, negative: BigInt(String(r.next.onHand)) < 0n, actorRef: c.actorRef, occurredAt: c.occurredAt }), changed('StockLevelChanged', item, r.next));
    }
    return done([created('StockConsumed', 'consumption', id, { sourceEventId: source, recipeVersion: version, itemId: recipe.state.itemId, portionsMilli: String(portions), portions: portionsOf(portions), wastedMilli: '0', lines: out, historical, actorRef: c.actorRef, occurredAt: c.occurredAt }), ...events], { consumptionId: id });
  });
  // Inventory.RecordWaste: (a) {sourceEventId,ingredientId,quantity,unit?,reason}: raw loss (spoilage) deducts stock; (b) {sourceEventId,consumedSourceEventId,quantity:portions,reason}:
  // a dish that was already prepared is cancelled/thrown away. The stock left at preparation, so this reclassifies cost as waste and NEVER puts anything back.
  handle(registry, 'Inventory.RecordWaste', (c, s) => {
    const source = text(c.payload.sourceEventId), reason = note(c.payload.reason, 'REASON_REQUIRED');
    if (typeof c.payload.consumedSourceEventId === 'string') {
      const cons = find(s, 'consumption', sourceId('cons', c.payload.consumedSourceEventId)), qty = parse(c.payload.quantity), id = sourceId('wst', source);
      if (!cons) return fail('CONSUMPTION_NOT_FOUND');
      if (qty <= 0n) return fail('INVALID_QUANTITY');
      const prior = find(s, 'stock-waste', id);
      if (prior) return prior.state.quantityMilli === String(qty) && prior.state.consumedSourceEventId === c.payload.consumedSourceEventId ? done([], { wasteId: id, duplicate: true }) : fail('SOURCE_CONSUMED_DIFFERENTLY');
      const total = BigInt(String(cons.state.portionsMilli)), wasted = BigInt(String(cons.state.wastedMilli));
      if (wasted + qty > total) return fail('WASTE_EXCEEDS_CONSUMED');
      const lines = (cons.state.lines as JsonObject[]).map(l => ({ ingredientId: l.ingredientId, baseQuantity: String(BigInt(String(l.baseQuantity)) * qty / total), costMinor: String((BigInt(String(l.costMinor)) * qty * 2n + total) / (2n * total)), costKnown: l.costKnown }));
      return done([created('StockWasted', 'stock-waste', id, { kind: 'prepared', sourceEventId: source, consumedSourceEventId: c.payload.consumedSourceEventId, recipeVersion: cons.state.recipeVersion, quantityMilli: String(qty), lines: lines as JsonObject[], reason, actorRef: c.actorRef, occurredAt: c.occurredAt }),
        changed('ConsumptionWasteRecorded', cons, { wastedMilli: String(wasted + qty) })], { wasteId: id });
    }
    const ingredientId = text(c.payload.ingredientId), item = find(s, 'stock-item', ingredientId) ?? fail('INGREDIENT_UNKNOWN');
    const mid = movementId(source, 'raw', ingredientId, 'waste'), base = toBase(item.state, text(c.payload.quantity, 'INVALID_QUANTITY'), c.payload.unit === undefined ? undefined : text(c.payload.unit, 'UNKNOWN_UNIT'));
    if (BigInt(base) <= 0n) return fail('INVALID_QUANTITY');
    const prior = find(s, 'stock-movement', mid);
    if (prior) return prior.state.deltaBase === `-${base}` ? done([], { wasteId: mid, duplicate: true }) : fail('SOURCE_CONSUMED_DIFFERENTLY');
    const r = issue(item.state, BigInt(base));
    return done([created('StockWasted', 'stock-movement', mid, { kind: 'waste', ingredientId, sourceEventId: source, deltaBase: `-${base}`, costMinor: String(r.costMinor), costKnown: r.costKnown, seq: r.next.movementSeq!, negative: BigInt(String(r.next.onHand)) < 0n, reason, actorRef: c.actorRef, occurredAt: c.occurredAt }), changed('StockLevelChanged', item, r.next)], { wasteId: mid });
  });
}
