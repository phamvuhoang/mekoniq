import type { ModuleRegistry } from '../modules';
import { changed, created, done, expectVersion, fail, find, handle, quantity, requireState, stableId, text } from '../restaurant-context';
export function availablePortions(ready:string,allocated:string):string {
 const value=BigInt(ready)-BigInt(allocated);
 if(value<0n) return fail('ALLOCATION_CORRUPT');
 return String(value);
}
export function registerAllocations(registry:ModuleRegistry):void {
 handle(registry,'Fulfillment.Allocate',(c,s)=>{
  const line=requireState(s,'fulfillment',text(c.payload.lineId)); expectVersion(c,line);
  if(line.state.status==='cancelled') return fail('ORDER_CANCELLED');
  const count=quantity(c.payload.quantity);
  if(BigInt(count)>BigInt(availablePortions(String(line.state.ready),String(line.state.allocated)))) return fail('INSUFFICIENT_READY');
  const id=c.payload.allocationId ? text(c.payload.allocationId) : stableId('allocation',c);
  if(find(s,'allocation',id)) return fail('ALLOCATION_EXISTS');
  return done([changed('PortionAllocated',line,{allocated:String(BigInt(String(line.state.allocated))+BigInt(count))}),created('AllocationCreated','allocation',id,{lineId:line.ref.id,quantity:count,status:'reserved',stationId:line.state.stationId ?? 'kitchen',sessionId:line.state.sessionId ?? '',method:c.payload.method ?? 'manual'})],{allocationId:id,lineId:line.ref.id,quantity:count});
 });
}
