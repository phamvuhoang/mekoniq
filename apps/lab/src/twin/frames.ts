// Pure frame/unit math. Verbatim copy of source/packages/lab-runtime/src/v2/frames.ts (no imports; keep both identical, the golden tests in both repos pin the behaviour).
// TODO(interim-copy): replace with the pinned source artifact or a generated import; until then tests/integration/lab-v2-model.test.ts in source fails on any drift from the source file.
// Lengths (3 / 4) match the generated contract types, which are plain number[]; every entry point checks them at runtime.
export type Vec3=readonly number[];
export type Quat=readonly number[];
export interface Pose {position:Vec3;quaternionXyzw:Quat;}
export interface FrameDef {id:string;parentId:string|null;translationM:Vec3;quaternionXyzw:Quat;}
export class ModelError extends Error {
 constructor(readonly code:string,readonly detail?:string){super(detail?`${code}: ${detail}`:code);this.name='ModelError';}
}
export const QUATERNION_TOLERANCE=1e-6;
const finite=(v:readonly number[])=>v.every(Number.isFinite);
// ---- explicit unit conversion: a missing or unknown unit is an error, never a guess ----
const LENGTH:Record<string,number>={m:1,mm:0.001,inch:0.0254},ANGLE:Record<string,number>={rad:1,deg:Math.PI/180};
const unit=(table:Record<string,number>,value:number,u:unknown)=>{
 if(typeof u!=='string'||!Object.hasOwn(table,u))throw new ModelError('UNITS_MISSING',`unit ${String(u)}`);
 if(!Number.isFinite(value))throw new ModelError('FRAME_NOT_FINITE');
 return value*table[u]!;
};
export const lengthToM=(value:number,u:'m'|'mm'|'inch')=>unit(LENGTH,value,u);
export const angleToRad=(value:number,u:'rad'|'deg')=>unit(ANGLE,value,u);
export const quaternionFromYaw=(yawRad:number):Quat=>[0,0,Math.sin(yawRad/2),Math.cos(yawRad/2)];
/** Frame authored in device units (e.g. inch/deg); yaw-only rotation. */
export function sourceFrame(f:{id:string;parentId:string|null;translation:Vec3;lengthUnit:'m'|'mm'|'inch';yaw:number;angleUnit:'rad'|'deg'}):FrameDef {
 return {id:f.id,parentId:f.parentId,translationM:f.translation.map(v=>lengthToM(v,f.lengthUnit)) as unknown as Vec3,quaternionXyzw:quaternionFromYaw(angleToRad(f.yaw,f.angleUnit))};
}
// ---- quaternion [x,y,z,w], Hamilton ----
export const qmul=(a:Quat,b:Quat):Quat=>[a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
export const qconj=(q:Quat):Quat=>[-q[0],-q[1],-q[2],q[3]];
export function qrotate(q:Quat,v:Vec3):Vec3 {
 const t=[2*(q[1]!*v[2]!-q[2]!*v[1]!),2*(q[2]!*v[0]!-q[0]!*v[2]!),2*(q[0]!*v[1]!-q[1]!*v[0]!)];
 return [v[0]+q[3]*t[0]!+q[1]*t[2]!-q[2]*t[1]!,v[1]+q[3]*t[1]!+q[2]*t[0]!-q[0]*t[2]!,v[2]+q[3]*t[2]!+q[0]*t[1]!-q[1]*t[0]!];
}
export function checkQuaternion(q:readonly number[]):Quat {
 if(q.length!==4||!finite(q))throw new ModelError('QUATERNION_NOT_NORMALIZED','not four finite numbers');
 if(Math.abs(Math.hypot(...q)-1)>QUATERNION_TOLERANCE)throw new ModelError('QUATERNION_NOT_NORMALIZED',`norm ${Math.hypot(...q)}`);
 return q as unknown as Quat;
}
const renorm=(q:Quat):Quat=>{const n=Math.hypot(...q);return [q[0]/n,q[1]/n,q[2]/n,q[3]/n];};
export const composePose=(a:Pose,b:Pose):Pose=>{const p=qrotate(a.quaternionXyzw,b.position);return {position:[a.position[0]+p[0],a.position[1]+p[1],a.position[2]+p[2]],quaternionXyzw:renorm(qmul(a.quaternionXyzw,b.quaternionXyzw))};};
export const invertPose=(a:Pose):Pose=>{const c=qconj(a.quaternionXyzw),p=qrotate(c,a.position);return {position:[-p[0],-p[1],-p[2]],quaternionXyzw:c};};
// ---- frame graph: exactly one root, no cycles, normalized quaternions ----
export interface FrameGraph {readonly root:string;readonly frames:ReadonlyMap<string,FrameDef>;has(id:string):boolean;/** T_root_frame */poseOf(id:string):Pose;}
export function buildFrameGraph(defs:readonly FrameDef[]):FrameGraph {
 const frames=new Map<string,FrameDef>();
 for(const f of defs){
  if(frames.has(f.id))throw new ModelError('FRAME_DUPLICATE',f.id);
  if(f.translationM.length!==3||!finite(f.translationM))throw new ModelError('FRAME_NOT_FINITE',f.id);
  checkQuaternion(f.quaternionXyzw);
  frames.set(f.id,f);
 }
 for(const f of defs)if(f.parentId!==null&&!frames.has(f.parentId))throw new ModelError('FRAME_PARENT_UNKNOWN',`${f.id} -> ${f.parentId}`);
 const roots=defs.filter(f=>f.parentId===null);
 if(roots.length!==1)throw new ModelError('FRAME_ROOT_COUNT',String(roots.length));
 const memo=new Map<string,Pose>([[roots[0]!.id,{position:[0,0,0],quaternionXyzw:[0,0,0,1]}]]);
 for(const start of defs){
  const chain:FrameDef[]=[];let cur:FrameDef|undefined=start;
  while(cur&&!memo.has(cur.id)){
   if(chain.includes(cur))throw new ModelError('FRAME_CYCLE',cur.id);
   chain.push(cur);cur=frames.get(cur.parentId!);
  }
  for(const f of chain.reverse())memo.set(f.id,composePose(memo.get(f.parentId!)!,{position:f.translationM,quaternionXyzw:f.quaternionXyzw}));
 }
 return {root:roots[0]!.id,frames,has:id=>frames.has(id),poseOf:id=>{const p=memo.get(id);if(!p)throw new ModelError('FRAME_UNKNOWN',id);return p;}};
}
/** Express `pose` (given in frame `from`) in frame `to`: pose_to = T_to_from * pose. Unknown frames are rejected, never guessed. */
export function transformPose(from:string,to:string,pose:Pose,graph:FrameGraph):Pose {
 if(!graph.has(from))throw new ModelError('FRAME_UNKNOWN',from);
 if(!graph.has(to))throw new ModelError('FRAME_UNKNOWN',to);
 if(pose.position.length!==3||!finite(pose.position))throw new ModelError('FRAME_NOT_FINITE','pose');
 checkQuaternion(pose.quaternionXyzw);
 return composePose(composePose(invertPose(graph.poseOf(to)),graph.poseOf(from)),pose);
}
