// CLD06 (R5) producer: one HTTP smoke against the Cloud Run service after ONE deployment the user ordered, written as a supplement beside (never inside) the immutable R5 record.
//   plan      --candidate R5_DIR --endpoint https://…run.app --origin https://lab.mekoniq.app                    reads the candidate back; prints what execute would bind to
//   reference --candidate R5_DIR --endpoint http://127.0.0.1:PORT --origin http://127.0.0.1:4175 --out FRESH_DIR   the Mac reference: the same flow against the candidate's runtime run natively
//                                                                                                                   on this Mac (arm64, loopback, MEKONIQ_LAB_ACCESS_KEY); written and read back
//   execute   --candidate R5_DIR --mac-reference REF_DIR --endpoint … --origin … --release-approved --out FRESH_DIR   gcloud/docker readback of the deployment + the smoke; the Mac reference is
//                                                                                                                   checked and copied to mac/; the verdict (R5_CLD06) is recomputed from disk at the end
//   diagnose  --runtime-manifest MANIFEST --endpoint http://127.0.0.1:PORT --origin http://127.0.0.1:4175 --out FRESH_DIR   the same HTTP flow on loopback; compares the three digests with this host
// Every stop run's whole physics stream (GET /lab/v2/runs/:id/physics/<chunk>, the chunks its report names) is downloaded, written, and read back from disk BEFORE the run is archived,
// also when the comparison then fails; a missing sample is CLD06_EVIDENCE_MISSING.
// MEKONIQ_LAB_ACCESS_KEY comes from the environment and never reaches the evidence. It never deploys, never edits the R5 record and never accepts anything.
// Guard: LAB_SIMEXT_EVIDENCE_DIR=<R5 dir> LAB_CLOUD_EVIDENCE_DIR=<supplement> pnpm test:acceptance -- cloud-run
import {parseArgs} from 'node:util';
import {readFileSync,writeFileSync,mkdirSync,realpathSync} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {boundedEvidenceRead} from './r2b-readback.mjs';
import {assessR5Directory,hostCldBundles,CLD_PROJECT} from './r5-readback.mjs';
import {R5_CLOUD,R5_CLD06,readR5SupplementVerdict,checkR5CandidateInputs,checkR5Health,checkMacReference,cld06Records,cld06Trace,cld06Expected,evaluateCld06} from './cloud-run-qualification.mjs';
import {sha,must,project,region,service} from './r4-cloud-evidence.mjs';
import {secrets,safeBytes,endpointCheck,deploymentReadback} from './record-r4-cloud.mjs';
import {sourceCommit,sourceDirty} from './repo-identity.mjs';

const source=fileURLToPath(new URL('../',import.meta.url)),uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
/** stop-v1's loop (packages/lab-runtime/src/v2/control/stop-campaign.ts): 250-tick steps, and after the stop the run is observed for OBSERVE_AFTER_STOP_TICKS more, so its end is the Mac run's. */
const STEP=250,OBSERVE_AFTER_STOP_TICKS=750,MAX_TICKS=30000,CHUNK=/^physics-[0-9]{6}-[0-9a-f]{8}\.ndjson\.gz$/;
// failure codes carry their reason (CLD06_EVIDENCE_MISSING:cloud:600:pose); anything else is never echoed
const failure=e=>{const m=e?.message??'';return /^[A-Z][A-Z0-9_]*(?:_\/[a-zA-Z0-9/-]+)?(?::[A-Za-z0-9_./-]+)*$/.test(m)&&m.length<=200?m:'RECORDER_OPERATION_FAILED';};

/** The record is read once; the reader assesses those bytes, and the producer binds to them. */
export async function readR5Candidate(dir,assess=assessR5Directory){
 const read=p=>boundedEvidenceRead(dir,p);let qBytes,q;
 try{qBytes=read('qualification.json');q=JSON.parse(qBytes);must(!(await assess(dir,q)).length,'CANDIDATE_INVALID');}catch{throw Error('CANDIDATE_INVALID');}
 const containerBytes=read(R5_CLOUD.container),cld04Bytes=read(R5_CLOUD.cld04),macBytes=read(R5_CLOUD.macStop);
 return {q,qBytes,containerBytes,cld04Bytes,macBytes,...checkR5CandidateInputs(q,containerBytes,cld04Bytes,macBytes)};
}
const projectHealth=(h,allowOrigin)=>({sourceCommit:h.sourceCommit,schemaHash:h.schemaHash,protocolMajor:h.protocolMajor,allowOrigin,features:{bearer:h.features?.bearer},deployment:{bind:h.deployment?.bind},
 capabilities:h.capabilities,backends:h.backends?.map(({id,installed,reachable,enabled,compatible,commissioned})=>({id,installed,reachable,enabled,compatible,commissioned}))});
async function smoke({endpoint,origin,pin,local,reference,store,putFile,readBack,summary}){
 const key=process.env.MEKONIQ_LAB_ACCESS_KEY;must(typeof key==='string'&&key.length>0,'ACCESS_KEY_REQUIRED');secrets.add(key);
 const runtimeIdentity={sourceCommit:pin.sourceCommit,schemaHash:pin.schemaHash},owned=new Set(),archived=new Set(),actions={steps:[]};let bearer;
 const call=async(path,body,status=200)=>{
  const r=await fetch(endpoint+'/lab/v2'+path,{method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(120000),
   headers:{Origin:origin,...body===undefined?{}:{'Content-Type':'application/json'},...bearer?{Authorization:'Bearer '+bearer}:{}},...body===undefined?{}:{body:JSON.stringify(body)}});
  must(r.status===status,'HTTP_'+r.status+'_'+path.split('?')[0].replace(/[0-9a-f]{64}|[0-9a-f-]{36}|physics-[0-9a-z.-]+/g,'id'));return r;};
 const api=async(path,body,status)=>{const r=await call(path,body,status);return {value:await r.json(),allowOrigin:r.headers.get('access-control-allow-origin')};};
 const archive=async id=>{
  if(archived.has(id))return;archived.add(id);
  try{const {value}=await api('/runs/'+id+'/archive',{});must(value.runId===id&&value.archived===true,'ARCHIVE_RECEIPT_INVALID');summary.cleanup.push({runId:id,archived:true});}
  catch(e){summary.cleanup.push({runId:id,archived:false,error:failure(e)});throw e;}
 };
 let stop=null;
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
  // the CLD06 stop (R5_CLD06): emergency coast in the middle of the first straight, stepped and observed as stop-v1 steps its runs
  const created=(await api('/runs',{engineeringRef:ref,scenarioId:R5_CLOUD.scenario,scenarioRevision:1,seed:R5_CLOUD.seed,mode:'simulation',access:'simulated',backendSetId:'engineering-mujoco-3d-v1',runtimeIdentity,stopSchedule:[R5_CLD06.stopEntry]},201)).value,id=created.run?.id;
  must(uuid.test(id)&&!owned.has(id),'CREATE_RUN_ID_INVALID');owned.add(id);if(typeof created.reclaimToken==='string')secrets.add(created.reclaimToken);
  let view={run:created.run,tick:created.tick};actions.created={runId:id,runRevision:created.run.runRevision,tick:created.tick,status:created.run.status};
  const act=async(kind,payload)=>{const startNs=process.hrtime.bigint().toString(),expectedRevision=view.run.runRevision,before=view.tick;
   view=(await api('/runs/'+id+'/actions',{actionId:randomUUID(),expectedRevision,kind,payload})).value;
   actions.steps.push({kind,...payload,expectedRevision,runRevision:view.run?.runRevision,startTick:before,endTick:view.tick,status:view.run?.status,startNs,endNs:process.hrtime.bigint().toString()});
   must(view.run?.id===id&&view.run.runRevision===expectedRevision+1&&Number.isSafeInteger(view.tick),'ACTION_RECEIPT_INVALID');return before;};
  await act('start',{});
  const stopAt=reference.appliedTick+OBSERVE_AFTER_STOP_TICKS;
  while((['running','awaiting_confirmation'].includes(view.run.status)||view.run.status==='needs_attention'&&view.tick<stopAt)&&view.tick<MAX_TICKS){const before=await act('step',{ticks:STEP});if(view.tick===before)break;}
  const report=(await api('/runs/'+id+'/report')).value;store('stop-report',report);store('actions',actions);
  must(report.manifest?.runId===id&&report.schemaHash===pin.schemaHash,'REPORT_IDENTITY');
  // the whole stream, before the run is archived: each chunk the report names, written, then read back from disk
  const refs=report.physicsEvidence?.manifest?.streams?.flatMap(x=>x.chunks??[])??[];must(refs.length>0&&refs.every(r=>CHUNK.test(r.path)),'CLD06_EVIDENCE_MISSING:'+reference.side+':physics-manifest');
  for(const r of refs)putFile('physics/'+r.path,Buffer.from(await (await call('/runs/'+id+'/physics/'+r.path)).arrayBuffer()));
  const records=cld06Records(report,readBack(refs.map(r=>'physics/'+r.path)),reference.side);cld06Trace(records,report,reference.side);
  stop={report,records};summary.cases.stop='tested';await archive(id);
 }finally{for(const id of owned)if(!archived.has(id))try{await archive(id);}catch{/* the cleanup keeps its own failure */}}
 return stop;
}
function readFiles(dir){
 // a reference directory as its checksums.json lists it, every file hashed before it is trusted
 const checks=JSON.parse(boundedEvidenceRead(dir,'checksums.json')),files=new Map();must(checks.algorithm==='sha256'&&checks.files&&typeof checks.files==='object','MAC_REFERENCE_INVALID');
 for(const [p,d] of Object.entries(checks.files)){const b=boundedEvidenceRead(dir,p);must(sha(b)===d,'MAC_REFERENCE_HASH:'+p);files.set(p,b);}
 return {files,checks};
}
async function main(){
 const {positionals,values:v}=parseArgs({allowPositionals:true,options:Object.fromEntries([...['candidate','runtime-manifest','mac-reference','endpoint','origin','out'].map(k=>[k,{type:'string'}]),['release-approved',{type:'boolean'}]])});
 const [mode]=positionals,local=mode==='diagnose'||mode==='reference';must(positionals.length===1&&['plan','reference','execute','diagnose'].includes(mode),'MODE_REQUIRED');
 must(v.endpoint&&v.origin,'ENDPOINT_AND_ORIGIN_REQUIRED');endpointCheck(v.endpoint,v.origin,local);
 const {stopStartTick}=await import('tsx/esm/api').then(m=>m.tsImport(join(source,'packages/lab-runtime/src/v2/control/stop-functions.ts'),import.meta.url));
 must(stopStartTick(R5_CLD06.stopEntry)===R5_CLD06.appliedTick,'CLD06_APPLIED_TICK');
 let base,pin,reference,metadata,mac;
 if(mode==='diagnose'){must(v['runtime-manifest']&&!v.candidate&&!v['mac-reference']&&!v['release-approved'],'DIAGNOSTIC_MANIFEST_REQUIRED');pin=JSON.parse(readFileSync(v['runtime-manifest']));
  must(pin.dirty===false&&pin.sourceCommit===sourceCommit(source)&&/^[0-9a-f]{64}$/.test(pin.schemaHash)&&/^[0-9a-f]{64}$/.test(pin.artifactSha256),'DIAGNOSTIC_IDENTITY');
  reference={...await hostCldBundles(),appliedTick:R5_CLD06.appliedTick,side:process.arch==='arm64'?'mac':'cloud'};}
 else{
  must(v.candidate&&!v['runtime-manifest'],'CANDIDATE_REQUIRED');
  base=await readR5Candidate(resolve(v.candidate));pin=base.q.lab.pin;
  must(sourceCommit(source)===pin.sourceCommit&&!sourceDirty(source),'CLEAN_CANDIDATE_SOURCE_REQUIRED');
  reference={projectDigest:base.cld04.project.digest,options:base.cld04.options,appliedTick:R5_CLD06.appliedTick,side:mode==='reference'?'mac':'cloud'};
  if(mode==='plan'){console.log(JSON.stringify({mode,candidateId:base.q.candidateId,qualificationSha256:sha(base.qBytes),sourceCommit:pin.sourceCommit,labCommit:base.q.lab.commit,schemaHash:pin.schemaHash,imageId:base.native.imageId,service,project,region,endpoint:v.endpoint,origin:v.origin,cld06:R5_CLD06,accepted:false}));return;}
  if(mode==='reference'){must(process.arch==='arm64'&&process.platform==='darwin'&&!v['mac-reference']&&!v['release-approved'],'MAC_REFERENCE_HOST');}
  else{must(v['release-approved']===true,'RELEASE_APPROVAL_REQUIRED');must(v['mac-reference'],'MAC_REFERENCE_REQUIRED');
   const ref=readFiles(resolve(v['mac-reference']));mac={dir:resolve(v['mac-reference']),checks:ref.checks,...checkMacReference(base.q,base.qBytes,ref.files,base.cld04,'')};
   cld06Expected(mac.report,cld06Trace(mac.records,mac.report,'mac'),'mac','arm64',pin.sourceCommit);}
 }
 must(v.out,'OUTPUT_REQUIRED');const out=join(realpathSync(dirname(resolve(v.out))),basename(resolve(v.out)));
 if(base){const dir=realpathSync(v.candidate);must(out!==dir&&!out.startsWith(dir+'/'),'OUTPUT_IN_CANDIDATE');}
 if(mode==='execute')metadata=deploymentReadback({schema:'mekoniq-cloud-run-deployment/2',accepted:false,project,region,service,url:v.endpoint,origin:v.origin,platform:'linux/amd64',sourceCommit:pin.sourceCommit,
   labCommit:base.q.lab.commit,schemaHash:pin.schemaHash,artifactSha256:pin.artifactSha256,qualification:{sha256:sha(base.qBytes),candidateId:base.q.candidateId}},base.native);
 must(process.env.MEKONIQ_LAB_ACCESS_KEY,'ACCESS_KEY_REQUIRED');secrets.add(process.env.MEKONIQ_LAB_ACCESS_KEY);
 mkdirSync(out,{mode:0o700});const files={};
 const putFile=(name,bytes)=>{safeBytes(bytes);mkdirSync(dirname(join(out,name)),{recursive:true,mode:0o700});writeFileSync(join(out,name),bytes,{flag:'wx',mode:0o600});files[name]=sha(bytes);};
 const put=(name,bytes)=>putFile(name+'.json',bytes),store=(name,value)=>put(name,JSON.stringify(value)+'\n');
 const readBack=paths=>new Map(paths.map(p=>{const b=boundedEvidenceRead(out,p);must(sha(b)===files[p],'READBACK_HASH:'+p);return [p,b];}));
 if(mode==='execute'){for(const [k,doc] of Object.entries(metadata))store(k,doc);put('container-record',base.containerBytes);put('cld04',base.cld04Bytes);put('mac-stop-report',base.macBytes);
  for(const p of Object.keys(mac.checks.files))putFile('mac/'+p,boundedEvidenceRead(mac.dir,p));putFile('mac/checksums.json',boundedEvidenceRead(mac.dir,'checksums.json'));}
 else if(mode==='diagnose')store('runtime-identity',{sourceCommit:pin.sourceCommit,schemaHash:pin.schemaHash,artifactSha256:pin.artifactSha256,accepted:false});
 const summary=mode==='reference'?{schema:'mekoniq-cld06-mac-reference/1',accepted:false,qualification:{sha256:sha(base.qBytes),candidateId:base.q.candidateId},sourceCommit:pin.sourceCommit,hostArch:'arm64',
   endpoint:v.endpoint,origin:v.origin,status:'failed',cases:{health:'not_run',electrical:'not_run',stop:'not_run'},cleanup:[]}
  :{schema:'mekoniq-cloud-run-r5-smoke/2',accepted:false,mode:mode==='diagnose'?'local-diagnostic':'qualification',service:v.endpoint,origin:v.origin,expectedCommit:pin.sourceCommit,
   status:'failed',cases:{health:'not_run',electrical:'not_run',stop:'not_run'},cleanup:[]};
 try{
  const stop=await smoke({endpoint:v.endpoint,origin:v.origin,pin,local,reference,store,putFile,readBack,summary});
  if(mode==='execute'){const final=deploymentReadback(metadata.deployment,base.native);must(final.deployment.revision===metadata.deployment.revision&&final.deployment.image===metadata.deployment.image,'DEPLOYMENT_CHANGED');
   summary.cld06=evaluateCld06(mac,stop,pin.sourceCommit);summary.status=summary.cld06.status;if(summary.cld06.failure)summary.failure=summary.cld06.failure;}
  else if(mode==='reference'){cld06Expected(stop.report,cld06Trace(stop.records,stop.report,'mac'),'mac','arm64',pin.sourceCommit);summary.status='recorded';}
  else summary.status='diagnostic_complete';
 }catch(e){summary.failure=failure(e);}
 store('summary',summary);writeFileSync(join(out,'checksums.json'),JSON.stringify({algorithm:'sha256',files},null,2)+'\n',{flag:'wx',mode:0o600});
 if(mode==='reference'&&summary.status==='recorded'){const ref=readFiles(out);checkMacReference(base.q,base.qBytes,ref.files,base.cld04,'');}
 if(mode==='execute'&&summary.cld06){const {issues,verdict}=readR5SupplementVerdict(p=>boundedEvidenceRead(out,p),base.qBytes);must(!issues.length&&JSON.stringify(verdict)===JSON.stringify(summary.cld06),'SUPPLEMENT_READBACK_FAILED');}
 console.log(JSON.stringify({mode,status:summary.status,failure:summary.failure??null,accepted:false,cases:summary.cases,cld06:summary.cld06?{entry:summary.cld06.entry.pass,comparison:summary.cld06.comparison,diagnostics:summary.cld06.diagnostics}:null}));
 must(['tested','recorded','diagnostic_complete'].includes(summary.status),summary.failure??'FAILED');
}
if(import.meta.main)main().catch(e=>{console.error(failure(e));process.exitCode=1;});
