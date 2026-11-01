import type { CommandEnvelope, DomainEvent, JsonObject, Snapshot } from '../../../contracts/src/index';
import { all, changed, fail, find, requireState, stableId } from '../restaurant-context';
import { issueRobotCommand } from './command-journal';
import type { MissionStop } from './stop';
import { bindingReason } from './map-binding';
import { eligibleRobots } from './admission';
import { missionDemand } from './scheduler';
/**
 * Point every unfinished hand-off stop that carries one of `allocationIds` at `toTable` (a table id, which is also the robot binding key,
 * so renaming a table never touches map bindings). A stop the robot is already driving to (or waiting at) gets a new robot command under a
 * bumped mission revision: the old command and any late event for it become stale (STALE_ROBOT_EVENT), and a cancel for the old goal is
 * queued ahead of the new execute. A robot in an unknown state is never re-aimed. Retarget is a movement path, so it refuses where admission
 * and nextStop refuse: a safety state set and not clear, or a footprint the new table's clearance does not admit, holds the mission
 * (MissionNeedsAttention + attentionReason, leg pending, old goal superseded and cancelled) until Mission.Resume; no new goal is issued.
 */
export function retargetHandoffs(c:CommandEnvelope,s:Snapshot[],allocationIds:Set<string>,toTable:string):{events:DomainEvent[];effects:JsonObject[]} {
 const events:DomainEvent[]=[],effects:JsonObject[]=[];
 for(const mission of all(s,'mission')) {
  const status=String(mission.state.status);
  if(['completed','cancelled','failed','cancelling'].includes(status)) continue;
  const stops=structuredClone(mission.state.stops ?? []) as MissionStop[];
  const hit=stops.filter(x=>x.action==='handoff'&&['pending','travelling','awaiting_action'].includes(x.status)&&x.targetId!==toTable&&x.allocationIds.some(id=>allocationIds.has(id)));
  if(!hit.length) continue;
  if(status==='needs_attention') return fail('MISSION_UNRESOLVED');
  const targetRevision=Number(mission.state.targetRevision ?? 0)+1;
  for(const stop of hit) stop.targetId=toTable;
  // A binding counts only if it is current for the robot's map (bindingReason), or the move would only fail at dispatch.
  const why=(robot:Snapshot)=>bindingReason(robot.state,toTable);
  if(status==='queued') {
   // No robot yet: the preferred one, or any robot, must know the new table.
   const candidates=mission.state.preferredRobotId?[requireState(s,'robot',String(mission.state.preferredRobotId))]:all(s,'robot');
   if(!candidates.some(robot=>!why(robot))) return fail(candidates.length?why(candidates[0]!)!:'TARGET_UNBOUND');
   events.push(changed('MissionRetargeted',mission,{stops,targetRevision}));continue;
  }
  const robot=requireState(s,'robot',String(mission.state.robotId));
  const reason=why(robot);if(reason) return fail(reason);
  const current=hit.find(x=>x.id===mission.state.currentStopId);
  if(!current) {events.push(changed('MissionRetargeted',mission,{stops,targetRevision}));continue;}
  const liveGoal=current.status==='travelling',revision=Number(mission.state.revision)+1,old=find(s,'robot-command',String(mission.state.commandId));
  const reasons=eligibleRobots({...missionDemand(s,mission.state,[toTable],1),allowBusy:true},[robot])[0]!.reasons;
  const hold=reasons.find(r=>r==='SAFETY_NOT_CLEAR') ?? reasons.find(r=>r.startsWith('FOOTPRINT_'));
  if(liveGoal&&mission.state.commandId) effects.push({id:stableId('retarget-cancel',c,mission.ref.id),type:'robot.cancel',payload:{robotId:robot.ref.id,commandId:String(mission.state.commandId),missionId:mission.ref.id,controlEpoch:mission.state.controlEpoch ?? c.coordinatorEpoch}});
  if(hold) {
   current.status='pending';
   events.push(changed('MissionNeedsAttention',mission,{stops,status:'needs_attention',attentionReason:hold,revision,commandRevision:revision,commandId:null,targetRevision}));
   if(old) events.push(changed('RobotCommandSuperseded',old,{status:'superseded',supersededBy:null}));
   continue;
  }
  current.status='travelling';
  const issued=issueRobotCommand(c,robot,mission.ref.id,revision,current,mission.state.speedLimitMps);
  events.push(changed('MissionRetargeted',mission,{stops,revision,commandRevision:revision,commandId:issued.commandId,targetRevision}),changed('RobotGoalRetargeted',robot,{goalState:'pending',availability:'busy'}),issued.event);
  if(old) events.push(changed('RobotCommandSuperseded',old,{status:'superseded',supersededBy:issued.commandId}));
  effects.push(issued.effect as unknown as JsonObject);
 }
 return {events,effects};
}
