import type { ExternalIdentity } from './external-ids';
export type NormalizedOrder = ExternalIdentity & { items: { itemId: string; quantity: string }[]; currency: string; declaredTotalMinor?: string; expiresAt: string; sandbox: boolean };
export type VerifiedEvent = { provider: string; rawBody: string; body: Record<string, unknown> };
/** What we ask a channel to do. `idempotencyKey` is stable per intent, so asking twice cannot act twice if the channel honours it, and `query` can find the first attempt if it does not. */
export type EffectIntent = { idempotencyKey: string; kind: 'order.accepted' | 'order.rejected' | 'order.expired'; identity: ExternalIdentity; reason?: string };
export type EffectResult =
  | { status: 'confirmed'; providerRef: string }
  | { status: 'rejected'; code: string }
  | { status: 'rate_limited'; retryAfterMs: number }
  | { status: 'not_found' };
/**
 * A channel integration. `verify` and `normalize` are pure over the received bytes; `execute` talks to the channel and may THROW (timeout, network) — the caller must then treat the outcome as
 * unknown and `query` before sending again. A provider-specific port may add capabilities in W10; there is no universal "refund" here.
 */
export interface Connector {
  readonly profile: ConnectorProfile;
  normalize(verified: VerifiedEvent): NormalizedOrder;
  execute(intent: EffectIntent): Promise<EffectResult>;
  query(intent: Pick<EffectIntent, 'idempotencyKey' | 'identity'>): Promise<EffectResult>;
}
export type ConnectorProfile = { id: string; label: string; sandbox: boolean; enabled: boolean; authentication: 'hmac' | 'none'; certified: boolean };
/** A real channel is enabled only by a W10 certification result; until then it is listed and refused. Only the sandbox profiles run. */
export const connectorProfiles: Record<string, ConnectorProfile> = {
  'sandbox-channel': { id: 'sandbox-channel', label: 'Sandbox channel', sandbox: true, enabled: true, authentication: 'hmac', certified: false },
  'web-sandbox': { id: 'web-sandbox', label: 'Web checkout (sandbox)', sandbox: true, enabled: true, authentication: 'none', certified: false },
  'zalo-mini-app': { id: 'zalo-mini-app', label: 'Zalo Mini App', sandbox: false, enabled: false, authentication: 'hmac', certified: false },
  'delivery-marketplace': { id: 'delivery-marketplace', label: 'Delivery marketplace', sandbox: false, enabled: false, authentication: 'hmac', certified: false },
};
export function profileFor(provider: string): ConnectorProfile {
  const profile = connectorProfiles[provider];
  if (!profile) throw new Error('PROVIDER_NOT_FOUND');
  if (!profile.enabled || (!profile.sandbox && !profile.certified)) throw new Error('PROVIDER_NOT_ENABLED');
  return profile;
}
