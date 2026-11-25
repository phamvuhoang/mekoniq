import type {PhysicsTickRecord,StopPolicyV1} from '../../packages/lab-runtime/src/v2/navigation2d/contracts';

export const POLICY:StopPolicyV1={schemaVersion:1,documentType:'stop-policy',id:'stop-policy-test',revision:1,digest:'a'.repeat(64),calibration:'not_calibrated',restSpeedMps:0.01,restTicks:25,observeTicks:500,decelWindowTicks:5,driftTicks:100,slipToleranceMps:0.05,cupTiltCosine:0.866,
 source:{kind:'assumed',documentId:'test',revision:'1',locator:'test',contentSha256:'b'.repeat(64)}};
export const AXES=['amr-1/wheel-left','amr-1/wheel-right'];
export interface Spec{ticks:number;speed:(t:number)=>number;torque?:(t:number)=>number;state?:(t:number)=>string;cups?:(t:number)=>{slipM:number;tilted?:boolean}|null;drives?:boolean;wheels?:boolean;radius?:number}
/** A straight run along x: positions integrate the speed of each tick (speed(t) is the mean over tick t-1 to t), with the drive and cup streams the report reads. */
export function records(s:Spec):PhysicsTickRecord[]{
 const out:PhysicsTickRecord[]=[];let x=0;
 for(let t=0;t<=s.ticks;t++){
  if(t>0)x+=s.speed(t)*0.02;
  const cups=s.cups?.(t);
  out.push({schemaVersion:1,tick:t,simTimeNs:String(t*20_000_000),contacts:[],
   loads:cups?['cup-1','cup-2','cup-3'].map((id,i)=>({propId:id,poseMap:{positionM:[x,0,0.1],quaternionXyzw:cups.tilted&&i===0?[0.5,0,0,0.866]:[0,0,0,1]},supportId:'tray-1',poseInSupport:{positionM:[i===0?cups.slipM:0,0,0.05],quaternionXyzw:[0,0,0,1]}})):[],
   base:[{robotId:'amr-1',poseMap:{positionM:[x,0,0],quaternionXyzw:[0,0,0,1]},rollRad:0,pitchRad:0}],
   ...s.wheels?{wheels:[{robotId:'amr-1',angleRad:[0,0],velocityRadS:[s.speed(t)/(s.radius??0.1),s.speed(t)/(s.radius??0.1)],torqueNm:[0,0],targetRadS:[0,0]}]}:{},
   ...s.drives===false?{}:{drives:AXES.map(axisId=>({axisId,state:s.state?.(t)??'enabled',fault:null,commandSeq:t,positionRad:0,velocityRadS:0,torqueNm:s.torque?.(t)??0,tick:t,targetApplied:0,actualPositionRad:0,actualVelocityRadS:0,saturatedSubsteps:0,followingErrorRad:null}))}} as unknown as PhysicsTickRecord);
 }
 return out;
}
/** 0.8 m/s until tick 100, then a uniform deceleration of 0.5 m/s^2 to rest at tick 180. */
export const decel=(t:number)=>t<=100?0.8:Math.max(0,0.8-0.5*0.02*(t-100));
