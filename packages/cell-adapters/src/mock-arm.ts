// mock_kinematic arm: approved programs (cup-pick, cup-place) as joint waypoints, linear joint interpolation at an illustrative speed fraction of the F02
// limits, FK for every sample. No controller, no dynamics, no torque, no physical grip: gripper state is commanded, object presence comes from the cup model.
import {forwardKinematics,PUMA560_SI,MOCK_KINEMATIC,type ArmModelSI} from '../../lab-runtime/src/v2/models/arm-kinematics';
import {checkArmSweep,type ArmGeometry,type ArmObstacle,type SweepResult} from '../../lab-runtime/src/v2/models/arm-collision';
import {quinticSegment} from './arm-motion';
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
/** The programs a plant runs: waypoints (rad, chain order), choreography and motion profile. PUMA_PROGRAMS is the built-in illustrative set. */
export interface ArmProgramSet {modelId:string;waypoints:Record<string,number[]>;choreography:Record<string,{waypoint:string;action?:'grip'|'release'}[]>;
 motion:{profile:'linear-clamp'}|{profile:'quintic-sync-v1';maxAccelerationRadS2:number[];speedFraction:number};
 /** Present = grip by contact (tracking only): the plant's pads say what is held, the plant's supports say where a cup rests. Absent = grip is an event (mock, webots_arm). */
 contact?:{openM:number;closedM:number;gripSettleTicks:number;dropTicks:number;liftMinM:number;releaseTimeoutTicks:number};
 /** Present = checkArmSweep gets this geometry and these allowed pairs; absent = DEFAULT_ARM_GEOMETRY and no pair (as before). */
 collision?:{geometry:ArmGeometry;allowedPairs:readonly (readonly [string,string])[]}}
export const PUMA_PROGRAMS:ArmProgramSet={modelId:PUMA560_SI.id,waypoints:W,choreography:ARM_CHOREOGRAPHY,motion:{profile:'linear-clamp'}};
/** What a contact plant reports each tick beside the joints: the measured gripper opening (m, between the pads), the cups both pads touch, and each cup's position (m, arm base frame) and support. */
export interface PlantExtras {gripper?:{openingM:number;heldPropIds:readonly string[]};props?:readonly {propId:string;position:readonly number[];restingOn:string|null}[]}
/** Contact grip counters (JSON). `ticks`: closing = ticks the opening changed < 1e-4 m, opening = ticks the cup rested on the tray; `lost`: ticks the held cup was not between the pads.
 * `maxSlipM` is null until a baseline was measured. `openingM` the last measured opening, `slipFromM` the cup–TCP distance on the first tick, at or after the take, the held cup's position was seen, `elapsed` ticks since the release command, `receiver` the receiver the release started for. */
export interface ArmGripState {phase:'closing'|'opening';ticks:number;lost:number;liftFromM:number|null;maxSlipM:number|null;openingM:number|null;slipFromM:number|null;elapsed:number;receiver?:{robotId:string;slot:number}}
/** Refuses a program set the machine cannot run (ARM_PROGRAM_INVALID: what), before any state is touched. The joint-limit check applies to every set: PUMA_PROGRAMS lies inside the limits of every model the tests use. */
function validatePrograms(set:ArmProgramSet,model:ArmModelSI){
 const bad=(what:string)=>{throw new Error(`ARM_PROGRAM_INVALID: ${what}`);},pos=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>0,tick=(v:unknown)=>Number.isInteger(v)&&(v as number)>=1,n=model.links.length;
 for(const [name,q] of Object.entries(set.waypoints??{})){
  if(!Array.isArray(q)||q.length!==n||!q.every(Number.isFinite))bad(`waypoint ${name} needs ${n} finite values`);
  q.forEach((v,i)=>{if(v<model.limits[i]!.min||v>model.limits[i]!.max)bad(`waypoint ${name} joint ${i+1} outside the model limits`);});
 }
 const steps=Object.entries(set.choreography??{});
 for(const name of ['home',...steps.some(([,s])=>s.some(x=>x.waypoint==='lift'))?['pick']:[]])if(!set.waypoints?.[name])bad(`waypoint ${name} missing`);
 for(const [program,list] of steps){if(!Array.isArray(list)||list.length===0)bad(`program ${program} has no step`);
  for(const x of list){if(!set.waypoints[x.waypoint])bad(`program ${program} names missing waypoint ${x.waypoint}`);if(x.action!==undefined&&x.action!=='grip'&&x.action!=='release')bad(`program ${program} action ${String(x.action)}`);}}
 const m=set.motion;
 if(m?.profile==='quintic-sync-v1'){
  if(!Array.isArray(m.maxAccelerationRadS2)||m.maxAccelerationRadS2.length!==n||!m.maxAccelerationRadS2.every(pos))bad(`maxAccelerationRadS2 needs ${n} finite positive values`);
  if(!pos(m.speedFraction)||m.speedFraction>1)bad('speedFraction must be in (0,1]');
  if(!model.limits.every(l=>pos(l.maxVelocity)))bad('model velocity limits must be finite and positive');
 }else if(m?.profile!=='linear-clamp')bad('motion profile');
 const c=set.contact;
 if(c){
  if(!tick(c.gripSettleTicks)||!tick(c.dropTicks)||!tick(c.releaseTimeoutTicks))bad('contact tick counts must be integers >= 1');
  if(![c.openM,c.closedM,c.liftMinM].every(Number.isFinite)||!(c.openM>c.closedM)||!(c.closedM>=0))bad('contact needs finite openM > closedM >= 0 and liftMinM');
 }
}
const dist=(a:readonly number[],b:readonly number[])=>Math.hypot(a[0]!-b[0]!,a[1]!-b[1]!,a[2]!-b[2]!);
export interface ArmCupWorld {take(cupId?:string):string|null;put(cupId:string,receiver:{robotId:string;slot:number}):void}
export type ArmFault='arm-reboot'|'arm-drop'|'arm-following-error'|'arm-stop'|'arm-estop'|'arm-reset'|'arm-collision';
/** Tracking mode (R1.1): the arm is a plant that follows the commanded joints (Webots). Thresholds come from the oracle profile `webotsArm` and are test thresholds, not a capability. */
export interface ArmTracking {reachTolRad:number;settleTicks:number;followTolRad:number;followTicks:number}
/** What the tracking mode keeps beside the plant state (JSON, so it survives a checkpoint): the generator's own commanded position, the settle and following-error counters, and per-joint stats of actual - commanded while a program runs. */
export interface ArmTrackingState {gen:number[];settled:number;followCount:number;samples:number;peakRad:number[];sumSq:number[];trace:{tick:number;actualRad:number[];commandedRad:number[]}[]}
export interface ArmStopState {latched:boolean;reconcileRequired:boolean;reason:string;events:{tick:number;stage:'requested'|'acknowledged'|'observed'|'reset';reason:string;provenance:'modelled'}[]}
export const ARM_COLLISION_TRACE_LIMIT=4096;
const TRACKED_REST_RAD=2e-4;
export interface ArmCollisionInterval {firstTick:number;lastTick:number;fromQ:number[];toQ:number[];heldCupId:string|null;worldRevision:string;sceneRevision:string|null;result:SweepResult}
export interface ArmCollisionEvidence {intervals:ArmCollisionInterval[];worlds:Record<string,ArmObstacle[]>;droppedIntervals:number;
 /** A collision latches the arm, so this is the immutable triggering failure even if later scene snapshots change. */
 firstFailure?:{tick:number;fromQ:number[];toQ:number[];heldCupId:string|null;worldRevision:string;world:ArmObstacle[];scene:ArmSceneSnapshot|null;result:SweepResult}}
interface Program {commandId:string;payloadHash:string;controlEpoch:number;program:string;index:number;state:'running'|'completed'|'failed'|'unknown';waiting:number;evidence:TransferEvidence;accepted:CellAcceptance}
export interface ArmPlantState {deviceId:string;q:number[];gripper:'open'|'closed';holding:string|null;bootId:string;seq:number;tick:number;programs:Program[];modifiers:ArmFault[];
 trace:{tick:number;q:number[];tcp:[number,number,number]}[];limitsOk:boolean;commandedQ?:number[];stop?:ArmStopState;tracking?:ArmTrackingState;
 collision?:{/** Manually injected obstacles in arm-base coordinates; scene refresh does not replace these. */world:ArmObstacle[];checks:number;last:SweepResult|null;scene?:ArmSceneSnapshot;evidence?:ArmCollisionEvidence};
 plantId?:'webots_arm'|'mujoco_arm';/** Contact mode: the gripper opening commanded to the plant (m). Only a grip or a release step writes it; stop() and halt() never do. */gripperCommandM?:number;
 props?:PlantExtras['props'];grip?:ArmGripState;/** quintic-sync-v1: the segment being commanded (k ticks done of from -> to). */segment?:{from:number[];to:number[];k:number}}
export class MockArmPlant {
 private listeners=new Set<(r:CellReport)=>void>();
 constructor(readonly state:ArmPlantState,private nowMs:()=>number,private newBootId:()=>string,private cups:ArmCupWorld,private receiver:()=>{robotId:string;slot:number}|null,private model:ArmModelSI=PUMA560_SI,private tracking?:ArmTracking,private programs:ArmProgramSet=PUMA_PROGRAMS){
  if(programs.modelId!==model.id)throw new Error(`ARM_PROGRAM_MODEL_MISMATCH: ${programs.modelId} on ${model.id}`);
  if(programs.contact&&!tracking)throw new Error('ARM_CONTACT_NEEDS_TRACKING');
  validatePrograms(programs,model);
  state.collision??={world:[],checks:0,last:null};state.collision.evidence??={intervals:[],worlds:{},droppedIntervals:state.collision.checks};
  if(tracking)state.tracking??={gen:[...state.q],settled:0,followCount:0,samples:0,peakRad:state.q.map(()=>0),sumSq:state.q.map(()=>0),trace:[]};}
 static initial(deviceId:string,bootId='boot-0:arm',programs:ArmProgramSet=PUMA_PROGRAMS):ArmPlantState {const home=programs.waypoints?.home;if(!Array.isArray(home))throw new Error('ARM_PROGRAM_INVALID: waypoint home missing');return {deviceId,q:[...home],gripper:'open',holding:null,bootId,seq:0,tick:0,programs:[],modifiers:[],trace:[],limitsOk:true};}
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
  if(command.capability!=='start_job'||!program||!this.programs.choreography[program])return {accepted:false,unknown:false,reason:'PROGRAM_NOT_APPROVED'};
  if(this.state.programs.some(p=>p.state==='running'))return {accepted:false,unknown:false,reason:'ARM_BUSY'};
  const p:Program={commandId:command.commandId,payloadHash:command.payloadHash,controlEpoch:command.controlEpoch,program,index:0,state:'running',waiting:0,evidence:{source:MOCK_ARM.id,grip:this.programs.contact?'contact':'commanded_mock',forceModel:'none'},accepted:{accepted:true,unknown:false}};
  this.state.programs.push(p);this.emit(p,'accepted');return p.accepted;
 }
 reconcile(commandId:string):CellExecutionState {const p=this.state.programs.find(x=>x.commandId===commandId);return p?{status:p.state,evidence:{...p.evidence} as JsonObject}:{status:'not_found',evidence:{}};}
 setCollisionWorld(world:ArmObstacle[]){checkArmSweep(this.model,this.state.q,this.state.q,{world,...this.programs.collision});this.state.collision!.world=structuredClone(world);}
 setCollisionScene(scene:ArmSceneSnapshot){this.state.collision!.scene=scene;}
 private recordCollision(toQ:number[],world:ArmObstacle[],result:SweepResult){
  const s=this.state,c=s.collision!,e=c.evidence!,worldRevision=hashJson(world),heldCupId=s.holding,sceneRevision=c.scene?.revision??null;
  const last=e.intervals.at(-1),same=(a:number[],b:number[])=>a.every((n,i)=>n===b[i]);
  // Identical stationary checks retain a closed tick interval; motion, attachment or scene geometry changes get a new record.
  // A tracked plant never rests exactly: an interval also absorbs ticks of a clear, nearly still arm (within TRACKED_REST_RAD of where the interval began, about 0.2 mm at 1 m reach, below the 0.5 mm sweep tolerance). Motion and every collision get their own record.
  const still=(a:number[],b:readonly number[])=>a.every((v,i)=>Math.abs(v-b[i]!)<=TRACKED_REST_RAD);
  const resting=this.tracking!==undefined&&result.ok&&last!==undefined&&last.result.ok&&still(last.fromQ,s.q)&&still(last.fromQ,toQ);
  if(last&&last.lastTick===s.tick-1&&last.worldRevision===worldRevision&&last.sceneRevision===sceneRevision&&last.heldCupId===heldCupId&&(resting||same(last.fromQ,s.q)&&same(last.toQ,toQ))){last.lastTick=s.tick;if(resting)last.toQ=[...toQ];}
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
  this.hold();
 }
 /** Tracking mode: a stopped arm is told to stay where the plant is (inside the joint limits, so the target is always one the plant accepts), not to keep driving at its last target. */
 private hold(){const s=this.state;if(!this.tracking||!s.tracking)return;s.tracking.gen=s.q.map((q,i)=>Math.min(Math.max(q,this.model.limits[i]!.min),this.model.limits[i]!.max));s.commandedQ=[...s.tracking.gen];s.tracking.settled=0;s.tracking.followCount=0;}
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
  const t=this.tracking?s.tracking!:undefined,steps=p?this.programs.choreography[p.program]!:[],stage=p?steps[p.index]!:undefined,goal=stage?this.programs.waypoints[stage.waypoint]!:t?t.gen:s.q;
  const maxStep=this.model.limits.map(l=>l.maxVelocity*MOCK_ARM_PARAMS.speedFraction*MOCK_ARM_PARAMS.dtS);
  const from=t?t.gen:s.q,next=this.programs.motion.profile==='quintic-sync-v1'?this.quintic(from,goal):from.map((q,i)=>{const d=goal[i]!-q;return Math.abs(d)<=maxStep[i]!?goal[i]!:q+Math.sign(d)*maxStep[i]!;});
  s.commandedQ=next;
  if(t){t.gen=[...next];return;} // tracking: only the commanded joints are generated here; observe() applies what the plant did
  const world=[...s.collision!.world,...scene?.world??[]],collision=checkArmSweep(this.model,s.q,next,{world,heldCup:s.holding!==null,...this.programs.collision});
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
 /** quintic-sync-v1: one segment per goal, from where the command was when the goal changed. The segment is in the state (JSON, survives a checkpoint); a command that is not
  * where the segment says (a hold, a reset, another goal) starts a new one. */
 private quintic(from:readonly number[],goal:readonly number[]){
  const s=this.state,m=this.programs.motion as Extract<ArmProgramSet['motion'],{profile:'quintic-sync-v1'}>,same=(a:readonly number[],b:readonly number[])=>a.every((v,i)=>v===b[i]);
  const lim={maxVelocity:this.model.limits.map(l=>l.maxVelocity),maxAcceleration:m.maxAccelerationRadS2,speedFraction:m.speedFraction,dtS:MOCK_ARM_PARAMS.dtS};
  let g=s.segment,seg=g&&quinticSegment(g.from,g.to,lim);
  if(!g||!seg||!same(g.to,goal)||!same(seg.at(g.k),from)){g=s.segment={from:[...from],to:[...goal],k:0};seg=quinticSegment(g.from,g.to,lim);}
  g.k=Math.min(g.k+1,seg.ticks);return seg.at(g.k);
 }
 /** The waypoint is reached: grip, release, the lift check and the next stage. One body for both modes, so the evidence is the same. */
 private complete(p:Program,stage:{waypoint:string;action?:'grip'|'release'},steps:{waypoint:string;action?:'grip'|'release'}[],extras?:PlantExtras){
  if(this.programs.contact)return this.completeContact(p,stage,steps,extras);
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
  if(stage.waypoint==='lift')p.evidence.liftPoseReached=this.tcp(this.programs.waypoints.lift!)[2]>this.tcp(this.programs.waypoints.pick!)[2]&&s.holding!==null;
  if(++p.index>=steps.length){p.state='completed';this.emit(p,'completed',[],{...p.evidence});}
 }
 /** Contact grip, once the waypoint has settled (every tick while it stays settled). grip: command closed, wait until the opening settles, then hold what the pads hold.
  * release: command open, wait until the cup rests on the tray, then put it. The cup is taken and put only on the plant's word. */
 private completeContact(p:Program,stage:{waypoint:string;action?:'grip'|'release'},steps:{waypoint:string;action?:'grip'|'release'}[],extras?:PlantExtras){
  const s=this.state,c=this.programs.contact!,g=s.grip;
  if(stage.action==='grip'&&s.gripper==='open'){s.gripper='closed';s.gripperCommandM=c.closedM;s.holding=null;s.grip={phase:'closing',ticks:0,lost:0,liftFromM:null,maxSlipM:null,openingM:extras?.gripper?.openingM??null,slipFromM:null,elapsed:0};return;}
  if(stage.action==='grip'&&g?.phase==='closing'&&s.holding===null){
   if(g.ticks<c.gripSettleTicks)return;
   const held=extras?.gripper?.heldPropIds[0]??null,cup=held===null?null:this.cups.take(held);
   Object.assign(p.evidence,{gripperClosed:true,objectPresent:held!==null,cupId:cup,grip:'contact'});
   // the pads hold a cup the cup world did not hand over: custody is unknown, never a completed pick
   if(held!==null&&cup===null){Object.assign(p.evidence,{heldPropId:held});this.stop('CUP_CUSTODY_MISMATCH');return;}
   s.holding=cup;if(!cup)delete s.grip;else{this.baseline(g,extras);p.evidence.maxSlipM=g.maxSlipM;}
  }
  if(stage.action==='release'&&s.gripper==='closed'){
   if(g?.phase!=='opening'){
    const rx=this.receiver();
    if(!rx){if(++p.waiting>=MOCK_ARM_PARAMS.receiverWaitTicks){p.state='failed';this.emit(p,'failed',['RECEIVER_NOT_READY'],{...p.evidence});}return;}
    s.gripperCommandM=c.openM;
    if(s.holding!==null){s.grip={...g??{lost:0,liftFromM:null,maxSlipM:null,openingM:null,slipFromM:null},phase:'opening',ticks:0,elapsed:0,receiver:rx};return;}
    s.gripper='open';delete s.grip;Object.assign(p.evidence,{released:true,receiverId:rx.robotId,slot:rx.slot,cupId:null}); // nothing was held: open, as the event grip does
   }else if(g.ticks<c.gripSettleTicks){
    // the cup was let go but the plant never saw it on the tray: its whereabouts are unknown. The program fails, the arm latches until reconciled, the cup stays in the arm's custody.
    if(g.elapsed>c.releaseTimeoutTicks){s.gripper='open';p.state='failed';this.emit(p,'failed',['RELEASE_NOT_ON_RECEIVER'],{...p.evidence});this.stop('RELEASE_NOT_ON_RECEIVER');}
    return;
   }else{const rx=g.receiver!;s.gripper='open';this.cups.put(s.holding!,rx);Object.assign(p.evidence,{released:true,receiverId:rx.robotId,slot:rx.slot,cupId:s.holding});s.holding=null;delete s.grip;}
  }
  if(stage.waypoint==='lift'){const z=extras?.props?.find(x=>x.propId===s.holding)?.position[2],from=s.grip?.liftFromM??null;p.evidence.liftPoseReached=s.holding!==null&&z!==undefined&&from!==null&&z-from>=c.liftMinM;}
  if(++p.index>=steps.length){p.state='completed';this.emit(p,'completed',[],{...p.evidence});}
 }
 /** The slip and lift baseline of a held cup, on the first tick its position is seen: until then slip is null (unmeasured), never 0. */
 private baseline(g:ArmGripState,extras?:PlantExtras){
  const at=extras?.props?.find(x=>x.propId===this.state.holding)?.position;if(!at||g.slipFromM!==null)return;
  g.liftFromM=at[2]!;g.slipFromM=dist(at,this.tcp(this.state.q));g.maxSlipM=0;
 }
 /** Contact grip, every tick after the plant stepped: the closing and opening counters and the drop watch. A tick without plant extras reads as no cup held and no cup resting
  * on the tray (a missing opening counts as unchanged). Returns true when it stopped the arm. */
 private watchContact(p:Program|undefined,extras?:PlantExtras){
  const s=this.state,g=s.grip;if(!g)return false;
  if(g.phase==='opening'){g.elapsed++;g.ticks=extras?.props?.find(x=>x.propId===s.holding)?.restingOn==='tray'?g.ticks+1:0;return false;}
  if(s.holding===null){const o=extras?.gripper?.openingM;g.ticks=o===undefined||g.openingM!==null&&Math.abs(o-g.openingM)<1e-4?g.ticks+1:0;if(o!==undefined)g.openingM=o;return false;}
  const held=extras?.gripper?.heldPropIds.includes(s.holding)??false,at=extras?.props?.find(x=>x.propId===s.holding)?.position;
  g.lost=held?0:g.lost+1;
  if(held&&at&&g.slipFromM!==null)g.maxSlipM=Math.max(g.maxSlipM??0,Math.abs(dist(at,this.tcp(s.q))-g.slipFromM));
  else if(held)this.baseline(g,extras);
  if(p)p.evidence.maxSlipM=g.maxSlipM;
  if(g.lost>=this.programs.contact!.dropTicks){this.stop('CUP_DROPPED');return true;}
  return false;
 }
 /** Tracking mode, once per tick after the plant stepped: what the plant did becomes the arm state. Order: non-finite, then ARM03 geometry on the actual joints (D28), the plant's own collisions,
  * limits, the following error, and finally whether the waypoint is reached. Any stop leaves the cup where it is. */
 observe(actualQ:readonly number[],collisionIds:readonly string[],extras?:PlantExtras){
  const s=this.state,t=s.tracking;
  if(!this.tracking||!t)throw new Error('ARM_TRACKING_DISABLED: observe needs the tracking mode');
  if(this.programs.contact)s.props=structuredClone(extras?.props??[]);
  const finite=actualQ.length===s.q.length&&actualQ.every(Number.isFinite);
  // a stopped arm runs no program and no check, but its joints stay what the plant reports (it is held where it stopped, see hold())
  if(s.stop?.latched||s.stop?.reconcileRequired){if(finite)s.q=[...actualQ];return;}
  if(!finite){this.stop('PLANT_UNSTABLE');return;}
  const p=s.programs.find(x=>x.state==='running'),scene=s.collision!.scene;
  let swept:SweepResult|undefined;
  if(p||scene?.available){
   const world=[...s.collision!.world,...scene?.world??[]];swept=checkArmSweep(this.model,s.q,actualQ,{world,heldCup:s.holding!==null,...this.programs.collision});
   this.recordCollision([...actualQ],world,swept);
   s.collision!.checks++;s.collision!.last=swept;
  }
  s.q=[...actualQ]; // the plant is where it says it is, also in the tick that stops it
  if(!s.q.every((q,i)=>q>=this.model.limits[i]!.min&&q<=this.model.limits[i]!.max))s.limitsOk=false;
  if(swept&&!swept.ok){this.stop(swept.reason==='COLLISION'?'ARM_COLLISION':'ARM_SWEEP_UNCERTAIN');return;}
  if(collisionIds.length>0){this.stop('ARM_COLLISION');return;}
  const commanded=s.commandedQ??t.gen,error=s.q.map((q,i)=>Math.abs(q-commanded[i]!));
  if(p){
   t.samples++;error.forEach((e,i)=>{t.peakRad[i]=Math.max(t.peakRad[i]!,e);t.sumSq[i]=t.sumSq[i]!+e*e;});
   if(t.trace.length<MOCK_ARM_PARAMS.traceCap)t.trace.push({tick:s.tick,actualRad:[...s.q],commandedRad:[...commanded]});
   if(s.tick%MOCK_ARM_PARAMS.traceEvery===0&&s.trace.length<MOCK_ARM_PARAMS.traceCap)s.trace.push({tick:s.tick,q:[...s.q],tcp:this.tcp(s.q)});
  }
  if(Math.max(...error)>this.tracking.followTolRad){if(++t.followCount>=this.tracking.followTicks){this.stop('ARM_FOLLOWING_ERROR');return;}}else t.followCount=0;
  if(this.programs.contact&&this.watchContact(p,extras))return;
  if(!p)return;
  const steps=this.programs.choreography[p.program]!,stage=steps[p.index]!,goal=this.programs.waypoints[stage.waypoint]!;
  if(t.gen.every((v,i)=>v===goal[i])&&s.q.every((q,i)=>Math.abs(q-goal[i]!)<=this.tracking!.reachTolRad))t.settled++;else t.settled=0;
  if(t.settled>=this.tracking.settleTicks){const index=p.index;this.complete(p,stage,steps,extras);if(p.index!==index)t.settled=0;}
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
