// Zone bridge (SIM-06): the production reservation module decides who may move into a shared zone; this bridge only executes the worker's
// boundary entry for a GRANTED reservation. Pending/unknown holds the robot before the boundary; a release promotes the next robot, which
// then enters exactly once. No TTL and no local heuristic ever frees a zone here.
import type {SourceSession} from '../session';
import {place,pointDistance,polygonsOverlap,type P,type Pose2} from '../navigation2d/geometry';
export interface BoundaryWorker {enter(robotId:string,zoneId:string):Promise<void>}
export type EntryResult={status:'granted'|'pending'|'unknown'|'rejected';reason?:string};
/** `nextOp` names each Zone.* operation; a run passes its persisted ordinal so a reopened run never reuses an operation id. */
export function createZoneBridge(session:SourceSession,worker:BoundaryWorker,nextOp?:()=>string){
 let op=0;const entered=new Set<string>(),opId=nextOp??(()=>`zone-${++op}`);
 const key=(robotId:string,zoneId:string)=>`${zoneId}@${robotId}`;
 const enterOnce=async(robotId:string,zoneId:string)=>{const k=key(robotId,zoneId);if(entered.has(k))return;entered.add(k);await worker.enter(robotId,zoneId);};
 return {
  async requestEntry(robotId:string,zoneId:string):Promise<EntryResult>{
   const r=await session.submit('Zone.Reserve',{zoneId,robotId},opId(),robotId);
   if(r.status!=='accepted')return {status:'rejected',reason:String(r.code??r.status)};
   const status=String(r.value.status);
   if(status==='granted'){await enterOnce(robotId,zoneId);return {status:'granted'};}
   return {status:status==='unknown'?'unknown':'pending',...typeof r.value.reason==='string'?{reason:r.value.reason}:{}};
  },
  /** The holder's own executor releases without evidence; promoted robots are let through the boundary once each. */
  async release(robotId:string,zoneId:string):Promise<{promoted:string[];code?:string}>{
   const r=await session.submit('Zone.Release',{reservationId:key(robotId,zoneId)},opId(),robotId);
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

/** What zone traffic sees of one robot at a verified snapshot: its footprint pose (drive frame), whether its leg is live, and its remaining route (controller.route). */
export interface TrafficRobot{robotId:string;footprint:readonly P[];pose:Pose2;live:boolean;route:readonly P[]|null}
/** Things traffic will not decide on its own: a grant that contradicts the owner it holds (conflict), a holder standing inside its zone with no live leg (stranded). */
export interface TrafficNotice{kind:'conflict'|'stranded';zoneId:string;robotId:string;owner?:string;tick:number}
/**
 * Pre-entry guard, renewal and whole-footprint release over the zone bridge (IR-SIM 2D runner, C02). Per verified snapshot, robots in robotId order:
 * - a live robot whose remaining route crosses a zone (or whose footprint already overlaps it) asks Zone.Reserve; only `granted` makes it the owner, pending/unknown/
 *   rejected leave the zone an obstacle for its planner, so it waits outside the boundary. A waiting request is asked again every `retryTicks`, or promoted by a release.
 * - the owner renews its grant (Zone.Reserve again, the domain's renewal) every `renewEveryTicks` while it is observed, so the domain's TTL lapse of an idle holder can
 *   never hand the zone to another robot while the owner may still be inside it. A renewal that is not answered `granted` is a conflict.
 * - the owner releases only when this snapshot shows its WHOLE footprint outside the polygon and it no longer needs the zone (remaining route clear of it by
 *   1.1 x its circumscribed radius + clearanceM, or the leg ended). Nothing else releases: no TTL, no stale or missing observation (no snapshot, no call), no plant loss.
 * - a grant to another robot while traffic holds an owner is never taken: the owner stays, the zone stays an obstacle for the other robot, and a `conflict` notice is
 *   raised (the runner turns it into attention). An owner stopped inside its zone without a live leg keeps (and renews) it and raises one `stranded` notice.
 * Returns zoneId -> granted owner for the controller.
 */
export function createZoneTraffic(bridge:ReturnType<typeof createZoneBridge>,zones:readonly {id:string;polygonM:readonly (readonly [number,number])[]}[],o:{retryTicks?:number;clearanceM?:number;renewEveryTicks?:number}={}){
 // a route counts as crossing a zone within the robot's circumscribed radius (+10% for the turn sweep) plus `clearanceM` (the planner's margin and lattice snap):
 // a robot that gives a zone back must be able to replan right there with that zone as an obstacle (a turn in place included)
 const owner=new Map<string,string>(),asked=new Map<string,number>(),renewed=new Map<string,number>(),stranded=new Set<string>(),retry=o.retryTicks??50,extra=o.clearanceM??0,renewEvery=o.renewEveryTicks??1000;
 const notices:TrafficNotice[]=[],conflicted=new Set<string>();
 const polys=zones.map(z=>({id:z.id,poly:z.polygonM.map(p=>[p[0],p[1]] as P)}));
 const key=(r:string,z:string)=>`${z}@${r}`;
 /** Route polyline within `clear` of the zone (the robot's circumscribed radius): sampled every 5 cm along each segment. */
 const crosses=(route:readonly P[]|null,poly:P[],clear:number)=>{
  if(!route)return false;
  for(let i=0;i+1<route.length;i++){const a=route[i]!,b=route[i+1]!,n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/0.05));
   for(let k=0;k<=n;k++)if(pointDistance([a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n],poly)<=clear)return true;}
  return false;
 };
 const owners=()=>Object.fromEntries(polys.map(z=>[z.id,owner.get(z.id)??null])) as Record<string,string|null>;
 /** A grant for `robotId`: taken only when nobody else holds the zone here; otherwise a conflict, never an overwrite. */
 const take=(zoneId:string,robotId:string,tick:number)=>{
  const held=owner.get(zoneId);
  if(held!==undefined&&held!==robotId){if(!conflicted.has(`${zoneId}@${robotId}`)){conflicted.add(`${zoneId}@${robotId}`);notices.push({kind:'conflict',zoneId,robotId,owner:held,tick});}return false;}
  owner.set(zoneId,robotId);renewed.set(zoneId,tick);return true;
 };
 return {
  owners,
  /** Notices raised since the last call (each once). */
  notices:()=>notices.splice(0),
  async update(tick:number,robots:readonly TrafficRobot[]){
   for(const r of [...robots].sort((a,b)=>a.robotId<b.robotId?-1:a.robotId>b.robotId?1:0)){
    const body=place(r.footprint as P[],...r.pose),radius=1.1*Math.max(...r.footprint.map(v=>Math.hypot(v[0],v[1])))+extra;
    for(const z of polys){
     const k=key(r.robotId,z.id),now=polygonsOverlap(body,z.poly),mine=owner.get(z.id)===r.robotId,needs=r.live&&(now||crosses(r.route,z.poly,radius));
     // released only once the whole footprint is outside AND the zone is no longer needed (the route from here stays clear of it by the robot's radius, or the leg
     // ended): a robot leaving and re-entering keeps one grant instead of flapping, and every release is a full exit
     if(mine&&!now&&!needs){
      const out=await bridge.release(r.robotId,z.id);
      if(out.code)continue; // refused (e.g. the reservation became unknown): it stays held, never assumed free
      owner.delete(z.id);asked.delete(k);renewed.delete(z.id);stranded.delete(k);
      for(const id of out.promoted){const at=id.indexOf('@');if(at>0&&take(id.slice(0,at),id.slice(at+1),tick))asked.delete(id);}
      continue;
     }
     if(mine){
      if(now&&!r.live&&!stranded.has(k)){stranded.add(k);notices.push({kind:'stranded',zoneId:z.id,robotId:r.robotId,tick});}
      // the holder is observed now: keep its grant fresh well inside the domain's TTL (60 s), so no lapse can move the zone under it
      if(tick-(renewed.get(z.id)??tick)>=renewEvery){
       const res=await bridge.requestEntry(r.robotId,z.id);
       if(res.status==='granted')renewed.set(z.id,tick);else notices.push({kind:'conflict',zoneId:z.id,robotId:r.robotId,owner:r.robotId,tick});
      }
      continue;
     }
     // asked even while another robot holds it: the domain queues it (pending, ranked) and a release promotes it in order
     if(needs&&tick>=(asked.get(k)??-Infinity)){
      const res=await bridge.requestEntry(r.robotId,z.id);
      if(res.status==='granted'&&take(z.id,r.robotId,tick))asked.delete(k);else asked.set(k,tick+retry);
     }
    }
   }
   return owners();
  },
 };
}
