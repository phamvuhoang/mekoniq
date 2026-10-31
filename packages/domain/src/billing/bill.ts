import type { ModuleRegistry } from '../modules';
import type { JsonObject } from '../../../contracts/src/index';
import type { Snapshot } from '../../../contracts/src/index';
import { all, amount, changed, created, done, expectVersion, fail, find, handle, requireState, stableId, text } from '../restaurant-context';
import { dueMinor } from './settlement';
import { pricingRevisions, summarize } from '../pricing/quote';
/** Sessions a bill covers: a merged bill can cover several, a seeded/legacy bill none. */
export const billSessions=(bill:JsonObject):string[]=>Array.isArray(bill.sessionIds)?bill.sessionIds as string[]:typeof bill.sessionId==='string'?[bill.sessionId]:[];
/** A bill that may take money now: prepared, not reserved by an offline grant, no external charge in pending/unknown. */
export function assertCollectable(s:Snapshot[],bill:Snapshot):void {
 if(bill.state.status==='closed') return fail('BILL_CLOSED');
 if(bill.state.status!=='prepared') return fail('BILL_STATE_CONFLICT');
 if(bill.state.collectionLocked===true || all(s,'grant').some(g=>g.state.billId===bill.ref.id&&g.state.status!=='reconciled')) return fail('GRANT_UNRECONCILED');
 if(['unknown','pending'].includes(String(bill.state.externalPaymentState))||all(s,'payment').some(p=>p.state.billId===bill.ref.id&&['unknown','pending'].includes(String(p.state.status)))) return fail('PAYMENT_UNRESOLVED');
}
/** Split, merge and void only touch bills that never took money (a failed charge took none). */
export function assertUncollected(s:Snapshot[],bill:Snapshot):void {
 assertCollectable(s,bill);
 if(['paidMinor','refundedMinor','unappliedMinor'].some(k=>BigInt(String(bill.state[k] ?? '0'))!==0n)||all(s,'payment').some(p=>p.state.billId===bill.ref.id&&p.state.status!=='failed')) return fail('BILL_HAS_PAYMENTS');
}
export function registerBills(registry:ModuleRegistry):void {
 handle(registry,'Bill.Prepare',(c,s)=>{
  const session=requireState(s,'session',text(c.payload.sessionId));
  if(session.state.status!=='open') return fail('SESSION_CLOSED');
  if(session.state.frozenBillId) return fail('BILL_ALREADY_PREPARED');
  const orders=all(s,'order').filter(o=>o.state.sessionId===session.ref.id&&o.state.status==='open');
  if(!orders.length) return fail('NO_OPEN_ORDERS');
  const currencies=new Set(orders.map(o=>o.state.currency));
  if(currencies.size!==1) return fail('CURRENCY_MISMATCH');
  const total=amount(String(orders.reduce((sum,o)=>sum+BigInt(String(o.state.totalMinor)),0n)));
  const billId=c.payload.billId ? text(c.payload.billId) : stableId('bill',c);
  if(find(s,'bill',billId)) return fail('BILL_EXISTS');
  const lines=orders.flatMap(o=>(o.state.lines ?? []) as JsonObject[]);
  return done([created('BillPrepared','bill',billId,{sessionId:session.ref.id,tableId:session.state.tableId!,currency:String(orders[0]!.state.currency),totalMinor:total,paidMinor:'0',refundedMinor:'0',status:'prepared',orderIds:orders.map(o=>o.ref.id),lines,summary:summarize(lines),pricingRevisions:pricingRevisions(lines),preparedAt:c.recordedAt}),changed('SessionBillFrozen',session,{frozenBillId:billId}),...orders.map(o=>changed('OrderBilled',o,{status:'billed',billId}))],{billId,totalMinor:total,currency:String(orders[0]!.state.currency)});
 });
 handle(registry,'Bill.Close',(c,s)=>{
  const bill=requireState(s,'bill',text(c.payload.billId)); expectVersion(c,bill);
  if(bill.state.status==='closed') return fail('BILL_CLOSED');
  if(bill.state.status!=='prepared') return fail('BILL_STATE_CONFLICT');
  if(BigInt(dueMinor(String(bill.state.totalMinor),String(bill.state.paidMinor),String(bill.state.refundedMinor ?? '0')))!==0n) return fail('BALANCE_DUE');
  if(bill.state.collectionLocked===true || all(s,'grant').some(g=>g.state.billId===bill.ref.id&&g.state.status!=='reconciled')) return fail('GRANT_UNRECONCILED');
  if(bill.state.externalPaymentState==='unknown'||bill.state.externalPaymentState==='pending') return fail('PAYMENT_UNRESOLVED');
  const orderIds=(bill.state.orderIds ?? []) as string[];
  const orders=orderIds.map(id=>requireState(s,'order',id));
  const lineIds=orders.flatMap(o=>((o.state.lines ?? []) as JsonObject[]).map(l=>l.id));
  if(all(s,'kitchen-cancellation').some(x=>lineIds.includes(x.state.lineId)&&x.state.status==='requested')) return fail('DISPOSITION_PENDING');
  if(all(s,'allocation').some(a=>lineIds.includes(a.state.lineId)&&['reserved','loaded','unknown','returning'].includes(String(a.state.status)))) return fail('FULFILLMENT_UNRESOLVED');
  // A split sibling (or any other prepared bill over the same orders/sessions) keeps them open until it is settled too.
  const others=all(s,'bill').filter(b=>b.ref.id!==bill.ref.id&&b.state.status==='prepared');
  const events=[changed('BillClosed',bill,{status:'closed',closedAt:c.recordedAt}),...orders.filter(o=>!others.some(b=>((b.state.orderIds ?? []) as string[]).includes(o.ref.id))).map(o=>changed('OrderClosed',o,{status:'closed'}))];
  for(const sessionId of billSessions(bill.state)) {
   if(others.some(b=>billSessions(b.state).includes(sessionId))) continue;
   const session=requireState(s,'session',sessionId);
   if(all(s,'order').some(o=>o.state.sessionId===session.ref.id && !orderIds.includes(o.ref.id)&&o.state.status==='open')) return fail('LATE_ORDER_UNRESOLVED');
   events.push(changed('SessionClosed',session,{status:'closed'}));
   const table=requireState(s,'table',String(session.state.tableId));
   events.push(changed('TableReleased',table,{activeSessionId:null}));
  }
  return done(events,{billId:bill.ref.id,status:'closed'});
 });
}
