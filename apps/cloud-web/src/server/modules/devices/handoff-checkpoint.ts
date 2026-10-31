import {hashPayload,type JournalEntry,type Snapshot,type Mutation,type JsonObject} from '../../../../../../packages/contracts/src/index';
import type {TenantScope} from '../identity/tenant-context';
/** Reconstruct only owner-authorized historical facts, never external effects. */
export function buildHandoffSnapshots(scope:TenantScope,entries:JournalEntry[],snapshots:Snapshot[],devices:JsonObject[],owner:{deviceId:string;deviceEpoch:string;epoch:number}):Snapshot[]{
 const owners=new Map<number,string>();
 for(const entry of entries.filter(e=>e.kind==='accepted_fact')){
  const identity=JSON.stringify([entry.deviceId,entry.deviceEpoch]);
  if(owners.has(entry.coordinatorEpoch)&&owners.get(entry.coordinatorEpoch)!==identity)throw new Error('HANDOFF_OWNER_HISTORY_CONFLICT');
  owners.set(entry.coordinatorEpoch,identity);
 }
 owners.set(owner.epoch,JSON.stringify([owner.deviceId,owner.deviceEpoch]));
 const result=new Map(snapshots.filter(s=>!s.ref.kind.includes(':')).map(s=>[JSON.stringify([s.ref.kind,s.ref.id]),s]));
 const changes:Mutation[]=[];
 for(const entry of entries.filter(e=>e.kind==='historical_import')){
  if(owners.get(entry.coordinatorEpoch)!==JSON.stringify([entry.deviceId,entry.deviceEpoch]))throw new Error('HANDOFF_HISTORICAL_OWNER_UNVERIFIED');
  if(!Array.isArray(entry.payload.mutations))throw new Error('HANDOFF_HISTORICAL_STATE_MISSING');
  for(const raw of entry.payload.mutations){
   const change=raw as unknown as Mutation;
   if(!change.ref||change.ref.organizationId!==scope.organizationId||change.ref.venueId!==scope.venueId||!['import-batch','historical-receipt','source-link','historical-amendment'].includes(change.ref.kind)||!Number.isSafeInteger(change.expectedVersion)||change.expectedVersion<0||!change.newState)throw new Error('HANDOFF_HISTORICAL_STATE_INVALID');
   changes.push(change);
  }
 }
 for(const change of changes.sort((a,b)=>a.expectedVersion-b.expectedVersion)){
  const key=JSON.stringify([change.ref.kind,change.ref.id]),current=result.get(key),version=change.expectedVersion+1;
  if(current&&current.version>version)continue;
  if(current?.version===version){if(hashPayload(current.state)!==hashPayload(change.newState))throw new Error('HANDOFF_HISTORICAL_STATE_CONFLICT');continue;}
  if((current?.version??0)!==change.expectedVersion)throw new Error('HANDOFF_HISTORICAL_STATE_GAP');
  result.set(key,{ref:change.ref,version,state:change.newState});
 }
 for(const device of devices){
  const id=String(device.deviceId);result.set(JSON.stringify(['device',id]),{ref:{...scope,kind:'device',id},version:1,state:{...device,id}});
 }
 if(result.size>10000)throw new Error('HANDOFF_CHECKPOINT_TOO_LARGE');
 return [...result.values()];
}
