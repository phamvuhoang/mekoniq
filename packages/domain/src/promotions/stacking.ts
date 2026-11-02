import type { CommandEnvelope, JsonObject, Snapshot } from '../../../contracts/src/index';
import { all, fail, find, requireFeature } from '../restaurant-context';
import { ineligible, type EligibilityContext } from './rules';
const COUPON_KEYS = ['id', 'name', 'kind', 'valueBps', 'amountMinor', 'itemIds'];
/**
 * Requested promotion ids -> deterministic coupon list: highest priority first, then id. Refusals are explicit: unknown/retired, not eligible in this context,
 * two members of one exclusion group, a non-stackable promotion next to another. The caps live in the allocator (each coupon takes from what the earlier ones left),
 * so a stack can never take a line below zero.
 */
export function selectPromotions(promotions: Snapshot[], ids: string[], ctx: EligibilityContext): JsonObject[] {
  const chosen = ids.map(id => promotions.find(p => p.ref.id === id)!).filter(Boolean);
  for (const p of chosen) {
    if (p.state.status !== 'active') return fail('PROMOTION_INACTIVE');
    if (ineligible(p.state, ctx)) return fail('PROMOTION_NOT_ELIGIBLE');
  }
  const groups = chosen.map(p => p.state.exclusionGroup).filter(Boolean);
  if (new Set(groups).size !== groups.length || (chosen.length > 1 && chosen.some(p => p.state.stackable === false))) return fail('PROMOTION_EXCLUDED');
  return [...chosen].sort((a, b) => Number(b.state.priority) - Number(a.state.priority) || a.ref.id.localeCompare(b.ref.id))
    .map(p => Object.fromEntries(COUPON_KEYS.filter(k => p.state[k] !== undefined).map(k => [k, p.state[k]!])) as JsonObject);
}
/** Pricing hook: split the requested discount ids into menu coupons (kept as given) and promotions (resolved here), returning the ids in application order. */
export function resolvePromotions(c: CommandEnvelope, snapshots: Snapshot[], ctx: EligibilityContext, requested: unknown): { discountIds: unknown; extraDiscounts: JsonObject[] } {
  if (!Array.isArray(requested) || !requested.length) return { discountIds: requested, extraDiscounts: [] };
  const promotions = all(snapshots, 'promotion'), ids = requested as string[], promoIds = ids.filter(id => promotions.some(p => p.ref.id === id));
  if (!promoIds.length) return { discountIds: requested, extraDiscounts: [] };
  requireFeature(c, snapshots, 'promotion');
  const gated = promoIds.filter(id => find(snapshots, 'promotion', id)!.state.requiresVoucher === true);
  if (gated.length) {
    const voucher = typeof c.payload.voucherId === 'string' ? find(snapshots, 'voucher', c.payload.voucherId) : undefined;
    if (!voucher) return fail('PROMOTION_REQUIRES_VOUCHER');
    if (gated.some(id => voucher.state.promotionId !== id)) return fail('PROMOTION_REQUIRES_VOUCHER');
    const held = all(snapshots, 'voucher-use').some(u => u.state.voucherId === voucher.ref.id && ['reserved', 'redeemed'].includes(String(u.state.status)) && (u.state.ref === c.payload.voucherRef || u.state.billId === c.payload.voucherRef));
    if (!held) return fail('VOUCHER_NOT_HELD');
  }
  const extraDiscounts = selectPromotions(promotions, promoIds, ctx);
  return { discountIds: [...ids.filter(id => !promoIds.includes(id)), ...extraDiscounts.map(d => String(d.id))], extraDiscounts };
}
