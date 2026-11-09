import {execFile,type ExecFileException} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {hashJson} from '../v2/hash';
import {sealDocument,validateNavigationDocument} from '../v2/navigation2d/contracts';
import type {ArtifactRef,ModelValidationReportV1,RobotPhysicalModelV1} from '../v2/navigation2d/contracts';
import {bytecodeEnv} from './python-env';

export const LINKFORGE_PROTOCOL='mekoniq-linkforge/1';
export const ADAPTER_VERSION='linkforge-adapter/1',POLICY_VERSION='mekoniq-model-policy/1',CORE_VERSION='1.6.0';
export interface ValidatorIdentity{adapterVersion:string;policyVersion:string;coreVersion:string;lockDigest:string}
export interface ValidateInput{
 model:RobotPhysicalModelV1;
 /** The entity URDF: a path relative to `bundleRoot`, with the digest the bytes must have. */
 urdf:ArtifactRef;
 bundleRoot:string;
 /** Stores a worker artifact (name map, reference URDF) and returns its ref; without it artifacts are dropped and the refs stay null. */
 putArtifact?:(name:string,bytes:Uint8Array)=>Promise<ArtifactRef>;
}
export interface RobotModelValidator{readonly identity:ValidatorIdentity;validate(input:ValidateInput):Promise<ModelValidationReportV1>;}
export interface LinkForgeOptions{python:string;workerRoot:string;timeoutMs:number;lockDigest:string}

export const lockDigestOf=async(file:string)=>createHash('sha256').update(await readFile(file)).digest('hex');
/** Cache identity of one validation: the model, the exact URDF bytes and every version that can change the verdict. */
export const validationCacheKey=(id:ValidatorIdentity,physicalModelDigest:string,urdfSha256:string)=>hashJson({physicalModelDigest,urdfSha256,...id});

/** A report for a validation that did not produce a verdict (flag off, worker missing, crash, timeout). Shape-valid, never `pass`. */
export function incompleteReport(model:RobotPhysicalModelV1,urdf:ArtifactRef|null,execution:'not_run'|'failed',code:string,detail:string,identity?:ValidatorIdentity):ModelValidationReportV1{
 return sealDocument<ModelValidationReportV1>({
  schemaVersion:1,documentType:'model-validation-report',reportDigest:'',physicalModelDigest:model.modelDigest,assemblyDigest:model.inputs.assemblyDigest,robotId:model.robotId,execution,result:'inconclusive',mode:'shadow',engine:null,
  checks:[],issues:[{code,severity:'error',path:'/worker',entityId:model.robotId,source:'mekoniq',detail:detail.slice(0,1000)}],nameMapRef:null,inputUrdfRef:urdf,referenceUrdfRef:null,referenceSrdfRef:null,assumptions:model.assumptions,
  limitations:['no LinkForge verdict was produced; compile and run paths do not depend on it',...identity?[`lock ${identity.lockDigest}`]:[]],
 },'reportDigest');
}

/** Runs python -m linkforge_worker once per validation: fixed argv, allowlisted environment, a private working directory, a hard timeout that kills the child. */
export function createLinkForgeValidator(o:LinkForgeOptions):RobotModelValidator{
 const identity:ValidatorIdentity={adapterVersion:ADAPTER_VERSION,policyVersion:POLICY_VERSION,coreVersion:CORE_VERSION,lockDigest:o.lockDigest};
 return {
  identity,
  async validate(input){
   const {model,urdf,bundleRoot}=input,cwd=await mkdtemp(join(tmpdir(),'lf-worker-'));
   const request={protocol:LINKFORGE_PROTOCOL,model,urdfPath:urdf.path,urdfSha256:urdf.sha256,bundleRoot,lockDigest:o.lockDigest,adapterVersion:ADAPTER_VERSION};
   try{
    const out=await new Promise<{stdout:string;stderr:string;error:ExecFileException|null}>(done=>{
     const child=execFile(o.python,['-m','linkforge_worker'],{cwd,timeout:o.timeoutMs,killSignal:'SIGKILL',maxBuffer:16*1024*1024,encoding:'utf8',
      env:{PYTHONPATH:resolve(o.workerRoot),...bytecodeEnv(),PYTHONNOUSERSITE:'1',PYTHONUTF8:'1',LANG:'C.UTF-8',PATH:'/usr/bin:/bin'} as unknown as NodeJS.ProcessEnv},(error:ExecFileException|null,stdout:string,stderr:string)=>done({stdout,stderr,error}));
     child.stdin?.on('error',()=>{});child.stdin?.end(JSON.stringify(request));
    });
    const stopped=(execution:'not_run'|'failed',code:string,detail:string)=>incompleteReport(model,urdf,execution,code,detail,identity);
    if(out.error?.code==='ENOENT')return stopped('not_run','LF_WORKER_UNAVAILABLE','the worker interpreter could not be started');
    if(out.error?.killed||out.error?.signal==='SIGKILL')return stopped('failed','LF_WORKER_TIMEOUT',`worker exceeded ${o.timeoutMs} ms and was killed`);
    const line=out.stdout.trim().split('\n').at(-1)??'';
    let response:{report?:Record<string,unknown>;artifacts?:Record<string,string>;error?:{code:string;detail:string}};
    try{response=JSON.parse(line);}catch{return stopped('failed',out.error?'LF_WORKER_FAILED':'LF_WORKER_PROTOCOL',`${out.error?.message??'worker response is not JSON'} ${out.stderr.slice(-400)}`.trim());}
    if(response.error)return stopped('failed','LF_WORKER_FAILED',`${response.error.code}: ${response.error.detail}`);
    if(out.error||!response.report)return stopped('failed','LF_WORKER_FAILED',`${out.error?.message??'no report'} ${out.stderr.slice(-400)}`.trim());
    const body=response.report as unknown as ModelValidationReportV1;
    if(body.physicalModelDigest!==model.modelDigest||body.robotId!==model.robotId)return stopped('failed','LF_WORKER_PROTOCOL','the report belongs to a different model');
    const put=async(name:string)=>{const text=response.artifacts?.[name];return text!==undefined&&input.putArtifact?input.putArtifact(name,new TextEncoder().encode(text)):null;};
    const sealed=sealDocument<ModelValidationReportV1>({...body,reportDigest:'',inputUrdfRef:urdf,nameMapRef:await put('name-map.json'),referenceUrdfRef:await put('reference.urdf'),referenceSrdfRef:null},'reportDigest');
    const check=validateNavigationDocument(sealed);
    return check.ok?sealed:stopped('failed','LF_REPORT_INVALID',check.issues.slice(0,3).map(i=>`${i.path} ${i.code}`).join('; '));
   }finally{await rm(cwd,{recursive:true,force:true});}
  },
 };
}
