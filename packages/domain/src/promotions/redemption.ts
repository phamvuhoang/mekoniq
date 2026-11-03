import type { ModuleRegistry } from '../modules';
import type { CommandEnvelope, DomainEvent, JsonObject, Snapshot } from '../../../contracts/src/index';
import { hashPayload } from '../../../contracts/src/canonical';
import { all, changed, created, done, fail, find, handle, note, text } from '../restaurant-context';
import { businessDateAt } from '../shared/clock';
const useId = (voucherId: string, ref: string) => `vuse-${hashPayload({ voucherId, ref }).slice(0, 32)}`;
const useOf = (s: Snapshot[], voucherId: string, ref: string) => all(s, 'voucher-use').find(u => u.state.voucherId === voucherId && (u.state.ref === ref || u.state.billId === ref));
const zoneOf = (s: Snapshot[]) => { const z = find(s, 'venue-layout', 'current')?.state.timezone; return typeof z === 'string' ? z : 'UTC'; };
type Balance = { change: JsonObject; mode: 'venue' | 'escrow' };
/** Takes one use out of the voucher (reserve, or redeem without a hold). Order of refusals: validity -> scope/authority -> allocation -> customer limit. */
function take(c: CommandEnvelope, s: Snapshot[], v: Snapshot, customerId: string | undefined): Balance {
  if (v.state.status !== undefined && v.state.status !== 'active') return fail('VOUCHER_INACTIVE');
  const promotionId = v.state.promotionId as string | undefined;
  if (promotionId && find(s, 'promotion', promotionId)?.state.status !== 'active') return fail('PROMOTION_INACTIVE');
  const day = businessDateAt(c.occurredAt, zoneOf(s));
  if (v.state.validFrom && day < String(v.state.validFrom)) return fail('VOUCHER_NOT_STARTED');
  if (v.state.validTo && day > String(v.state.validTo)) return fail('VOUCHER_EXPIRED');
  const scope = String(v.state.scope ?? c.venueId);
  let result: Balance;
  if (scope === 'shared') {
    // A shared pool is spent on the authority's side. Without an exclusive allocation for THIS venue the answer is a visible denial, never "ignore the limit".
    const slot = ((v.state.escrow ?? {}) as Record<string, JsonObject>)[c.venueId];
    if (c.payload.grantRevision !== undefined && slot && c.payload.grantRevision !== slot.revision) return fail('STALE_GRANT');
    if (!slot || Number(slot.count) < 1) return fail('SHARED_VOUCHER_OFFLINE_DENIED');
    result = { mode: 'escrow', change: { escrow: { ...(v.state.escrow as JsonObject), [c.venueId]: { ...slot, count: Number(slot.count) - 1 } } } };
  } else if (scope !== c.venueId) return fail('VOUCHER_SCOPE_DENIED');
  else if (Number(v.state.remaining) < 1) return fail('VOUCHER_EXHAUSTED');
  else result = { mode: 'venue', change: { remaining: Number(v.state.remaining) - 1 } };
  if (v.state.perCustomerLimit !== undefined) {
    if (!customerId) return fail('CUSTOMER_REQUIRED');
    if (all(s, 'voucher-use').filter(u => u.state.voucherId === v.ref.id && u.state.customerId === customerId && ['reserved', 'redeemed'].includes(String(u.state.status))).length >= Number(v.state.perCustomerLimit)) return fail('CUSTOMER_LIMIT_REACHED');
  }
  return result;
}
/** What the bill actually got from this voucher's promotion: the frozen discount charges on its lines (null when the bill/promotion is not there yet). */
function discountSnapshot(s: Snapshot[], billId: string, promotionId: unknown): string | null {
  const bill = find(s, 'bill', billId);
  if (!bill || typeof promotionId !== 'string') return null;
  return String(((bill.state.lines ?? []) as JsonObject[]).flatMap(l => (l.charges ?? []) as JsonObject[]).filter(ch => ch.kind === 'discount' && ch.ref === promotionId).reduce((a, ch) => a + BigInt(String(ch.minor)), 0n));
}
const restore = (v: Snapshot, use: Snapshot): JsonObject => use.state.mode === 'escrow'
  ? { escrow: { ...(v.state.escrow as JsonObject), [String(use.state.venueId)]: { ...((v.state.escrow as Record<string, JsonObject>)[String(use.state.venueId)]!), count: Number(((v.state.escrow as Record<string, JsonObject>)[String(use.state.venueId)]!).count) + 1 } } }
  : { remaining: Number(v.state.remaining) + 1 };
export function registerRedemption(registry: ModuleRegistry): void {
  const base = (c: CommandEnvelope, v: Snapshot, ref: string, customerId: string | undefined, mode: string): JsonObject => ({ voucherId: v.ref.id, ref, ...(customerId ? { customerId } : {}), ...(v.state.promotionId ? { promotionId: v.state.promotionId } : {}), mode, venueId: c.venueId, restoreOnRefund: v.state.restoreOnRefund === true, actorRef: c.actorRef });
  // Voucher.Reserve {voucherId,ref,customerId?,grantRevision?}: holds one use for `ref` (usually the session). A hold is never released by time — an unknown payment keeps it — only by
  // Voucher.Release or by converting it with Voucher.Redeem{reservedRef}.
  handle(registry, 'Voucher.Reserve', (c, s) => {
    const v = find(s, 'voucher', text(c.payload.voucherId)) ?? fail('NOT_FOUND'), ref = text(c.payload.ref), customerId = typeof c.payload.customerId === 'string' ? c.payload.customerId : undefined, prior = useOf(s, v.ref.id, ref);
    if (prior && prior.state.status !== 'released') return done([], { useId: prior.ref.id, duplicate: true });
    // a new hold starts clean: the order the old hold discounted is history (kept in previousOrderIds), not a binding on this hold
    const t = take(c, s, v, customerId), state = { ...base(c, v, ref, customerId, t.mode), status: 'reserved', reservedAt: c.occurredAt, ...(prior ? { orderId: null, previousOrderIds: [...((prior.state.previousOrderIds ?? []) as string[]), ...(typeof prior.state.orderId === 'string' ? [prior.state.orderId] : [])] } : {}) };
    return done([prior ? changed('VoucherReserved', prior, state) : created('VoucherReserved', 'voucher-use', useId(v.ref.id, ref), state), changed('VoucherBalanceChanged', v, t.change)], { useId: prior?.ref.id ?? useId(v.ref.id, ref) });
  });
  // Voucher.Redeem {voucherId,billId,reservedRef?,customerId?,grantRevision?}: the use is spent once per voucher+bill. With `reservedRef` the existing hold becomes the redemption (no
  // second use is taken); without it the use is taken and spent in one commit. The store's version check lets exactly one of two racing redemptions of the last use win.
  handle(registry, 'Voucher.Redeem', (c, s) => {
    const v = find(s, 'voucher', text(c.payload.voucherId)) ?? fail('NOT_FOUND'), billId = text(c.payload.billId), customerId = typeof c.payload.customerId === 'string' ? c.payload.customerId : undefined;
    const held = c.payload.reservedRef === undefined ? useOf(s, v.ref.id, billId) : useOf(s, v.ref.id, text(c.payload.reservedRef));
    const spent = { status: 'redeemed', billId, redeemedAt: c.occurredAt, discountMinor: discountSnapshot(s, billId, v.state.promotionId) };
    if (held?.state.status === 'redeemed') return held.state.billId === billId ? done([], { useId: held.ref.id, duplicate: true }) : fail('VOUCHER_ALREADY_REDEEMED');
    if (c.payload.reservedRef !== undefined && held?.state.status !== 'reserved') return fail('VOUCHER_NOT_HELD');
    if (held?.state.status === 'reserved') return done([changed('VoucherRedeemed', held, spent)], { useId: held.ref.id });
    const t = take(c, s, v, customerId);
    const events: DomainEvent[] = [held ? changed('VoucherRedeemed', held, { ...base(c, v, billId, customerId, t.mode), ...spent }) : created('VoucherRedeemed', 'voucher-use', useId(v.ref.id, billId), { ...base(c, v, billId, customerId, t.mode), ...spent }), changed('VoucherBalanceChanged', v, t.change)];
    return done(events, { useId: held?.ref.id ?? useId(v.ref.id, billId) });
  });
  // Voucher.Release {voucherId,ref,reason,reversalSource?}: frees a HELD use. A redeemed use returns only on a refund: the refund must exist, the use's snapshot policy
  // (restoreOnRefund, copied from the voucher when it was spent) must allow it, and one refund restores it once (ALREADY_REVERSED for a second, different refund).
  handle(registry, 'Voucher.Release', (c, s) => {
    const reason = note(c.payload.reason, 'REASON_REQUIRED'), v = find(s, 'voucher', text(c.payload.voucherId)) ?? fail('NOT_FOUND'), use = useOf(s, v.ref.id, text(c.payload.ref)) ?? fail('VOUCHER_NOT_HELD');
    const status = String(use.state.status), source = typeof c.payload.reversalSource === 'string' ? c.payload.reversalSource : undefined;
    if (status === 'released') return done([], { duplicate: true });
    // A hold that already discounted an order is spent with it: it comes back only if that order was cancelled (otherwise release + re-reserve would discount twice).
    if (status === 'reserved' && typeof use.state.orderId === 'string' && find(s, 'order', String(use.state.orderId))?.state.status !== 'cancelled') return fail('VOUCHER_APPLIED_TO_ORDER');
    if (status === 'reserved') return done([changed('VoucherReleased', use, { status: 'released', releasedAt: c.occurredAt, releaseReason: reason }), changed('VoucherBalanceChanged', v, restore(v, use))], { useId: use.ref.id });
    if (status === 'reversed') return source && use.state.reversalSource === source ? done([], { duplicate: true }) : fail('ALREADY_REVERSED');
    if (!source) return fail('ALREADY_REDEEMED');
    if (use.state.restoreOnRefund !== true) return fail('RESTORE_NOT_ALLOWED');
    const refund = find(s, 'refund', source) ?? fail('REFUND_NOT_FOUND');
    if (refund.state.billId !== use.state.billId) return fail('REFUND_NOT_FOR_BILL');
    return done([changed('VoucherReversed', use, { status: 'reversed', reversalSource: source, reversedAt: c.occurredAt, releaseReason: reason }), changed('VoucherBalanceChanged', v, restore(v, use))], { useId: use.ref.id });
  });
}
