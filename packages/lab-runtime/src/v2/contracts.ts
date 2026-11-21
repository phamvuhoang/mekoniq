import Ajv,{type ErrorObject} from 'ajv';
import addFormats from 'ajv-formats';
import {hashPayload,type JsonValue} from '../../../contracts/src/index';
import type {LabProjectV2,LabActionV2,CreateRunRequest,LabRunSnapshotV2,TwinSampleV2,AssetRevision,CoffeeRecipe,CellCommand,CellObservation,LabEvidenceV2,ArmCommand,ArmObservation} from '../../../contracts/generated/lab-v2';
import faultScheduleSchema from '../../../contracts/schemas/lab-fault-schedule.schema.json';
import driveIoSchema from '../../../contracts/schemas/drive-io-v1.schema.json';
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
import {scenarioRegistry} from './scenario-registry';
import {BENCH_SET_ID} from './capabilities';
import {validateBenchRequestShape} from './control/drive-io';
import {validateGraspRequest} from './perception/perception-contracts';
export type {LabProjectV2,LabActionV2,CreateRunRequest,LabRunSnapshotV2,TwinSampleV2,AssetRevision,CoffeeRecipe,CellCommand,CellObservation,LabEvidenceV2,ArmCommand,ArmObservation};
export interface Issue {path:string;code:string;message:string;}
export type Validated<T>={ok:true;value:T}|{ok:false;issues:Issue[]};
const ajv=new Ajv({allErrors:true,strict:true,discriminator:true});addFormats(ajv);
// The arm bridge schemas $ref the cell schemas by file name (the generator resolves files); Ajv resolves them under the same key.
ajv.addSchema(faultScheduleSchema,'lab-fault-schedule.schema.json');ajv.addSchema(driveIoSchema,'drive-io-v1.schema.json');
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
 const v=shape.value,bench=v.bench;
 // a bench (R4.2) is a run of its own kind: only the two bench scenarios on the bench set, always with a bench request, and nothing of a mission run (its plant is built by the server, so no project or bundle)
 if(bench!==undefined||scenarioRegistry.get(v.scenarioId)?.bench){
  const scope=(message:string):Validated<CreateRunRequest>=>({ok:false,issues:[{path:'/bench',code:'BENCH_SCOPE_INVALID',message}]});
  if(bench===undefined||!scenarioRegistry.get(v.scenarioId)?.bench||v.mode!=='simulation'||v.backendSetId!==BENCH_SET_ID)return scope('A bench request runs only a bench scenario on engineering-mujoco-bench-v1, and a bench scenario only with a bench request');
  if(v.project!==undefined||v.engineeringRef!==undefined||v.worldExperimentId!==undefined||v.driveExperimentId!==undefined||v.driveFaultSchedule!==undefined)return scope('A bench plant is built by the server: no project, engineering bundle or run experiment (the drive experiment is the bench request\'s own)');
  const checked=validateBenchRequestShape(bench);
  if(!checked.ok)return {ok:false,issues:checked.reasonCodes.map(code=>({path:'/bench',code,message:'Invalid bench request'}))};
  return (bench as {scenarioId:string}).scenarioId===v.scenarioId?shape:scope('The bench request names another scenario than the run');
 }
 if(shape.value.project===undefined&&shape.value.engineeringRef===undefined)return {ok:false,issues:[{path:'/project',code:'FIELD_REQUIRED',message:'Missing "project" (or "engineeringRef" for an engineering run)'}]};
 if(shape.value.worldExperimentId&&(shape.value.mode!=='simulation'||shape.value.backendSetId!=='engineering-mujoco-cell-v1'||shape.value.scenarioId!=='MJ-CELL-BV01'))return {ok:false,issues:[{path:'/worldExperimentId',code:'WORLD_EXPERIMENT_SCOPE_INVALID',message:'Selection requires the registered shared-world cell'}]};
// R4.4 grasp modes: a belief grasp exists on the registered shared-world cell only; MJ-BV01 and every other scenario keep the fixed program
 const wantsBelief=shape.value.graspMode!==undefined&&shape.value.graspMode!=='fixed_program';
 // the registered cup nudge (R4-D33) is a belief-grasp experiment: the fixed program has no belief to be stale
 if(shape.value.worldExperimentId==='world-cup-nudge-v1'&&!wantsBelief)return {ok:false,issues:[{path:'/worldExperimentId',code:'WORLD_EXPERIMENT_SCOPE_INVALID',message:'The cup nudge needs a belief grasp mode'}]};
 if((wantsBelief||shape.value.recoveryPolicyId!==undefined)&&(shape.value.mode!=='simulation'||shape.value.backendSetId!=='engineering-mujoco-cell-v1'||shape.value.scenarioId!=='MJ-CELL-BV01'))return {ok:false,issues:[{path:'/graspMode',code:'GRASP_MODE_SCOPE_INVALID',message:'A belief grasp is selectable on the registered shared-world cell only'}]};
 {const g=validateGraspRequest(shape.value);if(!g.ok)return {ok:false,issues:g.reasonCodes.map(code=>({path:'/graspMode',code,message:'Invalid grasp request'}))};}
 // the browser-selectable ids are the ones health advertises; the study, lossy and out-of-region profiles are campaign inputs
 if(shape.value.perceptionProfileId!==undefined&&shape.value.perceptionProfileId!=='perception-nominal-v1')return {ok:false,issues:[{path:'/perceptionProfileId',code:'PERCEPTION_PROFILE_NOT_REGISTERED',message:'Not a profile this runtime offers'}]};
 if(shape.value.recoveryPolicyId!==undefined&&shape.value.recoveryPolicyId!=='pick-recovery-v1')return {ok:false,issues:[{path:'/recoveryPolicyId',code:'RECOVERY_POLICY_NOT_REGISTERED',message:'Not a recovery policy this runtime offers'}]};
 if(shape.value.driveExperimentId&&(shape.value.mode!=='simulation'||shape.value.backendSetId!=='engineering-mujoco-cell-v1'||shape.value.scenarioId!=='MJ-CELL-BV01'))return {ok:false,issues:[{path:'/driveExperimentId',code:'DRIVE_EXPERIMENT_SCOPE_INVALID',message:'A virtual drive is selectable on the registered shared-world cell only'}]};
 // drive faults (V08) exist only on a simulation run that has a drive model: the shared-world cell with a drive experiment, or an engineering run of the MuJoCo mobile set (whose own project names its experiment)
 if(shape.value.driveFaultSchedule?.length){
  const f=shape.value,cell=f.backendSetId==='engineering-mujoco-cell-v1'&&f.scenarioId==='MJ-CELL-BV01'&&!!f.driveExperimentId,mobile=f.backendSetId==='engineering-mujoco-3d-v1'&&f.engineeringRef!==undefined;
  if(f.mode!=='simulation'||!(cell||mobile))return {ok:false,issues:[{path:'/driveFaultSchedule',code:'FAULT_BACKEND_UNSUPPORTED',message:'Drive faults need a simulation run with a drive model: the shared-world cell with a drive experiment, or an engineering MuJoCo mobile run'}]};
 }
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
