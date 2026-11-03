import type { CommandEnvelope, DomainEvent, JsonObject, Snapshot } from '../../../contracts/src/index';
import { all, created, DomainFault, find, requireFeature } from '../restaurant-context';
import { consumeCore, levelEvents, preparedWaste, type Levels } from './consumption';
import { sourceId } from './movement';
const big = (v: unknown): bigint => BigInt(String(v ?? '0'));
const inventoryOn = (c: CommandEnvelope, s: Snapshot[]): boolean => { try { requireFeature(c, s, 'inventory', 'finish_existing'); return true; } catch (e) { if (e instanceof DomainFault) return false; throw e; } };
/**
 * Stock leaves in the SAME decision as Kitchen.Ready (the kitchen cannot say "cooked" without the books saying what it cost): the ticket's item through its current recipe, and each
 * part of a combo through the part's own recipe (parts are frozen on the ticket). Source ids are the ticket + cumulative prepared count, so a replay is a no-op. Food that is already
 * cooked is never un-cooked by a refusal: a consumption that cannot be booked (blocked stock, missing ingredient) opens a stock exception and the ready event stands.
 */
export function consumeOnReady(c: CommandEnvelope, s: Snapshot[], ticket: Snapshot, ready: bigint, prepared: bigint): DomainEvent[] {
  if (!inventoryOn(c, s)) return [];
  const itemId = String(ticket.state.itemId ?? ''), ordered = big(ticket.state.quantity), base = `ready:${ticket.ref.id}:${prepared}`;
  const parts = ((ticket.state.components ?? []) as JsonObject[]).map(p => ({ itemId: String(p.itemId), perUnit: big(p.quantity) / (ordered || 1n) }));
  const targets = [{ itemId, source: base, perUnit: 1n, componentOf: undefined as string | undefined }, ...parts.map(p => ({ ...p, source: `${base}:${p.itemId}`, componentOf: p.itemId }))].filter(t => t.itemId);
  const levels: Levels = new Map(), events: DomainEvent[] = [];
  for (const t of targets) {
    const pointer = find(s, 'recipe-pointer', t.itemId);
    if (!pointer) continue; // an item without a recipe is not tracked
    const portions = ready * t.perUnit * 1000n;
    try {
      events.push(...consumeCore(c, s, levels, { source: t.source, version: String(pointer.state.recipeVersion), portions, historical: false, meta: { lineId: ticket.ref.id, ticketItemId: itemId, ...(t.componentOf ? { componentOf: t.componentOf } : {}), unitsMilli: String(ready * 1000n), preparedAfter: String(prepared) } }).events);
    } catch (e) {
      if (!(e instanceof DomainFault)) throw e;
      const id = sourceId('exc', t.source);
      if (!find(s, 'stock-exception', id)) events.push(created('StockExceptionOpened', 'stock-exception', id, { sourceEventId: t.source, recipeVersion: String(pointer.state.recipeVersion), quantity: String(portions), reason: e.message, status: 'open', openedAt: c.occurredAt, lineId: ticket.ref.id }));
    }
  }
  return [...events, ...levelEvents(s, levels)];
}
/**
 * Cooked food on a cancelled line was discarded: `count` line units are reclassified as prepared-food waste, newest ready batches first, in every consumption the line made
 * (the item itself and each combo part). Never restocks and never deducts again; a batch that was never consumed (no recipe, exception) simply has nothing to reclassify.
 */
export function wasteOnDispose(c: CommandEnvelope, s: Snapshot[], lineId: string, count: bigint, cancellationId: string, reason: string): DomainEvent[] {
  const consumptions = all(s, 'consumption').filter(x => x.state.lineId === lineId).sort((a, b) => Number(b.state.preparedAfter) - Number(a.state.preparedAfter) || a.ref.id.localeCompare(b.ref.id));
  const left = new Map<string, bigint>(), events: DomainEvent[] = [];
  for (const cons of consumptions) {
    const key = String(cons.state.componentOf ?? ''), units = big(cons.state.unitsMilli), perUnit = units > 0n ? big(cons.state.portionsMilli) / units : 1n;
    const want = left.get(key) ?? count * 1000n * perUnit, room = big(cons.state.portionsMilli) - big(cons.state.wastedMilli), take = want < room ? want : room;
    left.set(key, want - take);
    if (take > 0n) events.push(...preparedWaste(c, cons, take, `dispose:${cancellationId}:${String(cons.state.sourceEventId)}`, reason).events);
  }
  return events;
}
