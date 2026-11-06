import Ajv,{type ErrorObject} from 'ajv';
import addFormats from 'ajv-formats';
import type {ComponentRevision,EngineeringProject,EngineeringRef,EngineeringCompileInput,BundleReceipt,EngineeringArchive,EngineeringCandidate,Problem,ResolvedAssembly,CompiledScene,Scalar} from '../../../contracts/generated/engineering';
import faultScheduleSchema from '../../../contracts/schemas/lab-fault-schedule.schema.json';
import cellCommandSchema from '../../../contracts/schemas/cell-command.schema.json';
import cellObservationSchema from '../../../contracts/schemas/cell-observation.schema.json';
import projectV2Schema from '../../../contracts/schemas/lab-project-v2.schema.json';
import assetSchema from '../../../contracts/schemas/asset-revision.schema.json';
import recipeSchema from '../../../contracts/schemas/coffee-recipe.schema.json';
import componentSchema from '../../../contracts/schemas/engineering-component.schema.json';
import projectSchema from '../../../contracts/schemas/engineering-project.schema.json';
import bundleSchema from '../../../contracts/schemas/engineering-bundle.schema.json';
import archiveSchema from '../../../contracts/schemas/engineering-project-archive.schema.json';
import candidateSchema from '../../../contracts/schemas/engineering-candidate.schema.json';
import {classifyField} from '../v2/contracts';
export type {ComponentRevision,EngineeringProject,EngineeringRef,EngineeringCompileInput,BundleReceipt,EngineeringArchive,EngineeringCandidate,Problem,ResolvedAssembly,CompiledScene};
export type {Link,Joint,Port,Shape,Geometry,ModelRef,Instance,Connection,Assembly,Digest,Vec3,Pose,SourceRef,Scalar,EntityBinding,ResolvedModels,ModelDocument,Bom,BomLine,Placement,ResolvedPort,SceneFrame,WheelBinding} from '../../../contracts/generated/engineering';
export interface Checked{ok:boolean;problems:Problem[];}

const ajv=new Ajv({allErrors:true,strict:true,discriminator:true});addFormats(ajv);
// Cross-file $refs resolve by file name, exactly like the generator does.
for(const [key,schema] of Object.entries({'lab-fault-schedule.schema.json':faultScheduleSchema,'cell-command.schema.json':cellCommandSchema,'cell-observation.schema.json':cellObservationSchema,'lab-project-v2.schema.json':projectV2Schema,'asset-revision.schema.json':assetSchema,'coffee-recipe.schema.json':recipeSchema,'engineering-component.schema.json':componentSchema,'engineering-project.schema.json':projectSchema,'engineering-bundle.schema.json':bundleSchema,'engineering-project-archive.schema.json':archiveSchema,'engineering-candidate.schema.json':candidateSchema}))ajv.addSchema(schema,key);

const problem=(code:string,path:string,detail:string):Problem=>({code,path,blocking:true,detail});
function schemaProblems(errors:ErrorObject[]|null|undefined):Problem[]{
 return (errors??[]).filter(e=>e.keyword!=='if').map(e=>e.keyword==='additionalProperties'?problem(classifyField(String(e.params.additionalProperty)),e.instancePath,`Property "${String(e.params.additionalProperty)}" is not allowed`)
  :e.keyword==='required'?problem('FIELD_REQUIRED',e.instancePath,`Missing "${String(e.params.missingProperty)}"`)
  :problem('INVALID_FIELD',e.instancePath,e.message??'invalid'));
}
const shape=(key:string)=>{const validate=ajv.getSchema(key);if(!validate)throw new Error(`ENGINEERING_SCHEMA_MISSING ${key}`);return validate;};
const check=<T=unknown>(key:string,extra?:(value:T)=>Problem[])=>(input:unknown):Checked=>{
 const validate=shape(key);
 if(!validate(input))return {ok:false,problems:schemaProblems(validate.errors)};
 const problems=extra?.(input as T)??[];
 return {ok:problems.length===0,problems};
};

/** Units a Scalar may carry anywhere; fields with a fixed dimension are narrowed below. */
export const ALLOWED_UNITS=['1','m','kg','kg*m^2','rad','rad/s','rad/s^2','m/s','m/s^2','N','N*m','V','A','Ah','Wh','W','Ohm','s','Hz'] as const;
const QUATERNION_TOLERANCE=1e-6;
function walk(value:unknown,path:string,visit:(node:Record<string,unknown>,path:string)=>void){
 if(Array.isArray(value))value.forEach((v,i)=>walk(v,`${path}/${i}`,visit));
 else if(value&&typeof value==='object'){visit(value as Record<string,unknown>,path);for(const [k,v] of Object.entries(value))walk(v,`${path}/${k}`,visit);}
}
const poseProblems=(root:unknown,base=''):Problem[]=>{
 const out:Problem[]=[];
 walk(root,base,(node,path)=>{const q=node.quaternionXyzw;if(Array.isArray(q)&&q.length===4){const norm=Math.hypot(...(q as number[]));if(Math.abs(norm-1)>QUATERNION_TOLERANCE)out.push(problem('QUATERNION_NOT_NORMALIZED',`${path}/quaternionXyzw`,`|q|=${norm}`));}});
 return out;
};
const duplicates=(ids:string[],base:string):Problem[]=>{
 const seen=new Set<string>(),out:Problem[]=[];
 ids.forEach((id,i)=>{if(seen.has(id))out.push(problem('DUPLICATE_ID',`${base}/${i}/id`,id));seen.add(id);});
 return out;
};
const unit=(s:Scalar|undefined,expected:string[],path:string):Problem[]=>s&&!expected.includes(s.unit)?[problem('UNIT_NOT_ALLOWED',`${path}/unit`,`"${s.unit}" is not one of ${expected.join(', ')}`)]:[];

function componentRules(c:ComponentRevision):Problem[]{
 const out=[...poseProblems(c),...duplicates(c.links.map(l=>l.id),'/links'),...duplicates(c.joints.map(j=>j.id),'/joints'),...duplicates(c.ports.map(p=>p.id),'/ports')];
 const dimensioned=new Set<unknown>();
 c.links.forEach((l,i)=>{out.push(...unit(l.massKg,['kg'],`/links/${i}/massKg`));dimensioned.add(l.massKg);});
 c.ports.forEach((p,i)=>{if(p.continuousCurrentA){out.push(...unit(p.continuousCurrentA,['A'],`/ports/${i}/continuousCurrentA`));dimensioned.add(p.continuousCurrentA);}});
 c.joints.forEach((j,i)=>{
  if(j.kind==='fixed')return;
  const linear=j.kind==='prismatic',base=`/joints/${i}/limits`,l=j.limits as unknown as Record<string,Scalar>;
  const angle=linear?['m']:['rad'],speed=linear?['m/s']:['rad/s'],effort=linear?['N']:['N*m'];
  out.push(...unit(l.velocity,speed,`${base}/velocity`),...unit(l.effort,effort,`${base}/effort`));
  if(l.lower&&l.upper){out.push(...unit(l.lower,angle,`${base}/lower`),...unit(l.upper,angle,`${base}/upper`));if(l.lower.value>=l.upper.value)out.push(problem('JOINT_LIMITS_INVERTED',base,`lower ${l.lower.value} must be below upper ${l.upper.value}`));}
  Object.values(l).forEach(s=>dimensioned.add(s));
 });
 walk(c,'',(node,path)=>{if(typeof node.unit==='string'&&'value' in node&&!dimensioned.has(node)&&!(ALLOWED_UNITS as readonly string[]).includes(node.unit))out.push(problem('UNIT_NOT_ALLOWED',`${path}/unit`,`"${node.unit}" is not an allowed unit`));});
 return out;
}
export const validateComponentRevision=check<ComponentRevision>('engineering-component.schema.json',componentRules);

function projectRules(p:EngineeringProject):Problem[]{
 const out=[...duplicates(p.assembly.instances.map(i=>i.id),'/assembly/instances'),...duplicates(p.entityBindings.map(b=>b.entityId).map(String),'/entityBindings'),...poseProblems(p.assembly,'/assembly')];
 const bound=new Map<string,string>();
 p.entityBindings.forEach((b,i)=>b.instanceIds.forEach((id,j)=>{const other=bound.get(id);if(other&&other!==b.entityId)out.push(problem('DUPLICATE_INSTANCE_BINDING',`/entityBindings/${i}/instanceIds/${j}`,`${id} already bound to ${other}`));bound.set(id,b.entityId);}));
 return out;
}
export const validateEngineeringProject=check<EngineeringProject>('engineering-project.schema.json',projectRules);
export const validateEngineeringRef=check('engineering-bundle.schema.json#/definitions/EngineeringRef');
export const validateBundleReceipt=check('engineering-bundle.schema.json#/definitions/BundleReceipt');
export const validateResolvedAssembly=check('engineering-bundle.schema.json#/definitions/ResolvedAssembly');
export const validateCompiledScene=check('engineering-bundle.schema.json#/definitions/CompiledScene');
const nested=(base:string,r:Checked):Problem[]=>r.problems.map(p=>({...p,path:base+p.path}));
export const validateEngineeringArchive=check<EngineeringArchive>('engineering-project-archive.schema.json',a=>[
 ...nested('/project',validateEngineeringProject(a.project)),
 ...a.components.flatMap((c,i)=>nested(`/components/${i}`,validateComponentRevision(c))),
 ...duplicates(a.blobs.map(b=>b.digest),'/blobs')]);
export const validateEngineeringCandidate=check<EngineeringCandidate>('engineering-candidate.schema.json',c=>nested('/project',validateEngineeringProject(c.project)));

export type DocumentKind='engineering-project'|'engineering-project-archive'|'engineering-candidate'|'engineering-component'|'lab-project-v2'|'lab-project-v1'|'unknown';
const ENGINEERING_TYPES=new Set(['engineering-project','engineering-project-archive','engineering-candidate']);
/** documentType wins over schemaVersion: project v1 and every engineering document share schemaVersion 1. */
export function classifyDocument(input:unknown):DocumentKind{
 if(!input||typeof input!=='object'||Array.isArray(input))return 'unknown';
 const d=input as Record<string,unknown>;
 if('documentType' in d)return typeof d.documentType==='string'&&ENGINEERING_TYPES.has(d.documentType)&&d.schemaVersion===1?d.documentType as DocumentKind:'unknown';
 if(d.schemaVersion===2)return 'lab-project-v2';
 if(d.schemaVersion===1)return 'identity' in d&&'links' in d?'engineering-component':'lab-project-v1';
 return 'unknown';
}
