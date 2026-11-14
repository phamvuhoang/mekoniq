import type {LoadObservation} from '../navigation2d/contracts';
import {composePose} from '../frames';
import {yawOf} from '../../engineering/navigation-model';
import type {PhysicsAdmission,PhysicsRead} from './physics-evidence';
export type PhysicsMetric={available:true;value:number;unit:string;samples:number}|{available:false;value:null;unit:string;reason:string};
const no=(unit:string,reason:string):PhysicsMetric=>({available:false,value:null,unit,reason});
const yes=(value:number,unit:string,samples:number):PhysicsMetric=>Number.isFinite(value)?{available:true,value,unit,samples}:no(unit,'METRIC_OVERFLOW');
export function integrateNormalImpulse(forcesN:readonly number[],dtS:number):number{
 if(!Number.isFinite(dtS)||dtS<=0)throw new Error('CONTACT_TIMESTEP_INVALID');
 let sum=0;for(const f of forcesN){if(!Number.isFinite(f)||f<0)throw new Error('CONTACT_FORCE_INVALID');sum+=f*dtS;if(!Number.isFinite(sum))throw new Error('CONTACT_IMPULSE_OVERFLOW');}return sum;
}
/** Declared support is a coordinate reference, never a receipt or proof of contact. */
export function loadDisplacementM(samples:readonly LoadObservation[]):PhysicsMetric{
 const a=samples[0];if(!a)return no('m','LOAD_SERIES_MISSING');
 if(!a.supportId||samples.some(x=>x.propId!==a.propId||x.supportId!==a.supportId||!x.poseInSupport||!x.poseInSupport.positionM.every(Number.isFinite)))return no('m','LOAD_REFERENCE_INVALID');
 const p=a.poseInSupport!.positionM;return yes(Math.max(...samples.map(s=>Math.hypot(s.poseInSupport!.positionM[0]!-p[0]!,s.poseInSupport!.positionM[1]!-p[1]!))),'m',samples.length);
}
export const rollPitch=(q:readonly number[])=>{const [x,y,z,w]=q as [number,number,number,number];return [Math.atan2(2*(w*x+y*z),1-2*(x*x+y*y)),Math.asin(Math.max(-1,Math.min(1,2*(w*y-z*x))))] as const;};
export interface PhysicsMetrics {loadDisplacementM:PhysicsMetric;maxTiltRad:PhysicsMetric;tiltExceededDurationS:PhysicsMetric;wheelPositionResidualM:PhysicsMetric;wheelYawResidualRad:PhysicsMetric;contactPeakN:PhysicsMetric;contactImpulseNs:PhysicsMetric;stopDistanceM:PhysicsMetric}
export interface PhysicsNavigationWindow {complete:boolean;trajectory:import('../navigation2d/evidence').TrajectoryRecord[];control:import('../navigation2d/evidence').ControlRecord[];policy:{stoppedLinearMps:number;stoppedAngularRadps:number;arrivalHoldTicks:number}}
function stopDistance(read:PhysicsRead,a:PhysicsAdmission,nav?:PhysicsNavigationWindow):PhysicsMetric{
 if(!nav?.complete)return no('m','VERIFIED_STOP_WINDOW_MISSING');
 const p=nav.policy;if(![p.stoppedLinearMps,p.stoppedAngularRadps].every(x=>Number.isFinite(x)&&x>=0)||!Number.isSafeInteger(p.arrivalHoldTicks)||p.arrivalHoldTicks<1)return no('m','STOP_POLICY_INVALID');
 if(nav.trajectory.length!==read.records.length||nav.trajectory.some((t,i)=>t.tick!==read.records[i]!.tick||t.simTimeNs!==read.records[i]!.simTimeNs))return no('m','STOP_SERIES_JOIN_INVALID');
 const at=new Map(nav.trajectory.map(t=>[t.tick,t.robots.find(r=>r.robotId===a.robotId)]));
 const stopped=(r:NonNullable<ReturnType<typeof at.get>>)=>Math.abs(r.bodyVelocity[0])<=p.stoppedLinearMps&&Math.abs(r.bodyVelocity[1])<=p.stoppedAngularRadps;
 let active=false,distance=0,hold=0,max=0,windows=0,samples=0;
 for(const c of nav.control){const command=c.velocities.find(v=>v.robotId===a.robotId),prev=at.get(c.tick),next=at.get(c.targetTick);if(!command||!prev||!next||c.targetTick!==c.tick+1)return no('m','STOP_SERIES_JOIN_INVALID');
  const zero=command.vMps===0&&command.omegaRadps===0;
  if(!active&&zero&&!stopped(prev)){active=true;distance=0;hold=0;}
  if(!active)continue;if(!zero)return no('m','STOP_TARGET_WITHDRAWN');
  distance+=Math.hypot(next.poseDriveMap[0]-prev.poseDriveMap[0],next.poseDriveMap[1]-prev.poseDriveMap[1]);samples++;
  hold=stopped(next)?hold+1:0;if(hold>=p.arrivalHoldTicks){max=Math.max(max,distance);windows++;active=false;}
 }
 return active?no('m','STOP_NOT_OBSERVED'):windows?yes(max,'m',samples):no('m','STOP_WINDOW_MISSING');
}
export function physicsMetrics(read:PhysicsRead,admission:PhysicsAdmission,navigation?:PhysicsNavigationWindow):PhysicsMetrics{
 const reason=!read.complete?'PHYSICS_COVERAGE_INCOMPLETE':'PHYSICS_SERIES_MISSING',empty={loadDisplacementM:no('m',reason),maxTiltRad:no('rad',reason),tiltExceededDurationS:no('s',reason),wheelPositionResidualM:no('m',reason),wheelYawResidualRad:no('rad',reason),contactPeakN:no('N',reason),contactImpulseNs:no('N s',reason),stopDistanceM:no('m','VERIFIED_STOP_WINDOW_MISSING')};
 if(!read.complete||!read.records.length)return {...empty,stopDistanceM:no('m',reason)};
 const rs=read.records,n=rs.length;let tilt=0,tiltTicks=0,position=0,yaw=0,peak=0,impulse=0,contacts=0;
 for(const r of rs){const b=r.base[0]!,o=r.odometry[0]!,actual=composePose({position:b.poseMap.positionM,quaternionXyzw:b.poseMap.quaternionXyzw},{position:admission.driveFrameInBase.xyzM,quaternionXyzw:admission.driveFrameInBase.quaternionXyzw});
  const currentTilt=Math.max(...rollPitch(b.poseMap.quaternionXyzw).map(Math.abs));tilt=Math.max(tilt,currentTilt);if(r.tick>0&&admission.maxAbsRollPitchRad!==undefined&&currentTilt>admission.maxAbsRollPitchRad)tiltTicks++;position=Math.max(position,Math.hypot(actual.position[0]!-o.poseDriveMap[0]!,actual.position[1]!-o.poseDriveMap[1]!));const dy=yawOf(actual.quaternionXyzw)-o.poseDriveMap[2]!;yaw=Math.max(yaw,Math.abs(Math.atan2(Math.sin(dy),Math.cos(dy))));
  // Tick zero contains the producer's real priming interval, outside logical (0,T].
  for(const c of r.tick>0?r.contacts:[]){contacts++;peak=Math.max(peak,c.peakNormalN);impulse+=c.normalImpulseNs;}
 }
 // B03 mobile has one transported load; multiple loads require explicit windows in the later world workflow.
 return {...empty,stopDistanceM:stopDistance(read,admission,navigation),loadDisplacementM:admission.props.length===1?loadDisplacementM(rs.map(r=>r.loads[0]!)):no('m','LOAD_WINDOW_REQUIRED'),maxTiltRad:yes(tilt,'rad',n),tiltExceededDurationS:n<2?no('s','LOGICAL_INTERVAL_MISSING'):Number.isFinite(admission.maxAbsRollPitchRad)?yes(tiltTicks*admission.tickMs/1000,'s',n-1):no('s','TILT_POLICY_MISSING'),wheelPositionResidualM:yes(position,'m',n),wheelYawResidualRad:yes(yaw,'rad',n),contactPeakN:n>1?yes(peak,'N',contacts):no('N','LOGICAL_INTERVAL_MISSING'),contactImpulseNs:n>1?yes(impulse,'N s',contacts):no('N s','LOGICAL_INTERVAL_MISSING')};
}
