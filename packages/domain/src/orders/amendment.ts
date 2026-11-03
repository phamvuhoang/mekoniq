import type { ModuleRegistry } from '../modules';
import type { CommandEnvelope, Decision, JsonObject, Snapshot } from '../../../contracts/src/index';
import { allocateMinor } from '../shared/money';
import { summarize } from '../pricing/quote';
import { amount, changed, created, done, expectVersion, fail, handle, quantity, requireState, stableId, text } from '../restaurant-context';
import { assertMutableOrder, lineReferences } from './order';
import { sessionForOrder, ticketsFor } from './commands';
import { wasteOnDispose } from '../inventory/ready';

const AMOUNT_KEYS = ['subtotalMinor', 'discountMinor', 'serviceMinor', 'taxMinor', 'taxIncludedMinor'] as const;
/** Cumulative share of a priced amount for `part` of `whole` units. Two-bucket largest remainder = round half up, so shares are monotone in `part`, and part===whole is exactly `total`. */
const share = (total: unknown, part: bigint, whole: bigint): bigint => part === 0n ? 0n : part === whole ? BigInt(String(total ?? 0)) : BigInt(allocateMinor(String(total ?? 0), [part, whole - part])[0]!);
/** Amounts of `cancelled` units of a line, taken from its immutable snapshot (never from the current menu); total follows the same identity quoteOrder uses. */
export function cancelledAmounts(line: JsonObject, cancelled: bigint): JsonObject {
  const whole = BigInt(String(line.quantity)), part = Object.fromEntries(AMOUNT_KEYS.map(key => [key, share(line[key], cancelled, whole)]));
  const total = part.subtotalMinor! - part.discountMinor! + part.serviceMinor! + part.taxMinor!;
  return { ...Object.fromEntries(AMOUNT_KEYS.map(key => [key, String(part[key])])), totalMinor: String(cancelled === whole ? BigInt(String(line.totalMinor)) : total) };
}

/**
 * Order.Amend, line-cancel branch {lineId,cancelQuantity,reason,expectedVersion}. Cancelled quantity is taken from prepared-but-unallocated
 * portions first (the kitchen must then decide their fate via Kitchen.DisposePrepared) and only then from unprepared ones, which are cancelled
 * outright and announced to the station with a delta ticket. Allocated/served portions can never be cancelled here. Nothing is deleted:
 * the line keeps its snapshot and gains cancelledQuantity/cancelled/cancellations.
 */
export function cancelOrderLine(c: CommandEnvelope, s: Snapshot[]): Decision {
  if (c.payload.items !== undefined || c.payload.discountIds !== undefined) return fail('AMBIGUOUS_AMENDMENT');
  const lineId = text(c.payload.lineId), portion = requireState(s, 'fulfillment', lineId), ticket = requireState(s, 'kitchen-ticket', lineId);
  const group = [ticket, ...ticketsFor(s, lineId).filter(t => t.ref.id !== lineId).sort((a, b) => a.ref.id.localeCompare(b.ref.id))];
  const order = requireState(s, 'order', String(portion.state.orderId));
  if (c.payload.orderId !== undefined && c.payload.orderId !== order.ref.id) return fail('NOT_FOUND');
  expectVersion(c, order); assertMutableOrder(order.state);
  const session = sessionForOrder(s, order.state) ?? fail('NOT_FOUND');
  if (session.state.status !== 'open' || session.state.frozenBillId) return fail('SESSION_FROZEN');
  const reason = text(c.payload.reason, 'REASON_REQUIRED'), n = BigInt(quantity(c.payload.cancelQuantity));
  const lines = lineReferences(order.state), index = lines.findIndex(l => l.id === lineId), line = lines[index] ?? fail('NOT_FOUND');
  const before = BigInt(String(line.cancelledQuantity ?? '0')), after = before + n;
  if (after > BigInt(String(line.quantity))) return fail('CANCEL_EXCEEDS_ORDER');
  const big = (state: JsonObject, key: string): bigint => BigInt(String(state[key] ?? '0'));
  const allocated = big(portion.state, 'allocated'), eff = (t: Snapshot): bigint => big(t.state, 'prepared') - big(t.state, 'cancelledPrepared');
  if (big(portion.state, 'ready') - allocated < 0n) return fail('ALLOCATION_CORRUPT');
  // Each station decides for itself: what it already made (and nobody took) comes off first and needs a disposition from THAT station; the rest leaves its queue.
  // The guest-facing counts follow the stations' minimum, so a combo done at one station only is still "not ready" yet its food can be disposed of.
  const plan = group.map(t => { const free = eff(t) - allocated, p = free <= 0n ? 0n : free < n ? free : n; return { t, p, u: n - p }; });
  if (plan.some(x => x.u > big(x.t.state, 'quantity') - big(x.t.state, 'prepared'))) return fail('FULFILLMENT_ACTIVE');
  const least = (xs: bigint[]) => xs.reduce((m, v) => v < m ? v : m), prepared = least(plan.map(x => x.p)), unprepared = n - prepared;
  const readyDrop = least(group.map(eff)) - least(plan.map(x => eff(x.t) - x.p)), held = plan.reduce((a, x) => a + x.p, 0n);

  const now = cancelledAmounts(line, after), then = cancelledAmounts(line, before);
  const reduced = BigInt(String(now.totalMinor)) - BigInt(String(then.totalMinor));
  if (reduced < 0n) return fail('INVALID_AMOUNT');
  const cancellationId = stableId('cancellation', c), deltaId = stableId('delta', c);
  const entry: JsonObject = { id: cancellationId, quantity: String(n), unprepared: String(unprepared), prepared: String(prepared), reason, at: c.recordedAt, by: c.actorRef, reducedMinor: String(reduced) };
  const next = lines.map((l, i) => i === index ? { ...l, cancelledQuantity: String(after), cancelled: now, cancellations: [...((l.cancellations ?? []) as JsonObject[]), entry] } : l);
  const emptied = next.every(l => BigInt(String(l.cancelledQuantity ?? '0')) === BigInt(String(l.quantity)));
  const total = amount(String(summarize(next).totalMinor));

  const wanted = BigInt(String(line.quantity)) - after;
  const events = [
    changed('OrderLineCancelled', order, { lines: next, totalMinor: total, summary: summarize(next), ...(emptied ? { status: 'cancelled', cancellationReason: reason } : {}) }),
    changed(emptied ? 'SessionOrderCancelled' : 'SessionOrderAmended', session, {}),
    changed('FulfillmentLineReduced', portion, { quantity: String(big(portion.state, 'quantity') - unprepared), ready: String(big(portion.state, 'ready') - readyDrop), held: String(big(portion.state, 'held') + held), cancelledQuantity: String(big(portion.state, 'cancelledQuantity') + n), ...(wanted === 0n ? { status: 'cancelled' } : {}) }),
  ];
  const requests: { stationId: string; id: string; quantity: bigint }[] = [];
  for (const { t, p, u } of plan) {
    const q = big(t.state, 'quantity') - u, primary = t.ref.id === lineId, stationId = String(t.state.stationId);
    events.push(changed('KitchenTicketReduced', t, { quantity: String(q), cancelledQuantity: String(big(t.state, 'cancelledQuantity') + n), cancelledPrepared: String(big(t.state, 'cancelledPrepared') + p), status: wanted === 0n ? 'cancelled' : big(t.state, 'prepared') === q ? 'ready' : t.state.status }));
    const base = { lineId, orderId: order.ref.id, sessionId: String(order.state.sessionId), stationId, ticketId: t.ref.id, name: line.name!, reason };
    // A held (not yet fired) ticket never reached the station, so there is nothing to acknowledge.
    if (u > 0n && t.state.status !== 'held') events.push(created('KitchenDeltaCreated', 'kitchen-delta', primary ? deltaId : stableId('delta', c, t.ref.id), { ...base, kind: 'cancel', quantity: String(u), status: 'pending', createdBy: c.actorRef, createdAt: c.recordedAt }));
    if (p > 0n) { const id = primary ? cancellationId : stableId('cancellation', c, t.ref.id); requests.push({ stationId, id, quantity: p }); events.push(created('KitchenCancellationRequested', 'kitchen-cancellation', id, { ...base, quantity: String(p), status: 'requested', disposition: null, requestedBy: c.actorRef, requestedAt: c.recordedAt })); }
  }
  const primaryPlan = plan[0]!;
  return done(events, { orderId: order.ref.id, lineId, cancelledQuantity: String(n), unprepared: String(unprepared), prepared: String(prepared), reducedMinor: String(reduced), totalMinor: total, ...(primaryPlan.u > 0n && primaryPlan.t.state.status !== 'held' ? { deltaId } : {}), ...(requests.length ? { cancellationId: requests[0]!.id, cancellations: requests.map(r => ({ ...r, quantity: String(r.quantity) })) } : {}) });
}

const DISPOSITIONS: Record<string, string> = { return: 'PreparedFoodReturned', waste: 'PreparedFoodDiscarded', manual: 'PreparedFoodManuallyHandled' };
export function registerAmendments(registry: ModuleRegistry): void {
  handle(registry, 'Kitchen.AckDelta', (c, s) => {
    const delta = requireState(s, 'kitchen-delta', text(c.payload.deltaId)); expectVersion(c, delta);
    if (c.payload.stationId !== delta.state.stationId) return fail('STATION_FORBIDDEN');
    if (delta.state.status !== 'pending') return fail('DELTA_ACKNOWLEDGED');
    return done([changed('KitchenDeltaAcknowledged', delta, { status: 'acknowledged', acknowledgedBy: c.actorRef, acknowledgedAt: c.recordedAt })], { deltaId: delta.ref.id });
  });
  // The only way prepared food leaves a cancelled line: an explicit, recorded choice. Nothing here runs automatically.
  handle(registry, 'Kitchen.DisposePrepared', (c, s) => {
    const request = requireState(s, 'kitchen-cancellation', text(c.payload.cancellationId)); expectVersion(c, request);
    if (c.payload.stationId !== request.state.stationId) return fail('STATION_FORBIDDEN');
    if (request.state.status !== 'requested') return fail('CANCELLATION_RESOLVED');
    const disposition = String(c.payload.disposition), eventType = DISPOSITIONS[disposition] ?? fail('INVALID_DISPOSITION');
    const note = disposition === 'manual' ? text(c.payload.note, 'DISPOSITION_NOTE_REQUIRED') : typeof c.payload.note === 'string' ? text(c.payload.note) : null;
    const portion = requireState(s, 'fulfillment', String(request.state.lineId)), count = BigInt(String(request.state.quantity)), held = BigInt(String(portion.state.held ?? '0'));
    if (held < count) return fail('ALLOCATION_CORRUPT');
    const disposed = { ...((portion.state.disposed ?? {}) as JsonObject) };
    disposed[disposition] = String(BigInt(String(disposed[disposition] ?? '0')) + count);
    return done([changed(eventType, request, { status: 'resolved', disposition, note, resolvedBy: c.actorRef, resolvedAt: c.recordedAt }), changed('HeldPortionsDisposed', portion, { held: String(held - count), disposed }),
      // thrown-away cooked food is waste in the stock ledger in the same decision (never a restock, never a second deduction)
      ...(disposition === 'waste' ? wasteOnDispose(c, s, String(request.state.lineId), count, request.ref.id, note ?? 'prepared food discarded', typeof request.state.ticketId === 'string' ? request.state.ticketId : undefined) : [])], { cancellationId: request.ref.id, disposition });
  });
}
