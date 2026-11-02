import type { ModuleRegistry } from '../modules';
import type { CommandEnvelope, Decision, JsonObject, JsonValue, Snapshot } from '../../../contracts/src/index';
import { all, changed, created, done, expectVersion, fail, handle, requireState, stableId, text } from '../restaurant-context';
import { guestContext, trustedNowMs } from './guest-token';

/** A repeat within this window adds nothing (no new alert); after it an open call is re-raised (count+1), a handled one starts a new call. */
export const CALL_COOLDOWN_MS = 30000;
const ISSUE_CATEGORIES = ['food', 'service', 'robot', 'safety', 'cleanliness', 'other'];
const note = (value: JsonValue | undefined): string | null => value === undefined ? null : typeof value === 'string' && value.trim().length > 0 && value.length <= 280 ? value.trim() : fail('INVALID_NOTE');
/**
 * Guest.CallStaff / .RequestBill / .ReportIssue raise a service-call alert for the guest's own session only. Calls of one kind (and issue
 * category) coalesce per session; the operation receipt makes a retried request idempotent. A bill request is only an alert: it never
 * prepares, settles or closes a bill.
 */
function raise(kind: string, detail: (c: CommandEnvelope) => JsonObject) {
  return (c: CommandEnvelope, s: Snapshot[]): Decision => {
    const extra = detail(c), g = guestContext(c, s), nowMs = trustedNowMs(s);
    const mine = all(s, 'service-call').filter(x => x.state.sessionId === g.session.ref.id && x.state.kind === kind && x.state.category === (extra.category ?? null));
    const latest = mine.sort((a, b) => Number(b.state.lastRequestedAtMs) - Number(a.state.lastRequestedAtMs))[0];
    if (latest && nowMs - Number(latest.state.lastRequestedAtMs) < CALL_COOLDOWN_MS) return done([], { callId: latest.ref.id, coalesced: true, cooldown: true });
    const open = mine.find(x => x.state.status === 'open'), at = new Date(nowMs).toISOString();
    if (open) return done([changed('ServiceCallRepeated', open, { count: Number(open.state.count) + 1, lastRequestedAtMs: nowMs, lastRequestedAt: at })], { callId: open.ref.id, coalesced: true });
    const id = stableId('call', c);
    return done([created('ServiceCallRequested', 'service-call', id, { kind, category: null, note: null, ...extra, sessionId: g.session.ref.id, tableId: g.session.state.tableId!, channel: g.channel, status: 'open', count: 1, requestedAt: at, lastRequestedAt: at, lastRequestedAtMs: nowMs, requestedBy: c.actorRef })], { callId: id, coalesced: false });
  };
}
export function registerServiceCalls(registry: ModuleRegistry): void {
  handle(registry, 'Guest.CallStaff', raise('staff', c => ({ note: note(c.payload.reason) })));
  handle(registry, 'Guest.RequestBill', raise('bill', () => ({})));
  handle(registry, 'Guest.ReportIssue', raise('issue', c => {
    const category = String(c.payload.category);
    return { category: ISSUE_CATEGORIES.includes(category) ? category : fail('INVALID_CATEGORY'), note: note(c.payload.note) };
  }));
  // Acknowledging only marks the alert handled; bills, payments and the session are untouched.
  handle(registry, 'Guest.AcknowledgeCall', (c, s) => {
    const call = requireState(s, 'service-call', text(c.payload.callId)); expectVersion(c, call);
    if (call.state.status !== 'open') return fail('CALL_ACKNOWLEDGED');
    return done([changed('ServiceCallAcknowledged', call, { status: 'acknowledged', acknowledgedBy: c.actorRef, acknowledgedAt: c.recordedAt })], { callId: call.ref.id });
  });
}
