import type { ModuleRegistry } from '../modules';
import type { CommandEnvelope, Decision, DomainEvent, JsonObject, Snapshot } from '../../../contracts/src/index';
import { all, changed, created, done, fail, find, handle, note, requireState, text } from '../restaurant-context';
import { enforcesZones } from './capabilities';
const unknownRobot=(r:Snapshot|undefined)=>!r||r.state.availability==='unknown'||['unknown','stop_requested'].includes(String(r.state.goalState));
const knownIdle=(r:Snapshot|undefined)=>Boolean(r)&&!unknownRobot(r)&&r!.state.availability==='idle'&&!r!.state.missionId;
/** Later events win per aggregate (as in processCommand); versions stay the read versions so `changed` keeps one CAS step. */
const apply=(s:Snapshot[],events:DomainEvent[])=>s.map(x=>{const e=[...events].reverse().find(e=>e.data.kind===x.ref.kind&&e.data.id===x.ref.id);return e?{...x,state:e.data.state as JsonObject}:x;});
/**
 * Can `robot` enter `zoneId` now? Shared only between robots of the SAME driver that both enforce zone reservations; a robot that does not is
 * serialized (one mover in the conflict zone); a different vendor never shares (its traffic manager cannot see ours). Holders are re-classified
 * on the way: a holder whose robot is unknown (stop requested, lost) becomes `unknown` and keeps the zone; only an EXPIRED holder whose robot is
 * known idle lapses. TTL alone never releases an unknown reservation.
 */
function admit(s:Snapshot[],zoneId:string,robot:Snapshot,at:string):{reason?:string;events:DomainEvent[]} {
 const events:DomainEvent[]=[],nowMs=Date.parse(at);let unknown=false,mixed=false,serial=false;
 for(const h of all(s,'reservation').filter(x=>x.state.zoneId===zoneId&&x.state.robotId!==robot.ref.id&&['granted','unknown'].includes(String(x.state.status)))) {
  const holder=find(s,'robot',String(h.state.robotId));
  if(h.state.status==='unknown'||unknownRobot(holder)) {unknown=true;if(h.state.status!=='unknown') events.push(changed('ZoneReservationUnknown',h,{status:'unknown'}));continue;}
  if(nowMs>Number(h.state.expiresAtMs)&&knownIdle(holder)) {events.push(changed('ZoneReservationLapsed',h,{status:'released',releaseReason:'ttl_lapsed',releasedAt:at}));continue;}
  if(holder!.state.driver!==robot.state.driver) mixed=true;
  else if(zoneId===VENUE_MOVEMENT_ZONE||!enforcesZones(holder!.state)||!enforcesZones(robot.state)) serial=true;
 }
 return {reason:unknown?'ZONE_HELD_UNKNOWN':mixed?'MIXED_VENDOR_TRAFFIC':serial?'ZONE_SERIALIZED':undefined,events};
}
/**
 * Zone.Reserve {zoneId,robotId,missionId?,ttlMs?=60000}: the executor asks before moving into a shared traffic zone. Not admissible yet is not an
 * error: the reservation stays `pending` with its reason until a release promotes it. Id `<zoneId>@<robotId>` (kind `reservation`, which robot
 * reconciliation and the recovery inventory already treat as held until released).
 * Zone.Release {reservationId,evidence?}: an `unknown` reservation needs evidence that the robot left the zone; then pending ones are promoted in order.
 * Without evidence a granted zone is released only by its own robot's executor (`executor:<robotId>`), since another robot's executor also
 * holds robot.traffic; a release with evidence needs robot.configure (requiredPermissions) and records the evidence.
 */
export const VENUE_MOVEMENT_ZONE='__venue_movement__';
function reserveDecision(c:CommandEnvelope,s:Snapshot[]):Decision {
  const zoneId=text(c.payload.zoneId,'ZONE_REQUIRED'),robot=requireState(s,'robot',text(c.payload.robotId)),id=`${zoneId}@${robot.ref.id}`,old=find(s,'reservation',id);
  const ttlMs=c.payload.ttlMs ?? 60000;
  if(typeof ttlMs!=='number'||!Number.isInteger(ttlMs)||ttlMs<1000||ttlMs>600000) return fail('INVALID_TTL');
  if(unknownRobot(robot)) return fail('ROBOT_STATE_UNKNOWN');
  if(old?.state.status==='unknown') return done([],{reservationId:id,status:'unknown',reason:'ZONE_HELD_UNKNOWN'});
  // A holder asking again only renews its TTL; it is never downgraded while it may be inside the zone.
  if(old?.state.status==='granted') return done([changed('ZoneReservationRenewed',old,{ttlMs,expiresAtMs:Date.parse(c.recordedAt)+ttlMs})],{reservationId:id,status:'granted'});
  const {reason,events}=admit(s,zoneId,robot,c.recordedAt),pending=old?.state.status==='pending';
  const rank=pending?Number(old.state.rank):Math.max(0,...all(s,'reservation').filter(x=>x.state.zoneId===zoneId).map(x=>Number(x.state.rank))) +1;
  const state:JsonObject={zoneId,robotId:robot.ref.id,missionId:c.payload.missionId===undefined?null:text(c.payload.missionId),status:reason?'pending':'granted',reason:reason ?? null,ttlMs,expiresAtMs:Date.parse(c.recordedAt)+ttlMs,rank,requestedAt:pending?old.state.requestedAt!:c.recordedAt,releaseReason:null,evidence:null};
  const type=reason?'ZoneReservationPending':'ZoneReservationGranted';
  return done([...events,old?changed(type,old,state):created(type,'reservation',id,state)],{reservationId:id,status:String(state.status),...(reason?{reason}:{})});
}
function release(c:CommandEnvelope,s:Snapshot[]):Decision {
  const r=requireState(s,'reservation',text(c.payload.reservationId));
  if(r.state.status==='released') return fail('RESERVATION_RELEASED');
  if(r.state.status==='granted'&&c.payload.evidence===undefined&&c.actorRef!==`executor:${String(r.state.robotId)}`) return fail('RESERVATION_NOT_BOUND');
  const evidence=r.state.status==='unknown'||c.payload.evidence!==undefined?note(c.payload.evidence,'EVIDENCE_REQUIRED'):null;
  const events=[changed('ZoneReservationReleased',r,{status:'released',releaseReason:evidence?'evidence':'released',evidence,releasedBy:c.actorRef,releasedAt:c.recordedAt})],promoted:string[]=[];
  let work=apply(s,events);
  for(const p of all(work,'reservation').filter(x=>x.state.zoneId===r.state.zoneId&&x.state.status==='pending').sort((a,b)=>Number(a.state.rank)-Number(b.state.rank))) {
   const robot=find(work,'robot',String(p.state.robotId));
   if(unknownRobot(robot)) continue;
   const result=admit(work,String(r.state.zoneId),robot!,c.recordedAt);
   events.push(...result.events);
   if(!result.reason) {events.push(changed('ZoneReservationGranted',p,{status:'granted',reason:null,expiresAtMs:Date.parse(c.recordedAt)+Number(p.state.ttlMs)}));promoted.push(p.ref.id);}
   work=apply(work,events);
  }
  return done(events,{reservationId:r.ref.id,promoted});
}
export function registerReservations(registry:ModuleRegistry):void {
 handle(registry,'Zone.Reserve',(c,s)=>reserve(c,s));
 handle(registry,'Zone.Release',(c,s)=>release(c,s));
}


/** Every contender mutates the SAME aggregate, including the first two inserts into an empty zone. */
function reserve(c:CommandEnvelope,s:Snapshot[]):Decision {
 const result=reserveDecision(c,s);if(!result.ok)return result;
 const zoneId=String(c.payload.zoneId),lock=find(s,'traffic-zone',zoneId);
 return {...result,events:[...result.events,lock?changed('TrafficZoneChecked',lock,{operationId:c.operationId}):created('TrafficZoneChecked','traffic-zone',zoneId,{operationId:c.operationId})]};
}
/** All movement paths reserve before their effects commit. Routes without a proven zone mapping use an exclusive venue boundary. */
export function reserveDecisionMovement(c:CommandEnvelope,s:Snapshot[],decision:Decision):Decision {
 if(!decision.ok)return decision;
 const events=[...decision.events];
 // Overlay the decision so assignment/release and multiple effects are considered in the same transaction.
 const view=()=>{
  const work=apply(s,events);
  for(const e of events)if(!work.some(x=>x.ref.kind===e.data.kind&&x.ref.id===e.data.id))work.push({ref:{organizationId:c.organizationId,venueId:c.venueId,kind:String(e.data.kind),id:String(e.data.id)},version:0,state:e.data.state as JsonObject});
  return work;
 };
 for(const e of decision.events.filter(e=>e.data.kind==='robot')) {
  const state=e.data.state as JsonObject;
  if(state.availability==='idle'&&!state.missionId&&['completed','cancelled'].includes(String(state.goalState))) {
   const work=view(),held=find(work,'reservation',`${VENUE_MOVEMENT_ZONE}@${String(e.data.id)}`);
   if(held&&held.state.status!=='released'&&held.state.status!=='unknown') {
    const released=release({...c,actorRef:`executor:${String(e.data.id)}`,payload:{reservationId:held.ref.id}},work);
    if(released.ok)events.push(...released.events);
   }
  }
 }
 for(const effect of (decision.value.effects??[]) as JsonObject[])if(effect.type==='robot.execute') {
  const p=effect.payload as JsonObject;
  const reserved=reserve({...c,payload:{zoneId:VENUE_MOVEMENT_ZONE,robotId:p.robotId!,missionId:p.missionId!}},view());
  if(!reserved.ok)return reserved;events.push(...reserved.events);
 }
 return {...decision,events};
}
