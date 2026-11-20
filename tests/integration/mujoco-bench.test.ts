// V06c: single-axis bench runs on the real MuJoCo 3.17.0 engine (.venv-mujoco; these skip without it), and engine-free tests of the bench's durable trace (sample cap, read-back, gaps).
// The plant is never a double: the only doubles here are labelled protocol_double, a wrapped worker client that answers one step with PLANT_UNSTABLE (the engine cannot be driven there by a gain, V06b),
// or whose step answer names a collision (admission refuses the reverse wheel signal that drove the real AMR into boundary-west at tick 453, final-fix-report F1).
import {afterAll,afterEach,beforeAll,describe,expect,test} from 'vitest';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {mujocoFromOptions,MUJOCO_SLOT,type MujocoRuntimeOptions} from '../../packages/lab-runtime/src/v2/simulation3d/mujoco';
import {portableSimulationFromOptions} from '../../packages/lab-runtime/src/v2/navigation2d/readiness';
import {activeRunCount} from '../../packages/lab-runtime/src/v2/navigation2d/runner';
import {spawnMujocoWorker} from '../../packages/lab-runtime/src/v2/simulation3d/worker-client';
import {benchAnchorTick,SUGGEST_OPTIONS} from '../../packages/lab-runtime/src/v2/control/bench-signals';
import {suggestGains} from '../../packages/lab-runtime/src/v2/control/gain-suggest';
import {benchCatalog,benchMetrics,createBenchRun,openBenchTrace,readBenchTrace,BENCH_TRACE_LIMITS,type BenchCatalog,type BenchProviders,type BenchTraceIdentity} from '../../packages/lab-runtime/src/v2/control/bench-runner';
import {sealDriveDocument,validateControlEvidenceShape,type ControlProfileV1,type DriveTrace,type TuningEnvelopeV1,type TuningResultV1} from '../../packages/lab-runtime/src/v2/control/drive-io';
import type {RunManifestInput,ScenarioRun} from '../../packages/lab-runtime/src/v2/scenario-runner';
import {startLabGateway,type LabGateway} from '../../packages/lab-runtime/src/gateway';
import {mujocoProcessScope,mujocoPython,mujocoReady,mujocoRoot,mujocoTemp,removeMujocoDirs} from '../support/mujoco-arm';

const sha=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
const doc=<T,>(name:string)=>JSON.parse(readFileSync(join(mujocoRoot,'fixtures/drive-v1',name),'utf8')) as T;
const SET='engineering-mujoco-bench-v1',WHEELS=['amr-1/wheel-left','amr-1/wheel-right'],HOST=process.arch==='arm64'?'arm64':'x86_64';
type Bench=NonNullable<RunManifestInput['bench']>;
const wheel=(o:Partial<Bench>={}):Bench=>({schemaVersion:1,scenarioId:'MJ-BENCH-WHEEL',axis:'wheels',signal:{kind:'step',amplitude:2,atTick:10},driveExperimentId:'drive-nominal-v1',controlProfile:doc<ControlProfileV1>('serve-control-v1.json'),...o} as Bench);
const arm=(o:Partial<Bench>={}):Bench=>({schemaVersion:1,scenarioId:'MJ-BENCH-ARM',axis:'J3',signal:{kind:'step',amplitude:0.1,atTick:10},driveExperimentId:'drive-nominal-v1',controlProfile:doc<ControlProfileV1>('xarm6-control-v1.json'),...o} as Bench);
const input=(bench:Bench,seed=7):RunManifestInput=>({project:undefined,scenarioId:bench.scenarioId,scenarioRevision:1,seed,mode:'simulation',access:'simulated',backendSetId:SET,sourceCommit:'test-commit',bench});
type Report=Awaited<ReturnType<ScenarioRun['report']>>&{tuning:TuningResultV1|null;bench:{anchorTick:number|null;traceIssues:string[]}};
/** V07pre: the gains suggested from the inertia the result reports, computed here with suggestGains itself (the first traced axis' envelope: the left wheel's for a wheel bench). */
const expectedSuggestions=(t:TuningResultV1,mode:'csp'|'csv')=>{const env=doc<TuningEnvelopeV1>('tuning-envelope-v1.json').axes.find(a=>a.axisId===t.axisIds[0])!;
 return SUGGEST_OPTIONS.bandwidthRadS.flatMap(w=>SUGGEST_OPTIONS.damping.map(z=>({bandwidthRadS:w,damping:z,...suggestGains({mode,inertiaKgM2:t.effectiveInertia!.valueKgM2,bandwidthRadS:w,damping:z},env),accelerationLimit:null})));};
/** MEKONIQ_BENCH_LOG=1 prints the results the V06c report quotes; quiet otherwise. */
const show=(x:unknown)=>{if(process.env.MEKONIQ_BENCH_LOG==='1')console.log(JSON.stringify(x));};

describe('the durable bench trace (no engine)',()=>{
 const identity:BenchTraceIdentity={runId:'run-1',axisIds:['xarm-1/J3'],plantModelDigest:'a'.repeat(64),driveModelDigest:'b'.repeat(64),controlProfileDigest:'c'.repeat(64)};
 const tick=(t:number,y=(k:number)=>k*1e-3)=>[{axisId:'xarm-1/J3',dtS:0.002,samples:Array.from({length:10},(_,k)=>({target:1,actual:y(t*10+k),feedback:null,torqueNm:0.5,saturated:false}))}];
 afterAll(removeMujocoDirs);
 test('the reader rejects invalid engine ticks before allocating traces',async()=>{
  for(const tick of [501,-1,1.5,NaN,Infinity]){
   expect(await readBenchTrace('unused',identity,tick)).toMatchObject({traces:[],issues:['TRACE_RUN_TICK_INVALID']});
  }
 });
 test('declared gaps override verified chunks and semantic or malformed manifests fail closed',async()=>{
  const dir=join(await mujocoTemp('bench-manifest-'),'trace'),rec=await openBenchTrace(dir,identity,{chunkTicks:100});
  for(let t=0;t<=210;t++)await rec.append(t,tick(t));
  await rec.finish(null);
  const m=rec.manifest(),path=join(dir,'manifest.json');
  const gap={firstTick:200,lastTick:200,reason:'OBSERVATION_LOST'};
  await writeFile(path,JSON.stringify({...m,coverage:{...m.coverage,complete:false},gaps:[gap]}));
  const read=await readBenchTrace(dir,identity,210),samples=read.traces[0]!.samples;
  expect(read.issues).toEqual(['TRACE_GAP:200-200:OBSERVATION_LOST']);
  expect(samples.slice(2000,2010)).toEqual(Array(10).fill(null));expect(samples[1999]).toBeTruthy();expect(samples[2010]).toBeTruthy();
  for(const invalid of [
   {...m,gaps:[null]}, {...m,gaps:[gap]}, {...m,coverage:{firstTick:1,lastTick:210,complete:true}},
   {...m,coverage:{...m.coverage,lastTick:199}}, {...m,chunks:[m.chunks[0],{...m.chunks[1],firstTick:99},m.chunks[2]]},
   {...m,chunks:[m.chunks[0],m.chunks[2]]}, {...m,chunks:[{...m.chunks[0],lastTick:-1}]}, {...m,gaps:[{...gap,lastTick:199}]},
  ]){
   await writeFile(path,JSON.stringify(invalid));const bad=await readBenchTrace(dir,identity,210);
   expect(bad.issues).toEqual(['TRACE_MANIFEST_INVALID']);expect(bad.traces[0]!.samples.every(x=>x===null)).toBe(true);
  }
  await writeFile(path,JSON.stringify(m));expect((await readBenchTrace(dir,{...identity,runId:'other'},210)).issues).toEqual(['TRACE_IDENTITY_MISMATCH']);
 });
 test('tick 0 is the baseline and ticks 1-500 fill the 5,000-sample cap; a tick past it is refused and ends the recording (ruling 15)',async()=>{
  const dir=join(await mujocoTemp('bench-trace-'),'trace'),rec=await openBenchTrace(dir,identity);
  for(let t=0;t<=500;t++)await rec.append(t,tick(t));
  await expect(rec.append(501,tick(501))).rejects.toThrow('TRACE_SAMPLE_CAP');
  await expect(rec.append(502,tick(502))).rejects.toThrow('TRACE_RECORDER_TERMINAL');
  await rec.finish(null);
  const read=await readBenchTrace(dir,identity,500),samples=read.traces[0]!.samples;
  expect(samples).toHaveLength(5010);expect(samples.every(s=>s!==null)).toBe(true);
  expect(samples.slice(BENCH_TRACE_LIMITS.substeps).length).toBe(BENCH_TRACE_LIMITS.samplesPerAxis);
  expect(read.manifest).toMatchObject({coverage:{lastTick:500,complete:false},terminalReason:'TRACE_SAMPLE_CAP',gaps:[{firstTick:501,lastTick:501,reason:'TRACE_SAMPLE_CAP'}]});
  expect(read.issues).toContain('TRACE_TERMINAL:TRACE_SAMPLE_CAP');
  expect(read.manifestSha256).toBe(sha(await readFile(join(dir,'manifest.json'))));
 });
 test('a bad chunk is a gap of null samples (its whole tick range), so the metrics whose window holds it are TRACE_GAP; a tail that never became durable is missing too',async()=>{
  const dir=join(await mujocoTemp('bench-gap-'),'trace'),rec=await openBenchTrace(dir,identity,{chunkTicks:50});
  for(let t=0;t<=120;t++)await rec.append(t,tick(t,k=>k<300?0:0.1));   // a step of 0.1 at sample 300 (tick 30)
  await rec.finish(null);
  const clean=await readBenchTrace(dir,identity,120);
  expect(clean.issues).toEqual([]);expect(clean.manifest!.chunks.map(c=>[c.firstTick,c.lastTick])).toEqual([[0,49],[50,99],[100,120]]);
  const policy={finalWindowS:0.05,settleBand:0.02,holdWindowS:0.05};
  expect(benchMetrics(clean.traces[0]!,{kind:'step',amplitude:0.1,atTick:26},4,'csp',policy,'completed').riseTimeS.available).toBe(true);
  const second=clean.manifest!.chunks[1]!,bytes=await readFile(join(dir,second.path));bytes[bytes.length-1]^=0xff;await writeFile(join(dir,second.path),bytes);
  const read=await readBenchTrace(dir,identity,130),s=read.traces[0]!.samples;
  expect(read.issues).toEqual([`TRACE_CHUNK_INVALID:${second.path}:TRACE_HASH_MISMATCH`,'TRACE_TAIL_MISSING']);
  expect(s.slice(500,1000).every(x=>x===null)).toBe(true);expect(s.slice(0,500).every(x=>x!==null)&&s.slice(1000,1210).every(x=>x!==null)).toBe(true);expect(s.slice(1210).every(x=>x===null)).toBe(true);
  const m=benchMetrics(read.traces[0]!,{kind:'step',amplitude:0.1,atTick:26},4,'csp',policy,'completed');
  for(const k of ['riseTimeS','overshootPct','settlingTimeS','rmsError','peakTorqueNm','saturationRatio'])expect(m[k],k).toMatchObject({available:false,reason:'TRACE_GAP'});
  // a fault or an unstable plant: no metric at all, the part before included
  for(const [o,why] of [['drive_fault','DRIVE_FAULT'],['unstable','PLANT_UNSTABLE'],['collision','COLLISION']] as const)expect(Object.values(benchMetrics(clean.traces[0]!,{kind:'step',amplitude:0.1,atTick:26},4,'csp',policy,o)).every(x=>!x.available&&x.reason===why)).toBe(true);
 });
});

describe.skipIf(!mujocoReady)('bench runs on the real engine',()=>{
 let runtime:MujocoRuntimeOptions;
 const timings:{label:string;ms:number}[]=[];
 beforeAll(async()=>{
  const p=await mujocoProcessScope.observe(async()=>mujocoFromOptions({enabled:true,python:mujocoPython,workerRoot:mujocoRoot,lockPath:join(mujocoRoot,'requirements.lock'),directory:await mujocoTemp('mj-bench-probe-'),bundleFile:async()=>{throw Error('NO_BUNDLE');}}));
  if(!p.arm.runtime)throw Error(`MUJOCO_NOT_INSTALLED: ${p.arm.capability.reason}`);runtime=p.arm.runtime;
 },60_000);
 const open:ScenarioRun[]=[];
 afterEach(async()=>{for(const r of open.splice(0))await r.close();});
 afterAll(async()=>{await removeMujocoDirs();show(timings);});
 type Worker=Awaited<ReturnType<typeof spawnMujocoWorker>>;
 type Wrap=(req:{op:string;payload:unknown},next:()=>Promise<unknown>,w:Worker,bundleRoot:string)=>Promise<unknown>;
 /** A started bench, left OPEN (as the gateway keeps a run until its session ends; afterEach closes it). `wrap` sees every request (and the real worker and its bundle) and returns the response. */
 async function begin(b:Bench,wrap?:Wrap){
  const directory=join(await mujocoTemp('mj-bench-'),'run'),seen:{worker?:Worker}={};
  const spawn:BenchProviders['spawn']=async o=>{const w=await spawnMujocoWorker(o);seen.worker=w;return wrap?{get state(){return w.state;},get bootId(){return w.bootId;},get pid(){return w.pid;},get stderrTail(){return w.stderrTail;},request:req=>wrap(req,()=>w.request(req),w,o.bundleRoot) as never,close:r=>w.close(r)}:w;};
  const run=mujocoProcessScope.observeRun(await createBenchRun(input(b),{directory,enabledBackends:['mujoco_3d','mujoco_arm'],runtime,spawn}));open.push(run);
  const view=await run.start();expect(view.run.status).toBe('running');expect(activeRunCount(MUJOCO_SLOT)).toBe(1);
  return {run,view,directory,worker:()=>seen.worker!};
 }
 /** One bench to its result: stepped by 500 ticks (it stops itself) and reported. Whatever the result, the run itself has closed its worker and given the slot back by then: checked BEFORE close. */
 async function bench(b:Bench,wrap?:Wrap,label:string=b.scenarioId){
  const started=performance.now(),{run,view:v0,directory,worker}=await begin(b,wrap);
  const view=await run.action({actionId:'step-1',expectedRevision:v0.run.runRevision,kind:'step',payload:{ticks:500}});
  const report=await run.report() as Report;timings.push({label,ms:Math.round(performance.now()-started)});
  expect(activeRunCount(MUJOCO_SLOT),'the result freed the engine slot before close').toBe(0);expect(worker().state,'the result closed the worker before close').toBe('closed');
  return {report,view,directory,run};
 }
 test('a wheel step of 2 rad/s with the starting profile completes; the rise time exists; the draft reaches the worker byte for byte and every other axis holds where it rests',async()=>{
  const b=wheel(),seen:{create?:{bench:{controlProfileRef:{sha256:string}}};tick0?:{drives:{axisId:string;targetApplied:number}[]}}={};
  const {report,view,directory,run:resultRun}=await bench(b,async(req,next)=>{const r=await next() as {ok:boolean;result:never};if(req.op==='create'){seen.create=req.payload as never;seen.tick0=r.result;}return r;});
  expect(view.run.status).toBe('completed');
  const t=report.tuning!;expect(validateControlEvidenceShape(t),JSON.stringify(validateControlEvidenceShape.errors)).toBe(true);
  expect(t).toMatchObject({status:'completed',unstable:null,fault:null,axisIds:WHEELS,signal:b.signal,seed:7,engine:{id:'mujoco_3d',version:'3.17.0',hostArch:HOST},collision:null,accepted:false,
   plant:{plantModelDigest:b.controlProfile.plantModelDigest,driveModelDigest:doc<{digest:string}>('serve-drive-nominal-v1.json').digest,controlProfileDigest:b.controlProfile.digest,load:'empty'},
   effectiveInertia:{basis:'wheel_straight_line',provenance:'assumed'},policy:doc<{metricPolicy:object}>('control-oracle-v1.json').metricPolicy,trace:{samples:5000}});
  expect(t.effectiveInertia!.valueKgM2).toBeCloseTo(0.0874395,6);
  expect(t.suggestions).toEqual(expectedSuggestions(t,'csv'));expect(t.axisIds[0]).toBe('amr-1/wheel-left');
  expect(report.bench.anchorTick).toBe((await benchCatalog(mujocoRoot))['MJ-BENCH-WHEEL'].experiments['drive-nominal-v1']!.anchorTick);   // V07pre: the anchor health announces is the run's
  expect(t.metrics.riseTimeS).toMatchObject({available:true,unit:'s',basis:'actual'});
  expect(report.manifest.backends.map(x=>x.id)).toEqual(['mujoco_3d']);expect(report.bench.traceIssues).toEqual([]);
  // D2: the bytes the worker read are the bytes the request carried (JSON of the submitted object), and the create named exactly them
  const bytes=await readFile(join(directory,'bundle/bench-control.json'));
  expect(bytes.toString()).toBe(JSON.stringify(b.controlProfile));expect(seen.create!.bench.controlProfileRef.sha256).toBe(sha(bytes));
  // the server's rest positions are where the drive itself starts (tick 0's applied target), so a holding axis never moves
  expect(seen.tick0!.drives.map(d=>[d.axisId,d.targetApplied])).toEqual(WHEELS.map(a=>[a,0]));
  const path=join(directory,'trace/manifest.json'),manifest=JSON.parse(await readFile(path,'utf8'));
  manifest.gaps=[{firstTick:200,lastTick:200,reason:'OBSERVATION_LOST'}];manifest.coverage.complete=false;await writeFile(path,JSON.stringify(manifest));
  const reread=await resultRun.report() as Report;
  expect(reread.tuning!.metrics.rmsError).toMatchObject({available:false,reason:'TRACE_GAP'});
  expect(reread.tuning!.trace.samples).toBe(4990);expect(reread.bench.traceIssues).toEqual(['TRACE_GAP:200-200:OBSERVATION_LOST']);
  show({wheel:{anchorTick:report.bench.anchorTick,metrics:t.metrics,trace:t.trace,effectiveInertia:t.effectiveInertia,suggestions:t.suggestions}});
 },120_000);
 test('a J3 step of 0.1 rad completes, with the J3 inertia at home; the arm holds at home and the gripper open',async()=>{
  const seen:{tick0?:{drives:{axisId:string;targetApplied:number}[]}}={},enabled:number[]=[],moved:number[]=[];
  const {report,view}=await bench(arm(),async(req,next)=>{
   const r=await next() as {result:{tick:number;drives:{state:string}[]}};if(req.op==='create')seen.tick0=r.result as never;
   if(req.op==='step'||req.op==='create'){const p=req.payload as {targetTick?:number;driveCommands?:{axisId:string;target:number}[]};if(r.result.drives.every(d=>d.state==='enabled'))enabled.push(r.result.tick);
    const j3=p.driveCommands?.find(c=>c.axisId==='xarm-1/J3');if(j3&&Math.abs(j3.target-seen.tick0!.drives[2]!.targetApplied)>1e-12)moved.push(p.targetTick!);}
   return r;});
  expect(view.run.status).toBe('completed');
  const t=report.tuning!;expect(validateControlEvidenceShape(t)).toBe(true);
  expect(t).toMatchObject({status:'completed',axisIds:['xarm-1/J3'],effectiveInertia:{basis:'mass_matrix_diagonal',provenance:'assumed'},plant:{plantModelDigest:'0e2f40ef5a4569ea3e76879ed078fffd55d514b42c25c60072ebd7d27af3445a',load:'empty'},trace:{samples:5000}});
  expect(t.effectiveInertia!.valueKgM2).toBeCloseTo(0.7127244,6);expect(t.suggestions).toEqual(expectedSuggestions(t,'csp'));
  expect(t.metrics.riseTimeS.available).toBe(true);expect(t.metrics.settlingTimeS.available).toBe(true);
  const home=(JSON.parse(readFileSync(join(mujocoRoot,'fixtures/xarm6-g2-v1/programs.json'),'utf8')) as {programs:{waypoints:{home:number[]}}}).programs.waypoints.home;
  for(const [i,d] of seen.tick0!.drives.entries())expect(d.targetApplied,d.axisId).toBeCloseTo(i<6?home[i]!:0,9);
  // the anchor (ruling 3): the first tick commanded after every axis reported enabled (the nominal drive's 25-substep enable sequence ends in tick 3); the step lands atTick ticks later
  expect(report.bench.anchorTick).toBe(enabled[0]!+1);expect(enabled[0]).toBe(3);expect(moved[0]).toBe(report.bench.anchorTick!+10);
  expect(report.bench.anchorTick).toBe(benchAnchorTick(doc('xarm6-drive-nominal-v1.json')));expect(t.engine).toEqual({id:'mujoco_arm',version:'3.17.0',hostArch:HOST});
  show({j3:{anchorTick:report.bench.anchorTick,metrics:t.metrics,trace:t.trace,effectiveInertia:t.effectiveInertia,suggestions:t.suggestions}});
 },120_000);
 test('V07pre: a draft whose loop and limits are tuned_in_simulation passes the worker\'s own schema check, runs to completion and reached the worker byte for byte',async()=>{
  const base=doc<ControlProfileV1>('serve-control-v1.json'),source={kind:'tuned_in_simulation',benchRunId:'3f2b1c4d-0000-4000-8000-000000000001',scenarioId:'MJ-BENCH-WHEEL',traceSha256:'d'.repeat(64),sourceCommit:'e'.repeat(40),axisIds:WHEELS,driveModelDigest:base.driveModelDigests[0]!};
  const tuned=sealDriveDocument({...base,revision:2,sources:{...base.sources,loop:source,limits:source}} as ControlProfileV1);
  const {report,directory}=await bench(wheel({controlProfile:tuned}),undefined,'wheel tuned draft');
  expect(report.tuning).toMatchObject({status:'completed',plant:{controlProfileDigest:tuned.digest}});
  expect((await readFile(join(directory,'bundle/bench-control.json'))).toString()).toBe(JSON.stringify(tuned));
 },120_000);
 test('kp far above the envelope ceiling, written straight into the profile file, ends the bench as drive_fault OVERSPEED; the slot is free and a second bench run starts right after',async()=>{
  const envelope=doc<{axes:{axisId:string;kp:{max:number}}[]}>('tuning-envelope-v1.json'),ceiling=envelope.axes.find(a=>a.axisId==='xarm-1/J3')!.kp.max;
  const hot=structuredClone(doc<ControlProfileV1>('xarm6-control-v1.json'));hot.axes.find(a=>a.axisId==='xarm-1/J3')!.loop.kp=100*ceiling;
  const sealed=sealDriveDocument({...hot,digest:''}),text=JSON.stringify(sealed);
  // deliberately past the runtime's admission (the worker does not check the envelope): the file and the create ref are swapped under a run admitted with the fixture profile
  const first=await bench(arm(),async(req,next,_w,bundleRoot)=>{
   if(req.op==='create'){const p=req.payload as {bench:{controlProfileRef:{path:string;sha256:string}}};await writeFile(join(bundleRoot,p.bench.controlProfileRef.path),text);p.bench.controlProfileRef.sha256=sha(text);}
   return next();
  },'J3 hot'),{report,view}=first;
  expect(view.run.status).toBe('completed');
  const t=report.tuning!;expect(validateControlEvidenceShape(t)).toBe(true);
  expect(t).toMatchObject({status:'drive_fault',unstable:null,fault:{axisId:'xarm-1/J3',code:'OVERSPEED'}});
  expect(t.fault!.tick).toBe(report.bench.anchorTick!+10+1);   // the second tick of the step, as V06b measured
  expect(Object.values(t.metrics).every(m=>!m.available&&m.reason==='DRIVE_FAULT')).toBe(true);
  expect(t.trace.samples).toBe(t.fault!.tick*10);expect(report.bench.traceIssues).toEqual([]);   // the trace up to the fault is saved and reads back whole
  expect((await first.run.snapshot()).run.status).toBe('completed');   // the first run is still open
  show({j3Hot:{status:t.status,fault:t.fault,anchorTick:report.bench.anchorTick,riseTimeS:t.metrics.riseTimeS,trace:t.trace}});
  const again=await bench(arm(),undefined,'J3 after fault');expect(again.report.tuning!.status).toBe('completed');   // started and run while the faulted one is open
 },180_000);
 test('protocol_double: a step answered PLANT_UNSTABLE ends the bench as unstable with its tick and warning; the worker is closed, the slot free, the next bench starts at once',async()=>{
  const {report,view,run}=await bench(arm(),async(req,next)=>{
   const p=req.payload as {targetTick?:number};
   if(req.op==='step'&&p.targetTick===30)return {protocol:'mekoniq-sim3d/1',requestId:'step-x',runId:'x',ok:false,error:{code:'PLANT_UNSTABLE',message:'the engine reported a bad state (BADQACC) and reset itself'}};
   return next();
  },'J3 unstable double');
  expect(view.run.status).toBe('completed');
  const t=report.tuning!;expect(validateControlEvidenceShape(t)).toBe(true);
  expect(t).toMatchObject({status:'unstable',fault:null,unstable:{tick:30,warning:'the engine reported a bad state (BADQACC) and reset itself'}});
  expect(Object.values(t.metrics).every(m=>!m.available&&m.reason==='PLANT_UNSTABLE')).toBe(true);
  expect(t.trace.samples).toBe(29*10);
  show({j3UnstableDouble:{status:t.status,unstable:t.unstable,riseTimeS:t.metrics.riseTimeS,trace:t.trace}});
  expect((await run.snapshot()).run.status).toBe('completed');   // still open
  // the next bench, while the unstable one is open: the gripper on the ideal drive, whose axes boot enabled (anchor 1, as admission computes it)
  const next=await bench(arm({axis:'gripper',signal:{kind:'step',amplitude:0.1,atTick:5},driveExperimentId:'drive-ideal-v1'}),undefined,'gripper after unstable');
  expect(next.report.tuning!.status).toBe('completed');expect(next.report.bench.anchorTick).toBe(1);expect(benchAnchorTick(doc('xarm6-drive-ideal-v1.json'))).toBe(1);
 },180_000);
 test('protocol_double: a snapshot that names a collision (the AMR against boundary-west, the arm against a table) ends the bench as collision with its tick and ids, every metric COLLISION, the trace up to it kept; worker closed and slot free before close',async()=>{
  for(const [b,part,ids] of [[wheel(),'robots',['boundary-west']],[arm(),'arms',['table-1']]] as const){
   const {report,view}=await bench(b,async(req,next)=>{
    const r=await next() as {ok:boolean;result:Record<string,{collisionIds:string[]}[]>};
    if(req.op==='step'&&(req.payload as {targetTick:number}).targetTick===40)r.result[part]![0]!.collisionIds=[...ids];
    return r;
   },`${b.scenarioId} collision double`);
   expect(view.run.status).toBe('completed');
   const t=report.tuning!;expect(validateControlEvidenceShape(t),JSON.stringify(validateControlEvidenceShape.errors)).toBe(true);
   expect(t).toMatchObject({status:'collision',collision:{tick:40,ids},fault:null,unstable:null});
   expect(Object.values(t.metrics).every(m=>!m.available&&m.reason==='COLLISION')).toBe(true);
   expect(t.trace.samples).toBe(400);expect(report.bench.traceIssues).toEqual([]);   // ticks 1-40 saved and read back whole
  }
 },180_000);
 test('a cancelled bench closes its worker and frees the slot itself, records why its trace ended, and has no result; the next bench starts while it is open',async()=>{
  const {run,view,directory,worker}=await begin(arm({signal:{kind:'step',amplitude:0.1,atTick:30}}));
  let v=await run.action({actionId:'step-1',expectedRevision:view.run.runRevision,kind:'step',payload:{ticks:20}});expect(v.tick).toBe(20);
  v=await run.action({actionId:'cancel',expectedRevision:v.run.runRevision,kind:'cancel',payload:{}});
  expect(v.run.status).toBe('cancelled');expect(activeRunCount(MUJOCO_SLOT)).toBe(0);expect(worker().state).toBe('closed');
  expect((await run.report() as Report).tuning).toBeNull();
  expect(JSON.parse(await readFile(join(directory,'trace/manifest.json'),'utf8'))).toMatchObject({terminalReason:'CANCELLED',coverage:{lastTick:20,complete:false}});
  await expect(run.action({actionId:'step-2',expectedRevision:v.run.runRevision,kind:'step',payload:{ticks:1}})).rejects.toThrow('INVALID_STATE:RUN_FINISHED');
  expect((await bench(arm(),undefined,'J3 after cancel')).report.tuning!.status).toBe('completed');
 },180_000);
 test('over HTTP: the bench set is in health with the envelope and the signal catalog, a session creates, starts, steps and reads the report of an arm bench',async()=>{
  const directory=await mujocoTemp('mj-bench-gw-');
  const p=await mujocoProcessScope.observe(async()=>mujocoFromOptions({enabled:true,python:mujocoPython,workerRoot:mujocoRoot,lockPath:join(mujocoRoot,'requirements.lock'),directory:join(directory,'probe'),bundleFile:async()=>{throw Error('NO_BUNDLE');}}));
  const sim=await portableSimulationFromOptions({enabled:false,python:'python3',workerRoot:'robotics/navigation-2d',lockPath:'robotics/navigation-2d/requirements.lock',directory,mujoco:{arm:p.arm,mobile:p.mobile}});
  const g:LabGateway=await startLabGateway({port:0,directory,sourceCommit:'test-commit',schemaHash:'a'.repeat(64),v2:{stream:{heartbeatMs:50,pollMs:50,telemetryMs:50},catalog:sim.catalog,enabledBackends:sim.enabledBackends,simulationFactory:async(i,pr)=>mujocoProcessScope.observeRun(await sim.simulationFactory(i,pr)),portableChecks:sim.readinessChecks,...sim.benchCatalog?{benchCatalog:sim.benchCatalog}:{}}});
  try{
   const health=await (await fetch(g.url+'/lab/v2/health')).json() as {scenarioIds:string[];backendSets:{id:string}[];tuningEnvelope:{revision:number};benchSignals:object;benchCatalog:BenchCatalog};
   expect(health.scenarioIds).toEqual(expect.arrayContaining(['MJ-BENCH-WHEEL','MJ-BENCH-ARM']));expect(health.backendSets.map(s=>s.id)).toContain(SET);
   expect(health.tuningEnvelope).toEqual(doc('tuning-envelope-v1.json'));expect(health.tuningEnvelope.revision).toBe(2);
   expect(health.benchSignals).toEqual({kinds:['step','trapezoid','hold'],maxTicks:500,amplitudes:{wheelRadS:[2,5],jointRad:[0.05,0.1,0.2]},suggestOptions:{bandwidthRadS:[5,10,20,40],damping:[0.7,1]},wheelDirection:'forward'});
   // V07pre: the catalog the runtime built from its own worker root, with the starting draft the Lab sends unchanged below
   expect(Object.keys(health.benchCatalog)).toEqual(['MJ-BENCH-WHEEL','MJ-BENCH-ARM']);expect(health.benchCatalog['MJ-BENCH-ARM'].startingProfile).toEqual(doc('xarm6-control-v1.json'));
   const paired=await fetch(g.url+'/lab/v2/sessions',{method:'POST',headers:{origin:'http://127.0.0.1:4175','content-type':'application/json'},body:JSON.stringify({token:g.issuePairingToken()})});
   const h={cookie:paired.headers.get('set-cookie')!.split(';')[0]!,origin:'http://127.0.0.1:4175','content-type':'application/json','x-csrf-token':String((await paired.json() as {csrfToken:string}).csrfToken)};
   const call=async(path:string,body?:unknown)=>{const r=await fetch(g.url+'/lab/v2'+path,{method:body?'POST':'GET',headers:h,...body?{body:JSON.stringify(body)}:{}});return {status:r.status,body:await r.json() as Record<string,unknown>};};
   const b=arm({axis:'J2',signal:{kind:'step',amplitude:-0.05,atTick:20},controlProfile:health.benchCatalog['MJ-BENCH-ARM'].startingProfile});
   const created=await call('/runs',{scenarioId:'MJ-BENCH-ARM',scenarioRevision:1,seed:3,mode:'simulation',access:'simulated',backendSetId:SET,runtimeIdentity:{sourceCommit:'test-commit',schemaHash:'a'.repeat(64)},bench:b});
   expect(created.status,JSON.stringify(created.body)).toBe(201);
   const id=(created.body.run as {id:string}).id;
   let r=await call(`/runs/${id}/actions`,{actionId:'start',expectedRevision:0,kind:'start',payload:{}});expect(r.status,JSON.stringify(r.body)).toBe(200);
   // F5: the event stream of a bench (V07 shows it, also after a hidden tab) sees the ticks go by, the end, and carries on without an error once the worker has closed
   const ctl=new AbortController(),es=await fetch(`${g.url}/lab/v2/runs/${id}/events`,{headers:h,signal:ctl.signal}),frames:{event:string;data:{tick:number;runRevision:number}}[]=[],stream={ended:false};
   expect(es.status).toBe(200);expect(es.headers.get('content-type')).toMatch(/text\/event-stream/);
   void (async()=>{let buf='';const dec=new TextDecoder();try{for await(const c of es.body as unknown as AsyncIterable<Uint8Array>){buf+=dec.decode(c,{stream:true});let i;while((i=buf.indexOf('\n\n'))>=0){const rec=buf.slice(0,i);buf=buf.slice(i+2);const ev=/^event: (.*)$/m.exec(rec)?.[1],data=/^data: (.*)$/m.exec(rec)?.[1];if(ev&&data)frames.push({event:ev,data:JSON.parse(data)});}}}catch{/* aborted */}finally{stream.ended=true;}})();
   const until=async(ok:()=>boolean)=>{for(const end=Date.now()+15_000;!ok();){if(Date.now()>end)throw Error(`SSE timeout: ${JSON.stringify(frames.slice(-3))}`);await new Promise(x=>setTimeout(x,25));}};
   r=await call(`/runs/${id}/actions`,{actionId:'step',expectedRevision:(r.body.run as {runRevision:number}).runRevision,kind:'step',payload:{ticks:500}});expect(r.status).toBe(200);expect((r.body.run as {status:string}).status).toBe('completed');
   const finalRevision=(r.body.run as {runRevision:number}).runRevision,ended=()=>frames.filter(f=>f.data.tick===500&&f.data.runRevision===finalRevision).length;
   await until(()=>ended()>=3);   // the end, then heartbeats after the worker closed
   expect(frames.some(f=>f.data.tick>0&&f.data.tick<500),'the stream saw the bench progress').toBe(true);
   expect(frames.every(f=>f.event==='heartbeat'),JSON.stringify(frames.filter(f=>f.event!=='heartbeat'))).toBe(true);   // no reset, no business event (a bench has no journal), no error
   expect(stream.ended).toBe(false);ctl.abort();
   const report=await call(`/runs/${id}/report`);expect(report.status).toBe(200);
   expect(report.body.tuning).toMatchObject({status:'completed',axisIds:['xarm-1/J2'],seed:3});
   expect(activeRunCount(MUJOCO_SLOT)).toBe(0);
   // F2: the trace as recorded and read back: exactly the samples the metrics were computed from
   const trace=await call(`/runs/${id}/trace`) as unknown as {status:number;body:{traces:DriveTrace[];issues:string[]}};expect(trace.status).toBe(200);
   expect(trace.body.issues).toEqual([]);expect(trace.body.traces.map(x=>[x.axisId,x.dtS,x.samples.length])).toEqual([['xarm-1/J2',0.002,5010]]);expect(trace.body.traces[0]!.samples.every(x=>x!==null)).toBe(true);
   const t=report.body.tuning as TuningResultV1,anchor=(report.body.bench as {anchorTick:number}).anchorTick;
   expect(benchMetrics(trace.body.traces[0]!,b.signal,anchor,'csp',t.policy,'completed')).toEqual(t.metrics);
   // the anchor health announced for this plant and experiment is the one the run really had (the first tick commanded after every axis reported enabled)
   expect(anchor).toBe(health.benchCatalog['MJ-BENCH-ARM'].experiments['drive-nominal-v1']!.anchorTick);
   const j2=health.benchCatalog['MJ-BENCH-ARM'].axes.find(a=>a.axis==='J2')!;if(j2.mode!=='csp')throw Error('J2 is a position axis');
   expect(trace.body.traces[0]!.samples[0]!.target).toBeCloseTo(j2.startRad,9);   // tick 0 holds the axis at the rest health announced
   expect(t.metrics.riseTimeS.available).toBe(true);
  }finally{await g.close();}
 },180_000);
});
