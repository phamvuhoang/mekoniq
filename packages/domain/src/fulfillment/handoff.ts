import type { ModuleRegistry } from '../modules';
import { changed, done, expectVersion, fail, handle, requireState, text } from '../restaurant-context';
export function registerHandOff(registry:ModuleRegistry):void {
 handle(registry,'Fulfillment.HandOff',(c,s)=>{
  const allocation=requireState(s,'allocation',text(c.payload.allocationId)); expectVersion(c,allocation);
  if(allocation.state.missionId) return fail('MISSION_CONFIRMATION_REQUIRED');
  if(allocation.state.status!=='reserved') return fail('ALLOCATION_STATE_CONFLICT');
  const portion=requireState(s,'fulfillment',String(allocation.state.lineId)),count=BigInt(String(allocation.state.quantity));
  if(BigInt(String(portion.state.allocated))<count || BigInt(String(portion.state.ready))<count) return fail('ALLOCATION_CORRUPT');
  return done([changed('ManualDeliveryHandedOff',allocation,{status:'served',servedAt:c.recordedAt}),changed('PortionServed',portion,{ready:String(BigInt(String(portion.state.ready))-count),allocated:String(BigInt(String(portion.state.allocated))-count),served:String(BigInt(String(portion.state.served))+count)})],{allocationId:allocation.ref.id});
 });
}
