import {validateXarmMappingRecord} from './xarm-mapping';
// Static admission for explicitly pinned preparation profiles. No workers, imports from input, or live probes.
import {r2aDocumentBinding,validateR2aDocuments} from './native-handoff-r2a';
import {createHash} from 'node:crypto';
import {canonicalize} from 'json-canonicalize';
import {isDeepStrictEqual as same} from 'node:util';
import type {NativeHandoffV1,HandoffDocumentBinding} from '../../../../contracts/generated/native-handoff';
import {validateProjectV2} from '../contracts';
import {validateComponentRevision,validateEngineeringProject,type ComponentRevision,type Joint,type Link} from '../../engineering/contracts';
import {inertiaProblems} from '../../engineering/inertia';
import {projectNavigationModel} from '../../engineering/navigation-model';
import {validateNavigationDocument,validateArmCellScene,type RobotPhysicalModelV1,type LabWorldSceneV1,type NavigationSceneV1} from '../navigation2d/contracts';
import {validateWorldScene} from '../simulation3d/world-scene';
import {validateLoadProfile} from '../simulation3d/load-profile';
import {validateArmCollisionProfile} from '../models/arm-scene';
import {XARM6_SI,toSI,type ArmSourceModel} from '../models/arm-kinematics';
import component from '../../../../../robotics/simulation-mujoco/fixtures/coffee-delivery-cell-v1/arm-component.json';
import physical from '../../../../../robotics/simulation-mujoco/fixtures/coffee-delivery-cell-v1/mobile-physical.json';
import load from '../../../../../robotics/simulation-mujoco/fixtures/coffee-delivery-cell-v1/empty-load.json';
import cell from '../../../../../robotics/simulation-mujoco/fixtures/coffee-delivery-cell-v1/lab-world-scene.json';
import world from '../../../../../robotics/simulation-mujoco/fixtures/coffee-delivery-world-v1/lab-world-scene.json';
import project from '../../../../../robotics/simulation-mujoco/fixtures/coffee-delivery-cell-v1/project.json';
import pumaDh from '../../../../../integrations/arm-controller/models/puma560-reference/modified-dh.json';
import pumaManifest from '../../../../../integrations/arm-controller/models/puma560-reference/manifest.json';
import pumaFrames from '../../../../../integrations/arm-controller/models/puma560-reference/frames.json';
import pumaConfig from '../../../../../integrations/arm-controller/configs/sim/puma560/profile.json';
import pumaScenario from '../../../../../tests/fixtures/digital-twin/sil/bv01.json';
import projectSchema from '../../../../contracts/schemas/lab-project-v2.schema.json';
import componentSchema from '../../../../contracts/schemas/engineering-component.schema.json';
import worldSchema from '../../../../contracts/schemas/lab-world-scene-v1.schema.json';
import physicalSchema from '../../../../contracts/schemas/robot-physical-model-v1.schema.json';
import navigationSchema from '../../../../contracts/schemas/navigation-model-2d-v1.schema.json';
import sceneSchema from '../../../../contracts/schemas/navigation-scene-v1.schema.json';
import cellSchema from '../../../../contracts/schemas/arm-cell-scene-v1.schema.json';
import nativeNavigationManifest from '../../../../../robotics/simulation/fixtures/engineering-navigation-v1/compiler-manifest.json';
import nativeNavigationMapping from '../../../../../robotics/simulation/fixtures/engineering-navigation-v1/native-mapping.json';
import engineeringAmd64 from '../../../../../robotics/simulation/profiles/engineering-amd64.lock.json';
import engineeringArm64 from '../../../../../robotics/simulation/profiles/engineering-arm64.lock.json';
import navProject from '../../../../../robotics/simulation-3d/fixtures/serve-3d-v1/serve-3d-project.json';
import navScene from '../../../../../robotics/simulation-3d/fixtures/serve-3d-v1/navigation-scene.json';
import navPhysical from '../../../../../robotics/simulation-3d/fixtures/serve-3d-v1/physical-model-amr-1.json';
import engineeringProjectSchema from '../../../../contracts/schemas/engineering-project.schema.json';
import loadSchema from '../../../../contracts/schemas/load-profile-v1.schema.json';
const SCHEMAS={'load-profile-v1.schema.json':loadSchema,'engineering-project.schema.json':engineeringProjectSchema,'lab-project-v2.schema.json':projectSchema,'engineering-component.schema.json':componentSchema,'lab-world-scene-v1.schema.json':worldSchema,'robot-physical-model-v1.schema.json':physicalSchema,'navigation-model-2d-v1.schema.json':navigationSchema,'navigation-scene-v1.schema.json':sceneSchema,'arm-cell-scene-v1.schema.json':cellSchema};
export type DocumentIssue={code:string;path:string;severity:'error'|'prerequisite'};
const hash=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex'),canonical=(v:unknown)=>hash(canonicalize(v));
const pumaModel=toSI({id:pumaDh.id,convention:'modified_dh',provenance:'illustrative_reference',mekoniqRobotCode:null,units:pumaDh.units as ArmSourceModel['units'],joints:pumaDh.joints.map(j=>({name:j.name,alpha:j.alpha,a:j.a,d:j.d,thetaOffset:j.thetaOffset,min:j.min,max:j.max,maxVelocity:j.maxVelocity})),toolTranslation:pumaDh.toolTranslation as [number,number,number],tolerances:pumaManifest.tolerances});
const WORLD_KINDS=['mujoco_world_v1','mujoco_cell_v1','xarm_ros_canonical_v1'];
/** Authoring helper for the supported pinned reference profiles; this never derives expected compatibility from caller documents. */
export function nativeDocumentBinding(kind:string):HandoffDocumentBinding{
 if(kind==='mujoco_r2a_arm_v1')return r2aDocumentBinding();
 if(kind==='puma_controller_reference_v1')return {
  kind,modelRevision:pumaManifest.hashes['modified-dh.json'],siModelRevision:pumaModel.revision,sourceUnits:{length:'inch',angle:'deg',alpha:'rad'},lengthToM:0.0254,angleToRad:Math.PI/180,
  frameMap:{world:'world',robotBase:pumaManifest.frames.base,armBase:pumaManifest.frames.base,flange:pumaManifest.frames.flange,tcp:pumaManifest.frames.tcp,tree:pumaFrames.frames,toolRevision:pumaFrames.toolRevision,drive:null,tray:null,sensors:[],simulationPlacement:pumaConfig.simulationScene.worldFromArmBaseM,placementProvenance:'illustrative_simulation_only'},
  jointMap:pumaModel.jointNames.map((id,i)=>({id,controllerJoint:`JOINT_${i}`,sign:pumaManifest.axisSign[i] as 1,zeroOffsetRad:pumaManifest.zeroOffsetDeg[i]!*Math.PI/180,lowerRad:pumaModel.limits[i]!.min,upperRad:pumaModel.limits[i]!.max,velocityRadS:pumaModel.limits[i]!.maxVelocity})),inertiaOrder:'unknown'};
 if(kind==='engineering_navigation_ros_canonical_v1'){
  const physical=navPhysical as unknown as RobotPhysicalModelV1;
  return {kind,modelRevision:physical.modelDigest,siModelRevision:physical.modelDigest,sourceUnits:{length:'m',angle:'rad',alpha:'rad'},lengthToM:1,angleToRad:1,
   frameMap:{world:'map',robotBase:physical.baseFrameId,armBase:null,flange:null,tcp:null,mobileTree:physical.joints.map(j=>({id:j.child,parent:j.parent,origin:j.origin,kind:j.kind})),drive:{parent:physical.baseFrameId,pose:physical.drive!.driveFrameInBase},tray:null,sensors:physical.sensors.map(s=>({id:s.sensorId,parent:s.parentLinkId,pose:s.poseInBase}))},
   jointMap:physical.joints.filter((j):j is Extract<Joint,{kind:'continuous'}>=>j.kind==='continuous').map(j=>({id:j.id,controllerJoint:j.id,sign:1,zeroOffsetRad:0,lowerRad:null,upperRad:null,velocityRadS:j.limits.velocity.value})),inertiaOrder:'xx_xy_xz_yy_yz_zz'};
 }
 if(!WORLD_KINDS.includes(kind))throw Error('DOCUMENT_PROFILE_UNSUPPORTED');
 const model=component as unknown as ComponentRevision,scene=(kind==='mujoco_world_v1'?world:cell) as unknown as LabWorldSceneV1;
 return {kind,modelRevision:XARM6_SI.revision,siModelRevision:XARM6_SI.revision,sourceUnits:{length:'m',angle:'rad',alpha:'rad'},lengthToM:1,angleToRad:1,
  frameMap:{world:'map',robotBase:'base',armBase:'base',baseInMap:scene.armCell.arm.baseInMap,flange:'link6',tcp:'tcp',tcpInFlange:{translationM:[...XARM6_SI.toolM],quaternionXyzw:[0,0,0,1]},armTree:model.joints.map(j=>({id:j.child,parent:j.parent,origin:j.origin,kind:j.kind})),mobileBase:physical.baseFrameId,mobileTree:physical.joints.map(j=>({id:j.child,parent:j.parent,origin:j.origin,kind:j.kind})),drive:{parent:physical.baseFrameId,pose:physical.drive.driveFrameInBase},tray:load.supports,sensors:physical.sensors.map(s=>({id:s.sensorId,parent:s.parentLinkId,pose:s.poseInBase}))},
  jointMap:model.joints.filter(j=>/^J[1-6]$/.test(j.id)).map(j=>{const l=(j as Extract<Joint,{kind:'revolute'|'prismatic'}>).limits;return {id:j.id,controllerJoint:j.id,sign:1,zeroOffsetRad:0,lowerRad:l.lower.value,upperRad:l.upper.value,velocityRadS:l.velocity.value};}),inertiaOrder:'xx_xy_xz_yy_yz_zz'};
}
function physicalTree(links:Link[],joints:Joint[],root:string){
 const ids=new Set(links.map(l=>l.id)),parents=new Set<string>(),seen=new Set([root]);
 if(ids.size!==links.length||!ids.has(root))throw Error('MODEL_FRAME_INVALID');
 for(const j of joints){if(!ids.has(j.parent)||!ids.has(j.child)||j.parent===j.child||parents.has(j.child)||j.child===root)throw Error('MODEL_FRAME_INVALID');parents.add(j.child);if(j.kind!=='fixed'&&Math.abs(Math.hypot(...j.axis)-1)>1e-6)throw Error('MODEL_AXIS_INVALID');}
 for(let count=0;count<links.length;count++){const before=seen.size;for(const j of joints)if(seen.has(j.parent))seen.add(j.child);if(seen.size===before)break;}
 if(seen.size!==ids.size)throw Error('MODEL_FRAME_INVALID');
 for(const l of links)if(l.massKg.unit!=='kg'||l.massKg.value<=0||l.inertiaKgM2===null||inertiaProblems(l.inertiaKgM2).length)throw Error('MODEL_INERTIA_INVALID');
}
/** Full JSON is compared to a supported pinned adaptation, not an ignore mask over standalone scene errors. */
export function validateNativeDocuments(m:NativeHandoffV1,contents:ReadonlyMap<string,Buffer>):DocumentIssue[]{
 const issues:DocumentIssue[]=[],add=(code:string,path:string,severity:DocumentIssue['severity']='error')=>issues.push({code,path,severity});
 const read=(role:'project'|'world'|'model')=>{try{return JSON.parse(contents.get(m.refs[role][0].path)!.toString('utf8')) as unknown;}catch{throw Error('DOCUMENT_JSON_INVALID');}};
 const all=Object.entries(m.refs).filter(([role])=>role!=='nativeMapping').flatMap(([,refs])=>refs),bySource=(path:string)=>{const refs=all.filter(r=>r.sourcePath===path);if(refs.length!==1)throw Error('DOCUMENT_DEPENDENCY_MISSING');return contents.get(refs[0]!.path)!;};
 try{
  if(m.refs.nativeMapping&&m.profile.documents.kind!=='xarm_ros_canonical_v1')throw Error('NATIVE_MAPPING_KIND_MISMATCH');
  if(m.profile.documents.kind==='mujoco_r2a_arm_v1'){validateR2aDocuments(m,contents);return issues;}
  for(const [name,schema]of Object.entries(SCHEMAS)){const ref=m.refs.schema.find(r=>r.sourcePath===name);if(!ref)throw Error('DOCUMENT_SCHEMA_MISSING');if(!same(JSON.parse(contents.get(ref.path)!.toString()),schema))throw Error('DOCUMENT_SCHEMA_UNSUPPORTED');}
  const p=read('project'),w=read('world'),model=read('model'),kind=m.profile.documents.kind,binding=nativeDocumentBinding(kind);
  if(kind==='engineering_navigation_ros_canonical_v1'){
   if(m.subject.executionKind!=='ros2_native'||m.profile.installation.kind!=='native_apt')throw Error('DOCUMENT_PROFILE_UNSUPPORTED');
   if(!validateEngineeringProject(p).ok||!validateNavigationDocument(w).ok||!validateNavigationDocument(model).ok)throw Error('DOCUMENT_NAVIGATION_INVALID');
   const scene=w as NavigationSceneV1,mobile=model as RobotPhysicalModelV1;
   physicalTree(mobile.links,mobile.joints,mobile.baseFrameId);
   if(mobile.robotId!==m.profile.modelId||!same(m.profile.documents,binding)||m.frames.world!=='map'||m.frames.robotBase!==mobile.baseFrameId||m.frames.tool!==null)throw Error('DOCUMENT_MAPPING_MISMATCH');
   if(!same(p,navProject)||!same(w,navScene)||!same(model,navPhysical)||canonical(p)!==mobile.inputs.project.digest||!same(scene.inputs,mobile.inputs)||canonical((p as typeof navProject).runtimeProject.world)!==scene.inputs.world.hash||!same(projectNavigationModel(mobile,scene.policy),scene.robots[0]!.model))throw Error('NAVIGATION_PROJECT_MODEL_MISMATCH');
   if(!m.refs.engine.some(r=>r.sourcePath==='robotics/simulation-3d/requirements.lock'))throw Error('DOCUMENT_ENGINE_MISMATCH');
   const base='robotics/simulation/fixtures/engineering-navigation-v1/';
   if(!m.refs.engine.some(r=>r.sourcePath===base+'compiler-manifest.json')){add('NATIVE_ENGINE_MAPPING_UNRESOLVED','/profile/documents','prerequisite');return issues;}
   if(!same(JSON.parse(bySource(base+'compiler-manifest.json').toString()),nativeNavigationManifest)||!same(JSON.parse(bySource(base+'native-mapping.json').toString()),nativeNavigationMapping))throw Error('NATIVE_ENGINE_MAPPING_MISMATCH');
   for(const output of nativeNavigationManifest.outputs){
    const ref=all.find(r=>r.sourcePath===base+output.path);
    if(!ref){add('NATIVE_ARTIFACT_CLOSURE_MISSING','/refs/engine','prerequisite');break;}
    if(hash(contents.get(ref.path)!)!==output.sha256)throw Error('NATIVE_ARTIFACT_MAPPING_MISMATCH');
   }
   const lock=m.profile.architecture==='amd64'?engineeringAmd64:engineeringArm64;
   // Static mapping is now explicit. Installed package/plugin qualification is a separate unresolved gate.
   if(m.profile.id!==lock.id||lock.qualification!=='qualified'||!lock.packages||!lock.digests)add('NATIVE_ENGINE_PROFILE_UNRESOLVED','/profile','prerequisite');
   return issues;
  }
  if(!validateProjectV2(p).ok)throw Error('DOCUMENT_PROJECT_INVALID');
  if(!same(m.profile.documents,binding))throw Error('DOCUMENT_MAPPING_MISMATCH');
  if(m.frames.world!==binding.frameMap.world||m.frames.robotBase!==binding.frameMap.robotBase||m.frames.tool!==binding.frameMap.tcp)throw Error('DOCUMENT_FRAME_MISMATCH');
  if(kind==='puma_controller_reference_v1'){
   if(m.subject.executionKind!=='linuxcnc_native'||m.profile.installation.kind!=='native_apt'||!m.subject.nativeClosureHash)throw Error('DOCUMENT_PROFILE_UNSUPPORTED');
   const base='integrations/arm-controller/models/puma560-reference/',manifest=JSON.parse(bySource(base+'manifest.json').toString()) as typeof pumaManifest,frames=JSON.parse(bySource(base+'frames.json').toString()) as typeof pumaFrames;
   if(!same(manifest,pumaManifest)||!same(model,pumaDh)||!same(frames,pumaFrames)||m.profile.modelId!==pumaDh.id)throw Error('PUMA_CANONICAL_MODEL_MISMATCH');
   for(const [name,sha]of Object.entries(manifest.hashes)){const bytes=name==='modified-dh.json'?contents.get(m.refs.model[0].path)!:bySource(base+name);if(hash(bytes)!==sha)throw Error('PUMA_MODEL_REF_MISMATCH');}
   if(hash(bySource(base+'origin/puma560_dh.hal'))!==manifest.origin.files['configs/sim/axis/vismach/puma/puma560_dh.hal'].vendoredSha256)throw Error('PUMA_MODEL_REF_MISMATCH');
   const config=JSON.parse(contents.get(m.refs.engine[0].path)!.toString());if(!same(config,pumaConfig)||config.model.manifestSha256!==hash(bySource(base+'manifest.json'))||config.hardware.enabled!==false)throw Error('PUMA_CONTROLLER_PROFILE_MISMATCH');
   if(!same(p,pumaScenario.project)||!same(w,pumaScenario.project.world))throw Error('DOCUMENT_PROJECT_WORLD_MISMATCH');
   return issues;
  }
  if(kind==='xarm_ros_canonical_v1'){
   if(m.subject.executionKind!=='ros2_native'||m.profile.installation.kind!=='native_apt')throw Error('DOCUMENT_PROFILE_UNSUPPORTED');
   if(!m.refs.nativeMapping)add('NATIVE_MODEL_MAPPING_UNRESOLVED','/profile/documents','prerequisite');
   else {
    const refs=m.refs.nativeMapping,urdf=refs.find(r=>r.sourcePath==='native-xarm/expanded.urdf'),mapping=refs.find(r=>r.sourcePath==='native-xarm/mapping.json');
    if(!urdf||!mapping||refs.length!==2)throw Error('NATIVE_MAPPING_ARTIFACT_MISMATCH');
    if(contents.get(mapping.path)!.length>1_000_000||contents.get(urdf.path)!.length>4_000_000)throw Error('NATIVE_MAPPING_TOO_LARGE');
    const record=JSON.parse(contents.get(mapping.path)!.toString());validateXarmMappingRecord(contents.get(urdf.path)!.toString(),record,{sourceCommit:m.subject.sourceCommit,profileId:m.profile.id,architecture:m.profile.architecture,modelSha256:m.profile.modelSha256});
    if(record.evidenceKind==='protocol_double')add('NATIVE_MAPPING_PROTOCOL_DOUBLE','/refs/nativeMapping','prerequisite');
   }
   const lock=m.profile.architecture==='amd64'?engineeringAmd64:engineeringArm64;
   if(m.profile.id!==lock.id||lock.qualification!=='qualified'||!lock.packages||!lock.digests)add('NATIVE_ENGINE_PROFILE_UNRESOLVED','/profile','prerequisite');
  }else if(m.subject.executionKind!=='mujoco_image'||m.profile.installation.kind!=='oci')throw Error('DOCUMENT_PROFILE_UNSUPPORTED');
  validateWorldScene(w);const scene=w as LabWorldSceneV1,expected=(kind==='mujoco_world_v1'?world:cell) as unknown as LabWorldSceneV1;
  if(!validateComponentRevision(model).ok)throw Error('DOCUMENT_MODEL_INVALID');
  const arm=model as ComponentRevision;physicalTree(arm.links,arm.joints,'base');
  if(arm.id!==m.profile.modelId||arm.id!==scene.armCell.arm.modelId||!same(arm,component))throw Error('MODEL_CANONICAL_MISMATCH');
  if(!same(p,project)||canonical(p)!==scene.inputs.projectDigest)throw Error('DOCUMENT_PROJECT_WORLD_MISMATCH');
  // B05/B06 intentionally preserve the original projection input identity while replacing the outer world.
  // Exact full-scene equality below scopes these differences after independently checking the source projection.
  const files=new Map<string,Buffer>();for(const f of scene.files){const r=all.find(r=>r.sourcePath.endsWith('/'+f.path)&&r.sha256===f.sha256&&r.bytes===f.bytes);if(!r)throw Error('WORLD_DOCUMENT_REF_MISMATCH');files.set(f.path,contents.get(r.path)!);}
  const mobile=JSON.parse(files.get(scene.models.mobilePhysical.path)!.toString()) as RobotPhysicalModelV1;
  if(!validateNavigationDocument(mobile).ok||!validateNavigationDocument(scene.navigation.robots[0]!.model).ok||!validateArmCellScene(scene.armCell).ok)throw Error('DOCUMENT_MODEL_INVALID');
  physicalTree(mobile.links,mobile.joints,mobile.baseFrameId);
  if(mobile.modelDigest!==scene.inputs.mobileModelDigest||!same(mobile.inputs,scene.navigation.robots[0]!.model.inputs)||!same(projectNavigationModel(mobile,scene.navigation.policy),scene.navigation.robots[0]!.model))throw Error('MOBILE_PROJECTION_MISMATCH');
  if(!same(scene,expected))throw Error('DOCUMENT_PROJECT_WORLD_MISMATCH');
  if(!same(mobile,physical)||!same(JSON.parse(files.get(scene.models.armComponent.path)!.toString()),arm))throw Error('WORLD_MODEL_BINDING_MISMATCH');
  const empty=JSON.parse(files.get(scene.models.emptyLoad.path)!.toString());if(!validateLoadProfile(empty).ok||empty.modelRef.sha256!==hash(files.get(scene.models.mobilePhysical.path)!)||!same(empty,load))throw Error('WORLD_FRAME_BINDING_MISMATCH');
  const checked=validateProjectV2(p);if(!checked.ok||!checked.value.armCollisionProfile)throw Error('DOCUMENT_PROJECT_INVALID');validateArmCollisionProfile(checked.value.armCollisionProfile,XARM6_SI);
  if(!same(checked.value.armCollisionProfile.baseInMap,scene.armCell.arm.baseInMap))throw Error('DOCUMENT_FRAME_MISMATCH');
  if(!m.refs.engine.some(r=>r.sourcePath==='robotics/simulation-mujoco/requirements.lock'&&/\nmujoco==3\.17\.0\s/.test(contents.get(r.path)!.toString())))throw Error('DOCUMENT_ENGINE_MISMATCH');
 }catch(e){add(e instanceof Error?e.message:'DOCUMENT_INVALID','/profile/documents');}
 return issues;
}
