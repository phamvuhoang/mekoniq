import Ajv,{type ErrorObject} from 'ajv';
import addFormats from 'ajv-formats';
import componentSchema from '../../../../contracts/schemas/engineering-component.schema.json';
import physicalSchema from '../../../../contracts/schemas/robot-physical-model-v1.schema.json';
import modelSchema from '../../../../contracts/schemas/navigation-model-2d-v1.schema.json';
import sceneSchema from '../../../../contracts/schemas/navigation-scene-v1.schema.json';
import reportSchema from '../../../../contracts/schemas/model-validation-report-v1.schema.json';
import workerSchema from '../../../../contracts/schemas/irsim-worker-v1.schema.json';
import evidenceSchema from '../../../../contracts/schemas/navigation-run-evidence-v1.schema.json';
import type {IRSimRequestV1,IRSimResponseV1,IRSimSnapshotV1,LidarScanV1,ModelValidationReportV1,NavigationModel2DV1,NavigationPolicyV1,NavigationRunEvidenceV1,NavigationSceneV1,RobotPhysicalModelV1} from '../../../../contracts/generated/navigation2d';
import {inertiaProblems} from '../../engineering/inertia';
import {hashJson} from '../hash';
export type {IRSimRequestV1,IRSimResponseV1,IRSimSnapshotV1,LidarScanV1,ModelValidationReportV1,NavigationModel2DV1,NavigationPolicyV1,NavigationRunEvidenceV1,NavigationSceneV1,RobotPhysicalModelV1};
export type {InputIdentity,ArtifactRef,Vec2,SensorMount,Lidar2DProjection} from '../../../../contracts/generated/navigation2d';

export interface NavigationIssue{path:string;code:string;message:string;}
export type NavigationDocument=RobotPhysicalModelV1|NavigationModel2DV1|NavigationSceneV1|ModelValidationReportV1;
export type NavigationCheck={ok:true;value:NavigationDocument}|{ok:false;issues:NavigationIssue[]};

const FILES:Record<string,object>={'engineering-component.schema.json':componentSchema,'robot-physical-model-v1.schema.json':physicalSchema,'navigation-model-2d-v1.schema.json':modelSchema,'navigation-scene-v1.schema.json':sceneSchema,'model-validation-report-v1.schema.json':reportSchema,'irsim-worker-v1.schema.json':workerSchema,'navigation-run-evidence-v1.schema.json':evidenceSchema};
const ajv=new Ajv({allErrors:true,strict:true,discriminator:true});addFormats(ajv);
for(const [key,schema] of Object.entries(FILES))ajv.addSchema(schema,key);
const KEYS:Record<string,{schema:string;digest:string}>={
 'robot-physical-model':{schema:'robot-physical-model-v1.schema.json',digest:'modelDigest'},
 'navigation-model-2d':{schema:'navigation-model-2d-v1.schema.json',digest:'modelDigest'},
 'navigation-scene':{schema:'navigation-scene-v1.schema.json',digest:'sceneDigest'},
 'model-validation-report':{schema:'model-validation-report-v1.schema.json',digest:'reportDigest'}};

const issue=(path:string,code:string,message:string):NavigationIssue=>({path,code,message});
function schemaIssues(errors:ErrorObject[]|null|undefined):NavigationIssue[]{
 return (errors??[]).filter(e=>!['if','oneOf','anyOf'].includes(e.keyword)).map(e=>e.keyword==='additionalProperty'||e.keyword==='additionalProperties'?issue(e.instancePath,'UNKNOWN_FIELD',`Property "${String(e.params.additionalProperty)}" is not allowed`)
  :e.keyword==='required'?issue(e.instancePath,'FIELD_REQUIRED',`Missing "${String(e.params.missingProperty)}"`):issue(e.instancePath,'INVALID_FIELD',e.message??'invalid'));
}
/** Canonical digest of a document without its own digest field (spec §1). */
export const documentDigest=(doc:object,field:string)=>{const {[field]:_,...rest}=doc as Record<string,unknown>;void _;return hashJson(rest);};
export const sealDocument=<T extends object>(doc:T,field:string):T=>({...doc,[field]:documentDigest(doc,field)});

const walk=(value:unknown,path:string,visit:(node:Record<string,unknown>,path:string)=>void)=>{
 if(Array.isArray(value))value.forEach((v,i)=>walk(v,`${path}/${i}`,visit));
 else if(value&&typeof value==='object'){visit(value as Record<string,unknown>,path);for(const [k,v] of Object.entries(value))walk(v,`${path}/${k}`,visit);}
};
function quaternionIssues(doc:unknown):NavigationIssue[]{
 const out:NavigationIssue[]=[];
 walk(doc,'',(n,path)=>{const q=n.quaternionXyzw;if(Array.isArray(q)&&q.length===4){const norm=Math.hypot(...(q as number[]));if(Math.abs(norm-1)>1e-6)out.push(issue(`${path}/quaternionXyzw`,'QUATERNION_NOT_NORMALIZED',`|q|=${norm}`));}});
 return out;
}
const dupes=(ids:string[],base:string)=>{const seen=new Set<string>();return ids.flatMap((id,i)=>seen.has(id)?[issue(`${base}/${i}`,'DUPLICATE_ID',id)]:(seen.add(id),[]));};
const cross=(o:[number,number],a:[number,number],b:[number,number])=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
const segmentsCross=(a:[number,number],b:[number,number],c:[number,number],d:[number,number])=>cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0;
/** Simple polygon without a repeated closing vertex or self-intersection; `ccw` also demands counter-clockwise order (footprints). */
export function polygonIssues(v:[number,number][],path:string,ccw=true):NavigationIssue[]{
 const n=v.length,area2=v.reduce((s,p,i)=>{const q=v[(i+1)%n]!;return s+p[0]*q[1]-q[0]*p[1];},0);
 const out:NavigationIssue[]=[];
 if(n>1&&v[0]![0]===v[n-1]![0]&&v[0]![1]===v[n-1]![1])out.push(issue(path,'POLYGON_CLOSED','the first vertex must not be repeated at the end'));
 if(Math.abs(area2)<1e-12)out.push(issue(path,'POLYGON_DEGENERATE','area must be positive'));
 else if(ccw&&area2<0)out.push(issue(path,'POLYGON_NOT_CCW','vertices must be counter-clockwise'));
 for(let i=0;i<n;i++)for(let j=i+2;j<n;j++){if(i===0&&j===n-1)continue;if(segmentsCross(v[i]!,v[(i+1)%n]!,v[j]!,v[(j+1)%n]!)){out.push(issue(path,'POLYGON_SELF_INTERSECTING',`edges ${i} and ${j} cross`));return out;}}
 return out;
}

function physicalRules(m:RobotPhysicalModelV1):NavigationIssue[]{
 const out=[...dupes(m.links.map(l=>l.id),'/links'),...dupes(m.joints.map(j=>j.id),'/joints'),...dupes(m.sensors.map(s=>s.sensorId),'/sensors')];
 m.links.forEach((l,i)=>{
  if(l.massKg.unit!=='kg')out.push(issue(`/links/${i}/massKg/unit`,'UNIT_NOT_ALLOWED',`"${l.massKg.unit}" must be kg`));
  if(l.inertiaKgM2===null)out.push(issue(`/links/${i}/inertiaKgM2`,'INERTIA_INVALID','inertia is unknown; a runnable physical model needs a tensor'));
  else{const bad=[...(l.massKg.value>0?[]:['NON_POSITIVE_MASS']),...inertiaProblems(l.inertiaKgM2)];if(bad.length)out.push(issue(`/links/${i}/inertiaKgM2`,'INERTIA_INVALID',bad.join(', ')));}
 });
 if(m.drive){
  if(m.drive.wheelRadiusM.unit!=='m')out.push(issue('/drive/wheelRadiusM/unit','UNIT_NOT_ALLOWED','must be m'));
  if(m.drive.wheelSeparationM.unit!=='m')out.push(issue('/drive/wheelSeparationM/unit','UNIT_NOT_ALLOWED','must be m'));
 }
 return out;
}
function modelRules(m:NavigationModel2DV1):NavigationIssue[]{
 const out=[...polygonIssues(m.footprint.verticesM as [number,number][],'/footprint/verticesM'),...dupes(m.sensors.map(s=>s.id),'/sensors')];
 m.sensors.forEach((s,i)=>{if(s.rangeMinM>=s.rangeMaxM)out.push(issue(`/sensors/${i}/rangeMinM`,'INVALID_FIELD','range minimum must be below maximum'));});
 return out;
}
const same=(a:unknown,b:unknown)=>hashJson(a)===hashJson(b);
function sceneRules(s:NavigationSceneV1):NavigationIssue[]{
 const out=[...dupes(s.robots.map(r=>r.robotId),'/robots'),...dupes(s.actors.map(a=>a.id),'/actors'),...dupes(s.zones.map(z=>z.id),'/zones'),...dupes([...s.world.obstacles,...s.world.boundaries].map(o=>o.id),'/world/obstacles')];
 if(!same({id:s.world.id,revision:s.world.revision,hash:s.world.hash},s.inputs.world))out.push(issue('/world','WORLD_MISMATCH','scene world differs from the pinned input world'));
 if(documentDigest(s.policy,'hash')!==s.policy.hash)out.push(issue('/policy/hash','DIGEST_MISMATCH','policy hash does not match its content'));
 s.robots.forEach((r,i)=>{
  const nested=validateNavigationDocument(r.model);
  if(!nested.ok)out.push(...nested.issues.map(x=>({...x,path:`/robots/${i}/model${x.path}`})));
  if(r.robotId!==r.model.robotId)out.push(issue(`/robots/${i}/robotId`,'ROBOT_MISMATCH',`model belongs to ${r.model.robotId}`));
  if(!same(r.model.inputs,s.inputs))out.push(issue(`/robots/${i}/model/inputs`,'INPUT_IDENTITY_MISMATCH','robot model was projected from different inputs than the scene'));
  if(!same(r.model.navigationPolicyRef,{id:s.policy.id,revision:s.policy.revision,hash:s.policy.hash}))out.push(issue(`/robots/${i}/model/navigationPolicyRef`,'POLICY_MISMATCH','robot model pins a different policy than the scene'));
 });
 for(const [k,list] of [['obstacles',s.world.obstacles],['boundaries',s.world.boundaries]] as const)list.forEach((o,i)=>out.push(...polygonIssues(o.verticesM as [number,number][],`/world/${k}/${i}/verticesM`,false)));
 s.zones.forEach((z,i)=>out.push(...polygonIssues(z.polygonM as [number,number][],`/zones/${i}/polygonM`,false)));
 return out;
}
/** pass requires: ran, no blocking issue, and every check pass. */
function reportRules(r:ModelValidationReportV1):NavigationIssue[]{
 if(r.result!=='pass')return r.result==='fail'&&r.execution==='not_run'?[issue('/result','REPORT_INCONSISTENT','a report that did not run cannot fail')]:[];
 const bad=r.execution!=='ran'?'execution is '+r.execution:r.issues.some(i=>i.severity==='error')?'it lists error issues':r.checks.some(c=>c.result!=='pass')?'a check did not pass':r.checks.length===0?'no check ran':'';
 return bad?[issue('/result','REPORT_INCONSISTENT',`result "pass" is not allowed: ${bad}`)]:[];
}

export function validateNavigationDocument(input:unknown):NavigationCheck{
 const type=input&&typeof input==='object'?(input as Record<string,unknown>).documentType:undefined;
 const meta=typeof type==='string'&&Object.hasOwn(KEYS,type)?KEYS[type]:undefined;
 if(!meta)return {ok:false,issues:[issue('/documentType','DOCUMENT_TYPE_UNKNOWN',`unsupported documentType ${String(type)}`)]};
 const validate=ajv.getSchema(meta.schema)!;
 if(!validate(input))return {ok:false,issues:schemaIssues(validate.errors)};
 const doc=input as NavigationDocument,issues=[...quaternionIssues(doc)];
 if(documentDigest(doc,meta.digest)!==(doc as unknown as Record<string,string>)[meta.digest])issues.push(issue('/'+meta.digest,'DIGEST_MISMATCH','digest does not match the document content'));
 if(type==='robot-physical-model')issues.push(...physicalRules(doc as RobotPhysicalModelV1));
 else if(type==='navigation-model-2d')issues.push(...modelRules(doc as NavigationModel2DV1));
 else if(type==='navigation-scene')issues.push(...sceneRules(doc as NavigationSceneV1));
 else issues.push(...reportRules(doc as ModelValidationReportV1));
 return issues.length?{ok:false,issues}:{ok:true,value:doc};
}

/** Server-owned navigation policy fixture `irsim-2d-default-v1` (values from the contracts spec); not a measured hardware limit. */
export function defaultNavigationPolicy():NavigationPolicyV1{
 const parameters:NavigationPolicyV1['parameters']={safetyMarginM:0.02,controller:'grid-diff-v1',gridResolutionM:0.05,headingCount:8,distanceCostPerM:1,rotationCostPerRad:0.2,maxPlannerStates:2000000,maxLinearMps:0.5,maxAngularRadps:1,maxAccelerationMps2:0.5,maxAngularAccelerationRadps2:1.5,
  goalPositionToleranceM:0.05,goalYawToleranceRad:0.05,stoppedLinearMps:0.01,stoppedAngularRadps:0.02,arrivalHoldTicks:5,replanEveryTicks:50,scanFreshnessTicks:5,noProgressTicks:250,goalDeadlineTicks:6000};
 const draft={schemaVersion:1 as const,id:'irsim-2d-default-v1',revision:1,source:{kind:'assumed' as const,documentId:'irsim-2d-default-v1',revision:'1',locator:'specs/2026-11-08-linkforge-irsim/contracts.md#navigation-policy',contentSha256:hashJson(parameters)},parameters};
 return {...draft,hash:documentDigest(draft,'hash')};
}
