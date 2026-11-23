/* eslint-disable @typescript-eslint/no-explicit-any -- deliberately mutate synthetic wire documents at the evidence boundary */
import {test,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync,chmodSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import nominal from '../fixtures/control/r4-cell-nominal-report.json';
import wheel from '../fixtures/control/r4-wheel-bench-report.json';
// @ts-expect-error plain ESM
import {checkCloudRunR4Evidence} from '../../scripts/cloud-run-qualification.mjs';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const commit=nominal.manifest.sourceCommit,lab='b'.repeat(40),schemaHash='c'.repeat(64),artifactSha256='d'.repeat(64);
const service='mekoniq-lab-runtime',url='https://mekoniq-lab-runtime-ojykcqdkja-as.a.run.app',origin='https://mekoniq-lab.vercel.app',revision=service+'-00004-abc';
const image='asia-southeast1-docker.pkg.dev/mekoniq/lab/mekoniq-lab-runtime@sha256:'+'e'.repeat(64),id='sha256:'+'1'.repeat(64);
const account=service+'@mekoniq.iam.gserviceaccount.com',cellId='50000000-0000-4000-8000-000000000001';
const profile=wheel.bench.request.controlProfile,groups=Object.fromEntries(['geometry','inertia','drive','contact','sensing'].map(k=>[k,'assumed']));
const health={sourceCommit:commit,schemaHash,protocolMajor:2,features:{bearer:true,readiness:true},deployment:{bind:'public'},benchReadiness:{reasonCodes:[]},benchCatalog:{'MJ-BENCH-WHEEL':{startingProfile:profile}},modelMaturity:{mujoco_3d:groups,mujoco_arm:groups},backends:['mujoco_arm','mujoco_3d','mock_coffee'].map(id=>({id,installed:true,reachable:true,enabled:true,compatible:true,commissioned:true}))};
const cellSet='engineering-mujoco-cell-v1',benchSet='engineering-mujoco-bench-v1';
function readiness(scenarioId:string,backendSetId:string){return {scenarioId,backendSetId,canStart:true,checks:['host','runner','backend:mujoco_3d',...(backendSetId===cellSet?['backend:mujoco_arm','backend:mock_coffee']:[])].map(id=>({id,status:'ready',reasonCodes:[]}))};}
function actions(runId:string,ticks:number){let ns=0;const rows=[];for(let t=0;t<ticks;t+=100){const i:number=rows.length;rows.push({runId,actionId:'step-'+i,kind:'step',ticks:100,expectedRevision:i+1,runRevision:i+2,startTick:t,endTick:Math.min(t+100,ticks),startNs:String(ns),endNs:String(ns+=10_000_000),status:t+100>=ticks?'completed':'running'});}
 return {created:{runId,runRevision:0,tick:0,status:'ready'},start:{runId,actionId:'start',kind:'start',expectedRevision:0,runRevision:1,startTick:0,endTick:0,status:'running',startNs:'0',endNs:'1'},steps:rows.map(r=>({...r,startNs:String(Number(r.startNs)+2),endNs:String(Number(r.endNs)+2)}))};}
function fixture(){
 const cell=structuredClone(nominal) as any;cell.schemaHash=schemaHash;cell.manifest.runId=cellId;cell.manifest.drive.hostArch='x86_64';
 const bench=structuredClone(wheel) as any;bench.schemaHash=schemaHash;bench.manifest.sourceCommit=commit;bench.tuning.engine.hostArch='x86_64';
 const env=[{name:'LAB_ALLOW_ORIGIN',value:origin},{name:'LAB_PUBLIC_HOST',value:new URL(url).host},{name:'MEKONIQ_LAB_ACCESS_KEY',valueFrom:{secretKeyRef:{name:'lab-access-key',key:'latest'}}}];
 const spec={serviceAccountName:account,timeoutSeconds:3600,containerConcurrency:20,containers:[{image,env,resources:{limits:{cpu:'1',memory:'2Gi'}}}]};
 const annotations={'autoscaling.knative.dev/maxScale':'1','run.googleapis.com/execution-environment':'gen2'};
 const traffic=[{revisionName:revision,percent:100}],conditions=[{type:'Ready',status:'True'}],labels={'cloud.googleapis.com/location':'asia-southeast1','serving.knative.dev/service':service};
 const container={cld02:{status:'tested',sourceCommit:commit,platform:'linux/amd64',imageId:id}},mac=structuredClone(nominal);
 const q:any={release:'r4',accepted:false,candidateId:'r4-candidate-01',identity:{identityStable:true,before:{sourceCommit:commit}},lab:{commit:lab,pin:{sourceCommit:commit,schemaHash,artifactSha256}},cases:{CLD01:{status:'tested'},CLD02:{status:'tested'},CLD03:{status:'not_run'}},gates:Object.fromEntries(['G-DRV1','G-CIL1','G-TUNE1','G-FLT1','G-TRAY1','G-BEL1','G-REC1','G-WEB2','G-REG5','G-CLOUD2'].map(k=>[k,{accepted:false,status:k==='G-CLOUD2'?'not_run':'tested'}])),inputs:{containerRecord:{file:'inputs/container/container.json',sha256:sha(JSON.stringify(container))}},artifacts:[{file:'inputs/cil/cell/nominal-7/report.json',sha256:sha(JSON.stringify(mac))}]};
 const steps=actions(cellId,cell.outcome.tick),cellMsPerTick=steps.steps.length*10/cell.outcome.tick;
 const f:Record<string,any>={
 'deployment.json':{schema:'mekoniq-cloud-run-deployment/2',accepted:false,project:'mekoniq',region:'asia-southeast1',service,url,origin,revision,image,traffic,platform:'linux/amd64',labCommit:lab,sourceCommit:commit,schemaHash,artifactSha256,qualification:{candidateId:q.candidateId,sha256:sha(JSON.stringify(q))}},
 'service.json':{metadata:{name:service,labels},spec:{template:{metadata:{annotations},spec}},status:{url,latestReadyRevisionName:revision,traffic,conditions}},
 'revision.json':{metadata:{name:revision,labels,annotations},spec:structuredClone(spec),status:{imageDigest:image,conditions:structuredClone(conditions)}},
 'promotion.json':{Id:id,Os:'linux',Architecture:'amd64',RepoDigests:[image],Config:{Labels:{'org.opencontainers.image.revision':commit}}},
 'native-container.json':container,'mac-cell-report.json':mac,'cell-report.json':cell,'bench-report.json':bench,
 'health.json':{...structuredClone(health),allowOrigin:origin},'readiness.json':{cell:readiness('MJ-CELL-BV01',cellSet),bench:readiness('MJ-BENCH-WHEEL',benchSet)},
 'bench-trace.json':{runId:bench.manifest.runId,manifestSha256:bench.tuning.trace.sha256,issues:[],traces:bench.tuning.axisIds.map((axisId:string)=>({axisId,dtS:0.002,samples:Array(5010).fill({target:0,actual:0,feedback:0,torqueNm:0,saturated:false})}))},
 'actions.json':{cell:steps,bench:actions(bench.manifest.runId,500)},
 'summary.json':{schema:'mekoniq-cloud-run-r4-smoke/1',mode:'qualification',accepted:false,status:'tested',cases:{health:'tested',cell:'tested',bench:'tested'},expectedCommit:commit,service:url,origin,cleanup:[cellId,bench.manifest.runId].map(runId=>({runId,archived:true})),timing:{cellTicks:cell.outcome.tick,benchTicks:500,cellMsPerTick,benchMsPerTick:0.1,realtimeFactor:20/cellMsPerTick},macComparison:{servedMac:'2',servedCloud:'2',distanceMacM:mac.metrics.distanceM['amr-1'],distanceCloudM:mac.metrics.distanceM['amr-1'],relativeTolerance:0.05}}};
 return {q,f};
}
function check(q:any,f:Record<string,any>){const b=Object.fromEntries(Object.entries(f).map(([k,v])=>[k,JSON.stringify(v)]));b['checksums.json']=JSON.stringify({algorithm:'sha256',files:Object.fromEntries(Object.entries(b).map(([k,v])=>[k,sha(v)]))});return checkCloudRunR4Evidence((p:string)=>b[p],JSON.stringify(q));}
test('a complete synthetic supplement binds two independent gcloud readbacks, promotion and CIL control',()=>{const {q,f}=fixture();expect(check(q,f)).toEqual([]);});
test.each([
 ['different config ID, same revision label','promotion.json',(x:any)=>{x.Id='sha256:'+'2'.repeat(64);}],
 ['wrong published digest','promotion.json',(x:any)=>{x.RepoDigests=[];}],
 ['nonready revision','revision.json',(x:any)=>{x.status.conditions[0].status='False';}],
 ['unrouted revision','service.json',(x:any)=>{x.status.traffic[0].percent=99;}],
 ['wrong account','revision.json',(x:any)=>{x.spec.serviceAccountName='other';}],
 ['secret literal','service.json',(x:any)=>{x.spec.template.spec.containers[0].env[2].value='DO_NOT_RETAIN';}],
 ['missing backend','health.json',(x:any)=>{x.backends[0].reachable=false;}],
 ['missing maturity','health.json',(x:any)=>{delete x.modelMaturity;}],
 ['wrong origin','health.json',(x:any)=>{x.allowOrigin='https://other.test';}],
 ['bench unavailable','readiness.json',(x:any)=>{x.bench.canStart=false;}],
 ['wrong Lab','deployment.json',(x:any)=>{x.labCommit='e'.repeat(40);}],
 ['wrong source','deployment.json',(x:any)=>{x.sourceCommit='e'.repeat(40);}],
 ['wrong candidate hash','deployment.json',(x:any)=>{x.qualification.sha256='e'.repeat(64);}],
 ['accepted','deployment.json',(x:any)=>{x.accepted=true;}],
 ['diagnostic mode','summary.json',(x:any)=>{x.mode='local-diagnostic';}],
 ['wrong arch','cell-report.json',(x:any)=>{x.manifest.drive.hostArch='aarch64';}],
 ['mock bench','bench-report.json',(x:any)=>{x.tuning.engine.id='mock';}],
 ['failed cell','cell-report.json',(x:any)=>{x.outcome.status='failed';}],
 ['failed bench','bench-report.json',(x:any)=>{x.tuning.status='failed';}],
 ['different executed profile','bench-report.json',(x:any)=>{x.tuning.plant.controlProfileDigest='f'.repeat(64);}],
 ['tuning fault at completion','bench-report.json',(x:any)=>{x.tuning.fault={tick:500,axisId:'amr-1/wheel-left',code:'DRIVE_TRIP'};}],
 ['tuning collision at completion','bench-report.json',(x:any)=>{x.tuning.collision={tick:30};}],
 ['contradictory terminal faults','bench-report.json',(x:any)=>{x.faults=[{code:'DRIVE_TRIP'}];}],
 ['invalid timebase','bench-trace.json',(x:any)=>{x.traces[1].dtS=0.02;}],
 ['missing timebase','bench-trace.json',(x:any)=>{delete x.traces[0].dtS;}],
 ['missing wheel setpoint','bench-trace.json',(x:any)=>{delete x.traces[0].samples[100].target;}],
 ['missing wheel torque','bench-trace.json',(x:any)=>{delete x.traces[1].samples[10].torqueNm;}],
 ['malformed initial substeps','bench-trace.json',(x:any)=>{x.traces[0].samples[1]={actual:0};}],
 ['wrong bench profile','bench-report.json',(x:any)=>{x.bench.request.controlProfile.revision++;}],
 ['wrong seed','cell-report.json',(x:any)=>{x.manifest.seed=8;}],
 ['different scene','cell-report.json',(x:any)=>{x.manifest.models[0].hash='1'.repeat(64);}],
 ['grasp recovery run','cell-report.json',(x:any)=>{x.manifest.perception={graspMode:'belief_estimated'};}],
 ['nudge','cell-report.json',(x:any)=>{x.manifest.profiles.push({provenance:'registered_disturbance'});}],
 ['fault schedule','cell-report.json',(x:any)=>{x.manifest.driveFaultSchedule={entries:[]};}],
 ['different Mac report','mac-cell-report.json',(x:any)=>{x.manifest.sourceCommit='d'.repeat(40);}],
 ['outside metric tolerance','cell-report.json',(x:any)=>{x.metrics.distanceM['amr-1']*=1.1;}],
 ['calibration flags','cell-report.json',(x:any)=>{delete x.manifest.calibration;}],
 ['same run','actions.json',(x:any)=>{x.bench.created.runId=cellId;}],
 ['counter without receipts','actions.json',(x:any)=>{x.cell.steps=[];}],
 ['gap in ticks','actions.json',(x:any)=>{x.bench.steps[2].startTick++;}],
 ['gap in revisions','actions.json',(x:any)=>{x.bench.steps[2].expectedRevision++;}],
 ['timing self-counter','summary.json',(x:any)=>{x.timing.benchMsPerTick=1;}],
 ['failed cleanup','summary.json',(x:any)=>{x.cleanup[1].archived=false;}],
 ['wrong trace','bench-trace.json',(x:any)=>{x.runId=cellId;}],
] as const)('refuses %s',(_,file,mutate)=>{const {q,f}=fixture();mutate(f[file]);expect(check(q,f)).not.toEqual([]);});
test.each(['cell-report.json','mac-cell-report.json'])('both nominal selectors are checked on %s',file=>{
 for(const [selector,id] of [['worldExperimentId','world-cup-nudge-v2'],['graspProgramId','cup-pick-two-stage-v1'],['worldExperimentId','world-nominal-v1']]){
  const {q,f}=fixture();f[file].manifest[selector!]=id;
  if(file==='mac-cell-report.json'){
   q.artifacts[0].sha256=sha(JSON.stringify(f[file]));
   f['deployment.json'].qualification.sha256=sha(JSON.stringify(q));
  }
  expect(check(q,f),selector).toEqual(id==='world-nominal-v1'?[]:['CELL_NOMINAL_SCOPE']);
 }
});
test('recorder plan validates a supplied candidate with the actual R4 reader',()=>{
 const dir=mkdtempSync(join(tmpdir(),'r4-plan-'));try{const {q}=fixture();writeFileSync(join(dir,'qualification.json'),JSON.stringify(q));
 const p=spawnSync(process.execPath,['scripts/record-r4-cloud.mjs','plan','--candidate',dir,'--endpoint',url,'--origin',origin],{encoding:'utf8'});expect(p.status).toBe(1);expect(p.stderr).toContain('CANDIDATE_INVALID');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('native handoff verifies recorded ID before writing and binds the exact saved bytes',()=>{
 const dir=mkdtempSync(join(tmpdir(),'r4-handoff-'));try{const native=join(dir,'native');mkdirSync(native);const imageDoc={Id:id,Os:'linux',Architecture:'amd64',revision:commit};writeFileSync(join(native,'image.json'),JSON.stringify(imageDoc));writeFileSync(join(native,'qualification-exit.txt'),'0\n');
 const stub=join(dir,'docker');writeFileSync(stub,'#!/bin/sh\nif [ "$2" = inspect ]; then cat "$INSPECT"; elif [ "$2" = save ] && [ "$3" = "$EXPECTED" ]; then printf saved; else exit 1; fi\n');chmodSync(stub,0o755);
 const inspect=join(dir,'inspect');const dockerImage={Id:id,Os:'linux',Architecture:'amd64',Config:{Labels:{'org.opencontainers.image.revision':commit}}};
 const invoke=(out:string)=>spawnSync('bash',['scripts/save-r4-native-image.sh',native,join(dir,out),commit],{encoding:'utf8',env:{...process.env,PATH:dir+':'+process.env.PATH,INSPECT:inspect,EXPECTED:id}});
 writeFileSync(inspect,JSON.stringify([{...dockerImage,Id:'sha256:'+'9'.repeat(64)}]));expect(invoke('bad').status).not.toBe(0);
 writeFileSync(inspect,JSON.stringify([dockerImage]));const p=invoke('good');expect(p.status,p.stderr).toBe(0);const h=JSON.parse(readFileSync(join(dir,'good/handoff.json'),'utf8'));expect(h).toMatchObject({accepted:false,sourceCommit:commit,imageId:id,archiveSha256:sha('saved'),nativeImageSha256:sha(JSON.stringify(imageDoc))});
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test.each(['ok','health','secret','cleanup','primary-and-cleanup'])('HTTP diagnostic exercises only its own runs and protects tokens (%s)',async(mode)=>{
 const dir=mkdtempSync(join(tmpdir(),'r4-cloud-wire-')),out=join(dir,'out'),key='private-access-key-marker',token='private-session-marker',reclaim='private-reclaim-marker',paths:string[]=[],archives:string[]=[];
 const {f}=fixture();const state:Record<string,{tick:number;rev:number;status:string}>={};const sourceCommit=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim();
 const api=createServer(async(req,res)=>{const path=new URL(req.url!,'http://localhost').pathname.replace('/lab/v2','');paths.push(path);res.setHeader('access-control-allow-origin','http://127.0.0.1:4175');
  let requestText='';for await(const chunk of req)requestText+=chunk;const body=JSON.parse(requestText||'{}');let code=200,data:any={};
  if(path==='/health'){data={...health,benchCatalog:{'MJ-BENCH-WHEEL':{startingProfile:{...profile,axes:[{id:'fixture'}]}}},sourceCommit:mode==='health'?commit:sourceCommit};}
  else if(path==='/sessions'){code=201;data={sessionToken:token,csrfToken:'private-csrf-marker'};if(body.token!==key)code=403;}
  else if(req.headers.authorization!=='Bearer '+token){code=403;}
  else if(path==='/readiness'){const query=new URL(req.url!,'http://localhost').searchParams;data=readiness(body.scenarioId??query.get('scenarioId'),body.backendSetId??query.get('backendSetId'));}
  else if(path==='/runs'){const isCell=body.scenarioId==='MJ-CELL-BV01',id=isCell?cellId:wheel.manifest.runId;code=201;
   if(body.seed!==(isCell?7:3)||body.runtimeIdentity.sourceCommit!==sourceCommit||(isCell?body.driveExperimentId!=='drive-nominal-v1':JSON.stringify(body.bench)!==JSON.stringify({...wheel.bench.request,controlProfile:{...profile,axes:[{id:'fixture'}]}})))code=422;
   state[id]={tick:0,rev:0,status:'ready'};data={run:{id,runRevision:0,status:'ready'},tick:0,reclaimToken:reclaim};}
  else {const [, ,id,op]=path.split('/');const isCell=id===cellId,s=state[id!],limit=isCell?nominal.outcome.tick:500;if(!s){code=404;}
   else if(op==='actions'){if(body.expectedRevision!==s.rev)code=409;s.rev++;if(body.kind==='step')s.tick=Math.min(limit,s.tick+body.payload.ticks);s.status=s.tick===limit?'completed':'running';data={run:{id,status:s.status,runRevision:s.rev},tick:s.tick,writer:{reclaimToken:reclaim}};}
   else if(op==='report'){data=structuredClone(f[isCell?'cell-report.json':'bench-report.json']);data.manifest.sourceCommit=sourceCommit;if(isCell)data.manifest.drive.hostArch='arm64';else data.tuning.engine.hostArch='arm64';if(mode==='secret')data.extraPrivateField=token;if(mode==='primary-and-cleanup')code=503;}
   else if(op==='trace')data=f['bench-trace.json'];
   else if(op==='archive'){archives.push(id!);data={runId:id,archived:true};if(mode==='cleanup'||mode==='primary-and-cleanup'){code=409;data={error:key};}}
  }res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(data));});
 await new Promise<void>(r=>api.listen(0,'127.0.0.1',r));const addr=api.address() as {port:number},endpoint='http://127.0.0.1:'+addr.port;
 try{writeFileSync(join(dir,'manifest.json'),JSON.stringify({sourceCommit,schemaHash,artifactSha256,dirty:false}));
  const {spawn}=await import('node:child_process');const p=spawn(process.execPath,['scripts/record-r4-cloud.mjs','diagnose','--runtime-manifest',join(dir,'manifest.json'),'--endpoint',endpoint,'--origin','http://127.0.0.1:4175','--out',out],{env:{...process.env,MEKONIQ_LAB_ACCESS_KEY:key},stdio:['ignore','pipe','pipe']});
  let log='';p.stdout.on('data',v=>log+=v);p.stderr.on('data',v=>log+=v);const code=await new Promise(r=>p.on('close',r));
  expect(code,log).toBe(mode==='ok'?0:1);expect(paths[0]).toBe('/health');if(mode==='health')expect(paths).toEqual(['/health']);else expect(archives).toEqual(mode==='ok'?[cellId,wheel.manifest.runId]:[cellId]);
  const artifacts=readdirSync(out).map(k=>readFileSync(join(out,k),'utf8')).join('\n');for(const s of [key,token,reclaim,'private-csrf-marker'])expect(log+artifacts).not.toContain(s);
  const summary=JSON.parse(readFileSync(join(out,'summary.json'),'utf8'));expect(summary).toMatchObject({mode:'local-diagnostic',accepted:false,status:mode==='ok'?'diagnostic_complete':'failed'});
  if(mode==='primary-and-cleanup'){expect(summary.failure).toContain('503');expect(summary.cleanup[0]).toMatchObject({runId:cellId,archived:false});}
 }finally{api.closeAllConnections();await new Promise<void>(r=>api.close(()=>r()));rmSync(dir,{recursive:true,force:true});}
});
