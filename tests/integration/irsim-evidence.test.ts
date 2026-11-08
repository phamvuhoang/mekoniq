// B05 on the real IR-SIM plant: the durable evidence of IR-FD01 runs, its limits, restarts and repeatability. Every check reads the stored chunks back from disk.
// Skipped, with the reason, where the pinned IR-SIM venv is not provisioned.
import {afterAll,afterEach,beforeAll,expect,test} from 'vitest';
import {chmod,cp,readFile,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createNavigationCompiler} from '../../packages/lab-runtime/src/engineering/navigation-compiler';
import {lockDigestOf} from '../../packages/lab-runtime/src/engineering/linkforge';
import {spawnIRSimWorker} from '../../packages/lab-runtime/src/v2/navigation2d/worker-client';
import {validateNavigationEvidence,type IRSimSnapshotV1,type NavigationRunEvidenceV1,type NavigationSceneV1} from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import {compareEvidence,engineSeedOf,navigationMetrics,openNavigationRecorder,readNavigationEvidence,EVIDENCE_LIMITS} from '../../packages/lab-runtime/src/v2/navigation2d/evidence';
import {outcomeDigest,type RunReport} from '../../packages/lab-runtime/src/v2/report';
import type {ScenarioRun} from '../../packages/lab-runtime/src/v2/scenario-runner';
import {act,double,irPython,irsimAvailable,irsimBundle,openRun,removeBundles,schemaDir,stepUntil,temp,workerLog,workerRoot} from '../support/irsim-mission';
import {navigationFixture} from '../support/navigation2d';

let bundle:Awaited<ReturnType<typeof irsimBundle>>;
const runs:ScenarioRun[]=[],dirs:string[]=[];
beforeAll(async()=>{if(irsimAvailable)bundle=await irsimBundle();},120_000);
afterAll(removeBundles);
afterEach(async()=>{for(const r of runs.splice(0))await r.close().catch(()=>{});for(const d of dirs.splice(0)){await chmod(join(d,'evidence'),0o700).catch(()=>{});await rm(d,{recursive:true,force:true});}});
async function open(o:{b?:typeof bundle;dir?:string;seed?:number;over?:Parameters<typeof openRun>[2]}={}){const dir=o.dir??await temp('irsim-evidence-');if(!o.dir)dirs.push(dir);const run=await openRun(dir,o.b??bundle,o.over??{},o.seed??5);runs.push(run);return {run,dir};}
const evidenceOf=(r:RunReport)=>r.navigation2d!;
/** The exported evidence read back as an import would: the document's artifacts and recording block, against the run's own locked scene. */
const readBack=async(dir:string,e:NavigationRunEvidenceV1)=>readNavigationEvidence(join(dir,'evidence'),{chunks:e.artifacts,...e.recording},{scene:JSON.parse(await readFile(join(dir,'bundle','navigation-scene.json'),'utf8')) as NavigationSceneV1});
const assertion=(e:NavigationRunEvidenceV1,id:string)=>e.assertions.find(a=>a.id===id)!;
async function complete(o:Parameters<typeof open>[0]={}){const x=await open(o);await x.run.start();await stepUntil(x.run,v=>v.run.status==='completed');return {...x,report:await x.run.report()};}

test.skipIf(!irsimAvailable)('EVI01 IR-FD01: the finished run is recorded tick by tick on disk; controls are the ones sent, LiDAR at 10 Hz, and every plant metric comes from the stored evidence',async()=>{
 const {run,dir,report:r}=await complete({over:{entry:[double('logged.py')]}}),e=evidenceOf(r),scene=JSON.parse(await readFile(join(dir,'bundle','navigation-scene.json'),'utf8')) as NavigationSceneV1;
 expect(validateNavigationEvidence(e)).toMatchObject({ok:true});
 expect(e.completeness).toEqual({status:'complete',reasons:[]});
 expect(e.clock).toEqual({tickMs:20,tickHorizon:r.outcome.tick,businessEpochMs:Date.parse('2026-11-01T00:00:00Z')});
 for(const id of ['EVIDENCE_INTEGRITY','EVIDENCE_COVERAGE','EVIDENCE_LIMITS','NO_PHYSICAL_CONTACT','SENSOR_PUBLICATIONS'])expect(assertion(e,id).result,id).toBe('pass');
 expect([assertion(e,'REPEATABILITY_SAME_PLATFORM').result,assertion(e,'REPEATABILITY_CROSS_PLATFORM').result]).toEqual(['not_run','not_run']);
 const read=await readBack(dir,e),log=workerLog(dir),steps=log.filter(l=>l.op==='step');
 expect(read.complete).toBe(true);
 expect(read.trajectory.map(t=>t.tick)).toEqual([...Array(r.outcome.tick+1).keys()]);
 // the control ledger is what the worker received, request for request; it is not rebuilt from the observed motion
 expect(read.control.map(c=>[c.targetTick,c.velocities])).toEqual(steps.map(s=>[(s.payload as {targetTick:number}).targetTick,(s.payload as {velocities:unknown}).velocities]));
 expect(read.trajectory.slice(1).map(t=>t.robots[0]!.poseDriveMap)).toEqual(steps.map(s=>s.robots[0]!.poseDriveMap));
 expect(read.sensors.map(s=>s.tick)).toEqual([...Array(Math.floor(r.outcome.tick/5)+1).keys()].map(k=>k*5));
 expect(read.sensors[0]!.scan.rangesM).toHaveLength(360);
 // IR-SIM gets the derived irsim-env-seed-v1 seed; the actor stream keeps the run seed
 const {engineSeed}=engineSeedOf(5,scene);
 expect(log.find(l=>l.op==='create')!.payload.seed).toBe(engineSeed);
 expect(e.seed).toMatchObject({runSeed:5,engineSeed,engineSeedAlgorithm:'irsim-env-seed-v1',actorRng:{seed:5},engineRng:{library:'numpy',version:'2.4.6',seed:engineSeed},sensorSeeds:[{robotId:'amr-1',noiseSeed:7}]});
 expect(e.engine).toMatchObject({id:'irsim_2d',version:'2.12.0',pythonVersion:expect.stringMatching(/^3\.11\./),lockDigest:await lockDigestOf(join(workerRoot,'requirements.lock'))});
 expect(e.identity).toMatchObject({sourceCommit:'test-commit',compilerVersion:scene.compilerVersion,sceneSchemaHash:scene.schemaHash,evidenceFormat:'navigation-evidence-ndjson-gzip-v1'});
 expect(e.controller).toEqual({id:'grid-diff-v1',version:'1'});
 // metrics: from the stored trace through the oracle, at the robot base; nothing over-claimed
 const m=navigationMetrics(scene,read);
 expect(r.metrics.collision).toEqual({available:true,contacts:0,minSeparationM:null});
 expect(r.metrics.distanceM).toEqual(m.distanceM);
 expect(r.metrics.distanceM['amr-1']).toBeGreaterThan(2*Math.hypot(4-1.9,3.9-6)); // three observed legs, longer than the straight lines
 expect(r.metrics.navigation).toMatchObject({coverage:'complete',horizon:r.outcome.tick,collisionEpisodes:0,minSeparationM:null,sensorPublications:{complete:true}});
 expect(r.metrics.navigation!.minClearanceM).toBeGreaterThan(0);
 expect(r.coverage).toMatchObject({sensorEvidence:true,physicalStop:false,nativeExecution:false,dynamics:false});
 // EVI01: the live telemetry ring is lossy and coalesced (10 Hz samples); the evidence holds every tick regardless
 expect(r.telemetry.samples.length).toBeLessThan(read.trajectory.length/4);
 expect(r.telemetry.samples.every(s=>s.origin==='controller_sim')).toBe(true);
 // durable before oracle: the report reads the disk, so a chunk lost afterwards makes the metrics unavailable at once
 await rm(join(dir,'evidence',e.artifacts.trajectory[1]!.path));
 const after=await run.report(),ae=evidenceOf(after);
 expect(after.metrics.collision).toMatchObject({available:false,contacts:null,minSeparationM:null});
 expect(after.metrics.collision.reason).toMatch(/EVIDENCE_CHUNK_MISSING/);
 expect(after.metrics.distanceM).toEqual({});
 expect(after.coverage.sensorEvidence).toBe(false);
 expect([assertion(ae,'EVIDENCE_INTEGRITY').result,assertion(ae,'NO_PHYSICAL_CONTACT').result]).toEqual(['fail','inconclusive']);
 expect(ae.completeness!.status).toBe('incomplete');
 expect(ae.digests.trajectoryDigest).not.toBe(e.digests.trajectoryDigest);
 // the business outcome is the journal's, untouched by an evidence problem
 expect(after.outcome).toEqual(r.outcome);
},240_000);

test.skipIf(!irsimAvailable)('IR08 repeatability: three fresh runs with the same seed and lock give identical normalized digests, trajectories, controls and business events',async()=>{
 const a=await complete(),b=await complete(),c=await complete();
 const [ea,eb,ec]=[a,b,c].map(x=>evidenceOf(x.report));
 expect(new Set([ea!.runId,eb!.runId,ec!.runId]).size).toBe(3);
 expect(ea!.artifacts.trajectory.map(x=>x.path)).not.toEqual(eb!.artifacts.trajectory.map(x=>x.path)); // random chunk names: left out of the normalized identity
 expect(eb!.digests).toEqual(ea!.digests);expect(ec!.digests).toEqual(ea!.digests);
 const [ra,rb,rc]=await Promise.all([[a,ea],[b,eb],[c,ec]].map(([x,e])=>readBack((x as typeof a).dir,e as NavigationRunEvidenceV1)));
 expect(compareEvidence(ra!,rb!)).toEqual({match:true,mismatches:[]});
 expect(compareEvidence(ra!,rc!)).toEqual({match:true,mismatches:[]});
 // discrete business events, effects, metrics and outcome compare equal through the existing canonical outcome (run id and runtime UUIDs normalized)
 expect(outcomeDigest(b.report)).toBe(outcomeDigest(a.report));expect(outcomeDigest(c.report)).toBe(outcomeDigest(a.report));
},240_000);

test.skipIf(!irsimAvailable)('IR08 noise: gaussian LiDAR noise repeats under the same seed; another seed changes the noisy scans; another model changes the trajectory identity',async()=>{
 const noisy=await irsimBundle('noisy'),wide=await irsimBundle('wide');
 const part=async(b:typeof bundle,seed:number)=>{const x=await open({b,seed});await x.run.start();await act(x.run,'step',{ticks:200});const e=evidenceOf(await x.run.report());await x.run.close();runs.splice(runs.indexOf(x.run),1);return {e,read:await readBack(x.dir,e)};}; // two live workers per host
 const n5=await part(noisy,5),again=await part(noisy,5),n6=await part(noisy,6),w=await part(wide,5),s=await part(bundle,5);
 expect(n5.e.clock.tickHorizon).toBe(200);
 expect(again.e.digests).toEqual(n5.e.digests);
 expect(compareEvidence(n5.read,again.read).match).toBe(true);
 expect(n6.e.seed.engineSeed).not.toBe(n5.e.seed.engineSeed);
 expect(n6.e.digests.sensorDigest).not.toBe(n5.e.digests.sensorDigest);
 expect(compareEvidence(n5.read,n6.read).mismatches.some(x=>x.startsWith('ranges at'))).toBe(true); // the noisy stream itself differs, not only the recorded seed
 // the noise-free scene: the same seed and seed-independent ranges, but a different scene/model is never the same identity
 expect(s.read.sensors[0]!.scan.rangesM).not.toEqual(n5.read.sensors[0]!.scan.rangesM);
 expect(w.e.digests.trajectoryDigest).not.toBe(s.e.digests.trajectoryDigest);
 expect(w.e.modelDigests).not.toEqual(s.e.modelDigests);
},240_000);

test.skipIf(!irsimAvailable)('EVI02 limits on a live run: an evidence quota or tick limit ends the plant with EVIDENCE_INCOMPLETE; nothing is stepped beyond it and no metric is claimed',async()=>{
 const q=await open({over:{evidence:{maxBytes:150_000}}});
 await q.run.start();
 let v=await q.run.snapshot();
 for(let i=0;i<60&&v.run.status!=='needs_attention';i++)v=await act(q.run,'step',{ticks:100});
 expect(v.run.status).toBe('needs_attention');
 expect(v.attention).toContainEqual(expect.objectContaining({reason:'EVIDENCE_INCOMPLETE',subjectId:'EVIDENCE:EVIDENCE_QUOTA_EXCEEDED'}));
 await expect(act(q.run,'step',{ticks:1})).rejects.toThrow('INVALID_STATE:PLANT_LOST');
 const r=await q.run.report(),e=evidenceOf(r);
 expect(e.completeness!.status).toBe('incomplete');expect(e.completeness!.reasons[0]).toBe('EVIDENCE_QUOTA_EXCEEDED');
 expect(assertion(e,'EVIDENCE_LIMITS').result).toBe('fail');
 expect(e.recordingGaps.at(-1)).toMatchObject({reason:'EVIDENCE_QUOTA_EXCEEDED',toTick:r.outcome.tick});
 expect(r.metrics.collision.available).toBe(false);expect(r.coverage.sensorEvidence).toBe(false);
 expect(e.artifacts.trajectory.reduce((n,x)=>n+x.bytes,0)+e.artifacts.sensors.reduce((n,x)=>n+x.bytes,0)+e.artifacts.control.reduce((n,x)=>n+x.bytes,0)).toBeLessThanOrEqual(150_000);
 const t=await open({over:{evidence:{maxTicks:60}}});
 await t.run.start();
 const tv=await act(t.run,'step',{ticks:100});
 expect(tv.tick).toBe(60); // the 61st step was never sent
 expect(tv.attention).toContainEqual(expect.objectContaining({reason:'EVIDENCE_INCOMPLETE',subjectId:'EVIDENCE:EVIDENCE_TICK_LIMIT'}));
 const te=evidenceOf(await t.run.report());
 expect(te.clock.tickHorizon).toBe(60);
 expect((await readBack(t.dir,te)).trajectory).toHaveLength(61); // nothing that was stepped is dropped
 // landing exactly on the budget without finishing is terminal too: the run is not left 'running' with no step it may take
 await t.run.close();runs.splice(runs.indexOf(t.run),1);
 const exact=await open({over:{evidence:{maxTicks:60}}});
 await exact.run.start();
 const ev=await act(exact.run,'step',{ticks:60});
 expect([ev.tick,ev.run.status]).toEqual([60,'needs_attention']);
 expect(ev.attention).toContainEqual(expect.objectContaining({reason:'EVIDENCE_INCOMPLETE',subjectId:'EVIDENCE:EVIDENCE_TICK_LIMIT'}));
 expect(EVIDENCE_LIMITS).toEqual({maxBytes:100*1024*1024,maxTicks:30000});
},240_000);

test.skipIf(!irsimAvailable)('EVI02 write failure: an evidence store that refuses writes ends the plant; the run never carries on unrecorded',async()=>{
 const {run,dir}=await open();
 await run.start();
 await chmod(join(dir,'evidence'),0o500);
 const v=await act(run,'step',{ticks:150});
 await chmod(join(dir,'evidence'),0o700);
 expect(v.run.status).toBe('needs_attention');
 expect(v.attention.find(a=>a.reason==='EVIDENCE_INCOMPLETE')!.subjectId).toMatch(/^EVIDENCE:EVIDENCE_WRITE_FAILED/);
 await expect(act(run,'step',{ticks:1})).rejects.toThrow('INVALID_STATE:PLANT_LOST');
 const e=evidenceOf(await run.report());
 expect(e.completeness!.status).toBe('incomplete');expect(assertion(e,'NO_PHYSICAL_CONTACT').result).toBe('inconclusive');
},240_000);

test.skipIf(!irsimAvailable)('EVI restart: a crash image reopens with its committed chunks only, the unflushed ticks as a RUNTIME_RESTART gap, and no duplicate on a second reopen',async()=>{
 const {run,dir}=await open();
 await run.start();
 await act(run,'step',{ticks:130}); // >= 100 ticks: durable at the end of the action
 await act(run,'step',{ticks:30}); // buffered only
 const image=await temp('irsim-crash-');dirs.push(image);
 await cp(dir,image,{recursive:true}); // the disk as a crash would leave it: run.json at tick 160, evidence durable to 130
 const reopened=await open({dir:image}),r=await reopened.run.report(),e=evidenceOf(r);
 expect(r.outcome.tick).toBe(160);
 expect(e.clock.tickHorizon).toBe(130);
 expect(e.recordingGaps).toEqual([{fromTick:131,toTick:160,reason:'RUNTIME_RESTART'}]);
 expect(e.completeness!.status).toBe('incomplete');expect(r.metrics.collision.available).toBe(false);
 const listed=e.artifacts;
 await reopened.run.close();runs.splice(runs.indexOf(reopened.run),1);
 const second=await open({dir:image}),e2=evidenceOf(await second.run.report());
 expect(e2.artifacts).toEqual(listed);expect(e2.recordingGaps).toEqual(e.recordingGaps);
 // the original, closed gracefully, flushes its tail: complete to 160
 await run.close();runs.splice(runs.indexOf(run),1);
 const graceful=await open({dir}),ge=evidenceOf(await graceful.run.report());
 expect(ge.clock.tickHorizon).toBe(160);expect(ge.recordingGaps).toEqual([]);
},240_000);

test.skipIf(!irsimAvailable)('IR06 from evidence: a raw drive into table-05 on the real plant, recorded and read back, shows the engine contact and the independent oracle contact as separate episodes',async()=>{
 const input=structuredClone(navigationFixture('serve').input),c=input.resolved.placements.find(x=>x.instanceId==='chassis')!;
 c.world={xyzM:[10,2.0,0.09],quaternionXyzw:[0,0,Math.SQRT1_2,Math.SQRT1_2]};
 const root=await temp('irsim-ev-ir06-'),bundleRoot=await temp('irsim-ev-ir06-bundle-');dirs.push(root,bundleRoot);
 await createNavigationCompiler({python:irPython,workerRoot,descriptionHelperRoot:resolve('robotics/simulation')}).compileResolved(input,bundleRoot);
 const scene=JSON.parse(await readFile(join(bundleRoot,'navigation-scene.json'),'utf8')) as NavigationSceneV1;
 const w=await spawnIRSimWorker({python:irPython,workerRoot,runId:'run-ir06',bundleRoot,runDirectory:join(root,'worker'),lockDigest:await lockDigestOf(join(workerRoot,'requirements.lock')),schemaDir,sceneDigest:scene.sceneDigest});
 const rec=await openNavigationRecorder({directory:join(root,'evidence'),scene,runId:'run-ir06'});
 try{
  let n=0,tick=0;
  const ask=async(op:string,payload:Record<string,unknown>)=>{const r=await w.request({protocol:'mekoniq-irsim/1',requestId:`q${++n}`,runId:'run-ir06',expectedTick:tick,op,payload} as never);if(!r.ok)throw new Error(op);tick=r.tick;return r.result as IRSimSnapshotV1;};
  await rec.append(await ask('create',{sceneRef:'navigation-scene.json',seed:5}),null);await ask('start',{});
  for(let k=1;k<=300;k++){const payload={targetTick:k,velocities:[{robotId:'amr-1',vMps:0.4,omegaRadps:0}],actorUpdates:[]};await rec.append(await ask('step',payload),payload);}
  await rec.flush();
 }finally{await w.close('test over');}
 const read=await readNavigationEvidence(join(root,'evidence'),rec.committed(),{scene}),m=navigationMetrics(scene,read);
 expect(m.coverage).toBe('complete');
 const engine=m.episodes.filter(x=>x.source==='engine_discrete'),oracle=m.episodes.filter(x=>x.source!=='engine_discrete');
 expect(engine.map(x=>x.pair.join('|'))).toEqual(['amr-1|table-05']);
 expect(oracle.some(x=>x.pair.join('|')==='amr-1|table-05')).toBe(true);
 expect(m.collisionEpisodes).toBeGreaterThanOrEqual(1);expect(m.minClearanceM).toBeLessThan(1e-9);
 expect(read.collisions.length).toBeGreaterThan(0);
 // the same stored run with its collision chunk gone: the contact is not reported as absent, the metric is unavailable
 const without=await readNavigationEvidence(join(root,'evidence'),{...rec.committed(),chunks:{...rec.committed().chunks,collisions:rec.committed().chunks.collisions.map(x=>({...x,sha256:'0'.repeat(64)}))}},{scene});
 expect(navigationMetrics(scene,without)).toMatchObject({coverage:'incomplete',collisionEpisodes:null});
},240_000);

// ---- review B05 ----
const verdicts=(e:NavigationRunEvidenceV1)=>Object.fromEntries(e.assertions.map(a=>[a.id,a.result]));
const nothingClaimed=(r:RunReport)=>{
 const e=evidenceOf(r);
 expect(r.metrics.collision).toMatchObject({available:false,contacts:null});expect(r.coverage.sensorEvidence).toBe(false);
 expect(e.completeness!.status).toBe('incomplete');
 expect(verdicts(e)).toMatchObject({EVIDENCE_COVERAGE:'inconclusive',NO_PHYSICAL_CONTACT:'inconclusive',SENSOR_PUBLICATIONS:'inconclusive'});
 expect(e.metricCoverage.filter(x=>x.status==='available')).toEqual([]);
};

test.skipIf(!irsimAvailable)('review B05 #1 live: a report taken while the latest ticks are still buffered claims nothing about them',async()=>{
 const {run}=await open();
 await run.start();
 for(let i=0;i<7;i++)await act(run,'step',{ticks:30}); // flushed at 120 (>= 100 buffered at the end of an action), 121..210 only in memory
 const r=await run.report(),e=evidenceOf(r);
 expect([r.outcome.tick,e.clock.tickHorizon]).toEqual([210,120]);
 expect(e.recordingGaps).toEqual([{fromTick:121,toTick:210,reason:'EVIDENCE_PENDING'}]);
 nothingClaimed(r);
},240_000);

test.skipIf(!irsimAvailable)('review B05 #1/#2 crash image: evidence ahead of a checkpoint taken mid-action is not complete, and the step in flight is a recorded unknown tick',async()=>{
 const {run,dir}=await open();
 await run.start();
 await act(run,'step',{ticks:130});
 const image=await temp('irsim-crash-');dirs.push(image);
 await cp(dir,image,{recursive:true}); // run.json at tick 130 ...
 await act(run,'step',{ticks:130}); // ... while the evidence went on to 260 before the crash
 await rm(join(image,'evidence'),{recursive:true});await cp(join(dir,'evidence'),join(image,'evidence'),{recursive:true});
 const checkpoint=JSON.parse(await readFile(join(image,'run.json'),'utf8')) as {inFlight:boolean};checkpoint.inFlight=true; // the crash came during that action
 await writeFile(join(image,'run.json'),JSON.stringify(checkpoint));
 const reopened=await open({dir:image}),r=await reopened.run.report(),e=evidenceOf(r);
 expect([r.outcome.tick,e.clock.tickHorizon]).toEqual([130,260]);
 expect(e.completeness!.reasons).toContain('EVIDENCE_AHEAD_OF_CHECKPOINT:131-260');
 expect(e.recordingGaps).toEqual([{fromTick:261,toTick:261,reason:'STEP_ACK_LOST'}]);
 nothingClaimed(r);
},240_000);

test.skipIf(!irsimAvailable)('review B05 #2: a step applied but never acknowledged is a recorded unknown tick; the ticks before it are flushed (M16)',async()=>{
 const {run,dir}=await open({over:{entry:[double('logged.py')]}});
 await run.start();
 const moving=await stepUntil(run,v=>v.entities[0]!.moving,10);
 await writeFile(join(dir,'worker','crash-next-step'),'');
 const v=await act(run,'step',{ticks:5});
 expect(v.tick).toBe(moving.tick);
 const r=await run.report(),e=evidenceOf(r);
 expect(e.clock.tickHorizon).toBe(v.tick); // everything acknowledged is durable once the plant is lost
 expect(e.recordingGaps).toEqual([{fromTick:v.tick+1,toTick:v.tick+1,reason:'STEP_ACK_LOST'}]);
 expect(e.recording).toMatchObject({lastTick:v.tick,gaps:[{fromTick:v.tick+1,toTick:v.tick+1,reason:'STEP_ACK_LOST'}]});
 nothingClaimed(r);
},240_000);

test.skipIf(!irsimAvailable)('review B05 #2: an append the store refuses stops the plant with EVIDENCE_INCOMPLETE and its own gap, never a silent TICK_GAP (M25)',async()=>{
 const {run,dir}=await open({over:{entry:[double('logged.py')]}});
 await run.start();
 await act(run,'step',{ticks:10});
 await writeFile(join(dir,'worker','foreign-scan-next-step'),'');
 const v=await act(run,'step',{ticks:10});
 expect(v.tick).toBe(11);
 expect(v.attention).toContainEqual(expect.objectContaining({reason:'EVIDENCE_INCOMPLETE',subjectId:expect.stringMatching(/^EVIDENCE:EVIDENCE_REJECTED:EVIDENCE_SENSOR_FOREIGN/)}));
 await expect(act(run,'step',{ticks:1})).rejects.toThrow('INVALID_STATE:PLANT_LOST');
 const e=evidenceOf(await run.report());
 expect(e.recordingGaps.map(g=>[g.fromTick,g.toTick,g.reason.split(':')[0]])).toEqual([[11,11,'EVIDENCE_REJECTED']]);
 expect(e.completeness!.status).toBe('incomplete');
},240_000);

// ---- review 4 ----
test.skipIf(!irsimAvailable)('review4 #2: a lost ACK whose gap the unwritable evidence directory refused survives a crash image and a graceful reopen',async()=>{
 const {run,dir}=await open({over:{entry:[double('logged.py')]}});
 await run.start();
 await act(run,'step',{ticks:130}); // durable to 130 at the end of the action
 await chmod(join(dir,'evidence'),0o500);
 await writeFile(join(dir,'worker','crash-next-step'),'');
 const v=await act(run,'step',{ticks:5});
 expect(v.tick).toBe(130);
 const lost={fromTick:131,toTick:131,reason:'STEP_ACK_LOST'};
 expect(evidenceOf(await run.report()).recordingGaps).toContainEqual(lost);
 // the process dies here: the manifest on disk never got the gap
 const image=await temp('irsim-crash-');dirs.push(image);
 await cp(dir,image,{recursive:true});await chmod(join(image,'evidence'),0o700);
 const crashed=await open({dir:image}),cr=await crashed.run.report();
 expect(evidenceOf(cr).recordingGaps).toContainEqual(lost);
 nothingClaimed(cr);
 await crashed.run.close();runs.splice(runs.indexOf(crashed.run),1);
 // the original: the directory is writable again and the run closes gracefully (its flush retries the manifest), then reopens
 await chmod(join(dir,'evidence'),0o700);
 await run.close();runs.splice(runs.indexOf(run),1);
 const again=await open({dir}),ar=await again.run.report();
 expect(evidenceOf(ar).recordingGaps).toContainEqual(lost);
 expect(evidenceOf(ar).recording).toMatchObject({gaps:expect.arrayContaining([lost])});
 nothingClaimed(ar);
},240_000);

test.skipIf(!irsimAvailable)('review4 #3: a report requested together with a step describes one moment: outcome tick, sim time and evidence horizon agree',async()=>{
 const {run}=await open();
 await run.start();
 await act(run,'step',{ticks:500}); // durable to 500: a report reads several chunks back from disk
 for(let i=0;i<4;i++){
  const v=await run.snapshot();
  const report=run.report(),step=run.action({actionId:`r4-3-step-${i}`,expectedRevision:v.run.runRevision,kind:'step',payload:{ticks:50}});
  const [r]=await Promise.all([report,step]),e=evidenceOf(r);
  expect(BigInt(r.outcome.simTimeNs),`round ${i}`).toBe(BigInt(r.outcome.tick)*20_000_000n);
  expect(r.metrics.navigation!.horizon).toBe(e.clock.tickHorizon);
  // the report was asked first: it is the state before the step (durable, or explicitly pending for the ticks still buffered)
  expect(r.outcome.tick,`round ${i}`).toBe(v.tick);
  if(e.completeness!.status==='complete')expect(e.clock.tickHorizon).toBe(r.outcome.tick);
  else{expect(e.recordingGaps.at(-1)).toMatchObject({reason:'EVIDENCE_PENDING',toTick:r.outcome.tick});nothingClaimed(r);}
 }
},240_000);
