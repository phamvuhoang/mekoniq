import Ajv,{type ErrorObject} from 'ajv';
import addFormats from 'ajv-formats';
import {hashPayload,type JsonValue} from '../../../contracts/src/index';
import type {LabProjectV2,LabActionV2,CreateRunRequest,LabRunSnapshotV2,TwinSampleV2,AssetRevision,CoffeeRecipe,CellCommand,CellObservation,LabEvidenceV2,ArmCommand,ArmObservation} from '../../../contracts/generated/lab-v2';
import faultScheduleSchema from '../../../contracts/schemas/lab-fault-schedule.schema.json';
import projectSchema from '../../../contracts/schemas/lab-project-v2.schema.json';
import runSchema from '../../../contracts/schemas/lab-run-v2.schema.json';
import actionSchema from '../../../contracts/schemas/lab-action-v2.schema.json';
import sampleSchema from '../../../contracts/schemas/twin-sample-v2.schema.json';
import assetSchema from '../../../contracts/schemas/asset-revision.schema.json';
import recipeSchema from '../../../contracts/schemas/coffee-recipe.schema.json';
import commandSchema from '../../../contracts/schemas/cell-command.schema.json';
import observationSchema from '../../../contracts/schemas/cell-observation.schema.json';
import evidenceSchema from '../../../contracts/schemas/lab-evidence-v2.schema.json';
import armCommandSchema from '../../../contracts/schemas/arm-command.schema.json';
import armObservationSchema from '../../../contracts/schemas/arm-observation.schema.json';
export type {LabProjectV2,LabActionV2,CreateRunRequest,LabRunSnapshotV2,TwinSampleV2,AssetRevision,CoffeeRecipe,CellCommand,CellObservation,LabEvidenceV2,ArmCommand,ArmObservation};
export interface Issue {path:string;code:string;message:string;}
export type Validated<T>={ok:true;value:T}|{ok:false;issues:Issue[]};
const ajv=new Ajv({allErrors:true,strict:true,discriminator:true});addFormats(ajv);
// The arm bridge schemas $ref the cell schemas by file name (the generator resolves files); Ajv resolves them under the same key.
ajv.addSchema(faultScheduleSchema,'lab-fault-schedule.schema.json');
ajv.addSchema(commandSchema,'cell-command.schema.json');ajv.addSchema(observationSchema,'cell-observation.schema.json');
// Property names a caller must never supply: authority comes from the server session and catalog, never the body.
const ACTOR=/actor|role|principal|owner|operator|user/i,ENDPOINT=/endpoint|url|uri|host|address|socket|topic|^ip$|^port$/i,RAW=/gcode|halcmd|shell|script|command$/i,MODE=/^(mode|access|backends?|backendSetId)$/i;
export const classifyField=(name:string)=>MODE.test(name)?'MODE_IMMUTABLE':ACTOR.test(name)?'ACTOR_FORBIDDEN':ENDPOINT.test(name)?'ENDPOINT_FORBIDDEN':RAW.test(name)?'RAW_COMMAND_FORBIDDEN':'UNKNOWN_FIELD';
function issues(errors:ErrorObject[]|null|undefined,prefix=''):Issue[]{
 return (errors??[]).filter(e=>e.keyword!=='if').map(e=>{
  const path=prefix+e.instancePath;
  if(e.keyword==='additionalProperties')return {path,code:classifyField(String(e.params.additionalProperty)),message:`Property "${String(e.params.additionalProperty)}" is not allowed`};
  if(e.keyword==='required')return {path,code:'FIELD_REQUIRED',message:`Missing "${String(e.params.missingProperty)}"`};
  return {path,code:'INVALID_FIELD',message:e.message??'invalid'};
 });
}
function compile<T>(schema:object,ref?:string,extra?:(value:T)=>Issue[]){
 const id=(schema as {$id:string}).$id;
 if(!ajv.getSchema(id))ajv.addSchema(schema);
 const validate=ajv.getSchema(ref??id)!;
 return (value:unknown):Validated<T>=>{
  if(!validate(value))return {ok:false,issues:issues(validate.errors)};
  const more=extra?.(value as T)??[];
  return more.length?{ok:false,issues:more}:{ok:true,value:value as T};
 };
}
export const validateProjectV2=compile<LabProjectV2>(projectSchema);
export const validateRunSnapshotV2=compile<LabRunSnapshotV2>(runSchema);
const checkRun=compile<CreateRunRequest>(runSchema,'mekoniq.lab-run.v2#/definitions/CreateRunRequest');
export function validateRunRequestV2(value:unknown):Validated<CreateRunRequest>{
 const shape=checkRun(value);
 if(!shape.ok)return shape;
 if(shape.value.project===undefined&&shape.value.engineeringRef===undefined)return {ok:false,issues:[{path:'/project',code:'FIELD_REQUIRED',message:'Missing "project" (or "engineeringRef" for an engineering run)'}]};
 // An engineering request carries engineeringRef instead of (or equal to) a project; the gateway derives the project from the bundle.
 const project=shape.value.project===undefined?undefined:validateProjectV2(shape.value.project);
 return !project||project.ok?shape:{ok:false,issues:project.issues.map(i=>({...i,path:'/project'+i.path}))};
}
const checkAction=compile<LabActionV2>(actionSchema);
const MODE_KIND=/^(set|update|change)(Mode|Backend|Access)/;
export function validateActionV2(value:unknown):Validated<LabActionV2>{
 const kind=(value as {kind?:unknown}|null)?.kind;
 if(typeof kind==='string'&&MODE_KIND.test(kind))return {ok:false,issues:[{path:'/kind',code:'MODE_IMMUTABLE',message:'Mode, backend and access are fixed for the life of a run; create a new run'}]};
 const allowed=(actionSchema.oneOf as {properties:{kind:{const:string}}}[]).map(b=>b.properties.kind.const);
 if(typeof kind!=='string'||!allowed.includes(kind))return {ok:false,issues:[{path:'/kind',code:'ACTION_KIND_FORBIDDEN',message:'Action kind is not in the allowlist'}]};
 return checkAction(value);
}
export const validateTwinSampleV2=compile<TwinSampleV2>(sampleSchema);
export const validateAssetRevision=compile<AssetRevision>(assetSchema);
export const validateCoffeeRecipe=compile<CoffeeRecipe>(recipeSchema,undefined,recipe=>{
 // JSON Schema's uniqueItems compares whole rows; stock movement identity requires uniqueness by resource id and allocation step id.
 const issues:Issue[]=[],resources=new Set<string>();
 recipe.resources.forEach((resource,index)=>{
  if(resources.has(resource.resourceId))issues.push({path:`/resources/${index}/resourceId`,code:'DUPLICATE_RESOURCE_ID',message:'Each resourceId must occur once; use per-step allocations for repeated ingredients'});
  resources.add(resource.resourceId);
  const steps=new Set<string>();
  resource.allocations?.forEach((allocation,allocationIndex)=>{
   if(steps.has(allocation.stepId))issues.push({path:`/resources/${index}/allocations/${allocationIndex}/stepId`,code:'DUPLICATE_RESOURCE_ALLOCATION',message:'Each stepId must occur once within a resource allocation'});
   steps.add(allocation.stepId);
  });
 });
 return issues;
});
export const validateCellCommand=compile<CellCommand>(commandSchema,undefined,c=>hashPayload(c.payload as JsonValue)===c.payloadHash?[]:[{path:'/payloadHash',code:'PAYLOAD_HASH_MISMATCH',message:'payloadHash does not match canonical payload'}]);
export const validateCellObservation=compile<CellObservation>(observationSchema);
export const validateEvidenceV2=compile<LabEvidenceV2>(evidenceSchema);
/** arm.command.v1: the inner command must also pass validateCellCommand (payload hash); the envelope adds owner/lease/epoch/expectations only. */
const ARM_SHAPES=['command','acquire','release','renew','reconcile','local','revoke','simScene','barrier'] as const;
export const validateArmCommand=compile<ArmCommand>(armCommandSchema,undefined,m=>ARM_SHAPES.filter(k=>k in m&&m[k]!==undefined).length!==1?[{path:'',code:'MESSAGE_SHAPE_AMBIGUOUS',message:'exactly one of command/acquire/release/renew/reconcile/local/revoke/simScene/barrier'}]:m.command?(validateCellCommand(m.command).ok?[]:[{path:'/command',code:'INVALID_FIELD',message:'inner cell command invalid'}]):[]);
export const validateArmObservation=compile<ArmObservation>(armObservationSchema);
/** An observation only counts for the command it echoes: same command, device, epoch and payload. */
export function matchObservation(command:CellCommand,observation:CellObservation):{ok:boolean;reasonCodes:string[]}{
 const ok=command.commandId===observation.commandId&&command.deviceId===observation.deviceId&&command.controlEpoch===observation.controlEpoch&&command.payloadHash===observation.payloadHash;
 return {ok,reasonCodes:ok?[]:['OBSERVATION_IDENTITY_MISMATCH']};
}
