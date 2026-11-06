// Cell resources: exclusive leases (machine, nozzle, arm, handoff zone), bound device state/interlocks, and stock reservation vs irreversible consumption.
import type {CommandEnvelope,DomainEvent,JsonObject,Snapshot} from '../../../contracts/src/index';
import {all,changed,created,fail,find,DomainFault} from '../restaurant-context';
import {issue,movementId,sourceId} from '../inventory/movement';
import {toStockBase,STOCK_STEP,type CoffeeRecipe} from './recipe';
import type {CoffeeJob,Reservation} from './job';
import {FINAL_JOB} from './job';
/** An observation older than this (sim/recorded time) is stale for an interlock decision. Illustrative policy value, not a hardware limit. */
export const FRESH_MS=10000;
/** Lease bookkeeping lifetime. Expiry is informational only: an expired lease still blocks every other job until it is released. */
export const LEASE_MS=15*60000;
export const leaseIds={machine:(cell:string)=>`${cell}:machine`,nozzle:(cell:string)=>`${cell}:nozzle`,arm:(cell:string)=>`${cell}:arm`,handoff:(station:string)=>`${station}:handoff`};
/** Acquire leases atomically for one job: any one held by another job (expired or not) refuses all of them. */
export function acquire(c:CommandEnvelope,s:Snapshot[],ids:string[],jobId:string):DomainEvent[] {
 const events:DomainEvent[]=[],at=Date.parse(c.recordedAt);
 for(const id of ids){
  const r=find(s,'cell-resource',id),holder=r?.state.holder;
  if(holder&&holder!==jobId)return fail('RESOURCE_HELD');
  if(holder===jobId)continue;
  const state={holder:jobId,acquiredAt:c.recordedAt,expiresAt:new Date(at+LEASE_MS).toISOString(),acquiredBy:c.actorRef};
  events.push(r?changed('CellResourceLeased',r,state):created('CellResourceLeased','cell-resource',id,state));
 }
 return events;
}
export function release(c:CommandEnvelope,s:Snapshot[],ids:string[],jobId:string):DomainEvent[] {
 return ids.map(id=>find(s,'cell-resource',id)).filter((r):r is Snapshot=>!!r&&r.state.holder===jobId).map(r=>changed('CellResourceReleased',r,{holder:null,releasedAt:c.recordedAt,releasedBy:c.actorRef}));
}
export const device=(s:Snapshot[],id:string)=>{const d=find(s,'cell-device',id)??fail('DEVICE_UNKNOWN');return d;};
export const cellDevice=(s:Snapshot[],cellId:string,role:string)=>all(s,'cell-device').find(d=>d.state.cellId===cellId&&d.state.role===role)??fail('DEVICE_UNKNOWN');
/** Feedback counts only from the observer the venue bound to that device. */
export function requireObserver(c:CommandEnvelope,d:Snapshot):void {if(d.state.observerId!==c.actorRef)fail('OBSERVER_NOT_BOUND');}
/** Interlocks of one device at this command's time: ready, fresh, not faulted, cleaning not overdue, ingredient not empty. */
export function interlock(c:CommandEnvelope,d:Snapshot):void {
 const st=d.state,now=Date.parse(c.recordedAt),cleaning=(st.cleaning??{}) as JsonObject;
 if(st.status==='fault')fail('DEVICE_FAULT');
 if(st.status!=='ready')fail(st.role==='machine'?'MACHINE_NOT_READY':'DEVICE_NOT_READY');
 if(st.observedAt===null||now-Date.parse(String(st.observedAt))>FRESH_MS)fail('INTERLOCK_STALE');
 if(cleaning.status==='overdue'||(typeof cleaning.dueAt==='string'&&Date.parse(cleaning.dueAt)<=now))fail('CLEANING_OVERDUE');
 if(st.level==='empty')fail('INGREDIENT_EMPTY');
}
/** Device boot/sequence order: same boot needs a higher seq; a new boot restarts the sequence; a boot already superseded is stale forever. Old events never move state back. */
export function sequenced(c:CommandEnvelope,d:Snapshot):JsonObject {
 const bootId=String(c.payload.bootId??''),seq=String(c.payload.seq??'');
 if(!bootId||!/^[0-9]{1,18}$/.test(seq))fail('INVALID_OBSERVATION');
 if(bootId===d.state.bootId&&BigInt(seq)<=BigInt(String(d.state.seq)))fail('STALE_DEVICE_EVENT');
 const previous=((d.state.previousBootIds??[]) as string[]);
 if(previous.includes(bootId))fail('STALE_DEVICE_EVENT');
 const observedAt=String(c.payload.observedAt??'');if(Number.isNaN(Date.parse(observedAt)))fail('INVALID_OBSERVATION');
 const changed=typeof d.state.bootId==='string'&&d.state.bootId!==bootId;
 return {bootId,seq,observedAt,observedBy:c.actorRef,...changed?{previousBootIds:[...previous,String(d.state.bootId)].slice(-20)}:{}};
}
/** Stock each recipe resource needs, reserved in whole base units: all or nothing against on-hand minus every other open job's reservation. */
export function reserveStock(s:Snapshot[],recipe:CoffeeRecipe,jobId:string):Reservation[] {
 const held=new Map<string,bigint>();
 for(const j of all(s,'coffee-job'))if(j.ref.id!==jobId&&!FINAL_JOB.includes(j.state.status as CoffeeJob['status']))for(const r of (j.state.reservations??[]) as unknown as Reservation[])if(r.status==='reserved')held.set(r.ingredientId,(held.get(r.ingredientId)??0n)+BigInt(r.baseQuantity));
 return recipe.resources.filter(r=>r.requiredAmount&&STOCK_STEP[r.kind]).flatMap(r=>{
  const item=find(s,'stock-item',r.resourceId)??fail('INGREDIENT_UNKNOWN'),need=toStockBase(r.requiredAmount!.amount,r.requiredAmount!.unit,item.state);
  // Beans are drawn by grinding when present, otherwise by brewing; other ingredients may be drawn in several steps.
  const kinds=r.kind==='coffee_beans'&&recipe.steps.some(x=>x.kind==='grind')?['grind']:STOCK_STEP[r.kind]!;
  const steps=recipe.steps.filter(x=>kinds.includes(x.kind));
  if(r.allocations&&(r.allocations.length!==steps.length||r.allocations.some(a=>!steps.some(st=>st.id===a.stepId))))return fail('RECIPE_RESOURCE_ALLOCATION_REQUIRED');
  const quantities=r.allocations?steps.map(step=>toStockBase(r.allocations!.find(a=>a.stepId===step.id)!.amount,r.requiredAmount!.unit,item.state)):steps.length===1?[need]:steps.map(step=>{
   if(!step.target||step.target.unit!==r.requiredAmount!.unit)return fail('RECIPE_RESOURCE_ALLOCATION_REQUIRED');
   return toStockBase(step.target.amount,step.target.unit,item.state);
  });
  if(quantities.reduce((sum,q)=>sum+q,0n)!==need)return fail('RECIPE_RESOURCE_QUANTITY_MISMATCH');
  if(item.state.negativePolicy==='block'&&BigInt(String(item.state.onHand))-(held.get(r.resourceId)??0n)<need)fail('INSUFFICIENT_STOCK');
  held.set(r.resourceId,(held.get(r.resourceId)??0n)+need);
  return steps.map((step,i):Reservation=>({ingredientId:r.resourceId,resourceId:r.resourceId,stepId:step.id,baseQuantity:String(quantities[i]),status:'reserved'}));
 });
}
/**
 * Irreversible dispense of one step: each reservation of that step becomes a stock movement (measured quantity when the resource is in the step's measured
 * unit, else the reserved quantity). Content-addressed by job+step+ingredient, so a repeated completion books nothing twice. A quantity the ledger cannot hold
 * exactly opens a stock exception; the physical fact stands.
 */
export function consumeStep(c:CommandEnvelope,s:Snapshot[],recipe:CoffeeRecipe,job:CoffeeJob,stepId:string,measured:{amount:string;unit:string}|null):{events:DomainEvent[];consumed:string[]} {
 const events:DomainEvent[]=[],consumed:string[]=[],source=`coffee:${job.jobId}:${stepId}`;
 for(const r of job.reservations.filter(x=>x.stepId===stepId&&x.status==='reserved')){
  const item=find(s,'stock-item',r.ingredientId)!,res=recipe.resources.find(x=>x.resourceId===r.resourceId)!,mid=movementId(source,'coffee',r.ingredientId,'consume');
  if(find(s,'stock-movement',mid)){r.status='consumed';consumed.push(mid);continue;}
  try{
   const stepUnit=recipe.steps.find(x=>x.id===stepId)?.target?.unit;
   if(!measured&&res.requiredAmount?.unit===stepUnit)fail('MEASUREMENT_MISSING');
   const qty=measured&&measured.unit===res.requiredAmount?.unit?toStockBase(measured.amount,measured.unit,item.state):BigInt(r.baseQuantity);
   const x=issue({...item.state,negativePolicy:'allow'},qty);
   events.push(created('StockMovementRecorded','stock-movement',mid,{kind:'consume',ingredientId:r.ingredientId,sourceEventId:source,recipeVersion:job.recipeKey,jobId:job.jobId,cupId:job.cupId,deltaBase:String(-qty),costMinor:String(x.costMinor),costKnown:x.costKnown,seq:x.next.movementSeq!,negative:BigInt(String(x.next.onHand))<0n,actorRef:c.actorRef,occurredAt:c.occurredAt}),changed('StockLevelChanged',item,x.next));
   r.status='consumed';r.baseQuantity=String(qty);consumed.push(mid);
  }catch(e){
   if(!(e instanceof DomainFault))throw e;
   const id=sourceId('exc',`${source}:${r.ingredientId}`);
   if(!find(s,'stock-exception',id))events.push(created('StockExceptionOpened','stock-exception',id,{sourceEventId:source,recipeVersion:job.recipeKey,quantity:measured?.amount??r.baseQuantity,reason:e.message,status:'open',openedAt:c.occurredAt,jobId:job.jobId}));
   r.status='consumption_unknown';
  }
 }
 return {events,consumed};
}
/** Prepared drink thrown away: consumed movements are reclassified as waste at the quantity that left. Nothing goes back on the shelf. */
export function wasteJob(c:CommandEnvelope,s:Snapshot[],job:CoffeeJob,reason:string):DomainEvent[] {
 return job.steps.flatMap(st=>st.consumed).map(mid=>find(s,'stock-movement',mid)).filter((m):m is Snapshot=>!!m).filter(m=>!find(s,'stock-waste',sourceId('wst',`coffee:${job.jobId}:${m.ref.id}`)))
  .map(m=>created('StockWasted','stock-waste',sourceId('wst',`coffee:${job.jobId}:${m.ref.id}`),{kind:'prepared',sourceEventId:`coffee:${job.jobId}:waste`,consumedMovementId:m.ref.id,ingredientId:m.state.ingredientId!,baseQuantity:String(-BigInt(String(m.state.deltaBase))),jobId:job.jobId,cupId:job.cupId,reason,actorRef:c.actorRef,occurredAt:c.occurredAt}));
}
