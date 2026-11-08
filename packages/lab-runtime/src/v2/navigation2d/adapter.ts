// RobotAdapter over one robot of the IR-SIM plant. The plant only moves when the source runner steps it; this adapter admits goals for the controller and turns
// controller decisions and observed snapshots into robot events. Arrival ends a movement leg only: load, handoff and served stay with the source domain.
import {randomUUID} from 'node:crypto';
import type {RobotCommand} from '../../../../contracts/src/index';
import {hashPayload} from '../../../../contracts/src/canonical';
import type {NativeAcceptance,NativeExecutionState,RobotAdapter,RobotEvent,RobotManifest,ResolvedTarget,TargetBinding} from '../../../../robot-adapters/src/contract';
import type {Decision,NavigationController} from './controller';
import type {IRSimSnapshotV1,NavigationSceneV1} from './contracts';

export const IRSIM_AMR={id:'irsim_2d',version:'2.12.0',model:'irsim_2d_diff_drive',dynamics:false} as const;
type GoalState='executing'|'cancelling'|'completed'|'cancelled'|'failed'|'unknown';
interface Goal {commandId:string;hash:string;command:RobotCommand;state:GoalState;receipt:NativeAcceptance}
/** Serializable adapter state, kept in the run checkpoint: goals with their first receipts, the event boot/sequence and the fencing high-water marks. */
export interface IRSimAdapterState {bootId:string;seq:number;goals:Goal[];controlEpoch:number;missionRevisions:Record<string,number>;lastTick:number;plantLost:boolean}
export const initialAdapterState=():IRSimAdapterState=>({bootId:randomUUID(),seq:0,goals:[],controlEpoch:1,missionRevisions:{},lastTick:-1,plantLost:false});
/** Internal, typed observation path from the runner (never an HTTP endpoint). */
export interface IRSimObservationSink {
 /** Controller decisions computed from snapshot t, for this robot. */
 decide(decision:Decision):void;
 /** A verified snapshot (ticks strictly increase; an older or repeated one is ignored). */
 observe(snapshot:IRSimSnapshotV1):void;
 /** The plant can no longer be verified: every live goal becomes unknown; nothing is resent. */
 lost(reason:string):void;
 /** After a source restart: a command the journal still shows travelling is reported unknown under a new boot. */
 reportUnknown(command:RobotCommand,reason:string):void;
}
export type IRSimNavigationAdapter=RobotAdapter&{readonly sink:IRSimObservationSink;readonly state:IRSimAdapterState;goal():Goal|undefined};
const FINAL:GoalState[]=['completed','cancelled','failed','unknown'];

export function createIRSimNavigationAdapter(o:{robotId:string;scene:NavigationSceneV1;controller:NavigationController;now:()=>number;state?:IRSimAdapterState;mapId?:string;mapRevision?:string;trays?:number}):IRSimNavigationAdapter{
 const robot=o.scene.robots.find(r=>r.robotId===o.robotId);
 if(!robot)throw new Error('IRSIM_ROBOT_UNKNOWN');
 const st=o.state??initialAdapterState(),pol=o.scene.policy.parameters,listeners=new Set<(e:RobotEvent)=>void>();
 const manifest:RobotManifest={id:o.robotId,adapter:'simulator',protocolVersion:'1',firmware:`${IRSIM_AMR.id}@${IRSIM_AMR.version}`,capabilities:['delivery'],mapId:o.mapId??o.scene.world.id,mapRevision:o.mapRevision??o.scene.sceneDigest,offlineExecution:true,maxLoadMinor:'10000',trays:o.trays??1,validation:'simulated'};
 const emit=(g:Goal,type:RobotEvent['type'],extra:Record<string,string>={})=>{
  st.seq++;const c=g.command;
  const e:RobotEvent={type,id:`${st.bootId}-${st.seq}`,commandId:g.commandId,bootId:st.bootId,sequence:String(st.seq),observedAt:new Date(o.now()).toISOString(),payload:{robotId:c.robotId,missionId:c.missionId,missionRevision:c.missionRevision,controlEpoch:c.controlEpoch,simulated:true,model:IRSIM_AMR.model,...extra}};
  for(const l of listeners)l(e);
 };
 const live=()=>st.goals.find(g=>g.state==='executing'||g.state==='cancelling');
 const refuse=(command:RobotCommand,hash:string,reason:string):NativeAcceptance=>{const receipt={accepted:false,unknown:false,reason};st.goals.push({commandId:command.commandId,hash,command:structuredClone(command),state:'failed',receipt});return receipt;};
 const sink:IRSimObservationSink={
  decide(d){
   const g=st.goals.find(x=>x.commandId===d.commandId);
   // only the live goal of this command moves on; a late, repeated or reordered decision never revives a terminal one
   if(!g||g.state!=='executing'||d.robotId!==o.robotId)return;
   if(d.status==='arrived'){g.state='completed';emit(g,'completed');}
   else if(d.status==='blocked'||d.status==='no_path'){g.state='failed';emit(g,'failed',{reason:d.reason??d.status.toUpperCase()});}
  },
  observe(s){
   if(s.tick<=st.lastTick)return;
   st.lastTick=s.tick;
   const r=s.robots.find(x=>x.robotId===o.robotId),g=live();
   if(!r||!g)return;
   if(r.collisionIds.length&&g.state==='executing'){o.controller.cancel(o.robotId,g.commandId);g.state='failed';emit(g,'failed',{reason:'CONTACT'});return;}
   // a cancel is complete only when an observation shows the robot stopped; the request alone proves nothing
   if(g.state==='cancelling'&&Math.abs(r.bodyVelocity[0]!)<=pol.stoppedLinearMps&&Math.abs(r.bodyVelocity[1]!)<=pol.stoppedAngularRadps){g.state='cancelled';emit(g,'cancelled');}
  },
  lost(reason){
   st.plantLost=true;
   for(const g of st.goals)if(g.state==='executing'||g.state==='cancelling'){g.state='unknown';emit(g,'unknown',{reason});}
  },
  reportUnknown(command,reason){
   st.plantLost=true;st.bootId=randomUUID();st.seq=0;
   let g=st.goals.find(x=>x.commandId===command.commandId);
   if(!g){g={commandId:command.commandId,hash:hashPayload(command as never),command:structuredClone(command),state:'unknown',receipt:{accepted:true,nativeGoalId:command.commandId,unknown:true}};st.goals.push(g);}
   else if(FINAL.includes(g.state)&&g.state!=='unknown')return;
   g.state='unknown';emit(g,'unknown',{reason});
  },
 };
 return {
  sink,state:st,goal:()=>live()??st.goals.at(-1),
  async describe(){return structuredClone(manifest);},
  async resolveTarget(t:TargetBinding):Promise<ResolvedTarget>{
   if(t.mapId!==manifest.mapId||t.mapRevision!==manifest.mapRevision)throw new Error('MAP_MISMATCH');
   if(![t.x,t.y,t.yaw??0].every(Number.isFinite))throw new Error('INVALID_TARGET');
   return {kind:'ros',mapId:t.mapId,mapRevision:t.mapRevision,frame:t.frame,x:t.x!,y:t.y!,yaw:t.yaw??0};
  },
  async estimateReachability(t){
   if(t.kind!=='ros'||t.mapId!==manifest.mapId||t.mapRevision!==manifest.mapRevision)return {reachable:false,reason:'MAP_MISMATCH'};
   return st.plantLost?{reachable:false,reason:'PLANT_LOST'}:{reachable:true,reason:'OK'};
  },
  async execute(command){
   const t=command.target as {mapId?:string;mapRevision?:string;x?:number;y?:number;yaw?:number};
   // a non-finite target cannot even be hashed into a receipt: refused before anything is recorded
   if(![t.x,t.y,t.yaw].every(Number.isFinite))return {accepted:false,unknown:false,reason:'INVALID_TARGET'};
   const hash=hashPayload(command as never),old=st.goals.find(g=>g.commandId===command.commandId);
   // exact duplicate: the first receipt; the same id with another payload is a conflict, never a second goal
   if(old){if(old.hash!==hash)throw new Error('IDEMPOTENCY_CONFLICT');return structuredClone(old.receipt);}
   if(command.robotId!==o.robotId)return refuse(command,hash,'ROBOT_MISMATCH');
   if(!Number.isSafeInteger(command.controlEpoch)||command.controlEpoch<st.controlEpoch)return refuse(command,hash,'STALE_CONTROL_EPOCH');
   if(command.missionRevision<(st.missionRevisions[command.missionId]??0))return refuse(command,hash,'STALE_MISSION_REVISION');
   if(t.mapId!==manifest.mapId||t.mapRevision!==manifest.mapRevision)return refuse(command,hash,'MAP_MISMATCH');
   if(!(Date.parse(command.expiresAt)>o.now()))return refuse(command,hash,'EXPIRED_COMMAND');
   if(st.plantLost)return refuse(command,hash,'PLANT_LOST');
   if(live())return refuse(command,hash,'GOAL_ACTIVE');
   st.controlEpoch=command.controlEpoch;st.missionRevisions[command.missionId]=command.missionRevision;
   o.controller.setGoal({robotId:o.robotId,commandId:command.commandId,target:[t.x!,t.y!,t.yaw!]});
   const g:Goal={commandId:command.commandId,hash,command:structuredClone(command),state:'executing',receipt:{accepted:true,nativeGoalId:command.commandId,unknown:false}};
   st.goals.push(g);emit(g,'accepted');
   return structuredClone(g.receipt);
  },
  async cancel(commandId){
   const g=st.goals.find(x=>x.commandId===commandId);
   if(!g||g.state==='unknown')return {acknowledged:false,unknown:true};
   if(g.state==='cancelling')return {acknowledged:true,unknown:false};
   if(g.state!=='executing')return {acknowledged:false,unknown:false};
   if(st.plantLost){g.state='unknown';emit(g,'unknown',{reason:'PLANT_LOST'});return {acknowledged:false,unknown:true};}
   // the control goal is dropped now (zero future velocity, ramped by the controller); `cancelled` waits for a stopped observation
   o.controller.cancel(o.robotId,commandId);g.state='cancelling';
   return {acknowledged:true,unknown:false};
  },
  async requestStop(reason){
   if(!reason)throw new Error('STOP_REASON_REQUIRED');
   for(const g of st.goals)if(g.state==='executing'||g.state==='cancelling'){o.controller.cancel(o.robotId,g.commandId);g.state='unknown';emit(g,'unknown',{reason:'STOP_REQUESTED'});}
   return {acknowledged:true,physicalStopConfirmed:false};
  },
  observe(l){listeners.add(l);return ()=>{listeners.delete(l);};},
  async reconcile(commandId):Promise<NativeExecutionState>{
   const g=st.goals.find(x=>x.commandId===commandId),status=!g||st.plantLost&&!FINAL.includes(g.state)?'unknown':g.state==='cancelling'?'executing':g.state;
   return {status,evidence:{simulated:true,model:IRSIM_AMR.model,bootId:st.bootId,plantLost:st.plantLost}};
  },
 };
}
