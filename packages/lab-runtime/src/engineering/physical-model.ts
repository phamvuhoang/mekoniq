import {composePose,invertPose,qrotate,type Pose as FramePose} from '../v2/frames';
import {hashJson} from '../v2/hash';
import {sealDocument} from '../v2/navigation2d/contracts';
import type {RobotPhysicalModelV1} from '../v2/navigation2d/contracts';
import {EngineeringInputError,linkWorldPoses,uniqueSources} from './assembly';
import type {EngineeringCompileInput,Problem,Scalar,SensorModel,SourceRef} from './contracts';
import {engineeringPose} from './inertia';

const EPS=1e-6;
const cross=(a:readonly number[],b:readonly number[])=>[a[1]!*b[2]!-a[2]!*b[1]!,a[2]!*b[0]!-a[0]!*b[2]!,a[0]!*b[1]!-a[1]!*b[0]!];
const norm=(v:readonly number[])=>Math.hypot(...v);
/** Quaternion [x,y,z,w] of the rotation whose columns are the orthonormal vectors x, y, z. */
function quaternionFromBasis(x:number[],y:number[],z:number[]):[number,number,number,number]{
 const [m00,m10,m20,m01,m11,m21,m02,m12,m22]=[x[0]!,x[1]!,x[2]!,y[0]!,y[1]!,y[2]!,z[0]!,z[1]!,z[2]!],t=m00+m11+m22;
 let q:[number,number,number,number];
 if(t>0){const s=Math.sqrt(t+1)*2;q=[(m21-m12)/s,(m02-m20)/s,(m10-m01)/s,s/4];}
 else if(m00>m11&&m00>m22){const s=Math.sqrt(1+m00-m11-m22)*2;q=[s/4,(m01+m10)/s,(m02+m20)/s,(m21-m12)/s];}
 else if(m11>m22){const s=Math.sqrt(1+m11-m00-m22)*2;q=[(m01+m10)/s,s/4,(m12+m21)/s,(m02-m20)/s];}
 else{const s=Math.sqrt(1+m22-m00-m11)*2;q=[(m02+m20)/s,(m12+m21)/s,s/4,(m10-m01)/s];}
 return q.map(v=>v+0) as [number,number,number,number]; // +0 turns -0 into 0 so digests do not depend on the sign of zero
}
function sourcesIn(value:unknown,out:SourceRef[]=[]):SourceRef[]{
 if(Array.isArray(value))value.forEach(v=>sourcesIn(v,out));
 else if(value&&typeof value==='object'){
  const o=value as Record<string,unknown>;
  if(typeof o.kind==='string'&&typeof o.documentId==='string'&&typeof o.contentSha256==='string'&&'locator' in o)out.push(o as unknown as SourceRef);
  else Object.values(o).forEach(v=>sourcesIn(v,out));
 }
 return out;
}

/** Immutable physical subgraph of one robot, projected from the resolved assembly (spec contracts §2). Throws EngineeringInputError instead of guessing. */
export function projectPhysicalModel(input:EngineeringCompileInput,robotId:string,sourceSchemaHash:string):RobotPhysicalModelV1{
 const {resolved,project}=input,problems:Problem[]=[];
 const add=(code:string,path:string,detail:string)=>{problems.push({code,path,blocking:true,detail});};
 const fail=():never=>{throw new EngineeringInputError(problems);};
 const binding=resolved.entityBindings.find(b=>b.entityId===robotId);
 if(!binding){add('UNKNOWN_ROBOT',`/entityBindings/${robotId}`,'no entity binding with this robot id');fail();}
 if(!resolved.models.drivesByEntity){add('DRIVE_BINDINGS_REQUIRED','/models','the resolved assembly has no per-entity drive bindings; resolve it with the engineering-irsim-2d-v1 profile');fail();}
 const mine=new Set(binding!.instanceIds),owner=(id:string)=>id.split('/')[0]!;
 const links=resolved.links.filter(l=>mine.has(owner(l.id))),linkIds=new Set(links.map(l=>l.id));
 const joints=resolved.joints.filter(j=>linkIds.has(j.parent)||linkIds.has(j.child));
 for(const j of joints)if(linkIds.has(j.parent)!==linkIds.has(j.child))add('MIXED_OWNERSHIP',`/joints/${j.id}`,`joint connects ${j.parent} and ${j.child}, which belong to different entities`);
 const children=new Set(joints.map(j=>j.child)),roots=links.filter(l=>!children.has(l.id));
 if(roots.length!==1)add('ROBOT_ROOT_AMBIGUOUS',`/entityBindings/${robotId}`,`robot subgraph has ${roots.length} root links`);
 if(problems.length)fail();
 const base=roots[0]!,poses=linkWorldPoses(resolved),toBase=invertPose(poses.get(base.id)!);
 const inBase=(linkId:string):FramePose=>composePose(toBase,poses.get(linkId)!);

 let drive:RobotPhysicalModelV1['drive']=null;
 const binding2=resolved.models.drivesByEntity![robotId];
 if(binding2){
  const params=binding2.model.parameters.drive as {wheelRadiusM:Scalar;wheelSeparationM:Scalar},table=binding2.model.parameters.torqueSpeedTable as {speed:Scalar}[]|undefined,top=table?.at(-1)?.speed;
  if(!top)add('ACTUATOR_SPEED_LIMIT_MISSING',`/models/drivesByEntity/${robotId}`,'the drive model has no torque-speed table, so the wheel speed limit is unknown');
  const wheel=(jointId:string)=>{const j=resolved.joints.find(x=>x.id===jointId)!;return {joint:j,pose:inBase(j.child)};};
  const L=wheel(binding2.leftJointId),R=wheel(binding2.rightJointId);
  const span=[0,1,2].map(k=>L.pose.position[k]!-R.pose.position[k]!),len=norm(span),y=span.map(v=>v/len);
  const axis=(w:ReturnType<typeof wheel>)=>qrotate(w.pose.quaternionXyzw,w.joint.axis);
  const aL=axis(L),aR=axis(R);
  const planar=Math.abs(span[2]!)<EPS&&norm(cross(aL,aR))<EPS&&norm(cross(aL,y))<EPS;
  if(!planar)add('NON_PLANAR_DRIVE',`/entityBindings/${robotId}`,'wheel axes must be parallel and the wheel centres coplanar with a horizontal axle line');
  else if(span[1]!<=0)add('DRIVE_SIDES_SWAPPED',`/entityBindings/${robotId}`,'the left drive joint must sit on the +y side of the base frame');
  else{
   const z=[0,0,1],x=cross(y,z),mid=[0,1,2].map(k=>(L.pose.position[k]!+R.pose.position[k]!)/2);
   drive={entityId:robotId,leftJointId:binding2.leftJointId,rightJointId:binding2.rightJointId,wheelRadiusM:params.wheelRadiusM,wheelSeparationM:params.wheelSeparationM,actuatorMaxSpeedRadps:top!,
    driveFrameInBase:engineeringPose({position:mid.map(v=>v+0),quaternionXyzw:quaternionFromBasis(x,y,z)})};
  }
 }
 const sensors:RobotPhysicalModelV1['sensors']=[];
 for(const instanceId of [...mine].sort()){
  const doc=resolved.models.sensor[instanceId];if(!doc)continue;
  const model={schemaVersion:1,kind:'sensor',id:doc.id,...doc.parameters} as unknown as SensorModel,parentLinkId=`${instanceId}/${model.frame}`;
  if(!linkIds.has(parentLinkId)){add('SENSOR_FRAME_MISSING',`/models/sensor/${instanceId}`,`sensor ${doc.id} names frame ${model.frame}, which is not a link of ${instanceId}`);continue;}
  sensors.push({sensorId:doc.id,sourceInstanceId:instanceId,sensorModelDigest:doc.digest,parentLinkId,poseInBase:engineeringPose(inBase(parentLinkId)),model});
 }
 if(problems.length)fail();
 const w=project.runtimeProject.world;
 return sealDocument<RobotPhysicalModelV1>({
  schemaVersion:1,documentType:'robot-physical-model',modelDigest:'',
  inputs:{project:{id:project.id,revision:project.revision,digest:input.projectDigest},assemblyDigest:resolved.assemblyDigest,world:{id:w.id,revision:w.revision,hash:hashJson(w)}},
  robotId,baseFrameId:base.id,links,joints,drive,sensors,
  assumptions:uniqueSources(sourcesIn([links,drive,sensors]).filter(s=>s.kind==='assumed')),
  projection:{id:'physical-projection-v1',sourceSchemaHash},
 },'modelDigest');
}
