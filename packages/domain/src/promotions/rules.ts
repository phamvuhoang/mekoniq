import type { ModuleRegistry } from '../modules';
import type { JsonObject } from '../../../contracts/src/index';
import { changed, created, done, expectVersion, fail, find, handle, record, text } from '../restaurant-context';
import { validatedDiscounts } from '../pricing/discount';
import { businessDateAt, localTimeAt } from '../shared/clock';
export type EligibilityContext = { at: string; timeZone: string; itemIds: string[]; channel: string; customerId?: string; venueId: string };
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const minute = (v: unknown): number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 1440 ? v as number : fail('INVALID_PROMOTION');
/** Same interval test the reservation resource uses elsewhere: touching ends do not overlap. */
export const rangesOverlap = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;
/**
 * A promotion is DATA, never code: kind percent|fixed (same shape as menu coupons, so the existing allocator applies it), optional item list, a venue-time window
 * (inclusive business dates, weekdays Mon=1..Sun=7, minutes since local midnight), channels, customers, venues, a priority, an exclusion group and `requiresVoucher`.
 */
export function validatedPromotion(payload: JsonObject, venueId: string): JsonObject {
  const id = text(payload.promotionId), core = validatedDiscounts([{ id, name: text(payload.name, 'NAME_REQUIRED'), kind: payload.kind as string, ...(payload.valueBps === undefined ? {} : { valueBps: payload.valueBps }), ...(payload.amountMinor === undefined ? {} : { amountMinor: payload.amountMinor }), ...(payload.itemIds === undefined ? {} : { itemIds: payload.itemIds }) }])[0]!;
  const list = (v: unknown, max = 100) => v === undefined ? undefined : Array.isArray(v) && v.length > 0 && v.length <= max ? v.map(x => text(x)) : fail('INVALID_PROMOTION');
  let window: JsonObject | undefined;
  if (payload.window !== undefined) {
    const w = record(payload.window);
    if ((w.fromDate !== undefined && !isDate(w.fromDate)) || (w.toDate !== undefined && !isDate(w.toDate)) || (isDate(w.fromDate) && isDate(w.toDate) && w.fromDate > w.toDate)) return fail('INVALID_PROMOTION');
    const days = w.weekdays === undefined ? undefined : Array.isArray(w.weekdays) && w.weekdays.every(d => Number.isInteger(d) && (d as number) >= 1 && (d as number) <= 7) ? w.weekdays : fail('INVALID_PROMOTION');
    if ((w.startMinute === undefined) !== (w.endMinute === undefined) || (w.startMinute !== undefined && minute(w.startMinute) >= minute(w.endMinute))) return fail('INVALID_PROMOTION');
    window = { ...(w.fromDate ? { fromDate: w.fromDate } : {}), ...(w.toDate ? { toDate: w.toDate } : {}), ...(days ? { weekdays: days } : {}), ...(w.startMinute !== undefined ? { startMinute: w.startMinute, endMinute: w.endMinute } : {}) } as JsonObject;
  }
  const priority = payload.priority === undefined ? 0 : Number.isInteger(payload.priority) && (payload.priority as number) >= 0 && (payload.priority as number) <= 1000 ? payload.priority as number : fail('INVALID_PROMOTION');
  const status = payload.status === undefined ? 'active' : payload.status === 'active' || payload.status === 'retired' ? payload.status : fail('INVALID_PROMOTION');
  const venues = list(payload.venueIds);
  return { ...core, priority, status, stackable: payload.stackable !== false, requiresVoucher: payload.requiresVoucher === true, venueIds: venues ?? [venueId],
    ...(payload.exclusionGroup !== undefined ? { exclusionGroup: text(payload.exclusionGroup) } : {}), ...(window ? { window } : {}), ...(list(payload.channels) ? { channels: list(payload.channels)! } : {}), ...(list(payload.customerIds, 1000) ? { customerIds: list(payload.customerIds, 1000)! } : {}) };
}
/** null when the promotion applies in this context, else the reason. Pure; the tablet evaluates it offline from cached rules. */
export function ineligible(rule: JsonObject, ctx: EligibilityContext): string | null {
  if ((rule.venueIds as string[] | undefined) && !(rule.venueIds as string[]).includes(ctx.venueId)) return 'venue';
  if (rule.channels && !(rule.channels as string[]).includes(ctx.channel)) return 'channel';
  if (rule.customerIds && !(ctx.customerId && (rule.customerIds as string[]).includes(ctx.customerId))) return 'customer';
  if (rule.itemIds && !ctx.itemIds.some(i => (rule.itemIds as string[]).includes(i))) return 'items';
  const w = rule.window as JsonObject | undefined;
  if (w) {
    const date = businessDateAt(ctx.at, ctx.timeZone), local = localTimeAt(ctx.at, ctx.timeZone);
    if ((w.fromDate && date < String(w.fromDate)) || (w.toDate && date > String(w.toDate))) return 'date';
    if (w.weekdays && !(w.weekdays as number[]).includes(local.weekday)) return 'weekday';
    if (w.startMinute !== undefined && !(local.minutes >= Number(w.startMinute) && local.minutes < Number(w.endMinute))) return 'time';
  }
  return null;
}
export function registerPromotions(registry: ModuleRegistry): void {
  // Promotion.Publish {promotionId, name, kind, valueBps|amountMinor, …rule fields, status?, expectedVersion?}: a re-publish bumps `revision`; orders already priced keep the charge snapshot they were given.
  handle(registry, 'Promotion.Publish', (c, s) => {
    const rule = validatedPromotion(c.payload, c.venueId), existing = find(s, 'promotion', String(rule.id));
    if (!existing) return done([created('PromotionPublished', 'promotion', String(rule.id), { ...rule, revision: 1, publishedBy: c.actorRef, publishedAt: c.occurredAt })], { promotionId: rule.id as string, revision: 1 });
    expectVersion(c, existing);
    const revision = Number(existing.state.revision) + 1;
    return done([changed('PromotionPublished', existing, { ...rule, revision, publishedBy: c.actorRef, publishedAt: c.occurredAt })], { promotionId: rule.id as string, revision });
  });
}
