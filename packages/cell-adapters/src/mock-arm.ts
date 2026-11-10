// mock_kinematic arm: approved programs (cup-pick, cup-place) as joint waypoints, linear joint interpolation at an illustrative speed fraction of the F02
// limits, FK for every sample. No controller, no dynamics, no torque, no physical grip: gripper state is commanded, object presence comes from the cup model.
import {forwardKinematics,PUMA560_SI,MOCK_KINEMATIC,type ArmModelSI} from '../../lab-runtime/src/v2/models/arm-kinematics';
import {checkArmSweep,type ArmObstacle,type SweepResult} from '../../lab-runtime/src/v2/models/arm-collision';
import type {ArmSceneSnapshot} from '../../lab-runtime/src/v2/models/arm-scene';
import {hashJson} from '../../lab-runtime/src/v2/hash';
import type {JsonObject} from '../../contracts/src/index';
import type {CellAcceptance,CellAdapter,CellCommand,CellExecutionState,CellManifest,CellReport,TransferEvidence} from './contract';
export const MOCK_ARM={id:'mock_arm',version:'2',model:'mock_kinematic',dynamics:false} as const;
/** Illustrative: joints move at 10 % of their modeled max velocity; tick 20 ms; a missing receiver is waited for 10 s, then the program fails holding the cup. */
export const MOCK_ARM_PARAMS={speedFraction:0.1,dtS:0.02,receiverWaitTicks:500,traceEvery:5,traceCap:4000,provenance:'illustrative'} as const;
const W:Record<string,number[]>={home:[0,-0.6,1.2,0,0.6,0],pickApproach:[0.5,-0.4,1.0,0,0.8,0],pick:[0.5,-0.3,0.9,0,0.9,0],lift:[0.5,-0.5,1.0,0,0.8,0],placeApproach:[-0.5,-0.4,1.0,0,0.8,0],place:[-0.5,-0.3,0.9,0,0.9,0]};
/** Approved choreography (illustrative waypoints, radians). `grip` closes on arrival at a waypoint, `release` opens there if a receiver is docked. */
export const ARM_CHOREOGRAPHY:Record<string,{waypoint:string;action?:'grip'|'release'}[]>={
 'cup-pick':[{waypoint:'pickApproach'},{waypoint:'pick',action:'grip'},{waypoint:'lift'}],
 'cup-place':[{waypoint:'placeApproach'},{waypoint:'place',action:'release'},{waypoint:'home'}],
};
export interface ArmCupWorld {take(cupId?:string):string|null;put(cupId:string,receiver:{robotId:string;slot:number}):void}
export type ArmFault='arm-reboot'|'arm-drop'|'arm-following-error'|'arm-stop'|'arm-estop'|'arm-reset'|'arm-collision';
/** Tracking mode (R1.1): the arm is a plant that follows the commanded joints (Webots). Thresholds come from the oracle profile `webotsArm` and are test thresholds, not a capability. */
export interface ArmTracking {reachTolRad:number;settleTicks:number;followTolRad:number;followTicks:number}
/** What the tracking mode keeps beside the plant state (JSON, so it survives a checkpoint): the generator's own commanded position, the settle and following-error counters, and per-joint stats of actual - commanded while a program runs. */
export interface ArmTrackingState {gen:number[];settled:number;followCount:number;samples:number;peakRad:number[];sumSq:number[];trace:{tick:number;actualRad:number[];commandedRad:number[]}[]}
export interface ArmStopState {latched:boolean;reconcileRequired:boolean;reason:string;events:{tick:number;stage:'requested'|'acknowledged'|'observed'|'reset';reason:string;provenance:'modelled'}[]}
export const ARM_COLLISION_TRACE_LIMIT=4096;
export interface ArmCollisionInterval {firstTick:number;lastTick:number;fromQ:number[];toQ:number[];heldCupId:string|null;worldRevision:string;sceneRevision:string|null;result:SweepResult}
export interface ArmCollisionEvidence {intervals:ArmCollisionInterval[];worlds:Record<string,ArmObstacle[]>;droppedIntervals:number;
 /** A collision latches the arm, so this is the immutable triggering failure even if later scene snapshots change. */
 firstFailure?:{tick:number;fromQ:number[];toQ:number[];heldCupId:string|null;worldRevision:string;world:ArmObstacle[];scene:ArmSceneSnapshot|null;result:SweepResult}}
interface Program {commandId:string;payloadHash:string;controlEpoch:number;program:string;index:number;state:'running'|'completed'|'failed'|'unknown';waiting:number;evidence:TransferEvidence;accepted:CellAcceptance}
export interface ArmPlantState {deviceId:string;q:number[];gripper:'open'|'closed';holding:string|null;bootId:string;seq:number;tick:number;programs:Program[];modifiers:ArmFault[];
 trace:{tick:number;q:number[];tcp:[number,number,number]}[];limitsOk:boolean;commandedQ?:number[];stop?:ArmStopState;tracking?:ArmTrackingState;
 collision?:{/** Manually injected obstacles in arm-base coordinates; scene refresh does not replace these. */world:ArmObstacle[];checks:number;last:SweepResult|null;scene?:ArmSceneSnapshot;evidence?:ArmCollisionEvidence}}
export class MockArmPlant {
 private listeners=new Set<(r:CellReport)=>void>();
 constructor(readonly state:ArmPlantState,private nowMs:()=>number,private newBootId:()=>string,private cups:ArmCupWorld,private receiver:()=>{robotId:string;slot:number}|null,private model:ArmModelSI=PUMA560_SI,private tracking?:ArmTracking){state.collision??={world:[],checks:0,last:null};state.collision.evidence??={intervals:[],worlds:{},droppedIntervals:state.collision.checks};
  if(tracking)state.tracking??={gen:[...state.q],settled:0,followCount:0,samples:0,peakRad:state.q.map(()=>0),sumSq:state.q.map(()=>0),trace:[]};}
 static initial(deviceId:string,bootId='boot-0:arm'):ArmPlantState {return {deviceId,q:[...W.home!],gripper:'open',holding:null,bootId,seq:0,tick:0,programs:[],modifiers:[],trace:[],limitsOk:true};}
 on(l:(r:CellReport)=>void){this.listeners.add(l);return ()=>{this.listeners.delete(l);};}
 private emit(p:Program,result:'accepted'|'completed'|'failed'|'outcome_unknown',reasonCodes:string[]=[],evidence?:TransferEvidence){
  const s=this.state;s.seq++;const at=new Date(this.nowMs()).toISOString();
  const r:CellReport={deviceId:s.deviceId,bootId:s.bootId,seq:String(s.seq),observedAt:at,observation:{schemaVersion:2,commandId:p.commandId,deviceId:s.deviceId,controlEpoch:p.controlEpoch,payloadHash:p.payloadHash,bootId:s.bootId,seq:String(s.seq),result,observedAt:at,reasonCodes},...evidence?{evidence}:{}};
  for(const l of this.listeners)l(r);
 }
 tcp(q:readonly number[]){const p=forwardKinematics(this.model,q).tcp.position;return [p[0],p[1],p[2]] as [number,number,number];}
 execute(command:CellCommand):CellAcceptance {
  const old=this.state.programs.find(p=>p.commandId===command.commandId);if(old)return old.accepted;
  if(this.state.stop?.latched)return {accepted:false,unknown:false,reason:'ARM_STOP_LATCHED'};
  if(this.state.stop?.reconcileRequired||this.state.programs.some(p=>p.state==='unknown'))return {accepted:false,unknown:false,reason:'ARM_RECONCILE_REQUIRED'};
  const program=command.programRef?.id;
  if(command.capability!=='start_job'||!program||!ARM_CHOREOGRAPHY[program])return {accepted:false,unknown:false,reason:'PROGRAM_NOT_APPROVED'};
  if(this.state.programs.some(p=>p.state==='running'))return {accepted:false,unknown:false,reason:'ARM_BUSY'};
  const p:Program={commandId:command.commandId,payloadHash:command.payloadHash,controlEpoch:command.controlEpoch,program,index:0,state:'running',waiting:0,evidence:{source:MOCK_ARM.id,grip:'commanded_mock',forceModel:'none'},accepted:{accepted:true,unknown:false}};
  this.state.programs.push(p);this.emit(p,'accepted');return p.accepted;
 }
 reconcile(commandId:string):CellExecutionState {const p=this.state.programs.find(x=>x.commandId===commandId);return p?{status:p.state,evidence:{...p.evidence} as JsonObject}:{status:'not_found',evidence:{}};}
 setCollisionWorld(world:ArmObstacle[]){checkArmSweep(this.model,this.state.q,this.state.q,{world});this.state.collision!.world=structuredClone(world);}
 setCollisionScene(scene:ArmSceneSnapshot){this.state.collision!.scene=scene;}
 private recordCollision(toQ:number[],world:ArmObstacle[],result:SweepResult){
  const s=this.state,c=s.collision!,e=c.evidence!,worldRevision=hashJson(world),heldCupId=s.holding,sceneRevision=c.scene?.revision??null;
  const last=e.intervals.at(-1),same=(a:number[],b:number[])=>a.every((n,i)=>n===b[i]);
  // Identical stationary checks retain a closed tick interval; motion, attachment or scene geometry changes get a new record.
  if(last&&last.lastTick===s.tick-1&&last.worldRevision===worldRevision&&last.sceneRevision===sceneRevision&&last.heldCupId===heldCupId&&same(last.fromQ,s.q)&&same(last.toQ,toQ))last.lastTick=s.tick;
  else if(e.intervals.length<ARM_COLLISION_TRACE_LIMIT){
   e.worlds[worldRevision]??=structuredClone(world);
   e.intervals.push({firstTick:s.tick,lastTick:s.tick,fromQ:[...s.q],toQ:[...toQ],heldCupId,worldRevision,sceneRevision,result:structuredClone(result)});
  }else e.droppedIntervals++;
  if(!result.ok&&!e.firstFailure){
   e.worlds[worldRevision]??=structuredClone(world);
   e.firstFailure={tick:s.tick,fromQ:[...s.q],toQ:[...toQ],heldCupId,worldRevision,world:structuredClone(world),scene:structuredClone(c.scene??null),result:structuredClone(result)};
  }
 }
 /** The plant behind a tracked arm is gone (worker lost): latch the arm and leave every running program unknown. Nothing is resent, nothing is released. */
 halt(reason:string){this.stop(reason);}
 private stop(reason:string){
  const s=this.state,events=s.stop?.events??[];
  for(const stage of ['requested','acknowledged','observed'] as const)events.push({tick:s.tick,stage,reason,provenance:'modelled'});
  s.stop={latched:true,reconcileRequired:true,reason,events};
  for(const p of s.programs.filter(x=>x.state==='running')){p.state='unknown';Object.assign(p.evidence,{stopReason:reason,stopProvenance:'modelled',actualJointsRad:[...s.q],commandedJointsRad:s.commandedQ??[...s.q]});this.emit(p,'outcome_unknown',[reason],{...p.evidence});}
 }
 fault(f:ArmFault){
  if(f==='arm-following-error'){this.state.commandedQ=this.state.q.map((v,i)=>v+(i===0?0.1:0));this.stop('ARM_FOLLOWING_ERROR');}
  else if(f==='arm-stop'||f==='arm-estop')this.stop(f==='arm-estop'?'MODEL_ESTOP':'MODEL_STOP');
  else if(f==='arm-reset'){if(this.state.stop){this.state.stop.latched=false;this.state.stop.events.push({tick:this.state.tick,stage:'reset',reason:'EXPLICIT_MOCK_RESET',provenance:'modelled'});}}
  else if(f==='arm-collision')this.setCollisionWorld([...this.state.collision!.world,{id:`injected-fixture-${this.state.tick}`,kind:'sphere',center:this.tcp(this.state.q),radiusM:0.02}]);
  else if(f==='arm-reboot'){this.state.bootId=this.newBootId();this.state.seq=0;for(const p of this.state.programs.filter(x=>x.state==='running')){p.state='unknown';this.emit(p,'outcome_unknown',['OBSERVER_REBOOT']);}}
  else this.state.modifiers.push(f);
 }
 advance(){
  const s=this.state;s.tick++;
  // Readiness must remain observable while idle and while a coffee is brewing; transfer admission checks its age.
  if(s.tick===1||s.tick%250===0){
   s.seq++;const unknown=s.programs.some(p=>p.state==='unknown')||s.stop?.latched||s.stop?.reconcileRequired;
   const report:CellReport={deviceId:s.deviceId,bootId:s.bootId,seq:String(s.seq),observedAt:new Date(this.nowMs()).toISOString(),status:{status:unknown?'fault':'ready',reasonCodes:unknown?['OUTCOME_UNKNOWN']:[]}};
   for(const listener of this.listeners)listener(report);
  }
  if(this.tracking)s.commandedQ??=[...s.tracking!.gen]; // an idle tracked arm is still told where to stay
  const p=s.programs.find(x=>x.state==='running');if(s.stop?.latched||s.stop?.reconcileRequired)return;
  const scene=s.collision!.scene;
  if(scene?.scope==='self_scene_robot'&&!scene.available){if(p)this.stop('ARM_SCENE_GEOMETRY_UNAVAILABLE');return;}
  if(!p&&!scene?.available)return;
  const t=this.tracking?s.tracking!:undefined,steps=p?ARM_CHOREOGRAPHY[p.program]!:[],stage=p?steps[p.index]!:undefined,goal=stage?W[stage.waypoint]!:t?t.gen:s.q;
  const maxStep=this.model.limits.map(l=>l.maxVelocity*MOCK_ARM_PARAMS.speedFraction*MOCK_ARM_PARAMS.dtS);
  const from=t?t.gen:s.q,next=from.map((q,i)=>{const d=goal[i]!-q;return Math.abs(d)<=maxStep[i]!?goal[i]!:q+Math.sign(d)*maxStep[i]!;});
  s.commandedQ=next;
  if(t){t.gen=[...next];return;} // tracking: only the commanded joints are generated here; observe() applies what the plant did
  const world=[...s.collision!.world,...scene?.world??[]],collision=checkArmSweep(this.model,s.q,next,{world,heldCup:s.holding!==null});
  this.recordCollision(next,world,collision);
  s.collision!.checks++;s.collision!.last=collision;
  if(!collision.ok){this.stop(collision.reason==='COLLISION'?'ARM_COLLISION':'ARM_SWEEP_UNCERTAIN');return;}
  if(!p||!stage)return; // stationary arm/cup still participates when an AMR moves nearby
  s.q=next;
  if(!s.q.every((q,i)=>q>=this.model.limits[i]!.min&&q<=this.model.limits[i]!.max))s.limitsOk=false;
  if(s.tick%MOCK_ARM_PARAMS.traceEvery===0&&s.trace.length<MOCK_ARM_PARAMS.traceCap)s.trace.push({tick:s.tick,q:[...s.q],tcp:this.tcp(s.q)});
  if(!s.q.every((q,i)=>q===goal[i]))return;
  this.complete(p,stage,steps);
 }
 /** The waypoint is reached: grip, release, the lift check and the next stage. One body for both modes, so the evidence is the same. */
 private complete(p:Program,stage:{waypoint:string;action?:'grip'|'release'},steps:{waypoint:string;action?:'grip'|'release'}[]){
  const s=this.state;
  if(stage.action==='grip'&&s.gripper==='open'){
   s.gripper='closed';const cup=s.modifiers.includes('arm-drop')?null:this.cups.take();s.holding=cup;
   Object.assign(p.evidence,{gripperClosed:true,objectPresent:cup!==null,cupId:cup});
  }
  if(stage.action==='release'&&s.gripper==='closed'){
   const rx=this.receiver();
   if(!rx){if(++p.waiting>=MOCK_ARM_PARAMS.receiverWaitTicks){p.state='failed';this.emit(p,'failed',['RECEIVER_NOT_READY'],{...p.evidence});}return;}
   s.gripper='open';if(s.holding)this.cups.put(s.holding,rx);
   // giver side only: the arm opened at the place pose. Receiver presence and dock come from the receiving robot's own observer.
   Object.assign(p.evidence,{released:true,receiverId:rx.robotId,slot:rx.slot,cupId:s.holding});s.holding=null;
  }
  if(stage.waypoint==='lift')p.evidence.liftPoseReached=this.tcp(W.lift!)[2]>this.tcp(W.pick!)[2]&&s.holding!==null;
  if(++p.index>=steps.length){p.state='completed';this.emit(p,'completed',[],{...p.evidence});}
 }
 /** Tracking mode, once per tick after the plant stepped: what the plant did becomes the arm state. Order: non-finite, then ARM03 geometry on the actual joints (D28), the plant's own collisions,
  * limits, the following error, and finally whether the waypoint is reached. Any stop leaves the cup where it is. */
 observe(actualQ:readonly number[],collisionIds:readonly string[]){
  const s=this.state,t=s.tracking;
  if(!this.tracking||!t)throw new Error('ARM_TRACKING_DISABLED: observe needs the tracking mode');
  if(s.stop?.latched||s.stop?.reconcileRequired)return;
  if(actualQ.length!==s.q.length||!actualQ.every(Number.isFinite)){this.stop('PLANT_UNSTABLE');return;}
  const p=s.programs.find(x=>x.state==='running'),scene=s.collision!.scene;
  if(p||scene?.available){
   const world=[...s.collision!.world,...scene?.world??[]],result=checkArmSweep(this.model,s.q,actualQ,{world,heldCup:s.holding!==null});
   this.recordCollision([...actualQ],world,result);
   s.collision!.checks++;s.collision!.last=result;
   if(!result.ok){this.stop(result.reason==='COLLISION'?'ARM_COLLISION':'ARM_SWEEP_UNCERTAIN');return;}
  }
  if(collisionIds.length>0){this.stop('ARM_COLLISION');return;}
  s.q=[...actualQ];
  if(!s.q.every((q,i)=>q>=this.model.limits[i]!.min&&q<=this.model.limits[i]!.max))s.limitsOk=false;
  const commanded=s.commandedQ??t.gen,error=s.q.map((q,i)=>Math.abs(q-commanded[i]!));
  if(p){
   t.samples++;error.forEach((e,i)=>{t.peakRad[i]=Math.max(t.peakRad[i]!,e);t.sumSq[i]=t.sumSq[i]!+e*e;});
   if(t.trace.length<MOCK_ARM_PARAMS.traceCap)t.trace.push({tick:s.tick,actualRad:[...s.q],commandedRad:[...commanded]});
   if(s.tick%MOCK_ARM_PARAMS.traceEvery===0&&s.trace.length<MOCK_ARM_PARAMS.traceCap)s.trace.push({tick:s.tick,q:[...s.q],tcp:this.tcp(s.q)});
  }
  if(Math.max(...error)>this.tracking.followTolRad){if(++t.followCount>=this.tracking.followTicks){this.stop('ARM_FOLLOWING_ERROR');return;}}else t.followCount=0;
  if(!p)return;
  const steps=ARM_CHOREOGRAPHY[p.program]!,stage=steps[p.index]!,goal=W[stage.waypoint]!;
  if(t.gen.every((v,i)=>v===goal[i])&&s.q.every((q,i)=>Math.abs(q-goal[i]!)<=this.tracking!.reachTolRad))t.settled++;else t.settled=0;
  if(t.settled>=this.tracking.settleTicks){const index=p.index;this.complete(p,stage,steps);if(p.index!==index)t.settled=0;}
 }
}
export class MockArmAdapter implements CellAdapter {
 constructor(private plant:MockArmPlant,private runId:string,private cellId:string){}
 async describe():Promise<CellManifest>{return {cellId:this.cellId,deviceIds:[this.plant.state.deviceId],adapter:MOCK_ARM.id,version:MOCK_ARM.version,model:MOCK_KINEMATIC,validation:'simulated',capabilities:['start_job','query_outcome']};}
 async execute(command:CellCommand){if(command.runId!==this.runId)return {accepted:false,unknown:false,reason:'RUN_MISMATCH'};return this.plant.execute(command);}
 async cancel(){return {acknowledged:false,unknown:true};} // a held cup is never released by a cancel; recovery goes through reconciliation
 observe(l:(r:CellReport)=>void){return this.plant.on(l);}
 async reconcile(commandId:string){return this.plant.reconcile(commandId);}
}
