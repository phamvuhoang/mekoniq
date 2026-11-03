import type { ModuleRegistry } from '../modules';
import type { DomainEvent, JsonObject, Snapshot } from '../../../contracts/src/index';
import { hashPayload } from '../../../contracts/src/canonical';
import { all, changed, created, done, fail, find, handle, text } from '../restaurant-context';
import { hasConsent } from './consent';
export const entryId = (customerId: string, source: string, kind: string) => `lent-${hashPayload({ customerId, source, kind }).slice(0, 32)}`;
const DEFAULT_POLICY = { pointsPerThousandMinor: 1, tiers: [{ name: 'member', minLifetime: 0 }, { name: 'silver', minLifetime: 1000 }, { name: 'gold', minLifetime: 5000 }], revision: 1 };
const policyOf = (s: Snapshot[]) => (find(s, 'loyalty-policy', 'current')?.state ?? DEFAULT_POLICY) as typeof DEFAULT_POLICY;
const tierOf = (policy: typeof DEFAULT_POLICY, earned: bigint) => [...policy.tiers].sort((a, b) => b.minLifetime - a.minLifetime).find(t => BigInt(t.minLifetime) <= earned)?.name ?? policy.tiers[0]!.name;
const points = (v: unknown): bigint => typeof v === 'string' && /^[1-9][0-9]{0,11}$/.test(v) ? BigInt(v) : fail('INVALID_POINTS');
/** The customer's points account (zero when none exists yet): balance spendable, earned lifetime, redeemed, pending = earned offline against a chain-wide balance, not yet spendable. */
export function accountOf(s: Snapshot[], customerId: string): Snapshot {
  return find(s, 'loyalty-account', customerId) ?? { ref: { organizationId: '', venueId: '', kind: 'loyalty-account', id: customerId }, version: 0, state: { balance: '0', earned: '0', redeemed: '0', pending: '0', scope: 'venue' } };
}
export function saveAccount(acc: Snapshot, change: JsonObject): DomainEvent {
  const next = { balance: '0', earned: '0', redeemed: '0', pending: '0', scope: 'venue', ...acc.state, ...change };
  return acc.version === 0 ? created('LoyaltyAccountChanged', 'loyalty-account', acc.ref.id, next) : changed('LoyaltyAccountChanged', acc, change);
}
const customerFor = (s: Snapshot[], id: string): Snapshot => {
  const c = find(s, 'customer', id) ?? fail('CUSTOMER_NOT_FOUND');
  return c.state.status === 'active' ? c : fail(c.state.status === 'erased' ? 'CUSTOMER_ERASED' : 'CUSTOMER_MERGED');
};
const entry = (c: { actorRef: string; occurredAt: string }, id: string, state: JsonObject) => created(String(state.event), 'loyalty-entry', id, { ...state, actorRef: c.actorRef, occurredAt: c.occurredAt });
export function registerLoyalty(registry: ModuleRegistry): void {
  // Loyalty.Earn {customerId,settlementId,points}: points come from an ACTUAL captured settlement (the payment record, never the customer's say-so), at most the policy rate on its net
  // applied value, once per settlement, for one customer. Against a chain-wide balance the venue can only book them as `pending`.
  handle(registry, 'Loyalty.Earn', (c, s) => {
    const customerId = text(c.payload.customerId), settlementId = text(c.payload.settlementId), p = points(c.payload.points), customer = customerFor(s, customerId), policy = policyOf(s);
    const id = entryId(customerId, settlementId, 'earn'), prior = find(s, 'loyalty-entry', id);
    if (prior) return prior.state.points === String(p) ? done([], { entryId: id, duplicate: true }) : fail('EARN_ALREADY_RECORDED');
    if (all(s, 'loyalty-entry').some(e => e.state.kind === 'earn' && e.state.settlementId === settlementId)) return fail('SETTLEMENT_ALREADY_CLAIMED');
    if (!hasConsent(s, customer.ref.id, 'loyalty', 'program')) return fail('CONSENT_REQUIRED');
    const pay = find(s, 'payment', settlementId) ?? fail('SETTLEMENT_NOT_FOUND');
    if (pay.state.status !== 'captured') return fail('SETTLEMENT_NOT_SETTLED');
    const net = BigInt(String(pay.state.appliedMinor ?? '0')) - BigInt(String(pay.state.refundedMinor ?? '0')), cap = net > 0n ? net * BigInt(policy.pointsPerThousandMinor) / 1000n : 0n;
    if (p > cap) return fail('EARN_EXCEEDS_SETTLEMENT');
    const acc = accountOf(s, customerId), chain = acc.state.scope === 'chain', earned = BigInt(acc.state.earned as string) + (chain ? 0n : p);
    return done([entry(c, id, { event: 'LoyaltyEarned', customerId, kind: 'earn', points: String(p), sourceEventId: settlementId, settlementId, policyRevision: policy.revision, status: chain ? 'pending' : 'posted' }),
      saveAccount(acc, chain ? { pending: String(BigInt(String(acc.state.pending ?? '0')) + p) } : { balance: String(BigInt(acc.state.balance as string) + p), earned: String(earned), tier: tierOf(policy, earned) })], { entryId: id });
  });
  // Loyalty.Redeem {customerId,sourceEventId,points}: spends the venue-scoped balance, once per source; two racing redemptions of one balance have one winner (account version check).
  // A chain-wide balance is never spent from a venue that cannot reach its authority.
  handle(registry, 'Loyalty.Redeem', (c, s) => {
    const customerId = text(c.payload.customerId), source = text(c.payload.sourceEventId), p = points(c.payload.points); customerFor(s, customerId);
    const acc = accountOf(s, customerId);
    if (acc.state.scope === 'chain') return fail('SHARED_BALANCE_OFFLINE_DENIED');
    const id = entryId(customerId, source, 'redeem'), prior = find(s, 'loyalty-entry', id);
    if (prior) return prior.state.points === String(-p) ? done([], { entryId: id, duplicate: true }) : fail('SOURCE_REUSED');
    if (BigInt(acc.state.balance as string) < p) return fail('INSUFFICIENT_POINTS');
    return done([entry(c, id, { event: 'LoyaltyRedeemed', customerId, kind: 'redeem', points: String(-p), sourceEventId: source, status: 'posted' }),
      saveAccount(acc, { balance: String(BigInt(acc.state.balance as string) - p), redeemed: String(BigInt(acc.state.redeemed as string) + p) })], { entryId: id });
  });
  // Loyalty.Reverse {customerId,refundId}: a refund of the settlement takes back the proportional points, never more than that settlement earned in total. One refund reverses once.
  // The balance may go below zero if the points were already spent; the ledger says so rather than hiding it.
  handle(registry, 'Loyalty.Reverse', (c, s) => {
    const customerId = text(c.payload.customerId), refundId = text(c.payload.refundId), refund = find(s, 'refund', refundId) ?? fail('REFUND_NOT_FOUND');
    // A merge moves the balance to the surviving customer, so the points of a settlement are taken back from whoever holds them NOW: follow the merge links from the earner.
    const holderOf = (id: string): string => { let cur = id; for (let hop = 0; hop < 20; hop++) { const cu = find(s, 'customer', cur); if (cu?.state.status === 'merged' && typeof cu.state.mergedInto === 'string') cur = cu.state.mergedInto; else break; } return cur; };
    const earn = all(s, 'loyalty-entry').find(e => e.state.kind === 'earn' && e.state.settlementId === refund.state.paymentId && holderOf(String(e.state.customerId)) === holderOf(customerId)) ?? fail('REFUND_NOT_FOR_SETTLEMENT');
    const holder = holderOf(String(earn.state.customerId)), id = entryId(String(earn.state.customerId), refundId, 'reverse');
    if (find(s, 'loyalty-entry', id)) return done([], { entryId: id, duplicate: true });
    const pay = find(s, 'payment', String(refund.state.paymentId)) ?? fail('SETTLEMENT_NOT_FOUND'), earned = BigInt(earn.state.points as string), applied = BigInt(String(pay.state.appliedMinor ?? '0'));
    const done_ = all(s, 'loyalty-entry').filter(e => e.state.kind === 'reverse' && e.state.settlementId === earn.state.settlementId).reduce((a, e) => a - BigInt(e.state.points as string), 0n);
    const proportional = applied > 0n ? earned * BigInt(String(refund.state.appliedMinor ?? refund.state.amountMinor)) / applied : earned, r = (proportional < earned - done_ ? proportional : earned - done_);
    const acc = accountOf(s, holder), pending = earn.state.status === 'pending';
    return done([entry(c, id, { event: 'LoyaltyReversed', customerId: holder, originCustomerId: earn.state.customerId as string, reversesEntryId: earn.ref.id, kind: 'reverse', points: String(-r), sourceEventId: refundId, settlementId: earn.state.settlementId as string, status: 'posted' }),
      saveAccount(acc, pending ? { pending: String(BigInt(String(acc.state.pending ?? '0')) - r) } : { balance: String(BigInt(acc.state.balance as string) - r), earned: String(BigInt(acc.state.earned as string) - r) })], { entryId: id, reversed: String(r) });
  });
}
