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
type Q=[number,number,number,number];
const qmul=(a:Q,b:Q):Q=>[a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
const qrot=(q:Q,v:readonly number[]):[number,number,number]=>{const r=qmul(qmul(q,[v[0]!,v[1]!,v[2]!,0]),[-q[0],-q[1],-q[2],q[3]]);return [r[0],r[1],r[2]];};
/** Map position, at one tick, of the point of the tray that was under the prop at `offset` (the prop's first pose in the support frame): the support frame is the prop's map pose composed with the inverse of its pose in the support. Without map poses (a synthetic stream) it is the base. */
function supportPoint(r:PhysicsTickRecord,propId:string,offset:readonly number[]):[number,number,number]|null{
 const l=r.loads.find(l=>l.propId===propId) as unknown as {poseMap?:{positionM:number[];quaternionXyzw:number[]};poseInSupport?:{positionM:number[];quaternionXyzw:number[]}|null}|undefined,b=r.base?.[0]?.poseMap.positionM;
 if(l?.poseMap&&l.poseInSupport){
  const qc=l.poseMap.quaternionXyzw as Q,qr=l.poseInSupport.quaternionXyzw as Q,qs=qmul(qc,[-qr[0],-qr[1],-qr[2],qr[3]]),rt=qrot(qs,l.poseInSupport.positionM),ts=[l.poseMap.positionM[0]!-rt[0],l.poseMap.positionM[1]!-rt[1],l.poseMap.positionM[2]!-rt[2]],po=qrot(qs,offset);
  return [ts[0]!+po[0],ts[1]!+po[1],ts[2]!+po[2]];
 }
 return b?[b[0]!,b[1]!,b[2]!]:null;
}
/** Horizontal acceleration of the point of the tray under a prop (second difference of its map position over +-`windowTicks`); null where the window leaves the records. */
export function supportPointAccelerationMps2(records:readonly PhysicsTickRecord[],propId:string,tick:number,windowTicks:number):number|null{
 if(!Number.isInteger(windowTicks)||windowTicks<1||tick-windowTicks<0||tick+windowTicks>=records.length)return null;
 const first=records.map(r=>r.loads.find(l=>l.propId===propId)?.poseInSupport?.positionM).find(p=>p),offset=first??[0,0,0];
 const a=supportPoint(records[tick-windowTicks]!,propId,offset),b=supportPoint(records[tick]!,propId,offset),c=supportPoint(records[tick+windowTicks]!,propId,offset);
 if(!a||!b||!c)return null;
 const w=windowTicks*DT_S;return Math.hypot(a[0]-2*b[0]+c[0],a[1]-2*b[1]+c[1])/(w*w);
}
export interface TrayOraclePolicy{accelerationWindowTicks:number;/** acceleration stretches closer together than this many ticks are one episode */episodeGapTicks:number;/** soft friction creeps before the hard bound and never after: the tolerance below the bound is its own, wider, number */accelerationToleranceBelowMps2:number;accelerationToleranceAboveMps2:number;onsetLeadTicks:number;onsetLagTicks:number;slipEpsilonM:number;/** trailing window of the slip reading; 0 = from the first tick */slipWindowTicks:number}
export type SlipVerdict='slip_expected_and_found'|'slip_expected_absent'|'slip_onset_early'|'slip_onset_out_of_tolerance'|'no_slip_expected'|'slip_unexpected'|'inconclusive';
/**
 * Each cup is judged on its own, at the point of the tray under it, episode by episode. An episode is a stretch of ticks (stretches closer than episodeGapTicks are one) with that acceleration above the bound minus the tolerance below it; its peak says what the Coulomb
 * bound claims: above the bound plus the tolerance above it the cup must slip in the episode (from onsetLeadTicks before it to onsetLagTicks after it), within the band nothing is claimed, and a slip that falls in no episode of that cup is not explained by the bound.
 * A slip is a tick where the cup's displacement over the slip window exceeds epsilon. 'no_slip_expected' (no episode, no slip) is a valid result and carries the largest acceleration reached.
 */
export function slipVerdict(records:readonly PhysicsTickRecord[],propIds:readonly string[],mu:number,p:TrayOraclePolicy){
 const bound=coulombSlipBoundMps2(mu),w=p.accelerationWindowTicks,tb=p.accelerationToleranceBelowMps2,ta=p.accelerationToleranceAboveMps2;
 let max:number|null=null;let onset:{tick:number}|null=null;
 let crossed=0,matched=0,band=0,unexplained=0;
 for(const id of propIds){
  const accel=records.map((_,i)=>supportPointAccelerationMps2(records,id,i,w));
  for(const a of accel)if(a!==null)max=Math.max(max??-Infinity,a);
  // episodes of this cup
  const eps:{from:number;to:number;peak:number}[]=[];
  for(let t=0;t<accel.length;t++){const a=accel[t];if(a===null||a<=bound-tb)continue;const last=eps.at(-1);if(last&&t-last.to<=p.episodeGapTicks){last.to=t;last.peak=Math.max(last.peak,a);}else eps.push({from:t,to:t,peak:a});}
  const s=slips(records,id,p.slipWindowTicks),slipping=s.map((v,i)=>v!==null&&v>p.slipEpsilonM?records[i]!.tick:-1).filter(t=>t>=0);
  for(const t of slipping)if(!onset||t<onset.tick)onset={tick:t};
  const within=(t:number,e:{from:number;to:number})=>t>=e.from-p.onsetLeadTicks&&t<=e.to+p.onsetLagTicks;
  for(const e of eps){if(e.peak>bound+ta){crossed++;if(slipping.some(t=>within(t,e)))matched++;}else band++;}
  unexplained+=slipping.filter(t=>!eps.some(e=>within(t,e))).length>0?1:0;
 }
 const out=(verdict:SlipVerdict)=>({verdict,boundMps2:bound,maxAccelerationMps2:max,onset});
 if(max===null)return out('inconclusive');
 if(crossed>matched)return out(unexplained?'slip_onset_out_of_tolerance':'slip_expected_absent');
 if(unexplained)return out(crossed?'slip_onset_early':'slip_unexpected');
 if(crossed)return out('slip_expected_and_found');
 if(band)return out('inconclusive');
 return out('no_slip_expected');
}
