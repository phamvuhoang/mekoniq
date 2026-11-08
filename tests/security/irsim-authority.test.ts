// IR-SIM runs through the real /lab/v2 gateway: the server locks the bundle's projections by session ownership; a caller cannot supply endpoints,
// actors, interpreters, YAML or code, cannot borrow another session's bundle or run, and an IR scenario never lands on a legacy set (or a legacy one on the IR set).
import {afterEach,expect,test} from 'vitest';
import {execFileSync} from 'node:child_process';
import {readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {startLabGateway,type LabGateway} from '../../packages/lab-runtime/src/gateway';
import {createEngineeringService} from '../../packages/lab-runtime/src/engineering/gateway';
import {createNavigationCompiler} from '../../packages/lab-runtime/src/engineering/navigation-compiler';
import {resolve} from 'node:path';
import {portableSimulationFromOptions} from '../../packages/lab-runtime/src/v2/navigation2d/readiness';
import {navigationFixture} from '../support/navigation2d';
import {testCompiler,writeFixtureCatalog} from '../support/engineering';
import {irPython,irsimAvailable,temp,workerRoot} from '../support/irsim-mission';

const IR='engineering-irsim-2d-v1',runtimeIdentity={sourceCommit:'test-commit',schemaHash:'a'.repeat(64)};
const gateways:LabGateway[]=[],dirs:string[]=[];
afterEach(async()=>{for(const g of gateways.splice(0))await g.close();for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
async function pair(g:LabGateway){
 const r=await fetch(g.url+'/lab/v2/sessions',{method:'POST',headers:{origin:'http://127.0.0.1:4175','content-type':'application/json'},body:JSON.stringify({token:g.issuePairingToken()})});
 return {cookie:r.headers.get('set-cookie')!.split(';')[0]!,origin:'http://127.0.0.1:4175','content-type':'application/json','x-csrf-token':String((await r.json()).csrfToken)};
}
const post=(g:LabGateway,h:Record<string,string>,path:string,body:unknown)=>fetch(g.url+'/lab/v2'+path,{method:'POST',headers:h,body:JSON.stringify(body)});
const get=(g:LabGateway,h:Record<string,string>,path:string)=>fetch(g.url+'/lab/v2'+path,{headers:{cookie:h.cookie!}});
const runBody=(over:Record<string,unknown>)=>({scenarioId:'IR-FD01',scenarioRevision:1,seed:5,mode:'simulation',access:'simulated',backendSetId:IR,runtimeIdentity,...over});

async function gateway(portable:boolean){
 const root=await temp('irsim-sec-');dirs.push(root);
 const f=navigationFixture('serve').fixture,catalogRoot=join(root,'catalog');
 await writeFixtureCatalog(catalogRoot,f as never);
 const engineering=createEngineeringService({directory:join(root,'engineering'),catalogRoot,compiler:testCompiler,compilers:{[IR]:createNavigationCompiler({python:irPython,workerRoot,descriptionHelperRoot:resolve('robotics/simulation')})}});
 const p=await portableSimulationFromOptions({enabled:portable,python:irPython,workerRoot,lockPath:join(workerRoot,'requirements.lock'),directory:join(root,'runs'),bundleFile:(d,x)=>engineering.bundleFile(d,x)});
 const g=await startLabGateway({port:0,directory:join(root,'runs'),sourceCommit:'test-commit',schemaHash:'a'.repeat(64),v2:{catalog:p.catalog,enabledBackends:['mock_amr',...p.enabledBackends],simulationFactory:p.simulationFactory,...p.readinessChecks?{portableChecks:p.readinessChecks}:{},engineering}});
 gateways.push(g);
 return {g,f,root};
}

test.skipIf(!irsimAvailable)('IR runs: server-locked projections, no caller endpoints/actors/code, bundle and run ownership, no cross-set scenarios',async()=>{
 const {g,f,root}=await gateway(true),a=await pair(g),b=await pair(g);
 const health=await (await get(g,a,'/health')).json() as {capabilities:string[];backends:{id:string;installed:boolean;enabled:boolean}[];backendSets:{id:string;execution?:{host:string}}[]};
 expect(health.capabilities).toEqual(expect.arrayContaining(['engineering_bundle_v1','irsim_navigation_v1']));
 expect(health.backends.find(x=>x.id==='irsim_2d')).toMatchObject({installed:true,enabled:true});
 expect(health.backendSets.find(s=>s.id===IR)!.execution).toMatchObject({host:'portable_python',clock:'source_fixed_step'});
 expect(health.backendSets.find(s=>s.id==='mock-amr')!.execution).toBeUndefined();
 const receipt=await (await post(g,a,'/engineering/compile',{project:f.project})).json() as {state:string;bundleDigest:string;projectDigest:string};
 expect(receipt.state).toBe('compiled');
 const ref={bundleDigest:receipt.bundleDigest,projectDigest:receipt.projectDigest};
 // caller-supplied endpoints, actors, interpreters, YAML or code are not fields of a run or a readiness request
 for(const extra of [{endpoint:'http://127.0.0.1:9/irsim'},{actorRef:'lab-staff'},{python:'/bin/sh'},{workerRoot:'/tmp'},{worldYaml:'robots: []'},{scene:{documentType:'navigation-scene'}},{entry:['-c','print(1)']}]){
  const r=await post(g,a,'/runs',runBody({engineeringRef:ref,...extra}));
  expect(r.status,JSON.stringify(extra)).toBe(422);expect((await r.json()).error).toBe('INVALID_RUN_REQUEST');
  expect((await post(g,a,'/readiness',{scenarioId:'IR-FD01',backendSetId:IR,engineeringRef:ref,...extra})).status,JSON.stringify(extra)).toBe(400);
 }
 // another session's bundle, a project that is not the bundle's projection, no bundle at all
 expect((await post(g,b,'/runs',runBody({engineeringRef:ref}))).status).toBe(403);
 const forged=structuredClone(f.project.runtimeProject) as {world:{width:number}};forged.world.width=30;
 const mismatch=await post(g,a,'/runs',runBody({engineeringRef:ref,project:forged}));
 expect(mismatch.status).toBe(409);expect((await mismatch.json()).error).toBe('ENGINEERING_IDENTITY_MISMATCH');
 const noRef=await post(g,a,'/runs',runBody({project:f.project.runtimeProject}));
 expect(noRef.status).toBe(422);expect((await noRef.json()).reasonCodes).toEqual(['ENGINEERING_REF_REQUIRED']);
 // the IR set runs only IR-FD01, and IR-FD01 never runs on a legacy set
 const legacyOnIr=await post(g,a,'/runs',runBody({engineeringRef:ref,scenarioId:'FD01'}));
 expect(legacyOnIr.status).toBe(422);expect((await legacyOnIr.json()).reasonCodes).toEqual(['SCENARIO_UNSUPPORTED_BY_SET']);
 const irOnMock=await post(g,a,'/runs',runBody({project:f.project.runtimeProject,mode:'mock',backendSetId:'mock-amr'}));
 expect(irOnMock.status).toBe(422);expect((await irOnMock.json()).reasonCodes).toEqual(['SCENARIO_UNSUPPORTED_BY_SET']);
 // the owner's run executes on irsim_2d with the bundle's own projection; the other session sees nothing
 const created=await post(g,a,'/runs',runBody({engineeringRef:ref}));
 expect(created.status,await created.clone().text()).toBe(201);
 const run=await created.json() as {run:{id:string;backends:string[];runRevision:number}};
 expect(run.run.backends).toEqual(['irsim_2d']);
 expect((await get(g,b,`/runs/${run.run.id}`)).status).toBe(404);
 expect((await post(g,b,`/runs/${run.run.id}/actions`,{actionId:'x',expectedRevision:run.run.runRevision,kind:'start',payload:{}})).status).toBe(404);
 const started=await post(g,a,`/runs/${run.run.id}/actions`,{actionId:'s',expectedRevision:run.run.runRevision,kind:'start',payload:{}});
 expect(started.status,await started.clone().text()).toBe(200);
 const report=await (await get(g,a,`/runs/${run.run.id}/report`)).json() as {manifest:{engineering:unknown;backends:{id:string}[];scenario:{id:string}}};
 expect(report.manifest).toMatchObject({engineering:ref,scenario:{id:'IR-FD01'}});expect(report.manifest.backends.map(x=>x.id)).toEqual(['irsim_2d']);
 // the run's locked scene is its own copy of the bundle's, not something a request could point at
 const runDirs=(await readdir(join(root,'runs'),{withFileTypes:true})).filter(d=>d.isDirectory()&&d.name!=='irsim-probe');
 expect(runDirs).toHaveLength(1);
 expect((await readdir(join(root,'runs',runDirs[0]!.name,'bundle'))).sort()).toEqual(['irsim','navigation-scene.json']);
},120_000);

test.skipIf(!irsimAvailable)('without the provider configured nothing is advertised and an IR run is refused, never moved to mock or native',async()=>{
 const {g,f}=await gateway(false),a=await pair(g);
 const health=await (await get(g,a,'/health')).json() as {capabilities:string[];backends:{id:string;installed:boolean;enabled:boolean;reason?:string}[]};
 expect(health.capabilities).not.toContain('irsim_navigation_v1');
 expect(health.backends.find(x=>x.id==='irsim_2d')).toMatchObject({installed:false,enabled:false});
 const receipt=await (await post(g,a,'/engineering/compile',{project:f.project})).json() as {bundleDigest:string;projectDigest:string};
 const refused=await post(g,a,'/runs',runBody({engineeringRef:{bundleDigest:receipt.bundleDigest,projectDigest:receipt.projectDigest}}));
 expect(refused.status).toBe(422);
 expect((await refused.json()).reasonCodes).toEqual(expect.arrayContaining(['BACKEND_NOT_INSTALLED']));
},120_000);

const compile=async(g:LabGateway,h:Record<string,string>,project:unknown)=>{const r=await (await post(g,h,'/engineering/compile',{project})).json() as {state:string;bundleDigest:string;projectDigest:string};expect(r.state).toBe('compiled');return {bundleDigest:r.bundleDigest,projectDigest:r.projectDigest};};
const workers=(runId:string)=>execFileSync('ps',['-axww','-o','command'],{encoding:'utf8'}).split('\n').filter(l=>l.includes(`--run-id ${runId}`)).length;

test.skipIf(!irsimAvailable)('review B04-2 #5: at most two IR-SIM runs hold a worker per host; the third start is refused with IRSIM_CAPACITY and spawns nothing',async()=>{
 const {g,f}=await gateway(true),a=await pair(g),ref=await compile(g,a,f.project);
 const create=async()=>{const r=await post(g,a,'/runs',runBody({engineeringRef:ref}));expect(r.status,await r.clone().text()).toBe(201);return (await r.json() as {run:{id:string;runRevision:number}}).run;};
 const start=(run:{id:string;runRevision:number})=>post(g,a,`/runs/${run.id}/actions`,{actionId:`start-${run.id}`,expectedRevision:run.runRevision,kind:'start',payload:{}});
 const [x,y,z]=[await create(),await create(),await create()];
 expect((await start(x)).status).toBe(200);expect((await start(y)).status).toBe(200);
 const third=await start(z);
 expect(third.status).toBe(409);expect(await third.json()).toMatchObject({error:'IRSIM_CAPACITY'});
 expect([x,y,z].map(r=>workers(r.id))).toEqual([1,1,0]);
 // the refused start changed nothing on the run; readiness and creation see the host full
 expect((await (await get(g,a,`/runs/${z.id}`)).json() as {run:unknown}).run).toMatchObject({status:'ready',runRevision:z.runRevision});
 const ready=await (await post(g,a,'/readiness',{scenarioId:'IR-FD01',backendSetId:IR,engineeringRef:ref})).json() as {canStart:boolean;checks:{status:string;reasonCodes:string[]}[]};
 expect(ready.canStart).toBe(false);expect(ready.checks.find(c=>c.reasonCodes.includes('IRSIM_CAPACITY'))!.status).toBe('blocked');
 const full=await post(g,a,'/runs',runBody({engineeringRef:ref}));
 expect(full.status).toBe(422);expect((await full.json()).reasonCodes).toContain('IRSIM_CAPACITY');
 // closing a run frees its slot (and its process); the next start then goes through
 expect((await post(g,a,`/runs/${x.id}/archive`,{})).status).toBe(200);
 expect(workers(x.id)).toBe(0);
 expect((await start(z)).status).toBe(200);
 expect([y,z].map(r=>workers(r.id))).toEqual([1,1]);
 await g.close();gateways.splice(gateways.indexOf(g),1);
 expect([y,z].map(r=>workers(r.id))).toEqual([0,0]);
},240_000);

test.skipIf(!irsimAvailable)('review B04-2 #6: a project with a fault schedule is blocked by readiness and refused at creation with FAULT_SCHEDULE_UNSUPPORTED, never a 500',async()=>{
 const {g,f}=await gateway(true),a=await pair(g),project=structuredClone(f.project);
 (project.runtimeProject as {faultSchedule?:unknown[]}).faultSchedule=[{id:'f1',faultId:'amr-disconnect',targetId:'amr-1',trigger:{kind:'elapsed_sim_ms',value:1000},durationMs:1000}];
 const ref=await compile(g,a,project);
 const ready=await (await post(g,a,'/readiness',{scenarioId:'IR-FD01',backendSetId:IR,engineeringRef:ref})).json() as {canStart:boolean;checks:{status:string;reasonCodes:string[]}[]};
 expect(ready.canStart).toBe(false);expect(ready.checks.find(c=>c.reasonCodes.includes('FAULT_SCHEDULE_UNSUPPORTED'))!.status).toBe('blocked');
 const created=await post(g,a,'/runs',runBody({engineeringRef:ref}));
 expect(created.status).toBe(422);expect((await created.json()).reasonCodes).toContain('FAULT_SCHEDULE_UNSUPPORTED');
},240_000);

test.skipIf(!irsimAvailable)('review4 #9 over HTTP: a step batch and a cancel sent together against the same revision: the cancel is honoured, never a stale 409 after the whole batch',async()=>{
 const {g,f}=await gateway(true),a=await pair(g),ref=await compile(g,a,f.project);
 const created=await post(g,a,'/runs',runBody({engineeringRef:ref}));expect(created.status,await created.clone().text()).toBe(201);
 const run=(await created.json() as {run:{id:string;runRevision:number}}).run;
 const started=await post(g,a,`/runs/${run.id}/actions`,{actionId:'start',expectedRevision:run.runRevision,kind:'start',payload:{}});
 expect(started.status,await started.clone().text()).toBe(200);
 const s=await started.json() as {tick:number;run:{runRevision:number}};
 const [step,cancel]=await Promise.all([post(g,a,`/runs/${run.id}/actions`,{actionId:'batch',expectedRevision:s.run.runRevision,kind:'step',payload:{ticks:100}}),
  post(g,a,`/runs/${run.id}/actions`,{actionId:'cancel',expectedRevision:s.run.runRevision,kind:'cancel',payload:{}})]);
 expect(cancel.status,await cancel.clone().text()).toBe(200);
 const c=await cancel.json() as {tick:number};
 expect(c.tick-s.tick).toBeLessThanOrEqual(1);
 // the batch either ran after the cancel at the next boundary (stopping there) or arrived second and is the stale one
 if(step.status===200)expect((await step.json() as {tick:number}).tick).toBe(c.tick);
 else expect([step.status,(await step.json() as {error:string}).error]).toEqual([409,'REVISION_CONFLICT']);
 await post(g,a,`/runs/${run.id}/archive`,{});
},120_000);
