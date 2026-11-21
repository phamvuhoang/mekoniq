/** The independent analytic oracle of R4-A 7.4: a cup on a plane starts to slip when the plane's acceleration exceeds mu*g. Pure functions of verified physics records; no engine call. */
import type {PhysicsTickRecord} from '../navigation2d/contracts';
const DT_S=0.02;
export const coulombSlipBoundMps2=(mu:number,gravityMps2=9.81)=>{if(!Number.isFinite(mu)||mu<=0||!Number.isFinite(gravityMps2)||gravityMps2<=0)throw new Error('FRICTION_INVALID');return mu*gravityMps2;};
const offsetOf=(r:PhysicsTickRecord,propId:string):[number,number]|null|undefined=>{const l=r.loads.find(l=>l.propId===propId);if(!l)return undefined;const p=l.poseInSupport?.positionM;return p?[p[0],p[1]]:null;};
const known=(records:readonly PhysicsTickRecord[],propId:string)=>{if(!records.length)throw new Error('RECORDS_EMPTY');if(records.every(r=>offsetOf(r,propId)===undefined))throw new Error('PROP_UNKNOWN');};
/** Planar displacement of the prop in the support frame, per tick (null where the plant gave no support pose): from where it first stood, or, with `windowTicks`, from where it stood that many ticks earlier
 * (from the first observed tick during the first window). MuJoCo's friction is soft, so a cup creeps a little even far inside the friction cone; a trailing window is the reading a creep stays under and a slide does not. */
const slips=(records:readonly PhysicsTickRecord[],propId:string,windowTicks=0)=>{
 known(records,propId);const at=records.map(r=>offsetOf(r,propId)??null),first=at.find(o=>o)??null;
 return at.map((o,i)=>{const ref=windowTicks>0?at[Math.max(0,i-windowTicks)]??null:first;return o&&ref?Math.hypot(o[0]-ref[0],o[1]-ref[1]):null;});
};
/** First tick whose displacement exceeds `epsilonM`; null when the cup never left it. */
export const slipOnset=(records:readonly PhysicsTickRecord[],propId:string,epsilonM:number,windowTicks=0):{tick:number}|null=>{const s=slips(records,propId,windowTicks);const i=s.findIndex(v=>v!==null&&v>epsilonM);return i<0?null:{tick:records[i]!.tick};};
export const maxSlipM=(records:readonly PhysicsTickRecord[],propId:string,windowTicks=0)=>Math.max(0,...slips(records,propId,windowTicks).filter((v):v is number=>v!==null));
/** Horizontal acceleration of the tray's base as the second difference of its map position over +-`windowTicks`; null where the window leaves the records. */
export function supportAccelerationMps2(records:readonly PhysicsTickRecord[],tick:number,windowTicks:number):number|null{
 const at=(t:number)=>records[t]?.base?.[0]?.poseMap.positionM,a=at(tick-windowTicks),b=at(tick),c=at(tick+windowTicks);
 if(!Number.isInteger(windowTicks)||windowTicks<1||tick-windowTicks<0||!a||!b||!c)return null;
 const w=windowTicks*DT_S;return Math.hypot(a[0]-2*b[0]+c[0],a[1]-2*b[1]+c[1])/(w*w);
}
export const firstExceedTick=(records:readonly PhysicsTickRecord[],boundMps2:number,toleranceMps2:number,windowTicks:number)=>{
 for(let t=0;t<records.length;t++){const a=supportAccelerationMps2(records,t,windowTicks);if(a!==null&&a>boundMps2+toleranceMps2)return t;}
 return null;
};
export interface TrayOraclePolicy{accelerationWindowTicks:number;/** soft friction creeps before the hard bound and never after: the tolerance below the bound is its own, wider, number */accelerationToleranceBelowMps2:number;accelerationToleranceAboveMps2:number;onsetLeadTicks:number;onsetLagTicks:number;slipEpsilonM:number;/** trailing window of the slip reading; 0 = from the first tick */slipWindowTicks:number}
export type SlipVerdict='slip_expected_and_found'|'slip_expected_absent'|'slip_onset_early'|'slip_onset_out_of_tolerance'|'no_slip_expected'|'slip_unexpected'|'inconclusive';
/**
 * If the measured acceleration of the tray exceeds the Coulomb bound by more than the declared tolerance, a slip onset must exist, between where the acceleration entered the tolerance band under the bound and a little after it left the band above it;
 * if it stays below the bound by more than the tolerance, none may exist. Inside the band, or when no tick has a full window, nothing is claimed (inconclusive).
 * 'no_slip_expected' is a valid result and carries the largest acceleration the run reached.
 */
export function slipVerdict(records:readonly PhysicsTickRecord[],propIds:readonly string[],mu:number,p:TrayOraclePolicy){
 const bound=coulombSlipBoundMps2(mu),w=p.accelerationWindowTicks,tb=p.accelerationToleranceBelowMps2,ta=p.accelerationToleranceAboveMps2;
 const accel=records.map((_,i)=>supportAccelerationMps2(records,i,w)).filter((a):a is number=>a!==null),max=accel.length?Math.max(...accel):null;
 const onsets=propIds.map(id=>slipOnset(records,id,p.slipEpsilonM,p.slipWindowTicks)).filter((o):o is {tick:number}=>!!o),onset=onsets.length?{tick:Math.min(...onsets.map(o=>o.tick))}:null;
 const out=(verdict:SlipVerdict)=>({verdict,boundMps2:bound,maxAccelerationMps2:max,onset});
 if(max===null)return out('inconclusive');
 if(max>bound+ta){
  if(!onset)return out('slip_expected_absent');
  // the bound is crossed over some ticks and friction is soft: a slip may begin from where the acceleration enters the band under the bound (-tolerance) to a little after it has left the band above it (+tolerance)
  const entry=firstExceedTick(records,bound,-tb,w)!,exceed=firstExceedTick(records,bound,ta,w)!;
  return out(onset.tick<entry-p.onsetLeadTicks?'slip_onset_early':onset.tick>exceed+p.onsetLagTicks?'slip_onset_out_of_tolerance':'slip_expected_and_found');
 }
 if(max<bound-tb)return out(onset?'slip_unexpected':'no_slip_expected');
 return out('inconclusive');
}
