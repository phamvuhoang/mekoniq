import type { JsonObject, RobotCommand } from '../../../contracts/src/index';
import { hashPayload } from '../../../contracts/src/canonical';
import { validateRobotCommand } from '../../../contracts/src/validate';
import type { NativeAcceptance, NativeCancellation, NativeExecutionState, Reachability, ResolvedTarget, RobotAdapter, RobotEvent, RobotManifest, StopAcknowledgement, TargetBinding } from '../contract';
import { missingCapabilities, VALETUDO_PIN, type ValetudoProfile } from './capabilities';
import { assess, stationary, type GoalRecord } from './completion';
import type { ValetudoSample } from './map';
import { executionState } from './reconcile';
/**
 * One transport per robot, fixed at construction (a trip never changes transport). `goto` resolves `accepted` only on Valetudo's HTTP 200,
 * `delivered` when only a broker took it (MQTT: acceptance then needs motion evidence), `unknown` when the outcome cannot be known.
 * `native` = the Android executor (robot-executor-bridge.ts), the only transport allowed to reach a robot from the tablet.
 */
export interface ValetudoTransport {
 readonly kind:'rest'|'mqtt'|'native';
 capabilities():Promise<string[]>;
 goto(command:RobotCommand,goal:{x:number;y:number}):Promise<{ack:'accepted'|'delivered'|'rejected'|'unknown';reason?:string}>;
 /** `acknowledged` only when the robot side answered (Valetudo REST 200); `delivered` = a broker took it (MQTT), never an acknowledgement. */
 stop(reason:string,commandId?:string):Promise<'acknowledged'|'delivered'|'rejected'|'unknown'>;
 /** Samples received since `sinceMs`; REST takes one now, MQTT returns its current aggregate, native returns journaled observations. */
 samples(sinceMs:number,commandId?:string):Promise<ValetudoSample[]>;
 /** Native only: the durable journal row of a command this WebView instance never saw (reload). */
 restore?(commandId:string):Promise<GoalRecord|undefined>;
}
const ACTIVE=['sending','executing','cancelling'];
export class ValetudoAdapter implements RobotAdapter {
 readonly executor:'native'|undefined;
 private goals=new Map<string,GoalRecord>();
 private commands=new Map<string,RobotCommand>();
 private listeners=new Set<(event:RobotEvent)=>void>();
 private sequence=0n;private epoch=0;private caps?:string[];private last?:ValetudoSample;private stopAtMs?:number;private stopSamples:ValetudoSample[]=[];private reportedSafety?:string;private seenMs=-Infinity;
 private readonly bootId=`valetudo-${crypto.randomUUID()}`;
 constructor(private profile:ValetudoProfile,private readonly transport:ValetudoTransport,private now:()=>number=Date.now) {
  if(profile.transport!==transport.kind) throw new Error('TRANSPORT_MISMATCH');
  this.executor=transport.kind==='native'?'native':undefined;
 }
 async describe():Promise<RobotManifest> {
  const p=this.profile;
  return {id:p.robotId,adapter:'valetudo',protocolVersion:`valetudo-${p.transport==='mqtt'?'mqtt-homie':'rest-v2'}@${VALETUDO_PIN.version}`,firmware:p.firmware,capabilities:[...p.capabilities],mapId:p.mapId,mapRevision:p.mapRevision,offlineExecution:p.offlineExecution,maxLoadMinor:p.maxLoadMinor,trays:p.trays,validation:p.validation,targetKind:'valetudo',units:'cm',frame:p.frame,speedControl:false,zoneEnforcement:false,docking:true};
 }
 /** Domain metres → Valetudo map cm (integers, same axes: bindings for this driver are taught in the robot's own map frame). */
 async resolveTarget(t:TargetBinding):Promise<ResolvedTarget> {
  const p=this.profile;
  if(t.mapId!==p.mapId||t.mapRevision!==p.mapRevision) throw new Error('MAP_MISMATCH');
  if(t.frame!==p.frame) throw new Error('FRAME_MISMATCH');
  if(typeof t.x!=='number'||typeof t.y!=='number'||!Number.isFinite(t.x)||!Number.isFinite(t.y)) throw new Error('INVALID_TARGET');
  return {kind:'valetudo',mapId:t.mapId,mapRevision:t.mapRevision,frame:t.frame,x:Math.round(t.x*100),y:Math.round(t.y*100)};
 }
 async estimateReachability(t:ResolvedTarget):Promise<Reachability> {
  const s=this.last,p=this.profile;
  const reason=t.kind!=='valetudo'||t.mapId!==p.mapId||t.mapRevision!==p.mapRevision?'MAP_MISMATCH':!s?.reachable||this.now()-s.receivedAtMs>p.freshMs?'TELEMETRY_STALE':s.mapFingerprint!==p.mapFingerprint?'MAP_CHANGED':s.status==='error'?'ROBOT_ERROR':undefined;
  return reason?{reachable:false,reason}:{reachable:true,reason:'OK'};
 }
 private emit(type:RobotEvent['type'],commandId:string,extra:JsonObject={}):void {
  const c=this.commands.get(commandId);this.sequence++;
  const event:RobotEvent={type,id:`${this.bootId}-${this.sequence}`,commandId,bootId:this.bootId,sequence:String(this.sequence),observedAt:new Date(this.now()).toISOString(),payload:{robotId:this.profile.robotId,...(c?{missionId:c.missionId,missionRevision:c.missionRevision,controlEpoch:c.controlEpoch}:{}),transport:this.transport.kind,...extra}};
  for(const listener of this.listeners) listener(event);
 }
 private refuse(reason:string):NativeAcceptance {return {accepted:false,unknown:false,reason};}
 async execute(raw:RobotCommand):Promise<NativeAcceptance> {
  let command:RobotCommand;try{command=validateRobotCommand(raw);}catch{return this.refuse('INVALID_COMMAND');}
  const hash=hashPayload(command as never),old=this.goals.get(command.commandId),p=this.profile;
  if(old) { // Same command again: report what the journal knows, never a second goto.
   if(old.hash!==hash) throw new Error('IDEMPOTENCY_CONFLICT');
   const accepted=['completed','cancelling','cancelled'].includes(old.state)||(old.state==='executing'&&(this.transport.kind!=='mqtt'||Boolean(old.motionSeen)));
   return {accepted,unknown:!accepted&&['sending','executing','unknown'].includes(old.state),...(old.reason?{reason:old.reason}:{})};
  }
  if(command.robotId!==p.robotId) return this.refuse('ROBOT_MISMATCH');
  if(command.controlEpoch<this.epoch) return this.refuse('STALE_CONTROL_EPOCH');
  if(Date.parse(command.expiresAt)<=this.now()) return this.refuse('EXPIRED_COMMAND');
  if(command.limits.speedLimitMps!==undefined) return this.refuse('SPEED_UNSUPPORTED'); // Valetudo cannot limit speed; never ignore a limit silently.
  let target:ResolvedTarget;try{target=await this.resolveTarget(command.target as unknown as TargetBinding);}catch(e){return this.refuse((e as Error).message);}
  if(target.kind!=='valetudo') return this.refuse('INVALID_TARGET');
  if([...this.goals.values()].some(g=>ACTIVE.includes(g.state))) return this.refuse('PREVIOUS_GOAL_ACTIVE');
  if(this.stopAtMs!==undefined) return this.refuse('STOP_UNCONFIRMED'); // STOP then retarget: wait for stationary evidence, never a timer.
  try{this.caps??=await this.transport.capabilities();}catch{return this.refuse('ROBOT_UNREACHABLE');}
  const missing=missingCapabilities(this.caps);if(missing.length) return this.refuse('CAPABILITY_UNSUPPORTED');
  if(this.transport.kind!=='native') { // Before any mutation: the robot must be reachable now and on the bound map (the native executor checks its own).
   const pre=(await this.transport.samples(this.now()).catch(()=>[])).at(-1);if(pre)this.last=pre;
   if(!pre?.reachable||pre.retained||this.now()-pre.receivedAtMs>p.freshMs) return this.refuse('ROBOT_UNREACHABLE');
   if(pre.mapFingerprint!==p.mapFingerprint) return this.refuse('MAP_MISMATCH');
   if(pre.status==='error') return this.refuse('ROBOT_ERROR');
  }
  this.epoch=Math.max(this.epoch,command.controlEpoch);
  const goal:GoalRecord={commandId:command.commandId,hash,goal:{x:target.x,y:target.y},state:'sending',samples:[]};
  this.goals.set(command.commandId,goal);this.commands.set(command.commandId,structuredClone(command));
  const result=await this.transport.goto(command,goal.goal).catch(()=>({ack:'unknown' as const,reason:'NO_ACK'}));
  if(result.ack==='rejected') {goal.state='failed';goal.reason=result.reason ?? 'GOTO_REJECTED';this.emit('rejected',command.commandId,{reason:goal.reason});return this.refuse(goal.reason);}
  if(result.ack==='unknown') {goal.state='unknown';goal.reason=result.reason ?? 'NO_ACK';this.emit('unknown',command.commandId,{reason:goal.reason});return {accepted:false,unknown:true,reason:goal.reason};}
  goal.state='executing';goal.ackAtMs=this.now();
  if(result.ack==='delivered') return {accepted:false,unknown:true,reason:'AWAITING_MOTION_EVIDENCE'};
  this.emit('accepted',command.commandId);
  await this.poll();
  return {accepted:true,unknown:false};
 }
 /** One telemetry round: journal samples into active goals, assess, emit transitions (each at most once). Run by the runtime loop. */
 async poll():Promise<void> {
  const active=[...this.goals.values()].filter(g=>ACTIVE.includes(g.state)&&(g.ackAtMs!==undefined||g.stopAtMs!==undefined));
  // With no goal, still read the robot's current state (robot-level safety): from the last sample seen, or one freshness window back.
  const since=Math.min(...active.map(g=>g.ackAtMs ?? g.stopAtMs!),this.stopAtMs ?? Infinity,Number.isFinite(this.seenMs)?this.seenMs:this.now()-this.profile.freshMs);
  let samples:ValetudoSample[]=[];
  try{samples=await this.transport.samples(since,active[0]?.commandId);}catch{samples=[{receivedAtMs:this.now(),reachable:false}];}
  if(!samples.length&&this.transport.kind!=='native') samples=[{receivedAtMs:this.now(),reachable:false}];
  samples=samples.filter(s=>s.receivedAtMs>this.seenMs).sort((a,b)=>a.receivedAtMs-b.receivedAtMs); // native replays its journal: only new rows count
  const last=samples.at(-1);if(!last) {for(const goal of active) this.settle(goal);return;}
  this.last=last;this.seenMs=last.receivedAtMs;
  // Robot-level safety (no command, no epoch: the forwarder stamps the robot's current epoch). Re-emitted every round until the domain
  // accepted that state (safetyAccepted). A fault is reported from any reachable sample, a clear only from a fresh one.
  const observed=last.reachable?last.status==='error'?'fault':this.now()-last.receivedAtMs<=this.profile.freshMs?'clear':undefined:undefined;
  if(observed&&observed!==this.reportedSafety) this.emit('safety_state','',{safetyState:observed,...(last.error?{detail:last.error}:{})});
  for(const goal of active) {
   const lastAt=goal.samples.at(-1)?.receivedAtMs ?? -Infinity;
   goal.samples.push(...samples.filter(s=>s.receivedAtMs>lastAt));goal.samples.splice(0,Math.max(0,goal.samples.length-500));
   this.settle(goal);
  }
  if(this.stopAtMs!==undefined) { // A telemetry gap restarts the stop evidence; it clears only on a fresh stationary idle stretch.
   for(const s of samples) if(s.receivedAtMs>=this.stopAtMs&&!s.retained) this.stopSamples=s.reachable?[...this.stopSamples,s]:[];
   const st=this.stopSamples;
   if(st.length&&this.now()-st.at(-1)!.receivedAtMs<=this.profile.freshMs&&stationary(st,this.profile)) {this.stopAtMs=undefined;this.stopSamples=[];}
  }
 }
 private settle(goal:GoalRecord):void {
  const verdict=assess(goal,this.profile,this.now());
  if(!goal.motionSeen&&(verdict.state==='progress'||verdict.state==='completed')) {
   goal.motionSeen=true;
   if(this.transport.kind==='mqtt') this.emit('accepted',goal.commandId,{evidence:'motion'});
   this.emit('progress',goal.commandId);
  }
  if(['completed','cancelled','failed','unknown'].includes(verdict.state)) {
   goal.state=verdict.state as GoalRecord['state'];goal.reason=verdict.reason;
   this.emit(verdict.state as RobotEvent['type'],goal.commandId,{...(verdict.reason?{reason:verdict.reason}:{}),...(verdict.distanceM!==undefined?{distanceM:verdict.distanceM}:{})});
  }
 }
 /** The domain accepted this robot-level safety state (Robot.Observe); stop re-emitting it. */
 safetyAccepted(state:string):void {this.reportedSafety=state;}
 async cancel(commandId:string):Promise<NativeCancellation> {
  const goal=this.goals.get(commandId);
  if(!goal) return {acknowledged:false,unknown:true};
  if(!ACTIVE.includes(goal.state)&&goal.state!=='unknown') return {acknowledged:false,unknown:false}; // An unknown goal may still be driving: stop it.
  const r=await this.transport.stop('cancel',commandId).catch(()=>'unknown' as const);
  if(r==='rejected') return {acknowledged:false,unknown:false};
  // Delivered-only (MQTT) or unanswered STOPs may still have stopped the robot: cancel waits for stationary evidence either way.
  goal.state='cancelling';goal.stopAtMs=this.now();goal.ackAtMs??=goal.stopAtMs;this.stopAtMs=goal.stopAtMs;this.stopSamples=[];
  return {acknowledged:r==='acknowledged',unknown:r!=='acknowledged'};
 }
 /** A stop request is never a physical-stop proof; running goals become unknown and new goals wait for stationary evidence. */
 async requestStop(reason:string):Promise<StopAcknowledgement> {
  if(!reason) throw new Error('STOP_REASON_REQUIRED');
  const r=await this.transport.stop(reason).catch(()=>'unknown' as const);
  this.stopAtMs=this.now();this.stopSamples=[];
  for(const goal of this.goals.values()) if(ACTIVE.includes(goal.state)) {goal.state='unknown';goal.reason='STOP_REQUESTED';this.emit('unknown',goal.commandId,{reason:'STOP_REQUESTED'});}
  return {acknowledged:r==='acknowledged',physicalStopConfirmed:false};
 }
 observe(listener:(event:RobotEvent)=>void):()=>void {this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
 async reconcile(commandId:string):Promise<NativeExecutionState> {
  let goal=this.goals.get(commandId);
  if(!goal&&this.transport.restore) {goal=await this.transport.restore(commandId);if(goal)this.goals.set(commandId,goal);}
  return executionState(goal,this.transport.kind);
 }
}
