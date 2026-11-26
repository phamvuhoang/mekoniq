// plan and execute use an immutable, verified R4 candidate. diagnose runs the same HTTP flow on loopback only.
import {parseArgs} from 'node:util';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,realpathSync} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath,URLSearchParams} from 'node:url';
import {randomUUID} from 'node:crypto';
import {boundedEvidenceRead} from './r2b-readback.mjs';
import {assessR4Directory} from './r4-readback.mjs';
import {checkCloudRunR4Evidence} from './cloud-run-qualification.mjs';
import {sha,must,project,region,service,macPath,nativePath,scenarios,checkCandidateInputs,checkDeployment,checkHealth,checkReadiness,checkCell,checkBench,elapsed,timing,comparison,digestRef} from './r4-cloud-evidence.mjs';
import {sourceCommit,sourceDirty} from './repo-identity.mjs';

const source=fileURLToPath(new URL('../',import.meta.url)),fixture='robotics/simulation-mujoco/fixtures/coffee-delivery-cell-v1/project.json';
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export const secrets=new Set();
export function safeBytes(bytes){
 const str=String(bytes);
 must(![...secrets].some(v=>v&&str.includes(v))&&!/"(?:sessionToken|reclaimToken|csrfToken|accessKey|authorization|password|privateKey)"\s*:/i.test(str),'CREDENTIAL_IN_EVIDENCE');
 return bytes;
}
function external(cmd,args){
 const env={...process.env};delete env.MEKONIQ_LAB_ACCESS_KEY;
 try{return execFileSync(cmd,args,{cwd:source,env,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:45000,maxBuffer:16*1024*1024}).trim();}
 catch{throw Error(cmd.toUpperCase()+'_READBACK_FAILED');}
}
export function endpointCheck(endpoint,origin,local){
 const u=new URL(endpoint),o=new URL(origin);
 must(endpoint===u.origin&&origin===o.origin&&(local?u.protocol==='http:'&&u.hostname==='127.0.0.1'&&u.port&&!['1880','1884'].includes(u.port)&&
  o.protocol==='http:'&&['127.0.0.1','localhost'].includes(o.hostname):u.protocol==='https:'&&u.hostname.endsWith('.run.app')&&o.protocol==='https:'),'INVALID_ENDPOINT_OR_ORIGIN');
}
// Keep only inspected fields needed for readback. In particular, reject unexpected environment values before serializing anything.
function metadata(v){
 const labels=v?.labels??{},a=v?.annotations??{};
 return {name:v?.name,labels:Object.fromEntries(['cloud.googleapis.com/location','serving.knative.dev/service'].filter(k=>k in labels).map(k=>[k,labels[k]])),
  annotations:Object.fromEntries(['autoscaling.knative.dev/maxScale','autoscaling.knative.dev/minScale','run.googleapis.com/execution-environment'].filter(k=>k in a).map(k=>[k,a[k]]))};
}
function spec(v){return {serviceAccountName:v?.serviceAccountName,timeoutSeconds:v?.timeoutSeconds,containerConcurrency:v?.containerConcurrency,
 containers:v?.containers?.map(c=>({image:c.image,resources:{limits:{cpu:c.resources?.limits?.cpu,memory:c.resources?.limits?.memory}},env:c.env}))};}
export function deploymentReadback(base,native){
 const describe=(type,name)=>JSON.parse(external('gcloud',['run',type,'describe',name,'--project='+project,'--region='+region,'--format=json']));
 const svc=describe('services',service),ready=svc.status?.latestReadyRevisionName;
 must(typeof ready==='string'&&/^mekoniq-lab-runtime-[a-z0-9-]+$/.test(ready),'SERVICE_REVISION_INVALID');
 const rev=describe('revisions',ready),image=rev.status?.imageDigest;
 must(digestRef.test(image),'DEPLOYED_IMAGE_DIGEST_REQUIRED');
 const [p]=JSON.parse(external('docker',['image','inspect',image]));
 const promotion={Id:p.Id,Os:p.Os,Architecture:p.Architecture,RepoDigests:p.RepoDigests?.filter(v=>v===image),Config:{Labels:{'org.opencontainers.image.revision':p.Config?.Labels?.['org.opencontainers.image.revision']}}};
 const conditions=s=>s?.conditions?.map(({type,status})=>({type,status}));
 const serviceDoc={metadata:metadata(svc.metadata),spec:{template:{metadata:metadata(svc.spec?.template?.metadata),spec:spec(svc.spec?.template?.spec)}},
  status:{url:svc.status.url,latestReadyRevisionName:ready,traffic:svc.status.traffic?.map(({revisionName,percent})=>({revisionName,percent})),conditions:conditions(svc.status)}};
 const revisionDoc={metadata:metadata(rev.metadata),spec:spec(rev.spec),status:{imageDigest:image,conditions:conditions(rev.status)}};
 const d={...base,revision:ready,image};
 checkDeployment(d,serviceDoc,revisionDoc,promotion,native);
 return {deployment:d,service:serviceDoc,revision:revisionDoc,promotion};
}
export async function readCandidate(dir,assess=assessR4Directory){
 const read=p=>boundedEvidenceRead(dir,p);
 let qBytes,q;
 try{qBytes=read('qualification.json');q=JSON.parse(qBytes);must(!(await assess(dir,q)).length,'CANDIDATE_INVALID');}catch{throw Error('CANDIDATE_INVALID');}
 const nativeBytes=read(nativePath),macBytes=read(macPath);
 const {mac,native}=checkCandidateInputs(q,macBytes,nativeBytes);
 return {q,qBytes,nativeBytes,macBytes,mac,native};
}
function projectHealth(h,allowOrigin){
 const p=h.benchCatalog?.['MJ-BENCH-WHEEL']?.startingProfile;
 return {sourceCommit:h.sourceCommit,schemaHash:h.schemaHash,protocolMajor:h.protocolMajor,features:{bearer:h.features?.bearer,readiness:h.features?.readiness},
  allowOrigin,deployment:{bind:h.deployment?.bind},backends:h.backends?.map(({id,installed,reachable,enabled,compatible,commissioned})=>({id,installed,reachable,enabled,compatible,commissioned})),
  benchReadiness:{reasonCodes:h.benchReadiness?.reasonCodes},benchCatalog:{'MJ-BENCH-WHEEL':{startingProfile:p&&{id:p.id,revision:p.revision,digest:p.digest}}},modelMaturity:h.modelMaturity};
}
async function smoke({endpoint,origin,pin,local,mac,store,summary}){
 const key=process.env.MEKONIQ_LAB_ACCESS_KEY;must(typeof key==='string'&&key.length>0,'ACCESS_KEY_REQUIRED');secrets.add(key);
 const runtimeIdentity={sourceCommit:pin.sourceCommit,schemaHash:pin.schemaHash},projectDoc=JSON.parse(readFileSync(join(source,fixture)));
 const arch=local?'arm64':'x86_64',actions={},readiness={},reports={},owned=new Set(),archived=new Set();let bearer;
 const api=async(path,body,status=200)=>{
  const r=await fetch(endpoint+'/lab/v2'+path,{method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(120000),
   headers:{Origin:origin,...body===undefined?{}:{'Content-Type':'application/json'},...bearer?{Authorization:'Bearer '+bearer}:{}},...body===undefined?{}:{body:JSON.stringify(body)}});
  must(r.status===status,'HTTP_'+r.status+'_'+path.split('?')[0]);const value=await r.json();return {value,allowOrigin:r.headers.get('access-control-allow-origin')};
 };
 const archive=async id=>{
  if(archived.has(id))return;
  archived.add(id);
  try{const {value}=await api('/runs/'+id+'/archive',{});must(value.runId===id&&value.archived===true,'ARCHIVE_RECEIPT_INVALID');summary.cleanup.push({runId:id,archived:true});}
  catch(e){summary.cleanup.push({runId:id,archived:false,error:failure(e)});throw e;}
 };
 try{
  const h=await api('/health'),health=projectHealth(h.value,h.allowOrigin);store('health',health);checkHealth(health,pin,origin);summary.cases.health='tested';
  const paired=(await api('/sessions',{token:key},201)).value;
  must(typeof paired.sessionToken==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(paired.sessionToken),'SESSION_RECEIPT_INVALID');
  bearer=paired.sessionToken;secrets.add(bearer);if(typeof paired.csrfToken==='string')secrets.add(paired.csrfToken);
  for(const [kind,[scenarioId,backendSetId]] of Object.entries(scenarios)){
   const isCell=kind==='cell',limit=isCell?14000:500,context={scenarioId,backendSetId};
   const checked=isCell?await api('/readiness',{...context,project:projectDoc}):await api('/readiness?'+new URLSearchParams(context));
   const v=checked.value;readiness[kind]={scenarioId:v.scenarioId,backendSetId:v.backendSetId,canStart:v.canStart,checks:v.checks?.map(({id,status,reasonCodes})=>({id,status,reasonCodes}))};
   checkReadiness(kind,readiness[kind]);
   const request={...context,scenarioRevision:1,seed:isCell?7:3,mode:'simulation',access:'simulated',runtimeIdentity,
    ...isCell?{project:projectDoc,driveExperimentId:'drive-nominal-v1'}:{bench:{schemaVersion:1,scenarioId,axis:'wheels',signal:{kind:'step',amplitude:2,atTick:10},driveExperimentId:'drive-nominal-v1',controlProfile:h.value.benchCatalog[scenarioId].startingProfile}}};
   const created=(await api('/runs',request,201)).value,id=created.run?.id;
   must(uuid.test(id)&&!owned.has(id),'CREATE_RUN_ID_INVALID');owned.add(id);if(typeof created.reclaimToken==='string')secrets.add(created.reclaimToken);
   const c={runId:id,runRevision:created.run.runRevision,tick:created.tick,status:created.run.status};
   const record={created:c,steps:[]};actions[kind]=record;must(c.runRevision===0&&c.tick===0&&c.status==='ready','CREATE_RECEIPT_INVALID');let current=c;
   const act=async (kind,payload)=>{
    const actionId=randomUUID(),startNs=process.hrtime.bigint().toString(),expectedRevision=current.runRevision;
    const {value}=await api('/runs/'+id+'/actions',{actionId,expectedRevision,kind,payload});
    const row={actionId,kind,...payload,runId:value.run?.id,expectedRevision,runRevision:value.run?.runRevision,startTick:current.tick,endTick:value.tick,status:value.run?.status,startNs,endNs:process.hrtime.bigint().toString()};
    if(kind==='start')record.start=row;else record.steps.push(row);
    must(row.runId===id&&row.runRevision===expectedRevision+1&&Number.isSafeInteger(row.endTick)&&
     (kind==='start'?row.endTick===0&&row.status==='running':row.endTick>row.startTick&&row.endTick<=row.startTick+100),'ACTION_RECEIPT_INVALID');
    current={runId:id,runRevision:row.runRevision,tick:row.endTick,status:row.status};
   };
   await act('start',{});
   while(current.status==='running'){must(current.tick<limit&&record.steps.length<limit/100,'STEP_LIMIT');await act('step',{ticks:100});}
   const report=(await api('/runs/'+id+'/report')).value;store(kind+'-report',report);reports[kind]=report;
   must(report.manifest?.runId===id&&report.schemaHash===pin.schemaHash,'REPORT_IDENTITY');elapsed(kind,record,report);
   if(isCell){checkCell(report,arch,pin.sourceCommit);if(mac)summary.macComparison=comparison(mac,report);}
   else{const trace=(await api('/runs/'+id+'/trace')).value;store('bench-trace',trace);checkBench(report,trace,health,arch,pin.sourceCommit);}
   summary.cases[kind]='tested';await archive(id);
  }
  summary.timing=timing(actions,reports.cell,reports.bench);
 }finally{
  for(const id of owned)if(!archived.has(id))try{await archive(id);}catch{/* cleanup retains its own failure alongside the original */ }
  store('actions',actions);store('readiness',readiness);
 }
}
export function failure(e){
 // HTTP errors do not include remote bodies, redirects, headers or supplied credentials.
 const m=e?.message??'';return /^[A-Z][A-Z0-9_]*(?:_\/[a-zA-Z0-9/-]+)?$/.test(m)?m:'RECORDER_OPERATION_FAILED';
}
async function main(){
 const {positionals,values:v}=parseArgs({allowPositionals:true,options:Object.fromEntries([...['candidate','runtime-manifest','endpoint','origin','out'].map(k=>[k,{type:'string'}]),['release-approved',{type:'boolean'}]])});
 const [mode]=positionals,local=mode==='diagnose';must(positionals.length===1&&['plan','execute','diagnose'].includes(mode),'MODE_REQUIRED');
 must(v.endpoint&&v.origin,'ENDPOINT_AND_ORIGIN_REQUIRED');endpointCheck(v.endpoint,v.origin,local);
 let base,pin,metadata;
 if(local){must(v['runtime-manifest']&&!v.candidate&&!v['release-approved'],'DIAGNOSTIC_MANIFEST_REQUIRED');pin=JSON.parse(readFileSync(v['runtime-manifest']));
  must(pin.dirty===false&&pin.sourceCommit===sourceCommit(process.cwd())&&/^[0-9a-f]{64}$/.test(pin.schemaHash)&&/^[0-9a-f]{64}$/.test(pin.artifactSha256),'DIAGNOSTIC_IDENTITY');}
 else{
  must(v.candidate&&!v['runtime-manifest'],'CANDIDATE_REQUIRED');
  base=await readCandidate(resolve(v.candidate));pin=base.q.lab.pin;
  must(sourceCommit(process.cwd())===pin.sourceCommit&&!sourceDirty(process.cwd()),'CLEAN_CANDIDATE_SOURCE_REQUIRED');
  if(mode==='plan'){console.log(JSON.stringify({mode,candidateId:base.q.candidateId,sourceCommit:pin.sourceCommit,labCommit:base.q.lab.commit,imageId:base.native.imageId,service,project,region,endpoint:v.endpoint,origin:v.origin,accepted:false}));return;}
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
 if(base){for(const [k,doc] of Object.entries(metadata))store(k,doc);put('mac-cell-report',base.macBytes);put('native-container',base.nativeBytes);}
 else store('runtime-identity',{sourceCommit:pin.sourceCommit,schemaHash:pin.schemaHash,artifactSha256:pin.artifactSha256,accepted:false});
 const summary={schema:'mekoniq-cloud-run-r4-smoke/1',accepted:false,mode:local?'local-diagnostic':'qualification',service:v.endpoint,origin:v.origin,expectedCommit:pin.sourceCommit,
  status:'failed',cases:{health:'not_run',cell:'not_run',bench:'not_run'},cleanup:[]};
 try{
  await smoke({endpoint:v.endpoint,origin:v.origin,pin,local,mac:base?.mac,store,summary});
  if(base){const final=deploymentReadback(metadata.deployment,base.native);
   must(final.deployment.revision===metadata.deployment.revision&&final.deployment.image===metadata.deployment.image,'DEPLOYMENT_CHANGED');}
  summary.status=local?'diagnostic_complete':'tested';
 }catch(e){summary.failure=failure(e);}
 store('summary',summary);writeFileSync(join(out,'checksums.json'),JSON.stringify({algorithm:'sha256',files},null,2)+'\n',{flag:'wx',mode:0o600});
 must(summary.status!=='failed',summary.failure);
 if(base){const issues=checkCloudRunR4Evidence(p=>boundedEvidenceRead(out,p),base.qBytes);must(!issues.length,'SUPPLEMENT_READBACK_FAILED');}
 console.log(JSON.stringify({status:summary.status,accepted:false,timing:summary.timing}));
}
if(import.meta.main)main().catch(e=>{console.error(failure(e));process.exitCode=1;});
