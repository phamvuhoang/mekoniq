import type { JsonObject } from '../../../contracts/src/index';
import { allocateMinor } from '../shared/money';
export type ComboPart = { itemId: string; name: string; stationId: string; quantity: string; shareMinor: string; discountMinor: string };
/**
 * Splits a combo's price and discount over its parts TOGETHER: the discount over `dw`, the net (price - discount) over `nw`, and a part's price share is its net plus its discount. So no part
 * ever has a discount above its price share (a negative refund), and the sums are exact.
 */
function dealParts(gross: bigint, discount: bigint, nw: bigint[], dw: bigint[]): [string[], string[]] {
  const positive = (w: bigint[]) => w.some(x => x > 0n) ? w : w.map(() => 1n), disc = allocateMinor(String(discount), positive(dw)), net = allocateMinor(String(gross - discount), positive(nw));
  return [net.map((n, i) => String(BigInt(n) + BigInt(disc[i]!))), disc];
}
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
  const [shares, discounts] = dealParts(BigInt(grossMinor), BigInt(discountMinor), weights, weights);
  return parts.map((p, i) => ({ itemId: p.itemId, name: p.name, stationId: p.stationId, quantity: String(p.quantity), shareMinor: shares[i]!, discountMinor: discounts[i]! }));
}
/** What refunding one component of a combo line returns: its share of the price after its share of the discount. */
export function componentRefundMinor(line: { components: ComboPart[] }, itemId: string): string {
  const part = line.components.find(p => p.itemId === itemId);
  if (!part) throw new Error('COMPONENT_NOT_FOUND');
  return String(BigInt(part.shareMinor) - BigInt(part.discountMinor));
}

const nonNeg = (v: unknown): bigint => BigInt(String(v ?? '0'));
/**
 * The parts of a combo line AS SOLD NOW: the frozen parts are for `comboCount` combos at the quoted price; what is live is the line's net value (cancellations removed) and its live
 * quantity. When the parts already add up to the live line (a split child carries its own frozen share) they are kept as they are; otherwise part shares and discounts are re-allocated
 * over the frozen proportions by largest remainder, so the live parts always add up to the live line.
 */
export function liveComponents(line: JsonObject): ComboPart[] {
  const parts = (line.components ?? []) as unknown as ComboPart[];
  if (!parts.length) return [];
  const count = nonNeg(line.comboCount ?? line.quantity) || 1n, live = nonNeg(line.quantity) - nonNeg(line.cancelledQuantity);
  const net = (key: string, fallback?: string) => nonNeg(line[key] ?? (fallback ? line[fallback] : 0)) - nonNeg((line.cancelled as JsonObject | undefined)?.[key]);
  const sub = net('subtotalMinor', 'totalMinor'), disc = net('discountMinor'), sum = (key: 'shareMinor' | 'discountMinor') => parts.reduce((a, p) => a + nonNeg(p[key]), 0n);
  const scale = (p: ComboPart) => String(nonNeg(p.quantity) * live / count);
  if (sum('shareMinor') === sub && sum('discountMinor') === disc) return parts.map(p => ({ ...p, quantity: scale(p) }));
  const [shares, discounts] = dealParts(sub, disc, parts.map(p => nonNeg(p.shareMinor) - nonNeg(p.discountMinor)), parts.map(p => nonNeg(p.discountMinor)));
  return parts.map((p, i) => ({ ...p, quantity: scale(p), shareMinor: shares[i]!, discountMinor: discounts[i]! }));
}
/** What refunding one combo part returns: its share of the price after its share of the discount. Lines that share an id (a split-then-merged bill) are one source: their parts add up. */
export type RefundablePart = { lineId: string; itemId: string; name: string; minor: string };
export function refundableComponents(lines: JsonObject[]): RefundablePart[] {
  const out = new Map<string, RefundablePart>();
  for (const line of lines) for (const p of liveComponents(line)) {
    const key = `${String(line.id)}\u0000${p.itemId}`, prior = out.get(key);
    out.set(key, { lineId: String(line.id), itemId: p.itemId, name: p.name, minor: String(nonNeg(prior?.minor) + nonNeg(p.shareMinor) - nonNeg(p.discountMinor)) });
  }
  return [...out.values()];
}
/**
 * Hands a line's live parts to its split children. Child j receives `subtotals[j]` of price and `discounts[j]` of discount in total. Each part's NET (price - discount) and its DISCOUNT are
 * dealt out child by child over what is still unassigned (the last child takes the remainder); a part's price in a child is its net plus its discount there. Every figure is therefore
 * non-negative, each part adds up across the children and each child's parts add up to its own line. Never re-rounded afterwards. null when the figures cannot be conserved.
 */
export function splitComponents(parts: ComboPart[], subtotals: bigint[], discounts: bigint[], quantityOf: (p: ComboPart, j: number) => string): ComboPart[][] | null {
  const total = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n), nets = subtotals.map((x, j) => x - discounts[j]!);
  if (nets.some(x => x < 0n) || total(nets) !== parts.reduce((a, p) => a + nonNeg(p.shareMinor) - nonNeg(p.discountMinor), 0n) || total(discounts) !== parts.reduce((a, p) => a + nonNeg(p.discountMinor), 0n)) return null;
  const left = parts.map(p => [nonNeg(p.shareMinor) - nonNeg(p.discountMinor), nonNeg(p.discountMinor)] as [bigint, bigint]), out: ComboPart[][] = [];
  const deal = (amount: bigint, from: bigint[], last: boolean): bigint[] => last ? from : amount === 0n ? from.map(() => 0n) : allocateMinor(String(amount), from).map(BigInt);
  subtotals.forEach((_, j) => {
    const last = j === subtotals.length - 1, net = deal(nets[j]!, left.map(x => x[0]), last), disc = deal(discounts[j]!, left.map(x => x[1]), last);
    left.forEach((x, i) => { x[0] -= net[i]!; x[1] -= disc[i]!; });
    out.push(parts.map((p, i) => ({ ...p, quantity: quantityOf(p, j), shareMinor: String(net[i]! + disc[i]!), discountMinor: String(disc[i]) })));
  });
  return out;
}
