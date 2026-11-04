import { KEY_HEADER, SIGNATURE_HEADER, TIMESTAMP_HEADER, signWebhook, verifyWebhook, type WebhookVerdict } from '../../core/src/webhook-signature';
export { verifyWebhook, signWebhook, type WebhookVerdict };
type HeaderBag = { get(name: string): string | null };
/** Verify a MEKONIQ-signed request on the EXACT bytes received (do not re-serialise parsed JSON). */
export function verifyRequest(secret: string, rawBody: string, headers: HeaderBag, nowMs = Date.now()): WebhookVerdict {
  return verifyWebhook({ secret, rawBody, signature: headers.get(SIGNATURE_HEADER), timestamp: headers.get(TIMESTAMP_HEADER), nowMs });
}
/** Headers a partner sends with a signed webhook to `/v1/channels/:provider/webhooks`. */
export function signRequest(keyId: string, secret: string, rawBody: string, nowMs = Date.now()): Record<string, string> {
  return { [KEY_HEADER]: keyId, [TIMESTAMP_HEADER]: String(nowMs), [SIGNATURE_HEADER]: signWebhook(secret, nowMs, rawBody), 'content-type': 'application/json' };
}
