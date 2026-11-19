// diff-drive-base-v1 (R4-A §5.3): wheel speeds from a (v, omega) setpoint through a virtual drive. Pure and deterministic: no clock, no randomness, no truth.
// It does the enable sequence, limits the wheel command step, integrates odometry from the measured (quantised) wheel angle, and never resets a fault.
import type {DriveCommandV1,DriveFeedbackV1} from './drive-io';
import type {ControllerEvent,MotionController} from './controller';

export interface DiffDriveBaseConfig {axisLeft:string;axisRight:string;wheelRadiusM:number;wheelSeparationM:number;maxWheelAccelRadS2:number;enableTimeoutTicks:number;trackingDegradedRadS:number;trackingDegradedTicks:number;/** what one encoder count is worth as a speed estimate; a deviation below it is quantisation, not tracking (absent = an exact encoder) */velocityResolutionRadS?:number}
export interface DiffDriveBaseState {
 config:DiffDriveBaseConfig;seq:number;waitingTicks:number;notReady:boolean;faulted:boolean;degraded:boolean;
 targets:[number,number];wheelAngles:[number,number]|null;odometry:[number,number,number];errors:[number[],number[]]}
const TICK_S=0.02;
const sinc=(x:number)=>x===0?1:Math.sin(Math.PI*x)/(Math.PI*x);  // numpy's normalised sinc, as the worker uses it

export const diffDriveBaseV1:MotionController<DiffDriveBaseState,{vMps:number;omegaRadps:number;stop?:boolean},DiffDriveBaseConfig>={
 id:'diff-drive-base-v1',revision:1,
 init:config=>({config,seq:0,waitingTicks:0,notReady:false,faulted:false,degraded:false,targets:[0,0],wheelAngles:null,odometry:[0,0,0],errors:[[],[]]}),
 step(state,input){
  const c=state.config,events:ControllerEvent[]=[];
  const fb=[c.axisLeft,c.axisRight].map(id=>{const f=input.feedback.find(x=>x.axisId===id);if(!f)throw new Error(`DRIVE_FEEDBACK_AXIS_MISSING:${id}`);return f as DriveFeedbackV1;});
  const seq=state.seq+1;
  // odometry from the measured angle increments, the worker's formula (arc of the mean wheel travel, heading by the difference)
  let {wheelAngles,odometry}=state;
  if(fb[0]!.positionRad!==null&&fb[1]!.positionRad!==null){
   const now:[number,number]=[fb[0]!.positionRad,fb[1]!.positionRad];
   if(wheelAngles){
    const dl=(now[0]-wheelAngles[0])*c.wheelRadiusM,dr=(now[1]-wheelAngles[1])*c.wheelRadiusM,ds=(dl+dr)/2,da=(dr-dl)/c.wheelSeparationM,d=ds*sinc(da/(2*Math.PI));
    odometry=[odometry[0]+d*Math.cos(odometry[2]+da/2),odometry[1]+d*Math.sin(odometry[2]+da/2),odometry[2]+da];
   }
   wheelAngles=now;
  }
  const faultedAxes=fb.filter(f=>f.state==='fault'),allEnabled=fb.every(f=>f.state==='enabled');
  let targets:[number,number]=[0,0],{waitingTicks,notReady,faulted,degraded}=state,errors=state.errors;
  if(faultedAxes.length){
   if(!faulted)events.push({tick:input.tick,code:'DRIVE_FAULT',axisId:faultedAxes[0]!.axisId,detail:faultedAxes.map(f=>`${f.axisId}:${f.fault}`).join(',')});
   faulted=true;errors=[[],[]];degraded=false;
  }else if(!allEnabled){
   faulted=false;waitingTicks+=1;errors=[[],[]];degraded=false;
   if(waitingTicks>c.enableTimeoutTicks&&!notReady){notReady=true;events.push({tick:input.tick,code:'DRIVE_NOT_READY',axisId:fb.find(f=>f.state!=='enabled')!.axisId,detail:fb.map(f=>`${f.axisId}:${f.state}`).join(',')});}
  }else{
   faulted=false;waitingTicks=0;notReady=false;
   const half=input.setpoint.omegaRadps*c.wheelSeparationM/2,desired:[number,number]=[(input.setpoint.vMps-half)/c.wheelRadiusM,(input.setpoint.vMps+half)/c.wheelRadiusM],step=c.maxWheelAccelRadS2*TICK_S;
   // `stop`: the caller (an interlocked cell) needs the wheels at zero NOW; the acceleration limit would stretch that into a ramp
   targets=input.setpoint.stop?[0,0]:[0,1].map(i=>Math.max(state.targets[i]!-step,Math.min(state.targets[i]!+step,desired[i]!))) as [number,number];
   // tracking: the mean error of the measured speed against the speed commanded last tick, over a window. A quantised encoder at rest flips a count now and then; the mean ignores that.
   errors=[0,1].map(i=>{const v=fb[i]!.velocityRadS;const e=v===null?state.errors[i]!:[...state.errors[i]!,v-state.targets[i]!];return e.slice(-c.trackingDegradedTicks);}) as [number[],number[]];
   const bad=errors.some(e=>e.length>=c.trackingDegradedTicks&&Math.abs(e.reduce((a,b)=>a+b,0)/e.length)>Math.max(c.trackingDegradedRadS,c.velocityResolutionRadS??0));
   if(bad&&!degraded)events.push({tick:input.tick,code:'TRACKING_DEGRADED',detail:errors.map(e=>(e.reduce((a,b)=>a+b,0)/Math.max(1,e.length)).toFixed(3)).join(',')});
   degraded=bad;
  }
  const commands:DriveCommandV1[]=[c.axisLeft,c.axisRight].map((axisId,i)=>({axisId,seq,mode:'csv',target:targets[i]!,enable:true,quickStop:false,faultReset:false}));
  return {state:{config:c,seq,waitingTicks,notReady,faulted,degraded,targets,wheelAngles,odometry,errors},commands,events};
 },
};
