import type { CommandEnvelope, DomainEvent, JsonObject, Snapshot } from '../../../contracts/src/index';
import { created, fail, stableId } from '../restaurant-context';
/** Course (1..9) the guest asked for on payload.items[index]; course 1 (default) fires at once, later courses wait for Order.SendCourse. */
function courseOf(command:CommandEnvelope,line:JsonObject):number {
 const raw=(Array.isArray(command.payload.items)?(command.payload.items[Number(line.index)] as JsonObject|undefined):undefined)?.course;
 if(raw===undefined) return 1;
 return typeof raw==='number'&&Number.isInteger(raw)&&raw>=1&&raw<=9 ? raw : fail('INVALID_COURSE');
}
/**
 * Tickets of one priced line. A plain line has one. A combo whose parts are made at different stations gets one ticket per station: the combo's own station keeps the ticket under the
 * line id (with the parts it makes), every other station gets `<line>~<station>` for its parts. All of them carry `lineId` (the order line) and the parts with their per-combo
 * quantity, so cancelling some combos later cannot change what one combo uses. The guest-facing readiness is the minimum over the line's tickets (kitchen/ticket.ts).
 */
export function ticketsOf(line:JsonObject,orderId:string,sessionId:string):DomainEvent[] {
 const status=line.course===1?'queued':'held', count=BigInt(String(line.quantity)) || 1n;
 const parts=((line.components ?? []) as JsonObject[]).map(p=>({itemId:p.itemId!,name:p.name!,stationId:String(p.stationId||line.stationId),quantity:p.quantity!,perUnit:String(BigInt(String(p.quantity))/count)}));
 const base=(id:string,stationId:string,own:boolean,components:JsonObject[]):JsonObject=>({lineId:line.id!,orderId,sessionId,...(own?{itemId:line.itemId!}:{}),stationId,name:line.name!,quantity:line.quantity!,...(Array.isArray(line.components)?{components,stockMode:String(line.comboStockMode??'parts')}:{}),prepared:'0',course:line.course!,status});
 const primary=String(line.stationId), others=[...new Set(parts.map(p=>String(p.stationId)).filter(st=>st!==primary))].sort();
 return [created('KitchenTicketCreated','kitchen-ticket',String(line.id),base(String(line.id),primary,true,parts.filter(p=>p.stationId===primary) as JsonObject[])),
  ...others.map(st=>created('KitchenTicketCreated','kitchen-ticket',`${String(line.id)}~${st}`,{...base(`${String(line.id)}~${st}`,st,false,parts.filter(p=>p.stationId===st) as JsonObject[]),parentTicket:line.id!}))];
}
/** Every kitchen ticket of an order line (the line's own plus the other stations' tickets of a combo). */
export const ticketsFor=(snapshots:Snapshot[],lineId:string):Snapshot[]=>snapshots.filter(t=>t.ref.kind==='kitchen-ticket'&&(t.ref.id===lineId||t.state.parentTicket===lineId));
export function newOrderLines(command:CommandEnvelope,lines:JsonObject[],orderId:string,sessionId:string):{lines:JsonObject[];events:DomainEvent[]} {
 const materialized:JsonObject[]=lines.map((line,index)=>({...line,id:stableId('line',command,String(index)),orderId,sessionId,course:courseOf(command,line)}));
 const events=materialized.flatMap(line=>[
  ...ticketsOf(line,orderId,sessionId),
  created('FulfillmentLineCreated','fulfillment',String(line.id),{lineId:line.id!,orderId,sessionId,stationId:line.stationId!,quantity:line.quantity!,ready:'0',allocated:'0',served:'0',status:'open'})
 ]);
 return {lines:materialized,events};
}
export function sessionForOrder(snapshots:Snapshot[],state:JsonObject):Snapshot|undefined { return snapshots.find(s=>s.ref.kind==='session'&&s.ref.id===state.sessionId); }
