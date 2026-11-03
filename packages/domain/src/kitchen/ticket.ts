import type { ModuleRegistry } from '../modules';
import type { Snapshot } from '../../../contracts/src/index';
import { changed, done, expectVersion, fail, handle, quantity, requireState, text } from '../restaurant-context';
import { preparedQuantity } from './readiness';
import { consumeOnReady } from '../inventory/ready';
import { ticketsFor } from '../orders/commands';
export function registerKitchen(registry:ModuleRegistry):void {
 handle(registry,'Kitchen.Accept',(c,s)=>{
  const ticket=requireState(s,'kitchen-ticket',text(c.payload.lineId)); expectVersion(c,ticket);
  if(c.payload.stationId!==ticket.state.stationId) return fail('STATION_FORBIDDEN');
  if(ticket.state.status!=='queued') return fail('TICKET_STATE_CONFLICT');
  return done([changed('KitchenAccepted',ticket,{status:'preparing'})],{lineId:ticket.ref.id});
 });
 handle(registry,'Kitchen.Ready',(c,s)=>{
  const ticket=requireState(s,'kitchen-ticket',text(c.payload.lineId)); expectVersion(c,ticket);
  if(c.payload.stationId!==ticket.state.stationId) return fail('STATION_FORBIDDEN');
  if(!['queued','preparing','partially_ready'].includes(String(ticket.state.status))) return fail('TICKET_STATE_CONFLICT');
  const prepared=preparedQuantity(String(ticket.state.prepared),quantity(c.payload.quantity),String(ticket.state.quantity));
  // a line may be made at several stations: the guest-facing ready count is what EVERY station has finished (the minimum), added to the fulfillment only as it grows
  const root=String(ticket.state.lineId??ticket.ref.id), portion=requireState(s,'fulfillment',root), group=ticketsFor(s,root);
  const gone=(t:Snapshot)=>BigInt(String(t.state.cancelledPrepared??'0')), after=(t:Snapshot)=>BigInt(t.ref.id===ticket.ref.id?prepared:String(t.state.prepared))-gone(t), before=(t:Snapshot)=>BigInt(String(t.state.prepared))-gone(t); // food already cancelled at a station is not ready for the guest
  const min=(f:(t:Snapshot)=>bigint)=>group.map(f).reduce((m,v)=>v<m?v:m), grown=min(after)-min(before);
  return done([changed('KitchenPortionsReady',ticket,{prepared,status:prepared===ticket.state.quantity?'ready':'partially_ready'}),changed('ReadyQuantityAdded',portion,{ready:String(BigInt(String(portion.state.ready))+grown)}),...consumeOnReady(c,s,ticket,BigInt(quantity(c.payload.quantity)),BigInt(prepared))],{lineId:ticket.ref.id,prepared});
 });
}
