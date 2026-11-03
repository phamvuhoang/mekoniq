import type { ModuleRegistry } from '../modules';
import type { CommandEnvelope, Decision, JsonObject, Snapshot } from '../../../contracts/src/index';
import { allocateMinor } from '../shared/money';
import { summarize } from '../pricing/quote';
import { amount, changed, created, done, expectVersion, fail, handle, quantity, requireState, stableId, text } from '../restaurant-context';
import { assertMutableOrder, lineReferences } from './order';
import { sessionForOrder } from './commands';
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
  const free = big(portion.state, 'ready') - big(portion.state, 'allocated');
  if (free < 0n) return fail('ALLOCATION_CORRUPT');
  const prepared = n < free ? n : free, unprepared = n - prepared;
  if (unprepared > big(ticket.state, 'quantity') - big(ticket.state, 'prepared')) return fail('FULFILLMENT_ACTIVE');

  const now = cancelledAmounts(line, after), then = cancelledAmounts(line, before);
  const reduced = BigInt(String(now.totalMinor)) - BigInt(String(then.totalMinor));
  if (reduced < 0n) return fail('INVALID_AMOUNT');
  const cancellationId = stableId('cancellation', c), deltaId = stableId('delta', c);
  const entry: JsonObject = { id: cancellationId, quantity: String(n), unprepared: String(unprepared), prepared: String(prepared), reason, at: c.recordedAt, by: c.actorRef, reducedMinor: String(reduced) };
  const next = lines.map((l, i) => i === index ? { ...l, cancelledQuantity: String(after), cancelled: now, cancellations: [...((l.cancellations ?? []) as JsonObject[]), entry] } : l);
  const emptied = next.every(l => BigInt(String(l.cancelledQuantity ?? '0')) === BigInt(String(l.quantity)));
  const total = amount(String(summarize(next).totalMinor));

  const kitchenQuantity = big(ticket.state, 'quantity') - unprepared, cancelledPrepared = big(ticket.state, 'cancelledPrepared') + prepared;
  const wanted = BigInt(String(line.quantity)) - after;
  const held = ticket.state.status === 'held';
  const events = [
    changed('OrderLineCancelled', order, { lines: next, totalMinor: total, summary: summarize(next), ...(emptied ? { status: 'cancelled', cancellationReason: reason } : {}) }),
    changed(emptied ? 'SessionOrderCancelled' : 'SessionOrderAmended', session, {}),
    changed('KitchenTicketReduced', ticket, { quantity: String(kitchenQuantity), cancelledQuantity: String(big(ticket.state, 'cancelledQuantity') + n), cancelledPrepared: String(cancelledPrepared), status: wanted === 0n ? 'cancelled' : big(ticket.state, 'prepared') === kitchenQuantity ? 'ready' : ticket.state.status }),
    changed('FulfillmentLineReduced', portion, { quantity: String(big(portion.state, 'quantity') - unprepared), ready: String(big(portion.state, 'ready') - prepared), held: String(big(portion.state, 'held') + prepared), cancelledQuantity: String(big(portion.state, 'cancelledQuantity') + n), ...(wanted === 0n ? { status: 'cancelled' } : {}) }),
  ];
  const base = { lineId, orderId: order.ref.id, sessionId: String(order.state.sessionId), stationId: ticket.state.stationId!, name: line.name!, reason };
  // A held (not yet fired) ticket never reached the station, so there is nothing to acknowledge.
  if (unprepared > 0n && !held) events.push(created('KitchenDeltaCreated', 'kitchen-delta', deltaId, { ...base, kind: 'cancel', quantity: String(unprepared), status: 'pending', createdBy: c.actorRef, createdAt: c.recordedAt }));
  if (prepared > 0n) events.push(created('KitchenCancellationRequested', 'kitchen-cancellation', cancellationId, { ...base, quantity: String(prepared), status: 'requested', disposition: null, requestedBy: c.actorRef, requestedAt: c.recordedAt }));
  return done(events, { orderId: order.ref.id, lineId, cancelledQuantity: String(n), unprepared: String(unprepared), prepared: String(prepared), reducedMinor: String(reduced), totalMinor: total, ...(unprepared > 0n && !held ? { deltaId } : {}), ...(prepared > 0n ? { cancellationId } : {}) });
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
      ...(disposition === 'waste' ? wasteOnDispose(c, s, String(request.state.lineId), count, request.ref.id, note ?? 'prepared food discarded') : [])], { cancellationId: request.ref.id, disposition });
  });
}
