// R4-B §5.1: the belief world keeps the newest estimate of each object. `apply` takes the scoring record (it carries the truth); `view()` is all the decision code gets, and it has no truth in it (R4-D21).
import type {BeliefObject,BeliefRecord} from '../../../../contracts/generated/navigation2d';
export type {BeliefObject};
export type BeliefReason='BELIEF_UNAVAILABLE'|'BELIEF_STALE';
export interface BeliefView {get(objectId:string,tick:number):{status:'ok';belief:BeliefObject}|{status:'unavailable'|'stale';reason:BeliefReason}}
export function createBeliefWorld(maxAgeTicks:number):{apply(record:BeliefRecord):void;view():BeliefView}{
 const latest=new Map<string,BeliefObject>();
 return {
  // a dropped or out-of-view update carries no belief: the older estimate stays and ages
  apply(r){if(r.belief)latest.set(r.objectId,structuredClone(r.belief));},
  view:()=>({get(objectId,tick){
   const b=latest.get(objectId);
   if(!b||!b.valid)return {status:'unavailable',reason:'BELIEF_UNAVAILABLE'};
   const ageTicks=tick-b.publishedTick;
   return ageTicks>maxAgeTicks?{status:'stale',reason:'BELIEF_STALE'}:{status:'ok',belief:{...structuredClone(b),ageTicks}};
  }})};
}
