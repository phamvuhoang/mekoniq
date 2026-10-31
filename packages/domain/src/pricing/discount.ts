import type { JsonObject } from '../../../contracts/src/index';
import { allocateMinor } from '../shared/money';
import { amount, fail, record, text } from '../restaurant-context';
import { quoteTaxExclusive } from './tax';
/** Coupons are published with the menu; carts reference them by id so a client can never supply an amount. */
export function validatedDiscounts(value: unknown): JsonObject[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 100) return fail('INVALID_PRICING_PROFILE');
  const found = value.map(raw => {
    const d = record(raw as JsonObject), kind = d.kind === 'percent' || d.kind === 'fixed' ? d.kind : fail('INVALID_PRICING_PROFILE');
    const itemIds = d.itemIds === undefined ? undefined : Array.isArray(d.itemIds) && d.itemIds.length > 0 && d.itemIds.length <= 1000 ? d.itemIds.map(i => text(i)) : fail('INVALID_PRICING_PROFILE');
    if (kind === 'percent' && !(Number.isInteger(d.valueBps) && (d.valueBps as number) > 0 && (d.valueBps as number) <= 10000)) return fail('INVALID_PRICING_PROFILE');
    return { id: text(d.id), name: text(d.name), kind, ...(kind === 'percent' ? { valueBps: d.valueBps as number } : { amountMinor: amount(d.amountMinor, true) }), ...(itemIds ? { itemIds } : {}) };
  });
  return new Set(found.map(d => d.id)).size === found.length ? found : fail('INVALID_PRICING_PROFILE');
}
/**
 * Applies the requested coupons in order. Each coupon takes its amount from what the previous ones left (percent of the
 * remaining eligible gross, or the fixed amount, capped at what remains) and spreads it over eligible lines by largest remainder.
 * Returns shares[couponIndex][lineIndex]; per-line shares never exceed the line and sum exactly to each coupon amount.
 */
export function allocateDiscounts(grossMinor: string[], lineItemIds: string[], coupons: JsonObject[]): string[][] {
  const left = grossMinor.map(BigInt);
  return coupons.map(coupon => {
    const matches = (i: number) => !coupon.itemIds || (coupon.itemIds as string[]).includes(lineItemIds[i]!);
    if (!lineItemIds.some((_, i) => matches(i))) return fail('DISCOUNT_NOT_APPLICABLE');
    const eligible = left.map((rest, i) => matches(i) ? rest : 0n);
    const pool = eligible.reduce((a, b) => a + b, 0n);
    const wanted = coupon.kind === 'percent' ? BigInt(quoteTaxExclusive(String(pool), coupon.valueBps as number)) : BigInt(String(coupon.amountMinor));
    const total = wanted < pool ? wanted : pool;
    const shares = pool === 0n ? eligible.map(() => '0') : allocateMinor(String(total), eligible);
    shares.forEach((share, i) => { left[i]! -= BigInt(share); });
    return shares;
  });
}
