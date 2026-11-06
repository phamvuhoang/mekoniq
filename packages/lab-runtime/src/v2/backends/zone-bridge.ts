// Zone bridge (SIM-06): the production reservation module decides who may move into a shared zone; this bridge only executes the worker's
// boundary entry for a GRANTED reservation. Pending/unknown holds the robot before the boundary; a release promotes the next robot, which
// then enters exactly once. No TTL and no local heuristic ever frees a zone here.
import type {SourceSession} from '../session';
export interface BoundaryWorker {enter(robotId:string,zoneId:string):Promise<void>}
export type EntryResult={status:'granted'|'pending'|'unknown'|'rejected';reason?:string};
export function createZoneBridge(session:SourceSession,worker:BoundaryWorker){
 let op=0;const entered=new Set<string>();
 const key=(robotId:string,zoneId:string)=>`${zoneId}@${robotId}`;
 const enterOnce=async(robotId:string,zoneId:string)=>{const k=key(robotId,zoneId);if(entered.has(k))return;entered.add(k);await worker.enter(robotId,zoneId);};
 return {
  async requestEntry(robotId:string,zoneId:string):Promise<EntryResult>{
   const r=await session.submit('Zone.Reserve',{zoneId,robotId},`zone-${++op}`,robotId);
   if(r.status!=='accepted')return {status:'rejected',reason:String(r.code??r.status)};
   const status=String(r.value.status);
   if(status==='granted'){await enterOnce(robotId,zoneId);return {status:'granted'};}
   return {status:status==='unknown'?'unknown':'pending',...typeof r.value.reason==='string'?{reason:r.value.reason}:{}};
  },
  /** The holder's own executor releases without evidence; promoted robots are let through the boundary once each. */
  async release(robotId:string,zoneId:string):Promise<{promoted:string[];code?:string}>{
   const r=await session.submit('Zone.Release',{reservationId:key(robotId,zoneId)},`zone-${++op}`,robotId);
   if(r.status!=='accepted')return {promoted:[],code:String(r.code??r.status)};
   entered.delete(key(robotId,zoneId));
   const promoted=Array.isArray(r.value.promoted)?r.value.promoted.map(String):[];
   for(const id of promoted){const at=id.indexOf('@');if(at>0)await enterOnce(id.slice(at+1),id.slice(0,at));}
   return {promoted};
  },
  async zoneOwner(zoneId:string):Promise<string|null>{
   const holders=(await session.store.snapshots(session.scope)).filter(s=>s.ref.kind==='reservation'&&s.state.zoneId===zoneId&&['granted','unknown'].includes(String(s.state.status)));
   return holders.length?String(holders[0]!.state.robotId):null;
  },
 };
}
