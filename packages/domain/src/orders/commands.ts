import type { CommandEnvelope, DomainEvent, JsonObject, Snapshot } from '../../../contracts/src/index';
import { created, fail, stableId } from '../restaurant-context';
/** Course (1..9) the guest asked for on payload.items[index]; course 1 (default) fires at once, later courses wait for Order.SendCourse. */
function courseOf(command:CommandEnvelope,line:JsonObject):number {
 const raw=(Array.isArray(command.payload.items)?(command.payload.items[Number(line.index)] as JsonObject|undefined):undefined)?.course;
 if(raw===undefined) return 1;
 return typeof raw==='number'&&Number.isInteger(raw)&&raw>=1&&raw<=9 ? raw : fail('INVALID_COURSE');
}
export function newOrderLines(command:CommandEnvelope,lines:JsonObject[],orderId:string,sessionId:string):{lines:JsonObject[];events:DomainEvent[]} {
 const materialized:JsonObject[]=lines.map((line,index)=>({...line,id:stableId('line',command,String(index)),orderId,sessionId,course:courseOf(command,line)}));
 const events=materialized.flatMap(line=>[
  created('KitchenTicketCreated','kitchen-ticket',String(line.id),{lineId:line.id!,orderId,sessionId,stationId:line.stationId!,name:line.name!,quantity:line.quantity!,prepared:'0',course:line.course!,status:line.course===1?'queued':'held'}),
  created('FulfillmentLineCreated','fulfillment',String(line.id),{lineId:line.id!,orderId,sessionId,stationId:line.stationId!,quantity:line.quantity!,ready:'0',allocated:'0',served:'0',status:'open'})
 ]);
 return {lines:materialized,events};
}
export function sessionForOrder(snapshots:Snapshot[],state:JsonObject):Snapshot|undefined { return snapshots.find(s=>s.ref.kind==='session'&&s.ref.id===state.sessionId); }
