import type { ModuleRegistry } from '../modules';
import type { DomainEvent, JsonObject, Snapshot } from '../../../contracts/src/index';
import { stateEvent } from '../modules';
import { all, changed, created, done, expectVersion, fail, find, handle, note, text } from '../restaurant-context';
import { accountOf, saveAccount, entryId } from './loyalty';
/** Digits only; +84 / 84 prefix becomes the national 0, so "0901 234 567" and "+84 901 234 567" are the same number. */
export function normalizePhone(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('84') && d.length >= 11) d = '0' + d.slice(2);
  return /^[0-9]{9,15}$/.test(d) ? d : fail('INVALID_PHONE');
}
const live = (c: Snapshot): Snapshot => c.state.status === 'active' ? c : fail(c.state.status === 'erased' ? 'CUSTOMER_ERASED' : 'CUSTOMER_MERGED');
export function registerCustomers(registry: ModuleRegistry): void {
  // Customer.Upsert {customerId,name,phone?,email?,expectedVersion?}: the profile holds the personal data and nothing financial. A number/e-mail already on another customer only
  // FLAGS `possibleDuplicates`; merging two people is Customer.Merge, a separate audited decision.
  handle(registry, 'Customer.Upsert', (c, s) => {
    const id = text(c.payload.customerId), name = text(typeof c.payload.name === 'string' ? c.payload.name.trim() : c.payload.name, 'NAME_REQUIRED');
    const phone = c.payload.phone === undefined ? undefined : normalizePhone(text(c.payload.phone, 'INVALID_PHONE'));
    const email = c.payload.email === undefined ? undefined : /^[^\s@]{1,64}@[^\s@]{1,255}$/.test(text(c.payload.email, 'INVALID_EMAIL')) ? String(c.payload.email).toLowerCase() : fail('INVALID_EMAIL');
    const dup = all(s, 'customer').filter(o => o.ref.id !== id && o.state.status === 'active' && ((phone && o.state.phone === phone) || (email && o.state.email === email))).map(o => o.ref.id).sort();
    const existing = find(s, 'customer', id), profile = { name, ...(phone ? { phone } : {}), ...(email ? { email } : {}), possibleDuplicates: dup };
    if (!existing) return done([created('CustomerUpserted', 'customer', id, { ...profile, status: 'active', createdAt: c.occurredAt })], { customerId: id, possibleDuplicates: dup });
    live(existing); expectVersion(c, existing);
    return done([stateEvent('CustomerUpserted', 'customer', id, { ...existing.state, ...profile, version: existing.version + 1 })], { customerId: id, possibleDuplicates: dup });
  });
  // Customer.Merge {sourceId,targetId,reason}: the source stays as a `merged` tombstone pointing at the target; its points move by ledger entries (transfer_out / transfer_in),
  // so nothing in the financial history is rewritten or deleted.
  handle(registry, 'Customer.Merge', (c, s) => {
    const sourceId = text(c.payload.sourceId), targetId = text(c.payload.targetId), reason = note(c.payload.reason, 'REASON_REQUIRED');
    if (sourceId === targetId) return fail('INVALID_MERGE');
    const source = live(find(s, 'customer', sourceId) ?? fail('CUSTOMER_NOT_FOUND'));
    live(find(s, 'customer', targetId) ?? fail('CUSTOMER_NOT_FOUND'));
    const from = accountOf(s, sourceId), to = accountOf(s, targetId), moved = BigInt(from.state.balance as string), events: DomainEvent[] = [];
    if (moved !== 0n) {
      const e = (customerId: string, kind: string, points: bigint) => created('LoyaltyTransferred', 'loyalty-entry', entryId(customerId, `merge:${sourceId}>${targetId}`, kind), { customerId, kind, points: String(points), sourceEventId: `merge:${sourceId}>${targetId}`, status: 'posted', actorRef: c.actorRef, occurredAt: c.occurredAt });
      events.push(e(sourceId, 'transfer_out', -moved), e(targetId, 'transfer_in', moved), saveAccount(from, { balance: '0' }), saveAccount(to, { balance: String(BigInt(to.state.balance as string) + moved), earned: String(BigInt(to.state.earned as string) + moved) }));
    }
    return done([changed('CustomersMerged', source, { status: 'merged', mergedInto: targetId, mergedAt: c.occurredAt, mergedBy: c.actorRef, mergeReason: reason }), ...events], { sourceId, targetId, movedPoints: String(moved) });
  });
  // Customer.Erase {customerId,reason}: a data-subject request. Personal data and consents go; the loyalty ledger and balance stay as financial history under the customer id alone.
  handle(registry, 'Customer.Erase', (c, s) => {
    const reason = note(c.payload.reason, 'REASON_REQUIRED'), customer = find(s, 'customer', text(c.payload.customerId)) ?? fail('CUSTOMER_NOT_FOUND');
    if (customer.state.status === 'erased') return done([], { customerId: customer.ref.id, duplicate: true });
    const { phone: _p, email: _e, possibleDuplicates: _d, ...rest } = customer.state; void [_p, _e, _d];
    const consents = all(s, 'consent').filter(x => x.state.customerId === customer.ref.id && x.state.granted === true).map(x => changed('ConsentWithdrawn', x, { granted: false, policyVersion: 'erasure', history: [...((x.state.history ?? []) as JsonObject[]), { granted: false, policyVersion: 'erasure', at: c.occurredAt, actorRef: c.actorRef }].slice(-50) }));
    return done([stateEvent('CustomerErased', 'customer', customer.ref.id, { ...rest, name: '(đã xóa)', status: 'erased', erasedAt: c.occurredAt, erasedBy: c.actorRef, eraseReason: reason, version: customer.version + 1 }), ...consents], { customerId: customer.ref.id });
  });
}
