// IR-SIM 2D geometry for the twin layers: LiDAR scans projected from the sensor pose of their own sample tick, and the compiled footprint placed on the
// drive frame. Pure; the engine supplies planar poses only (z comes from the model's mount height). Nothing here invents a beam, a pose or a shape.
import type {Pose} from '../shared/engineering';
import type {Lidar2DProjection,LidarScanV1,NavigationModel2DV1} from '../shared/navigation2d';
export type Pt3=[number,number,number];
const rotate=([qx,qy,qz,qw]:readonly number[],[x,y,z]:Pt3):Pt3=>{// v' = q v q*
 const tx=2*(qy!*z-qz!*y),ty=2*(qz!*x-qx!*z),tz=2*(qx!*y-qy!*x);
 return [x+qw!*tx+(qy!*tz-qz!*ty),y+qw!*ty+(qz!*tx-qx!*tz),z+qw!*tz+(qx!*ty-qy!*tx)];
};
/** Hits only: a `hit` beam with a finite range inside [rangeMin, rangeMax]. A miss (no_return) is free space, never a point; below_min/invalid and any
 * inconsistent hit are unknown. Arrays of different lengths are refused whole (every beam unknown). */
export function projectScan(scan:LidarScanV1,poseAtScan:Pose):{hitPointsM:Pt3[];unknownBeams:number}{
 const n=Math.max(scan.rangesM.length,scan.states.length);
 if(scan.rangesM.length!==scan.states.length)return {hitPointsM:[],unknownBeams:n};
 const hitPointsM:Pt3[]=[];let unknownBeams=0;
 scan.states.forEach((state,i)=>{
  if(state==='no_return')return;
  const r=scan.rangesM[i];
  if(state!=='hit'||typeof r!=='number'||!Number.isFinite(r)||r<scan.rangeMinM-1e-6||r>scan.rangeMaxM+1e-6){unknownBeams++;return;}
  const a=scan.angleMinRad+i*scan.angleIncrementRad,[x,y,z]=rotate(poseAtScan.quaternionXyzw,[r*Math.cos(a),r*Math.sin(a),0]);
  hitPointsM.push([poseAtScan.xyzM[0]+x,poseAtScan.xyzM[1]+y,poseAtScan.xyzM[2]+z]);
 });
 return {hitPointsM,unknownBeams};
}
const yawQuat=(yaw:number):[number,number,number,number]=>[0,0,Math.sin(yaw/2),Math.cos(yaw/2)];
/** Sensor pose in map from the drive-frame pose [x,y,yaw] at the scan's tick (as recorded: the engine reports drive-frame poses) and the mount. */
export function sensorPoseAt([x,y,yaw]:readonly number[],lidar:Pick<Lidar2DProjection,'poseInDrive'|'heightM'>):Pose{
 const [mx,my,myaw]=lidar.poseInDrive as [number,number,number],c=Math.cos(yaw!),s=Math.sin(yaw!);
 return {xyzM:[x!+mx*c-my*s,y!+mx*s+my*c,lidar.heightM],quaternionXyzw:yawQuat(yaw!+myaw)};
}
export interface ScanSample {robotId:string;scan:LidarScanV1;/** sensor pose at scan.tick; null when the recording has no pose for that tick */sensorPose:Pose|null}
export interface ScanLayer {available:boolean;reason?:string;scans:{robotId:string;tick:number;hitPointsM:Pt3[];unknownBeams:number}[]}
/** What the scan layer can draw. A live run exposes no scan stream to the browser, so it says so (2D plan unaffected); a scan without its own-tick pose
 * is never drawn from a newer pose. */
export function scanLayer(source:{scans:ScanSample[]}|undefined):ScanLayer{
 if(!source)return {available:false,reason:'SCAN_STREAM_NOT_EXPOSED',scans:[]};
 if(!source.scans.length)return {available:false,reason:'SCAN_NOT_RECORDED',scans:[]};
 if(source.scans.some(s=>!s.sensorPose))return {available:false,reason:'SCAN_POSE_UNKNOWN',scans:[]};
 return {available:true,scans:source.scans.map(s=>({robotId:s.robotId,tick:s.scan.tick,...projectScan(s.scan,s.sensorPose!)}))};
}
/** Planar part of a pose: [x, y, yaw]. */
export function planarPose(p:Pose):[number,number,number]{const [qx,qy,qz,qw]=p.quaternionXyzw;return [p.xyzM[0],p.xyzM[1],Math.atan2(2*(qw*qz+qx*qy),1-2*(qy*qy+qz*qz))];}
/** Offset a convex counter-clockwise or clockwise polygon outward by `margin` (miter at each vertex). */
function inflate(poly:[number,number][],margin:number):[number,number][]{
 if(!margin)return poly;
 const area=poly.reduce((a,[x,y],i)=>{const [u,v]=poly[(i+1)%poly.length]!;return a+x*v-u*y;},0),sign=area>=0?1:-1,n=poly.length;
 const normal=(i:number)=>{const [x1,y1]=poly[i]!,[x2,y2]=poly[(i+1)%n]!,dx=x2-x1,dy=y2-y1,l=Math.hypot(dx,dy)||1;return [sign*dy/l,-sign*dx/l] as const;};
 return poly.map(([x,y],i)=>{const a=normal((i-1+n)%n),b=normal(i),mx=a[0]+b[0],my=a[1]+b[1],d=1+a[0]*b[0]+a[1]*b[1];return d<1e-9?[x+a[0]*margin,y+a[1]*margin]:[x+mx*margin/d,y+my*margin/d];});
}
/** The compiled footprint (drive frame) in map: T_map_base (the run's base pose) x T_base_drive (model) x vertex; `margin` > 0 gives the safety envelope. */
export function footprintInMap(model:Pick<NavigationModel2DV1,'driveFrameInBase'|'footprint'>,base:{x:number;y:number;yawRad:number},margin=0):[number,number][]{
 const [dx,dy,dyaw]=planarPose(model.driveFrameInBase),c=Math.cos(base.yawRad),s=Math.sin(base.yawRad);
 const dc=Math.cos(dyaw),ds=Math.sin(dyaw);
 return inflate(model.footprint.verticesM.map(v=>[v[0]!,v[1]!] as [number,number]),margin).map(([x,y])=>{const bx=dx+x*dc-y*ds,by=dy+x*ds+y*dc;return [base.x+bx*c-by*s,base.y+bx*s+by*c];});
}
