import type { CommandEnvelope, DomainEvent, JsonObject, Snapshot } from '../../../contracts/src/index';
import { all, changed, created, DomainFault, find, requireFeature } from '../restaurant-context';
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
  const itemId = String(ticket.state.itemId ?? ''), root = String(ticket.state.lineId ?? ticket.ref.id), base = `ready:${ticket.ref.id}:${prepared}`;
  // The parts' quantity per ONE combo is frozen on the ticket (perUnit), so cancelling some combos later never changes what one combo uses.
  const whole = ticket.state.stockMode === 'whole';
  const parts = whole ? [] : ((ticket.state.components ?? []) as JsonObject[]).map(p => ({ itemId: String(p.itemId), perUnit: big(p.perUnit ?? 1) }));
  const targets = [{ itemId, source: base, perUnit: 1n, componentOf: undefined as string | undefined }, ...parts.map(p => ({ ...p, source: `${base}:${p.itemId}`, componentOf: p.itemId }))].filter(t => t.itemId);
  const levels: Levels = new Map(), events: DomainEvent[] = [];
  for (const t of targets) {
    const pointer = find(s, 'recipe-pointer', t.itemId);
    if (!pointer) continue; // an item without a recipe is not tracked (that is different from a recipe that failed: see the exception below)
    const portions = ready * t.perUnit * 1000n, meta: JsonObject = { lineId: root, ticketId: ticket.ref.id, ticketItemId: t.itemId, ...(t.componentOf ? { componentOf: t.componentOf } : {}), unitsMilli: String(ready * 1000n), preparedAfter: String(prepared) };
    try {
      events.push(...consumeCore(c, s, levels, { source: t.source, version: String(pointer.state.recipeVersion), portions, historical: false, meta }).events);
    } catch (e) {
      if (!(e instanceof DomainFault)) throw e;
      const id = sourceId('exc', t.source);
      if (!find(s, 'stock-exception', id)) events.push(created('StockExceptionOpened', 'stock-exception', id, { sourceEventId: t.source, recipeVersion: String(pointer.state.recipeVersion), quantity: String(portions), reason: e.message, status: 'open', openedAt: c.occurredAt, ...meta }));
    }
  }
  return [...events, ...levelEvents(s, levels)];
}
/**
 * Cooked food on a cancelled line was discarded: `count` line units are reclassified as prepared-food waste, newest ready batches first, in every consumption the line (or one station's
 * ticket, when given) made: the item itself and each combo part. Never restocks and never deducts again. A batch whose stock could not be booked yet (an open stock exception) cannot be
 * reclassified now, so the discard is noted on the exception (wasteClaims) and booked as waste in the same decision that books the consumption (Inventory.ResolveException).
 */
export function wasteOnDispose(c: CommandEnvelope, s: Snapshot[], lineId: string, count: bigint, cancellationId: string, reason: string, ticketId?: string): DomainEvent[] {
  const mine = (x: Snapshot) => x.state.lineId === lineId && (ticketId === undefined || x.state.ticketId === ticketId);
  const batches = [...all(s, 'consumption').filter(mine), ...all(s, 'stock-exception').filter(x => mine(x) && x.state.status === 'open')]
    .sort((a, b) => Number(b.state.preparedAfter) - Number(a.state.preparedAfter) || a.ref.id.localeCompare(b.ref.id));
  const left = new Map<string, bigint>(), events: DomainEvent[] = [];
  for (const batch of batches) {
    const booked = batch.ref.kind === 'consumption', key = String(batch.state.componentOf ?? ''), units = big(batch.state.unitsMilli), size = big(booked ? batch.state.portionsMilli : batch.state.quantity);
    const perUnit = units > 0n ? size / units : 1n, claims = (batch.state.wasteClaims ?? []) as JsonObject[];
    const want = left.get(key) ?? count * 1000n * perUnit, room = size - (booked ? big(batch.state.wastedMilli) : claims.reduce((a, x) => a + big(x.portionsMilli), 0n)), take = want < room ? want : room;
    left.set(key, want - take);
    if (take <= 0n) continue;
    const source = `dispose:${cancellationId}:${String(batch.state.sourceEventId)}`;
    events.push(...(booked ? preparedWaste(c, batch, take, source, reason).events : [changed('StockExceptionWasteNoted', batch, { wasteClaims: [...claims, { source, portionsMilli: String(take), reason, cancellationId }] })]));
  }
  return events;
}
