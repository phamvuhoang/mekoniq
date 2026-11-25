// Control metrics (R4-A contracts §5) computed from the per-tick drive records of an evidence stream the reader has already verified. They are computed on the TRUE state
// (`actual*`, basis 'actual'); a missing tick is never skipped over: the metric is then unavailable with its reason.
import type {DriveAxisSnapshot} from './drive-io';
export type ControlMetric=
 |{available:true;value:number;unit:string;samples:number;basis:'actual'|'feedback'}
 |{available:false;value:null;unit:string;reason:string};
export interface DriveRecord {tick:number;drives:readonly DriveAxisSnapshot[]}
const no=(unit:string,reason:string):ControlMetric=>({available:false,value:null,unit,reason});
const yes=(value:number,unit:string,samples:number):ControlMetric=>({available:true,value,unit,samples,basis:'actual'});
const axisAt=(records:readonly DriveRecord[],axisId:string)=>{const by=new Map<number,DriveAxisSnapshot>();for(const r of records){const a=r.drives.find(d=>d.axisId===axisId);if(a)by.set(r.tick,a);}return by;};

/** sqrt(mean((r - y)^2)) over [fromTick, toTick]: r the command applied, y the true state in the unit of the mode (position, rad, for csp; speed, rad/s, for csv). A tick without the axis is TRACE_GAP. */
export function trackingRms(records:readonly DriveRecord[],axisId:string,window:{fromTick:number;toTick:number},mode:'csp'|'csv'='csp'):ControlMetric{
 const unit=mode==='csp'?'rad':'rad/s';
 if(!(window.toTick>=window.fromTick)||!Number.isInteger(window.fromTick)||!Number.isInteger(window.toTick))return no(unit,'WINDOW_INVALID');
 const by=axisAt(records,axisId);let sum=0,n=0;
 for(let t=window.fromTick;t<=window.toTick;t++){
  const a=by.get(t);if(!a)return no(unit,'TRACE_GAP');
  const e=a.targetApplied-(mode==='csp'?a.actualPositionRad:a.actualVelocityRadS);if(!Number.isFinite(e))return no(unit,'TRACE_GAP');
  sum+=e*e;n++;
 }
 return yes(Math.sqrt(sum/n),unit,n);
}

/** The mean of |r| - |y| over the cruise of constant commands: runs of at least `minCruiseTicks` ticks whose applied command does not change (and is not at rest), taking each run after its first half
 *  (the end of the acceleration is inside the first half). No such run: NO_CRUISE_WINDOW. A gap inside the records: TRACE_GAP. For a speed (csv) axis; unit rad/s. */
export function speedDeficit(records:readonly DriveRecord[],axisId:string,policy:{minCruiseTicks:number}):ControlMetric{
 const unit='rad/s',by=axisAt(records,axisId),ticks=[...by.keys()].sort((a,b)=>a-b);
 if(!ticks.length)return no(unit,'TRACE_GAP');
 for(let i=1;i<ticks.length;i++)if(ticks[i]!==ticks[i-1]!+1)return no(unit,'TRACE_GAP');
 if(!(policy.minCruiseTicks>=2)||!Number.isInteger(policy.minCruiseTicks))return no(unit,'POLICY_INVALID');
 let sum=0,n=0,start=0;
 const close=(from:number,to:number)=>{   // ticks[from..to] inclusive: one run of one command
  if(to-from+1<policy.minCruiseTicks||Math.abs(by.get(ticks[from]!)!.targetApplied)<0.05)return;
  for(let k=from+Math.floor((to-from+1)/2);k<=to;k++){const a=by.get(ticks[k]!)!;sum+=Math.abs(a.targetApplied)-Math.abs(a.actualVelocityRadS);n++;}
 };
 for(let i=1;i<=ticks.length;i++){if(i===ticks.length||by.get(ticks[i]!)!.targetApplied!==by.get(ticks[start]!)!.targetApplied){close(start,i-1);start=i;}}
 return n?yes(sum/n,unit,n):no(unit,'NO_CRUISE_WINDOW');
}
