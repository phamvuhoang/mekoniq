import {afterEach,expect,test} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createMujocoCompiler} from '../../packages/lab-runtime/src/engineering/mujoco-compiler';
import {createEngineeringService} from '../../packages/lab-runtime/src/engineering/gateway';
import {lockDigestOf} from '../../packages/lab-runtime/src/engineering/linkforge';
import {validateNavigationDocument} from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import {mujocoMobilePlant} from '../../packages/lab-runtime/src/v2/simulation3d/mujoco-mobile';
import {navigationFixture} from '../support/navigation2d';
import {testCompiler,writeFixtureCatalog} from '../support/engineering';

const dirs:string[]=[],root=resolve('robotics/simulation-mujoco'),python=resolve('.venv-mujoco/bin/python'),schemaDir=resolve('packages/contracts/schemas');
const temp=async()=>{const d=await mkdtemp(join(tmpdir(),'mj-mobile-'));dirs.push(d);return d;};
afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
async function bundle(compiler=true,name:'serve-3d'|'fleet-3d'|'wide'='serve-3d'){
 const f=navigationFixture(name).fixture;f.project={...f.project,requestedProfile:'engineering-mujoco-3d-v1'};
 const catalogRoot=await temp();await writeFixtureCatalog(catalogRoot,f);
 const service=createEngineeringService({directory:await temp(),catalogRoot,compiler:testCompiler,...compiler?{compilers:{'engineering-mujoco-3d-v1':createMujocoCompiler({workerRoot:root})}}:{}});
 const receipt=await service.compileEngineeringProject(f.project,'owner');return {service,receipt,f};
}
test('MuJoCo is an explicit portable profile with no native fallback',async()=>{
 const {receipt}=await bundle(false);expect(receipt.state).toBe('blocked');expect(receipt.problems.map(p=>p.code)).toContain('PROFILE_COMPILER_UNAVAILABLE');
});
test('compiler admits the center load and complete hashed closure on a new MuJoCo input, without changing canonical bytes',async()=>{
 const canonical=await readFile(join(root,'fixtures/serve-payload-v1/serve-3d-project.json'));
 const {service,receipt}=await bundle();expect(receipt.state,JSON.stringify(receipt.problems)).toBe('compiled');
 const locked=await service.admitRun('owner',{bundleDigest:receipt.bundleDigest,projectDigest:receipt.projectDigest},'engineering-mujoco-3d-v1',undefined);
 expect(locked.project.requestedProfile).toBe('engineering-mujoco-3d-v1');
 const scene=JSON.parse(Buffer.from(await service.bundleFile(receipt.bundleDigest!,'navigation-scene.json')).toString());
 expect(validateNavigationDocument(scene).ok).toBe(true);expect(scene.engine).toMatchObject({id:'mujoco_3d',version:'3.17.0',timestepMs:2,substeps:10,loadProfileRef:{id:'cup-center'}});
 expect(scene.inputs.project.digest).toBe(receipt.projectDigest);
 for(const f of scene.files){const b=await service.bundleFile(receipt.bundleDigest!,f.path);expect(sha(b)).toBe(f.sha256);expect(b.length).toBe(f.bytes);}
 const load=JSON.parse(Buffer.from(await service.bundleFile(receipt.bundleDigest!,scene.engine.loadProfileRef.path)).toString());
 expect(sha(await service.bundleFile(receipt.bundleDigest!,load.modelRef.path))).toBe(load.modelRef.sha256);
 expect(await readFile(join(root,'fixtures/serve-payload-v1/serve-3d-project.json'))).toEqual(canonical);
 expect(JSON.parse(canonical.toString()).requestedProfile).toBe('engineering-webots-3d-v1');
});
test('real plant compiles admitted bundle, clocks finite physics, replays ACK and rejects invalid ticks before mutation',async()=>{
 const {service,receipt}=await bundle();expect(receipt.state,JSON.stringify(receipt.problems)).toBe('compiled');
 const scene=JSON.parse(Buffer.from(await service.bundleFile(receipt.bundleDigest!,'navigation-scene.json')).toString()),bundleRoot=await temp();
 const {mkdir,writeFile}=await import('node:fs/promises');
 for(const path of ['navigation-scene.json',...scene.files.map((f:{path:string})=>f.path)]){const p=join(bundleRoot,path);await mkdir(join(p,'..'),{recursive:true});await writeFile(p,await service.bundleFile(receipt.bundleDigest!,path));}
 const runtime={python,workerRoot:root,schemaDir,lockDigest:await lockDigestOf(join(root,'requirements.lock')),engineVersion:'3.17.0'},plant=mujocoMobilePlant(runtime);
 const w=await plant.spawn({...runtime,runId:'mobile-real',bundleRoot,runDirectory:await temp(),sceneDigest:scene.sceneDigest});
 let n=0;const ask=(op:string,payload:object,tick=0,id?:string)=>w.request({protocol:plant.protocol,requestId:id??`r-${++n}`,runId:'mobile-real',expectedTick:tick,op,payload} as never);
 try{
  expect((await ask('describe',{})).ok).toBe(true);
  const c=await ask('create',{sceneRef:'navigation-scene.json',seed:7});expect(c.ok).toBe(true);
  expect(c).toMatchObject({result:{tick:0,simTimeNs:'0',physics:{tick:0}}});await ask('start',{});
  const bad=await ask('step',{targetTick:2,velocities:[{robotId:'amr-1',vMps:0.1,omegaRadps:0}],actorUpdates:[]});expect(bad.ok).toBe(false);expect(w.state).toBe('ready');
  const payload={targetTick:1,velocities:[{robotId:'amr-1',vMps:0.1,omegaRadps:0.1}],actorUpdates:[]};
  const s=await ask('step',payload,0,'step-once');expect(s.ok).toBe(true);expect(s).toMatchObject({result:{tick:1,simTimeNs:'20000000',physics:{tick:1}}});expect(await ask('step',payload,0,'step-once')).toEqual(s);
  const finite=(v:unknown):boolean=>typeof v==='number'?Number.isFinite(v):v!==null&&typeof v==='object'?Object.values(v).every(finite):true;expect(finite(s)).toBe(true);
 }finally{await w.close('test complete');}
},30_000);

test('runtime option registers MuJoCo compiler and the real dispatcher reports mobile engine, seed and stop-policy identity',async()=>{
 const {engineeringFromOptions}=await import('../../packages/lab-runtime/src/engineering/runtime-options');
 const {mujocoFromOptions}=await import('../../packages/lab-runtime/src/v2/simulation3d/mujoco');
 const {portableSimulationFromOptions}=await import('../../packages/lab-runtime/src/v2/navigation2d/readiness');
 const {validateNavigationEvidence}=await import('../../packages/lab-runtime/src/v2/navigation2d/contracts');
 const f=navigationFixture('serve-3d').fixture;f.project={...f.project,requestedProfile:'engineering-mujoco-3d-v1'};const catalogRoot=await temp();await writeFixtureCatalog(catalogRoot,f);
 const service=(await engineeringFromOptions({directory:await temp(),catalogRoot,simulationRoot:resolve('robotics/simulation'),python:resolve('.venv-irsim/bin/python'),mujoco:{workerRoot:root}}))!;
 const receipt=await service.compileEngineeringProject(f.project,'owner');expect(receipt.state,JSON.stringify(receipt.problems)).toBe('compiled');
 const locked=await service.admitRun('owner',{bundleDigest:receipt.bundleDigest,projectDigest:receipt.projectDigest},'engineering-mujoco-3d-v1',undefined);
 const directory=await temp(),bundleFile=(d:string,p:string)=>service.bundleFile(d,p),mujoco=await mujocoFromOptions({enabled:true,python,workerRoot:root,lockPath:join(root,'requirements.lock'),directory,bundleFile});

 const sim=await portableSimulationFromOptions({enabled:false,python,workerRoot:root,lockPath:join(root,'requirements.lock'),directory,mujoco});
 const input={project:locked.runtimeProjection.project,scenarioId:'MJ-FD01',scenarioRevision:1,seed:7,mode:'simulation',access:'simulated',backendSetId:'engineering-mujoco-3d-v1',sourceCommit:'test-commit',engineering:locked} as const;
 const runDir=await temp();const run=await sim.simulationFactory(input,{directory:runDir,catalog:sim.catalog,enabledBackends:sim.enabledBackends,bundleFile});
 try{
  await run.start();const view=await run.snapshot();await run.action({actionId:'steps',expectedRevision:view.run.runRevision,kind:'step',payload:{ticks:1000}});
  const report=await run.report();expect(report.outcome.tick,JSON.stringify((await run.snapshot()).attention)).toBe(1000);expect(report.outcome.status).not.toBe('needs_attention');expect(report.telemetry.samples.length).toBeGreaterThan(0);expect(report.telemetry.samples.every(s=>s.origin==='physics_sim')).toBe(true);
  expect(report.navigation2d?.engine).toMatchObject({id:'mujoco_3d',engineVersion:'3.17.0',timestepMs:2,substeps:10,stopPolicyRef:{id:'serve-mobile-stop-v1'}});
  expect(report.navigation2d?.seed.engineSeedAlgorithm).toBe('mujoco-identity-seed-v1');expect(report.navigation2d?.seed.engineRng).toBeUndefined();
  expect(validateNavigationEvidence(report.navigation2d),JSON.stringify(validateNavigationEvidence(report.navigation2d))).toMatchObject({ok:true});
  const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(join(runDir,'journal.db'),{readOnly:true});try{const raw=JSON.stringify(db.prepare('SELECT entry_json FROM journal').all());expect(raw).toContain('mujoco_serve_diff_drive');expect(raw).not.toContain('irsim_2d_diff_drive');}finally{db.close();}
  let v=await run.snapshot();v=await run.action({actionId:'pause',expectedRevision:v.run.runRevision,kind:'pause',payload:{}});expect(v.tick).toBe(1000);v=await run.action({actionId:'resume',expectedRevision:v.run.runRevision,kind:'resume',payload:{}});expect(v.tick).toBe(1000);let n=0;while(['running','awaiting_confirmation'].includes(v.run.status)&&v.tick<30000){v=await run.action({actionId:`finish-${++n}`,expectedRevision:v.run.runRevision,kind:'step',payload:{ticks:500}});}
  expect(v.run.status,JSON.stringify(v.attention)).toBe('completed');const done=await run.report();expect(done.outcome.served).toBe('1');console.log('MJ-FD01',JSON.stringify({tick:done.outcome.tick,scene:done.navigation2d?.sceneDigest,engine:done.navigation2d?.engine,controller:done.navigation2d?.controller,digests:done.navigation2d?.digests}));
 }finally{await run.close();}
},180_000);

test('mobile recorder accepts only the exact last publication and stores true publication ticks',async()=>{
 const {openNavigationRecorder,readNavigationEvidence}=await import('../../packages/lab-runtime/src/v2/navigation2d/evidence');
 const scene=JSON.parse(await readFile(join(root,'fixtures/serve-payload-v1/navigation-scene.json'),'utf8'));
 const model=scene.robots[0].model.sensors[0],k=model.publishEveryTicks;
 const sample=(tick:number,scanTick=tick-tick%k)=>({schemaVersion:1,runId:'r',bootId:'b',seq:String(tick),sceneDigest:scene.sceneDigest,tick,simTimeNs:String(tick*20_000_000),robots:[{robotId:'amr-1',poseDriveMap:[2,1.5,0],bodyVelocity:[0,0],collisionIds:[],scans:[{sensorId:model.id,frameId:model.parentLinkId,tick:scanTick,simTimeNs:String(scanTick*20_000_000),angleMinRad:-Math.PI,angleIncrementRad:2*Math.PI/360,rangeMinM:0.05,rangeMaxM:10,rangesM:Array(360).fill(null),states:Array(360).fill('no_return')}]}]}) as never;
 const control=(tick:number)=>({targetTick:tick,velocities:[{robotId:'amr-1',vMps:0,omegaRadps:0}],actorUpdates:[]});
 const directory=await temp(),r=await openNavigationRecorder({directory,scene,runId:'r'});
 try{await r.append(sample(0),null);for(let t=1;t<=5;t++)await r.append(sample(t),control(t));await r.flush();const read=await readNavigationEvidence(directory,{...r.committed()},{scene});expect(read.sensors.map(s=>s.tick)).toEqual([0,5]);expect(read.sensors.map(s=>s.scan.tick)).toEqual([0,5]);}finally{await r.close();}
 for(const [tick,scanTick] of [[1,1],[5,0],[5,10]]){const bad=await openNavigationRecorder({directory:await temp(),scene,runId:'r'});try{await bad.append(sample(0),null);await expect(bad.append(sample(tick!,scanTick),control(tick!))).rejects.toThrow('EVIDENCE_SENSOR_FOREIGN');}finally{await bad.close();}}
});

test('mobile keeps the shared engine slot until worker close completes',async()=>{
 const {service,receipt}=await bundle(),locked=await service.admitRun('owner',{bundleDigest:receipt.bundleDigest,projectDigest:receipt.projectDigest},'engineering-mujoco-3d-v1',undefined);
 const {defaultCatalog}=await import('../../packages/lab-runtime/src/v2/capabilities');const {createFixedStepScenarioRun,activeRunCount}=await import('../../packages/lab-runtime/src/v2/navigation2d/runner');
 const runtime={python,workerRoot:root,schemaDir,lockDigest:await lockDigestOf(join(root,'requirements.lock')),engineVersion:'3.17.0',maxActiveRuns:1},plant=mujocoMobilePlant(runtime),spawn=plant.spawn;
 let entered!:()=>void,release!:()=>void;const reached=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);
 plant.spawn=async o=>{const w=await spawn(o);return {...w,close:async reason=>{entered();await wait;await w.close(reason);}};};
 const catalog={...defaultCatalog,backends:defaultCatalog.backends.map(b=>b.id==='mujoco_3d'?{...b,installed:true,compatible:true,reachable:true}:b)};
 const run=await createFixedStepScenarioRun({project:locked.runtimeProjection.project,scenarioId:'MJ-FD01',scenarioRevision:1,seed:7,mode:'simulation',access:'simulated',backendSetId:'engineering-mujoco-3d-v1',sourceCommit:'test',engineering:locked},{directory:await temp(),catalog,enabledBackends:['mujoco_3d'],bundleFile:(d,p)=>service.bundleFile(d,p),plant,runtime});
 await run.start();const closing=run.close();await reached;
 try{expect(activeRunCount('mujoco_arm')).toBe(1);}finally{release();await closing;}
 expect(activeRunCount('mujoco_arm')).toBe(0);
},30_000);

test('compiler refuses multiple AMRs and unregistered mechanical models',async()=>{
 for(const [name,code] of [['fleet-3d','MUJOCO_MOBILE_SCOPE_UNSUPPORTED'],['wide','MUJOCO_MODEL_UNSUPPORTED']] as const){const {receipt}=await bundle(true,name);expect(receipt.state).toBe('blocked');expect(receipt.problems.map(p=>p.detail).join()).toContain(code);}
});

test('mobile recorder refuses absent, foreign-frame or mistimed cached publications',async()=>{
 const {openNavigationRecorder}=await import('../../packages/lab-runtime/src/v2/navigation2d/evidence');const scene=JSON.parse(await readFile(join(root,'fixtures/serve-payload-v1/navigation-scene.json'),'utf8')),sensor=scene.robots[0].model.sensors[0];
 for(const mode of ['absent','frame','clock']){const r=await openNavigationRecorder({directory:await temp(),scene,runId:'r'});const scan={sensorId:sensor.id,frameId:mode==='frame'?'foreign':sensor.parentLinkId,tick:0,simTimeNs:mode==='clock'?'20000000':'0',rangesM:[],states:[]};
  const s={runId:'r',sceneDigest:scene.sceneDigest,tick:1,simTimeNs:'20000000',robots:[{robotId:'amr-1',poseDriveMap:[2,1.5,0],bodyVelocity:[0,0],collisionIds:[],scans:mode==='absent'?[]:[scan]}]};
  try{await expect(r.append(s as never,{targetTick:1,velocities:[],actorUpdates:[]})).rejects.toThrow('EVIDENCE_SENSOR_FOREIGN');}finally{await r.close();}
 }
});
