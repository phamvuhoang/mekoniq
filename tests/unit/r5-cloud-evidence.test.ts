/* eslint-disable @typescript-eslint/no-explicit-any -- deliberately mutate synthetic wire documents at the evidence boundary */
// CLD06 (R5) offline: a synthetic supplement bound to the exact bytes of a synthetic R5 record, refused on every binding it carries; and the producer's HTTP flow on loopback.
import {test,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
// @ts-expect-error plain ESM
import {checkCloudRunR5Evidence,R5_CLOUD} from '../../scripts/cloud-run-qualification.mjs';
// @ts-expect-error plain ESM
import {hostCldBundles,CLD_PROJECT} from '../../scripts/r5-readback.mjs';
import {sourceCommit as repoSourceCommit} from '../../scripts/repo-identity.mjs';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const commit='a'.repeat(40),lab='b'.repeat(40),schemaHash='c'.repeat(64),artifactSha256='d'.repeat(64),projectDigest='9'.repeat(64);
const service='mekoniq-lab-runtime',url='https://mekoniq-lab-runtime-ojykcqdkja-as.a.run.app',origin='https://lab.mekoniq.app',revision=service+'-00006-abc';
const image='asia-southeast1-docker.pkg.dev/mekoniq/lab/mekoniq-lab-runtime@sha256:'+'e'.repeat(64),nativeId='sha256:'+'1'.repeat(64);
const digests={'serve-hw-a-v1':'3'.repeat(64),'serve-hw-b-v1':'4'.repeat(64),'serve-hw-c-v1':'5'.repeat(64)},states={'serve-hw-a-v1':'blocked','serve-hw-b-v1':'compiled','serve-hw-c-v1':'compiled'};
const stopReport=(runId:string,arch:string,tick:number,distance:number)=>({schemaVersion:1,manifest:{runId,sourceCommit:commit,scenario:{id:'MJ-TRAY01',revision:1,hash:'6'.repeat(64)},seed:7,mode:'simulation',access:'simulated',backendSetId:'engineering-mujoco-3d-v1',
 stopSchedule:{entries:[R5_CLOUD.stopEntry],hash:'7'.repeat(64)},drive:{experimentId:'drive-hw-c-coast-v1',driveModelDigest:'8'.repeat(64),controlProfileDigest:'f'.repeat(64),hostArch:arch},calibration:{status:'not_calibrated'}},
 outcome:{status:'needs_attention',served:'0',tick,simTimeNs:String(tick*20_000_000)},attention:[{reason:'EMERGENCY_STOP',robotId:'amr-1',subjectId:'s1',tick:412},{reason:'DRIVE_FAULT',robotId:'amr-1',tick:412}],metrics:{distanceM:{'amr-1':distance}}});
function fixture(){
 const cld04={schemaVersion:2,imageId:'sha256:'+'2'.repeat(64),platform:'linux/arm64',sourceCommit:commit,schemaHash,project:{...structuredClone(CLD_PROJECT),digest:projectDigest},
  options:Object.fromEntries(Object.keys(digests).map(k=>[k,{state:states[k as keyof typeof states],digest:digests[k as keyof typeof digests],projectDigest}])),
  stop:{entry:R5_CLOUD.stopEntry,function:'emergency',scheduledTick:412,tick:412,status:'needs_attention',served:'0'},diff:[],diffEmpty:true,uid:'1000'};
 const container={schemaVersion:2,accepted:false,sourceCommit:commit,cld04:{status:'tested',evidence:{file:'cld04.json',sha256:sha(JSON.stringify(cld04))}},
  cld05:{status:'tested',platform:'linux/amd64',sourceCommit:commit,imageId:nativeId,workflowRun:'https://github.com/o/r/actions/runs/1/attempts/1'},cld06:{status:'not_run',reason:'deploy_order_pending'}};
 const mac=stopReport('10000000-0000-4000-8000-000000000001','arm64',1316,1.264),cloud={...stopReport('20000000-0000-4000-8000-000000000002','x86_64',1316,1.27),schemaHash,protocolMajor:2};
 const q:any={release:'r5',accepted:false,acceptedBy:null,candidateId:'r5-candidate-02',identity:{identityStable:true,before:{sourceCommit:commit}},lab:{commit:lab,pin:{sourceCommit:commit,schemaHash,artifactSha256}},
  cases:{CLD04:{status:'tested'},CLD05:{status:'tested'},CLD06:{status:'not_run',reason:'deploy_order_pending'}},gates:{'G-CLOUD3':{accepted:false,status:'not_run'}},
  inputs:{containerRecord:{file:R5_CLOUD.container,sha256:sha(JSON.stringify(container))}},artifacts:[{file:R5_CLOUD.cld04,sha256:sha(JSON.stringify(cld04))},{file:R5_CLOUD.macStop,sha256:sha(JSON.stringify(mac))}]};
 const env=[{name:'LAB_ALLOW_ORIGIN',value:origin},{name:'LAB_PUBLIC_HOST',value:new URL(url).host},{name:'MEKONIQ_LAB_ACCESS_KEY',valueFrom:{secretKeyRef:{name:'lab-access-key',key:'latest'}}}];
 const spec={serviceAccountName:service+'@mekoniq.iam.gserviceaccount.com',timeoutSeconds:3600,containerConcurrency:20,containers:[{image,env,resources:{limits:{cpu:'1',memory:'2Gi'}}}]};
 const annotations={'autoscaling.knative.dev/maxScale':'1','run.googleapis.com/execution-environment':'gen2'},traffic=[{revisionName:revision,percent:100}],conditions=[{type:'Ready',status:'True'}];
 const labels={'cloud.googleapis.com/location':'asia-southeast1','serving.knative.dev/service':service};
 const f:Record<string,any>={
  'deployment.json':{schema:'mekoniq-cloud-run-deployment/2',accepted:false,project:'mekoniq',region:'asia-southeast1',service,url,origin,revision,image,platform:'linux/amd64',labCommit:lab,sourceCommit:commit,schemaHash,artifactSha256,qualification:{candidateId:q.candidateId,sha256:sha(JSON.stringify(q))}},
  'service.json':{metadata:{name:service,labels},spec:{template:{metadata:{annotations},spec}},status:{url,latestReadyRevisionName:revision,traffic,conditions}},
  'revision.json':{metadata:{name:revision,labels,annotations},spec:structuredClone(spec),status:{imageDigest:image,conditions:structuredClone(conditions)}},
  'promotion.json':{Id:nativeId,Os:'linux',Architecture:'amd64',RepoDigests:[image],Config:{Labels:{'org.opencontainers.image.revision':commit}}},
  'container-record.json':container,'cld04.json':cld04,'mac-stop-report.json':mac,'stop-report.json':cloud,
  'health.json':{sourceCommit:commit,schemaHash,protocolMajor:2,allowOrigin:origin,features:{bearer:true},deployment:{bind:'public'},capabilities:['engineering_bundle_v1','electrical_bundle_v1'],backends:[{id:'mujoco_3d',installed:true,reachable:true,enabled:true}]},
  'electrical.json':{projectDigest,options:Object.fromEntries(Object.keys(digests).map(k=>[k,{state:states[k as keyof typeof states],digest:digests[k as keyof typeof digests]}]))},
  'summary.json':{schema:'mekoniq-cloud-run-r5-smoke/1',accepted:false,mode:'qualification',service:url,origin,expectedCommit:commit,status:'tested',cases:{health:'tested',electrical:'tested',stop:'tested'},
   cleanup:[{runId:cloud.manifest.runId,archived:true}],macComparison:{stopTick:412,status:'needs_attention',served:'0',tickMac:1316,tickCloud:1316,distanceMacM:1.264,distanceCloudM:1.27,relativeTolerance:0.05}}};
 return {q,f};
}
function check(q:any,f:Record<string,any>){const b=Object.fromEntries(Object.entries(f).map(([k,v])=>[k,JSON.stringify(v)]));b['checksums.json']=JSON.stringify({algorithm:'sha256',files:Object.fromEntries(Object.entries(b).map(([k,v])=>[k,sha(v)]))});return checkCloudRunR5Evidence((p:string)=>b[p],JSON.stringify(q));}

test('a complete synthetic supplement binds the exact R5 bytes, the deployment, three Mac digests and the Mac stop run',()=>{const {q,f}=fixture();expect(check(q,f)).toEqual([]);});
test.each([
 ['another record (one byte)','deployment.json',(x:any)=>{x.qualification.sha256=sha(JSON.stringify({}));}],
 ['another source','deployment.json',(x:any)=>{x.sourceCommit='e'.repeat(40);}],
 ['another Lab pin','deployment.json',(x:any)=>{x.labCommit='e'.repeat(40);}],
 ['another schema','deployment.json',(x:any)=>{x.schemaHash='e'.repeat(64);}],
 ['accepted','deployment.json',(x:any)=>{x.accepted=true;}],
 ['an image that is not the native CLD05 image','promotion.json',(x:any)=>{x.Id='sha256:'+'2'.repeat(64);}],
 ['an unrouted revision','service.json',(x:any)=>{x.status.traffic[0].percent=99;}],
 ['health of another commit','health.json',(x:any)=>{x.sourceCommit='e'.repeat(40);}],
 ['health of another schema','health.json',(x:any)=>{x.schemaHash='e'.repeat(64);}],
 ['no electrical capability','health.json',(x:any)=>{x.capabilities=['engineering_bundle_v1'];}],
 ['a Cloud Run digest that is not the Mac digest','electrical.json',(x:any)=>{x.options['serve-hw-b-v1'].digest='f'.repeat(64);}],
 ['HW-A compiled on Cloud Run','electrical.json',(x:any)=>{x.options['serve-hw-a-v1'].state='compiled';}],
 ['another project','electrical.json',(x:any)=>{x.projectDigest='f'.repeat(64);}],
 ['a stop off the scheduled tick','stop-report.json',(x:any)=>{x.attention[0].tick=413;}],
 ['a stop run that served','stop-report.json',(x:any)=>{x.outcome.served='1';}],
 ['a stop run on arm64','stop-report.json',(x:any)=>{x.manifest.drive.hostArch='arm64';}],
 ['another drive experiment','stop-report.json',(x:any)=>{x.manifest.drive.experimentId='drive-hw-c-brake-v1';}],
 ['an end tick outside the tolerance','stop-report.json',(x:any)=>{x.outcome.tick=1500;}],
 ['a distance outside the tolerance','stop-report.json',(x:any)=>{x.metrics.distanceM['amr-1']=1.5;}],
 ['a comparison that is not recomputed','summary.json',(x:any)=>{x.macComparison.distanceCloudM=1.264;}],
 ['a failed cleanup','summary.json',(x:any)=>{x.cleanup[0].archived=false;}],
 ['a diagnostic run','summary.json',(x:any)=>{x.mode='local-diagnostic';}],
 ['a container record that is not the record\'s','container-record.json',(x:any)=>{x.cld05.imageId='sha256:'+'3'.repeat(64);}],
 ['Mac digests that are not the record\'s','cld04.json',(x:any)=>{x.options['serve-hw-c-v1'].digest='f'.repeat(64);}],
 ['a Mac run that is not the record\'s','mac-stop-report.json',(x:any)=>{x.outcome.tick=1317;}],
] as const)('refuses %s',(_,file,mutate)=>{const {q,f}=fixture();mutate(f[file]);expect(check(q,f)).not.toEqual([]);});
test.each([
 ['CLD05 not tested',(q:any)=>{q.cases.CLD05={status:'not_run',reason:'CLD05_NATIVE_MISSING'};}],
 ['CLD06 already tested',(q:any)=>{q.cases.CLD06={status:'tested'};}],
 ['an accepted record',(q:any)=>{q.accepted=true;}],
 ['another release',(q:any)=>{q.release='r4';}],
] as const)('refuses a record with %s',(_,mutate)=>{const {q,f}=fixture();mutate(q);f['deployment.json'].qualification.sha256=sha(JSON.stringify(q));expect(check(q,f)).not.toEqual([]);});
test('a file changed after checksums.json is refused',()=>{const {q,f}=fixture();const b=Object.fromEntries(Object.entries(f).map(([k,v])=>[k,JSON.stringify(v)]));
 b['checksums.json']=JSON.stringify({algorithm:'sha256',files:Object.fromEntries(Object.entries(b).map(([k,v])=>[k,sha(v)]))});b['electrical.json']+=' ';
 expect(checkCloudRunR5Evidence((p:string)=>b[p],JSON.stringify(q))).toEqual(['ARTIFACT_HASH_MISMATCH:electrical.json']);});
test('plan refuses a candidate the R5 reader does not read back',()=>{
 const dir=mkdtempSync(join(tmpdir(),'r5-plan-'));try{writeFileSync(join(dir,'qualification.json'),JSON.stringify(fixture().q));
  const p=spawnSync(process.execPath,['scripts/record-r5-cloud.mjs','plan','--candidate',dir,'--endpoint',url,'--origin',origin],{encoding:'utf8'});expect(p.status).toBe(1);expect(p.stderr).toContain('CANDIDATE_INVALID');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test.each(['ok','digest','secret'])('HTTP diagnostic compiles the three options to this host\'s digests, stops at the scheduled tick and protects tokens (%s)',async(mode)=>{
 const dir=mkdtempSync(join(tmpdir(),'r5-cloud-wire-')),out=join(dir,'out'),key='private-access-key-marker',token='private-session-marker',reclaim='private-reclaim-marker',paths:string[]=[];
 const host=await hostCldBundles(),sourceCommit=repoSourceCommit('.'),runId='30000000-0000-4000-8000-000000000003',byDigest:Record<string,string>={};let rev=0,tick=0,status='ready';
 const api=createServer(async(req,res)=>{const path=new URL(req.url!,'http://localhost').pathname.replace('/lab/v2','');paths.push(req.method+' '+path);res.setHeader('access-control-allow-origin','http://127.0.0.1:4175');
  let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text||'{}');let code=200,data:any={};
  if(path==='/health')data={sourceCommit,schemaHash,protocolMajor:2,features:{bearer:true},deployment:{bind:'loopback'},capabilities:['electrical_bundle_v1'],backends:[{id:'mujoco_3d',installed:true,reachable:true,enabled:true}]};
  else if(path==='/sessions'){code=body.token===key?201:403;data={sessionToken:token,csrfToken:'private-csrf-marker'};}
  else if(req.headers.authorization!=='Bearer '+token)code=403;
  else if(path==='/engineering/compile')data={state:'compiled',bundleDigest:'0'.repeat(64),projectDigest:host.projectDigest};
  else if(path==='/engineering/electrical'){const id=body.design.id as string,o=host.options[id];const digest=mode==='digest'&&id==='serve-hw-c-v1'?'f'.repeat(64):o.digest;byDigest[digest]=id;data={state:o.state,digest,problems:[]};}
  else if(path.startsWith('/engineering/electrical/')){const d=path.split('/')[3]!;data={digest:d,state:host.options[byDigest[d]!].state,inputs:{project:{digest:host.projectDigest}}};}
  else if(path==='/runs'){code=body.stopSchedule?.[0]?.trigger?.value===8220&&body.runtimeIdentity.sourceCommit===sourceCommit?201:422;data={run:{id:runId,runRevision:0,status},tick:0,reclaimToken:reclaim};}
  else if(path===`/runs/${runId}/actions`){if(body.expectedRevision!==rev)code=409;rev++;if(body.kind==='step'){tick=Math.min(1316,tick+body.payload.ticks);if(tick>=412&&status==='running')tick=Math.max(tick,412);}
   status=body.kind==='start'?'running':tick>=412?'needs_attention':'running';data={run:{id:runId,runRevision:rev,status},tick};}
  else if(path===`/runs/${runId}/report`){data={...stopReport(runId,process.arch==='arm64'?'arm64':'x86_64',tick,1.2),schemaHash,protocolMajor:2};data.manifest.sourceCommit=sourceCommit;if(mode==='secret')data.extra=token;}
  else if(path===`/runs/${runId}/archive`)data={runId,archived:true};
  else code=404;
  res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(data));});
 await new Promise<void>(r=>api.listen(0,'127.0.0.1',r));const endpoint='http://127.0.0.1:'+(api.address() as {port:number}).port;
 try{writeFileSync(join(dir,'manifest.json'),JSON.stringify({sourceCommit,schemaHash,artifactSha256,dirty:false}));
  const p=spawn(process.execPath,['scripts/record-r5-cloud.mjs','diagnose','--runtime-manifest',join(dir,'manifest.json'),'--endpoint',endpoint,'--origin','http://127.0.0.1:4175','--out',out],{env:{...process.env,MEKONIQ_LAB_ACCESS_KEY:key},stdio:['ignore','pipe','pipe']});
  let log='';p.stdout.on('data',v=>log+=v);p.stderr.on('data',v=>log+=v);const code=await new Promise(r=>p.on('close',r));
  expect(code,log).toBe(mode==='ok'?0:1);
  const artifacts=readdirSync(out).map(k=>readFileSync(join(out,k),'utf8')).join('\n');for(const s of [key,token,reclaim,'private-csrf-marker'])expect(log+artifacts).not.toContain(s);
  const summary=JSON.parse(readFileSync(join(out,'summary.json'),'utf8'));
  if(mode==='ok'){expect(summary).toMatchObject({mode:'local-diagnostic',status:'diagnostic_complete',cases:{health:'tested',electrical:'tested',stop:'tested'},cleanup:[{runId,archived:true}]});
   // stepped and observed as stop-v1: start, then 250-tick steps until 412 + 750 ticks were observed
   expect(JSON.parse(readFileSync(join(out,'actions.json'),'utf8')).steps.at(-1).endTick).toBeGreaterThanOrEqual(1162);}
  if(mode==='digest')expect(summary.failure).toBe('CLOUD_DIGEST_MISMATCH');
  if(mode==='secret')expect(summary.status).toBe('failed');
  if(mode!=='digest')expect(paths).toContain(`POST /runs/${runId}/archive`);
 }finally{api.closeAllConnections();await new Promise<void>(r=>api.close(()=>r()));rmSync(dir,{recursive:true,force:true});}
},120_000);
