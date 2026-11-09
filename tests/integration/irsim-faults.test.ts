// C02 fault suite on the real IR-SIM plant (IR02, IR03, IR05, IR06, IR09, IR10): every failure mode is judged by an oracle with expected/actual,
// from the run's inputs, its durable trace and its journal, never from what the controller says about itself. A failed leg or a cancel passes when the
// business outcome is the right one. Skipped, with the reason, where the pinned IR-SIM venv is not provisioned.
import {afterAll,afterEach,beforeAll,expect,test} from 'vitest';
import {execFileSync} from 'node:child_process';
import {readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createNavigationCompiler} from '../../packages/lab-runtime/src/engineering/navigation-compiler';
import {lockDigestOf} from '../../packages/lab-runtime/src/engineering/linkforge';
import {spawnIRSimWorker} from '../../packages/lab-runtime/src/v2/navigation2d/worker-client';
import {navigationMetrics,openNavigationRecorder,readNavigationEvidence} from '../../packages/lab-runtime/src/v2/navigation2d/evidence';
import {actorPoseAt,fixtureFile,resolveScenarioFixture,scenarioAssertions,type ScenarioAssertion} from '../../packages/lab-runtime/src/v2/navigation2d/scenario-fixtures';
import type {IRSimSnapshotV1,NavigationSceneV1} from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import type {RunReport} from '../../packages/lab-runtime/src/v2/report';
import type {ScenarioRun} from '../../packages/lab-runtime/src/v2/scenario-runner';
import {createIRSimScenarioRun} from '../../packages/lab-runtime/src/v2/navigation2d/runner';
import {act,double,finish,irPython,irsimAvailable,irsimBundle,irsimProviders,removeBundles,schemaDir,stepUntil,temp,tickOf,workerLog,workerRoot} from '../support/irsim-mission';
import {navigationFixture} from '../support/navigation2d';

let serve:Awaited<ReturnType<typeof irsimBundle>>,enclosed:Awaited<ReturnType<typeof irsimBundle>>;
const runs:ScenarioRun[]=[],dirs:string[]=[];
beforeAll(async()=>{if(irsimAvailable){serve=await irsimBundle('serve');enclosed=await irsimBundle('enclosed-table');}},240_000);
afterAll(removeBundles);
afterEach(async()=>{for(const r of runs.splice(0))await r.close().catch(()=>{});for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
async function open(b:typeof serve,scenarioId:string,seed=5,over:Parameters<typeof irsimProviders>[2]={}){
 const dir=await temp('irsim-faults-');dirs.push(dir);
 const run=await createIRSimScenarioRun({project:b.locked.runtimeProjection.project,scenarioId,scenarioRevision:1,seed,mode:'simulation',access:'simulated',backendSetId:'engineering-irsim-2d-v1',sourceCommit:'test-commit',engineering:b.locked},await irsimProviders(dir,b.service,over));
 runs.push(run);return {run,dir};
}
async function judged(dir:string,run:ScenarioRun,scenarioId:string,seed=5,expectOutcome?:Parameters<typeof scenarioAssertions>[0]['expectOutcome']){
 const report=await run.report() as RunReport,scene=JSON.parse(await readFile(join(dir,'bundle','navigation-scene.json'),'utf8')) as NavigationSceneV1;
 const read=await readNavigationEvidence(join(dir,'evidence'),{chunks:report.navigation2d!.artifacts,...report.navigation2d!.recording},{scene});
 const fixture=resolveScenarioFixture(scenarioId,scene,seed);
 return {report,scene,read,fixture,oracles:scenarioAssertions({report,read,scene,fixture,...expectOutcome?{expectOutcome}:{}})};
}
const verdict=(o:ScenarioAssertion[])=>Object.fromEntries(o.map(a=>[a.id,a.result]));
const failing=(o:ScenarioAssertion[])=>o.filter(a=>a.result!=='pass').map(a=>`${a.id}=${a.result}: expected ${a.expected}; actual ${a.actual}`);
const workers=()=>{try{return execFileSync('pgrep',['-P',String(process.pid)],{encoding:'utf8'}).trim().split('\n').filter(Boolean).filter(p=>{try{return execFileSync('ps',['-o','command=','-p',p],{encoding:'utf8'}).includes('irsim_worker');}catch{return false;}}).map(Number);}catch{return [];}};

test.skipIf(!irsimAvailable)('IR02 IR-FD03: the scheduled person is applied every tick, seen by the LiDAR, never touched; the robot waits, resumes and serves after the handoff',async()=>{
 const {run,dir}=await open(serve,'IR-FD03',5,{entry:[double('logged.py')]});
 await run.start();await finish(run);
 const {report,read,fixture,oracles}=await judged(dir,run,'IR-FD03');
 expect(failing(oracles)).toEqual([]);
 expect(verdict(oracles)).toMatchObject({BUSINESS_OUTCOME:'pass',ACTOR_SCHEDULE_APPLIED:'pass',ACTOR_OBSERVED:'pass',NO_ACTOR_CONTACT:'pass',ACTOR_YIELD:'pass',NO_PHYSICAL_CONTACT:'pass',EVIDENCE_COMPLETE:'pass'});
 expect(report.outcome).toMatchObject({status:'completed',served:'1'});
 // what the worker received is the immutable schedule (bitwise) at every step: the source owns the actor, the plant only places it
 const steps=workerLog(dir).filter(l=>l.op==='step'),person=fixture.actors[0]!;
 expect(person).toMatchObject({id:'person-1',radiusM:0.25,startTick:100,speedMps:0.5});
 expect(steps.length).toBe(report.outcome.tick);
 for(const s of steps){const p=s.payload as {targetTick:number;actorUpdates:{actorId:string;poseMap:number[]}[]};expect(p.actorUpdates).toEqual([{actorId:'person-1',poseMap:actorPoseAt(person,p.targetTick)}]);}
 expect(actorPoseAt(person,100)).toEqual([0.45,3.2,0]);expect(actorPoseAt(person,101)[0]).toBeCloseTo(0.46,12);
 // the worker read the fixture file the runner wrote beside the scene (bound by its sha256 at spawn, --fixture-sha256; the wire create stays {sceneRef, seed}),
 // and the engine never reported a contact with the person
 const create=workerLog(dir).find(l=>l.op==='create')!;
 expect(Object.keys(create.payload).sort()).toEqual(['sceneRef','seed']);
 expect(JSON.parse(await readFile(join(dir,'bundle','scenario-fixture.json'),'utf8'))).toEqual(JSON.parse(JSON.stringify(fixtureFile(fixture))));
 expect(read.trajectory.some(t=>t.robots.some(r=>r.collisionIds.length))).toBe(false);
 // the oracle is not vacuous: the same run judged against a person standing on the robot's path at every tick fails
 const moved={...fixture,actors:[{...person,startTick:0,path:[[2,3.2]] as [number,number][]}]};
 expect(verdict(scenarioAssertions({report,read,scene:JSON.parse(await readFile(join(dir,'bundle','navigation-scene.json'),'utf8')),fixture:moved}))).toMatchObject({NO_ACTOR_CONTACT:'fail',ACTOR_SCHEDULE_APPLIED:'fail'});
},600_000);

test.skipIf(!irsimAvailable)('IR03: a walled-in handoff is no_path at once (IR-FD04) and a person standing on the handoff is blocked after the no-progress window (IR-FD04-blocked); both serve nothing, and they are never confused',async()=>{
 // stepped 25 ticks at a time: the leg fails with fewer than 100 ticks buffered, so the evidence is complete only because a run needing attention is flushed whole
 const a=await open(enclosed,'IR-FD04');await a.run.start();await finish(a.run,25);
 const na=await judged(a.dir,a.run,'IR-FD04');
 expect(failing(na.oracles)).toEqual([]);
 expect(na.report.outcome).toMatchObject({status:'needs_attention',served:'0'});
 expect(na.report.attention.map(x=>x.reason)).toEqual(['NO_PATH']);
 // no false arrival: the only arrival is the kitchen pass; the walled-in table is never reached
 expect(na.report.businessEvents.filter(e=>e.type==='MissionArrived').map(e=>(e.state.stops as {id:string;targetId:string}[]).find(s=>s.id===e.state.currentStopId)!.targetId)).toEqual(['pass']);
 expect(na.report.businessEvents.some(e=>e.type==='DeliveryHandedOff')).toBe(false);
 const b=await open(serve,'IR-FD04-blocked');await b.run.start();await finish(b.run,25);
 const nb=await judged(b.dir,b.run,'IR-FD04-blocked');
 expect(failing(nb.oracles)).toEqual([]);
 expect(nb.report.outcome).toMatchObject({status:'needs_attention',served:'0'});
 const blocked=nb.report.attention[0]!,loaded=tickOf(nb.report.businessEvents.find(e=>e.type==='CargoLoaded')!.at),noPath=na.report.attention[0]!,loadedA=tickOf(na.report.businessEvents.find(e=>e.type==='CargoLoaded')!.at);
 expect(['DYNAMIC_OBSTACLE','NO_PROGRESS']).toContain(blocked.reason);
 // timestamps tell them apart: no_path within a few ticks of the leg, blocked only after the 250-tick no-progress window and before the 6000-tick deadline
 expect(noPath.tick-loadedA).toBeLessThanOrEqual(10);
 expect(blocked.tick-loaded).toBeGreaterThanOrEqual(250);expect(blocked.tick-loaded).toBeLessThan(6000);
 // each oracle bites on the other's run: the blocked run is not a no_path and the no_path run is not blocked
 expect(verdict(scenarioAssertions({...nb,report:{...nb.report,manifest:{...nb.report.manifest,scenario:{...nb.report.manifest.scenario,id:'IR-FD04'}}}}))).toMatchObject({NO_PATH_NOT_BLOCKED:'fail',BUSINESS_OUTCOME:'fail'});
 expect(verdict(scenarioAssertions({...na,report:{...na.report,manifest:{...na.report.manifest,scenario:{...na.report.manifest.scenario,id:'IR-FD04-blocked'}}},fixture:resolveScenarioFixture('IR-FD04-blocked',nb.scene,5)}))).toMatchObject({BLOCKED_NOT_NO_PATH:'fail'});
},600_000);

test.skipIf(!irsimAvailable)('IR05: a cancel mid-route passes its business oracle: cancelled, nothing served or handed off, one terminal event per mission, a bounded simulated stop; a duplicate cancel is refused',async()=>{
 const {run,dir}=await open(serve,'IR-FD01');
 await run.start();
 // mid-route on the kitchen leg: dispatched and moving, before any load (a cancel with cargo aboard becomes a return the staff must confirm: B04 rulings)
 await stepUntil(run,async()=>{const r=await run.report();return r.businessEvents.some(e=>e.type==='MissionCreated')&&r.entities[0]!.moving&&Math.abs(r.entities[0]!.pose.y-1.5)>0.5;},25);
 const cancelAt=(await run.snapshot()).tick;
 await act(run,'cancel');
 await expect(act(run,'cancel')).rejects.toThrow(/INVALID_STATE/);
 await finish(run,25,cancelAt+2000);
 const {report,read,oracles}=await judged(dir,run,'IR-FD01',5,{status:'cancelled',served:'0'});
 expect(failing(oracles)).toEqual([]);
 expect(verdict(oracles)).toMatchObject({BUSINESS_OUTCOME:'pass',NO_SERVED_BEFORE_HANDOFF:'pass',EVIDENCE_COMPLETE:'pass',NO_PHYSICAL_CONTACT:'pass'});
 expect(report.businessEvents.some(e=>e.type==='DeliveryHandedOff'||e.type==='CargoLoaded')).toBe(false);
 const cancelled=report.businessEvents.filter(e=>e.type==='MissionCancelled');
 expect(cancelled.length).toBeGreaterThan(0);expect(new Set(cancelled.map(e=>e.id)).size).toBe(cancelled.length);
 // bounded stop from the trace: |v| <= stoppedLinear within v/a + 10 ticks of the cancel (0.5 m/s at 0.5 m/s2 = 50 ticks)
 const stopped=read.trajectory.find(t=>t.tick>cancelAt&&Math.abs(t.robots[0]!.bodyVelocity[0])<=0.01&&Math.abs(t.robots[0]!.bodyVelocity[1])<=0.02)!;
 expect(stopped.tick-cancelAt).toBeLessThanOrEqual(60);
 // the same run held to the completed expectation fails: the oracle bites
 expect(verdict(scenarioAssertions({report,read,scene:JSON.parse(await readFile(join(dir,'bundle','navigation-scene.json'),'utf8')),fixture:resolveScenarioFixture('IR-FD01',JSON.parse(await readFile(join(dir,'bundle','navigation-scene.json'),'utf8')),5)})).BUSINESS_OUTCOME).toBe('fail');
},600_000);

test.skipIf(!irsimAvailable)('IR06 two robots driven into each other with the controller bypassed (test only): the engine names the other robot, and the pair is one episode per source',async()=>{
 const input=structuredClone(navigationFixture('fleet').input);
 // face to face in the open aisle: robot01 at (8, 6) heading east, robot02 at (10, 6) heading west
 for(const [prefix,x,q] of [['r1-',8,[0,0,0,1]],['r2-',10,[0,0,1,0]]] as const){const c=input.resolved.placements.find(p=>p.instanceId===`${prefix}chassis`)!;c.world={xyzM:[x,6,c.world.xyzM[2]!],quaternionXyzw:[...q]};}
 const root=await temp('irsim-ir06-'),bundleRoot=await temp('irsim-ir06-bundle-');dirs.push(root,bundleRoot);
 await createNavigationCompiler({python:irPython,workerRoot,descriptionHelperRoot:resolve('robotics/simulation')}).compileResolved(input,bundleRoot);
 const scene=JSON.parse(await readFile(join(bundleRoot,'navigation-scene.json'),'utf8')) as NavigationSceneV1;
 const w=await spawnIRSimWorker({python:irPython,workerRoot,runId:'run-ir06-pair',bundleRoot,runDirectory:join(root,'worker'),lockDigest:await lockDigestOf(join(workerRoot,'requirements.lock')),schemaDir,sceneDigest:scene.sceneDigest});
 const rec=await openNavigationRecorder({directory:join(root,'evidence'),scene,runId:'run-ir06-pair'});
 const seen:string[][]=[];
 try{
  let n=0,tick=0;
  const ask=async(op:string,payload:Record<string,unknown>)=>{const r=await w.request({protocol:'mekoniq-irsim/1',requestId:`q${++n}`,runId:'run-ir06-pair',expectedTick:tick,op,payload} as never);if(!r.ok)throw new Error(op);tick=r.tick;return r.result as IRSimSnapshotV1;};
  await rec.append(await ask('create',{sceneRef:'navigation-scene.json',seed:5}),null);await ask('start',{});
  // velocities listed robot02 first: the worker maps them by robotId
  for(let k=1;k<=200;k++){const payload={targetTick:k,velocities:[{robotId:'robot02',vMps:0.3,omegaRadps:0},{robotId:'robot01',vMps:0.3,omegaRadps:0}],actorUpdates:[]};const s=await ask('step',payload);seen.push(...s.robots.map(r=>r.collisionIds));await rec.append(s,payload);}
  await rec.flush();
 }finally{await w.close('test over');}
 const read=await readNavigationEvidence(join(root,'evidence'),rec.committed(),{scene}),m=navigationMetrics(scene,read);
 expect(m.coverage).toBe('complete');
 // the engine names the other robot by its robotId (never engine:<n>), from both sides
 expect(seen.flat().every(id=>id==='robot01'||id==='robot02')).toBe(true);
 const touching=read.trajectory.find(t=>t.robots.some(r=>r.collisionIds.length))!;
 expect(Object.fromEntries(touching.robots.map(r=>[r.robotId,r.collisionIds]))).toEqual({robot01:['robot02'],robot02:['robot01']});
 // one unordered pair, one engine episode (the two robots' reports of the same contact are not two episodes), and the independent oracle agrees
 expect(m.episodes.filter(e=>e.source==='engine_discrete').map(e=>e.pair.join('|'))).toEqual(['robot01|robot02']);
 expect(m.episodes.some(e=>e.source==='swept_oracle'&&e.pair.join('|')==='robot01|robot02')).toBe(true);
 expect(m.minSeparationM).toBe(0);
 // collision_mode stop: both robots stop at the contact and stay stopped while pushed (no motion through each other)
 const last=read.trajectory.at(-1)!.robots;expect(last.every(r=>Math.abs(r.bodyVelocity[0])<1e-9)).toBe(true);
 expect(last.find(r=>r.robotId==='robot02')!.poseDriveMap[0]-last.find(r=>r.robotId==='robot01')!.poseDriveMap[0]).toBeGreaterThan(0.5);
},240_000);

test.skipIf(!irsimAvailable)('IR09 pacing: the same run stepped 25 or 500 ticks per request ends at the same tick with identical normalized digests; pause and reads do not advance the clock',async()=>{
 const a=await open(serve,'IR-FD01',9),b=await open(serve,'IR-FD01',9);
 await a.run.start();await b.run.start();
 await act(b.run,'pause');const paused=(await b.run.snapshot()).tick;await b.run.report();await b.run.snapshot();
 expect((await b.run.snapshot()).tick).toBe(paused);await expect(act(b.run,'step',{ticks:5})).rejects.toThrow(/RUN_PAUSED/);await act(b.run,'resume');
 const va=await finish(a.run,25),vb=await finish(b.run,500);
 expect([va.run.status,vb.run.status]).toEqual(['completed','completed']);
 expect(va.tick).toBe(vb.tick);
 const [ra,rb]=[await a.run.report(),await b.run.report()];
 expect(ra.navigation2d!.digests).toEqual(rb.navigation2d!.digests);
 expect(ra.navigation2d!.clock.tickHorizon).toBe(va.tick);
},600_000);

test.skipIf(!irsimAvailable)('IR10 worker killed between steps on the table leg: the leg is unknown, nothing is resent or respawned, cargo and reservations stay, the evidence records the unknown tick',async()=>{
 const before=workers();
 const {run,dir}=await open(serve,'IR-FD01');
 await run.start();
 await stepUntil(run,async()=>{const r=await run.report();return r.businessEvents.some(e=>e.type==='CargoLoaded')&&r.entities[0]!.moving;},25);
 const live=workers().filter(p=>!before.includes(p));expect(live).toHaveLength(1);
 process.kill(live[0]!,'SIGKILL');
 const v=await act(run,'step',{ticks:25});
 expect(v.run.status).toBe('needs_attention');
 await expect(act(run,'step',{ticks:5})).rejects.toThrow(/PLANT_LOST/);
 expect(workers().filter(p=>!before.includes(p))).toEqual([]);           // no second process, ever
 const {report,oracles}=await judged(dir,run,'IR-FD01');
 expect(report.attention.map(a=>a.reason)).toEqual(expect.arrayContaining(['WORKER_LOST','EXECUTION_UNKNOWN']));
 expect(report.navigation2d!.recordingGaps.map(g=>g.reason)).toContain('STEP_ACK_LOST');
 expect(report.navigation2d!.completeness!.status).toBe('incomplete');
 // the business state is kept: cargo loaded, nothing served, the venue movement reservation still held
 expect(report.outcome.served).toBe('0');expect(report.businessEvents.some(e=>e.type==='CargoLoaded')).toBe(true);
 expect(report.businessEvents.filter(e=>e.kind==='reservation'&&e.state.zoneId==='__venue_movement__').at(-1)!.state.status).not.toBe('released');
 // no oracle turns the lost tick into a pass: evidence-bound assertions are fail/inconclusive, and the business outcome is not the expected one
 expect(verdict(oracles)).toMatchObject({EVIDENCE_COMPLETE:'fail',NO_PHYSICAL_CONTACT:'inconclusive',BUSINESS_OUTCOME:'fail'});
},600_000);
