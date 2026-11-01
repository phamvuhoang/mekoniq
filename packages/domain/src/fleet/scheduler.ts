import type { JsonObject, Snapshot } from '../../../contracts/src/index';
import { amount, fail, find } from '../restaurant-context';
import { eligibleRobots, type MissionDemand } from './admission';
import { bindingReason } from './map-binding';
export const missionCapability=(kind:unknown):string=>kind==='bus'?'bussing':kind==='guide'?'guide':'delivery';
/** The demand of a mission (payload of Mission.Create, or a queued mission's state): load/speed limits and each stop's venue clearance. */
export function missionDemand(s:Snapshot[],source:JsonObject,targets:string[],trays:number):MissionDemand {
 const speed=source.speedLimitMps;
 if(speed!==undefined&&speed!==null&&!(typeof speed==='number'&&speed>0&&speed<=5)) return fail('INVALID_SPEED_LIMIT');
 const clearance=(id:string)=>{const c=(find(s,'table',id) ?? find(s,'station',id))?.state.clearanceM;return typeof c==='number'?{clearanceM:c}:{};};
 return {stops:targets.map(targetId=>({targetId,...clearance(targetId)})),capability:missionCapability(source.kind),trays,
  ...(source.loadMinor!==undefined&&source.loadMinor!==null?{loadMinor:amount(source.loadMinor)}:{}),...(typeof speed==='number'?{speedLimitMps:speed}:{})};
}
/**
 * Why the assigned robot may not drive the next leg to `targetId` (undefined: it may): the admission rule re-checked per leg, because a
 * table move/merge can rewrite a later stop. Safety set and not clear, then a binding not current for its map, then the target's clearance
 * against the footprint. One rule for nextStop, Mission.Resume and a retargeted live goal.
 */
export function legHoldReason(s:Snapshot[],mission:JsonObject,robot:Snapshot,targetId:string):string|undefined {
 if(robot.state.safetyState&&robot.state.safetyState!=='clear') return 'SAFETY_NOT_CLEAR';
 return bindingReason(robot.state,targetId) ?? eligibleRobots({...missionDemand(s,mission,[targetId],1),allowBusy:true},[robot])[0]!.reasons.find(r=>r.startsWith('FOOTPRINT_'));
}
/** Score only robots admission accepted. A specific robot is never a bypass: it is rejected with its own first reason. */
export function selectRobot(robots:Snapshot[],demand:MissionDemand,requested?:string):Snapshot {
 const results=eligibleRobots(demand,robots);
 if(requested&&requested!=='any') {
  const mine=results.find(r=>r.robotId===requested) ?? fail('NO_CAPABLE_ROBOT');
  return mine.eligible ? robots.find(r=>r.ref.id===requested)! : fail(mine.reasons[0]!);
 }
 const candidates=robots.filter(r=>results.find(e=>e.robotId===r.ref.id)?.eligible);
 if(!candidates.length) return fail('NO_CAPABLE_ROBOT');
 return candidates.sort((a,b)=>Number(a.state.availability!=='idle')-Number(b.state.availability!=='idle')||Number(b.state.battery)-Number(a.state.battery)||a.ref.id.localeCompare(b.ref.id))[0]!;
}
