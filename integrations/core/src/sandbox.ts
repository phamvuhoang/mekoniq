import type { Connector, EffectIntent, EffectResult, NormalizedOrder, VerifiedEvent } from './connector';
import { connectorProfiles } from './connector';
import { externalIdentity } from './external-ids';
const MINOR = /^(0|[1-9][0-9]{0,29})$/;
/** Sandbox-only channel simulator with switchable faults, used by tests and the sandbox profile. Its outbound state is in memory: it proves our behaviour, not any real provider's. */
export function createSandboxChannel(provider: 'sandbox-channel' | 'web-sandbox' = 'sandbox-channel') {
  const taken = new Map<string, EffectResult>();
  const faults = { timeoutNext: 0, rateLimitNext: 0, rejectNext: 0, lostAckNext: 0 };
  let calls = 0;
  const connector: Connector = {
    profile: connectorProfiles[provider]!,
    normalize(v: VerifiedEvent): NormalizedOrder {
      const b = v.body, items = b.items;
      if (!Array.isArray(items) || !items.length || items.length > 100) throw new Error('INVALID_ORDER_ITEMS');
      const identity = externalIdentity({ provider, merchantId: String(b.merchantId ?? ''), externalId: String(b.externalId ?? '') });
      const lines = items.map(x => {
        const it = x as Record<string, unknown>;
        if (typeof it.itemId !== 'string' || typeof it.quantity !== 'string' || !/^[1-9][0-9]{0,5}$/.test(it.quantity)) throw new Error('INVALID_ORDER_ITEMS');
        return { itemId: it.itemId, quantity: it.quantity }; // any price the channel sent is dropped here: the venue prices from its own menu
      });
      if (typeof b.currency !== 'string' || !/^[A-Z]{3}$/.test(b.currency)) throw new Error('INVALID_CURRENCY');
      if (b.declaredTotalMinor !== undefined && (typeof b.declaredTotalMinor !== 'string' || !MINOR.test(b.declaredTotalMinor))) throw new Error('INVALID_AMOUNT');
      if (typeof b.expiresAt !== 'string' || !Number.isFinite(Date.parse(b.expiresAt))) throw new Error('INVALID_EXPIRY');
      return { ...identity, items: lines, currency: b.currency, ...(b.declaredTotalMinor ? { declaredTotalMinor: b.declaredTotalMinor as string } : {}), expiresAt: new Date(b.expiresAt).toISOString(), sandbox: true };
    },
    async execute(intent: EffectIntent) {
      calls++;
      if (faults.timeoutNext > 0) { faults.timeoutNext--; throw new Error('PROVIDER_TIMEOUT'); }
      if (faults.lostAckNext > 0) { faults.lostAckNext--; taken.set(intent.idempotencyKey, { status: 'confirmed', providerRef: 'sbx-' + intent.idempotencyKey }); throw new Error('PROVIDER_TIMEOUT'); } // acted, but the answer never arrived
      if (faults.rateLimitNext > 0) { faults.rateLimitNext--; return { status: 'rate_limited', retryAfterMs: 1000 } as const; }
      if (faults.rejectNext > 0) { faults.rejectNext--; return { status: 'rejected', code: 'SANDBOX_REFUSED' } as const; }
      const seen = taken.get(intent.idempotencyKey); if (seen) return seen;
      const done: EffectResult = { status: 'confirmed', providerRef: 'sbx-' + intent.idempotencyKey }; taken.set(intent.idempotencyKey, done); return done;
    },
    async query(intent) { return taken.get(intent.idempotencyKey) ?? { status: 'not_found' } as const; },
  };
  return { connector, faults, get calls() { return calls; }, get acted() { return taken.size; } };
}
