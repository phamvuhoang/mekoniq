import type { ModuleRegistry } from '../modules';
import { all, changed, created, done, expectVersion, fail, find, handle, quantity, requireState, stableId, text } from '../restaurant-context';
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
  const jobs=all(s,'coffee-job').filter(j=>j.state.lineId===line.ref.id),taken=new Set(all(s,'allocation').filter(a=>a.state.lineId===line.ref.id&&['reserved','loaded','served'].includes(String(a.state.status))).flatMap(a=>(a.state.coffeeJobIds??[]) as string[]));
  const coffeeJobIds=jobs.filter(j=>j.state.qualityConfirmedBy&&!['cancelled','quarantined','delivered'].includes(String(j.state.status))&&!taken.has(j.ref.id)).sort((a,b)=>a.ref.id.localeCompare(b.ref.id)).slice(0,Number(count)).map(j=>j.ref.id);
  if(jobs.length&&BigInt(coffeeJobIds.length)!==BigInt(count))return fail('COFFEE_ALLOCATION_NOT_READY');
  return done([changed('PortionAllocated',line,{allocated:String(BigInt(String(line.state.allocated))+BigInt(count))}),created('AllocationCreated','allocation',id,{lineId:line.ref.id,quantity:count,status:'reserved',stationId:line.state.stationId ?? 'kitchen',sessionId:line.state.sessionId ?? '',method:c.payload.method ?? 'manual',...jobs.length?{coffeeJobIds}:{}})],{allocationId:id,lineId:line.ref.id,quantity:count});
 });
}
