// R4-C §3 step 5 and R4-D44..D47 (V15): identify a few registered parameters of a drive/joint model from measured trials, by running again, on the candidate model, the very bench each trial ran (HeadlessBench).
// The fit sees the `tune` split alone; the verdict comes from the held-out `validation` split through assessCalibration, unchanged. A record that did not pass, touched a bound, did not converge, could not
// separate its parameters, or came from synthetic data or the tool self-test produces NOTHING: the new revision of the model exists only for a measured, validated, bounded, identifiable fit.
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {SourceRef} from '../../../contracts/generated/engineering';
import {assessCalibration,sampleAt,type CalibrationDataset,type CalibrationResult} from './calibration';
import {predictTrials,type HeadlessBench,type PredictionModels} from './bench-prediction';
import {benchBindingDigest,sidecarMatchesDataset,type CalibrationSidecar} from './calibration-import';
import {validateCalibrationRecord,validateIdentificationPlan,type CalibrationRecordV1,type IdentificationPlanV1} from './calibration-record';
import {fitBoundedLeastSquares} from './least-squares';
import {applyDriveOverride,applyPhysicsOverride,isPhysicsPath} from './parameter-paths';
import type {DriveModelV1} from '../v2/control/drive-io';
import {driveDocumentDigest,sealDriveDocument} from '../v2/control/drive-io';
import {hashJson} from '../v2/hash';
import type {XArmPhysics} from '../v2/simulation3d/arm-cell-scene';

export {IDENTIFIABLE_PATHS} from './parameter-paths';
export {validateIdentificationPlan} from './calibration-record';
export type {CalibrationRecordV1,IdentificationPlanV1};
/** The documents the fit starts from. `physics` is the arm physics profile the headless bench uses when it runs without an override (the fixture's); needed to write a revision of it. */
export interface IdentificationModels extends PredictionModels {physics?:XArmPhysics;/** the plant the bench runs on (its model digest): the plan names it and a plan for another plant is not run */plantModelDigest:string}
type Revisioned=XArmPhysics&{revision?:number;calibrationSources?:Record<string,SourceRef>};

const hashSha=(s:string)=>createHash('sha256').update(s).digest('hex');
/** A deterministic digest of a dataset as imported (canonical JSON): what the plan declares it will fit. */
export const datasetDigestOf=(dataset:CalibrationDataset)=>hashJson(dataset);
const split=(overrides:Record<string,number>)=>({physics:Object.fromEntries(Object.entries(overrides).filter(([p])=>isPhysicsPath(p))),drive:Object.fromEntries(Object.entries(overrides).filter(([p])=>!isPhysicsPath(p)))});
const derivedRef=(record:Pick<CalibrationRecordV1,'fitDigest'|'datasetDigest'>,revision:number,path:string):SourceRef=>({kind:'derived',documentId:`calibration-fit:${record.fitDigest}`,revision:String(revision),locator:`fitted:${path}`,contentSha256:record.datasetDigest});

/** The new documents a fit produces, as bytes: a pure function of the fitted values, the fit's identity and the base documents, so identify() can name their digests before anything is written and
 * writeCalibratedRevision() can check the record against what it writes. The base documents are never touched. */
export function buildRevision(record:Pick<CalibrationRecordV1,'fitted'|'fitDigest'|'datasetDigest'>,base:{driveModel:DriveModelV1;physics?:XArmPhysics}):{document:'drive_model'|'arm_physics';id:string;revision:number;digest:string;file:string;bytes:string}[]{
 const values=Object.fromEntries(record.fitted.map(f=>[f.path,f.value])),{physics,drive}=split(values),out:ReturnType<typeof buildRevision>=[];
 if(Object.keys(drive).length){
  const revision=base.driveModel.revision+1,fitted=applyDriveOverride(base.driveModel,drive),first=Object.keys(drive).sort()[0]!;
  const doc=sealDriveDocument({...fitted,revision,sources:{...base.driveModel.sources,torque:derivedRef(record,revision,first)}}) as DriveModelV1;
  out.push({document:'drive_model',id:doc.id,revision,digest:doc.digest,file:`drive-model-r${revision}.json`,bytes:JSON.stringify(doc,null,2)+'\n'});
 }
 if(Object.keys(physics).length){
  if(!base.physics)throw Error('PHYSICS_BASE_REQUIRED');
  const revision=((base.physics as Revisioned).revision??1)+1,calibrationSources={...(base.physics as Revisioned).calibrationSources,...Object.fromEntries(Object.keys(physics).sort().map(p=>[p,derivedRef(record,revision,p)]))};
  const doc={...applyPhysicsOverride(base.physics,physics),revision,calibrationSources};
  out.push({document:'arm_physics',id:'xarm6-g2-v1/physics',revision,digest:hashJson(doc),file:`arm-physics-r${revision}.json`,bytes:JSON.stringify(doc,null,2)+'\n'});
 }
 return out;
}

function failed(plan:IdentificationPlanV1,dataset:CalibrationDataset,models:IdentificationModels,options:{toolSelfTest:boolean},code:CalibrationRecordV1['reasonCodes'][number],validation:CalibrationResult):CalibrationRecordV1{
 return seal(plan,dataset,models,options,{fitted:plan.parameters.map(p=>({path:p.path,value:p.initial,atBound:false,unit:p.unit,standardError:null})),
  convergence:{iterations:0,converged:false,objectiveInitial:0,objectiveFinal:0,jacobianCondition:null},validation,reasonCodes:[code],produced:[]});
}
function seal(plan:IdentificationPlanV1,dataset:CalibrationDataset,models:IdentificationModels,options:{toolSelfTest:boolean},p:Pick<CalibrationRecordV1,'fitted'|'convergence'|'validation'|'reasonCodes'|'produced'>):CalibrationRecordV1{
 const tune=dataset.trials.filter(t=>t.split==='tune'),domain:CalibrationRecordV1['domain']={};
 for(const c of plan.objective.channels){const v=tune.flatMap(t=>t.channels[c]??[]);if(v.length)domain[c]={min:Math.min(...v),max:Math.max(...v)};}
 const fitDigest=hashJson({planDigest:plan.digest,datasetDigest:plan.datasetDigest,configDigest:dataset.configDigest,fitted:p.fitted});
 const record={schemaVersion:1,documentType:'calibration-record',planDigest:plan.digest,datasetDigest:plan.datasetDigest,configDigest:dataset.configDigest,baseDriveModelDigest:models.driveModel.digest,fitDigest,
  sourceKind:dataset.sourceKind==='measured'?'measured':'synthetic',...p,domain,toolSelfTest:options.toolSelfTest,accepted:false} as Omit<CalibrationRecordV1,'digest'>;
 return {...record,digest:driveDocumentDigest(record)};
}

export async function identify(plan:IdentificationPlanV1,dataset:CalibrationDataset,sidecar:CalibrationSidecar,models:IdentificationModels,bench:HeadlessBench,options:{toolSelfTest:boolean}):Promise<CalibrationRecordV1>{
 const check=validateIdentificationPlan(plan);if(!check.ok)throw Error(`PLAN_INVALID:${check.reasonCodes.join(',')}`);
 if(plan.datasetDigest!==datasetDigestOf(dataset))throw Error('DATASET_DIGEST_MISMATCH');
 if(plan.baseDriveModelDigest!==models.driveModel.digest)throw Error('BASE_MODEL_MISMATCH');
 // everything the plan declared about the experiment is checked against what will actually run, before the first bench call
 if(plan.plantModelDigest!==models.plantModelDigest)throw Error('PLAN_PLANT_MISMATCH');
 if(plan.controlProfileDigest!==models.control.digest)throw Error('PLAN_CONTROL_MISMATCH');
 if(!sidecarMatchesDataset(sidecar,dataset))throw Error('SIDECAR_DATASET_MISMATCH');
 if(plan.benchBinding!==benchBindingDigest(sidecar))throw Error('SIDECAR_BINDING_MISMATCH');
 if(options.toolSelfTest&&dataset.sourceKind!=='synthetic')throw Error('SELF_TEST_REQUIRES_SYNTHETIC_DATA');
 const noValidation:CalibrationResult={status:'fail',reasons:['CONFIG_DIGEST_MISMATCH'],residuals:{},domain:{},calibratedCapabilities:[],invalidatedBy:models.configDigest};
 // a dataset recorded for another configuration is not fitted at all: nothing is run, the record says why (R4-D49)
 if(dataset.configDigest!==models.configDigest)return failed(plan,dataset,models,options,'CONFIG_DIGEST_MISMATCH',noValidation);
 // fail early, before any engine run, on a path the model cannot take (a torque scale on an effort axis)
 const initial=Object.fromEntries(plan.parameters.map(p=>[p.path,p.initial])),{drive:initialDrive}=split(initial);
 if(Object.keys(initialDrive).length)applyDriveOverride(models.driveModel,initialDrive);
 const tuneIds=new Set(dataset.trials.filter(t=>t.split==='tune').map(t=>t.trialId)),validationIds=new Set(dataset.trials.filter(t=>t.split==='validation').map(t=>t.trialId));
 if(!tuneIds.size)throw Error('NO_TUNE_SPLIT');
 const candidate=(x:readonly number[])=>{
  const values=Object.fromEntries(plan.parameters.map((p,k)=>[p.path,x[k]!])),{physics,drive}=split(values);
  return {driveModel:Object.keys(drive).length?applyDriveOverride(models.driveModel,drive):models.driveModel,physicsOverride:Object.keys(physics).length?physics:undefined};
 };
 const predict=(x:readonly number[],ids:ReadonlySet<string>)=>{const c=candidate(x);return predictTrials(dataset,sidecar,{...models,driveModel:c.driveModel},bench,{...c.physicsOverride?{physicsOverride:c.physicsOverride}:{},trialIds:ids});};
 const tol=(c:string)=>Math.max(dataset.policy.channels[c]?.absoluteTolerance??1,1e-12);
 // the residual of the fit: tune trials only, each objective channel at every measured instant, scaled by the channel's own declared tolerance and the plan's weight
 const residual=async(x:readonly number[])=>{
  const prediction=await predict(x,tuneIds),out:number[]=[];
  for(const t of dataset.trials.filter(t=>tuneIds.has(t.trialId))){
   const p=prediction.trials.find(q=>q.trialId===t.trialId);if(!p)throw Error('PREDICTION_TRIAL_MISSING');
   for(const c of plan.objective.channels){
    const m=t.channels[c],series=p.channels[c];if(!m||!series)throw Error(`RESIDUAL_CHANNEL_MISSING:${c}`);
    const w=Math.sqrt(plan.objective.weights[c]!);
    m.forEach((v,i)=>{const y=sampleAt(p.timesNs,series,t.timesNs[i]!+dataset.clockMapping.offsetNs,dataset.policy.maxClockGapNs);if(y==='gap')throw Error('FIT_CLOCK_GAP');out.push(w*(y-v)/tol(c));});
   }
  }
  return out;
 };
 const fit=await fitBoundedLeastSquares(residual,{initial:plan.parameters.map(p=>p.initial),lower:plan.parameters.map(p=>p.lower),upper:plan.parameters.map(p=>p.upper),
  maxIterations:plan.optimizer.maxIterations,tolerance:plan.optimizer.tolerance,relativeStep:plan.optimizer.relativeStep});
 // the verdict: the held-out split, predicted with the fitted values, judged by the unchanged assessor
 const validation=validationIds.size?assessCalibration(dataset,await predict(fit.x,validationIds)):assessCalibration(dataset,{configDigest:models.configDigest,clockDomain:sidecar.clockDomain,units:{},trials:[]});
 const fitted=plan.parameters.map((p,k)=>({path:p.path,value:fit.x[k]!,atBound:fit.atBound[k]!,unit:p.unit,/* beyond the plan's own limit the parameters are not separable and an error bar would be a number without meaning */standardError:fit.jacobianCondition<=plan.optimizer.maxJacobianCondition?fit.standardError[k]!:null}));
 const reasonCodes:CalibrationRecordV1['reasonCodes']=[];
 if(dataset.sourceKind!=='measured')reasonCodes.push('SYNTHETIC_DATA');
 if(options.toolSelfTest)reasonCodes.push('TOOL_SELF_TEST');
 if(!fit.converged)reasonCodes.push('NOT_CONVERGED');
 if(fit.atBound.some(Boolean))reasonCodes.push('PARAMETER_AT_BOUND');
 if(!(fit.jacobianCondition<=plan.optimizer.maxJacobianCondition))reasonCodes.push('IDENTIFIABILITY_POOR');
 if(validation.status!=='pass')reasonCodes.push('VALIDATION_FAILED');
 const base={fitted,convergence:{iterations:fit.iterations,converged:fit.converged,objectiveInitial:fit.objectiveInitial,objectiveFinal:fit.objectiveFinal,jacobianCondition:Number.isFinite(fit.jacobianCondition)?fit.jacobianCondition:null},validation,reasonCodes};
 const unsealed=seal(plan,dataset,models,options,{...base,produced:[]});
 if(reasonCodes.length)return unsealed;
 const produced=buildRevision(unsealed,{driveModel:models.driveModel,...models.physics?{physics:models.physics}:{}}).map(({document,id,revision,digest})=>({document,id,revision,digest}));
 return seal(plan,dataset,models,options,{...base,produced});
}

/** Writes the new revision files, the record and a small manifest into a NEW directory (a file that exists is never overwritten, the base documents are never touched). Only a record that produced something can be written here. */
export async function writeCalibratedRevision(record:CalibrationRecordV1,base:{driveModel:DriveModelV1;physics?:XArmPhysics},outDir:string):Promise<{files:{path:string;sha256:string}[]}>{
 const check=validateCalibrationRecord(record);if(!check.ok)throw Error(`RECORD_INVALID:${check.reasonCodes.join(',')}`);
 if(!record.produced.length)throw Error('NO_REVISION_PRODUCED');
 if(record.baseDriveModelDigest!==base.driveModel.digest)throw Error('BASE_MODEL_MISMATCH');
 const docs=buildRevision(record,base);
 if(JSON.stringify(docs.map(({document,id,revision,digest})=>({document,id,revision,digest})))!==JSON.stringify(record.produced))throw Error('PRODUCED_DIGEST_MISMATCH');
 await mkdir(outDir,{recursive:true});
 const files:{path:string;sha256:string}[]=[];
 const put=async(path:string,bytes:string)=>{await writeFile(join(outDir,path),bytes,{flag:'wx',mode:0o644});files.push({path,sha256:hashSha(bytes)});};
 for(const d of docs)await put(d.file,d.bytes);
 await put('calibration-record.json',JSON.stringify(record,null,2)+'\n');
 // the validity of the revision: the configuration it was fitted for and the measured domain; outside it the numbers say nothing
 await put('revision-manifest.json',JSON.stringify({schemaVersion:1,documentType:'calibration-revision-manifest',recordDigest:record.digest,fitDigest:record.fitDigest,datasetDigest:record.datasetDigest,configDigest:record.configDigest,domain:record.domain,
  produced:record.produced,files:files.map(f=>({...f})),accepted:false},null,2)+'\n');
 return {files};
}
/** A record that produced nothing is still a record: it is written (new file only) so the person can read why. */
export async function writeCalibrationRecord(record:CalibrationRecordV1,path:string):Promise<void>{
 const check=validateCalibrationRecord(record);if(!check.ok)throw Error(`RECORD_INVALID:${check.reasonCodes.join(',')}`);
 await writeFile(path,JSON.stringify(record,null,2)+'\n',{flag:'wx'});
}
