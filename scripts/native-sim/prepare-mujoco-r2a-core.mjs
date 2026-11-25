#!/usr/bin/env node
// Read-only frozen Git objects + verified archived runtime; never checks out, rebuilds or runs R2a.
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tsImport} from 'tsx/esm/api';
import reference from './r2a-arm-baseline.json' with {type:'json'};
import profile from '../../robotics/simulation-mujoco/profiles/linux-amd64.json' with {type:'json'};
import {probeFile,sha256} from './mujoco-probe-evidence.mjs';
import {labFileAt} from '../repo-identity.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export async function prepareR2aHandoff({runtimeCache,lab,out,checker}){
 const old=reference.subject,git=(repo,commit,path)=>execFileSync('git',['show',commit+':'+path],{cwd:repo,timeout:10000,maxBuffer:64*1024*1024});
 const runtime=await probeFile(runtimeCache,'runtime.mjs'),manifestBytes=await probeFile(runtimeCache,'manifest.json'),runtimeManifest=JSON.parse(manifestBytes),lockBytes=labFileAt(lab,old.labCommit,'config/source-runtime.lock.json');
 if(sha256(runtime)!==old.runtimeArtifactSha256||runtimeManifest.sourceCommit!==old.sourceCommit||runtimeManifest.schemaHash!==old.schemaHash||runtimeManifest.dirty!==false||runtimeManifest.portableSimulationTools.closure.digest!==old.portableClosureHash)throw Error('R2A_CACHE_IDENTITY');
 await mkdir(out,{mode:0o700});const refs={};
 const put=async(role,path,bytes,sourcePath=path,sourceCommit=old.sourceCommit)=>{await mkdir(dirname(join(out,path)),{recursive:true,mode:0o700});await writeFile(join(out,path),bytes,{flag:'wx',mode:0o600});const ref={path,sourcePath,sourceCommit,bytes:bytes.length,sha256:sha256(bytes)};(refs[role]??=[]).push(ref);return ref;};
 for(const f of runtimeManifest.portableSimulationTools.closure.files){
  const bytes=git(root,old.sourceCommit,f.path);if(bytes.length!==f.bytes||sha256(bytes)!==f.sha256)throw Error('R2A_CLOSURE_MISMATCH:'+f.path);
  const schema=f.path.startsWith('packages/contracts/schemas/'),role=schema?'schema':f.path.endsWith('/xarm6-g2-v1/component.json')?'model':f.path.endsWith('/xarm6-g2-v1/coffee-cell-project.json')?'project':f.path==='robotics/simulation-mujoco/requirements.lock'?'engine':'tool';
  await put(role,'subject/'+f.path,bytes,schema?f.path.split('/').at(-1):f.path);
 }
 await put('runtime','runtime.mjs',runtime);await put('runtimeManifest','runtime-manifest.json',manifestBytes);await put('labLock','lab-lock.json',lockBytes,'config/source-runtime.lock.json',old.labCommit);
 await put('world','derived/arm-cell-scene.json',Buffer.from(JSON.stringify(reference.world)),'derived/r2a-arm-cell-scene.json');
 const p=await put('profile','derived/linux-amd64.json',Buffer.from(JSON.stringify(profile,null,2)+'\n'),'derived/observer/linux-amd64.json');
 const manifest={schemaVersion:1,subject:{...old,id:'r2a-4f893ac-linux-amd64',executionKind:'mujoco_image',profileSha256:p.sha256,nativeClosureHash:null,image:null},checker:{...checker},refs,profile,frames:{world:'map',robotBase:'base',tool:'tcp',handedness:'right'},units:{length:'m',angle:'rad',mass:'kg',time:'s'},seeds:[7,42,99],casePolicy:{required:['m00-seeds-1-10','MJ-BV01-seeds-7-42-99','bad_state','worker_loss','long_run'],lostAck:'unknown_no_resend',authority:'source'},accepted:false,dynamics:'not_calibrated'};
 await writeFile(join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
 const {validateNativeHandoff}=await tsImport('../../packages/lab-runtime/src/v2/sil/native-handoff.ts',import.meta.url),assessment=await validateNativeHandoff(out,manifest);
 await writeFile(join(out,'preparation.json'),JSON.stringify({subject:manifest.subject,checker:manifest.checker,derived:{world:{producer:'frozen arm-cell builder; seed42 arm-1 cups1,2',sourceCommit:old.sourceCommit},profile:{producer:'observer',sourceCommit:checker.sourceCommit}},...assessment,accepted:false,qualification:'not_run',dynamics:'not_calibrated',imageRecordsVerified:false},null,2)+'\n',{flag:'wx'});
 if(!assessment.prepared)throw Error('R2A_PREPARATION_FAILED:'+JSON.stringify(assessment.issues));return assessment;
}