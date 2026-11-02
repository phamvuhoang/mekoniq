import type { CommandEnvelope, JsonObject, Snapshot } from '../../../contracts/src/index';
import { canonicalMinor } from '../shared/money';
import { currentMenu } from '../catalog/menu';
import { availableAt } from '../catalog/availability';
import { resolveModifiers } from '../catalog/modifier';
import { fail, find, quantity, record, records, requireFeature, text } from '../restaurant-context';
import { allocateDiscounts, validatedDiscounts } from './discount';
import { extractTaxInclusive, quoteTaxExclusive } from './tax';
export type Quote = JsonObject & { menuVersion: number; currency: string; lines: JsonObject[]; totalMinor: string };
export interface QuoteInput { menu: Snapshot; items: unknown; discountIds?: unknown; currency?: unknown; menuVersion?: unknown; at: string; timeZone: string; policyRevision: number }
const bad = (): never => fail('INVALID_PRICING_PROFILE');
const bps = (value: unknown): number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 10000 ? value as number : bad();
/** Tax/service/coupon profile published with the menu; its revision is the menu version. No jurisdiction rules live here. */
export function validatedPricing(raw: unknown): JsonObject {
  const p = raw === undefined || raw === null ? {} : record(raw as JsonObject);
  if (p.taxProfiles !== undefined && (!Array.isArray(p.taxProfiles) || p.taxProfiles.length > 20)) return bad();
  const taxProfiles = ((p.taxProfiles ?? []) as JsonObject[]).map(x => { const t = record(x); return { id: text(t.id, 'INVALID_PRICING_PROFILE'), name: text(t.name, 'INVALID_PRICING_PROFILE'), rateBps: bps(t.rateBps), inclusive: t.inclusive === true }; });
  const defaultTaxProfileId = p.defaultTaxProfileId ?? null;
  if (new Set(taxProfiles.map(t => t.id)).size !== taxProfiles.length || (defaultTaxProfileId !== null && !taxProfiles.some(t => t.id === defaultTaxProfileId))) return bad();
  const service = p.service === undefined || p.service === null ? null : { rateBps: bps(record(p.service).rateBps), taxable: record(p.service).taxable === true };
  if (service?.taxable && taxProfiles.some(t => t.inclusive)) return bad(); // service sits on top of the price, so it cannot be "included" in an inclusive tax
  if (p.discountOrder !== undefined && p.discountOrder !== 'before_tax' && p.discountOrder !== 'after_tax') return bad();
  return { taxProfiles, defaultTaxProfileId, service, discountOrder: p.discountOrder ?? 'before_tax', discounts: validatedDiscounts(p.discounts) };
}
const NO_PRICING = validatedPricing({});
const money = (value: bigint): string => { try { return canonicalMinor(String(value)); } catch { return fail('INVALID_AMOUNT'); } };
/** A line's live amount: its immutable priced snapshot minus whatever Order.Amend cancelled (cumulative, in line.cancelled). */
export const netOf = (l: JsonObject, key: string, fallback?: string): bigint => BigInt(String(l[key] ?? (fallback ? l[fallback] : 0))) - BigInt(String((l.cancelled as JsonObject | undefined)?.[key] ?? 0));
const sumOf = (lines: JsonObject[], key: string): bigint => lines.reduce((a, l) => a + netOf(l, key), 0n);
/** Component totals of a list of priced lines (orders, bills). Lines without charge snapshots count as plain subtotal. */
export function summarize(lines: JsonObject[]): JsonObject {
  return { subtotalMinor: String(lines.reduce((a, l) => a + netOf(l, 'subtotalMinor', 'totalMinor'), 0n)), discountMinor: String(sumOf(lines, 'discountMinor')), serviceMinor: String(sumOf(lines, 'serviceMinor')), taxMinor: String(sumOf(lines, 'taxMinor')), taxIncludedMinor: String(sumOf(lines, 'taxIncludedMinor')), totalMinor: String(sumOf(lines, 'totalMinor')) };
}
/** Distinct menu/policy revisions the lines were priced under (what a bill snapshot was computed with). */
export function pricingRevisions(lines: JsonObject[]): JsonObject[] {
  const keys = new Set(lines.flatMap(l => l.pricing ? [`${(l.pricing as JsonObject).profileRevision}/${(l.pricing as JsonObject).policyRevision}`] : []));
  return [...keys].map(k => ({ menuVersion: Number(k.split('/')[0]), policyRevision: Number(k.split('/')[1]) }));
}
/**
 * Single quote for Catalog.Quote / Order.Place / Order.Amend. Per line, in the order recorded in pricing.steps:
 * base (unit or size price x qty) -> modifiers -> [discount] -> service -> tax -> [discount when the profile says after_tax].
 * charges[] holds immutable positive amounts with an effect (add | subtract | included) so a split can allocateMinor each one.
 */
export function quoteOrder(i: QuoteInput): Quote {
  const menu = i.menu.state, profile = (menu.pricing ?? NO_PRICING) as JsonObject;
  if (i.menuVersion !== undefined && i.menuVersion !== menu.version) return fail('STALE_QUOTE');
  if (i.currency !== undefined && i.currency !== menu.currency) return fail('CURRENCY_MISMATCH');
  const catalog = menu.items as JsonObject[], taxProfiles = profile.taxProfiles as JsonObject[], service = profile.service as JsonObject | null;
  const priced = records(i.items as JsonObject[]).map((raw, index) => {
    const itemId = text(raw.itemId), count = quantity(raw.quantity);
    const entry = catalog.find(x => x.id === itemId) ?? fail('ITEM_NOT_FOUND');
    if (entry.available === false) return fail('ITEM_SOLD_OUT');
    if (!availableAt(entry.availability, i.at, i.timeZone)) return fail('ITEM_UNAVAILABLE_NOW');
    const { unitMinor, modifiers } = resolveModifiers(entry, raw.modifiers);
    const base = BigInt(canonicalMinor(unitMinor)) * BigInt(count);
    const addOns = modifiers.filter(m => m.kind !== 'size').map(m => ({ kind: 'modifier', ref: `${m.groupId}/${m.optionId}`, name: m.name!, minor: money(BigInt(String(m.priceMinor)) * BigInt(count)), effect: 'add' }));
    const gross = base + addOns.reduce((a, c) => a + BigInt(c.minor), 0n);
    const taxId = entry.taxProfileId ?? profile.defaultTaxProfileId;
    return { index, itemId, count, entry, unitMinor, modifiers, base, addOns, gross, tax: taxId ? taxProfiles.find(t => t.id === taxId) ?? fail('TAX_PROFILE_NOT_FOUND') : null };
  });
  const ids = i.discountIds === undefined ? [] : Array.isArray(i.discountIds) && i.discountIds.length <= 10 ? i.discountIds.map(d => text(d)) : fail('INVALID_DISCOUNT');
  if (new Set(ids).size !== ids.length) return fail('DUPLICATE_DISCOUNT');
  const coupons = ids.map(id => (profile.discounts as JsonObject[]).find(d => d.id === id) ?? fail('DISCOUNT_NOT_FOUND'));
  // Coupons always work on the pre-tax, pre-service gross (percent base = remaining eligible gross, capped at it) so tax/service
  // are never an input to a discount. before_tax: service and tax are then computed on gross - discount.
  // after_tax: service and tax are computed on the full gross and the discount only reduces the payable total (tax is NOT reduced).
  const shares = allocateDiscounts(priced.map(l => money(l.gross)), priced.map(l => l.itemId), coupons);
  const discountFirst = profile.discountOrder !== 'after_tax';
  const steps = discountFirst ? ['base', 'modifier', 'discount', 'service', 'tax'] : ['base', 'modifier', 'service', 'tax', 'discount'];
  const lines = priced.map(l => {
    const discounts = coupons.map((c, k) => ({ kind: 'discount', ref: String(c.id), name: String(c.name), minor: shares[k]![l.index]!, effect: 'subtract' })).filter(c => c.minor !== '0');
    const discount = discounts.reduce((a, c) => a + BigInt(c.minor), 0n);
    const net = discountFirst ? l.gross - discount : l.gross; // amount service and tax are computed on
    const serviceMinor = service ? BigInt(quoteTaxExclusive(money(net), Number(service.rateBps))) : 0n;
    const inclusive = l.tax?.inclusive === true;
    const taxMinor = !l.tax ? 0n : BigInt(inclusive ? extractTaxInclusive(money(net), Number(l.tax.rateBps)) : quoteTaxExclusive(money(net + (service?.taxable ? serviceMinor : 0n)), Number(l.tax.rateBps)));
    const by = (kind: string): JsonObject[] => kind === 'base' ? [{ kind, minor: money(l.base), effect: 'add' }] : kind === 'modifier' ? l.addOns : kind === 'discount' ? discounts
      : kind === 'service' ? (service ? [{ kind, minor: money(serviceMinor), effect: 'add', rateBps: Number(service.rateBps) }] : [])
      : l.tax ? [{ kind, ref: String(l.tax.id), minor: money(taxMinor), effect: inclusive ? 'included' : 'add', rateBps: Number(l.tax.rateBps) }] : [];
    const added = serviceMinor + (inclusive ? 0n : taxMinor);
    return {
      itemId: l.itemId, quantity: l.count, name: l.entry.name!, stationId: l.entry.stationId!, unitMinor: l.unitMinor, modifiers: l.modifiers,
      charges: steps.flatMap(by), subtotalMinor: money(l.gross), discountMinor: money(discount), serviceMinor: money(serviceMinor), taxMinor: money(inclusive ? 0n : taxMinor), taxIncludedMinor: money(inclusive ? taxMinor : 0n),
      totalMinor: money(l.gross - discount + added),
      pricing: { profileRevision: Number(menu.version), policyRevision: i.policyRevision, steps, discountOrder: String(profile.discountOrder), tax: l.tax ? { id: l.tax.id!, name: l.tax.name!, rateBps: l.tax.rateBps!, inclusive } : null, service: service ? { rateBps: service.rateBps!, taxable: service.taxable === true } : null, discountIds: ids },
      menuVersion: menu.version!, index: l.index,
    } satisfies JsonObject;
  });
  return { menuVersion: menu.version as number, currency: menu.currency as string, lines, ...summarize(lines), totalMinor: money(sumOf(lines, 'totalMinor')) };
}
/** Server-side entry used by every pricing command: time comes from the command, zone from the applied venue layout. */
export function quoteForCommand(c: CommandEnvelope, snapshots: Snapshot[]): Quote {
  const coupons = c.payload.discountIds;
  if (coupons !== undefined && !(Array.isArray(coupons) && coupons.length === 0)) requireFeature(c, snapshots, 'discount'); // permission discount.apply is checked by the authorizers (requiredPermissions)
  const zone = find(snapshots, 'venue-layout', 'current')?.state.timezone;
  return quoteOrder({ menu: currentMenu(snapshots), items: c.payload.items, discountIds: c.payload.discountIds, currency: c.payload.currency, menuVersion: c.payload.menuVersion, at: c.occurredAt, timeZone: typeof zone === 'string' ? zone : 'UTC', policyRevision: c.policyRevision });
}
