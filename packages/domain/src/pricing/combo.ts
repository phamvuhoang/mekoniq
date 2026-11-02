import type { JsonObject } from '../../../contracts/src/index';
import { allocateMinor } from '../shared/money';
export type ComboPart = { itemId: string; name: string; stationId: string; quantity: string; shareMinor: string; discountMinor: string };
/**
 * The parts of a combo line, frozen at quote time: the line's price and its discount are each split across the components in proportion to their standalone list price (largest
 * remainder, so both sums are exact); zero list prices split evenly. Stock mapping, station routing and a single-part refund all read these shares, never today's menu.
 */
export function comboComponents(combo: JsonObject, catalog: JsonObject[], count: number | string, grossMinor: string, discountMinor: string): ComboPart[] {
  const n = BigInt(count), parts = ((combo.combo as JsonObject).components as JsonObject[]).map(c => {
    const item = catalog.find(x => x.id === c.itemId) ?? {}, quantity = BigInt(String(c.quantity)) * n;
    return { itemId: String(c.itemId), name: String(item.name ?? c.itemId), stationId: String(item.stationId ?? ''), quantity, weight: BigInt(String(item.unitMinor ?? '0')) * quantity };
  });
  const weights = parts.every(p => p.weight === 0n) ? parts.map(() => 1n) : parts.map(p => p.weight);
  const shares = allocateMinor(grossMinor, weights), shareWeights = shares.map(BigInt), discounts = allocateMinor(discountMinor, shareWeights.some(x => x > 0n) ? shareWeights : weights);
  return parts.map((p, i) => ({ itemId: p.itemId, name: p.name, stationId: p.stationId, quantity: String(p.quantity), shareMinor: shares[i]!, discountMinor: discounts[i]! }));
}
/** What refunding one component of a combo line returns: its share of the price after its share of the discount. */
export function componentRefundMinor(line: { components: ComboPart[] }, itemId: string): string {
  const part = line.components.find(p => p.itemId === itemId);
  if (!part) throw new Error('COMPONENT_NOT_FOUND');
  return String(BigInt(part.shareMinor) - BigInt(part.discountMinor));
}
