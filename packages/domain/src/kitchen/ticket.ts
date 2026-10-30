import type { ModuleRegistry } from '../modules';
import { changed, done, expectVersion, fail, handle, quantity, requireState, text } from '../restaurant-context';
import { preparedQuantity } from './readiness';
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
  const portion=requireState(s,'fulfillment',ticket.ref.id);
  return done([changed('KitchenPortionsReady',ticket,{prepared,status:prepared===ticket.state.quantity?'ready':'partially_ready'}),changed('ReadyQuantityAdded',portion,{ready:String(BigInt(String(portion.state.ready))+BigInt(String(c.payload.quantity)))})],{lineId:ticket.ref.id,prepared});
 });
}
