import type { ModuleRegistry } from '../modules';
import type { CommandEnvelope, Decision, JsonObject, Snapshot } from '../../../contracts/src/index';
import { currentMenu } from '../catalog/menu';
import { quoteForCommand, summarize } from '../pricing/quote';
import { assertMutableOrder, lineReferences } from './order';
import { newOrderLines, sessionForOrder, ticketsFor } from './commands';
import { cancelOrderLine } from './amendment';
import { amount, changed, created, done, expectVersion, fail, find, handle, requireState, stableId, text } from '../restaurant-context';
/** Order.Place for a session/table the caller already resolved; `extra` (e.g. guest channel) is recorded on the order. */
export function placeOrder(c:CommandEnvelope,s:Snapshot[],extra:JsonObject={}):Decision {
 const sessionId=text(c.payload.sessionId), session=requireState(s,'session',sessionId);
 if(session.state.status!=='open') return fail('SESSION_CLOSED');
 if(session.state.frozenBillId) return fail('SESSION_FROZEN');
 if(c.payload.tableId!==session.state.tableId) return fail('TABLE_SESSION_MISMATCH');
 const menu=currentMenu(s);
 if(c.payload.menuVersion!==menu.state.version) return fail('STALE_QUOTE');
 const uses:Snapshot[]=[], quoted=quoteForCommand(c,s,uses), orderId=c.payload.orderId ? text(c.payload.orderId) : stableId('order',c);
 if(find(s,'order',orderId)) return fail('ORDER_EXISTS');
 const materialized=newOrderLines(c,quoted.lines as JsonObject[],orderId,sessionId);
 const state={sessionId,tableId:session.state.tableId!,menuVersion:menu.state.version!,currency:quoted.currency!,lines:materialized.lines,totalMinor:quoted.totalMinor,summary:summarize(materialized.lines),status:'open',policyRevision:c.policyRevision,occurredAt:c.occurredAt,...extra};
 return done([created('OrderAccepted','order',orderId,state),...uses.map(u=>changed('VoucherAppliedToOrder',u,{orderId})),changed('SessionOrderAdded',session,{orderIds:[...((session.state.orderIds ?? []) as string[]),orderId]}),...materialized.events],{orderId,lineIds:materialized.lines.map(l=>l.id),sessionId});
}
/** The rules for cancelling an order that is still open: nothing a station already made, nothing allocated, nothing ready/served/held — those need an explicit disposition first. */
export function cancelOrderDecision(c:CommandEnvelope,s:Snapshot[]):Decision {
  const order=requireState(s,'order',text(c.payload.orderId)); expectVersion(c,order); assertMutableOrder(order.state);
  const reason=text(c.payload.reason,'REASON_REQUIRED');
  const lines=lineReferences(order.state);
  const portions=lines.map(line=>requireState(s,'fulfillment',String(line.id))), tickets=lines.flatMap(line=>ticketsFor(s,String(line.id)));
  if(tickets.some(t=>BigInt(String(t.state.prepared??'0'))>0n)) return fail('REQUIRES_DISPOSITION'); // food a station already made, even a part of a combo, needs an explicit decision
  if(portions.some(p=>BigInt(String(p.state.allocated))>0n)) return fail('FULFILLMENT_ACTIVE');
  if(portions.some(p=>BigInt(String(p.state.ready))+BigInt(String(p.state.served))+BigInt(String(p.state.held ?? '0'))>0n)) return fail('REQUIRES_DISPOSITION');
  const session=sessionForOrder(s,order.state);
  const events=[changed('OrderCancelled',order,{status:'cancelled',cancellationReason:reason}),...portions.map(p=>changed('FulfillmentCancelled',p,{status:'cancelled'})),...tickets.map(t=>changed('KitchenTicketCancelled',t,{status:'cancelled'}))];
  if(session) events.push(changed('SessionOrderCancelled',session,{}));
  return done(events,{orderId:order.ref.id});
}
export function registerOrders(registry:ModuleRegistry):void {
 handle(registry,'Order.Place',(c,s)=>placeOrder(c,s));
 handle(registry,'Order.Amend',(c,s)=>{
  if(c.payload.lineId!==undefined) return cancelOrderLine(c,s); // line-cancel branch; otherwise add items
  const order=requireState(s,'order',text(c.payload.orderId)); expectVersion(c,order); assertMutableOrder(order.state);
  const session=sessionForOrder(s,order.state) ?? fail('NOT_FOUND');
  if(session.state.status!=='open' || session.state.frozenBillId) return fail('SESSION_FROZEN');
  const menu=currentMenu(s);
  if(c.payload.menuVersion!==undefined && c.payload.menuVersion!==menu.state.version) return fail('STALE_QUOTE');
  const uses:Snapshot[]=[], quoted=quoteForCommand(c,s,uses);
  if(quoted.currency!==order.state.currency) return fail('CURRENCY_MISMATCH');
  const materialized=newOrderLines(c,quoted.lines as JsonObject[],order.ref.id,String(order.state.sessionId));
  const total=amount(String(BigInt(String(order.state.totalMinor))+BigInt(String(quoted.totalMinor)))), lines=[...lineReferences(order.state),...materialized.lines];
  return done([changed('OrderAmended',order,{lines,totalMinor:total,summary:summarize(lines)}),...uses.map(u=>changed('VoucherAppliedToOrder',u,{orderId:order.ref.id})),changed('SessionOrderAmended',session,{}),...materialized.events],{orderId:order.ref.id,lineIds:materialized.lines.map(l=>l.id)});
 });
 handle(registry,'Order.Cancel',(c,s)=>cancelOrderDecision(c,s));
}
