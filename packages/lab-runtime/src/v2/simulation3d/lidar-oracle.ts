// Independent ray-cast of a NavigationSceneV1's static world, for checking a plant's LiDAR (SX-09). The beams follow LidarScanV1 as the Webots worker publishes it:
// counter-clockwise from -pi + delta/2 in the sensor frame, delta = 2 pi / beams. A hit outside [minM, maxM] is no return (Infinity).
import type {NavigationSceneV1} from '../navigation2d/contracts';

type P=readonly [number,number];
const cross=(ax:number,ay:number,bx:number,by:number)=>ax*by-ay*bx;
export function castScan(scene:Pick<NavigationSceneV1,'world'>,pose:{x:number;y:number;yaw:number},sensor:{beams:number;minM:number;maxM:number}):number[]{
 const polygons=[...scene.world.obstacles,...scene.world.boundaries].map(o=>o.verticesM as unknown as P[]),delta=2*Math.PI/sensor.beams;
 return Array.from({length:sensor.beams},(_,k)=>{
  const a=pose.yaw-Math.PI+(k+0.5)*delta,dx=Math.cos(a),dy=Math.sin(a);
  let best=Infinity;
  for(const poly of polygons)for(let i=0;i<poly.length;i++){
   const p=poly[i]!,q=poly[(i+1)%poly.length]!,ex=q[0]-p[0],ey=q[1]-p[1],denom=cross(dx,dy,ex,ey);
   if(Math.abs(denom)<1e-12)continue; // parallel
   const ox=p[0]-pose.x,oy=p[1]-pose.y,t=cross(ox,oy,ex,ey)/denom,s=cross(ox,oy,dx,dy)/denom;
   if(s>=0&&s<=1&&t>0&&t<best)best=t; // the nearest surface hides what is behind it, whether or not it is in range
  }
  return best>=sensor.minM&&best<=sensor.maxM?best:Infinity;
 });
}

export interface LidarRule {toleranceM:number;windowBeams:number;medianM:number;maxM:number}
export interface LidarVerdict {compared:number;violations:{k:number;web:number|null;lo:number;hi:number}[];medianAbsM:number;medianOk:boolean}
/**
 * Does a plant's scan agree with the ray-cast? A rendered depth sensor gives each beam the depth of a pixel, so on a slanted surface a beam may report what its neighbour should
 * see (measured on Webots R2025a: up to one beam, 1 degree, on 2-9 m walls). A beam agrees when its range lies within the ray-cast range over the beam and `windowBeams` neighbours
 * either side, widened by `toleranceM`; no return agrees where any of them sees nothing in range. Separately the median error over the beams that both see must stay under `medianM`,
 * so a plant that is simply offset does not pass on the strength of the window.
 */
export function lidarAgrees(ranges:readonly (number|null)[],cast:readonly number[],rule:LidarRule):LidarVerdict{
 const n=ranges.length,violations:LidarVerdict['violations']=[],diffs:number[]=[];
 for(let k=0;k<n;k++){
  const window=Array.from({length:2*rule.windowBeams+1},(_,i)=>cast[(k+i-rule.windowBeams+n)%n]!),seen=window.filter(v=>Number.isFinite(v)&&v<=rule.maxM),blind=seen.length<window.length;
  const lo=seen.length?Math.min(...seen):Infinity,hi=blind?rule.maxM:Math.max(...seen),web=ranges[k]!;
  const ok=web===null?blind:web>=lo-rule.toleranceM&&web<=hi+rule.toleranceM;
  if(!ok)violations.push({k,web,lo,hi});
  if(web!==null&&Number.isFinite(cast[k]!))diffs.push(Math.abs(web-cast[k]!));
 }
 const sorted=[...diffs].sort((a,b)=>a-b),medianAbsM=sorted.length?sorted[Math.floor(sorted.length/2)]!:0;
 return {compared:n,violations,medianAbsM,medianOk:medianAbsM<=rule.medianM};
}
