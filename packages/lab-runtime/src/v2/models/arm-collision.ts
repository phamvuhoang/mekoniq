// Conservative, SI-only geometric mock checker. Capsule geometry is illustrative, not a measured robot mesh.
// Adaptive subdivision uses a reach * sum(|dq|) movement bound; uncertain intervals are blocked, never passed.
import {forwardKinematics,type ArmModelSI} from './arm-kinematics';
import {qrotate,type Vec3} from '../frames';
import {hashJson} from '../hash';
export type ArmObstacle={id:string;kind:'sphere';center:Vec3;radiusM:number}|{id:string;kind:'box';min:Vec3;max:Vec3};
/** `linkRadiiM` (one per link, link-1..link-6) replaces `linkRadiusM` link by link. `cupAxisInTool` lays the held cup along that tool-frame axis, centred on the TCP (side grip);
 * absent, the cup stands on the tool axis beyond the gripper as before. `gripperBackM` extends the gripper behind the TCP along tool -z to cover the palm;
 * `gripperLengthM` remains its forward reach along tool +z. Omitted fields preserve the reference geometry exactly. */
export interface ArmGeometry {linkRadiusM:number;gripperRadiusM:number;gripperLengthM:number;cupRadiusM:number;cupHeightM:number;provenance:'illustrative'|'assumed';linkRadiiM?:number[];cupAxisInTool?:[number,number,number];gripperBackM?:number}
export const DEFAULT_ARM_GEOMETRY:ArmGeometry={linkRadiusM:0.025,gripperRadiusM:0.02,gripperLengthM:0.025,cupRadiusM:0.035,cupHeightM:0.09,provenance:'illustrative'};
/** `allowed` is present only when allowed pairs were given: the pairs, and those of them that were in contact (clearance <= 0) at any evaluated configuration of the sweep, in the given order. */
export interface SweepResult {ok:boolean;engine:'capsule-sweep-v1';modelRevision:string;geometryRevision:string;toleranceM:number;evaluations:number;reason?:'COLLISION'|'SWEEP_UNCERTAIN';pair?:[string,string];fraction?:number;clearanceM?:number;
 allowed?:{pairs:[string,string][];inContact:[string,string][]}}
interface Capsule {id:string;a:Vec3;b:Vec3;radius:number;link:number;kind:'link'|'gripper'|'cup'}
const add=(a:Vec3,b:Vec3):Vec3=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a:Vec3,b:Vec3):Vec3=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const dot=(a:Vec3,b:Vec3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const at=(a:Vec3,d:Vec3,t:number):Vec3=>[a[0]+d[0]*t,a[1]+d[1]*t,a[2]+d[2]*t];
const clamp=(n:number)=>Math.min(1,Math.max(0,n));
function segmentDistance(p:Vec3,q:Vec3,r:Vec3,s:Vec3){
 const u=sub(q,p),v=sub(s,r),w=sub(p,r),a=dot(u,u),b=dot(u,v),c=dot(v,v),d=dot(u,w),e=dot(v,w);
 let x=0,y=0;
 if(a<1e-20)y=c>1e-20?clamp(e/c):0;
 else if(c<1e-20)x=clamp(-d/a);
 else{const denominator=a*c-b*b;x=denominator>1e-20?clamp((b*e-c*d)/denominator):0;y=(b*x+e)/c;
  if(y<0){y=0;x=clamp(-d/a);}else if(y>1){y=1;x=clamp((b-d)/a);}}
 return Math.hypot(...sub(at(p,u,x),at(r,v,y)));
}
/** Exact minimum distance from a segment to an axis-aligned box, minimizing each piecewise quadratic interval. */
function boxDistance(a:Vec3,b:Vec3,min:Vec3,max:Vec3){
 const d=sub(b,a),breaks=[0,1];
 for(let k=0;k<3;k++)if(d[k]!==0)for(const edge of [min[k]!,max[k]!]){const t=(edge-a[k]!)/d[k]!;if(t>0&&t<1)breaks.push(t);}
 breaks.sort((x,y)=>x-y);
 const distance=(t:number)=>Math.hypot(...at(a,d,t).map((x,k)=>Math.max(min[k]!-x,0,x-max[k]!)));
 let best=Math.min(...breaks.map(distance));
 for(let i=0;i<breaks.length-1;i++){
  const lo=breaks[i]!,hi=breaks[i+1]!,mid=(lo+hi)/2;let numerator=0,denominator=0;
  for(let k=0;k<3;k++){const p=a[k]!+d[k]!*mid,bound=p<min[k]!?min[k]:p>max[k]!?max[k]:undefined;
   if(bound!==undefined){numerator+=d[k]!*(a[k]!-bound);denominator+=d[k]!**2;}}
  if(denominator>0)best=Math.min(best,distance(Math.max(lo,Math.min(hi,-numerator/denominator))));
 }
 return best;
}
function bodies(model:ArmModelSI,q:readonly number[],geometry:ArmGeometry,heldCup:boolean):Capsule[]{
 const fk=forwardKinematics(model,q),points:Vec3[]=[[0,0,0],...fk.frames.map(f=>f.position)],out:Capsule[]=[];
 for(let i=1;i<points.length;i++)if(Math.hypot(...sub(points[i]!,points[i-1]!))>1e-9)out.push({id:`link-${i}`,a:points[i-1]!,b:points[i]!,radius:geometry.linkRadiiM?.[i-1]??geometry.linkRadiusM,link:out.length,kind:'link'});
 const link=out.length;
 out.push({id:'gripper',a:geometry.gripperBackM?sub(fk.tcp.position,qrotate(fk.tcp.quaternionXyzw,[0,0,geometry.gripperBackM])):fk.tcp.position,b:add(fk.tcp.position,qrotate(fk.tcp.quaternionXyzw,[0,0,geometry.gripperLengthM])),radius:geometry.gripperRadiusM,link,kind:'gripper'});
 const axis=geometry.cupAxisInTool;
 if(heldCup&&axis){const n=Math.hypot(...axis),half=qrotate(fk.tcp.quaternionXyzw,axis.map(v=>v/n*geometry.cupHeightM/2) as Vec3);out.push({id:'held-cup',a:sub(fk.tcp.position,half),b:add(fk.tcp.position,half),radius:geometry.cupRadiusM,link,kind:'cup'});}
 else if(heldCup)out.push({id:'held-cup',a:add(fk.tcp.position,qrotate(fk.tcp.quaternionXyzw,[0,0,geometry.gripperLengthM])),b:add(fk.tcp.position,qrotate(fk.tcp.quaternionXyzw,[0,0,geometry.gripperLengthM+geometry.cupHeightM])),radius:geometry.cupRadiusM,link,kind:'cup'});
 return out;
}
function clearance(capsules:Capsule[],world:readonly ArmObstacle[],allowed:readonly (readonly [string,string])[]=[],touched?:Set<number>){
 let clearanceM=Infinity,pair:[string,string]|undefined;
 // phase-scoped allowed contact (gripper/held cup only; the caller validates). A skipped pair still counts as touched when it is in contact.
 const allowedIndex=(a:string,b:string)=>allowed.findIndex(([x,y])=>x===a&&y===b||x===b&&y===a);
 const skip=(a:string,b:string,distance?:()=>number)=>{const i=allowedIndex(a,b);if(i<0)return false;if(touched&&distance&&!touched.has(i)&&distance()<=0)touched.add(i);return true;};
 const keep=(n:number,a:string,b:string)=>{if(n<clearanceM){clearanceM=n;pair=[a,b];}};
 for(let i=0;i<capsules.length;i++){
  const c=capsules[i]!;
  for(const o of world){const d=()=>(o.kind==='sphere'?segmentDistance(c.a,c.b,o.center,o.center)-o.radiusM:boxDistance(c.a,c.b,o.min,o.max))-c.radius;if(!skip(c.id,o.id,d))keep(d(),c.id,o.id);}
  for(let j=i+1;j<capsules.length;j++){
   const b=capsules[j]!;
   // Adjacent bodies meet intentionally at a joint; gripper/cup attach to the last link.
   if(Math.abs(c.link-b.link)<=1||skip(c.id,b.id,()=>segmentDistance(c.a,c.b,b.a,b.b)-c.radius-b.radius))continue;
   keep(segmentDistance(c.a,c.b,b.a,b.b)-c.radius-b.radius,c.id,b.id);
  }
 }
 return {clearanceM,pair};
}
export function checkArmSweep(model:ArmModelSI,from:readonly number[],to:readonly number[],options:{world:readonly ArmObstacle[];heldCup?:boolean;geometry?:ArmGeometry;toleranceM?:number;allowedPairs?:readonly (readonly [string,string])[]}):SweepResult{
 const geometry=options.geometry??DEFAULT_ARM_GEOMETRY,toleranceM=options.toleranceM??0.0005;
 const vector=(v:Vec3)=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
 const positive=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>0;
 if(!Number.isFinite(toleranceM)||toleranceM<=0||toleranceM>0.01||Object.entries(geometry).some(([k,v])=>k!=='provenance'&&k!=='linkRadiiM'&&k!=='cupAxisInTool'&&!positive(v)))throw new Error('COLLISION_GEOMETRY_INVALID');
 if(geometry.linkRadiiM!==undefined&&(!Array.isArray(geometry.linkRadiiM)||geometry.linkRadiiM.length!==model.links.length||!geometry.linkRadiiM.every(positive)))throw new Error('COLLISION_GEOMETRY_INVALID');
 if(geometry.cupAxisInTool!==undefined&&(!vector(geometry.cupAxisInTool)||!(Math.hypot(...geometry.cupAxisInTool)>1e-9)))throw new Error('COLLISION_GEOMETRY_INVALID');
 if(options.allowedPairs?.some(p=>!p.some(id=>id==='gripper'||id==='held-cup')))throw new Error('ALLOWED_PAIR_INVALID');
 for(const o of options.world)if(!o.id||(o.kind==='sphere'?(!vector(o.center)||!Number.isFinite(o.radiusM)||o.radiusM<=0):o.kind!=='box'||!vector(o.min)||!vector(o.max)||o.min.some((n,k)=>n>=o.max[k]!)))throw new Error('COLLISION_WORLD_INVALID');
 forwardKinematics(model,from);forwardKinematics(model,to);
 const result:SweepResult={ok:true,engine:'capsule-sweep-v1',modelRevision:model.revision,geometryRevision:hashJson({geometry,world:options.world}),toleranceM,evaluations:0};
 const reach=model.links.reduce((sum,l)=>sum+Math.abs(l.a)+Math.abs(l.d),Math.hypot(...model.toolM))+Math.max(geometry.gripperBackM??0,geometry.gripperLengthM)+geometry.cupHeightM;
 const totalMovement=reach*from.reduce((sum,q,i)=>sum+Math.abs(to[i]!-q),0);
 const pairs=options.allowedPairs??[],touched=pairs.length?new Set<number>():undefined;
 const evaluate=(fraction:number)=>{result.evaluations++;return clearance(bodies(model,from.map((q,i)=>q+(to[i]!-q)*fraction),geometry,options.heldCup??false),options.world,pairs,touched);};
 const fail=(fraction:number,c:ReturnType<typeof clearance>,reason:SweepResult['reason'])=>{Object.assign(result,{ok:false,reason,pair:c.pair,fraction,clearanceM:c.clearanceM});};
 const done=()=>{if(touched)result.allowed={pairs:pairs.map(p=>[p[0],p[1]]),inContact:pairs.filter((_,i)=>touched.has(i)).map(p=>[p[0],p[1]])};return result;};
 for(const t of [0,1]){const c=evaluate(t);if(c.clearanceM<=0){fail(t,c,'COLLISION');return done();}}
 const visit=(lo:number,hi:number,depth:number):void=>{
  if(!result.ok)return;
  const mid=(lo+hi)/2,c=evaluate(mid),bound=totalMovement*(hi-lo)/2;
  if(c.clearanceM<=0){fail(mid,c,'COLLISION');return;}
  if(c.clearanceM>2*bound)return; // includes worst-case relative motion of two links
  if(bound<=toleranceM||depth>=24||result.evaluations>=32768){fail(mid,c,'SWEEP_UNCERTAIN');return;}
  visit(lo,mid,depth+1);visit(mid,hi,depth+1);
 };
 visit(0,1,0);return done();
}
