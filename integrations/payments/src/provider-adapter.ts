import { WEBHOOK_TOLERANCE_MS, verifyWebhook } from '../../core/src/webhook-signature';
import type { IntegrationProfile } from '../../core/src/profile';
/** What the provider says about one payment — fetched by us, never taken from a webhook body. */
export type ProviderState =
  | { status: 'pending' | 'failed' | 'expired' | 'not_found' }
  | { status: 'captured'; amountMinor: string; currency: string; merchantId: string; transactionId: string; payee?: string; capturedAt: string };
export type CreateIntentInput = { intentId: string; amountMinor: string; currency: string; merchantId: string; payee?: { bin: string; account: string }; expiresAt: string };
export type RefundResult = { status: 'confirmed'; refundRef: string } | { status: 'rejected'; code: string } | { status: 'rate_limited'; retryAfterMs: number };
/**
 * A payment provider as the cloud needs it. A call that THROWS (timeout, connection reset) has an unknown outcome: the caller records `unknown` and uses `query` / `queryRefund` with the same
 * identifiers before ever calling `createIntent` / `refund` again. Every method is idempotent on the identifier we pass (`intentId`, `refundId`).
 * There is no universal capability set: a provider that cannot refund simply does not implement `refund`.
 */
export interface PaymentProvider {
  readonly profile: IntegrationProfile;
  createIntent(input: CreateIntentInput): Promise<{ providerRef: string; qrPayload?: string; expiresAt: string }>;
  query(ref: { intentId: string; providerRef?: string | null }): Promise<ProviderState>;
  refund?(input: { refundId: string; intentId: string; providerRef?: string | null; amountMinor: string; reason: string }): Promise<RefundResult>;
  queryRefund?(ref: { refundId: string }): Promise<RefundResult | { status: 'not_found' }>;
}
/** The only signature scheme implemented is ours (for the emulator). A real provider's scheme must be implemented from ITS documentation, then named in the profile; until then its webhooks are refused. */
export const IMPLEMENTED_SCHEMES = new Set(['mekoniq-hmac-sha256-v1']);
export type VerifiedPaymentEvent = { eventId: string; intentId: string };
export function verifyPaymentWebhook(profile: IntegrationProfile, secret: string, rawBody: string, headers: { get(name: string): string | null }, nowMs: number): VerifiedPaymentEvent {
  const hook = profile.webhook;
  if (!hook || !IMPLEMENTED_SCHEMES.has(hook.signatureScheme)) throw new Error('SIGNATURE_SCHEME_UNSUPPORTED');
  const verdict = verifyWebhook({ secret, rawBody, signature: headers.get('x-mekoniq-signature'), timestamp: headers.get('x-mekoniq-timestamp'), nowMs, toleranceMs: Math.min(hook.timestampToleranceSeconds * 1000, WEBHOOK_TOLERANCE_MS) });
  if (!verdict.ok) throw new Error(verdict.code === 'TIMESTAMP_OUT_OF_WINDOW' ? 'TIMESTAMP_EXPIRED' : 'INVALID_SIGNATURE');
  let body: Record<string, unknown>;
  try { body = JSON.parse(rawBody) as Record<string, unknown>; } catch { throw new Error('INVALID_BODY'); }
  const eventId = body[hook.eventIdField], intentId = body.reference;
  if (typeof eventId !== 'string' || !eventId || eventId.length > 128 || typeof intentId !== 'string' || !/^[0-9a-f-]{36}$/i.test(intentId)) throw new Error('INVALID_BODY');
  return { eventId, intentId: intentId.toLowerCase() };
}
