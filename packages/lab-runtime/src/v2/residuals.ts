// Prediction vs actual (DT-05): align two series under a versioned profile, then residuals in canonical SI. Pure and read-only:
// no calibration fitting, no controller writes. Without calibration or timestamp alignment the result is unavailable, never 0.
export type ResidualQuantity='translation'|'orientation'|'cycle'|'volume'|'mass';
/** Input unit per quantity (orientation is a normalized [x,y,z,w] quaternion) and the residual's unit. Anything else is a unit error. */
const INPUT={translation:['m',3],orientation:['quaternion_xyzw',4],cycle:['s',1],volume:['m3',1],mass:['kg',1]} as const;
export const RESIDUAL_UNITS:Record<ResidualQuantity,string>={translation:'m',orientation:'rad',cycle:'s',volume:'m3',mass:'kg'};
const SPATIAL=new Set<ResidualQuantity>(['translation','orientation']);
export interface SeriesSample {entityId:string;quantity:ResidualQuantity;unit:string;frameId:string|null;timeNs:string|null;quality:'valid'|'stale'|'unknown'|'invalid';value:readonly number[];
 /** Discrete samples (cycle/quantity) with a key (e.g. jobId/stepId) match by key, not by timestamp. */
 key?:string}
export interface AlignmentProfile {id:string;revision:number;frameId:string;
 /** observer clock minus prediction clock; null = timestamps not aligned */
 clockOffsetNs:string|null;maxSkewNs:string;maxGapNs:string;
 calibration:{id:string;revision:number;datasetIds:readonly string[]}|null;driftThreshold:Partial<Record<ResidualQuantity,number>>}
export interface AlignedPair {entityId:string;quantity:ResidualQuantity;timeNs:string;predicted:number[];observed:number[];skewNs:string;interpolated:boolean}
export interface Excluded {entityId:string;quantity:string;timeNs:string|null;reason:string}
export type Aligned={available:false;reason:string}|{available:true;profile:{id:string;revision:number};pairs:AlignedPair[];excluded:Excluded[];coverage:{observed:number;aligned:number;ratio:number};maxSkewNs:string};
export type Residuals={available:false;reason:string}|{available:true;profile:{id:string;revision:number};quantities:{quantity:ResidualQuantity;unit:string;count:number;mean:number;meanAbs:number;rms:number;maxAbs:number}[];coverage:{observed:number;aligned:number;ratio:number};maxSkewNs:string;excluded:Record<string,number>};
const abs=(n:bigint)=>n<0n?-n:n,big=(s:string)=>/^-?\d{1,20}$/.test(s)?BigInt(s):null;
/** Why a sample cannot be used, or null. Predicted samples go through the same checks. */
function invalid(s:SeriesSample,profile:AlignmentProfile):string|null{
 const spec=INPUT[s.quantity];
 if(!spec)return 'VALUE_INVALID';
 if(s.quality!=='valid')return 'QUALITY_NOT_VALID';
 if(s.timeNs===null||big(s.timeNs)===null)return 'TIMESTAMP_MISSING';
 if(s.unit!==spec[0])return 'UNIT_MISMATCH';
 if(s.value.length!==spec[1]||!s.value.every(Number.isFinite))return 'VALUE_INVALID';
 if(s.quantity==='orientation'&&Math.abs(Math.hypot(...s.value)-1)>1e-6)return 'VALUE_INVALID';
 if(SPATIAL.has(s.quantity)){if(!s.frameId)return 'FRAME_MISSING';if(s.frameId!==profile.frameId)return 'FRAME_MISMATCH';}
 return null;
}
const lerp=(a:readonly number[],b:readonly number[],f:number)=>a.map((x,i)=>x+(b[i]!-x)*f);
function interpolate(q:ResidualQuantity,a:readonly number[],b:readonly number[],f:number){
 if(q!=='orientation')return lerp(a,b,f);
 const sign=a.reduce((n,x,i)=>n+x*b[i]!,0)<0?-1:1,v=lerp(a,b.map(x=>x*sign),f),n=Math.hypot(...v);return v.map(x=>x/n); // nlerp on the short arc
}
export function alignObservations(predicted:readonly SeriesSample[],observed:readonly SeriesSample[],profile:AlignmentProfile|null):Aligned{
 if(!profile||profile.clockOffsetNs===null||big(profile.clockOffsetNs)===null)return {available:false,reason:'ALIGNMENT_MISSING'};
 if(!profile.calibration)return {available:false,reason:'CALIBRATION_MISSING'};
 const offset=BigInt(profile.clockOffsetNs),maxSkew=BigInt(profile.maxSkewNs),maxGap=BigInt(profile.maxGapNs);
 const series=new Map<string,{t:bigint;s:SeriesSample}[]>(),rejected=new Map<string,{s:SeriesSample;reason:string}[]>();
 for(const s of predicted){const k=`${s.entityId}\u0000${s.quantity}`,reason=invalid(s,profile);if(reason){const bad=rejected.get(k)??[];bad.push({s,reason});rejected.set(k,bad);continue;}const l=series.get(k)??[];l.push({t:BigInt(s.timeNs!),s});series.set(k,l);}
 for(const l of series.values())l.sort((a,b)=>a.t<b.t?-1:a.t>b.t?1:0);
 const time=(s:SeriesSample)=>s.timeNs!==null&&big(s.timeNs)!==null?BigInt(s.timeNs):null;
 const order=[...observed].sort((a,b)=>{const x=time(a)??-1n,y=time(b)??-1n;return x<y?-1:x>y?1:0;});
 const pairs:AlignedPair[]=[],excluded:Excluded[]=[],seen=new Set<string>();let maxSkewSeen=0n;
 for(const o of order){
  const out=(reason:string)=>excluded.push({entityId:o.entityId,quantity:o.quantity,timeNs:o.timeNs,reason});
  const bad=invalid(o,profile);if(bad){out(bad);continue;}
  const id=`${o.entityId}\u0000${o.quantity}\u0000${o.key??''}\u0000${o.timeNs}`;if(seen.has(id)){out('DUPLICATE');continue;}seen.add(id);
  const t=BigInt(o.timeNs!)-offset,list=series.get(`${o.entityId}\u0000${o.quantity}`)??[];
  // Report the invalid matching prediction's cause; do not mislabel a unit/frame error as an absent dataset.
  const missingReason=()=>rejected.get(`${o.entityId}\u0000${o.quantity}`)?.find(({s})=>o.key!==undefined?s.key===o.key:s.timeNs!==null&&big(s.timeNs)!==null&&abs(BigInt(s.timeNs)-t)<=maxSkew)?.reason??'NO_PREDICTION';
  if(!SPATIAL.has(o.quantity)){
   // discrete: same key, else the nearest prediction within the skew bound; never interpolated
   const m=o.key!==undefined?list.find(p=>p.s.key===o.key):list.filter(p=>abs(p.t-t)<=maxSkew).sort((a,b)=>abs(a.t-t)<abs(b.t-t)?-1:1)[0];
   if(!m){out(missingReason());continue;}
   const skew=o.key!==undefined?0n:abs(m.t-t);if(skew>maxSkewSeen)maxSkewSeen=skew;
   pairs.push({entityId:o.entityId,quantity:o.quantity,timeNs:String(t),predicted:[...m.s.value],observed:[...o.value],skewNs:String(skew),interpolated:false});continue;
  }
  const i=list.findIndex(p=>p.t>=t);
  const after=i>=0?list[i]!:undefined,before=i<0?list[list.length-1]:i>0?list[i-1]:undefined;
  let predictedValue:number[]|null=null,skew=0n,interpolated=false;
  if(after&&after.t===t)predictedValue=[...after.s.value];
  else if(before&&after){
   if(after.t-before.t<=maxGap){predictedValue=interpolate(o.quantity,before.s.value,after.s.value,Number(t-before.t)/Number(after.t-before.t));skew=t-before.t<after.t-t?t-before.t:after.t-t;interpolated=true;}
   else{const near=t-before.t<after.t-t?before:after;if(abs(near.t-t)<=maxSkew){predictedValue=[...near.s.value];skew=abs(near.t-t);}else{out('GAP_EXCEEDS_PROFILE');continue;}}
  }else{const near=before??after;if(near&&abs(near.t-t)<=maxSkew){predictedValue=[...near.s.value];skew=abs(near.t-t);}}
  if(!predictedValue){out(missingReason());continue;}
  if(skew>maxSkewSeen)maxSkewSeen=skew;
  pairs.push({entityId:o.entityId,quantity:o.quantity,timeNs:String(t),predicted:predictedValue,observed:[...o.value],skewNs:String(skew),interpolated});
 }
 const n=observed.length;
 return {available:true,profile:{id:profile.id,revision:profile.revision},pairs,excluded,coverage:{observed:n,aligned:pairs.length,ratio:n?pairs.length/n:0},maxSkewNs:String(maxSkewSeen)};
}
/** translation: Euclidean distance (m); orientation: quaternion geodesic angle (rad); cycle/volume/mass: signed observed - predicted. */
function residual(p:AlignedPair){
 if(p.quantity==='translation')return Math.hypot(...p.observed.map((x,i)=>x-p.predicted[i]!));
 if(p.quantity==='orientation')return 2*Math.acos(Math.min(1,Math.abs(p.observed.reduce((n,x,i)=>n+x*p.predicted[i]!,0))));
 return p.observed[0]!-p.predicted[0]!;
}
export function computeResiduals(aligned:Aligned):Residuals{
 if(!aligned.available)return {available:false,reason:aligned.reason};
 if(!aligned.pairs.length)return {available:false,reason:'NO_VALID_SAMPLES'};
 const by=new Map<ResidualQuantity,number[]>();for(const p of aligned.pairs)by.set(p.quantity,[...by.get(p.quantity)??[],residual(p)]);
 const excluded:Record<string,number>={};for(const e of aligned.excluded)excluded[e.reason]=(excluded[e.reason]??0)+1;
 return {available:true,profile:aligned.profile,coverage:aligned.coverage,maxSkewNs:aligned.maxSkewNs,excluded,
  quantities:[...by].map(([quantity,r])=>({quantity,unit:RESIDUAL_UNITS[quantity],count:r.length,mean:r.reduce((a,b)=>a+b,0)/r.length,meanAbs:r.reduce((a,b)=>a+Math.abs(b),0)/r.length,rms:Math.sqrt(r.reduce((a,b)=>a+b*b,0)/r.length),maxAbs:Math.max(...r.map(Math.abs))}))};
}
/** A model is never validated on the data it was calibrated on: the held-out set must be non-empty and disjoint. */
export function validateDatasets(calibrationIds:readonly string[],validationIds:readonly string[]){
 const cal=new Set(calibrationIds),overlap=[...new Set(validationIds)].filter(id=>cal.has(id));
 const reasonCodes=!cal.size?['CALIBRATION_SET_EMPTY']:!validationIds.length?['VALIDATION_SET_EMPTY']:overlap.length?['DATASET_OVERLAP']:[];
 return {ok:!reasonCodes.length,reasonCodes,overlap};
}
/** Drift beyond the profile threshold produces a recommendation and marks evidence no longer fitting; it changes no parameter anywhere. */
export function assessDrift(r:Residuals,profile:AlignmentProfile,evidenceIds:readonly string[]){
 const controllerWrites:readonly never[]=[];
 if(!r.available)return {status:'unavailable' as const,reason:r.reason,exceeded:[],recommendation:null,invalidatedEvidence:[] as string[],controllerWrites};
 const exceeded=r.quantities.flatMap(q=>{const threshold=profile.driftThreshold[q.quantity];return threshold!==undefined&&q.rms>threshold?[{quantity:q.quantity,unit:q.unit,rms:q.rms,threshold}]:[];});
 return exceeded.length
  ?{status:'drift' as const,exceeded,recommendation:`Residual beyond profile ${profile.id} r${profile.revision} (${exceeded.map(e=>`${e.quantity} rms ${e.rms.toPrecision(3)} ${e.unit} > ${e.threshold}`).join('; ')}): review and recalibrate the model on a new calibration set, then re-validate on held-out data.`,invalidatedEvidence:[...evidenceIds],controllerWrites}
  :{status:'within' as const,exceeded,recommendation:null,invalidatedEvidence:[] as string[],controllerWrites};
}
