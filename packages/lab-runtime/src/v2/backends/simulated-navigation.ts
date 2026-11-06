// RobotAdapter over the gazebo_nav2 backend for one robot: simulator profile (adapter 'simulator', validation 'simulated'), so production
// admission treats it exactly like the mock. Completion comes only from the worker's goal query (accepted + SUCCEEDED + error_code 0);
// a lost reply is unknown and is never resent; a Nav2-side cancel the domain did not ask for is a failure, not a quiet end.
import type {JsonValue,RobotCommand} from '../../../../contracts/src/index';
import {hashPayload} from '../../../../contracts/src/canonical';
import type {NativeExecutionState,RobotAdapter,RobotEvent,RobotManifest,TargetBinding,ResolvedTarget} from '../../../../robot-adapters/src/contract';
import {GAZEBO_NAV2,type GazeboBackend} from './gazebo-nav2';
type GoalState=NativeExecutionState['status'];
interface Goal {commandId:string;hash:string;command:RobotCommand;state:GoalState;reported:boolean;cancelRequested:boolean;nativeGoalId:string|null;reason:string|null}
export class SimulatedNavigationAdapter implements RobotAdapter {
 readonly model=GAZEBO_NAV2.model;
 private listeners=new Set<(e:RobotEvent)=>void>();private goals=new Map<string,Goal>();private seq=0;
 constructor(private backend:GazeboBackend,private manifest:RobotManifest,private nowMs:()=>number=Date.now){
  if(manifest.validation!=='simulated'||manifest.adapter!=='simulator')throw new Error('SIMULATION_PROFILE_REQUIRED');
 }
 private async bootId(){return (await this.backend.capability()).bootId??'worker-unavailable';}
 private async emit(type:RobotEvent['type'],g:Goal,extra:Record<string,string|null>={}){
  this.seq++;const c=g.command,bootId=await this.bootId();
  const e:RobotEvent={type,id:`${bootId}-${this.seq}`,commandId:g.commandId,bootId,sequence:String(this.seq),observedAt:new Date(this.nowMs()).toISOString(),
   payload:{robotId:c.robotId,missionId:c.missionId,missionRevision:c.missionRevision,controlEpoch:c.controlEpoch,simulated:true,model:GAZEBO_NAV2.model,backend:GAZEBO_NAV2.id,...g.nativeGoalId?{nativeGoalId:g.nativeGoalId}:{},...extra}};
  for(const l of this.listeners)l(e);
 }
 async describe(){return structuredClone(this.manifest);}
 async resolveTarget(t:TargetBinding):Promise<ResolvedTarget>{
  if(t.mapId!==this.manifest.mapId||t.mapRevision!==this.manifest.mapRevision)throw new Error('MAP_MISMATCH');
  if(!Number.isFinite(t.x)||!Number.isFinite(t.y))throw new Error('INVALID_TARGET');
  return {kind:'ros',mapId:t.mapId,mapRevision:t.mapRevision,frame:t.frame,x:t.x!,y:t.y!,yaw:t.yaw??0};
 }
 /** Reachability is Nav2's answer at goal time; this side only checks the map identity (no planner, no ETA claim). */
 async estimateReachability(t:ResolvedTarget){
  if(t.kind!=='ros'||t.mapId!==this.manifest.mapId||t.mapRevision!==this.manifest.mapRevision)return {reachable:false,reason:'MAP_MISMATCH'};
  return {reachable:true,reason:'UNVERIFIED_UNTIL_GOAL'};
 }
 async execute(command:RobotCommand){
  const hash=hashPayload(command as never),old=this.goals.get(command.commandId);
  if(old){if(old.hash!==hash)throw new Error('IDEMPOTENCY_CONFLICT');return {accepted:old.state!=='failed',nativeGoalId:old.nativeGoalId??command.commandId,unknown:old.state==='unknown'};}
  if(Date.parse(command.expiresAt)<=this.nowMs())return {accepted:false,unknown:false,reason:'EXPIRED_COMMAND'};
  const g:Goal={commandId:command.commandId,hash,command:structuredClone(command),state:'sending',reported:false,cancelRequested:false,nativeGoalId:null,reason:null};
  this.goals.set(command.commandId,g);
  const refuse=async(reason:string)=>{g.state='failed';g.reason=reason;g.reported=true;await this.emit('rejected',g,{reason});return {accepted:false,unknown:false,reason};};
  const t=command.target as {mapId:string;mapRevision:string};
  if(t.mapId!==this.manifest.mapId||t.mapRevision!==this.manifest.mapRevision)return refuse('MAP_MISMATCH');
  if(command.robotId!==this.manifest.id)return refuse('ROBOT_MISMATCH');
  if([...this.goals.values()].some(x=>x!==g&&x.state==='executing'))return refuse('GOAL_ACTIVE');
  let answer:Record<string,unknown>;
  try{answer=await this.backend.execute(this.manifest.id,command);}catch(e){answer={status:'unknown',reason:`NO_ACK:${(e as Error).message}`};}
  g.nativeGoalId=typeof answer.nativeGoalId==='string'?answer.nativeGoalId:null;
  if(answer.status==='accepted'){g.state='executing';await this.emit('accepted',g);return {accepted:true,nativeGoalId:g.nativeGoalId??command.commandId,unknown:false};}
  if(answer.status==='rejected')return refuse(String(answer.reason??'NAV2_GOAL_REJECTED'));
  // no reply / unknown: the goal may exist on the action server; hold it, never resend
  g.state='unknown';g.reason=String(answer.reason??'NO_ACK');g.reported=true;await this.emit('unknown',g,{reason:'BRIDGE_LOST'});
  return {accepted:false,unknown:true,reason:g.reason};
 }
 /** Ask the worker about every in-flight goal and report each terminal answer exactly once. Arrival is this observation, nothing else. */
 async poll(){
  for(const g of this.goals.values()){
   if(g.state!=='executing'||g.reported)continue;
   let q:Record<string,unknown>;
   try{q=await this.backend.query(this.manifest.id,g.commandId);}catch(e){q={status:'unknown',evidence:{reason:`NATIVE_UNREACHABLE:${(e as Error).message}`}};}
   const ev=(q.evidence??{}) as Record<string,unknown>,reason=typeof ev.reason==='string'?ev.reason:null,status=String(q.status);
   if(status==='executing')continue;
   g.reported=true;
   if(status==='completed'){g.state='completed';await this.emit('completed',g);}
   else if(status==='cancelled'){g.state='cancelled';if(g.cancelRequested)await this.emit('cancelled',g);else{g.state='failed';g.reason='NAV2_CANCELED';await this.emit('failed',g,{reason:'NAV2_CANCELED'});}}
   else if(status==='failed'){g.state='failed';g.reason=reason??'NAV2_ABORTED';await this.emit('failed',g,{reason:g.reason});}
   else{g.state='unknown';g.reason=reason??'NATIVE_UNKNOWN';await this.emit('unknown',g,{reason:g.reason});}
  }
 }
 async cancel(commandId:string){
  const g=this.goals.get(commandId);if(!g)return {acknowledged:false,unknown:true};
  if(g.state!=='executing')return {acknowledged:false,unknown:g.state==='unknown'};
  g.cancelRequested=true;
  try{const r=await this.backend.cancel(this.manifest.id,commandId);return {acknowledged:r.acknowledged===true,unknown:r.unknown===true};}catch{return {acknowledged:false,unknown:true};}
 }
 async requestStop(reason:string){
  if(!reason)throw new Error('STOP_REASON_REQUIRED');
  let acknowledged=false;
  try{acknowledged=(await this.backend.stop(this.manifest.id,reason)).acknowledged===true;}catch{acknowledged=false;}
  for(const g of this.goals.values())if(g.state==='executing'){g.state='unknown';g.reason='STOP_REQUESTED';g.reported=true;await this.emit('unknown',g,{reason:'STOP_REQUESTED'});}
  return {acknowledged,physicalStopConfirmed:false};
 }
 observe(l:(e:RobotEvent)=>void){this.listeners.add(l);return ()=>{this.listeners.delete(l);};}
 async reconcile(commandId:string):Promise<NativeExecutionState>{
  const cap=await this.backend.capability(),g=this.goals.get(commandId);
  const base={simulated:true,backend:GAZEBO_NAV2.id,model:GAZEBO_NAV2.model,evidence:cap.evidence,bootId:cap.bootId};
  let q:Record<string,unknown>;
  try{q=await this.backend.query(this.manifest.id,commandId);}catch(e){return {status:'unknown',evidence:{...base,reason:`NATIVE_UNREACHABLE:${(e as Error).message}`}};}
  const status=String(q.status) as GoalState;
  if(g&&!['completed','cancelled','failed','unknown','executing'].includes(status))return {status:g.state,evidence:base};
  const nativeGoalId=typeof q.nativeGoalId==='string'?q.nativeGoalId:g?.nativeGoalId??null;
  return {status:['sending','executing','completed','cancelled','failed','unknown'].includes(status)?status:'unknown',evidence:{...base,...((q.evidence??{}) as Record<string,JsonValue>),nativeGoalId}};
 }
}
