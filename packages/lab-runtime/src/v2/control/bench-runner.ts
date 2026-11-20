// Single-axis bench runs (R4-A §6, plan V06, V06c rulings). One run, one MuJoCo worker on a scene the server builds from its fixtures (the wheels of serve-payload-v1 on the empty load, or the
// xArm 6 of xarm6-g2-v1 at home), the experiment's drive model and the user's draft control profile byte for byte (D2). Every tick commands every axis: the bench target on the traced axes, a hold on the
// others. The 500 Hz trace goes to a recorder of its own (immutable gzip chunks with sha256 and a quota, the helpers of physics-evidence.ts) and the result is built from the trace as READ BACK.
// A bench ends in one of four results (ruling 8, final-fix F1): completed, drive_fault (an axis latched a fault), unstable (the engine reported instability) or collision (a snapshot named a contact the plant
// does not allow). The non-completed ones are results: the worker is closed, the engine slot released, and nothing lowers a gain or runs again by itself. A lost or refused step is not a result: the run needs
// attention and has no tuning. GET /lab/v2/runs/:id/trace serves the trace as read back (trace()), never from memory.
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {gunzipSync,gzipSync} from 'node:zlib';
import {BENCH_SET_ID} from '../capabilities';
import {checkScenario,scenarioHash,scenarioRegistry} from '../scenario-registry';
import {resolveBackends} from '../scenario-matrix';
import {validateActionV2,type LabProjectV2} from '../contracts';
import {hashJson} from '../hash';
import {PRNG} from '../random';
import {TICK_MS} from '../clock';
import {TelemetryRecorder} from '../telemetry';
import {awaitTick,realWall,type PaceAnchor} from '../pace';
import type {RunManifestInput,RunProviders,RunView,ScenarioRun} from '../scenario-runner';
import type {Attention,RunReport} from '../report';
import type {NativeReadinessChecks} from '../readiness';
import {READ_LIMITS,writeDurable} from '../navigation2d/evidence';
import {sealDocument,type NavigationSceneV1} from '../navigation2d/contracts';
import {activeRunCount,holdSlot,releaseSlot} from '../navigation2d/runner';
import {WorkerLostError,type IRSimWorkerClient,type SpawnOptions} from '../navigation2d/worker-client';
import {physicsDirectoryBytes,readBoundedPhysicsFile} from '../simulation3d/physics-evidence';
import {buildArmCellScene,readXArmFixture,writeArmCellBundle} from '../simulation3d/arm-cell-scene';
import {spawnMujocoWorker} from '../simulation3d/worker-client';
import {MUJOCO_MAX_ACTIVE_RUNS,MUJOCO_SLOT,type MujocoRuntimeOptions} from '../simulation3d/mujoco';
import {BENCH_MAX_TICKS,benchAnchorTick,benchSignalLastTick,benchTarget,validateBenchRequest} from './bench-signals';
import {driveExperiment} from './drive-experiments';
import {validateBenchRequestShape,validateControlEvidenceShape,validateControlProfile,type BenchRequestV1,type ControlMetric,type DriveAxisSnapshot,type DriveModelV1,type DriveTrace,type TuningEnvelopeV1,type TuningResultV1} from './drive-io';
import {stepResponseMetrics} from './tuning-metrics';

const sha=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
const DRIVE='fixtures/drive-v1',SERVE='fixtures/serve-payload-v1',ARM_ID='xarm-1',WHEELS=['amr-1/wheel-left','amr-1/wheel-right'];
/** Spec §6.1 and contracts §7: 5,000 samples per axis (ticks 1–500; tick 0, the priming tick, is the pre-signal baseline: ruling 15), 16 MiB compressed. */
export const BENCH_TRACE_LIMITS={samplesPerAxis:5000,maxBytes:16*1024*1024,chunkTicks:50,substeps:10,dtS:0.002} as const;
type Sample=NonNullable<DriveTrace['samples'][number]>;
type Policy={finalWindowS:number;settleBand:number;holdWindowS:number};

// ---- the plant ---------------------------------------------------------------------------------------------------------------------------------------------
/** What the server knows of a bench plant before any engine: the experiment's drive model (its bytes as committed), the envelope, the plant the profile must be sealed for, the traced axes, where every
 * axis rests (the arm's home, the gripper open, a wheel at rest) and, for an arm axis, its limits. */
export interface BenchPlant {kind:'amr'|'arm';axisIds:string[];/** the engine tick of signal tick 0 the drive model's enable sequence gives (benchAnchorTick) */anchorTick:number;model:DriveModelV1;modelBytes:Buffer;envelope:TuningEnvelopeV1;plantModelDigest:string;start:Record<string,number>;limits?:{lower:number;upper:number;start:number};policy:Policy}
export async function benchPlant(workerRoot:string,bench:BenchRequestV1):Promise<BenchPlant>{
 const kind=bench.scenarioId==='MJ-BENCH-WHEEL'?'amr':'arm',e=driveExperiment(bench.driveExperimentId),file=(p:string)=>readFile(join(workerRoot,p));
 const modelBytes=await file(join(DRIVE,kind==='amr'?e.mobileModel:e.armModel)),model=JSON.parse(modelBytes.toString()) as DriveModelV1;
 const envelope=JSON.parse((await file(join(DRIVE,'tuning-envelope-v1.json'))).toString()) as TuningEnvelopeV1;
 const policy=(JSON.parse((await file(join(DRIVE,'control-oracle-v1.json'))).toString()) as {metricPolicy:Policy}).metricPolicy;
 if(kind==='amr'){
  // D2: the AMR's plant is its physical model, whatever the load
  const scene=JSON.parse((await file(join(SERVE,'navigation-scene.json'))).toString()) as NavigationSceneV1;
  return {kind,axisIds:[...WHEELS],anchorTick:benchAnchorTick(model),model,modelBytes,envelope,policy,plantModelDigest:scene.robots[0]!.model.physicalModelDigest,start:Object.fromEntries(model.axes.map(a=>[a.axisId,0]))};
 }
 const f=readXArmFixture(workerRoot),component=JSON.parse(f.componentText) as {joints:{id:string;limits?:{lower?:{value:number};upper?:{value:number}}}[]};
 // the home keyframe (compile.py): the joints at the fixture's home, every gripper joint at 0 (open). The gripper axis is its drive joint, in rad (0 open .. 0.85 closed), so it shares the joint amplitudes
 const start:Record<string,number>={...Object.fromEntries(f.programs.waypoints.home!.map((q,k)=>[`${ARM_ID}/J${k+1}`,q])),[`${ARM_ID}/gripper`]:0};
 const axisId=`${ARM_ID}/${bench.axis}`,lim=component.joints.find(j=>j.id===(bench.axis==='gripper'?f.physics.gripper.driveJoint:bench.axis))?.limits;
 return {kind,axisIds:[axisId],anchorTick:benchAnchorTick(model),model,modelBytes,envelope,policy,plantModelDigest:sha(Buffer.from(f.componentText)),start,
  ...lim?.lower&&lim.upper&&start[axisId]!==undefined?{limits:{lower:lim.lower.value,upper:lim.upper.value,start:start[axisId]!}}:{}};
}

/** Admission of a bench request against its plant, before any directory, slot or engine (ruling 2): shape and signal (registered amplitude, the joint limits, and ticks: the signal must end
 * by engine tick 500 counted from the anchor the drive model's enable sequence gives, else TICK_OUT_OF_RANGE), the draft profile against the experiment's
 * drive model and the envelope (validateControlProfile calls withinEnvelope), and the plant it is sealed for. Refusals are INVALID_BENCH_REQUEST with their codes (a 422). */
export async function admitBench(bench:unknown,workerRoot:string):Promise<BenchPlant>{
 const shape=validateBenchRequestShape(bench);if(!shape.ok)throw Error(`INVALID_BENCH_REQUEST:${shape.reasonCodes.join(',')}`);
 const b=bench as BenchRequestV1,plant=await benchPlant(workerRoot,b),codes=new Set<string>();
 for(const c of [validateBenchRequest(b,{anchorTick:plant.anchorTick,...plant.limits?{limits:plant.limits}:{}}),validateControlProfile(b.controlProfile,plant.model,plant.envelope)])for(const x of c.reasonCodes)codes.add(x);
 // D2: a draft is never re-sealed for the plant; one sealed for another plant is refused
 if(b.controlProfile.plantModelDigest!==plant.plantModelDigest)codes.add('DRIVE_PLANT_MISMATCH');
 if(codes.size)throw Error(`INVALID_BENCH_REQUEST:${[...codes].sort().join(',')}`);
 return plant;
}

/** The worker's bundle: the plant's scene and files from the fixture, the drive model's committed bytes and the draft as it was submitted (JSON.stringify of the request's object: never re-sealed). */
async function writeBenchBundle(dir:string,workerRoot:string,bench:BenchRequestV1,plant:BenchPlant,seed:number){
 await mkdir(dir,{recursive:true,mode:0o700});const put=(p:string,b:Uint8Array|string)=>writeFile(join(dir,p),b,{mode:0o600,flag:'wx'});
 let sceneDigest:string,create:Record<string,unknown>;
 if(plant.kind==='amr'){
  const root=join(workerRoot,SERVE),scene=JSON.parse(await readFile(join(root,'navigation-scene.json'),'utf8')) as NavigationSceneV1,empty=await readFile(join(root,'empty.json')),load=JSON.parse(empty.toString()) as {id:string;revision:number};
  for(const f of scene.files){const b=await readFile(join(root,f.path));if(b.length!==f.bytes||sha(b)!==f.sha256)throw Error(`BENCH_FIXTURE_MISMATCH:${f.path}`);await put(f.path,b);}
  // ruling 14: the wheel bench runs on the empty load only (the worker refuses any other)
  const sealed=sealDocument({...scene,engine:{...scene.engine,loadProfileRef:{id:load.id,revision:load.revision,path:'empty.json',sha256:sha(empty)}}},'sceneDigest');
  await put('navigation-scene.json',JSON.stringify(sealed));sceneDigest=sealed.sceneDigest;create={sceneRef:'navigation-scene.json',seed};
 }else{
  // the arm scene schema needs one cup: it stays parked (pinned, contacts off) for the whole bench; nothing ever places it
  const f=readXArmFixture(workerRoot),project=JSON.parse(await readFile(join(workerRoot,'fixtures/xarm6-g2-v1/coffee-cell-project.json'),'utf8')) as LabProjectV2;
  const scene=buildArmCellScene(project,f,seed,{armId:ARM_ID,propIds:['cup-1']});await writeArmCellBundle(dir,scene,f);
  sceneDigest=scene.sceneDigest;create={sceneRef:'arm-cell-scene.json',seed,arms:[{armId:ARM_ID,sceneRef:'arm-cell-scene.json'}]};
 }
 const control=Buffer.from(JSON.stringify(bench.controlProfile));await put('bench-drive.json',plant.modelBytes);await put('bench-control.json',control);
 const ref=(d:{id:string;revision:number},path:string,b:Uint8Array)=>({id:d.id,revision:d.revision,path,sha256:sha(b)});
 return {sceneDigest,create:{...create,bench:{driveModelRef:ref(plant.model,'bench-drive.json',plant.modelBytes),controlProfileRef:ref(bench.controlProfile,'bench-control.json',control),axisIds:plant.axisIds}}};
}

// ---- the durable trace -------------------------------------------------------------------------------------------------------------------------------------
export interface BenchTraceIdentity {runId:string;axisIds:string[];plantModelDigest:string;driveModelDigest:string;controlProfileDigest:string}
/** The layout of the physics stream (physics-evidence.ts): a manifest listing immutable gzip ndjson chunks by path, sha256 and bytes, coverage, gaps and a terminal reason. One line per tick: {tick, axes}. */
export interface BenchTraceManifest {schemaVersion:1;documentType:'drive-trace';identity:BenchTraceIdentity;dtS:number;substeps:number;chunks:{path:string;sha256:string;bytes:number;firstTick:number;lastTick:number}[];
 coverage:{firstTick:0;lastTick:number;complete:boolean};gaps:{firstTick:number;lastTick:number;reason:string}[];terminalReason:string|null}
const MANIFEST='manifest.json',CHUNK=/^drive-trace-\d{6}-[a-f0-9]{8}\.ndjson\.gz$/,SAMPLE_KEYS=['actual','feedback','saturated','target','torqueNm'];
const finite=(x:unknown)=>typeof x==='number'&&Number.isFinite(x);
/** One tick of the trace as the worker sends it (or a chunk line holds it): every traced axis in order, 10 samples each, finite numbers, a feedback that is a number or null (dropout). */
function tickAxes(value:unknown,axisIds:readonly string[]):{axisId:string;samples:Sample[]}[]{
 const fail=()=>{throw Error('TRACE_RECORD_INVALID');};
 if(!Array.isArray(value)||value.length!==axisIds.length)fail();
 return (value as {axisId:unknown;dtS?:unknown;samples:unknown}[]).map((a,k)=>{
  if(!a||a.axisId!==axisIds[k]||a.dtS!==undefined&&a.dtS!==BENCH_TRACE_LIMITS.dtS||!Array.isArray(a.samples)||a.samples.length!==BENCH_TRACE_LIMITS.substeps)fail();
  for(const s of a.samples as Record<string,unknown>[])if(!s||Object.keys(s).sort().join()!==SAMPLE_KEYS.join()||![s.target,s.actual,s.torqueNm].every(finite)||!(s.feedback===null||finite(s.feedback))||typeof s.saturated!=='boolean')fail();
  return {axisId:axisIds[k]!,samples:a.samples as Sample[]};
 });
}
export interface BenchTraceRecorder {directory:string;manifest():BenchTraceManifest;append(tick:number,trace:unknown):Promise<void>;flush():Promise<void>;finish(reason:string|null):Promise<void>;gap(firstTick:number,lastTick:number,reason:string):Promise<void>}
/** A failed append, chunk or manifest write ends the recording with its reason (a gap, never a silent cut). The sample cap counts ticks 1–500 (ruling 15). */
export async function openBenchTrace(directory:string,identity:BenchTraceIdentity,o:{maxBytes?:number;chunkTicks?:number}={}):Promise<BenchTraceRecorder>{
 const maxBytes=o.maxBytes??BENCH_TRACE_LIMITS.maxBytes,chunkTicks=o.chunkTicks??BENCH_TRACE_LIMITS.chunkTicks;
 await mkdir(directory,{recursive:true,mode:0o700});if((await readdir(directory)).length)throw Error('TRACE_DIRECTORY_NOT_EMPTY');
 const m:BenchTraceManifest={schemaVersion:1,documentType:'drive-trace',identity:structuredClone(identity),dtS:BENCH_TRACE_LIMITS.dtS,substeps:BENCH_TRACE_LIMITS.substeps,chunks:[],coverage:{firstTick:0,lastTick:-1,complete:false},gaps:[],terminalReason:null};
 let lines:string[]=[],first=0,last=-1,counted=0,queue:Promise<void>=Promise.resolve();
 const serial=(fn:()=>Promise<void>)=>{const p=queue.then(fn);queue=p.catch(()=>{});return p;};
 // every publication fits in the quota with the manifest it is listed in (and a worst-case terminal reason)
 const quota=async(extra:number)=>{if(await physicsDirectoryBytes(directory)+extra+1024>maxBytes)throw Error('TRACE_QUOTA_EXCEEDED');};
 const save=async()=>{const b=JSON.stringify(m);await quota(Buffer.byteLength(b));await writeDurable(directory,MANIFEST,b);};
 const end=async(reason:string)=>{m.terminalReason??=reason.slice(0,200);m.coverage.complete=false;await save().catch(()=>{});};
 const flush=async()=>{
  if(!lines.length)return;
  const bytes=gzipSync(lines.join('')),path=`drive-trace-${String(m.chunks.length).padStart(6,'0')}-${randomBytes(4).toString('hex')}.ndjson.gz`;
  if(m.chunks.length>=READ_LIMITS.chunksPerStream||bytes.length>READ_LIMITS.chunkBytes)throw Error('TRACE_READ_LIMIT');
  await quota(bytes.length+Buffer.byteLength(JSON.stringify(m))+256);await writeDurable(directory,path,bytes);
  m.chunks.push({path,sha256:sha(bytes),bytes:bytes.length,firstTick:first,lastTick:last});m.coverage.lastTick=last;lines=[];first=last+1;await save();
 };
 const failed=async(e:unknown)=>{await end((e as Error).message);throw e;};
 await save();
 return {directory,manifest:()=>structuredClone(m),
  append:(tick,trace)=>serial(async()=>{
   if(m.terminalReason)throw Error('TRACE_RECORDER_TERMINAL');
   try{
    if(tick!==last+1)throw Error('TRACE_TICK_ORDER');
    const axes=tickAxes(trace,identity.axisIds);
    if(tick>0&&counted+BENCH_TRACE_LIMITS.substeps>BENCH_TRACE_LIMITS.samplesPerAxis)throw Error('TRACE_SAMPLE_CAP');
    if(tick>0)counted+=BENCH_TRACE_LIMITS.substeps;
    lines.push(JSON.stringify({tick,axes})+'\n');last=tick;if(lines.length>=chunkTicks)await flush();
   }catch(e){m.gaps.push({firstTick:tick,lastTick:tick,reason:(e as Error).message.slice(0,200)});await failed(e);}
  }),
  flush:()=>serial(()=>flush().catch(failed)),
  finish:reason=>serial(async()=>{await flush().catch(failed);if(reason)m.terminalReason??=reason.slice(0,200);m.coverage.complete=!m.terminalReason&&!m.gaps.length&&last>=0;await save();}),
  gap:(firstTick,lastTick,reason)=>serial(async()=>{m.gaps.push({firstTick,lastTick,reason:reason.slice(0,200)});await end(reason);})};
}
export interface BenchTraceRead {manifest:BenchTraceManifest|null;manifestSha256:string|null;traces:DriveTrace[];issues:string[]}
/** The trace of ticks 0..runTick as read back now: bounded reads, every chunk checked against its listed size and sha256 and its ticks against its place. A tick no valid chunk holds (a gap, a bad chunk, a tail
 * that never became durable) is 10 null samples per axis, so a metric whose window contains it is TRACE_GAP (tuning-metrics.ts); nothing is skipped over. */
export async function readBenchTrace(directory:string,identity:BenchTraceIdentity,runTick:number):Promise<BenchTraceRead>{
 const n=(runTick+1)*BENCH_TRACE_LIMITS.substeps,traces:DriveTrace[]=identity.axisIds.map(axisId=>({axisId,dtS:BENCH_TRACE_LIMITS.dtS,samples:Array<Sample|null>(Math.max(0,n)).fill(null)}));
 const none=(issue:string):BenchTraceRead=>({manifest:null,manifestSha256:null,traces,issues:[issue]});
 let bytes:Buffer,m:BenchTraceManifest;
 try{bytes=await readBoundedPhysicsFile(directory,MANIFEST,READ_LIMITS.manifestBytes);m=JSON.parse(bytes.toString()) as BenchTraceManifest;}catch{return none('TRACE_MANIFEST_UNREADABLE');}
 if(m?.schemaVersion!==1||m.documentType!=='drive-trace'||!Array.isArray(m.chunks)||m.chunks.length>READ_LIMITS.chunksPerStream||!Array.isArray(m.gaps)||!m.coverage)return none('TRACE_MANIFEST_INVALID');
 if(hashJson(m.identity)!==hashJson(identity)||m.dtS!==BENCH_TRACE_LIMITS.dtS||m.substeps!==BENCH_TRACE_LIMITS.substeps)return none('TRACE_IDENTITY_MISMATCH');
 const issues=[...m.terminalReason?[`TRACE_TERMINAL:${String(m.terminalReason).slice(0,200)}`]:[],...m.gaps.map(g=>`TRACE_GAP:${g.firstTick}-${g.lastTick}:${String(g.reason).slice(0,100)}`)];
 let inflated=0,next=0;
 for(const c of m.chunks){
  try{
   if(typeof c.path!=='string'||!CHUNK.test(c.path))throw Error('TRACE_PATH_REJECTED');
   if(c.firstTick!==next||!(c.lastTick>=c.firstTick))throw Error('TRACE_CHUNK_ORDER');
   const b=await readBoundedPhysicsFile(directory,c.path,READ_LIMITS.chunkBytes);if(b.length!==c.bytes||sha(b)!==c.sha256)throw Error('TRACE_HASH_MISMATCH');
   const body=gunzipSync(b,{maxOutputLength:Math.min(READ_LIMITS.chunkInflated,READ_LIMITS.totalInflated-inflated)});inflated+=body.length;
   const rows=body.toString('utf8').split('\n');if(rows.pop()!==''||rows.length!==c.lastTick-c.firstTick+1)throw Error('TRACE_TRUNCATED');
   const ticks=rows.map((row,i)=>{if(Buffer.byteLength(row)>READ_LIMITS.lineBytes)throw Error('TRACE_READ_LIMIT');const x=JSON.parse(row) as {tick:unknown;axes:unknown};if(x.tick!==c.firstTick+i||Object.keys(x).length!==2)throw Error('TRACE_TICK_ORDER');return tickAxes(x.axes,identity.axisIds);});
   ticks.forEach((axes,i)=>{const tick=c.firstTick+i;if(tick<=runTick)axes.forEach((a,k)=>a.samples.forEach((s,j)=>{traces[k]!.samples[tick*BENCH_TRACE_LIMITS.substeps+j]=s;}));});
  }catch(e){issues.push(`TRACE_CHUNK_INVALID:${String(c?.path).slice(0,80)}:${(e as Error).message.slice(0,80)}`);}
  next=typeof c?.lastTick==='number'?c.lastTick+1:next;
 }
 if(m.coverage.lastTick<runTick)issues.push('TRACE_TAIL_MISSING');
 return {manifest:m,manifestSha256:sha(bytes),traces,issues};
}

// ---- metrics and the result ----------------------------------------------------------------------------------------------------------------------------------
type Outcome={status:'completed'}|{status:'drive_fault';fault:{tick:number;axisId:string;code:string}}|{status:'unstable';unstable:{tick:number;warning:string}}|{status:'collision';collision:{tick:number;ids:string[]}};
const METRIC_UNITS=(mode:'csp'|'csv'):Record<string,string>=>({riseTimeS:'s',overshootPct:'%',settlingTimeS:'s',steadyStateError:mode==='csp'?'rad':'rad/s',rmsError:mode==='csp'?'rad':'rad/s',peakTorqueNm:'N m',saturationRatio:'ratio'});
const allUnavailable=(mode:'csp'|'csv',reason:string)=>Object.fromEntries(Object.entries(METRIC_UNITS(mode)).map(([k,unit])=>[k,{available:false,value:null,unit,reason} as ControlMetric]));
/** The signal starts at the start of tick `anchor + atTick` (a hold: `anchor`), the anchor being the first tick commanded after every axis reported enabled. Its time origin t0S is the end of the tick before it:
 * sample 10·start − 1 of the trace (tick 0's first substep is sample 0), and y0 is the true state there. A step gets the step metrics of contracts §5; a trapezoid and a hold the tracking error, the peak torque and the
 * saturation ratio from their start (what §6.1 lists for them): the tracking error and the saturation ratio up to the end of the motion (a trapezoid's motion end, a hold's last tick: §6.1 "sai số bám khi chạy",
 * not the stationary tail), the peak torque to the end of the bench; the step metrics are SIGNAL_NOT_STEP. A drive fault, an unstable plant or a collision: every metric unavailable with that reason (no metric of the part before).
 * A signal that did not run to its end inside the trace (a step that never landed, a motion or a hold cut by the end of the bench) has no metric either: SIGNAL_TRUNCATED. */
export function benchMetrics(trace:DriveTrace,signal:BenchRequestV1['signal'],anchor:number|null,mode:'csp'|'csv',policy:Policy,outcome:Outcome['status']):Record<string,ControlMetric>{
 if(outcome!=='completed')return allUnavailable(mode,{drive_fault:'DRIVE_FAULT',unstable:'PLANT_UNSTABLE',collision:'COLLISION'}[outcome]);
 if(anchor===null)return allUnavailable(mode,'SIGNAL_NOT_STARTED');
 // a signal whose landing (a step), motion end (a trapezoid) or last tick (a hold) is past the last recorded tick did not run as asked: no metric of it (admission refuses one that cannot fit)
 const lastTick=trace.samples.length/BENCH_TRACE_LIMITS.substeps-1;
 if(anchor+benchSignalLastTick(signal)>lastTick)return allUnavailable(mode,'SIGNAL_TRUNCATED');
 const i0=BENCH_TRACE_LIMITS.substeps*(anchor+(signal.kind==='hold'?0:signal.atTick))-1,origin=trace.samples[i0];
 if(!origin)return allUnavailable(mode,'TRACE_GAP');
 const at={t0S:i0*trace.dtS,y0:origin.actual};
 if(signal.kind==='step')return stepResponseMetrics(trace,{...at,amplitude:signal.amplitude},policy,mode);
 // the tracking error, the peak torque and the saturation ratio do not depend on the amplitude (any non-zero one gives the same); the rest is a step's
 const motion=stepResponseMetrics({...trace,samples:trace.samples.slice(0,BENCH_TRACE_LIMITS.substeps*(anchor+benchSignalLastTick(signal)+1))},{...at,amplitude:1},policy,mode),units=METRIC_UNITS(mode);
 return {...Object.fromEntries(['riseTimeS','overshootPct','settlingTimeS','steadyStateError'].map(k=>[k,{available:false,value:null,unit:units[k]!,reason:'SIGNAL_NOT_STEP'}])),rmsError:motion.rmsError,
  peakTorqueNm:stepResponseMetrics(trace,{...at,amplitude:1},policy,mode).peakTorqueNm,saturationRatio:motion.saturationRatio};
}

// ---- readiness -------------------------------------------------------------------------------------------------------------------------------------------
/** A bench needs no project and no smoke: its plant is a fixture the boot describe already ran. What can stop it is the one engine slot (another run, or a probe, holds it). */
export const benchReadiness=(runtime:Pick<MujocoRuntimeOptions,'engineVersion'|'lockDigest'>):NativeReadinessChecks=>async context=>{
 const busy=activeRunCount(MUJOCO_SLOT,context.runId)>=MUJOCO_MAX_ACTIVE_RUNS,evidence=`mujoco:${runtime.engineVersion}/lock:${runtime.lockDigest.slice(0,16)}`;
 return [...['model','clock','fixture','profile'].map(id=>({id,status:'ready' as const,reasonCodes:[],evidenceRef:`${evidence}/${id}`})),{id:'runner',status:busy?'blocked' as const:'ready' as const,reasonCodes:busy?['MUJOCO_CAPACITY']:[],evidenceRef:evidence}];
};

// ---- the run -----------------------------------------------------------------------------------------------------------------------------------------------
/** `runtime`: the operator's MuJoCo options (never a request field). `spawn`: a test/fault option (a protocol double around the real worker), never exposed through a request. */
export interface BenchProviders extends RunProviders {runtime:MujocoRuntimeOptions;spawn?:(o:SpawnOptions)=>Promise<IRSimWorkerClient>}
export async function createBenchRun(input:RunManifestInput&{bench?:unknown},providers:BenchProviders):Promise<ScenarioRun>{
 const scenario=scenarioRegistry.get(input.scenarioId);
 if(!scenario?.bench||input.backendSetId!==BENCH_SET_ID||input.bench===undefined)throw Error('BENCH_SCOPE_INVALID');
 if(input.mode!=='simulation'||input.access!=='simulated')throw Error('MODE_BACKEND_MISMATCH');
 checkScenario(scenario);if(scenario.revision!==input.scenarioRevision)throw Error('SCENARIO_REVISION_MISMATCH');
 if(!Number.isSafeInteger(input.seed)||input.seed<0||input.seed>0xffffffff)throw Error('INVALID_SEED');
 const required=resolveBackends(scenario,'simulation',BENCH_SET_ID,providers.catalog);
 if(!required.ok||!required.required.every(b=>(providers.enabledBackends??[]).includes(b)))throw Error('BACKEND_EXECUTION_DISABLED');
 // ponytail: a bench is ≤ 10 s of simulation and keeps no checkpoint; a cold reclaim after a restart is refused (its trace and bundle stay on disk). Add a read-only reopen when someone needs one.
 if(providers.reclaimOnly)throw Error('RECOVERY_CHECKPOINT_MISSING');
 const bench=input.bench as BenchRequestV1;
 if(bench.scenarioId!==scenario.id)throw Error('INVALID_BENCH_REQUEST:BENCH_SCOPE_INVALID');
 const plant=await admitBench(bench,providers.runtime.workerRoot);
 const dir=providers.directory;await mkdir(dir,{recursive:true,mode:0o700});if((await readdir(dir)).length)throw Error('RECOVERY_CHECKPOINT_MISSING');
 const {sceneDigest,create}=await writeBenchBundle(join(dir,'bundle'),providers.runtime.workerRoot,bench,plant,input.seed);
 const runId=randomUUID(),identity:BenchTraceIdentity={runId,axisIds:plant.axisIds,plantModelDigest:plant.plantModelDigest,driveModelDigest:plant.model.digest,controlProfileDigest:bench.controlProfile.digest};
 const rec=await openBenchTrace(join(dir,'trace'),identity);
 return new BenchRun(runId,dir,input,scenario,bench,plant,sceneDigest,create,identity,rec,providers);
}

class BenchRun implements ScenarioRun {
 readonly telemetry=new TelemetryRecorder(16,'bench run: no twin entities (the response is the drive trace)');
 private queue:Promise<unknown>=Promise.resolve();
 private worker?:IRSimWorkerClient;
 private st={tick:0,started:false,paused:false,cancelled:false,reclaimed:false,closed:false,revision:0,requests:0,anchor:null as number|null,outcome:null as Outcome|null,attention:[] as Attention[],
  receipts:{} as Record<string,{hash:string;view:RunView}>,engine:null as TuningResultV1['engine']|null,inertia:null as TuningResultV1['effectiveInertia']};
 private pace:PaceAnchor|null=null;
 /** the trace is ended once, by the first stop: a later close never rewrites how it ended */
 private traceEnded=false;
 private mode:Record<string,'csp'|'csv'>;
 constructor(readonly id:string,private dir:string,private input:RunManifestInput,private scenario:NonNullable<ReturnType<typeof scenarioRegistry.get>>,private bench:BenchRequestV1,private plant:BenchPlant,
  private sceneDigest:string,private create:Record<string,unknown>,private identity:BenchTraceIdentity,private rec:BenchTraceRecorder,private providers:BenchProviders){
  this.mode=Object.fromEntries(plant.model.axes.map(a=>[a.axisId,a.mode]));
 }
 private serial<T>(work:()=>Promise<T>):Promise<T>{const p=this.queue.then(work);this.queue=p.catch(()=>{});return p;}
 private live(){return !!this.worker&&!this.st.outcome&&!this.st.attention.length;}
 pulse(){return {tick:this.st.tick,paused:this.st.paused,runRevision:this.st.revision};}
 journal(){return this.serial(async()=>{if(this.st.closed)throw Error('RUN_CLOSED');return [];});}
 snapshot(){return this.serial(async()=>{if(this.st.closed)throw Error('RUN_CLOSED');return this.view();});}
 start(){return this.snapshot().then(v=>this.action({actionId:'start',expectedRevision:v.run.runRevision,kind:'start',payload:{}}));}
 action(a:unknown,beforeExecute?:()=>Promise<void>){return this.serial(()=>this.execute(a,beforeExecute));}
 holdForReclaim(){return this.serial(async()=>{
  if(this.st.closed)throw Error('RUN_CLOSED');
  if(!this.st.reclaimed){this.st.paused=true;if(this.worker){if(!this.st.outcome)this.st.attention.push({reason:'BENCH_INTERRUPTED',subjectId:'RECLAIMED',tick:this.st.tick});await this.stopWorker('RECLAIMED');}this.st.reclaimed=true;this.st.revision++;}
  return this.view();
 });}
 report(){return this.serial(()=>this.buildReport());}
 /** The trace of ticks 0..tick as read back from its chunks now (readBenchTrace: null samples for what it could not confirm), at most 2 axes × 5,010 samples; behind actions, so a step's flushed ticks are in it. */
 trace(){return this.serial(async()=>{if(this.st.closed)throw Error('RUN_CLOSED');const {traces,issues}=await readBenchTrace(this.rec.directory,this.identity,this.st.tick);return {traces,issues};});}
 async close(){await this.queue.catch(()=>{});if(this.st.closed)return;this.st.closed=true;await this.stopWorker('RUN_CLOSED');}

 private view():RunView{
  const s=this.st,status:RunView['run']['status']=s.reclaimed||s.attention.length?'needs_attention':!s.started?'ready':s.cancelled?'cancelled':s.outcome?'completed':s.paused?'paused':'running';
  return {run:{schemaVersion:2,id:this.id,mode:'simulation',access:'simulated',backendSetId:BENCH_SET_ID,backends:this.backends(),status,runRevision:s.revision,eventCursor:null,telemetryCursor:null,fidelity:'modeled',ageMs:0,
   sourceCommit:this.input.sourceCommit,scenarioId:this.scenario.id,scenarioRevision:this.scenario.revision,seed:this.input.seed},tick:s.tick,simTimeNs:String(BigInt(s.tick)*BigInt(TICK_MS)*1_000_000n),model:'mujoco_drive_bench',
   entities:[],workload:[],awaiting:[],attention:structuredClone(s.attention),served:'0',coffee:null,...s.reclaimed?{controlAccess:'view_reconcile' as const}:{}};
 }
 private backends(){return [this.plant.kind==='amr'?'mujoco_3d':'mujoco_arm'];}
 private async execute(raw:unknown,beforeExecute?:()=>Promise<void>):Promise<RunView>{
  if(this.st.closed)throw Error('RUN_CLOSED');
  const checked=validateActionV2(raw);if(!checked.ok)throw Error('INVALID_ACTION');
  const a=checked.value,s=this.st,hash=hashJson(a),old=s.receipts[a.actionId],p=a.payload as {ticks?:number;pace?:{factor:number}};
  if(old){if(old.hash!==hash)throw Error('ACTION_CONFLICT');return structuredClone(old.view);}
  if(Object.keys(s.receipts).length>=10000)throw Error('ACTION_LIMIT');
  if(a.expectedRevision!==s.revision)throw Error('REVISION_CONFLICT');
  if(s.reclaimed)throw Error('INVALID_STATE:RECLAIM_READ_ONLY');
  if(!['start','step','pause','resume','cancel'].includes(a.kind))throw Error('INVALID_STATE:BENCH_ACTION_UNSUPPORTED');
  if(a.kind==='start'&&(s.started||s.attention.length)||a.kind!=='start'&&!s.started)throw Error('INVALID_STATE');
  if(a.kind!=='start'&&!this.live())throw Error(s.outcome||s.cancelled?'INVALID_STATE:RUN_FINISHED':'INVALID_STATE:PLANT_LOST');
  if(a.kind==='pause'&&s.paused||a.kind==='resume'&&!s.paused)throw Error('INVALID_STATE');
  if(a.kind==='step'&&s.paused)throw Error('RUN_PAUSED');
  if(a.kind==='start'){
   // the one engine slot is taken before anything else, and given back when the plant never goes live
   if(activeRunCount(MUJOCO_SLOT,this.id)>=MUJOCO_MAX_ACTIVE_RUNS)throw Error('MUJOCO_CAPACITY');
   holdSlot(MUJOCO_SLOT,this.id);
   try{await beforeExecute?.();}catch(e){releaseSlot(MUJOCO_SLOT,this.id);throw e;}   // refused before anything ran: the start can be asked again
   // a plant that was spawned and did not go live is not retried: the run needs a person (no second worker for this run)
   try{await this.startPlant();}catch(e){s.attention.push({reason:'PLANT_START_FAILED',subjectId:(e as Error).message.slice(0,200),tick:s.tick});s.revision++;await this.stopWorker('START_FAILED');throw e;}
   s.started=true;
  }else{
   await beforeExecute?.();
   if(a.kind==='pause'){s.paused=true;this.pace=null;}
   else if(a.kind==='resume'){s.paused=false;this.pace=null;}
   else if(a.kind==='cancel'){s.cancelled=true;await this.stopWorker('CANCELLED');}
   else{if(!p.pace)this.pace=null;for(let i=0;i<p.ticks!;i++){if(p.pace)this.pace=await awaitTick(this.providers.wall??realWall,this.pace,s.tick,p.pace.factor);if(!await this.tick())break;}if(this.worker)await this.rec.flush().catch(e=>this.lost(`TRACE:${(e as Error).message}`));}
  }
  s.revision++;const view=this.view();s.receipts[a.actionId]={hash,view};return structuredClone(view);
 }
 private ask(op:string,payload:unknown){return this.worker!.request({protocol:'mekoniq-sim3d/1',requestId:`${op}-${++this.st.requests}`,runId:this.id,expectedTick:this.st.tick,op,payload});}
 private async startPlant(){
  const o=this.providers.runtime,spawn=this.providers.spawn??spawnMujocoWorker;
  this.worker=await spawn({python:o.python,workerRoot:o.workerRoot,runId:this.id,bundleRoot:join(this.dir,'bundle'),runDirectory:join(this.dir,'worker'),lockDigest:o.lockDigest,schemaDir:o.schemaDir,sceneDigest:this.sceneDigest,
   ...o.entry?{entry:o.entry}:{},...o.deadlinesMs?{deadlinesMs:o.deadlinesMs}:{},...o.onRequestTiming?{onRequestTiming:o.onRequestTiming}:{}});
  const refused=(op:string,r:{ok:boolean;error?:{code:string}})=>Error(`PLANT_START_FAILED:${op}:${r.error?.code??'INVALID_RESPONSE'}`);
  try{
   const d=await this.ask('describe',{});if(!d.ok)throw refused('describe',d);
   const info=d.result as {lockDigest:string;engineVersion?:string;hostArch?:'arm64'|'x86_64'};if(info.lockDigest!==o.lockDigest||info.engineVersion!==undefined&&info.engineVersion!==o.engineVersion)throw Error('PLANT_START_FAILED:MUJOCO_PROVIDER_MISMATCH');
   this.st.engine={id:this.backends()[0]!,version:o.engineVersion,...info.hostArch?{hostArch:info.hostArch}:{}};
   const c=await this.ask('create',this.create);if(!c.ok)throw refused('create',c);
   if(!await this.observe(c.result as never,0))return;   // the priming tick already ended the bench (a collision or a latched fault)
   const st=await this.ask('start',{});if(!st.ok)throw refused('start',st);
   // the readback of the bench pose (D4): the first traced axis' effective inertia
   const g=await this.ask('getState',{});if(!g.ok)throw refused('getState',g);
   const j=(g.result as {model?:{effectiveInertiaKgM2?:{axisId:string;valueKgM2:number;basis:'mass_matrix_diagonal'|'wheel_straight_line';provenance:'assumed'}[]}}).model?.effectiveInertiaKgM2?.find(x=>x.axisId===this.plant.axisIds[0]);
   this.st.inertia=j?{valueKgM2:j.valueKgM2,basis:j.basis,provenance:j.provenance}:null;
  }catch(e){throw e instanceof WorkerLostError?Error(`PLANT_START_FAILED:${e.code}`):e;}
 }
 /** A verified snapshot of `tick`: its trace into the recorder (before anything is derived from it), the anchor, a collision, a latched fault. False when the bench ended with it. */
 private async observe(snap:{tick:number;drives?:DriveAxisSnapshot[];driveTrace?:unknown;robots?:{collisionIds:string[]}[];arms?:{collisionIds:string[]}[]},tick:number):Promise<boolean>{
  const drives=snap.drives;
  if(snap.tick!==tick||!Array.isArray(drives)||drives.length!==this.plant.model.axes.length||drives.some((d,i)=>d.axisId!==this.plant.model.axes[i]!.axisId))throw Error('SNAPSHOT_INVALID');
  await this.rec.append(tick,snap.driveTrace);
  this.st.tick=tick;
  // F1: a contact the plant does not allow ends the bench as that result (collisionIds, schema-checked by the worker client, already leave out what the plant allows); a response measured
  // against a wall is no response. Before a fault of the same tick: the contact explains the fault, not the other way round
  const hit=[...new Set([...snap.robots??[],...snap.arms??[]].flatMap(x=>x.collisionIds))].sort();
  if(hit.length){await this.finish({status:'collision',collision:{tick,ids:hit}});return false;}
  const fault=drives.find(d=>d.fault!==null);
  // ruling 8: a drive that latched a fault ends the bench as that result. Any axis: a holding axis that trips moves the plant under the test, so the measurement is no longer the traced axis' alone
  if(fault){await this.finish({status:'drive_fault',fault:{tick,axisId:fault.axisId,code:fault.fault!}});return false;}
  if(this.st.anchor===null&&drives.every(d=>d.state==='enabled'))this.st.anchor=tick+1;
  const s=this.bench.signal,done=tick>=BENCH_MAX_TICKS||s.kind==='hold'&&this.st.anchor!==null&&tick>=this.st.anchor+benchSignalLastTick(s);
  if(done){await this.finish({status:'completed'});return false;}
  return true;
 }
 /** The commands of `tick`: every axis enabled; the traced ones on the bench target from the anchor on (both wheels the same), the others holding where they rest. */
 private commands(tick:number){
  const s=this.st;
  return this.plant.model.axes.map(a=>{
   const start=this.plant.start[a.axisId]!,traced=this.plant.axisIds.includes(a.axisId)&&s.anchor!==null&&tick>=s.anchor;
   return {axisId:a.axisId,seq:tick,mode:a.mode,target:traced?benchTarget(this.bench.signal,start,tick-s.anchor!,this.mode[a.axisId]):start,enable:true,quickStop:false,faultReset:false};
  });
 }
 private async tick():Promise<boolean>{
  const t=this.st.tick+1;let r;
  try{r=await this.ask('step',{targetTick:t,velocities:[],actorUpdates:[],driveCommands:this.commands(t)});}
  catch(e){await this.lost(e instanceof WorkerLostError?e.code:'WORKER_FAILED',t);return false;}
  if(!r.ok){
   // ruling 5/8: the engine's own instability is the bench's result (the worker ended the run and answered once)
   if(r.error.code==='PLANT_UNSTABLE'){await this.finish({status:'unstable',unstable:{tick:t,warning:String((r.error as {message?:string}).message||'PLANT_UNSTABLE').slice(0,200)}});return false;}
   await this.lost(`STEP_REFUSED:${r.error.code}`,t);return false;
  }
  try{return await this.observe(r.result as never,t);}catch(e){await this.lost((e as Error).message.slice(0,80),t);return false;}
 }
 private async finish(outcome:Outcome){this.st.outcome=outcome;await this.stopWorker(null);}
 /** Not a result: a lost or refused step (the tick may have been applied unseen) is a recorded gap, and the run needs a person. Nothing is resent. */
 private async lost(code:string,tick=this.st.tick+1){this.st.attention.push({reason:'WORKER_LOST',subjectId:code,tick});await this.rec.gap(tick,tick,'STEP_ACK_LOST').catch(()=>{});await this.stopWorker(code);}
 private async stopWorker(reason:string|null){
  const w=this.worker;this.worker=undefined;
  try{await w?.close(reason??'BENCH_FINISHED').catch(()=>{});}finally{releaseSlot(MUJOCO_SLOT,this.id);}
  // a result (reason null) leaves the trace complete; anything else that stops a bench (cancel, close, reclaim, a failed start, a lost step) is its terminal reason
  if(!this.traceEnded){this.traceEnded=true;await this.rec.finish(reason).catch(()=>{});}
 }
 private async tuning():Promise<{tuning:TuningResultV1|null;issues:string[]}>{
  const s=this.st;if(!s.outcome)return {tuning:null,issues:[]};
  const read=await readBenchTrace(this.rec.directory,this.identity,s.tick);
  if(!read.manifest||!read.manifestSha256||!read.manifest.chunks.length)return {tuning:null,issues:read.issues};
  const o=s.outcome,first=read.traces[0]!,mode=this.mode[this.plant.axisIds[0]!]!;
  const tuning:TuningResultV1={schemaVersion:1,documentType:'tuning-result',runId:this.id,status:o.status,unstable:o.status==='unstable'?o.unstable:null,fault:o.status==='drive_fault'?o.fault:null,
   collision:o.status==='collision'?o.collision:null,axisIds:[...this.plant.axisIds] as TuningResultV1['axisIds'],signal:structuredClone(this.bench.signal),seed:this.input.seed,
   engine:s.engine??{id:this.backends()[0]!,version:this.providers.runtime.engineVersion},
   plant:{plantModelDigest:this.plant.plantModelDigest,driveModelDigest:this.plant.model.digest,controlProfileDigest:this.bench.controlProfile.digest,load:'empty'},effectiveInertia:s.inertia,policy:{...this.plant.policy},
   metrics:benchMetrics(first,this.bench.signal,s.anchor,mode,this.plant.policy,o.status),
   trace:{chunks:read.manifest.chunks.length,sha256:read.manifestSha256,samples:first.samples.slice(BENCH_TRACE_LIMITS.substeps).filter(x=>x!==null).length},accepted:false};
  if(!validateControlEvidenceShape(tuning))throw Error('TUNING_RESULT_INVALID');
  return {tuning,issues:read.issues};
 }
 private async buildReport():Promise<RunReport&{tuning:TuningResultV1|null;bench:{request:Omit<BenchRequestV1,'controlProfile'>&{controlProfile:{id:string;revision:number;digest:string}};anchorTick:number|null;sceneDigest:string;traceIssues:string[]}}>{
  if(this.st.closed)throw Error('RUN_CLOSED');
  const s=this.st,v=this.view(),{tuning,issues}=await this.tuning(),o=this.providers.runtime,backends=[{id:this.backends()[0]!,version:o.engineVersion,model:'mujoco_drive_bench',dynamics:true}];
  const {controlProfile:cp,...request}=this.bench,fixture=this.plant.kind==='amr'?'serve-payload-v1':'xarm6-g2-v1';
  return {schemaVersion:2,
   manifest:{runId:this.id,sourceCommit:this.input.sourceCommit,mode:'simulation',access:'simulated',backendSetId:BENCH_SET_ID,backends,prng:{...PRNG},clock:{tickMs:TICK_MS},seed:this.input.seed,
    scenario:{id:this.scenario.id,revision:this.scenario.revision,hash:scenarioHash(this.scenario)},
    // a bench has no project: its world is the scene the server built from the fixture
    project:{id:`bench:${fixture}`,revision:1,hash:this.sceneDigest},world:{id:fixture,revision:1,hash:this.sceneDigest},assets:[],hashAlgorithm:'sha256-canonical-json-v1',designHash:hashJson(this.bench),
    adapterHash:hashJson({sourceCommit:this.input.sourceCommit,backends,workerLockDigest:o.lockDigest,sceneDigest:this.sceneDigest}),configuration:{revision:1,hash:hashJson({signal:this.bench.signal,axisIds:this.plant.axisIds,start:this.plant.start,maxTicks:BENCH_MAX_TICKS})},recipes:[],
    models:[{id:'mujoco_3d',revision:o.engineVersion,hash:this.sceneDigest,provenance:'simulated_plant'},{id:this.plant.model.id,revision:String(this.plant.model.revision),hash:this.plant.model.digest,provenance:'assumed'}],
    profiles:[{id:cp.id,revision:cp.revision,hash:cp.digest,provenance:'draft'}],calibration:{status:'not_calibrated',revision:null,hash:null,reason:'SIMULATED_PLANT'}},
   outcome:{status:v.run.status,served:'0',tick:s.tick,simTimeNs:v.simTimeNs},attention:v.attention,workload:[],entities:[],businessEvents:[],effects:[],
   metrics:{maxConcurrentMovers:0,distanceM:{},collision:{available:false,reason:'BENCH_RUN',contacts:null,minSeparationM:null}},rejectedObservations:[],reconciliations:[],recoveredOps:[],confirmations:[],faults:[],
   coverage:{businessSimulation:false,kinematicModel:true,dynamics:true,nativeExecution:false,physicalStop:false,sensorEvidence:false,eventStream:true},
   limitations:['Bench run (R4.2): no mission, journal or custody; the response is computed on the TRUE state of the 500 Hz trace as read back from its immutable chunks (basis actual).',
    'MuJoCo 3.17.0 with a virtual drive: every drive, gain and plant value is assumed, not_calibrated.','A drive fault, engine instability or a contact the plant does not allow ends the bench as that result: no gain is lowered and nothing is run again by itself.'],
   telemetry:this.telemetry.report(),tuning,bench:{request:{...request,controlProfile:{id:cp.id,revision:cp.revision,digest:cp.digest}},anchorTick:s.anchor,sceneDigest:this.sceneDigest,traceIssues:issues}};
 }
}
