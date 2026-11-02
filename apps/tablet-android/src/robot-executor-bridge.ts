import { registerPlugin } from '@capacitor/core';
import { hashPayload } from '../../../packages/contracts/src/index';
import type { CommandEnvelope, JsonObject, RobotCommand, Scope } from '../../../packages/contracts/src/index';
import type { NativeAcceptance, NativeCancellation, NativeExecutionState, RobotEvent, StopAcknowledgement } from '../../../packages/robot-adapters/src/contract';
import { dispatchRobotEffects, robotEventCommand } from '../../../packages/robot-adapters/src/dispatch';
import { ValetudoAdapter, type ValetudoTransport } from '../../../packages/robot-adapters/src/valetudo/adapter';
import { REQUIRED_CAPABILITIES, type ValetudoProfile } from '../../../packages/robot-adapters/src/valetudo/capabilities';
import type { GoalRecord } from '../../../packages/robot-adapters/src/valetudo/completion';
import type { ValetudoSample } from '../../../packages/robot-adapters/src/valetudo/map';
import { profileReason } from '../../../packages/domain/src/fleet/capabilities';
import type { ModuleRegistry } from '../../../packages/domain/src/modules';
import { processCommand } from '../../../packages/sync/src/command-processor';
import type { DurableStore } from '../../../packages/sync/src/store';
/**
 * Typed Capacitor bridge to the native executor (executor/ExecutorPlugin.kt). Only commands, command ids and stop reasons cross it — never a
 * URL or a raw request; the robot endpoint lives in the provisioned native profile. Every call renews the native UI lease.
 */
export interface ExecutorBridge {
 submit(input:{command:RobotCommand}):Promise<NativeAcceptance>;
 reconcile(input:{commandId:string}):Promise<NativeExecutionState>;
 cancel(input:{commandId:string}):Promise<NativeCancellation>;
 requestStop(input:{reason:string}):Promise<StopAcknowledgement>;
 observations(input:{sinceMs:number}):Promise<{samples:ValetudoSample[]}>;
}
export const Executor=registerPlugin<ExecutorBridge>('Executor');
/** ValetudoTransport over the native executor: the native side journals, converts m→cm, checks map/epoch/speed and talks to the robot. */
export class NativeExecutorTransport implements ValetudoTransport {
 readonly kind='native' as const;
 constructor(private bridge:ExecutorBridge=Executor) {}
 async capabilities() {return [...REQUIRED_CAPABILITIES];} // the native executor checks the robot's own list before every goto
 async goto(command:RobotCommand) {
  const a=await this.bridge.submit({command});
  return a.accepted?{ack:'accepted' as const}:a.unknown?{ack:'unknown' as const,reason:a.reason ?? 'NO_ACK'}:{ack:'rejected' as const,reason:a.reason ?? 'REFUSED'};
 }
 async stop(reason:string,commandId?:string) {
  if(commandId) {const r=await this.bridge.cancel({commandId});return r.acknowledged?'acknowledged' as const:r.unknown?'unknown' as const:'rejected' as const;}
  const r=await this.bridge.requestStop({reason});return r.acknowledged?'acknowledged' as const:r.stopRejected?'rejected' as const:'unknown' as const;
 }
 async samples(sinceMs:number) {return (await this.bridge.observations({sinceMs:Number.isFinite(sinceMs)?sinceMs:0})).samples;}
 /** After a WebView reload: rebuild the goal from the native journal so the shared arrival rule can judge it; no journal row ⇒ unknown. */
 async restore(commandId:string):Promise<GoalRecord|undefined> {
  const s=await this.bridge.reconcile({commandId}),e=s.evidence;
  if(e.reason==='NO_GOAL_QUERY'||!e.goal) return undefined;
  const nativeState=String(e.nativeState),state=(nativeState==='superseded'?'unknown':nativeState) as GoalRecord['state'];
  return {commandId,hash:String(e.hash),goal:e.goal as {x:number;y:number},state,...(typeof e.ackAtMs==='number'?{ackAtMs:e.ackAtMs}:{}),...(typeof e.stopAtMs==='number'?{stopAtMs:e.stopAtMs}:{}),...(typeof e.reason==='string'?{reason:e.reason}:{}),samples:(e.samples ?? []) as unknown as ValetudoSample[]};
 }
}
/**
 * Tablet runtime for one provisioned Valetudo robot: robot effects go to the native executor (dispatchRobotEffects accepts a non-simulated
 * adapter only when executor==='native'), telemetry rounds run the shared evidence rule, and events become Robot.Observe commands. Events are
 * authorized only for a robot whose profile is dispatchable (hardware_validated / venue_approved) — never the case from emulator evidence.
 */
export function startNativeValetudoRuntime(options:{store:DurableStore;scope:Scope;registry:ModuleRegistry;profile:ValetudoProfile;bridge?:ExecutorBridge;nowMs?:()=>number;intervalMs?:number;onError?:(error:Error)=>void}) {
 const {store,scope,registry,profile}=options,now=options.nowMs ?? Date.now;
 const adapter=new ValetudoAdapter(profile,new NativeExecutorTransport(options.bridge),now),events:RobotEvent[]=[];
 const unsubscribe=adapter.observe(event=>events.push(event));
 let stopped=false,timer:ReturnType<typeof setTimeout>|undefined,tail:Promise<unknown>=Promise.resolve();
 async function forward(event:RobotEvent) {
  const snapshots=await store.snapshots(scope),authority=snapshots.find(s=>s.ref.kind==='__scope__')?.state,robot=snapshots.find(s=>s.ref.kind==='robot'&&s.ref.id===profile.robotId);
  if(!authority||!robot||robot.state.ownerDeviceId!==authority.ownerDeviceId) return false;
  // Robot-level safety/stop observations carry no command and no epoch of their own: they are facts about the physical robot, bound to identity
  // (owner device + this robot's executor actor + a dispatchable profile), so the robot's current epoch is stamped here, not the adapter's.
  const payload=robotEventCommand(event);
  if(event.type==='safety_state'||event.type==='stop_state') payload.controlEpoch=robot.state.controlEpoch ?? 0;
  const actorRef=`executor:${profile.robotId}`,timestamp=new Date(now()).toISOString();
  const command:CommandEnvelope={schemaVersion:1,...scope,operationId:hashPayload({robotId:profile.robotId,eventId:event.id,bootId:event.bootId}),type:'Robot.Observe',actorRef,deviceId:String(authority.ownerDeviceId),deviceEpoch:String(authority.deviceEpoch),coordinatorEpoch:Number(authority.coordinatorEpoch),policyRevision:Number(authority.policyRevision),occurredAt:event.observedAt,recordedAt:timestamp,payload,payloadHash:hashPayload(payload)};
  const result=await processCommand(store,command,(c,s)=>registry.decide(c,s),async c=>c.actorRef===actorRef&&c.deviceId===authority.ownerDeviceId&&robot.state.driver==='valetudo'&&profileReason(robot.state)===undefined);
  if(event.type==='safety_state'&&result.status==='accepted') adapter.safetyAccepted(String(event.payload.safetyState)); // latch only once recorded
  // Retry transient failures with the same event identity. Stale/unsupported events have a definitive domain disposition.
  // Recovery may rediscover acceptance after Mission.Cancel committed. That historical acceptance/progress can never advance a cancelling mission.
  const supersededByCancellation=result.status==='rejected'&&result.code==='CANCELLATION_RECONCILIATION_REQUIRED'&&['accepted','progress'].includes(event.type);
  return result.status==='accepted'||supersededByCancellation||(result.status==='rejected'&&['STALE_ROBOT_EVENT','STALE_CONTROL_EPOCH','UNSUPPORTED_ROBOT_EVENT','STALE_SAFETY_OBSERVATION','STALE_STOP_OBSERVATION'].includes(result.code??''));
 }
 async function runStep() {
  if(stopped) return;
  const snapshots=await store.snapshots(scope),authority=snapshots.find(s=>s.ref.kind==='__scope__')?.state,robot=snapshots.find(s=>s.ref.kind==='robot'&&s.ref.id===profile.robotId);
  if(!authority||!robot||robot.state.ownerDeviceId!==authority.ownerDeviceId||profileReason(robot.state)!==undefined)return;
  const effects=await store.effects(scope,'robot.execute');
  // Accepted effects disappear from dispatch's worklist, but their active native goals still need recovery after every WebView reload.
  for(const effect of effects.filter(e=>['confirmed','dispatching','unknown'].includes(String(e.status)))) {
   const command=effect.payload as unknown as RobotCommand;
   if(command.robotId!==profile.robotId||command.controlEpoch!==robot.state.controlEpoch||command.issuerDeviceId!==authority.ownerDeviceId||command.organizationId!==scope.organizationId||command.venueId!==scope.venueId)continue;
   const mission=snapshots.find(s=>s.ref.kind==='mission'&&s.ref.id===command.missionId);
   const history=snapshots.find(s=>s.ref.kind==='robot-command'&&s.ref.id===command.commandId)?.state;
   // An old cancellation matters only before its replacement was sent. Native superseded rows are historical once the current goto exists.
   const replacement=effects.find(e=>(e.payload as JsonObject).commandId===mission?.state.commandId);
   const superseded=history?.status==='superseded'&&history.supersededBy===mission?.state.commandId&&(!replacement||replacement.status==='pending');
   if(mission&&['assigned','executing','cancelling','needs_attention'].includes(String(mission.state.status))&&(mission.state.commandId===command.commandId||superseded))await adapter.recover(command);
  }
  await dispatchRobotEffects(store,scope,adapter,now());
  await adapter.poll();
  // A failed forward leaves the event at the head of the queue; a retry uses its original operation identity.
  while(events.length){if(!await forward(events[0]!))break;events.shift();}
 }
 function step(){const result=tail.then(runStep);tail=result.catch(()=>{});return result;}
 const interval=options.intervalMs ?? 1000;
 async function loop(){try{await step();}catch(error){options.onError?.(error instanceof Error?error:new Error('EXECUTOR_RUNTIME_FAILURE'));}finally{if(!stopped)timer=setTimeout(()=>{void loop();},interval);}}
 if(interval>0) void loop();
 return {adapter,step,async close(){stopped=true;if(timer)clearTimeout(timer);await tail;unsubscribe();}};
}
