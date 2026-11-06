import type { ModuleRegistry } from '../modules';
import {coffeeStopEvents} from '../beverage/module';
import type { CommandEnvelope, Decision, DomainEvent, JsonObject, Snapshot } from '../../../contracts/src/index';
import { all, changed, created, done, expectVersion, fail, find, handle, requireState, stableId, text } from '../restaurant-context';
import { legHoldReason, missionDemand, selectRobot } from './scheduler';
import { homeTarget } from './map-binding';
import { productionControls } from './dispatcher-cutover';
import { issueRobotCommand } from './command-journal';
import type { MissionStop } from './stop';

function allocationsFor(s:Snapshot[],ids:string[]):Snapshot[] {return ids.map(id=>requireState(s,'allocation',id));}
function onboardCargo(s:Snapshot[],mission:Snapshot,events:DomainEvent[]=[]):boolean {
 const cargo=all(s,'allocation').filter(a=>a.state.missionId===mission.ref.id);
 if(!cargo.length)return Boolean(mission.state.loaded); // Manual collect/unload missions have no delivery allocation.
 return cargo.some(a=>{
  const update=events.find(event=>event.data.kind==='allocation'&&event.data.id===a.ref.id);
  return ((update?.data.state as JsonObject | undefined)?.status??a.state.status)==='loaded';
 });
}
function adjustAllocations(s:Snapshot[],allocations:Snapshot[],action:'load'|'serve'|'release'|'return',at:string):DomainEvent[] {
 const events:DomainEvent[]=[];
 const byLine=new Map<string,bigint>();
 for(const allocation of allocations) {
  const expected=action==='load'||action==='release'?'reserved':'loaded';
  if(allocation.state.status!==expected) return fail('ALLOCATION_STATE_CONFLICT');
  events.push(changed(action==='serve'?'DeliveryHandedOff':action==='load'?'CargoLoaded':action==='return'?'CargoReturned':'AllocationReleased',allocation,{status:action==='load'?'loaded':action==='serve'?'served':action==='return'?'returned':'cancelled',updatedAt:at}));
  const lineId=String(allocation.state.lineId);
  byLine.set(lineId,(byLine.get(lineId) ?? 0n)+BigInt(String(allocation.state.quantity)));
 }
 if(action!=='load') for(const [lineId,n] of byLine) {
  const line=requireState(s,'fulfillment',lineId),allocated=BigInt(String(line.state.allocated)),ready=BigInt(String(line.state.ready));
  if(allocated<n || ((action==='serve'||action==='return')&&ready<n)) return fail('ALLOCATION_CORRUPT');
  const update:JsonObject={allocated:String(allocated-n)};
  if(action==='serve'||action==='return') update.ready=String(ready-n);
  if(action==='serve') update.served=String(BigInt(String(line.state.served))+n);
  if(action==='return') update.returned=String(BigInt(String(line.state.returned ?? '0'))+n);
  events.push(changed('FulfillmentQuantityChanged',line,update));
 }
 return events;
}
function nextStop(c:CommandEnvelope,s:Snapshot[],mission:Snapshot,stops:MissionStop[],loaded:boolean,status='executing') {
 const next=stops.find(stop=>stop.status==='pending');
 const robot=requireState(s,'robot',String(mission.state.robotId));
 const revision=Number(mission.state.revision)+1;
 const cancelling=status==='cancelling'||Boolean(mission.state.cancelRequestedAt);
 if(!next) {
  const completed=changed(cancelling?'MissionCancelled':'MissionCompleted',mission,{stops,status:cancelling?'cancelled':'completed',loaded,currentStopId:null,revision});
  if(loaded)return fail('UNRESOLVED_CARGO');
  const released={...robot,state:{...robot.state,availability:'idle',goalState:'completed',missionId:null}};
  const queued=all(s,'mission').filter(m=>m.state.status==='queued'&&(!m.state.preferredRobotId||m.state.preferredRobotId===robot.ref.id)).sort((a,b)=>BigInt(String(a.state.queueRank))<BigInt(String(b.state.queueRank))?-1:1);
  for(const candidate of queued) {
   const pending=structuredClone(candidate.state.stops) as MissionStop[];
   if(!productionControls(s,robot.ref.id))continue; // a robot handed to another dispatcher takes no queued work from this one
   try{selectRobot([released],missionDemand(s,candidate.state,pending.map(stop=>stop.targetId),Math.max(((candidate.state.allocationIds??[]) as string[]).length,1)),robot.ref.id);}catch{continue;}
   const first=pending.find(stop=>stop.status==='pending');if(!first)continue;
   first.status='travelling';
   const issued=issueRobotCommand(c,released,candidate.ref.id,1,first,candidate.state.speedLimitMps);
   return done([completed,changed('QueuedMissionAssigned',candidate,{status:'assigned',robotId:robot.ref.id,stops:pending,currentStopId:first.id,revision:1,commandRevision:1,commandId:issued.commandId,controlEpoch:robot.state.controlEpoch!}),changed('RobotAssigned',robot,{availability:'busy',missionId:candidate.ref.id,goalState:'pending'}),issued.event],{missionId:mission.ref.id,status:cancelling?'cancelled':'completed',assignedMissionId:candidate.ref.id,effects:[issued.effect as unknown as JsonObject]});
  }
  return done([completed,changed('RobotReleased',robot,{availability:'idle',goalState:'completed',missionId:null})],{missionId:mission.ref.id,status:cancelling?'cancelled':'completed'});
 }
 // Never journal coordinates from an old map: a robot that reports a new map (or lost the binding) mid-mission is held, not released, and the
 // leg stays pending until an operator rebinds and resumes it (Mission.Resume). Work already confirmed with this command still commits.
 // A robot whose safety state is set and not clear is held the same way (SAFETY_NOT_CLEAR) until a 'clear' observation and a Resume, and so
 // is a leg whose target's clearance does not admit the robot's footprint (FOOTPRINT_*: a move/merge can rewrite a later stop).
 const stale=legHoldReason(s,mission.state,robot,next.targetId);
 if(stale) return done([changed('MissionNeedsAttention',mission,{stops,status:'needs_attention',attentionReason:stale,loaded,currentStopId:next.id})],{missionId:mission.ref.id,status:'needs_attention',reason:stale});
 next.status='travelling';
 const issued=issueRobotCommand(c,robot,mission.ref.id,revision,next,mission.state.speedLimitMps);
 return done([changed('MissionStopAdvanced',mission,{stops,status:'executing',loaded,currentStopId:next.id,revision,commandRevision:revision,commandId:issued.commandId,...(mission.state.attentionReason?{attentionReason:null}:{})}),changed('RobotGoalAssigned',robot,{goalState:'pending',availability:'busy'}),issued.event],{missionId:mission.ref.id,commandId:issued.commandId,effects:[issued.effect as unknown as JsonObject]});
}
/**
 * Mission.Create body; Mission.Guide/Mission.Bus build their stops and come through here, so robot selection stays one path (selectRobot over
 * eligibleRobots). `target` is a one-stop standby shorthand; target 'home' (needs robotId) is that robot's dock, or its parking point without one.
 * Optional loadMinor (grams, integer string) and speedLimitMps are part of admission and stay on a queued mission for its later assignment.
 */
export function createMission(c:CommandEnvelope,s:Snapshot[]):Decision {
  const missionId=c.payload.missionId ? text(c.payload.missionId) : stableId('mission',c);
  if(find(s,'mission',missionId)) return fail('MISSION_EXISTS');
  if(c.payload.target!==undefined&&(c.payload.stops!==undefined||c.payload.allocationIds!==undefined)) return fail('AMBIGUOUS_MISSION');
  const rawIds=c.payload.allocationIds;
  const ids=Array.isArray(rawIds) ? rawIds.map(value=>text(value)) : [];
  if(new Set(ids).size!==ids.length) return fail('DUPLICATE_ALLOCATION');
  const allocations=allocationsFor(s,ids);
  if(allocations.some(a=>a.state.status!=='reserved'||a.state.missionId)) return fail('ALLOCATION_STATE_CONFLICT');
  let stops:MissionStop[]=[];
  const kind=String(c.payload.kind ?? 'delivery');
  if(allocations.length) {
   const sources=new Map<string,string[]>(),targets=new Map<string,string[]>();
   for(const allocation of allocations) {
    const source=String(allocation.state.stationId),session=requireState(s,'session',String(allocation.state.sessionId)),target=String(session.state.tableId);
    sources.set(source,[...(sources.get(source) ?? []),allocation.ref.id]); targets.set(target,[...(targets.get(target) ?? []),allocation.ref.id]);
   }
   stops=[...Array.from(sources,([targetId,allocationIds],index)=>({id:stableId('stop',c,`load-${index}`),action:'load',targetId,status:'pending',allocationIds})),...Array.from(targets,([targetId,allocationIds],index)=>({id:stableId('stop',c,`handoff-${index}`),action:'handoff',targetId,status:'pending',allocationIds}))];
  } else if(c.payload.target!==undefined) {
   const requested=typeof c.payload.robotId==='string'&&c.payload.robotId!=='any'?c.payload.robotId:undefined;
   const targetId=c.payload.target==='home'?homeTarget(requireState(s,'robot',requested ?? fail('ROBOT_REQUIRED')).state):text(c.payload.target,'INVALID_TARGET');
   stops=[{id:stableId('stop',c,'target'),action:'standby',targetId,status:'pending',allocationIds:[]}];
  } else {
   if(!Array.isArray(c.payload.stops)||!c.payload.stops.length||c.payload.stops.length>20) return fail('ALLOCATIONS_REQUIRED');
   stops=(c.payload.stops as JsonObject[]).map((stop,index)=>{
    const action=text(stop.action);
    if(!['collect','unload','guide','standby'].includes(action)) return fail('INVALID_STOP_ACTION');
    return {id:stableId('stop',c,`manual-${index}`),action,targetId:text(stop.targetId),status:'pending',allocationIds:[]};
   });
  }
  const demand=missionDemand(s,c.payload,stops.map(stop=>stop.targetId),Math.max(allocations.length,1)),limits={...(demand.loadMinor!==undefined?{loadMinor:demand.loadMinor}:{}),...(demand.speedLimitMps!==undefined?{speedLimitMps:demand.speedLimitMps}:{})};
  if(typeof c.payload.robotId==='string'&&c.payload.robotId!=='any'&&!productionControls(s,c.payload.robotId)) return fail('CONTROLLED_BY_OTHER_DISPATCHER');
  const robot=selectRobot(all(s,'robot').filter(r=>productionControls(s,r.ref.id)),{...demand,allowBusy:true},typeof c.payload.robotId==='string'?c.payload.robotId:undefined);
  if(robot.state.availability!=='idle') {
   const counter=find(s,'fleet-queue','current'),rank=String(BigInt(String(counter?.state.rank??'0'))+1n);
   return done([created('MissionQueued','mission',missionId,{...limits,kind,status:'queued',robotId:null,preferredRobotId:typeof c.payload.robotId==='string'&&c.payload.robotId!=='any'?c.payload.robotId:null,source:stops[0]!.targetId,loaded:false,stops,currentStopId:null,revision:0,allocationIds:ids,queueRank:rank}),{type:'FleetQueueAdvanced',data:{kind:'fleet-queue',id:'current',state:{rank}}},...allocations.map(a=>changed('AllocationAssigned',a,{missionId}))],{missionId,status:'queued'});
  }
  const first=stops[0]!;first.status='travelling';
  const issued=issueRobotCommand(c,robot,missionId,1,first,demand.speedLimitMps);
  return done([created('MissionCreated','mission',missionId,{...limits,kind,status:'assigned',robotId:robot.ref.id,source:first.targetId,loaded:false,stops,currentStopId:first.id,revision:1,commandRevision:1,commandId:issued.commandId,allocationIds:ids,controlEpoch:robot.state.controlEpoch!}),changed('RobotAssigned',robot,{availability:'busy',missionId,goalState:'pending'}),...allocations.map(a=>changed('AllocationAssigned',a,{missionId})),issued.event],{missionId,commandId:issued.commandId,effects:[issued.effect as unknown as JsonObject]});
}
export function registerMissions(registry:ModuleRegistry):void {
 handle(registry,'Mission.Create',createMission);
 handle(registry,'Mission.ConfirmStop',(c,s)=>{
  const mission=requireState(s,'mission',text(c.payload.missionId));expectVersion(c,mission);
  if(!['executing','cancelling'].includes(String(mission.state.status))) return fail('MISSION_STATE_CONFLICT');
  if(c.payload.missionRevision!==mission.state.revision) return fail('STALE_STOP');
  if(c.payload.stopId!==mission.state.currentStopId) return fail('STALE_STOP');
  const stops=structuredClone(mission.state.stops) as MissionStop[];
  const stop=stops.find(x=>x.id===c.payload.stopId) ?? fail('STOP_NOT_FOUND');
  if(stop.status!=='awaiting_action') return fail('ROBOT_NOT_ARRIVED');
  const allocations=allocationsFor(s,stop.allocationIds);
  let events:DomainEvent[]=[],loaded=Boolean(mission.state.loaded);
  if(stop.action==='load') {events=adjustAllocations(s,allocations,'load',c.recordedAt);loaded=true;}
  else if(stop.action==='handoff') {
   events=adjustAllocations(s,allocations,'serve',c.recordedAt);
   loaded=all(s,'allocation').some(a=>a.state.missionId===mission.ref.id&&a.state.status==='loaded'&&!stop.allocationIds.includes(a.ref.id));
  } else if(stop.action==='return') {events=adjustAllocations(s,allocations,'return',c.recordedAt);loaded=false;}
  else if(stop.action==='collect') loaded=true;
  else if(stop.action==='unload') loaded=false;
  // Allocation status is authoritative for delivery cargo; a stop may unload only one source/table.
  if(all(s,'allocation').some(a=>a.state.missionId===mission.ref.id)) loaded=onboardCargo(s,mission,events);
  // a coffee cup is loaded only on a confirmed tray transfer to this robot, and handed off with the stop (beverage/module.ts)
  events=[...events,...coffeeStopEvents(c,s,String(mission.state.robotId),stop.action,String(stop.targetId),allocations)];
  stop.status='completed';
  const next=nextStop(c,s,mission,stops,loaded,String(mission.state.status));
  if(!next.ok) return next;
  return done([...events,...next.events],next.value);
 });
 handle(registry,'Mission.Cancel',(c,s)=>{
  const mission=requireState(s,'mission',text(c.payload.missionId));expectVersion(c,mission);
  if(['completed','cancelled','failed'].includes(String(mission.state.status))) return fail('MISSION_FINAL');
  if(mission.state.status==='queued')return done([changed('MissionCancelled',mission,{status:'cancelled',stops:(structuredClone(mission.state.stops) as MissionStop[]).map(stop=>({...stop,status:'skipped'}))}),...adjustAllocations(s,all(s,'allocation').filter(a=>a.state.missionId===mission.ref.id&&a.state.status==='reserved'),'release',c.recordedAt)],{missionId:mission.ref.id});
  if(mission.state.status==='cancelling') return fail('CANCELLATION_PENDING');
  const stops=structuredClone(mission.state.stops ?? []) as MissionStop[];
  const allocations=all(s,'allocation').filter(a=>a.state.missionId===mission.ref.id);
  const loaded=onboardCargo(s,mission);
  // Collected dishes are never abandoned or carried back to the table: a loaded bussing mission keeps its unload stop.
  const unload=mission.state.kind==='bus'&&loaded?stops.find(stop=>stop.action==='unload'&&stop.status!=='completed'):undefined;
  if(unload?.status==='awaiting_action') return fail('UNLOAD_PENDING');
  for(const stop of stops) if(stop.status!=='completed') stop.status=stop===unload?'pending':'skipped';
  if(loaded&&!unload) {
   const sources=new Map<string,string[]>();
   for(const a of allocations.filter(x=>x.state.status==='loaded')) {const source=String(a.state.stationId);sources.set(source,[...(sources.get(source) ?? []),a.ref.id]);}
   if(!sources.size) sources.set(String(mission.state.source ?? 'kitchen'),[]);
   for(const [source,allocationIds] of sources) stops.push({id:stableId('return-stop',c,String(stops.length)),action:'return',targetId:source,status:'pending',allocationIds});
  }
  const priorStop=(mission.state.stops as MissionStop[] | undefined)?.find(stop=>stop.id===mission.state.currentStopId);
  const robot=find(s,'robot',String(mission.state.robotId));
  if((priorStop?.status==='awaiting_action'&&robot?.state.goalState==='completed')||(mission.state.attentionReason&&robot?.state.availability!=='unknown')) {
   // Arrival is already durable native completion evidence (or the mission is held on a stale binding before its next leg). No running goal remains to cancel.
   const pending=allocations.filter(a=>a.state.status==='reserved');
   const released=adjustAllocations(s,pending,'release',c.recordedAt);
   const returning={...mission,state:{...mission.state,cancelRequestedAt:c.recordedAt}};
   const result=nextStop(c,s,returning,stops,loaded,'cancelling');
   if(!result.ok)return result;
   return done([{type:'MissionCancellationRequested',data:{missionId:mission.ref.id}},...released,...result.events],result.value);
  }
  const revision=Number(mission.state.revision)+1;
  const effects=mission.state.commandId ? [{id:stableId('cancel',c),type:'robot.cancel',payload:{robotId:mission.state.robotId!,commandId:mission.state.commandId!,missionId:mission.ref.id,controlEpoch:mission.state.controlEpoch ?? c.coordinatorEpoch}}] : [];
  return done([changed('MissionCancellationRequested',mission,{status:'cancelling',stops,revision,loaded,cancelRequestedAt:c.recordedAt})],{missionId:mission.ref.id,effects});
 });
 // Mission.Resume {missionId,expectedVersion}: after Robot.BindMap made the held leg's binding current again, issue that leg (new revision/command).
 handle(registry,'Mission.Resume',(c,s)=>{
  const mission=requireState(s,'mission',text(c.payload.missionId));expectVersion(c,mission);
  if(mission.state.status!=='needs_attention'||!mission.state.attentionReason) return fail('MISSION_STATE_CONFLICT');
  const robot=requireState(s,'robot',String(mission.state.robotId)),stops=structuredClone(mission.state.stops) as MissionStop[];
  if(robot.state.availability==='unknown'||['unknown','stop_requested'].includes(String(robot.state.goalState))) return fail('ROBOT_STATE_UNKNOWN');
  const next=stops.find(stop=>stop.status==='pending') ?? fail('STOP_NOT_FOUND'),stale=legHoldReason(s,mission.state,robot,next.targetId);
  if(stale) return fail(stale);
  return nextStop(c,s,mission,stops,Boolean(mission.state.loaded));
 });
 handle(registry,'Robot.Observe',(c,s)=>{
  const robot=requireState(s,'robot',text(c.payload.robotId));
  // safety_state is robot-level (adapter hardware/firmware fault), with or without a mission. Only a later 'clear' observation clears it;
  // admission, nextStop, retarget and Mission.Resume all refuse while it is set and not clear. stop_state is robot-level too: 'rejected'
  // (the robot refused a STOP, which the executor keeps retrying with backoff) sets the operator-visible `stopRejected` until 'acknowledged'.
  // Neither has a command to fence it, so both are bound to the robot's executor: actor `executor:<robotId>` (the forwarder in
  // robot-executor-bridge.ts) on the robot's current owner device. An owner/manager, another robot's executor, or the old owner device after
  // a handoff (RobotOwnerFenced moves ownerDeviceId) is OBSERVER_NOT_BOUND. Mission events (accepted/completed/...) are bound the same way
  // to `executor:<robotId>`, or for a simulator robot to the app simulator runtime's `simulator:<robotId>` (robot-runtime.ts), and are also
  // fenced by commandId + missionRevision + controlEpoch below.
  const robotLevel=c.payload.type==='safety_state'||c.payload.type==='stop_state';
  const observers=[`executor:${robot.ref.id}`,...(!robotLevel&&robot.state.driver==='simulator'?[`simulator:${robot.ref.id}`]:[])];
  if(!observers.includes(c.actorRef)||c.deviceId!==robot.state.ownerDeviceId) return fail('OBSERVER_NOT_BOUND');
  if(robotLevel) {
   if(c.payload.controlEpoch!==robot.state.controlEpoch) return fail('STALE_CONTROL_EPOCH');
   const at=Date.parse(c.occurredAt);
   if(c.payload.type==='stop_state') {
    const stopState=text(c.payload.stopState,'INVALID_STOP_STATE');
    if(!['acknowledged','rejected'].includes(stopState)) return fail('INVALID_STOP_STATE');
    if(typeof robot.state.stopObservedAt==='string'&&at<Date.parse(robot.state.stopObservedAt)) return fail('STALE_STOP_OBSERVATION');
    return done([changed('RobotStopObserved',robot,{stopRejected:stopState==='rejected',stopObservedAt:c.occurredAt})],{robotId:robot.ref.id,stopState});
   }
   const safetyState=text(c.payload.safetyState,'INVALID_SAFETY_STATE');
   if(!['clear','fault','estop'].includes(safetyState)) return fail('INVALID_SAFETY_STATE');
   // Ordering: an observation older than the recorded one is stale, and a clear must be strictly newer, so a replayed old clear never
   // lifts a newer fault.
   const prior=typeof robot.state.safetyObservedAt==='string'?Date.parse(robot.state.safetyObservedAt):Number.NEGATIVE_INFINITY;
   if(at<prior||(safetyState==='clear'&&at<=prior)) return fail('STALE_SAFETY_OBSERVATION');
   return done([changed('RobotSafetyObserved',robot,{safetyState,safetyObservedAt:c.occurredAt})],{robotId:robot.ref.id,safetyState});
  }
  const mission=requireState(s,'mission',text(c.payload.missionId));
  if(c.payload.controlEpoch!==robot.state.controlEpoch||mission.state.robotId!==robot.ref.id) return fail('STALE_CONTROL_EPOCH');
  if(c.payload.commandId!==mission.state.commandId || c.payload.missionRevision!==(mission.state.commandRevision ?? mission.state.revision)) return fail('STALE_ROBOT_EVENT');
  const type=text(c.payload.type);
  const command=find(s,'robot-command',String(c.payload.commandId));
  const commandEvent=command ? [changed('RobotCommandObserved',command,{status:type,observedAt:c.occurredAt})] : [];
  if((type==='cancelled'||type==='completed')&&mission.state.status==='cancelling') {
   const reserved=all(s,'allocation').filter(a=>a.state.missionId===mission.ref.id&&a.state.status==='reserved');
   const released=adjustAllocations(s,reserved,'release',c.recordedAt);
   const next=nextStop(c,s,mission,structuredClone(mission.state.stops) as MissionStop[],onboardCargo(s,mission),'cancelling');
   if(!next.ok) return next;
   return done([...released,...commandEvent,...next.events],next.value);
  }
  if(mission.state.status==='cancelling') return fail('CANCELLATION_RECONCILIATION_REQUIRED');
  const stops=structuredClone(mission.state.stops) as MissionStop[],stop=stops.find(x=>x.id===mission.state.currentStopId) ?? fail('STOP_NOT_FOUND');
  if(['completed','accepted'].includes(type)&&stop.status==='awaiting_action') return done([],{missionId:mission.ref.id});
  if(type==='accepted') return done([...commandEvent,changed('MissionExecuting',mission,{status:'executing'}),changed('RobotGoalAccepted',robot,{goalState:'executing'})],{missionId:mission.ref.id});
  if(type==='completed') {
   if(stop.status!=='travelling') return fail('STALE_ROBOT_EVENT');
   stop.status='awaiting_action';
   return done([...commandEvent,changed('MissionArrived',mission,{status:'executing',stops}),changed('RobotGoalCompleted',robot,{goalState:'completed',position:stop.targetId})],{missionId:mission.ref.id,stopId:stop.id});
  }
  if(['unknown','failed','rejected'].includes(type)) return done([...commandEvent,changed('MissionNeedsAttention',mission,{status:'needs_attention'}),changed('RobotResourceHeld',robot,{availability:'unknown',goalState:type})],{missionId:mission.ref.id});
  return fail('UNSUPPORTED_ROBOT_EVENT');
 });
 handle(registry,'Robot.RequestStop',(c,s)=>{
  const robot=requireState(s,'robot',text(c.payload.robotId));
  const events=[changed('RemoteStopRequested',robot,{goalState:'stop_requested',availability:'unknown'})];
  const mission=robot.state.missionId ? find(s,'mission',String(robot.state.missionId)) : undefined;
  if(mission) events.push(changed('MissionNeedsAttention',mission,{status:'needs_attention'}));
  return done(events,{effects:[{id:stableId('stop',c),type:'robot.requestStop',payload:{robotId:robot.ref.id,reason:String(c.payload.reason ?? 'operator'),controlEpoch:robot.state.controlEpoch!}}],physicalStopConfirmed:false});
 });
}
