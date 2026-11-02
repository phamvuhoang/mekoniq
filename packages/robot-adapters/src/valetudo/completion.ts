import type { ValetudoSample } from './map';
import type { ValetudoProfile } from './capabilities';
export function arrivalConfirmed(s:{fresh:boolean;mapMatches:boolean;goalMatches:boolean;
  stationary:boolean;distanceM:number;toleranceM:number}) {
  return s.fresh && s.mapMatches && s.goalMatches && s.stationary &&
    s.distanceM <= s.toleranceM;
}
export type GoalState='sending'|'executing'|'cancelling'|'completed'|'cancelled'|'failed'|'unknown';
/** The executor's journal row for one command: goal in native cm, samples received after the goto ACK/delivery. */
export interface GoalRecord {commandId:string;hash:string;goal:{x:number;y:number};state:GoalState;ackAtMs?:number;stopAtMs?:number;reason?:string;samples:ValetudoSample[];motionSeen?:boolean}
export type Assessment={state:'pending'|'progress'|'completed'|'cancelled'|'failed'|'unknown';reason?:string;distanceM?:number};
const cm=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y);
/** Newest idle stretch: the last sample and the earliest sample before it that is idle and within stationaryCm of it, all in between idle too. */
export function stationary(samples:ValetudoSample[],p:Pick<ValetudoProfile,'stationaryCm'|'stationaryMs'>):boolean {
 const last=samples.at(-1); if(!last?.position||last.status!=='idle') return false;
 let first=last;
 for(let i=samples.length-2;i>=0;i--) {const s=samples[i]!; if(!s.reachable||s.status!=='idle'||!s.position||cm(s.position,last.position)>p.stationaryCm) break; first=s;}
 return last.receivedAtMs-first.receivedAtMs>=p.stationaryMs;
}
/**
 * HTTP 200 / MQTT delivery never means arrival. Arrival needs, after the ACK and without a telemetry gap: the robot seen `moving` with a
 * go_to_target matching our goal (Valetudo has no goal id, this is the only goal evidence), no other target since, the same map, then a fresh
 * stationary idle stretch within tolerance, no reboot (host uptime never decreases) and no other status. Retained deliveries are ignored. Anything less stays pending and becomes unknown at the deadline.
 */
export function assess(goal:GoalRecord,p:ValetudoProfile,nowMs:number):Assessment {
 const expired=goal.ackAtMs!==undefined&&nowMs-goal.ackAtMs>p.tripTimeoutMs;
 const after=goal.samples.filter(s=>goal.ackAtMs!==undefined&&s.receivedAtMs>=goal.ackAtMs&&!s.retained),last=after.at(-1);
 const timeout=(reason:string):Assessment=>expired?{state:'unknown',reason}:{state:'pending',reason};
 if(!last) return timeout('NO_TELEMETRY');
 if(last.reachable&&last.status==='error') return {state:'failed',reason:'ROBOT_ERROR'};
 if(goal.state==='cancelling') {
  const since=after.filter(s=>s.receivedAtMs>=(goal.stopAtMs ?? 0));
  return since.length&&since.every(s=>s.reachable)&&nowMs-last.receivedAtMs<=p.freshMs&&stationary(since,p)?{state:'cancelled'}:timeout('STOP_UNCONFIRMED');
 }
 const start=after.findIndex(s=>s.reachable&&s.status==='moving'&&s.goToTarget!==undefined&&cm(s.goToTarget,goal.goal)<=p.goalToleranceCm);
 if(start<0) return timeout('NO_MOTION_EVIDENCE');
 const trip=after.slice(start);
 if(trip.some(s=>!s.reachable)) return {state:'unknown',reason:'TELEMETRY_GAP'};
 if(trip.some((s,i)=>i>0&&s.uptimeS!==undefined&&trip[i-1]!.uptimeS!==undefined&&s.uptimeS<trip[i-1]!.uptimeS!)) return {state:'unknown',reason:'REBOOTED'};
 if(trip.some(s=>!['moving','idle'].includes(String(s.status)))) return {state:'unknown',reason:'TRIP_INTERRUPTED'}; // docked/returning/paused/...: not our goal any more
 if(trip.some(s=>s.mapFingerprint!==p.mapFingerprint)) return {state:'unknown',reason:'MAP_CHANGED'};
 if(trip.some(s=>s.goToTarget&&cm(s.goToTarget,goal.goal)>p.goalToleranceCm)) return {state:'unknown',reason:'GOAL_REPLACED'};
 const distanceM=last.position?cm(last.position,goal.goal)/100:Number.POSITIVE_INFINITY;
 if(arrivalConfirmed({fresh:nowMs-last.receivedAtMs<=p.freshMs,mapMatches:last.mapFingerprint===p.mapFingerprint,goalMatches:true,stationary:stationary(trip,p),distanceM,toleranceM:p.arriveToleranceM})) return {state:'completed',distanceM};
 if(last.status==='moving') return expired?{state:'unknown',reason:'ARRIVAL_UNCONFIRMED'}:{state:'progress',distanceM};
 return {...timeout(last.position?'ARRIVAL_UNCONFIRMED':'NO_POSE'),distanceM};
}
