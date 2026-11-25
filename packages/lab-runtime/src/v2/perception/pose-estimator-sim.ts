// R4-B §5: the simulated pose estimator. The x/y estimate is the truth of
// `latencyTicks` ago plus declared bias/noise; z comes only from declared geometry.
// Every update spends exactly three draws (u0 dropout, then the Box-Muller pair), a dropped or out-of-view one included, so a dropout never shifts the noise of later estimates (contracts §6).
import type {BeliefRecord,PerceptionProfileV1} from '../../../../contracts/generated/navigation2d';
import {actorStream,gaussianPair} from '../random';
import {checkQuaternion,composePose,invertPose,qrotate,type Pose} from '../frames';
export type {PerceptionProfileV1};
export interface TruthSample {tick:number;positionM:[number,number,number];inRegion:boolean}
/** The admitted support center is already in map coordinates; its box axes follow
 * baseInMap (the native compiler's convention). R4 models an upright cylinder. */
export interface CupSupportGeometry {baseInMap:Pose;support:{centerM:readonly number[];sizeM:readonly number[]};cupHeightM:number}
export function declaredCupCentreHeightM(g:CupSupportGeometry):number{
 const vector=(v:unknown):v is number[]=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
 if(!g||!vector(g.baseInMap?.position)||!vector(g.support?.centerM)||!vector(g.support?.sizeM)||!g.support.sizeM.every(v=>v>0)||!Number.isFinite(g.cupHeightM)||g.cupHeightM<=0)throw Error('BELIEF_SUPPORT_GEOMETRY_INVALID');
 if(!Array.isArray(g.baseInMap.quaternionXyzw))throw Error('BELIEF_SUPPORT_GEOMETRY_INVALID');
 const q=checkQuaternion(g.baseInMap.quaternionXyzw),up=qrotate(q,[0,0,1]);
 if(Math.abs(up[0]!)>1e-8||Math.abs(up[1]!)>1e-8||Math.abs(up[2]!-1)>1e-8)throw Error('BELIEF_SUPPORT_NOT_UPRIGHT');
 const c=g.support.centerM,center=[c[0]!,c[1]!,c[2]!+g.support.sizeM[2]!/2+g.cupHeightM/2];
 const z=composePose(invertPose(g.baseInMap),{position:center,quaternionXyzw:[0,0,0,1]}).position[2]!;
 if(!Number.isFinite(z))throw Error('BELIEF_SUPPORT_GEOMETRY_INVALID');return z;
}
/** `null` when the tick is not an update tick (or nothing was observable yet); the record otherwise, with the truth that scores it. */
export function createPoseEstimator(profile:PerceptionProfileV1,seed:number,objectId:string,geometry:CupSupportGeometry,frameId='arm-base'){
 const centerZ=declaredCupCentreHeightM(geometry),stream=actorStream(seed,`perception:${objectId}`),[bx,by]=profile.biasM,[sx,sy]=profile.sigmaM;
 // all errors zero and no delay: exact x/y (the 2D comparison point, not a z-truth bypass)
 const source=bx===0&&by===0&&sx===0&&sy===0&&profile.latencyTicks===0&&profile.dropoutProbability===0?'ground_truth' as const:'pose_estimator_sim' as const;
 return {update(tick:number,truthAt:(tick:number)=>TruthSample|null):BeliefRecord|null{
  if(tick%profile.updateEveryTicks!==0)return null;
  const observedTick=tick-profile.latencyTicks,truth=observedTick<0?null:truthAt(observedTick);
  if(!truth)return null;
  const u0=stream.next(),[gx,gy]=gaussianPair(stream),at:[number,number,number]=[truth.positionM[0],truth.positionM[1],truth.positionM[2]];
  if(!truth.inRegion)return {tick,objectId,belief:null,dropped:false,reason:'OUT_OF_VIEW',truthAtObservedTick:at,errorM:null};
  if(u0<profile.dropoutProbability)return {tick,objectId,belief:null,dropped:true,reason:'DROPOUT',truthAtObservedTick:at,errorM:null};
  const positionM:[number,number,number]=[at[0]+bx+sx*gx,at[1]+by+sy*gy,centerZ];
  return {tick,objectId,belief:{objectId,kind:'cup',frameId,positionM,sigmaM:[sx,sy,0],observedTick,publishedTick:tick,ageTicks:0,source,valid:true},dropped:false,
   truthAtObservedTick:at,errorM:Math.hypot(positionM[0]-at[0],positionM[1]-at[1])}; // x/y estimator error; full truth XYZ is scoring evidence only
 }};
}
