// R4-B §5: the simulated pose estimator. Truth goes in here and nowhere else in the decision path: the estimate is the truth of `latencyTicks` ago plus the declared bias and noise.
// Every update spends exactly three draws (u0 dropout, then the Box-Muller pair), a dropped or out-of-view one included, so a dropout never shifts the noise of later estimates (contracts §6).
import type {BeliefRecord,PerceptionProfileV1} from '../../../../contracts/generated/navigation2d';
import {actorStream,gaussianPair} from '../random';
export type {PerceptionProfileV1};
export interface TruthSample {tick:number;positionM:[number,number,number];inRegion:boolean}
/** `null` when the tick is not an update tick (or nothing was observable yet); the record otherwise, with the truth that scores it. */
export function createPoseEstimator(profile:PerceptionProfileV1,seed:number,objectId:string,frameId='arm-base'){
 const stream=actorStream(seed,`perception:${objectId}`),[bx,by]=profile.biasM,[sx,sy]=profile.sigmaM;
 // all errors zero and no delay: the belief is the truth, and says so (the comparison point of the study, not a second code path)
 const source=bx===0&&by===0&&sx===0&&sy===0&&profile.latencyTicks===0&&profile.dropoutProbability===0?'ground_truth' as const:'pose_estimator_sim' as const;
 return {update(tick:number,truthAt:(tick:number)=>TruthSample|null):BeliefRecord|null{
  if(tick%profile.updateEveryTicks!==0)return null;
  const observedTick=tick-profile.latencyTicks,truth=observedTick<0?null:truthAt(observedTick);
  if(!truth)return null;
  const u0=stream.next(),[gx,gy]=gaussianPair(stream),at:[number,number,number]=[truth.positionM[0],truth.positionM[1],truth.positionM[2]];
  if(!truth.inRegion)return {tick,objectId,belief:null,dropped:false,reason:'OUT_OF_VIEW',truthAtObservedTick:at,errorM:null};
  if(u0<profile.dropoutProbability)return {tick,objectId,belief:null,dropped:true,reason:'DROPOUT',truthAtObservedTick:at,errorM:null};
  const positionM:[number,number,number]=[at[0]+bx+sx*gx,at[1]+by+sy*gy,at[2]]; // z is the declared support height (R4-D24)
  return {tick,objectId,belief:{objectId,kind:'cup',frameId,positionM,sigmaM:[sx,sy,0],observedTick,publishedTick:tick,ageTicks:0,source,valid:true},dropped:false,
   truthAtObservedTick:at,errorM:Math.hypot(positionM[0]-at[0],positionM[1]-at[1],positionM[2]-at[2])};
 }};
}
