import type { ModuleRegistry } from '../modules';
import { all, changed, done, expectVersion, fail, handle, requireState, text } from '../restaurant-context';
import { assertUncollected, billSessions } from './bill';

/**
 * Bill.Void {billId,expectedVersion,reason}: cancels a bill document that never took money (a captured payment is never voided; it is refunded).
 * Its orders go back to open and its sessions are unfrozen so staff can amend and prepare again. A split child cannot be voided while a sibling
 * still holds part of the same orders: merge the children back first, so no share of the table is silently dropped.
 */
export function registerBillVoid(registry: ModuleRegistry): void {
  handle(registry, 'Bill.Void', (c, s) => {
    const bill = requireState(s, 'bill', text(c.payload.billId)); expectVersion(c, bill); assertUncollected(s, bill);
    const reason = text(c.payload.reason, 'REASON_REQUIRED'), sessions = billSessions(bill.state), orderIds = (bill.state.orderIds ?? []) as string[];
    if (all(s, 'bill').some(b => b.ref.id !== bill.ref.id && ['prepared', 'closed'].includes(String(b.state.status)) && (billSessions(b.state).some(id => sessions.includes(id)) || ((b.state.orderIds ?? []) as string[]).some(id => orderIds.includes(id))))) return fail('SPLIT_SIBLINGS_OPEN');
    const orders = orderIds.map(id => requireState(s, 'order', id)).filter(o => o.state.status === 'billed');
    const open = sessions.map(id => requireState(s, 'session', id)).filter(x => x.state.status === 'open');
    return done([
      changed('BillVoided', bill, { status: 'voided', voidReason: reason, voidedBy: c.actorRef, voidedAt: c.recordedAt }),
      ...orders.map(o => changed('OrderUnbilled', o, { status: 'open', billId: null })),
      ...open.map(x => changed('SessionBillReleased', x, { frozenBillId: null })),
    ], { billId: bill.ref.id, status: 'voided' });
  });
}
