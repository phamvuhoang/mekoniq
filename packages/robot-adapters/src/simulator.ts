import type { RobotCommand } from '../../contracts/src/index';
import type { NativeExecutionState, RobotAdapter, RobotEvent, RobotManifest, TargetBinding, ResolvedTarget } from './contract';
import { hashPayload } from '../../contracts/src/canonical';
export class SimulatorAdapter implements RobotAdapter {
 private listeners=new Set<(event:RobotEvent)=>void>();
 private goals=new Map<string,{hash:string;state:NativeExecutionState;command:RobotCommand;dueMs:number}>();
 private sequence=0n;
 private epoch=1;
 private offline=false;
 private blocked=false;
 private nowMs:number;
 constructor(private manifest:RobotManifest,nowMs=Date.parse('2026-10-30T00:00:00Z'),private travelMs=1000) {
  if(manifest.validation!=='simulated'||manifest.adapter!=='simulator') throw new Error('SIMULATION_PROFILE_REQUIRED');
  this.nowMs=nowMs;
 }
 async describe():Promise<RobotManifest> {return structuredClone(this.manifest);}
 async resolveTarget(target:TargetBinding):Promise<ResolvedTarget> {
  if(target.mapId!==this.manifest.mapId||target.mapRevision!==this.manifest.mapRevision) throw new Error('MAP_MISMATCH');
  if(target.x===undefined||target.y===undefined||!Number.isFinite(target.x)||!Number.isFinite(target.y)) throw new Error('INVALID_TARGET');
  return {kind:'ros',mapId:target.mapId,mapRevision:target.mapRevision,frame:target.frame,x:target.x,y:target.y,yaw:target.yaw ?? 0};
 }
 async estimateReachability(target:ResolvedTarget) {
  const reachable=!this.offline&&target.mapId===this.manifest.mapId&&target.mapRevision===this.manifest.mapRevision;
  return {reachable,reason:reachable?'OK':'UNREACHABLE',etaMs:this.travelMs};
 }
 private emit(type:RobotEvent['type'],commandId:string):void {
  const goal=this.goals.get(commandId); if(!goal) return;
  this.sequence++;
  const event:RobotEvent={type,id:`sim-event-${this.epoch}-${this.sequence}`,commandId,bootId:`sim-boot-${this.epoch}`,sequence:String(this.sequence),observedAt:new Date(this.nowMs).toISOString(),payload:{robotId:goal.command.robotId,missionId:goal.command.missionId,missionRevision:goal.command.missionRevision,controlEpoch:goal.command.controlEpoch,simulated:true}};
  for(const listener of this.listeners) listener(event);
 }
 async execute(command:RobotCommand) {
  const hash=hashPayload(command as never),old=this.goals.get(command.commandId);
  if(old) {
   if(old.hash!==hash) throw new Error('IDEMPOTENCY_CONFLICT');
   return {accepted:old.state.status!=='failed',nativeGoalId:command.commandId,unknown:old.state.status==='unknown'};
  }
  if(this.offline) return {accepted:false,unknown:true,reason:'OFFLINE'};
  if(Date.parse(command.expiresAt)<=this.nowMs) return {accepted:false,unknown:false,reason:'EXPIRED_COMMAND'};
  const target=command.target;
  if(target.mapId!==this.manifest.mapId||target.mapRevision!==this.manifest.mapRevision) return {accepted:false,unknown:false,reason:'MAP_MISMATCH'};
  if(command.robotId!==this.manifest.id) return {accepted:false,unknown:false,reason:'ROBOT_MISMATCH'};
  this.goals.set(command.commandId,{hash,state:{status:'executing',evidence:{simulated:true}},command:structuredClone(command),dueMs:this.nowMs+this.travelMs});
  this.emit('accepted',command.commandId);
  return {accepted:true,nativeGoalId:command.commandId,unknown:false};
 }
 advance(milliseconds:number):void {
  if(!Number.isFinite(milliseconds)||milliseconds<0) throw new Error('INVALID_ADVANCE');
  this.nowMs+=milliseconds;
  if(this.offline||this.blocked) return;
  for(const [id,goal] of this.goals) if(goal.state.status==='executing'&&goal.dueMs<=this.nowMs) {
   goal.state={status:'completed',evidence:{simulated:true,nativeGoalId:id}}; this.emit('completed',id);
  }
 }
 fault(name:'offline'|'online'|'blocked'|'clear'|'reboot'|'duplicate-completed'):void {
  if(name==='offline') this.offline=true;
  else if(name==='online') this.offline=false;
  else if(name==='blocked') this.blocked=true;
  else if(name==='clear') this.blocked=false;
  else if(name==='reboot') {this.epoch++; for(const goal of this.goals.values()) if(goal.state.status==='executing') goal.state={status:'unknown',evidence:{simulated:true,rebooted:true}};}
  else for(const [id,goal] of this.goals) if(goal.state.status==='completed') this.emit('completed',id);
 }
 async cancel(commandId:string) {
  const goal=this.goals.get(commandId);
  if(this.offline||!goal) return {acknowledged:false,unknown:true};
  if(goal.state.status==='completed') return {acknowledged:false,unknown:false};
  goal.state={status:'cancelled',evidence:{simulated:true}};this.emit('cancelled',commandId);
  return {acknowledged:true,unknown:false};
 }
 async requestStop(reason:string) {
  if(!reason) throw new Error('STOP_REASON_REQUIRED');
  for(const [id,goal] of this.goals) if(goal.state.status==='executing') {goal.state={status:'unknown',evidence:{simulated:true,stopRequested:true}};this.emit('unknown',id);}
  return {acknowledged:!this.offline,physicalStopConfirmed:false};
 }
 observe(listener:(event:RobotEvent)=>void):()=>void {this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
 async reconcile(commandId:string):Promise<NativeExecutionState> {
  return structuredClone(this.goals.get(commandId)?.state ?? {status:'unknown',evidence:{simulated:true}});
 }
}
