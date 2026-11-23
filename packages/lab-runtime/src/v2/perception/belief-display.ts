/** Cursor rule shared by Source's WEB09 reader and the Lab handoff. Policy and
 * coverage are established before this lookup; missing legacy metadata is unavailable. */
import type {PerceptionReportV1} from './perception-report';
export function displayedBeliefAt(e:PerceptionReportV1|undefined,objectId:string,tick:number){
 const p=e?.policy,c=e?.coverage;
 if(!e||!Array.isArray(e.issues)||e.issues.length||!p||p.ageBasis!=='publishedTick'||!Number.isSafeInteger(p.profile.maxAgeTicks)||p.profile.maxAgeTicks<0||!c||c.scope!=='belief_evaluations'||c.prefixCovered!==true||c.firstTick!==0||!Number.isSafeInteger(c.lastTick)||c.lastTick<0||!Number.isSafeInteger(tick)||tick<c.firstTick||tick>c.lastTick)return null;
 for(let i=e.beliefs.length-1;i>=0;i--){
  const r=e.beliefs[i]!;if(r.objectId!==objectId||r.tick>tick)continue;
  if(r.belief){const b=r.belief;return b.valid&&b.objectId===objectId&&b.publishedTick===r.tick&&b.observedTick<=b.publishedTick&&b.publishedTick<=tick&&b.positionM.length===3&&b.positionM.every(Number.isFinite)&&tick-b.publishedTick<=p.profile.maxAgeTicks?{...b,ageTicks:tick-b.publishedTick}:null;}
  if(!r.dropped||r.reason!=='DROPOUT')return null;
 }
 return null;
}
