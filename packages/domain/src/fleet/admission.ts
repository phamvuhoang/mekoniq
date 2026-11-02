import type { Snapshot } from '../../../contracts/src/index';
import { controlsSpeed, profileReason, supports } from './capabilities';
import { bindingReason } from './map-binding';
/** What a mission needs from a robot. clearanceM: narrowest passage at that stop (venue point), if the venue recorded one. */
export type MissionDemand={stops:{targetId:string;clearanceM?:number}[];capability:string;trays:number;loadMinor?:string;speedLimitMps?:number;allowBusy?:boolean};
export type Eligibility={robotId:string;eligible:boolean;reasons:string[]};
/**
 * Admission, before any scoring: profile (driver + validation), capability, a current binding for EVERY stop, trays, payload, speed control,
 * footprint, safety, battery, availability. Each robot gets all its reasons; the first one is the code a specific-robot request is rejected with.
 */
export function eligibleRobots(mission:MissionDemand,profiles:Snapshot[]):Eligibility[] {
 return profiles.map(robot=>{
  const r=robot.state,reasons=new Set<string>();
  const add=(reason:string|undefined)=>{if(reason) reasons.add(reason);};
  add(profileReason(r));
  if(!supports(r,mission.capability)) add('CAPABILITY_UNSUPPORTED');
  for(const stop of mission.stops) add(bindingReason(r,stop.targetId));
  if(Number(r.trays ?? 0)<mission.trays) add('TRAYS_INSUFFICIENT');
  if(mission.loadMinor!==undefined&&BigInt(mission.loadMinor)>BigInt(String(r.maxLoadMinor ?? '0'))) add('OVERLOADED');
  if(mission.speedLimitMps!==undefined&&!controlsSpeed(r)) add('SPEED_UNSUPPORTED');
  const width=(r.footprint as {widthM?:unknown}|undefined)?.widthM;
  for(const stop of mission.stops) if(stop.clearanceM!==undefined) add(typeof width!=='number'?'FOOTPRINT_UNKNOWN':width>stop.clearanceM?'FOOTPRINT_TOO_LARGE':undefined);
  if(r.safetyState && r.safetyState!=='clear') add('SAFETY_NOT_CLEAR');
  if(Number(r.battery)<Number(r.minBattery ?? 20)) add('BATTERY_LOW');
  if(!(mission.allowBusy?['idle','busy']:['idle']).includes(String(r.availability))) add('ROBOT_UNAVAILABLE');
  return {robotId:robot.ref.id,eligible:!reasons.size,reasons:[...reasons]};
 });
}
