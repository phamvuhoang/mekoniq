import { hashPayload } from '../../../contracts/src/canonical';
import type { JsonObject } from '../../../contracts/src/index';
import { fail } from '../restaurant-context';
import { toBase as convert } from './uom';
/** Content-addressed id: the same source + recipe version + ingredient + kind is one movement forever (the unique index of the stock ledger). */
export const movementId = (...parts: string[]): string => `mv-${hashPayload({ parts }).slice(0, 32)}`;
export const sourceId = (prefix: string, source: string): string => `${prefix}-${hashPayload({ source }).slice(0, 32)}`;
const big = (v: unknown): bigint => BigInt(String(v ?? '0'));
/** UOM errors are domain refusals, not crashes. */
export function toBase(item: JsonObject, quantity: string, unit?: string): string {
  try { return convert({ baseUnit: String(item.baseUnit), conversions: item.conversions as Record<string, string> | undefined }, quantity, unit); } catch (e) { return fail((e as Error).message); }
}
/**
 * `qty` base units leave the item at its weighted-average cost (value / onHand). Stock that is not there has no cost: the covered part is costed, the
 * rest is reported as `costKnown:false` — a shortfall is never invented a price. The ledger keeps going negative unless the ingredient says `block`.
 */
export function issue(item: JsonObject, qty: bigint): { costMinor: bigint; costKnown: boolean; next: JsonObject } {
  const onHand = big(item.onHand), value = big(item.valueMinor);
  if (item.negativePolicy === 'block' && onHand < qty) return fail('INSUFFICIENT_STOCK');
  const covered = onHand > 0n ? (qty < onHand ? qty : onHand) : 0n;
  const costMinor = covered === 0n ? 0n : covered === onHand ? value : (value * covered * 2n + onHand) / (2n * onHand);
  return { costMinor, costKnown: covered === qty, next: { onHand: String(onHand - qty), valueMinor: String(value - costMinor), movementSeq: Number(item.movementSeq ?? 0) + 1 } };
}
/**
 * Stock enters with the value that came with it (receipts, positive adjustments). Units that only repay a negative balance were already sold, so their share of the incoming
 * value is not stock value: only the units that remain on the shelf carry value, at the incoming unit cost. A balance still <= 0 afterwards holds no value.
 */
/** The part of the incoming value that only pays for units already sold (the cost those sales could not know): it goes to the cost ledger, not to the shelf. */
export function backfillOf(item: JsonObject, qty: bigint, valueMinor: bigint): bigint {
  const onHand = big(item.onHand), owed = onHand < 0n ? (qty < -onHand ? qty : -onHand) : 0n;
  return qty === 0n ? 0n : (valueMinor * owed * 2n + qty) / (2n * qty);
}
export function receive(item: JsonObject, qty: bigint, valueMinor: bigint): JsonObject {
  const onHand = big(item.onHand), after = onHand + qty, backfill = backfillOf(item, qty, valueMinor);
  const value = after <= 0n ? 0n : (onHand < 0n ? 0n : big(item.valueMinor)) + valueMinor - backfill;
  return { onHand: String(after), valueMinor: String(value), movementSeq: Number(item.movementSeq ?? 0) + 1 };
}
