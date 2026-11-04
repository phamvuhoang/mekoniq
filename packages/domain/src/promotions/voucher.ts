import type { ModuleRegistry } from '../modules';
import type { JsonObject } from '../../../contracts/src/index';
import { changed, created, done, fail, find, handle, text } from '../restaurant-context';
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const count = (v: unknown, code = 'INVALID_LIMIT'): number => Number.isInteger(v) && (v as number) > 0 && (v as number) <= 1_000_000_000 ? v as number : fail(code);
export function registerVouchers(registry: ModuleRegistry): void {
  // Voucher.Issue {voucherId,limit,promotionId?,scope?,perCustomerLimit?,validFrom?,validTo?,restoreOnRefund?}: `scope` is this venue's id (default) or `shared`
  // (a pool several venues draw on — only through an exclusive allocation, see GrantEscrow). validFrom/validTo are inclusive VENUE business dates.
  handle(registry, 'Voucher.Issue', (c, s) => {
    const id = text(c.payload.voucherId), limit = count(c.payload.limit);
    if (find(s, 'voucher', id)) return fail('VOUCHER_EXISTS');
    const promotionId = c.payload.promotionId === undefined ? undefined : text(c.payload.promotionId);
    if (promotionId && !find(s, 'promotion', promotionId)) return fail('PROMOTION_UNKNOWN');
    const from = c.payload.validFrom, to = c.payload.validTo;
    if ((from !== undefined && !isDate(from)) || (to !== undefined && !isDate(to)) || (isDate(from) && isDate(to) && from > to)) return fail('INVALID_VALIDITY');
    const scope = c.payload.scope === undefined ? c.venueId : text(c.payload.scope);
    if (scope !== 'shared' && scope !== c.venueId) return fail('VOUCHER_SCOPE_DENIED');
    return done([created('VoucherIssued', 'voucher', id, { ...(promotionId ? { promotionId } : {}), scope, limit, remaining: limit, ...(c.payload.perCustomerLimit === undefined ? {} : { perCustomerLimit: count(c.payload.perCustomerLimit) }),
      ...(from ? { validFrom: from } : {}), ...(to ? { validTo: to } : {}), restoreOnRefund: c.payload.restoreOnRefund === true, status: 'active', escrow: {}, issuedBy: c.actorRef, issuedAt: c.occurredAt })], { voucherId: id });
  });
  // Voucher.GrantEscrow {voucherId,venueId,count}: moves `count` uses from the shared pool into one venue's exclusive allocation (revision bumps). Only an allocated venue may spend a
  // shared voucher while it cannot reach the authority; the pool never gives away more than it has, so venues cannot jointly overspend.
  handle(registry, 'Voucher.GrantEscrow', (c, s) => {
    const v = find(s, 'voucher', text(c.payload.voucherId)) ?? fail('NOT_FOUND'), n = count(c.payload.count, 'INVALID_COUNT'), venue = text(c.payload.venueId);
    if (v.state.scope !== 'shared') return fail('VOUCHER_NOT_SHARED');
    if (Number(v.state.remaining) < n) return fail('VOUCHER_EXHAUSTED');
    const escrow = { ...((v.state.escrow ?? {}) as Record<string, JsonObject>) }, prev = escrow[venue] ?? { count: 0, revision: 0 };
    escrow[venue] = { count: Number(prev.count) + n, revision: Number(prev.revision) + 1 };
    return done([changed('VoucherEscrowGranted', v, { remaining: Number(v.state.remaining) - n, escrow: escrow as JsonObject })], { voucherId: v.ref.id, revision: escrow[venue]!.revision as number });
  });
  // Voucher.ReceiveEscrow {voucherId,total,revision,limit?,promotionId?,validFrom?,validTo?,restoreOnRefund?}: the chain authority (cloud) tells this venue its CUMULATIVE share of a shared pool.
  // Cumulative + revision make a retry or a missed earlier message harmless: a revision not newer than the slot's is a no-op, a newer one adds only the part not yet received.
  handle(registry, 'Voucher.ReceiveEscrow', (c, s) => {
    const id = text(c.payload.voucherId), total = count(c.payload.total, 'INVALID_COUNT'), revision = count(c.payload.revision, 'INVALID_REVISION');
    const v = find(s, 'voucher', id);
    if (v && v.state.scope !== 'shared') return fail('VOUCHER_NOT_SHARED');
    const escrow = { ...(((v?.state.escrow) ?? {}) as Record<string, JsonObject>) }, prev = escrow[c.venueId] ?? { count: 0, revision: 0, granted: 0 };
    if (revision <= Number(prev.revision)) return done([], { voucherId: id, revision: Number(prev.revision), duplicate: true });
    const received = Number(prev.granted ?? 0);
    if (total < received) return fail('ESCROW_TOTAL_REGRESSED');
    escrow[c.venueId] = { ...prev, count: Number(prev.count) + (total - received), granted: total, revision };
    if (v) return done([changed('VoucherEscrowReceived', v, { escrow: escrow as JsonObject })], { voucherId: id, revision });
    const from = c.payload.validFrom, to = c.payload.validTo;
    if ((from !== undefined && !isDate(from)) || (to !== undefined && !isDate(to)) || (isDate(from) && isDate(to) && from > to)) return fail('INVALID_VALIDITY');
    const promotionId = c.payload.promotionId === undefined ? undefined : text(c.payload.promotionId);
    if (promotionId && !find(s, 'promotion', promotionId)) return fail('PROMOTION_UNKNOWN');
    return done([created('VoucherEscrowReceived', 'voucher', id, { ...(promotionId ? { promotionId } : {}), scope: 'shared', limit: count(c.payload.limit ?? total), remaining: 0, ...(from ? { validFrom: from } : {}), ...(to ? { validTo: to } : {}),
      restoreOnRefund: c.payload.restoreOnRefund === true, status: 'active', escrow: escrow as JsonObject, issuedBy: c.actorRef, issuedAt: c.occurredAt })], { voucherId: id, revision });
  });
  // Voucher.ReturnEscrow {voucherId,count,returnRevision}: gives unspent allocation back to the pool. Only unspent uses can go back (a spent one stays spent), and a repeated returnRevision is a no-op.
  handle(registry, 'Voucher.ReturnEscrow', (c, s) => {
    const v = find(s, 'voucher', text(c.payload.voucherId)) ?? fail('NOT_FOUND'), n = count(c.payload.count, 'INVALID_COUNT'), returnRevision = count(c.payload.returnRevision, 'INVALID_REVISION');
    const escrow = { ...((v.state.escrow ?? {}) as Record<string, JsonObject>) }, slot = escrow[c.venueId];
    if (!slot) return fail('ESCROW_NOT_FOUND');
    if (returnRevision <= Number(slot.returnRevision ?? 0)) return done([], { voucherId: v.ref.id, returnRevision: Number(slot.returnRevision ?? 0), duplicate: true });
    if (n > Number(slot.count)) return fail('ESCROW_INSUFFICIENT');
    escrow[c.venueId] = { ...slot, count: Number(slot.count) - n, returned: Number(slot.returned ?? 0) + n, returnRevision };
    return done([changed('VoucherEscrowReturned', v, { escrow: escrow as JsonObject })], { voucherId: v.ref.id, returnRevision });
  });
}
