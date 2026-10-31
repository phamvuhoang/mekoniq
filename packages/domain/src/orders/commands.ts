import type { CommandEnvelope, DomainEvent, JsonObject, Snapshot } from '../../../contracts/src/index';
import { created, stableId } from '../restaurant-context';
export function newOrderLines(command:CommandEnvelope,lines:JsonObject[],orderId:string,sessionId:string):{lines:JsonObject[];events:DomainEvent[]} {
 const materialized:JsonObject[]=lines.map((line,index)=>({...line,id:stableId('line',command,String(index)),orderId,sessionId}));
 const events=materialized.flatMap(line=>[
  created('KitchenTicketCreated','kitchen-ticket',String(line.id),{lineId:line.id!,orderId,sessionId,stationId:line.stationId!,name:line.name!,quantity:line.quantity!,prepared:'0',status:'queued'}),
  created('FulfillmentLineCreated','fulfillment',String(line.id),{lineId:line.id!,orderId,sessionId,stationId:line.stationId!,quantity:line.quantity!,ready:'0',allocated:'0',served:'0',status:'open'})
 ]);
 return {lines:materialized,events};
}
export function sessionForOrder(snapshots:Snapshot[],state:JsonObject):Snapshot|undefined { return snapshots.find(s=>s.ref.kind==='session'&&s.ref.id===state.sessionId); }
