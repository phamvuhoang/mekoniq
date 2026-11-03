import type { ModuleRegistry } from '../modules';
import type { JsonObject, Snapshot } from '../../../contracts/src/index';
import { hashPayload } from '../../../contracts/src/canonical';
import { changed, created, done, fail, find, handle, text } from '../restaurant-context';
const VALID: Record<string, string[]> = { loyalty: ['program'], marketing: ['sms', 'email', 'zalo'] };
export const consentId = (customerId: string, purpose: string, channel: string) => `consent-${hashPayload({ customerId, purpose, channel }).slice(0, 32)}`;
/** True only for an explicit, current grant for exactly this purpose and channel: never asked, withdrawn or erased all read as no. */
export function hasConsent(snapshots: Snapshot[], customerId: string, purpose: string, channel: string): boolean {
  return snapshots.find(s => s.ref.kind === 'consent' && s.ref.id === consentId(customerId, purpose, channel))?.state.granted === true;
}
export function registerConsent(registry: ModuleRegistry): void {
  // Consent.Record {customerId,purpose:loyalty|marketing,channel,granted,policyVersion}: one record per customer+purpose+channel that keeps its history (who/when/which policy text).
  // Withdrawal is a new history entry, never an edit of the past.
  handle(registry, 'Consent.Record', (c, s) => {
    const customerId = text(c.payload.customerId), purpose = String(c.payload.purpose), channel = String(c.payload.channel);
    if (!VALID[purpose]?.includes(channel) || typeof c.payload.granted !== 'boolean') return fail('INVALID_CONSENT');
    const customer = find(s, 'customer', customerId) ?? fail('CUSTOMER_NOT_FOUND');
    if (customer.state.status !== 'active') return fail(customer.state.status === 'erased' ? 'CUSTOMER_ERASED' : 'CUSTOMER_MERGED');
    const granted = c.payload.granted, policyVersion = text(c.payload.policyVersion, 'POLICY_VERSION_REQUIRED'), id = consentId(customerId, purpose, channel), existing = find(s, 'consent', id);
    if (existing && existing.state.granted === granted && existing.state.policyVersion === policyVersion) return done([], { consentId: id, duplicate: true });
    const entry = { granted, policyVersion, at: c.occurredAt, actorRef: c.actorRef }, history = [...((existing?.state.history ?? []) as JsonObject[]), entry].slice(-50);
    return done([existing ? changed('ConsentRecorded', existing, { granted, policyVersion, history }) : created('ConsentRecorded', 'consent', id, { customerId, purpose, channel, granted, policyVersion, history })], { consentId: id });
  });
}
