// CLD06 (R5) producer: one HTTP smoke against the Cloud Run service after ONE deployment the user ordered, written as a supplement beside (never inside) the immutable R5 record.
//   plan     --candidate R5_DIR --endpoint https://…run.app --origin https://lab.mekoniq.app                    reads the candidate back; prints what execute would bind to
//   execute  --candidate R5_DIR --endpoint … --origin … --release-approved --out FRESH_DIR                      gcloud/docker readback of the deployment + the smoke; checkCloudRunR5Evidence at the end
//   diagnose --runtime-manifest MANIFEST --endpoint http://127.0.0.1:PORT --origin http://127.0.0.1:4175 --out FRESH_DIR   the same HTTP flow on loopback; compares the three digests with this host
// MEKONIQ_LAB_ACCESS_KEY comes from the environment and never reaches the evidence. It never deploys, never edits the R5 record and never accepts anything.
// Guard: LAB_SIMEXT_EVIDENCE_DIR=<R5 dir> LAB_CLOUD_EVIDENCE_DIR=<supplement> pnpm test:acceptance -- cloud-run
import {parseArgs} from 'node:util';
import {readFileSync,writeFileSync,mkdirSync,realpathSync} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {boundedEvidenceRead} from './r2b-readback.mjs';
import {assessR5Directory,hostCldBundles,CLD_PROJECT} from './r5-readback.mjs';
import {R5_CLOUD,checkCloudRunR5Evidence,checkR5CandidateInputs,checkR5Health,checkStopRun,compareStop} from './cloud-run-qualification.mjs';
import {sha,must,project,region,service} from './r4-cloud-evidence.mjs';
import {secrets,safeBytes,endpointCheck,deploymentReadback,failure} from './record-r4-cloud.mjs';
import {sourceCommit,sourceDirty} from './repo-identity.mjs';

const source=fileURLToPath(new URL('../',import.meta.url)),uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
/** stop-v1's loop (packages/lab-runtime/src/v2/control/stop-campaign.ts): 250-tick steps, and after the stop the run is observed for OBSERVE_AFTER_STOP_TICKS more, so its end is the Mac run's. */
const STEP=250,OBSERVE_AFTER_STOP_TICKS=750,MAX_TICKS=30000;

/** The record is read once; the reader assesses those bytes, and the producer binds to them. */
export async function readR5Candidate(dir,assess=assessR5Directory){
 const read=p=>boundedEvidenceRead(dir,p);let qBytes,q;
 try{qBytes=read('qualification.json');q=JSON.parse(qBytes);must(!(await assess(dir,q)).length,'CANDIDATE_INVALID');}catch{throw Error('CANDIDATE_INVALID');}
 const containerBytes=read(R5_CLOUD.container),cld04Bytes=read(R5_CLOUD.cld04),macBytes=read(R5_CLOUD.macStop);
 return {q,qBytes,containerBytes,cld04Bytes,macBytes,...checkR5CandidateInputs(q,containerBytes,cld04Bytes,macBytes)};
}
const projectHealth=(h,allowOrigin)=>({sourceCommit:h.sourceCommit,schemaHash:h.schemaHash,protocolMajor:h.protocolMajor,allowOrigin,features:{bearer:h.features?.bearer},deployment:{bind:h.deployment?.bind},
 capabilities:h.capabilities,backends:h.backends?.map(({id,installed,reachable,enabled,compatible,commissioned})=>({id,installed,reachable,enabled,compatible,commissioned}))});
async function smoke({endpoint,origin,pin,local,reference,store,summary}){
 const key=process.env.MEKONIQ_LAB_ACCESS_KEY;must(typeof key==='string'&&key.length>0,'ACCESS_KEY_REQUIRED');secrets.add(key);
 const runtimeIdentity={sourceCommit:pin.sourceCommit,schemaHash:pin.schemaHash},owned=new Set(),archived=new Set(),actions={steps:[]};let bearer;
 const api=async(path,body,status=200)=>{
  const r=await fetch(endpoint+'/lab/v2'+path,{method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(120000),
   headers:{Origin:origin,...body===undefined?{}:{'Content-Type':'application/json'},...bearer?{Authorization:'Bearer '+bearer}:{}},...body===undefined?{}:{body:JSON.stringify(body)}});
  must(r.status===status,'HTTP_'+r.status+'_'+path.split('?')[0].replace(/[0-9a-f]{64}|[0-9a-f-]{36}/g,'id'));return {value:await r.json(),allowOrigin:r.headers.get('access-control-allow-origin')};
 };
 const archive=async id=>{
  if(archived.has(id))return;archived.add(id);
  try{const {value}=await api('/runs/'+id+'/archive',{});must(value.runId===id&&value.archived===true,'ARCHIVE_RECEIPT_INVALID');summary.cleanup.push({runId:id,archived:true});}
  catch(e){summary.cleanup.push({runId:id,archived:false,error:failure(e)});throw e;}
 };
 try{
  const h=await api('/health'),health=projectHealth(h.value,h.allowOrigin);store('health',health);checkR5Health(health,pin,origin,local);summary.cases.health='tested';
  const paired=(await api('/sessions',{token:key},201)).value;
  must(typeof paired.sessionToken==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(paired.sessionToken),'SESSION_RECEIPT_INVALID');
  bearer=paired.sessionToken;secrets.add(bearer);if(typeof paired.csrfToken==='string')secrets.add(paired.csrfToken);
  // the three options against the CLD project (the record's CLD04 project), full digests
  const projectDoc={...JSON.parse(readFileSync(join(source,CLD_PROJECT.fixture,'serve-3d-project.json'))),...CLD_PROJECT.overrides};
  const compiled=(await api('/engineering/compile',{project:projectDoc})).value;must(compiled.state==='compiled','ENGINEERING_COMPILE_FAILED');
  const ref={bundleDigest:compiled.bundleDigest,projectDigest:compiled.projectDigest},electrical={projectDigest:compiled.projectDigest,options:{}};
  for(const id of R5_CLOUD.options){
   const receipt=(await api('/engineering/electrical',{ref,design:JSON.parse(readFileSync(join(source,`robotics/catalog/electrical/${id}.json`)))})).value;
   const bundle=(await api('/engineering/electrical/'+receipt.digest)).value;
   must(bundle.digest===receipt.digest&&bundle.state===receipt.state&&bundle.inputs?.project?.digest===compiled.projectDigest,'ELECTRICAL_RECEIPT_INVALID');
   electrical.options[id]={state:bundle.state,digest:bundle.digest};
  }
  store('electrical',electrical);
  must(electrical.projectDigest===reference.projectDigest&&R5_CLOUD.options.every(o=>electrical.options[o].state===reference.options[o].state&&electrical.options[o].digest===reference.options[o].digest),'CLOUD_DIGEST_MISMATCH');
  summary.cases.electrical='tested';
  // one S1 emergency stop (coast), stepped and observed as stop-v1 steps its runs
  const created=(await api('/runs',{engineeringRef:ref,scenarioId:R5_CLOUD.scenario,scenarioRevision:1,seed:R5_CLOUD.seed,mode:'simulation',access:'simulated',backendSetId:'engineering-mujoco-3d-v1',runtimeIdentity,stopSchedule:[R5_CLOUD.stopEntry]},201)).value,id=created.run?.id;
  must(uuid.test(id)&&!owned.has(id),'CREATE_RUN_ID_INVALID');owned.add(id);if(typeof created.reclaimToken==='string')secrets.add(created.reclaimToken);
  let view={run:created.run,tick:created.tick};actions.created={runId:id,runRevision:created.run.runRevision,tick:created.tick,status:created.run.status};
  const act=async(kind,payload)=>{const startNs=process.hrtime.bigint().toString(),expectedRevision=view.run.runRevision,before=view.tick;
   view=(await api('/runs/'+id+'/actions',{actionId:randomUUID(),expectedRevision,kind,payload})).value;
   actions.steps.push({kind,...payload,expectedRevision,runRevision:view.run?.runRevision,startTick:before,endTick:view.tick,status:view.run?.status,startNs,endNs:process.hrtime.bigint().toString()});
   must(view.run?.id===id&&view.run.runRevision===expectedRevision+1&&Number.isSafeInteger(view.tick),'ACTION_RECEIPT_INVALID');return before;};
  await act('start',{});
  const stopAt=reference.scheduledTick+OBSERVE_AFTER_STOP_TICKS;
  while((['running','awaiting_confirmation'].includes(view.run.status)||view.run.status==='needs_attention'&&view.tick<stopAt)&&view.tick<MAX_TICKS){const before=await act('step',{ticks:STEP});if(view.tick===before)break;}
  const report=(await api('/runs/'+id+'/report')).value;store('stop-report',report);store('actions',actions);
  must(report.manifest?.runId===id&&report.schemaHash===pin.schemaHash,'REPORT_IDENTITY');
  checkStopRun(report,local?process.arch==='arm64'?'arm64':'x86_64':'x86_64',pin.sourceCommit,reference.scheduledTick);
  if(reference.mac)summary.macComparison=compareStop(reference.mac,report);
  summary.cases.stop='tested';await archive(id);
 }finally{for(const id of owned)if(!archived.has(id))try{await archive(id);}catch{/* the cleanup keeps its own failure */}}
}
async function main(){
 const {positionals,values:v}=parseArgs({allowPositionals:true,options:Object.fromEntries([...['candidate','runtime-manifest','endpoint','origin','out'].map(k=>[k,{type:'string'}]),['release-approved',{type:'boolean'}]])});
 const [mode]=positionals,local=mode==='diagnose';must(positionals.length===1&&['plan','execute','diagnose'].includes(mode),'MODE_REQUIRED');
 must(v.endpoint&&v.origin,'ENDPOINT_AND_ORIGIN_REQUIRED');endpointCheck(v.endpoint,v.origin,local);
 let base,pin,reference,metadata;
 if(local){must(v['runtime-manifest']&&!v.candidate&&!v['release-approved'],'DIAGNOSTIC_MANIFEST_REQUIRED');pin=JSON.parse(readFileSync(v['runtime-manifest']));
  must(pin.dirty===false&&pin.sourceCommit===sourceCommit(source)&&/^[0-9a-f]{64}$/.test(pin.schemaHash)&&/^[0-9a-f]{64}$/.test(pin.artifactSha256),'DIAGNOSTIC_IDENTITY');
  const {stopStartTick}=await import('tsx/esm/api').then(m=>m.tsImport(join(source,'packages/lab-runtime/src/v2/control/stop-functions.ts'),import.meta.url));
  reference={...await hostCldBundles(),scheduledTick:stopStartTick(R5_CLOUD.stopEntry)};}
 else{
  must(v.candidate&&!v['runtime-manifest'],'CANDIDATE_REQUIRED');
  base=await readR5Candidate(resolve(v.candidate));pin=base.q.lab.pin;
  must(sourceCommit(source)===pin.sourceCommit&&!sourceDirty(source),'CLEAN_CANDIDATE_SOURCE_REQUIRED');
  reference={projectDigest:base.cld04.project.digest,options:base.cld04.options,scheduledTick:base.cld04.stop.scheduledTick,mac:base.mac};
  if(mode==='plan'){console.log(JSON.stringify({mode,candidateId:base.q.candidateId,qualificationSha256:sha(base.qBytes),sourceCommit:pin.sourceCommit,labCommit:base.q.lab.commit,schemaHash:pin.schemaHash,imageId:base.native.imageId,service,project,region,endpoint:v.endpoint,origin:v.origin,accepted:false}));return;}
  must(v['release-approved']===true,'RELEASE_APPROVAL_REQUIRED');
 }
 must(v.out,'OUTPUT_REQUIRED');const out=join(realpathSync(dirname(resolve(v.out))),basename(resolve(v.out)));
 if(base){const dir=realpathSync(v.candidate);must(out!==dir&&!out.startsWith(dir+'/'),'OUTPUT_IN_CANDIDATE');
  metadata=deploymentReadback({schema:'mekoniq-cloud-run-deployment/2',accepted:false,project,region,service,url:v.endpoint,origin:v.origin,platform:'linux/amd64',sourceCommit:pin.sourceCommit,
   labCommit:base.q.lab.commit,schemaHash:pin.schemaHash,artifactSha256:pin.artifactSha256,qualification:{sha256:sha(base.qBytes),candidateId:base.q.candidateId}},base.native);}
 must(process.env.MEKONIQ_LAB_ACCESS_KEY,'ACCESS_KEY_REQUIRED');secrets.add(process.env.MEKONIQ_LAB_ACCESS_KEY);
 mkdirSync(out,{mode:0o700});const files={};
 const put=(name,bytes)=>{safeBytes(bytes);writeFileSync(join(out,name+'.json'),bytes,{flag:'wx',mode:0o600});files[name+'.json']=sha(bytes);};
 const store=(name,value)=>put(name,JSON.stringify(value)+'\n');
 if(base){for(const [k,doc] of Object.entries(metadata))store(k,doc);put('container-record',base.containerBytes);put('cld04',base.cld04Bytes);put('mac-stop-report',base.macBytes);}
 else store('runtime-identity',{sourceCommit:pin.sourceCommit,schemaHash:pin.schemaHash,artifactSha256:pin.artifactSha256,accepted:false});
 const summary={schema:'mekoniq-cloud-run-r5-smoke/1',accepted:false,mode:local?'local-diagnostic':'qualification',service:v.endpoint,origin:v.origin,expectedCommit:pin.sourceCommit,
  status:'failed',cases:{health:'not_run',electrical:'not_run',stop:'not_run'},cleanup:[]};
 try{
  await smoke({endpoint:v.endpoint,origin:v.origin,pin,local,reference,store,summary});
  if(base){const final=deploymentReadback(metadata.deployment,base.native);must(final.deployment.revision===metadata.deployment.revision&&final.deployment.image===metadata.deployment.image,'DEPLOYMENT_CHANGED');}
  summary.status=local?'diagnostic_complete':'tested';
 }catch(e){summary.failure=failure(e);}
 store('summary',summary);writeFileSync(join(out,'checksums.json'),JSON.stringify({algorithm:'sha256',files},null,2)+'\n',{flag:'wx',mode:0o600});
 must(summary.status!=='failed',summary.failure);
 if(base){const issues=checkCloudRunR5Evidence(p=>boundedEvidenceRead(out,p),base.qBytes);must(!issues.length,'SUPPLEMENT_READBACK_FAILED');}
 console.log(JSON.stringify({status:summary.status,accepted:false,cases:summary.cases,macComparison:summary.macComparison??null}));
}
if(import.meta.main)main().catch(e=>{console.error(failure(e));process.exitCode=1;});
