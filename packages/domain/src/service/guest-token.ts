import type { ModuleRegistry } from '../modules';
import type { CommandEnvelope, JsonObject, Snapshot } from '../../../contracts/src/index';
import { canonicalBytes, parseJsonStrict, verifyEs256, type PublicEcJwk } from '../../../contracts/src/index';
import { changed, created, done, fail, find, handle, record, requireState, stableId, text } from '../restaurant-context';
import { placeOrder } from '../orders/module';
import type { MissionStop } from '../fleet/stop';

/**
 * Guest table token: a capability the venue coordinator signs (same key and commit-time signing as settlement grants), scoped to
 * org/venue/session/table/session revision/channel with an expiry. It is never a Supabase JWT and never a staff session.
 * Session.Move/Merge/Close and Bill.Close bump the session revision, so a token issued for an earlier seating is dead.
 */
const CAPABILITY = ['schemaVersion', 'id', 'organizationId', 'venueId', 'sessionId', 'tableId', 'revision', 'channel', 'issuerDeviceId', 'issuerDeviceEpoch', 'issuerEpoch', 'issuedAt', 'expiresAt', 'expiresAtMs'];
export function guestTokenCapability(token: JsonObject): JsonObject {
  const capability = Object.fromEntries(CAPABILITY.map(key => [key, token[key]]));
  if (Object.values(capability).some(value => value === undefined)) throw new Error('GUEST_TOKEN_INVALID');
  return capability as JsonObject;
}
export function guestSessionValid(token: { sessionId: string; revision: number }, session: { id: string; revision: number; status: string }) {
  return token.sessionId === session.id && token.revision === session.revision && session.status === 'open';
}
const base64url = (value: string) => btoa(String.fromCharCode(...new TextEncoder().encode(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
/** The opaque string a guest holds (QR/URL): the signed capability only, nothing else from the stored aggregate. */
export const encodeGuestToken = (state: JsonObject): string => base64url(JSON.stringify({ ...guestTokenCapability(state), signature: text(state.signature, 'GUEST_TOKEN_UNSIGNED') }));
export function decodeGuestToken(token: string): JsonObject {
  try {
    if (!/^[A-Za-z0-9_-]{16,2048}$/.test(token)) throw new Error();
    const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
    const parsed = record(parseJsonStrict(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(b64 + '='.repeat((4 - b64.length % 4) % 4)), ch => ch.charCodeAt(0))), 4096));
    guestTokenCapability(parsed); text(parsed.signature);
    return parsed;
  } catch { throw new Error('GUEST_TOKEN_INVALID'); }
}

/** The only commands a guest surface may submit, and the only payload fields each keeps: session/table/robot ids and coupons never pass. */
const guestApi: Record<string, { type: string; fields: string[] }> = {
  'Order.Place': { type: 'Guest.PlaceOrder', fields: ['items', 'menuVersion'] },
  'Guest.CallStaff': { type: 'Guest.CallStaff', fields: ['reason'] },
  'Guest.RequestBill': { type: 'Guest.RequestBill', fields: [] },
  'Guest.ReportIssue': { type: 'Guest.ReportIssue', fields: ['category', 'note'] },
};
export const guestCommandTypes = new Set(Object.values(guestApi).map(g => g.type));
/** Shared by the cloud guest API and the lab: token string + guest intent -> the envelope type/payload the venue authorizes and verifies. */
export function guestCommand(token: string, type: string, payload: JsonObject): { type: string; payload: JsonObject; tokenId: string } {
  const api = guestApi[type];
  if (!api) throw new Error('GUEST_COMMAND_FORBIDDEN');
  const guestToken = decodeGuestToken(token);
  return { type: api.type, payload: { ...Object.fromEntries(api.fields.filter(f => payload[f] !== undefined).map(f => [f, payload[f]!])), guestToken }, tokenId: String(guestToken.id) };
}

const authorityOf = (s: Snapshot[]) => requireState(s, '__scope__', 'authority').state;
export const trustedNowMs = (s: Snapshot[]): number => { const now = authorityOf(s).nowMs; return typeof now === 'number' && Number.isSafeInteger(now) ? now : fail('TRUSTED_CLOCK_REQUIRED'); };
export type GuestContext = { session: Snapshot; channel: string; tokenId?: string; robotId?: string };
/**
 * Who a guest command speaks for: a verified token (QR/kiosk), or the robot screen paired (Robot.PairDisplay) with the submitting
 * device while its robot waits at a table. Payload session/table/robot ids are never read.
 */
export function guestContext(c: CommandEnvelope, s: Snapshot[]): GuestContext {
  if (c.payload.guestToken !== undefined) {
    const t = record(c.payload.guestToken), authority = authorityOf(s);
    let capability: JsonObject;
    try { capability = guestTokenCapability(t); } catch { return fail('GUEST_TOKEN_INVALID'); }
    if (t.organizationId !== c.organizationId || t.venueId !== c.venueId || t.schemaVersion !== 1) return fail('GUEST_TOKEN_INVALID');
    if (t.issuerDeviceId !== authority.ownerDeviceId || t.issuerDeviceEpoch !== authority.deviceEpoch || t.issuerEpoch !== authority.coordinatorEpoch) return fail('GUEST_TOKEN_INVALID');
    if (typeof t.signature !== 'string' || !verifyEs256(canonicalBytes(capability), t.signature, record(authority.publicJwk) as PublicEcJwk)) return fail('GUEST_TOKEN_INVALID');
    if (find(s, 'guest-token', String(t.id))?.state.signature !== t.signature) return fail('GUEST_TOKEN_INVALID');
    if (trustedNowMs(s) >= Number(t.expiresAtMs)) return fail('GUEST_TOKEN_EXPIRED');
    const session = find(s, 'session', String(t.sessionId));
    if (!session || session.state.tableId !== t.tableId || !guestSessionValid({ sessionId: String(t.sessionId), revision: Number(t.revision) }, { id: session.ref.id, revision: Number(session.state.revision ?? 0), status: String(session.state.status) })) return fail('SESSION_EXPIRED');
    return { session, channel: String(t.channel), tokenId: String(t.id) };
  }
  const pairing = find(s, 'robot-display', c.deviceId) ?? fail('GUEST_TOKEN_REQUIRED');
  const robot = requireState(s, 'robot', String(pairing.state.robotId)), mission = robot.state.missionId ? find(s, 'mission', String(robot.state.missionId)) : undefined;
  const stop = ((mission?.state.stops ?? []) as MissionStop[]).find(x => x.id === mission?.state.currentStopId);
  const table = stop?.status === 'awaiting_action' ? find(s, 'table', stop.targetId) : undefined;
  const session = table?.state.activeSessionId ? find(s, 'session', String(table.state.activeSessionId)) : undefined;
  if (!session || session.state.status !== 'open') return fail('ROBOT_NOT_AT_TABLE');
  return { session, channel: 'robot', robotId: robot.ref.id };
}
export function registerGuestTokens(registry: ModuleRegistry): void {
  // Staff issue a token for an open session; the store signs the capability at commit, so the handler never holds a key.
  handle(registry, 'Guest.IssueToken', (c, s) => {
    const session = requireState(s, 'session', text(c.payload.sessionId));
    if (session.state.status !== 'open') return fail('SESSION_CLOSED');
    const channel = c.payload.channel ?? 'qr';
    if (channel !== 'qr' && channel !== 'kiosk') return fail('INVALID_CHANNEL');
    const ttl = c.payload.ttlMs ?? 43200000;
    if (typeof ttl !== 'number' || !Number.isSafeInteger(ttl) || ttl < 60000 || ttl > 86400000) return fail('INVALID_TOKEN_TTL');
    const authority = authorityOf(s), nowMs = trustedNowMs(s), id = stableId('guest-token', c), expiresAtMs = nowMs + ttl;
    if (find(s, 'guest-token', id)) return fail('TOKEN_EXISTS');
    const token: JsonObject = { schemaVersion: 1, id, organizationId: c.organizationId, venueId: c.venueId, sessionId: session.ref.id, tableId: session.state.tableId!, revision: Number(session.state.revision ?? 0), channel, issuerDeviceId: text(authority.ownerDeviceId), issuerDeviceEpoch: text(authority.deviceEpoch), issuerEpoch: c.coordinatorEpoch, issuedAt: new Date(nowMs).toISOString(), expiresAt: new Date(expiresAtMs).toISOString(), expiresAtMs, issuedBy: c.actorRef, signature: '' };
    return done([created('GuestTokenIssued', 'guest-token', id, token)], { tokenId: id, sessionId: session.ref.id, channel, expiresAt: token.expiresAt! });
  });
  // Guests (and kiosk/robot screens) order only for the session their token or paired robot resolves; never with coupons.
  handle(registry, 'Guest.PlaceOrder', (c, s) => {
    if (c.payload.discountIds !== undefined) return fail('DISCOUNT_FORBIDDEN');
    const g = guestContext(c, s);
    return placeOrder({ ...c, payload: { items: c.payload.items ?? null, menuVersion: c.payload.menuVersion ?? null, sessionId: g.session.ref.id, tableId: g.session.state.tableId! } }, s, { channel: g.channel, ...(g.tokenId ? { guestTokenId: g.tokenId } : {}), ...(g.robotId ? { robotId: g.robotId } : {}) });
  });
  // The robot screen's identity is this venue record keyed by the authenticated device id, never a robotId from a URL or payload of the screen.
  handle(registry, 'Robot.PairDisplay', (c, s) => {
    const deviceId = text(c.payload.deviceId), robot = requireState(s, 'robot', text(c.payload.robotId)), device = requireState(s, 'device', deviceId);
    if (device.state.status !== 'active') return fail('DEVICE_NOT_ACTIVE');
    const current = find(s, 'robot-display', deviceId), state = { robotId: robot.ref.id, pairedBy: c.actorRef, pairedAt: c.recordedAt };
    return done([current ? changed('RobotDisplayPaired', current, state) : created('RobotDisplayPaired', 'robot-display', deviceId, { deviceId, ...state })], { deviceId, robotId: robot.ref.id });
  });
}
