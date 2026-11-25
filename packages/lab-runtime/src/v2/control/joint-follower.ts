// joint-trajectory-follower-v1 (R4-A §5.3): joint targets and a gripper opening from the arm program state machine, sent as csp commands. Pure and deterministic.
// Enable sequence; hold at the measured position while the drive is not enabled; on a fault every axis holds (joints at their last measured position, the gripper at its last
// command, so a cup stays between the pads) and nothing ever commands a wider opening or a faultReset.
import type {DriveCommandV1,DriveFeedbackV1} from './drive-io';
import type {ControllerEvent,MotionController} from './controller';

export interface JointFollowerConfig {axes:string[];gripperAxis:string;gripperMap:{loRad:number;hiRad:number;openingMaxM:number};enableTimeoutTicks:number;followTolRad:number;followTicks:number}
export interface JointFollowerState {
 config:JointFollowerConfig;seq:number;waitingTicks:number;notReady:boolean;faulted:boolean;following:boolean;
 targets:number[];gripperTarget:number|null;lastMeasured:number[];followCount:number[];/** the joint targets taken when the hold began; null while every axis is enabled */latch:number[]|null}

export const gripperCtrl=(m:JointFollowerConfig['gripperMap'],openingM:number)=>m.loRad+(m.hiRad-m.loRad)*(1-openingM/m.openingMaxM);

export const jointTrajectoryFollowerV1:MotionController<JointFollowerState,{positionsRad:number[];openingM:number|null},JointFollowerConfig>={
 id:'joint-trajectory-follower-v1',revision:1,
 init:config=>({config,seq:0,waitingTicks:0,notReady:false,faulted:false,following:false,targets:config.axes.map(()=>Number.NaN),gripperTarget:null,lastMeasured:config.axes.map(()=>Number.NaN),followCount:config.axes.map(()=>0),latch:null}),
 step(state,input){
  const c=state.config,events:ControllerEvent[]=[],ids=[...c.axes,c.gripperAxis];
  const fb=ids.map(id=>{const f=input.feedback.find(x=>x.axisId===id);if(!f)throw new Error(`DRIVE_FEEDBACK_AXIS_MISSING:${id}`);return f as DriveFeedbackV1;});
  if(input.setpoint.positionsRad.length!==c.axes.length)throw new Error('JOINT_SETPOINT_SHAPE');
  const seq=state.seq+1,joints=fb.slice(0,c.axes.length),grip=fb[c.axes.length]!;
  // the last position the drive measured, per joint; a lost reading keeps the last good one
  const measured=joints.map((f,i)=>f.positionRad??state.lastMeasured[i]!);
  const faulted=fb.filter(f=>f.state==='fault'),allEnabled=fb.every(f=>f.state==='enabled');
  let {waitingTicks,notReady,following,followCount}=state,flag=false;
  let targets:number[],gripperTarget=state.gripperTarget;
  // the hold is taken ONCE, where the joints are when it begins (a fault or a drive that is not enabled) and kept until every axis is enabled again: "the latest measurement" every tick would let the
  // joints that are still enabled sag with the one that is not (review of V05: J3 16 degrees in 5 s)
  let latch=state.latch;
  const holdJoints=()=>latch=latch??measured.map((m,i)=>Number.isNaN(m)?(Number.isNaN(state.targets[i]!)?0:state.targets[i]!):m);
  if(faulted.length){
   if(!state.faulted)events.push({tick:input.tick,code:'DRIVE_FAULT',axisId:faulted[0]!.axisId,detail:faulted.map(f=>`${f.axisId}:${f.fault}`).join(',')});
   flag=true;targets=holdJoints();gripperTarget=gripperTarget??grip.positionRad??0;followCount=followCount.map(()=>0);following=false;
  }else if(!allEnabled){
   waitingTicks+=1;targets=holdJoints();gripperTarget=gripperTarget??grip.positionRad??0;followCount=followCount.map(()=>0);following=false;
   if(waitingTicks>c.enableTimeoutTicks&&!notReady){notReady=true;events.push({tick:input.tick,code:'DRIVE_NOT_READY',axisId:fb.find(f=>f.state!=='enabled')!.axisId,detail:fb.map(f=>`${f.axisId}:${f.state}`).join(',')});}
  }else{
   waitingTicks=0;notReady=false;latch=null;targets=[...input.setpoint.positionsRad];
   if(input.setpoint.openingM!==null)gripperTarget=gripperCtrl(c.gripperMap,input.setpoint.openingM);else gripperTarget=gripperTarget??grip.positionRad??0;
   // following error against the target sent last tick (the measured position is the result of that command)
   followCount=joints.map((f,i)=>f.positionRad!==null&&!Number.isNaN(state.targets[i]!)&&Math.abs(f.positionRad-state.targets[i]!)>c.followTolRad?state.followCount[i]!+1:0);
   const bad=followCount.some(n=>n>=c.followTicks);
   if(bad&&!following)events.push({tick:input.tick,code:'ARM_FOLLOWING_ERROR',axisId:c.axes[followCount.findIndex(n=>n>=c.followTicks)]!,detail:`over ${c.followTolRad} rad for ${c.followTicks} ticks`});
   following=bad;
  }
  const commands:DriveCommandV1[]=ids.map((axisId,i)=>({axisId,seq,mode:'csp',target:i<c.axes.length?targets[i]!:gripperTarget!,enable:true,quickStop:false,faultReset:false}));
  return {state:{config:c,seq,waitingTicks,notReady,faulted:flag,following,targets,gripperTarget,lastMeasured:measured,followCount,latch},commands,events};
 },
};
