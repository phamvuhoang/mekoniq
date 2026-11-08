import {composePose,invertPose,qrotate,type Pose as FramePose} from '../v2/frames';
import {sealDocument} from '../v2/navigation2d/contracts';
import type {Lidar2DProjection,NavigationModel2DV1,NavigationPolicyV1,RobotPhysicalModelV1} from '../v2/navigation2d/contracts';
import {EngineeringInputError} from './assembly';
import type {Problem,Scalar} from './contracts';
import {framePose} from './inertia';

/** T_map_drive = T_map_base x T_base_drive (contracts §3); IR-SIM's diff origin is the axle midpoint, never the root link. */
export const driveInMap=(baseInMap:FramePose,driveInBase:FramePose):FramePose=>composePose(baseInMap,driveInBase);
/** T_map_base = T_map_drive x inverse(T_base_drive), applied to engine snapshots before the MEKONIQ model is rendered. */
export const baseInMap=(driveInMapPose:FramePose,driveInBase:FramePose):FramePose=>composePose(driveInMapPose,invertPose(driveInBase));
export const yawOf=(q:readonly number[])=>Math.atan2(2*(q[3]!*q[2]!+q[0]!*q[1]!),1-2*(q[1]!*q[1]!+q[2]!*q[2]!));

export interface NavigationLimits{
 /** Entity speed limit from the runtime project; the effective linear speed is the minimum of it, the policy and the wheel limits. */
 entitySpeedLimitMps?:number;
}
type P=[number,number];
const EPS=1e-9;

/** Convex hull (monotone chain), counter-clockwise, duplicates and collinear points within 1e-9 removed. */
export function convexHull(points:P[]):P[]{
 const pts=[...points].sort((a,b)=>a[0]-b[0]||a[1]-b[1]).filter((p,i,l)=>i===0||Math.hypot(p[0]-l[i-1]![0],p[1]-l[i-1]![1])>EPS);
 if(pts.length<3)return pts;
 const cross=(o:P,a:P,b:P)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
 const half=(list:P[])=>{const h:P[]=[];for(const p of list){while(h.length>=2&&cross(h.at(-2)!,h.at(-1)!,p)<=EPS*EPS)h.pop();h.push(p);}h.pop();return h;};
 return [...half(pts),...half([...pts].reverse())];
}
const clean=(v:number)=>Math.abs(v)<1e-12?0:v;

/** Planar points of one collision primitive in the drive frame: eight projected box corners; sphere and cylinder by analytic extents (bounding rectangle). */
function shapePoints(geometry:{kind:string;[k:string]:unknown},at:FramePose):P[]|null{
 const [cx,cy]=at.position as [number,number],R=(v:number[])=>qrotate(at.quaternionXyzw,v);
 const rect=(hx:number,hy:number):P[]=>[[cx-hx,cy-hy],[cx+hx,cy-hy],[cx+hx,cy+hy],[cx-hx,cy+hy]];
 if(geometry.kind==='box'){
  const s=geometry.sizeM as number[],out:P[]=[];
  for(const a of [-1,1])for(const b of [-1,1])for(const c of [-1,1]){const r=R([a*s[0]!/2,b*s[1]!/2,c*s[2]!/2]);out.push([cx+r[0]!,cy+r[1]!]);}
  return out;
 }
 if(geometry.kind==='sphere'){const r=geometry.radiusM as number;return rect(r,r);}
 if(geometry.kind==='cylinder'){
  const r=geometry.radiusM as number,h=geometry.lengthM as number,ax=R([0,0,1]);
  return rect(r*Math.sqrt(Math.max(0,1-ax[0]!**2))+h/2*Math.abs(ax[0]!),r*Math.sqrt(Math.max(0,1-ax[1]!**2))+h/2*Math.abs(ax[1]!));
 }
 return null;
}

/** Link poses in the base frame at zero joint position, from the physical model's own joint tree. */
function basePoses(m:RobotPhysicalModelV1):Map<string,FramePose>{
 const out=new Map<string,FramePose>([[m.baseFrameId,{position:[0,0,0],quaternionXyzw:[0,0,0,1]}]]),kids=new Map<string,typeof m.joints>();
 for(const j of m.joints)kids.set(j.parent,[...(kids.get(j.parent)??[]),j]);
 const visit=(id:string)=>{for(const j of kids.get(id)??[]){out.set(j.child,composePose(out.get(id)!,framePose(j.origin)));visit(j.child);}};
 visit(m.baseFrameId);
 return out;
}
const scalarIn=(s:Scalar,unit:string,add:(c:string,p:string,d:string)=>void,path:string)=>{if(s.unit!==unit)add('UNIT_NOT_ALLOWED',path,`"${s.unit}" must be ${unit}`);return s.value;};

/** NavigationModel2DV1 from a physical model and the server-owned policy. Throws EngineeringInputError; nothing is defaulted, a conservative approximation is always labelled. */
export function projectNavigationModel(model:RobotPhysicalModelV1,policy:NavigationPolicyV1,limits:NavigationLimits={}):NavigationModel2DV1{
 const problems:Problem[]=[],add=(code:string,path:string,detail:string)=>{problems.push({code,path,blocking:true,detail});};
 const fail=():never=>{throw new EngineeringInputError(problems);};
 const drive=model.drive;
 if(!drive){add('DRIVE_REQUIRED','/drive','a navigation model needs a differential drive');fail();}
 const d=drive!,p=policy.parameters,toDrive=invertPose(framePose(d.driveFrameInBase)),poses=basePoses(model);
 const radius=scalarIn(d.wheelRadiusM,'m',add,'/drive/wheelRadiusM'),separation=scalarIn(d.wheelSeparationM,'m',add,'/drive/wheelSeparationM');
 const actuator=scalarIn(d.actuatorMaxSpeedRadps,'rad/s',add,'/drive/actuatorMaxSpeedRadps');
 // wheel limit = min(joint velocity limit, actuator binding); a missing or foreign unit blocks, it is never inferred from the radius
 const wheelLimit=(jointId:string)=>{
  const v=(model.joints.find(x=>x.id===jointId) as {limits?:{velocity?:Scalar}}|undefined)?.limits?.velocity;
  if(!v){add('WHEEL_LIMIT_MISSING',`/joints/${jointId}`,'the drive joint has no velocity limit');return NaN;}
  return Math.min(scalarIn(v,'rad/s',add,`/joints/${jointId}/limits/velocity`),actuator);
 };
 const left=wheelLimit(d.leftJointId),right=wheelLimit(d.rightJointId);
 if(problems.length)fail();

 const points:P[]=[],ids:string[]=[];
 for(const l of model.links)l.collision.forEach((s,n)=>{
  const pts=shapePoints(s.geometry as never,composePose(composePose(toDrive,poses.get(l.id)!),framePose(s.pose)));
  if(!pts)add('FOOTPRINT_GEOMETRY_UNSUPPORTED',`/links/${l.id}/collision/${n}`,'mesh-only collision needs a primitive collision proxy with provenance');
  else{points.push(...pts);ids.push(`${l.id}:c${n}`);}
 });
 if(problems.length)fail();
 const hull=convexHull(points.map(([x,y])=>[clean(x),clean(y)] as P));
 if(hull.length<3||hull.length>128)add('FOOTPRINT_GEOMETRY_UNSUPPORTED','/footprint',`hull has ${hull.length} vertices; 3 to 128 are supported`);
 if(problems.length)fail();

 const sensors:Lidar2DProjection[]=[];
 for(const s of model.sensors){
  const m=s.model,path=`/sensors/${s.sensorId}`;
  if(m.sensorType!=='lidar_2d'||!m.lidar2d){add('SENSOR_TYPE_REQUIRED',path,'only sensors that declare sensorType lidar_2d can drive the 2D plant');continue;}
  const rate=scalarIn(m.rateHz,'Hz',add,`${path}/rateHz`),every=50/rate;
  const unsupported=(why:string)=>add('SENSOR_FIDELITY_UNSUPPORTED',path,why);
  if(m.latency.value!==0)unsupported('nonzero latency is not modelled');
  if(m.dropoutProbability.value!==0)unsupported('dropout is not modelled');
  if(m.noise.distribution==='uniform')unsupported('uniform noise is not modelled (none or gaussian only)');
  if(Math.abs(every-Math.round(every))>EPS||Math.round(every)<1)unsupported(`50 / ${rate} Hz is not a whole number of 20 ms ticks`);
  const at=composePose(toDrive,framePose(s.poseInBase)),tiltRoll=qrotate(at.quaternionXyzw,[0,0,1]);
  if(Math.hypot(tiltRoll[0]!,tiltRoll[1]!)>1e-6)unsupported('a tilted scan plane is not modelled');
  sensors.push({id:s.sensorId,type:'lidar_2d',sourceModelDigest:s.sensorModelDigest,parentLinkId:s.parentLinkId,poseInDrive:[clean(at.position[0]!),clean(at.position[1]!),clean(yawOf(at.quaternionXyzw))],heightM:clean(at.position[2]!),
   rangeMinM:scalarIn(m.range.min,'m',add,`${path}/range/min`),rangeMaxM:scalarIn(m.range.max,'m',add,`${path}/range/max`),fieldOfViewRad:scalarIn(m.fieldOfView,'rad',add,`${path}/fieldOfView`),beamCount:m.lidar2d.beamCount,publishEveryTicks:Math.round(every),
   noise:{distribution:m.noise.distribution as 'none'|'gaussian',stddevM:m.noise.stddev.value,seed:m.noise.seed}});
 }
 if(problems.length)fail();

 const wheelMin=Math.min(left,right),linear=Math.min(p.maxLinearMps,radius*wheelMin,limits.entitySpeedLimitMps??Infinity),angular=Math.min(p.maxAngularRadps,2*radius*wheelMin/separation);
 return sealDocument<NavigationModel2DV1>({
  schemaVersion:1,documentType:'navigation-model-2d',modelDigest:'',inputs:model.inputs,robotId:model.robotId,physicalModelDigest:model.modelDigest,baseFrameId:model.baseFrameId,driveFrameInBase:d.driveFrameInBase,
  kinematics:{type:'differential_drive',wheelRadiusM:radius,wheelSeparationM:separation,maxLinearMps:+linear.toFixed(12),maxAngularRadps:+angular.toFixed(12),maxWheelRadps:{left,right}},
  footprint:{frame:'drive',verticesM:hull,method:'convex-hull-primitive-bounds-v1',contributingShapeIds:ids.sort(),conservative:true},
  navigationPolicyRef:{id:policy.id,revision:policy.revision,hash:policy.hash},sensors,
  limitations:['planar kinematics only: no slip, torque, battery or tipping model','footprint is a conservative hull of primitive bounds, so a no_path result does not prove the real robot cannot pass','LiDAR rays and collisions share one plane (PLANAR_OCCLUSION_NO_HEIGHT_FILTER); sensor height is for display','policy limits are fixture values, not measured hardware limits'],
 },'modelDigest');
}
