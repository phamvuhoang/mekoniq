import { createHmac, timingSafeEqual } from 'node:crypto';
/** Replay window both ways: a captured request is useless a few minutes later, and a clock a long way off is refused rather than trusted. */
export const WEBHOOK_TOLERANCE_MS = 300_000;
export const SIGNATURE_HEADER = 'x-mekoniq-signature', TIMESTAMP_HEADER = 'x-mekoniq-timestamp', KEY_HEADER = 'x-mekoniq-key-id';
/** `v1=` + HMAC-SHA256(secret, `${timestampMs}.${rawBody}`) in hex. The body is the exact bytes received — never a re-serialisation. */
export function signWebhook(secret: string, timestampMs: number, rawBody: string): string {
  return 'v1=' + createHmac('sha256', secret).update(`${timestampMs}.${rawBody}`).digest('hex');
}
export type WebhookVerdict = { ok: true } | { ok: false; code: 'INVALID_SIGNATURE' | 'TIMESTAMP_OUT_OF_WINDOW' | 'MALFORMED_SIGNATURE' };
export function verifyWebhook(input: { secret: string; rawBody: string; signature: string | null; timestamp: string | null; nowMs: number; toleranceMs?: number }): WebhookVerdict {
  if (!input.signature || !/^v1=[0-9a-f]{64}$/.test(input.signature) || !input.timestamp || !/^[0-9]{13}$/.test(input.timestamp)) return { ok: false, code: 'MALFORMED_SIGNATURE' };
  const ts = Number(input.timestamp);
  // signature first: an unauthenticated caller learns nothing about our clock window
  const expected = Buffer.from(signWebhook(input.secret, ts, input.rawBody)), given = Buffer.from(input.signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, code: 'INVALID_SIGNATURE' };
  if (Math.abs(input.nowMs - ts) > (input.toleranceMs ?? WEBHOOK_TOLERANCE_MS)) return { ok: false, code: 'TIMESTAMP_OUT_OF_WINDOW' };
  return { ok: true };
}
