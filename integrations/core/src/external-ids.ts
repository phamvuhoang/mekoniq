import { createHash } from 'node:crypto';
import { canonicalize } from 'json-canonicalize';
const PART = /^[A-Za-z0-9._-]{1,60}$/;
export type ExternalIdentity = { provider: string; merchantId: string; externalId: string };
/** The identity a channel order has everywhere (cloud row, venue aggregate): channel + merchant + the channel's own id. Anything else about the payload may change without making it a new order. */
export function externalIdentity(i: ExternalIdentity): ExternalIdentity {
  if (!PART.test(i.provider) || !PART.test(i.merchantId) || !PART.test(i.externalId)) throw new Error('INVALID_EXTERNAL_IDENTITY');
  return { provider: i.provider, merchantId: i.merchantId, externalId: i.externalId };
}
/** Hash of the canonical (RFC 8785) normalized order, so "same event again" and "same id, different content" can be told apart. */
export const payloadFingerprint = (normalized: unknown): string => createHash('sha256').update(canonicalize(normalized as never)).digest('hex');
export type ReceiptClass = 'new' | 'duplicate' | 'conflict';
export function classifyReceipt(existingHash: string | null | undefined, incomingHash: string): ReceiptClass {
  return existingHash == null ? 'new' : existingHash === incomingHash ? 'duplicate' : 'conflict';
}
