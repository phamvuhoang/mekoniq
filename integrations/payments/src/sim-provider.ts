import type { CreateIntentInput, PaymentProvider, ProviderState, RefundResult } from './provider-adapter';
import type { IntegrationProfile } from '../../core/src/profile';
import { signWebhook } from '../../core/src/webhook-signature';
import { vietQrPayload } from './vietqr';
/**
 * Emulated payment provider (profile mode `simulation`). It is OUR model of "a provider that can create, query and refund"; it proves our behaviour and says nothing about any real provider.
 * Faults: `createTimeoutNext` acts then throws (response lost); `queryRateLimitNext` throws a rate-limit error; `refundTimeoutNext` acts then throws; `refundRateLimitNext` answers 429.
 */
export function createSimPaymentProvider(profile: IntegrationProfile) {
  const intents = new Map<string, { input: CreateIntentInput; providerRef: string; state: ProviderState }>();
  const refunds = new Map<string, RefundResult>();
  const faults = { createTimeoutNext: 0, queryRateLimitNext: 0, refundTimeoutNext: 0, refundRateLimitNext: 0 };
  const calls: Record<string, number> = { createIntent: 0, query: 0, refund: 0, queryRefund: 0 };
  const provider: PaymentProvider = {
    profile,
    async createIntent(input) {
      calls.createIntent!++;
      const known = intents.get(input.intentId);
      const entry = known ?? { input, providerRef: 'sim-' + input.intentId.slice(0, 8), state: { status: 'pending' } as ProviderState };
      intents.set(input.intentId, entry);
      if (faults.createTimeoutNext > 0) { faults.createTimeoutNext--; throw new Error('PROVIDER_TIMEOUT'); }
      const qrPayload = input.payee ? vietQrPayload({ bin: input.payee.bin, account: input.payee.account, amountMinor: input.amountMinor, purpose: input.intentId.slice(0, 8) }) : undefined;
      return { providerRef: entry.providerRef, ...(qrPayload ? { qrPayload } : {}), expiresAt: input.expiresAt };
    },
    async query(ref) {
      calls.query!++;
      if (faults.queryRateLimitNext > 0) { faults.queryRateLimitNext--; throw new Error('PROVIDER_RATE_LIMITED'); }
      return intents.get(ref.intentId)?.state ?? { status: 'not_found' };
    },
    async refund(input) {
      calls.refund!++;
      if (faults.refundRateLimitNext > 0) { faults.refundRateLimitNext--; return { status: 'rate_limited', retryAfterMs: 1000 }; }
      const known = refunds.get(input.refundId);
      const result: RefundResult = known ?? { status: 'confirmed', refundRef: 'sim-refund-' + input.refundId.slice(0, 8) };
      refunds.set(input.refundId, result);
      if (faults.refundTimeoutNext > 0) { faults.refundTimeoutNext--; throw new Error('PROVIDER_TIMEOUT'); }
      return result;
    },
    async queryRefund(ref) { calls.queryRefund!++; return refunds.get(ref.refundId) ?? { status: 'not_found' }; },
  };
  return {
    provider, faults, calls,
    /** The provider's own record of what happened to an intent (what `query` will answer). */
    program(intentId: string, state: ProviderState) { const e = intents.get(intentId); if (!e) throw new Error('SIM_INTENT_UNKNOWN'); e.state = state; },
    known: (intentId: string) => intents.has(intentId),
    /** A webhook as this emulator would send it: signed over the exact bytes. */
    webhook(secret: string, body: Record<string, unknown>, nowMs = Date.now()) {
      const raw = JSON.stringify(body);
      return { raw, headers: new Headers({ 'x-mekoniq-timestamp': String(nowMs), 'x-mekoniq-signature': signWebhook(secret, nowMs, raw) }) };
    },
  };
}
