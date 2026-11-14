import {afterEach,expect,test} from 'vitest';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createMujocoCompiler} from '../../packages/lab-runtime/src/engineering/mujoco-compiler';
import {createEngineeringService} from '../../packages/lab-runtime/src/engineering/gateway';
import {lockDigestOf} from '../../packages/lab-runtime/src/engineering/linkforge';
import {mujocoMobilePlant} from '../../packages/lab-runtime/src/v2/simulation3d/mujoco-mobile';
import {createFixedStepScenarioRun} from '../../packages/lab-runtime/src/v2/navigation2d/runner';
import {defaultCatalog} from '../../packages/lab-runtime/src/v2/capabilities';
import {WorkerLostError} from '../../packages/lab-runtime/src/v2/navigation2d/plant';
import type {PlantPort} from '../../packages/lab-runtime/src/v2/navigation2d/plant';
import type {ScenarioRun} from '../../packages/lab-runtime/src/v2/scenario-runner';
import {navigationFixture} from '../support/navigation2d';
import {testCompiler,writeFixtureCatalog} from '../support/engineering';
const dirs:string[]=[],runs:ScenarioRun[]=[],root=resolve('robotics/simulation-mujoco');
const temp=async()=>{const d=await mkdtemp(join(tmpdir(),'mj-lifecycle-'));dirs.push(d);return d;};
afterEach(async()=>{for(const r of runs.splice(0))await r.close();for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
async function setup(wrap:(plant:PlantPort)=>void,evidence?:{maxBytes:number}){
 const f=navigationFixture('serve-3d').fixture;f.project={...f.project,requestedProfile:'engineering-mujoco-3d-v1'};
 const catalogRoot=await temp();await writeFixtureCatalog(catalogRoot,f);
 const service=createEngineeringService({directory:await temp(),catalogRoot,compiler:testCompiler,compilers:{'engineering-mujoco-3d-v1':createMujocoCompiler({workerRoot:root})}});
 const receipt=await service.compileEngineeringProject(f.project,'owner'),locked=await service.admitRun('owner',{bundleDigest:receipt.bundleDigest,projectDigest:receipt.projectDigest},'engineering-mujoco-3d-v1',undefined);
 const runtime={python:resolve('.venv-mujoco/bin/python'),workerRoot:root,schemaDir:resolve('packages/contracts/schemas'),lockDigest:await lockDigestOf(join(root,'requirements.lock')),engineVersion:'3.17.0',maxActiveRuns:1,...evidence?{evidence}:{}};
 const plant=mujocoMobilePlant(runtime);wrap(plant);
 const catalog={...defaultCatalog,backends:defaultCatalog.backends.map(b=>b.id==='mujoco_3d'?{...b,installed:true,compatible:true,reachable:true}:b)},directory=await temp();
 const open=async()=>{const r=await createFixedStepScenarioRun({project:locked.runtimeProjection.project,scenarioId:'MJ-FD01',scenarioRevision:1,seed:7,mode:'simulation',access:'simulated',backendSetId:'engineering-mujoco-3d-v1',sourceCommit:'lifecycle-test',engineering:locked},{directory,catalog,enabledBackends:['mujoco_3d'],bundleFile:(d,p)=>service.bundleFile(d,p),plant,runtime});runs.push(r);return r;};
 return {open,directory};
}
let ordinal=0;
async function act(run:ScenarioRun,kind:string,payload={}){const v=await run.snapshot();return run.action({actionId:`act-${++ordinal}`,expectedRevision:v.run.runRevision,kind,payload});}

test.each(['missing','clock','contacts','pose'])('mobile runner rejects %s physics before confirming a pending cancellation',async mode=>{
 let fault=false;
 const {open}=await setup(plant=>{const spawn=plant.spawn;plant.spawn=async o=>{const w=await spawn(o);return {...w,async request(req){const r=await w.request(req);if(fault&&req.op==='step'&&r.ok){const s=r.result as unknown as {robots:{bodyVelocity:number[];pose3d:{roll:number}}[];physics?:{tick:number;contacts?:unknown}};s.robots[0]!.bodyVelocity=[0,0];if(mode==='missing')delete s.physics;else if(mode==='clock')s.physics!.tick++;else if(mode==='contacts')delete s.physics!.contacts;else s.robots[0]!.pose3d.roll+=.1;}return r;}};};});
 const run=await open();await run.start();let moving=await run.snapshot();while(!moving.entities[0]!.goal&&moving.tick<1000)moving=await act(run,'step',{ticks:20});const commandId=moving.entities[0]!.goal!.commandId;
 await act(run,'cancel');fault=true;const stopped=await act(run,'step',{ticks:1}),report=await run.report();
 expect(stopped.tick).toBe(moving.tick);expect(report.physicsEvidence?.manifest.gaps).toContainEqual(expect.objectContaining({firstTick:moving.tick+1,lastTick:moving.tick+1}));expect(report.navigation2d?.clock.tickHorizon).toBe(stopped.tick);
 expect(stopped.attention.map(x=>x.reason)).toContain('PHYSICS_OBSERVATION_INVALID');
 expect(report.businessEvents.filter(e=>e.type==='RobotCommandObserved'&&e.id===commandId).map(e=>e.state.status)).not.toContain('cancelled');
 expect(stopped.entities[0]!.goal?.state).toBe('unknown');
 expect(report.rejectedObservations).toEqual(expect.arrayContaining([expect.objectContaining({commandId,type:'unknown',code:'CANCELLATION_RECONCILIATION_REQUIRED'})]));
 expect(report.telemetry.samples.filter(s=>s.simTimeNs===String((stopped.tick+1)*20_000_000)).every(s=>s.quality!=='valid')).toBe(true);
},30_000);


test.each(['create','start'])('lost %s ACK is terminal before a second start and after reopen',async op=>{
 let spawns=0;
 const {open}=await setup(plant=>{const spawn=plant.spawn;plant.spawn=async o=>{spawns++;const w=await spawn(o);return {...w,async request(req){const r=await w.request(req);if(req.op===op)throw new WorkerLostError('WORKER_TIMEOUT','unknown','applied but ACK lost');return r;}};};});
 const run=await open();await expect(run.start()).rejects.toThrow('PLANT_START_FAILED:WORKER_TIMEOUT');
 expect((await run.snapshot()).run.status).toBe('needs_attention');
 await expect(act(run,'start')).rejects.toThrow('STARTUP_UNKNOWN');expect(spawns).toBe(1);
 await run.close();const reopened=await open();expect((await reopened.snapshot()).run.status).toBe('needs_attention');
 await expect(act(reopened,'start')).rejects.toThrow('STARTUP_UNKNOWN');expect(spawns).toBe(1);
},30_000);

test('a process restart with create in flight refuses a new world under the same run ID',async()=>{
 let spawns=0,checkpoint='';
 const {open,directory}=await setup(plant=>{const spawn=plant.spawn;plant.spawn=async o=>{spawns++;const w=await spawn(o);return {...w,async request(req){if(req.op==='create')checkpoint=await readFile(join(o.runDirectory,'..','run.json'),'utf8');const r=await w.request(req);if(req.op==='create')throw new WorkerLostError('WORKER_TIMEOUT','unknown','ACK lost');return r;}};};});
 const run=await open();await expect(run.start()).rejects.toThrow('PLANT_START_FAILED');await run.close();
 // Restore the actual durable state captured before the create request, as a source crash would leave it.
 await writeFile(join(directory,'run.json'),checkpoint);
 const reopened=await open();await expect(act(reopened,'start')).rejects.toThrow('STARTUP_UNKNOWN');expect(spawns).toBe(1);expect((await reopened.snapshot()).run.status).toBe('needs_attention');
},30_000);

test.each(['PLANT_UNSTABLE','CONTACT_CAPACITY_EXCEEDED'])('an explicit %s create failure after priming is terminal, not a not-sent admission refusal',async code=>{
 let spawns=0;
 const {open}=await setup(plant=>{const spawn=plant.spawn;plant.spawn=async o=>{spawns++;const w=await spawn(o);return {...w,async request(req){const r=await w.request(req);return req.op==='create'?{...r,ok:false,error:{code,message:'priming failed'}} as never:r;}};};});
 const run=await open();await expect(run.start()).rejects.toThrow(code);await expect(act(run,'start')).rejects.toThrow('STARTUP_UNKNOWN');expect(spawns).toBe(1);
},30_000);

test('a real pre-mutation create schema refusal clears the latch and permits start after reopen',async()=>{
 let spawns=0,refuse=true;
 const {open,directory}=await setup(plant=>{const spawn=plant.spawn;plant.spawn=async o=>{spawns++;const w=await spawn(o);return {...w,async request(req){if(req.op==='create'&&refuse){refuse=false;const path=join(o.bundleRoot,'navigation-scene.json'),bytes=await readFile(path);try{await writeFile(path,'{}');return await w.request(req);}finally{await writeFile(path,bytes);}}return w.request(req);}};};});
 const run=await open();await expect(run.start()).rejects.toThrow('PLANT_START_FAILED:SCENE_SCHEMA_INVALID');
 expect(JSON.parse(await readFile(join(directory,'run.json'),'utf8')).plant.startupAttempt).toBeUndefined();await run.close();
 const reopened=await open();await act(reopened,'start');expect(spawns).toBe(2);
 expect(JSON.parse(await readFile(join(directory,'run.json'),'utf8')).started).toBe(true);
},30_000);

test('an uncertain startup keeps engine capacity until the lost worker closes',async()=>{
 const {activeRunCount}=await import('../../packages/lab-runtime/src/v2/navigation2d/runner');
 let entered!:()=>void,release!:()=>void;const reached=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);
 const {open}=await setup(plant=>{const spawn=plant.spawn;plant.spawn=async o=>{const w=await spawn(o);return {...w,async request(req){const r=await w.request(req);if(req.op==='create')throw new WorkerLostError('WORKER_TIMEOUT','unknown','ACK lost');return r;},async close(reason){entered();await wait;await w.close(reason);}};};});
 const run=await open(),starting=run.start().catch(e=>e);await reached;
 try{expect(activeRunCount('mujoco_arm')).toBe(1);}finally{release();await starting;}
 expect(activeRunCount('mujoco_arm')).toBe(0);await expect(act(run,'start')).rejects.toThrow('STARTUP_UNKNOWN');
},30_000);

test('durable append failure after advancement retains logical tick and terminal unknown across reopen',async()=>{
 let steps=0,spawns=0;const {open,directory}=await setup(plant=>{const spawn=plant.spawn;plant.spawn=async o=>{spawns++;const w=await spawn(o);return {...w,async request(req){if(req.op==='step')steps++;return w.request(req);}};};});
 const run=await open();await run.start();await act(run,'step',{ticks:20});const before=await run.snapshot();
 const {mkdir}=await import('node:fs/promises');await rm(join(directory,'physics','pending.ndjson'));await mkdir(join(directory,'physics','pending.ndjson'));
 const after=await act(run,'step',{ticks:10}),report=await run.report();expect(after.tick).toBe(before.tick);expect(steps).toBe(21);expect(after.run.status).toBe('needs_attention');expect(report.physicsEvidence?.complete).toBe(false);expect(report.physicsEvidence?.manifest.gaps).toContainEqual(expect.objectContaining({firstTick:21,lastTick:21}));
 await expect(act(run,'step',{ticks:1})).rejects.toThrow('PLANT_LOST');await run.close();const restored=await open();await expect(act(restored,'start')).rejects.toThrow('INVALID_STATE');expect(spawns).toBe(1);
},30_000);

test('initial physics append failure preserves startup latch and refuses respawn',async()=>{
 let spawns=0;const {open}=await setup(plant=>{const spawn=plant.spawn;plant.spawn=async o=>{spawns++;const w=await spawn(o);return {...w,async request(req){const r=await w.request(req);if(req.op==='create'&&r.ok)delete (r.result as {physics?:unknown}).physics;return r;}};};});
 const run=await open();await expect(run.start()).rejects.toThrow('PHYSICS_OBSERVATION_INVALID');await expect(act(run,'start')).rejects.toThrow('STARTUP_UNKNOWN');await run.close();const reopened=await open();await expect(act(reopened,'start')).rejects.toThrow('STARTUP_UNKNOWN');expect(spawns).toBe(1);
},30_000);

test('a report flush failure terminates the plant before another engine step',async()=>{
 let steps=0;const {open,directory}=await setup(plant=>{const spawn=plant.spawn;plant.spawn=async o=>{const w=await spawn(o);return {...w,async request(req){if(req.op==='step')steps++;return w.request(req);}};};});
 const run=await open();await run.start();await act(run,'step',{ticks:2});
 const {mkdir}=await import('node:fs/promises');await mkdir(join(directory,'physics','.write.intent.tmp'));
 const report=await run.report();expect(report.outcome.status).toBe('needs_attention');expect(report.physicsEvidence?.complete).toBe(false);await expect(act(run,'step',{ticks:1})).rejects.toThrow('PLANT_LOST');expect(steps).toBe(2);
},30_000);

test('restart after an in-flight step joins the explicit unknown horizon into physics coverage',async()=>{
 const {open,directory}=await setup(()=>{}),run=await open();await run.start();await act(run,'step',{ticks:100});await run.report();
 const checkpoint=JSON.parse(await readFile(join(directory,'run.json'),'utf8'));checkpoint.inFlight=true;
 const physics=await readFile(join(directory,'physics','manifest.json')),navigation=await readFile(join(directory,'evidence','manifest.json'));
 await act(run,'step',{ticks:1});await run.close();
 await writeFile(join(directory,'run.json'),JSON.stringify(checkpoint));await writeFile(join(directory,'physics','manifest.json'),physics);await writeFile(join(directory,'evidence','manifest.json'),navigation);
 const restored=await open(),report=await restored.report();expect(report.outcome.tick).toBe(100);expect(report.physicsEvidence?.complete).toBe(false);expect(report.physicsEvidence?.manifest.gaps).toContainEqual(expect.objectContaining({firstTick:101,lastTick:101,reason:'STEP_ACK_LOST'}));
},30_000);

test('impossible physics initialization quota after create retains startup unknown without exceeding the budget',async()=>{
 let spawns=0,created=0;const {open,directory}=await setup(plant=>{const spawn=plant.spawn;plant.spawn=async o=>{spawns++;const w=await spawn(o);return {...w,async request(req){const r=await w.request(req);if(req.op==='create'&&r.ok)created++;return r;}};};},{maxBytes:1});
 const run=await open();await expect(run.start()).rejects.toThrow('PHYSICS_QUOTA_EXCEEDED');expect(created).toBe(1);expect((await run.snapshot()).tick).toBe(0);expect((await run.snapshot()).run.status).toBe('needs_attention');
 const {readdir}=await import('node:fs/promises');expect(await readdir(join(directory,'physics'))).toEqual([]);
 await expect(act(run,'start')).rejects.toThrow('STARTUP_UNKNOWN');await run.close();const restored=await open();await expect(act(restored,'start')).rejects.toThrow('STARTUP_UNKNOWN');expect(spawns).toBe(1);
},30_000);
