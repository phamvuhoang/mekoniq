import type { ModuleRegistry } from '../modules';
import type { CommandEnvelope, DomainEvent, JsonObject, Snapshot } from '../../../contracts/src/index';
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
/** Running stock levels of one decision: several consumptions in it (a combo's parts) may share an ingredient, and each ingredient is written back once. */
export type Levels = Map<string, JsonObject>;
export const levelEvents = (s: Snapshot[], levels: Levels): DomainEvent[] => [...levels].map(([id, next]) => changed('StockLevelChanged', find(s, 'stock-item', id)!, next));
export type ConsumeArgs = { source: string; version: string; portions: bigint; historical: boolean; meta?: JsonObject };
/**
 * One consumption: stock leaves at each recipe line's weighted-average cost. Throws DomainFault on a refusal. A historical source whose recipe is gone opens an exception
 * instead (today's recipe is never substituted for a past sale). The ingredient levels it changes are left in `levels`; the caller writes them back (levelEvents).
 */
export function consumeCore(c: CommandEnvelope, s: Snapshot[], levels: Levels, a: ConsumeArgs): { events: DomainEvent[]; value: JsonObject } {
  const { source, version, portions, historical } = a, id = sourceId('cons', source), existing = find(s, 'consumption', id);
  if (existing) return existing.state.recipeVersion === version && existing.state.portionsMilli === String(portions) ? { events: [], value: { consumptionId: id, duplicate: true } } : fail('SOURCE_CONSUMED_DIFFERENTLY');
  const exceptionId = sourceId('exc', source), recipe = version ? find(s, 'recipe', version) : undefined;
  const except = (reason: string): { events: DomainEvent[]; value: JsonObject } => find(s, 'stock-exception', exceptionId) ? { events: [], value: { exception: true, duplicate: true } } : { events: [created('StockExceptionOpened', 'stock-exception', exceptionId, { sourceEventId: source, recipeVersion: version, quantity: String(portions), reason, status: 'open', openedAt: c.occurredAt, ...(a.meta ?? {}) })], value: { exception: true, exceptionId } };
  if (!recipe) return historical ? except('RECIPE_VERSION_MISSING') : fail('RECIPE_NOT_FOUND');
  const lines = (recipe.state.lines as JsonObject[]).map(line => ({ line, item: find(s, 'stock-item', String(line.ingredientId)) }));
  if (lines.some(l => !l.item)) return historical ? except('INGREDIENT_MISSING') : fail('INGREDIENT_UNKNOWN');
  const events: DomainEvent[] = [], out: JsonObject[] = [], work = new Map(levels);
  for (const { line, item } of lines as { line: JsonObject; item: Snapshot }[]) {
    const qty = scaled(String(line.baseQuantity), portions), r = issue({ ...item.state, ...(work.get(item.ref.id) ?? {}) }, qty), mid = movementId(source, version, String(line.ingredientId), 'consume');
    out.push({ ingredientId: line.ingredientId, baseQuantity: String(qty), costMinor: String(r.costMinor), costKnown: r.costKnown, movementId: mid });
    events.push(created('StockMovementRecorded', 'stock-movement', mid, { kind: 'consume', ingredientId: line.ingredientId, sourceEventId: source, recipeVersion: version, deltaBase: String(-qty), costMinor: String(r.costMinor), costKnown: r.costKnown, seq: r.next.movementSeq!, negative: BigInt(String(r.next.onHand)) < 0n, actorRef: c.actorRef, occurredAt: c.occurredAt }));
    work.set(item.ref.id, r.next);
  }
  for (const [k, v] of work) levels.set(k, v); // only a fully costed consumption touches the shared levels
  events.unshift(created('StockConsumed', 'consumption', id, { sourceEventId: source, recipeVersion: version, itemId: recipe.state.itemId, portionsMilli: String(portions), portions: portionsOf(portions), wastedMilli: '0', lines: out, historical, actorRef: c.actorRef, occurredAt: c.occurredAt, ...(a.meta ?? {}) }));
  return { events, value: { consumptionId: id } };
}
/** Prepared food thrown away: reclassifies `qty` portions of a consumption as waste at the cost it left with. Nothing goes back on the shelf. */
export function preparedWaste(c: CommandEnvelope, cons: Snapshot, qty: bigint, source: string, reason: string): { events: DomainEvent[]; value: JsonObject } {
  const id = sourceId('wst', source), total = BigInt(String(cons.state.portionsMilli)), wasted = BigInt(String(cons.state.wastedMilli));
  const lines = (cons.state.lines as JsonObject[]).map(l => ({ ingredientId: l.ingredientId, baseQuantity: String(BigInt(String(l.baseQuantity)) * qty / total), costMinor: String((BigInt(String(l.costMinor)) * qty * 2n + total) / (2n * total)), costKnown: l.costKnown }));
  return { events: [created('StockWasted', 'stock-waste', id, { kind: 'prepared', sourceEventId: source, consumedSourceEventId: cons.state.sourceEventId, recipeVersion: cons.state.recipeVersion, quantityMilli: String(qty), lines: lines as JsonObject[], reason, actorRef: c.actorRef, occurredAt: c.occurredAt }),
    changed('ConsumptionWasteRecorded', cons, { wastedMilli: String(wasted + qty) })], value: { wasteId: id } };
}
export function registerConsumption(registry: ModuleRegistry): void {
  // Inventory.Consume {sourceEventId,recipeVersion|itemId,quantity:portions,historical?}: stock leaves once per source event (the kitchen-prepared event). The same source
  // replayed is a no-op; the same source with another recipe version / quantity is SOURCE_CONSUMED_DIFFERENTLY (never a second deduction). A historical source whose recipe
  // version is gone opens an exception — today's recipe is never substituted for a past sale.
  handle(registry, 'Inventory.Consume', (c, s) => {
    const source = text(c.payload.sourceEventId), portions = parse(c.payload.quantity), historical = c.payload.historical === true;
    if (portions <= 0n) return fail('INVALID_QUANTITY');
    const version = typeof c.payload.recipeVersion === 'string' ? c.payload.recipeVersion : String(find(s, 'recipe-pointer', text(c.payload.itemId, 'RECIPE_REQUIRED'))?.state.recipeVersion ?? ''), levels: Levels = new Map();
    const r = consumeCore(c, s, levels, { source, version, portions, historical });
    return done([...r.events, ...levelEvents(s, levels)], r.value);
  });
  // Inventory.ResolveException {exceptionId,disposition:'consume'|'waive',reason,expectedVersion}: closes a stock exception (cooked food whose stock could not be booked). `consume` books the
  // consumption now from the SAME source and recipe version (it fails again, visibly, while the stock is still short); `waive` closes it without any stock movement. Either way the
  // exception keeps its source, recipe and quantity, plus who closed it, why, and the consumption it became.
  handle(registry, 'Inventory.ResolveException', (c, s) => {
    const exc = find(s, 'stock-exception', text(c.payload.exceptionId)) ?? fail('NOT_FOUND'), reason = note(c.payload.reason, 'REASON_REQUIRED');
    const expected = c.expectedVersion ?? c.payload.expectedVersion;
    if (expected === undefined) return fail('VERSION_REQUIRED');
    if (expected !== exc.version) return fail('VERSION_CONFLICT');
    if (exc.state.status !== 'open') return fail('EXCEPTION_RESOLVED');
    const disposition = c.payload.disposition;
    if (disposition !== 'consume' && disposition !== 'waive') return fail('INVALID_DISPOSITION');
    const close = { status: 'resolved', disposition, resolvedBy: c.actorRef, resolvedAt: c.occurredAt, resolveReason: reason };
    if (disposition === 'waive') return done([changed('StockExceptionResolved', exc, close)], { exceptionId: exc.ref.id });
    const { sourceEventId, recipeVersion, quantity, status: _s, openedAt: _o, reason: _r, version: _v, wasteClaims: _w, ...meta } = exc.state; void [_s, _o, _r, _v, _w];
    const levels: Levels = new Map(), r = consumeCore(c, s, levels, { source: String(sourceEventId), version: String(recipeVersion), portions: BigInt(String(quantity)), historical: false, meta: meta as JsonObject });
    // food thrown away while its stock was still unbooked is classified as waste now, in the same decision that books the consumption (a consumption is created once, so this runs once)
    const claims = (exc.state.wasteClaims ?? []) as JsonObject[], booked = r.events[0];
    if (claims.length && booked && booked.type === 'StockConsumed') {
      const cons = { ref: { kind: 'consumption', id: sourceId('cons', String(sourceEventId)) }, state: (booked.data as { state: JsonObject }).state, version: 1 } as unknown as Snapshot;
      const wasted = claims.map(x => preparedWaste(c, cons, BigInt(String(x.portionsMilli)), String(x.source), String(x.reason)).events[0]!);
      (booked.data as { state: JsonObject }).state.wastedMilli = String(claims.reduce((a, x) => a + BigInt(String(x.portionsMilli)), 0n));
      r.events.push(...wasted);
    }
    return done([...r.events, ...levelEvents(s, levels), changed('StockExceptionResolved', exc, { ...close, consumptionId: sourceId('cons', String(sourceEventId)) })], { exceptionId: exc.ref.id });
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
      if (BigInt(String(cons.state.wastedMilli)) + qty > BigInt(String(cons.state.portionsMilli))) return fail('WASTE_EXCEEDS_CONSUMED');
      const r = preparedWaste(c, cons, qty, source, reason);
      return done(r.events, r.value);
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
