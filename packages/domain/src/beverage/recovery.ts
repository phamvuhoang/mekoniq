// Disposition of a coffee job that will not be delivered. Physical consumption is never rolled back blindly: booked stock becomes waste, a step whose
// outcome is unknown or failed without a measurement becomes an open stock exception, and only reservations of steps that never started are released.
// Unknown commands are never resent; leases are freed only by cancel-before-action or by a human reconciliation.
import type {CommandEnvelope,DomainEvent,JsonObject,Snapshot} from '../../../contracts/src/index';
import {all,changed,created,find,stableId} from '../restaurant-context';
import {sourceId} from '../inventory/movement';
import {wasteOnDispose} from '../inventory/ready';
import {release,wasteJob} from './resources';
import type {CoffeeJob} from './job';
import {ownerOf,type Cup,type Party} from './transfer';
/** Events for a job that just became cancelled or quarantined (`job` is the decided state; mutated for its reservations/leases). */
export function dispose(c:CommandEnvelope,s:Snapshot[],job:CoffeeJob,reason:string,o:{cupLocation?:Party;human?:boolean}={}):DomainEvent[] {
 const events:DomainEvent[]=[];
 for(const r of job.reservations){
  if(r.status!=='reserved')continue;
  const step=job.steps.find(x=>x.id===r.stepId);
  if(step?.status==='pending'){r.status='released';continue;}
  // dispensed or possibly dispensed, quantity unknown: the books keep the question open instead of guessing either way
  r.status='consumption_unknown';
  const id=sourceId('exc',`coffee:${job.jobId}:${r.stepId}:${r.ingredientId}`);
  if(!find(s,'stock-exception',id))events.push(created('StockExceptionOpened','stock-exception',id,{sourceEventId:`coffee:${job.jobId}:${r.stepId}`,recipeVersion:job.recipeKey,quantity:r.baseQuantity,reason:'COFFEE_CONSUMPTION_UNKNOWN',status:'open',openedAt:c.occurredAt,jobId:job.jobId,ingredientId:r.ingredientId}));
 }
 if(job.disposition!=='reusable')events.push(...wasteJob(c,s,job,reason),...wasteOnDispose(c,s,job.lineId,1n,`coffee:${job.jobId}`,reason,undefined,job.jobId));
 events.push(...release(c,s,job.leases,job.jobId));job.leases=[];
 if(job.qualityConfirmedBy)events.push(...withdrawReady(c,s,job,reason));
 const snap=find(s,'cup',job.cupId);
 if(snap){
  const cup=snap.state as unknown as Cup,change:JsonObject={disposition:job.disposition};
  // a human placed the cup somewhere known: that is one audited movement; otherwise the last known owner is retained
  if(o.cupLocation){change.ownerKind=o.cupLocation.kind;change.ownerId=o.cupLocation.id;change.slot=null;change.epoch=cup.epoch+1;change.movements=[...cup.movements,{transferId:stableId('reconcile',c,job.jobId),from:ownerOf(cup),to:o.cupLocation,provenance:'human',observedBy:c.actorRef,at:c.recordedAt,reason}] as unknown as JsonObject[];}
  if(cup.pendingTransfer&&o.human){change.pendingTransfer=null;change.unresolvedTransfer={...cup.pendingTransfer,resolvedBy:c.actorRef,reason} as unknown as JsonObject;}
  events.push(changed('CupDisposed',snap,change));
 }
 return events;
}
/**
 * A drink that passed quality but will not be delivered takes its readiness back, so the line is neither allocatable nor servable for a drink that no
 * longer exists, and a remake can be made for the guest. Unallocated ready first; else a reserved (not yet loaded) allocation of the line is released.
 * A portion already loaded on a robot keeps its readiness: the mission's own return/handoff flow owns it (recorded on the job).
 */
function withdrawReady(c:CommandEnvelope,s:Snapshot[],job:CoffeeJob,reason:string):DomainEvent[] {
 const ticket=find(s,'kitchen-ticket',job.lineId),portion=find(s,'fulfillment',job.lineId);
 if(!ticket||!portion){job.kitchenReadiness='unknown_line';return [];}
 const big=(v:unknown)=>BigInt(String(v??'0')),ready=big(portion.state.ready),allocated=big(portion.state.allocated),events:DomainEvent[]=[];
 let update:JsonObject;
 const assigned=all(s,'allocation').find(x=>x.state.lineId===job.lineId&&['reserved','loaded'].includes(String(x.state.status))&&((x.state.coffeeJobIds??[]) as string[]).includes(job.jobId));
 if(assigned?.state.status==='loaded'){job.kitchenReadiness='retained_for_mission_return';return [];}
 if(!assigned&&ready-allocated>=1n)update={ready:String(ready-1n)};
 else{
  const a=assigned??all(s,'allocation').find(x=>x.state.lineId===job.lineId&&x.state.status==='reserved'&&!x.state.coffeeJobIds);
  if(!a){job.kitchenReadiness='retained_for_mission_return';return [];}
  const left=big(a.state.quantity)-1n;
  events.push(changed('AllocationReleased',a,{status:left>0n?'reserved':'cancelled',quantity:String(left>0n?left:big(a.state.quantity)),...a.state.coffeeJobIds?{coffeeJobIds:(a.state.coffeeJobIds as string[]).filter(id=>id!==job.jobId)}:{},updatedAt:c.recordedAt,releaseReason:'COFFEE_WITHDRAWN',jobId:job.jobId}));
  update={ready:String(ready-1n),allocated:String(allocated-1n)};
 }
 const prepared=big(ticket.state.prepared)-1n;
 job.kitchenReadiness='withdrawn';
 return [...events,changed('ReadyPortionWithdrawn',portion,{...update,withdrawn:String(big(portion.state.withdrawn)+1n)}),
  changed('PreparedPortionWithdrawn',ticket,{prepared:String(prepared),withdrawn:String(big(ticket.state.withdrawn)+1n),status:prepared===0n?'queued':'partially_ready',lastWithdrawal:{jobId:job.jobId,reason,by:c.actorRef,at:c.recordedAt}})];
}
