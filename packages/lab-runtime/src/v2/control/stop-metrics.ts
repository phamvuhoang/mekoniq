// R5 stop metrics (contracts 5): what a stop did to the body, read from the durable physics records of the run. Observations in an assumed, not calibrated model; a metric that cannot be computed says why.
import type {PhysicsTickRecord,StopMetricsV1,StopPolicyV1} from '../navigation2d/contracts';
import {maxSlipM} from '../simulation3d/tray-oracle';
import type {StopFunctionId} from './stop-functions';

export type Unavailable={unavailable:'NOT_AT_REST'|'NOT_APPLICABLE'|'STREAM_MISSING'|'TOO_FEW_SAMPLES'|'RUN_ENDED'};
const DT_S=0.02,CUPS=['cup-1','cup-2','cup-3'];
const un=(unavailable:Unavailable['unavailable']):Unavailable=>({unavailable});

/** Body speed per tick from consecutive positions (m/s); tick 0 and ticks with a missing pose are null. Indexed by tick. */
export function bodySpeeds(records:readonly PhysicsTickRecord[]):Map<number,number>{
 const at=new Map(records.map(r=>[r.tick,r.base?.[0]?.poseMap.positionM] as const)),out=new Map<number,number>();
 for(const r of records){const a=at.get(r.tick-1),b=at.get(r.tick);if(a&&b)out.set(r.tick,Math.hypot(b[0]!-a[0]!,b[1]!-a[1]!)/DT_S);}
 return out;
}
/** First tick t >= appliedTick from which `restTicks` consecutive ticks all have a speed below the rest speed; null when none within the observation window. */
export function restTickOf(speeds:ReadonlyMap<number,number>,appliedTick:number,policy:StopPolicyV1):number|null{
 for(let t=appliedTick;t<=appliedTick+policy.observeTicks;t++){
  let ok=true;
  for(let k=0;k<policy.restTicks&&ok;k++){const v=speeds.get(t+k);if(v===undefined||!(v<policy.restSpeedMps))ok=false;}
  if(ok)return t;
 }
 return null;
}
const pos=(by:ReadonlyMap<number,PhysicsTickRecord>,t:number)=>by.get(t)?.base?.[0]?.poseMap.positionM;

export function stopMetrics(input:{appliedTick:number;function:StopFunctionId;records:readonly PhysicsTickRecord[];policy:StopPolicyV1;chainAxes:readonly string[];wheelRadiusM:number}):StopMetricsV1{
 const {appliedTick,policy,records}=input,by=new Map(records.map(r=>[r.tick,r])),speeds=bodySpeeds(records),last=records.length?records[records.length-1]!.tick:0;
 const rest=restTickOf(speeds,appliedTick,policy),atRest=rest!==null?{rest}:null;
 // time and distance exist only for a body that came to rest inside the observation window
 const stopTimeMs=atRest?(atRest.rest-appliedTick)*20:un('NOT_AT_REST');
 let stopDistanceM:number|Unavailable=un('NOT_AT_REST');
 if(atRest){let d=0;for(let t=appliedTick+1;t<=atRest.rest;t++){const a=pos(by,t-1),b=pos(by,t);if(!a||!b){d=Number.NaN;break;}d+=Math.hypot(b[0]!-a[0]!,b[1]!-a[1]!);}stopDistanceM=Number.isNaN(d)?un('TOO_FEW_SAMPLES'):d;}
 // the sharpest deceleration over a trailing window, from the stop to rest (or to the end of the observation window)
 const end=Math.min(atRest?.rest??Number.POSITIVE_INFINITY,appliedTick+policy.observeTicks,last),w=policy.decelWindowTicks;
 let peak:number|Unavailable=un('TOO_FEW_SAMPLES');
 if(end-appliedTick>=w){let best=0;for(let t=appliedTick+w;t<=end;t++){const a=speeds.get(t-w),b=speeds.get(t);if(a===undefined||b===undefined)continue;best=Math.max(best,(a-b)/(w*DT_S));}peak=best;}
 // torque: only an emergency stop promises zero torque, and only the drive stream can say so
 let torqueZeroTick:number|Unavailable;
 if(input.function!=='emergency')torqueZeroTick=un('NOT_APPLICABLE');
 else if(!records.some(r=>r.drives?.length))torqueZeroTick=un('STREAM_MISSING');
 else{
  const zero=(r:PhysicsTickRecord)=>input.chainAxes.every(a=>(r.drives?.find(d=>d.axisId===a)?.torqueNm??1)===0);
  const first=records.find(r=>r.tick>=appliedTick&&zero(r));
  torqueZeroTick=first?first.tick:un('TOO_FEW_SAMPLES');
 }
 // the cups, over the window from the stop to rest plus the rest ticks
 let cupMaxSlipMm:number|Unavailable=un('NOT_APPLICABLE'),cupTipped:boolean|Unavailable=un('NOT_APPLICABLE');
 if(records.some(r=>CUPS.some(id=>r.loads.some(l=>l.propId===id)))){
  if(!atRest){cupMaxSlipMm=un('NOT_AT_REST');cupTipped=un('NOT_AT_REST');}
  else{
   const win=records.filter(r=>r.tick>=appliedTick&&r.tick<=atRest.rest+policy.restTicks);
   cupMaxSlipMm=Math.max(...CUPS.map(id=>win.some(r=>r.loads.some(l=>l.propId===id))?maxSlipM(win,id):0))*1000;
   cupTipped=win.some(r=>r.loads.some(l=>CUPS.includes(l.propId)&&(l.supportId===null||1-2*(l.poseMap.quaternionXyzw[0]!**2+l.poseMap.quaternionXyzw[1]!**2)<policy.cupTiltCosine)));
  }
 }
 // drift after rest
 let postStopDriftMm:number|Unavailable=un('NOT_AT_REST');
 if(atRest){const a=pos(by,atRest.rest),b=pos(by,atRest.rest+policy.driftTicks);postStopDriftMm=!a?un('TOO_FEW_SAMPLES'):!b?un('RUN_ENDED'):Math.hypot(b[0]!-a[0]!,b[1]!-a[1]!)*1000;}
 // a wheel that turns against the body or locks while the body still moves: the wheel's rim speed against the body speed
 let wheelSlip:boolean|Unavailable=un('STREAM_MISSING');
 if(records.some(r=>r.wheels?.length)){
  wheelSlip=false;
  for(let t=appliedTick;t<=Math.min(end,appliedTick+policy.observeTicks);t++){
   const wh=by.get(t)?.wheels?.[0],v=speeds.get(t);if(!wh||v===undefined)continue;
   const rim=(Math.abs(wh.velocityRadS[0]!)+Math.abs(wh.velocityRadS[1]!))/2*input.wheelRadiusM;
   if(Math.abs(rim-v)>policy.slipToleranceMps){wheelSlip=true;break;}
  }
 }
 return {stopTimeMs,stopDistanceM,peakDecelerationMps2:peak,torqueZeroTick,cupMaxSlipMm,cupTipped,postStopDriftMm,wheelSlip};
}
