// diff-drive-base-v1 (R4-A §5.3): wheel speeds from a (v, omega) setpoint through a virtual drive. Pure and deterministic: no clock, no randomness, no truth.
// It does the enable sequence, limits the wheel command step, integrates odometry from the measured (quantised) wheel angle, and never resets a fault.
import type {DriveCommandV1,DriveFeedbackV1} from './drive-io';
import type {ControllerEvent,MotionController} from './controller';

export interface DiffDriveBaseConfig {axisLeft:string;axisRight:string;wheelRadiusM:number;wheelSeparationM:number;maxWheelAccelRadS2:number;enableTimeoutTicks:number;trackingDegradedRadS:number;trackingDegradedTicks:number;/** what one encoder count is worth as a speed estimate; a deviation below it is quantisation, not tracking (absent = an exact encoder) */velocityResolutionRadS?:number}
export interface DiffDriveBaseState {
 config:DiffDriveBaseConfig;seq:number;waitingTicks:number;notReady:boolean;faulted:boolean;degraded:boolean;
 ramp?:{maxChange:number;delta:WheelPair;bounds:DriveBounds};targets:[number,number];wheelAngles:[number,number]|null;odometry:[number,number,number];errors:[number[],number[]]}
const TICK_S=0.02;
const sinc=(x:number)=>x===0?1:Math.sin(Math.PI*x)/(Math.PI*x);  // numpy's normalised sinc, as the worker uses it

type WheelPair=[number,number];
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
  let ramp=state.ramp,targets:WheelPair=[0,0],{waitingTicks,notReady,faulted,degraded}=state,errors=state.errors;
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
   if(ramp&&!input.setpoint.stop){
    const delta=nextWheelDelta(state.targets,desired,ramp.delta,step,ramp.maxChange,ramp.bounds);
    targets=[state.targets[0]+delta[0],state.targets[1]+delta[1]];ramp={...ramp,delta};
   }
   // tracking: the mean error of the measured speed against the speed commanded last tick, over a window. A quantised encoder at rest flips a count now and then; the mean ignores that.
   errors=[0,1].map(i=>{const v=fb[i]!.velocityRadS;const e=v===null?state.errors[i]!:[...state.errors[i]!,v-state.targets[i]!];return e.slice(-c.trackingDegradedTicks);}) as [number[],number[]];
   const bad=errors.some(e=>e.length>=c.trackingDegradedTicks&&Math.abs(e.reduce((a,b)=>a+b,0)/e.length)>Math.max(c.trackingDegradedRadS,c.velocityResolutionRadS??0));
   if(bad&&!degraded)events.push({tick:input.tick,code:'TRACKING_DEGRADED',detail:errors.map(e=>(e.reduce((a,b)=>a+b,0)/Math.max(1,e.length)).toFixed(3)).join(',')});
   degraded=bad;
  }
  if(ramp&&(input.setpoint.stop||!allEnabled))ramp={...ramp,delta:[0,0]};
  const commands:DriveCommandV1[]=[c.axisLeft,c.axisRight].map((axisId,i)=>({axisId,seq,mode:'csv',target:targets[i]!,enable:true,quickStop:false,faultReset:false}));
  return {state:{config:c,...ramp?{ramp}:{},seq,waitingTicks,notReady,faulted,degraded,targets,wheelAngles,odometry,errors},commands,events};
 },
};

// A delta is the change in commanded wheel speed over one tick. Bringing a positive delta x
// back to zero consumes x + (x-h) + ... over ceil(x/h) ticks, where h = jerk * dt².
// Invert that distance to reach a steady request without a final velocity clamp.
interface DriveBounds {wheel:WheelPair;mean:number;halfDifference:number}
function brakingDelta(distance:number,h:number){
 if(distance===0)return 0;
 const n=Math.max(1,Math.ceil((Math.sqrt(1+8*Math.abs(distance)/h)-1)/2));
 return Math.sign(distance)*(Math.abs(distance)/n+h*(n-1)/2);
}
function nextWheelDelta(previous:WheelPair,desired:WheelPair,old:WheelPair,maxStep:number,h:number,bounds:DriveBounds):WheelPair{
 const preferred=desired.map((v,i)=>Math.max(-maxStep,old[i]!-h,Math.min(maxStep,old[i]!+h,brakingDelta(v-previous[i]!,h)))) as WheelPair;
 // A common deceleration preserves the direction of the wheel pair and thus the coupled body
 // constraints. Reserve enough room to bring that delta to zero even if the request reverses.
 const admissible=(delta:WheelPair)=>{
  const peak=Math.max(...delta.map(Math.abs)),n=Math.ceil(peak/h),factor=peak?n-(h/peak)*n*(n-1)/2:0;
  const left=previous[0]+factor*delta[0],right=previous[1]+factor*delta[1];
  return Math.abs(left)<=bounds.wheel[0]&&Math.abs(right)<=bounds.wheel[1]&&Math.abs((left+right)/2)<=bounds.mean&&Math.abs((right-left)/2)<=bounds.halfDifference;
 };
 if(admissible(preferred))return preferred;
 const peak=Math.max(...old.map(Math.abs)),brake=peak?Math.max(0,1-h/peak):0;
 const safe:WheelPair=[old[0]*brake,old[1]*brake];
 const between=(f:number):WheelPair=>[safe[0]+f*(preferred[0]-safe[0]),safe[1]+f*(preferred[1]-safe[1])];
 let lo=0,hi=1;
 for(let i=0;i<48;i++){const mid=(lo+hi)/2;if(admissible(between(mid)))lo=mid;else hi=mid;}
 return between(lo);
}
export function jerkStep(jerk:number,dt:number){
 if(![jerk,dt].every(x=>Number.isFinite(x)&&x>0))throw Error('DRIVE_CONTROLLER_LIMIT_INVALID');
 return jerk*dt*dt;
}
export function initDiffDriveRevision2(config:DiffDriveBaseConfig,maxWheelJerkRadS3:number,bounds:DriveBounds):DiffDriveBaseState{
 if(![config.maxWheelAccelRadS2,...bounds.wheel,bounds.mean,bounds.halfDifference].every(x=>Number.isFinite(x)&&x>0))throw Error('DRIVE_CONTROLLER_LIMIT_INVALID');
 return {...diffDriveBaseV1.init(config),ramp:{maxChange:jerkStep(maxWheelJerkRadS3,TICK_S),delta:[0,0],bounds}};
}
