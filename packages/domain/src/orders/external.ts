import type { ModuleRegistry } from '../modules';
import type { CommandEnvelope, Decision, JsonObject, Snapshot } from '../../../contracts/src/index';
import { currentMenu } from '../catalog/menu';
import { quoteForCommand } from '../pricing/quote';
import { cancelOrderDecision, placeOrder } from './module';
import { changed, created, done, fail, find, handle, requireState, text } from '../restaurant-context';
const PART = /^[A-Za-z0-9._-]{1,60}$/;
/** One external order = one aggregate, named by the channel's own identity (provider, merchant, external id): the same event can never become a second order here. */
export function externalOrderId(provider: string, merchantId: string, externalId: string): string {
  if (!PART.test(provider) || !PART.test(merchantId) || !PART.test(externalId)) return fail('INVALID_EXTERNAL_IDENTITY');
  return `ext:${provider}:${merchantId}:${externalId}`;
}
const expired = (state: JsonObject, at: string): boolean => Date.parse(String(state.expiresAt)) <= Date.parse(at);
/** Price an external basket from OUR menu: whatever price the channel sent is only compared with the answer, never used. */
function quoteBasket(c: CommandEnvelope, s: Snapshot[], items: unknown, currency: unknown) {
  const quoted = quoteForCommand({ ...c, payload: { items: items as JsonObject[], currency: currency as string, menuVersion: currentMenu(s).state.version as number, channel: String(c.payload.provider ?? 'external') } }, s);
  return quoted;
}
/**
 * ExternalOrder.Receive {provider,merchantId,externalId,payloadHash,items:[{itemId,quantity}],currency,declaredTotalMinor?,expiresAt,sandbox?}: the venue records the channel's request after pricing it
 * itself. This is NOT an order and nothing goes to the kitchen: staff (or policy) accepts it with ExternalOrder.Accept. A replay with the same payload is a no-op; the same identity with a
 * different payload is refused (the cloud quarantines it), and a total the channel declared that differs from our price is AMOUNT_MISMATCH.
 */
export function registerExternalOrders(registry: ModuleRegistry): void {
  handle(registry, 'ExternalOrder.Receive', (c, s): Decision => {
    const provider = text(c.payload.provider), merchantId = text(c.payload.merchantId), externalId = text(c.payload.externalId), id = externalOrderId(provider, merchantId, externalId);
    const payloadHash = text(c.payload.payloadHash, 'INVALID_PAYLOAD_HASH'), prior = find(s, 'external-order', id);
    if (prior) return prior.state.payloadHash === payloadHash ? done([], { externalOrderId: id, status: String(prior.state.status), duplicate: true }) : fail('EXTERNAL_ORDER_PAYLOAD_CONFLICT');
    const expiresAt = text(c.payload.expiresAt, 'INVALID_EXPIRY');
    if (!Number.isFinite(Date.parse(expiresAt))) return fail('INVALID_EXPIRY');
    if (Date.parse(expiresAt) <= Date.parse(c.recordedAt)) return fail('EXTERNAL_ORDER_EXPIRED'); // arrived after its own deadline: refused, never parked as if still live
    const quoted = quoteBasket(c, s, c.payload.items, c.payload.currency);
    if (c.payload.declaredTotalMinor !== undefined && c.payload.declaredTotalMinor !== quoted.totalMinor) return fail('AMOUNT_MISMATCH');
    return done([created('ExternalOrderReceived', 'external-order', id, { provider, merchantId, externalId, payloadHash, items: c.payload.items!, currency: quoted.currency, totalMinor: quoted.totalMinor, menuVersion: quoted.menuVersion, status: 'received',
      expiresAt, sandbox: c.payload.sandbox === true, receivedAt: c.recordedAt })], { externalOrderId: id, totalMinor: quoted.totalMinor });
  });
  // ExternalOrder.Accept {externalOrderId,sessionId}: a person at the venue takes the request into an open session (a counter/pickup table). Only now is there an order and a kitchen ticket.
  handle(registry, 'ExternalOrder.Accept', (c, s): Decision => {
    const ext = requireState(s, 'external-order', text(c.payload.externalOrderId));
    if (ext.state.status === 'accepted') return done([], { externalOrderId: ext.ref.id, orderId: String(ext.state.orderId), duplicate: true });
    if (ext.state.status !== 'received') return fail('EXTERNAL_ORDER_NOT_PENDING');
    if (expired(ext.state, c.recordedAt)) return fail('EXTERNAL_ORDER_EXPIRED');
    const quoted = quoteBasket({ ...c, payload: { ...c.payload, provider: ext.state.provider! } }, s, ext.state.items, ext.state.currency);
    if (quoted.totalMinor !== ext.state.totalMinor) return fail('EXTERNAL_PRICE_CHANGED'); // the menu moved since we answered the channel: never charge a different amount than we agreed
    const session = requireState(s, 'session', text(c.payload.sessionId)), orderId = `order-${ext.ref.id}`;
    const placed = placeOrder({ ...c, payload: { sessionId: session.ref.id, tableId: session.state.tableId!, menuVersion: quoted.menuVersion, items: ext.state.items!, currency: ext.state.currency!, orderId, channel: String(ext.state.provider) } }, s,
      { channel: String(ext.state.provider), externalOrderId: ext.ref.id, ...(ext.state.sandbox ? { sandbox: true } : {}) });
    if (!placed.ok) return placed;
    return done([...placed.events, changed('ExternalOrderAccepted', ext, { status: 'accepted', orderId, acceptedBy: c.actorRef, acceptedAt: c.recordedAt })], { externalOrderId: ext.ref.id, orderId });
  });
  handle(registry, 'ExternalOrder.Reject', (c, s): Decision => {
    const ext = requireState(s, 'external-order', text(c.payload.externalOrderId)), reason = text(c.payload.reason, 'REASON_REQUIRED');
    if (ext.state.status === 'rejected') return done([], { externalOrderId: ext.ref.id, duplicate: true });
    if (ext.state.status !== 'received') return fail('EXTERNAL_ORDER_NOT_PENDING');
    return done([changed('ExternalOrderRejected', ext, { status: 'rejected', rejectionReason: reason, rejectedBy: c.actorRef, rejectedAt: c.recordedAt })], { externalOrderId: ext.ref.id });
  });
  // ExternalOrder.Expire: the deadline passed without an answer. An accepted order is never expired away.
  handle(registry, 'ExternalOrder.Expire', (c, s): Decision => {
    const ext = requireState(s, 'external-order', text(c.payload.externalOrderId));
    if (ext.state.status === 'expired') return done([], { externalOrderId: ext.ref.id, duplicate: true });
    if (ext.state.status !== 'received') return fail('EXTERNAL_ORDER_NOT_PENDING');
    if (!expired(ext.state, c.recordedAt)) return fail('EXTERNAL_ORDER_NOT_EXPIRED');
    return done([changed('ExternalOrderExpired', ext, { status: 'expired', expiredAt: c.recordedAt })], { externalOrderId: ext.ref.id });
  });
  // ExternalOrder.Cancel {externalOrderId,reason}: the CHANNEL asks to cancel. Not yet accepted -> simply cancelled. Accepted -> the same rules as cancelling any order (nothing a station already
  // made or allocated is thrown away silently: REQUIRES_DISPOSITION / FULFILLMENT_ACTIVE come back and the channel is told it was refused).
  handle(registry, 'ExternalOrder.Cancel', (c, s): Decision => {
    const ext = requireState(s, 'external-order', text(c.payload.externalOrderId)), reason = text(c.payload.reason, 'REASON_REQUIRED');
    if (ext.state.status === 'cancelled') return done([], { externalOrderId: ext.ref.id, duplicate: true });
    if (ext.state.status === 'received') return done([changed('ExternalOrderCancelled', ext, { status: 'cancelled', cancellationReason: reason, cancelledAt: c.recordedAt })], { externalOrderId: ext.ref.id });
    if (ext.state.status !== 'accepted') return fail('EXTERNAL_ORDER_NOT_PENDING');
    const order = requireState(s, 'order', String(ext.state.orderId)), cancelled = cancelOrderDecision({ ...c, payload: { orderId: order.ref.id, reason, expectedVersion: order.version } }, s);
    if (!cancelled.ok) return cancelled;
    return done([...cancelled.events, changed('ExternalOrderCancelled', ext, { status: 'cancelled', cancellationReason: reason, cancelledAt: c.recordedAt })], { externalOrderId: ext.ref.id, orderId: order.ref.id });
  });
}
