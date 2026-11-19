/** The controller-in-the-loop campaign `cil-v1` (R4.1): MJ-FD01 on the five registered drive experiments x 3 seeds, three repeats of one seed, and the shared-world cell with the nominal
 * drive on 3 seeds and the five R2b fault cases. Every run keeps its own artifacts; verification re-reads them (evidence readers, the bundle's own documents, the retained command
 * trace) and never trusts the report's numbers: it recomputes the drive section from the verified physics stream and compares. Pass-all of the suite is not a substitute for a run's artifact. */
import {createHash} from 'node:crypto';
import {lstat,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import campaign from '../../../../../robotics/simulation-mujoco/campaigns/cil-v1.json';
import {createEngineeringService,type LockedEngineering} from '../../engineering/gateway';
import {createMujocoCompiler} from '../../engineering/mujoco-compiler';
import {lockDigestOf} from '../../engineering/linkforge';
import type {EngineeringProject} from '../../engineering/contracts';
import {createFixedStepScenarioRun} from '../navigation2d/runner';
import {defaultCatalog} from '../capabilities';
import {mujocoMobilePlant} from '../simulation3d/mujoco-mobile';
import {preparePhysicsAdmission,readPhysicsEvidence,readPhysicsManifest} from '../simulation3d/physics-evidence';
import {cellArtifacts,runCellCampaign,verifyCellCampaign,CELL_CASES} from '../simulation3d/cell-campaign';
import {validateNavigationDocument,type NavigationSceneV1} from '../navigation2d/contracts';
import {hashJson} from '../hash';
import type {RunReport} from '../report';
import {experimentOfMobileModel,type DriveExperimentId} from './drive-experiments';
import {buildDriveEvidence} from './drive-report';
import {diffDriveBaseV1} from './diff-drive-base';
import {BASE_CONTROLLER_DEFAULTS,wheelVelocityResolutionRadS,type HostArch} from './drive-run';
import {splitDriveSnapshot} from './drive-io';
import type {ControllerEvent} from './controller';
import {readRetainedWorldAdmission} from '../simulation3d/world-arm-report';
import {readWorldEvidence} from '../simulation3d/world-evidence';
import type {DriveAxisSnapshot,DriveCommandV1,DriveModelV1} from './drive-io';

export interface CilCampaignVerdict {expectedRuns:number;completedCases:number;missingArtifacts:string[];issues:string[];equivalence:{id:string;bitIdentical:boolean}[];faultCases:{id:string;detected:boolean;falseServed:boolean}[]}
export const CIL_CAMPAIGN=campaign;
type Oracle=(typeof campaign.oracles.mobile)[keyof typeof campaign.oracles.mobile];
export interface CilCase {id:string;kind:'mobile'|'repeat'|'cell';experimentId:DriveExperimentId;seed:number;repeat?:number;cellCase?:string}
const experiments=campaign.experiments as DriveExperimentId[];
export const CIL_CASES:CilCase[]=[
 ...experiments.flatMap(e=>campaign.seeds.map(seed=>({id:`fd01-${e}-s${seed}`,kind:'mobile' as const,experimentId:e,seed}))),
 ...Array.from({length:campaign.repeats.count},(_,i)=>({id:`repeat-${campaign.repeats.experimentId.replace(/^drive-|-v1$/g,'')}-s${campaign.repeats.seed}-r${i+1}`,kind:'repeat' as const,experimentId:campaign.repeats.experimentId as DriveExperimentId,seed:campaign.repeats.seed,repeat:i+1})),
 ...CELL_CASES.map(c=>({id:`cell-${c.id}`,kind:'cell' as const,experimentId:campaign.cell.driveExperimentId as DriveExperimentId,seed:c.seed,cellCase:c.id})),
];
const SET=campaign.backendSetId,OWNER='cil-campaign';
/** The architecture of the recording machine (Node's own: the same machine runs the worker; a worker that reports another one is a mismatch the verifier names). */
export const recordingHostArch=():HostArch=>process.arch==='arm64'?'arm64':'x86_64';
const sha=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
const json=(v:unknown)=>JSON.stringify(v,null,2)+'\n';
const BASE_ID=`fd01-drive-nominal-v1-s${campaign.repeats.seed}`;
interface Trace {spawns:number;steps:{tick:number;velocities:number;driveCommands:DriveCommandV1[]}[];error:string|null}

async function readJson(root:string,path:string,max=64*1024*1024){
 if(!/^[\w.-]+(?:\/[\w.-]+)*$/.test(path)||path.split('/').some(p=>p==='..'||p==='.'))throw Error('CIL_ARTIFACT_PATH');
 let cur=root;for(const part of path.split('/')){cur=join(cur,part);if((await lstat(cur)).isSymbolicLink())throw Error('CIL_ARTIFACT_PATH');}
 const st=await lstat(cur);if(!st.isFile()||st.size>max)throw Error('CIL_ARTIFACT_LIMIT');return JSON.parse(await readFile(cur,'utf8'));
}

async function setupMobile(o:{root:string;out:string}){
 const workerRoot=join(o.root,'robotics/simulation-mujoco'),fixture=join(workerRoot,'fixtures/serve-payload-v1'),catalogRoot=join(o.out,'catalog');
 const c=JSON.parse(await readFile(join(fixture,'serve-3d-components.json'),'utf8')) as {components:Record<string,unknown>;models:Record<string,unknown>};
 for(const dir of ['components','models','documents'])await mkdir(join(catalogRoot,dir),{recursive:true});
 for(const [id,doc] of Object.entries(c.components))await writeFile(join(catalogRoot,'components',id+'.json'),json(doc));
 for(const [id,doc] of Object.entries(c.models))await writeFile(join(catalogRoot,'models',id+'.json'),json(doc));
 await writeFile(join(catalogRoot,'catalog.json'),json({schemaVersion:1,id:'cil-v1',components:Object.keys(c.components).map(digest=>({digest,file:`components/${digest}.json`})),quotes:[]}));
 const service=createEngineeringService({directory:join(o.out,'engineering'),catalogRoot,compiler:{version:'refused',runnable:()=>false,async compileResolved(){throw new Error('NATIVE_DISABLED');}},compilers:{[SET]:createMujocoCompiler({workerRoot})}});
 const compiled=new Map<string,{locked:LockedEngineering;scene:NavigationSceneV1}>();
 for(const experiment of [null,...experiments]){
  const project:EngineeringProject={...JSON.parse(await readFile(join(fixture,'serve-3d-project.json'),'utf8')),requestedProfile:SET,...experiment?{driveExperimentId:experiment}:{}};
  const receipt=await service.compileEngineeringProject(project,OWNER);if(receipt.state!=='compiled')throw new Error(`CIL_COMPILE_FAILED:${JSON.stringify(receipt.problems)}`);
  const locked=await service.admitRun(OWNER,{bundleDigest:receipt.bundleDigest,projectDigest:receipt.projectDigest},SET,undefined);
  const scene=JSON.parse(Buffer.from(await service.bundleFile(receipt.bundleDigest!,'navigation-scene.json')).toString()) as NavigationSceneV1;
  compiled.set(experiment??'legacy',{locked,scene});
 }
 return {service,compiled,workerRoot};
}

/** One MJ-FD01 run into `dir`: its bundle, its run directory, its report and the commands it sent. */
async function runMobile(c:{service:Awaited<ReturnType<typeof setupMobile>>['service'];compiled:Awaited<ReturnType<typeof setupMobile>>['compiled'];runtime:Parameters<typeof mujocoMobilePlant>[0];catalog:typeof defaultCatalog;sourceCommit:string;signal?:AbortSignal},dir:string,experiment:string,seed:number){
 const {locked,scene}=c.compiled.get(experiment)!;await mkdir(dir,{recursive:true});
 const bundle=join(dir,'bundle');for(const path of ['navigation-scene.json',...scene.files.map(f=>f.path)]){await mkdir(join(bundle,path,'..'),{recursive:true});await writeFile(join(bundle,path),await c.service.bundleFile(locked.ref.bundleDigest,path));}
 const trace:Trace={spawns:0,steps:[],error:null},plant=mujocoMobilePlant(c.runtime),spawn=plant.spawn;
 plant.spawn=async o=>{trace.spawns++;const w=await spawn(o);return {...w,async request(req){if(req.op==='step'){const p=req.payload as {targetTick:number;velocities:unknown[];driveCommands?:DriveCommandV1[]};trace.steps.push({tick:p.targetTick,velocities:p.velocities.length,driveCommands:structuredClone(p.driveCommands??[])});}return w.request(req);}};};
 const run=await createFixedStepScenarioRun({project:locked.runtimeProjection.project,scenarioId:campaign.scenarioId,scenarioRevision:1,seed,mode:'simulation',access:'simulated',backendSetId:SET,sourceCommit:c.sourceCommit,engineering:locked},
  {directory:join(dir,'run'),catalog:c.catalog,enabledBackends:['mujoco_3d'],bundleFile:(d,p)=>c.service.bundleFile(d,p),plant,runtime:c.runtime});
 let n=0,report:RunReport|undefined;
 try{
  await run.start();let v=await run.snapshot();
  while(['running','awaiting_confirmation'].includes(v.run.status)&&v.tick<campaign.maxTicks){c.signal?.throwIfAborted();const before=v.tick;v=await run.action({actionId:`cil-${++n}`,expectedRevision:v.run.runRevision,kind:'step',payload:{ticks:250}});if(v.tick===before&&v.run.status==='running')break;}
  report=await run.report();
 }catch(e){trace.error=String(e);throw e;}finally{await run.close();await writeFile(join(dir,'trace.json'),json(trace));if(report)await writeFile(join(dir,'report.json'),json(report));}
 return report;
}

export async function runCilCampaign(o:{root:string;out:string;sourceCommit:string;python?:string;caseId?:string;signal?:AbortSignal}):Promise<CilCampaignVerdict>{
 o.signal?.throwIfAborted();
 if(!/^[a-f0-9]{40}$/.test(o.sourceCommit))throw Error('CIL_SOURCE_COMMIT_REQUIRED');
 if(o.caseId&&!CIL_CASES.some(c=>c.id===o.caseId))throw Error('CAMPAIGN_CASE_UNREGISTERED');
 await mkdir(o.out);await writeFile(join(o.out,'campaign.json'),json({campaign,sourceCommit:o.sourceCommit,hostArch:recordingHostArch(),accepted:false,execution:'actual_mujoco',calibration:'not_calibrated'}));
 const wanted=CIL_CASES.filter(c=>!o.caseId||c.id===o.caseId),mobile=wanted.filter(c=>c.kind!=='cell');
 if(mobile.length){
  const {service,compiled,workerRoot}=await setupMobile(o),runtime={python:o.python??join(o.root,'.venv-mujoco/bin/python'),workerRoot,schemaDir:join(o.root,'packages/contracts/schemas'),lockDigest:await lockDigestOf(join(workerRoot,'requirements.lock')),engineVersion:'3.17.0',maxActiveRuns:1};
  const catalog={...defaultCatalog,backends:defaultCatalog.backends.map(b=>b.id==='mujoco_3d'?{...b,installed:true,compatible:true,reachable:true}:b)},ctx={service,compiled,runtime,catalog,sourceCommit:o.sourceCommit,signal:o.signal};
  for(const spec of mobile){
   const dir=join(o.out,spec.id);let error:string|null=null;
   try{
    await runMobile(ctx,join(dir),spec.experimentId,spec.seed);
    // the ideal drive is compared with the same mission on the legacy path, in the same case directory
    if(spec.experimentId==='drive-ideal-v1')await runMobile(ctx,join(dir,'baseline'),'legacy',spec.seed);
   }catch(e){error=String((e as Error).stack??e);await mkdir(dir,{recursive:true});await writeFile(join(dir,'error.txt'),error);}
   await writeFile(join(dir,'case.json'),json({schemaVersion:1,case:spec,sourceCommit:o.sourceCommit,accepted:false,execution:'actual_mujoco',engineVersion:'3.17.0',error,artifacts:await cellArtifacts(dir)}));
   if(o.signal?.aborted)break;
  }
 }
 if(wanted.some(c=>c.kind==='cell')&&!o.signal?.aborted){
  const only=o.caseId?CIL_CASES.find(c=>c.id===o.caseId)!.cellCase:undefined;
  await runCellCampaign({root:o.root,out:join(o.out,'cell'),sourceCommit:o.sourceCommit,...o.python?{python:o.python}:{},...only?{caseId:only}:{},driveExperimentId:campaign.cell.driveExperimentId as DriveExperimentId,...o.signal?{signal:o.signal}:{}});
 }
 const verdict=await verifyCilCampaign(o.out,o.caseId);await writeFile(join(o.out,'summary.json'),json({accepted:false,...verdict}));return verdict;
}

/** The records of a physics evidence directory, read with the admission of the bundle that run used. */
async function readStream(dir:string){
 const scene=JSON.parse(await readFile(join(dir,'bundle/navigation-scene.json'),'utf8')) as NavigationSceneV1;
 const valid=validateNavigationDocument(scene);if(!valid.ok)throw Error('CIL_SCENE_INVALID');
 const prepared=await preparePhysicsAdmission(scene,async p=>readFile(join(dir,'bundle',p))),physicsDir=join(dir,'run/physics'),manifest=await readPhysicsManifest(physicsDir);
 const read=await readPhysicsEvidence(physicsDir,manifest,{admission:prepared.admission,metricsPolicyDigest:prepared.metricsPolicyDigest});
 return {scene,read,prepared};
}
type Rec=Record<string,unknown>&{tick:number;drives?:DriveAxisSnapshot[]};
const strip=(r:Rec)=>{const {drives:_d,...rest}=r;void _d;return rest;};

/** The controller's own events, recomputed: diff-drive-base-v1 is pure, and its events depend only on the feedback of the recorded stream and on the wheel commands it had sent (the targets of
 * the state are those the trace retained; the setpoint only moves the targets, which are overridden). The report's events are compared with this, never trusted. */
function replayBaseEvents(model:DriveModelV1,scene:NavigationSceneV1,records:readonly Rec[],steps:Trace['steps']):ControllerEvent[]{
 const robot=scene.robots[0]!,k=robot.model.kinematics,left=`${robot.robotId}/wheel-left`,right=`${robot.robotId}/wheel-right`;
 const sent=new Map(steps.map(s=>[s.tick,s.driveCommands]));
 let state=diffDriveBaseV1.init({axisLeft:left,axisRight:right,wheelRadiusM:k.wheelRadiusM,wheelSeparationM:k.wheelSeparationM,maxWheelAccelRadS2:1e9,...BASE_CONTROLLER_DEFAULTS,velocityResolutionRadS:wheelVelocityResolutionRadS(model,robot.robotId)});
 const events:ControllerEvent[]=[];
 for(const r of records){
  const prior=sent.get(r.tick),targets:[number,number]=prior?[prior.find(c=>c.axisId===left)?.target??0,prior.find(c=>c.axisId===right)?.target??0]:[0,0];
  const out=diffDriveBaseV1.step({...state,targets},{tick:r.tick,setpoint:{vMps:0,omegaRadps:0},feedback:splitDriveSnapshot(r.drives??[]).feedback});
  state=out.state;events.push(...out.events);
 }
 return events;
}

export async function verifyCilCampaign(root:string,onlyCase?:string):Promise<CilCampaignVerdict>{
 const selected=CIL_CASES.filter(c=>!onlyCase||c.id===onlyCase);
 const v:CilCampaignVerdict={expectedRuns:selected.length,completedCases:0,missingArtifacts:[],issues:[],equivalence:[],faultCases:[]};let source:string|undefined,host:string|undefined;
 try{const c=await readJson(root,'campaign.json');if(c.accepted!==false||c.execution!=='actual_mujoco'||c.calibration!=='not_calibrated'||hashJson(c.campaign)!==hashJson(campaign)||!/^[a-f0-9]{40}$/.test(c.sourceCommit)||!['arm64','x86_64'].includes(c.hostArch))throw Error();source=c.sourceCommit;host=c.hostArch;}catch{v.issues.push('CIL_CAMPAIGN_IDENTITY');}
 const streams=new Map<string,Rec[]>();
 const nominalMemo=new Map<number,Promise<NonNullable<ReturnType<typeof buildDriveEvidence>['axes'][number]['speedDeficit']>[]>>();
 const nominalDeficits=(seed:number)=>{
  if(!nominalMemo.has(seed))nominalMemo.set(seed,(async()=>{const dir=join(root,`fd01-drive-nominal-v1-s${seed}`),{scene,read}=await readStream(dir),e=scene.engine as {driveModelRef:{path:string}};
   const model=JSON.parse(await readFile(join(dir,'bundle',e.driveModelRef.path),'utf8')) as DriveModelV1;
   return buildDriveEvidence(model,(read.records as unknown as Rec[]).map(r=>({tick:r.tick,drives:r.drives??[]})),{complete:read.complete,issues:[],events:[]}).axes.map(a=>a.speedDeficit!);})());
  return nominalMemo.get(seed)!;
 };
 for(const spec of selected.filter(c=>c.kind!=='cell')){
  const dir=join(root,spec.id),check=(ok:unknown,code:string)=>{if(!ok)throw Error(code);};
  try{
   const rec=await readJson(dir,'case.json');check(rec.schemaVersion===1&&rec.accepted===false&&rec.execution==='actual_mujoco'&&rec.sourceCommit===source&&hashJson(rec.case)===hashJson(spec)&&rec.error===null,'CIL_CASE_IDENTITY');
   check(hashJson(await cellArtifacts(dir))===hashJson(rec.artifacts),'CIL_ARTIFACT_INVENTORY');
   const report=await readJson(dir,'report.json') as RunReport,cp=await readJson(dir,'run/run.json'),trace=await readJson(dir,'trace.json') as Trace;
   check(cp.manifest.seed===spec.seed&&cp.manifest.sourceCommit===source&&cp.runId===report.manifest.runId&&cp.tick===report.outcome.tick&&trace.spawns===1&&!trace.error,'CIL_RUN_IDENTITY');
   // the scene the run used names exactly the registered experiment, and the manifest carries the digests of those very documents
   const {scene,read}=await readStream(dir);const e=scene.engine as {driveModelRef?:{path:string;sha256:string};controlProfileRef?:{path:string;sha256:string}};
   check(experimentOfMobileModel(e.driveModelRef?.path??'')===spec.experimentId,'CIL_EXPERIMENT_MISMATCH');
   const model=JSON.parse(await readFile(join(dir,'bundle',e.driveModelRef!.path),'utf8')) as DriveModelV1,control=JSON.parse(await readFile(join(dir,'bundle',e.controlProfileRef!.path),'utf8')) as {digest:string};
   check(sha(await readFile(join(dir,'bundle',e.driveModelRef!.path)))===e.driveModelRef!.sha256&&report.manifest.drive?.driveModelDigest===model.digest&&report.manifest.drive.controlProfileDigest===control.digest&&report.manifest.drive.testLevel==='controller_in_the_loop'&&report.manifest.drive.experimentId===spec.experimentId,'CIL_MANIFEST_DRIVE');
   check(read.complete&&read.records.length===cp.tick+1,'CIL_PHYSICS_COVERAGE:'+read.issues.join(','));
   const records=read.records as unknown as Rec[];streams.set(spec.id,records);
   // the report's drive section is recomputed from the verified stream and must equal what the report says
   // the architecture the worker reported is recorded and is the campaign's: bit identity is meaningful inside one (contracts §1)
   check(report.manifest.drive?.hostArch&&report.manifest.drive.hostArch===host,'CIL_HOSTARCH:'+String(report.manifest.drive?.hostArch));
   // the controller's events are recomputed from the stream and the retained commands; the whole section must equal what the report says
   const again=buildDriveEvidence(model,records.map(r=>({tick:r.tick,drives:r.drives??[]})),{complete:read.complete,issues:read.issues,events:replayBaseEvents(model,scene,records,trace.steps)});
   check(hashJson(again as never)===hashJson(report.driveEvidence as never),'CIL_DRIVE_REPORT_NOT_FROM_STREAM');
   // commands: every tick had commands for every axis, none asked for a faultReset, the wire carried no velocity
   check(trace.steps.length>=cp.tick&&trace.steps.every(s=>s.velocities===0&&s.driveCommands.length===model.axes.length&&s.driveCommands.every(c=>!c.faultReset)),'CIL_COMMAND_TRACE');
   const oracle=(spec.kind==='repeat'?campaign.oracles.mobile['drive-nominal-v1']:campaign.oracles.mobile[spec.experimentId as keyof typeof campaign.oracles.mobile]) as Oracle&Record<string,unknown>;
   const out=report.outcome;check((oracle.status as string[]).includes(out.status),'CIL_OUTCOME_STATUS:'+out.status);
   const falseServed=out.served!=='0'&&(out.status!=='completed'||report.attention.length>0);check(!falseServed,'CIL_FALSE_SERVED');
   if('served' in oracle)check(out.served===oracle.served,'CIL_SERVED:'+out.served);
   const faults=again.axes.flatMap(a=>a.faults.map(f=>f.fault)),events=again.events.map(x=>x.code);
   if('faults' in oracle)check(JSON.stringify(faults)===JSON.stringify(oracle.faults),'CIL_FAULTS:'+faults.join(','));
   if('events' in oracle)check(JSON.stringify(events)===JSON.stringify(oracle.events),'CIL_EVENTS:'+events.join(','));
   const wheel=again.axes[0]!,motion=records.findIndex(r=>r.drives!.some(d=>Math.abs(d.actualVelocityRadS)>0.01));
   if('enabledAtTick' in oracle)check(wheel.enabledAtTick===oracle.enabledAtTick,'CIL_ENABLE_TICK:'+wheel.enabledAtTick);
   if('enableSequence' in oracle)check(wheel.states.map(s=>s.state).join().startsWith('disabled,ready,enabled')&&wheel.enabledAtTick!==null&&wheel.enabledAtTick>0&&(motion<0||motion>=wheel.enabledAtTick),'CIL_ENABLE_SEQUENCE');
   if('speedDeficitAtLeastTimesNominal' in oracle){
    // CIL03: the torque limit must be observable, not just recorded: the deficit is at least the declared multiple of the nominal run's of the same seed, on every wheel
    const nominal=await nominalDeficits(spec.seed),factor=oracle.speedDeficitAtLeastTimesNominal as number;
    check(again.axes.every((a,i)=>a.speedDeficit?.available&&nominal[i]?.available&&a.speedDeficit.value>=factor*nominal[i]!.value),'CIL_TORQUE_LIMIT_NOT_OBSERVED:'+again.axes.map((a,i)=>`${a.speedDeficit?.available?a.speedDeficit.value.toFixed(3):'n/a'}/${nominal[i]?.available?nominal[i]!.value.toFixed(3):'n/a'}`).join(','));
   }
   if('speedDeficitRecorded' in oracle)check(again.axes.every(a=>a.speedDeficit?.available===true),'CIL_SPEED_DEFICIT_NOT_MEASURED');
   if('trackingRmsRecorded' in oracle)check(again.axes.every(a=>a.trackingRms.available),'CIL_TRACKING_NOT_MEASURED');
   if('equivalentToLegacy' in oracle){
    const base=await readStream(join(dir,'baseline')),legacy=base.read.records as unknown as Rec[];
    check(base.read.complete&&base.scene.engine.id==='mujoco_3d'&&!(base.scene.engine as {driveModelRef?:unknown}).driveModelRef,'CIL_BASELINE_NOT_LEGACY');
    // same mission, same seed: the physics of the ideal drive equals the physics of the legacy path tick for tick, byte for byte
    const same=legacy.length===records.length&&records.every((r,i)=>JSON.stringify(strip(r))===JSON.stringify(strip(legacy[i]!)));
    v.equivalence.push({id:`ideal-vs-legacy-s${spec.seed}`,bitIdentical:same});check(same,`CIL_IDEAL_NOT_LEGACY:s${spec.seed}`);
   }
   v.completedCases++;
  }catch(e){v.missingArtifacts.push(spec.id);v.issues.push(`${spec.id}:${(e as Error).message}`);}
 }
 // the three repeats of one seed equal the first run of it, drives included
 const base=streams.get(BASE_ID);
 if(!onlyCase||selected.some(c=>c.kind==='repeat')){
  const repeats=selected.filter(c=>c.kind==='repeat').map(c=>streams.get(c.id));
  if(base&&repeats.length&&repeats.every(Boolean)){const same=repeats.every(r=>r!.length===base.length&&r!.every((x,i)=>JSON.stringify(x)===JSON.stringify(base[i])));v.equivalence.push({id:`repeat-nominal-s${campaign.repeats.seed}`,bitIdentical:same});if(!same)v.issues.push('CIL_REPEAT_NOT_BIT_IDENTICAL');}
  else if(!onlyCase)v.issues.push('CIL_REPEAT_BASE_MISSING');
 }
 // the cell part: the cell campaign's own verifier, then the drive facts of each run
 const cells=selected.filter(c=>c.kind==='cell');
 if(cells.length){
  try{
   const cv=await verifyCellCampaign(join(root,'cell')),failed=new Set(cv.missingArtifacts),cellCampaign=await readJson(join(root,'cell'),'campaign.json').catch(()=>({}));
   const cellCommit=cellCampaign.sourceCommit,cellExperiment=cellCampaign.driveExperimentId,cellHost=cellCampaign.hostArch;
   for(const c of cells){
    const id=c.cellCase!,check=(ok:unknown,code:string)=>{if(!ok)throw Error(code);};
    try{
     check(!failed.has(id),'CELL_VERIFY:'+cv.issues.filter(i=>i.startsWith(id+':')).join(';'));
     const dir=join(root,'cell',id),report=await readJson(dir,'report.json') as RunReport,cp=await readJson(dir,'run/run.json');
     // the cell campaign is the one this campaign recorded (same commit, same experiment, same architecture), and the run is the one the report is of
     check(cellCommit===source&&cellExperiment===campaign.cell.driveExperimentId&&cellHost===host,'CIL_CELL_CAMPAIGN_BINDING');
     check(report.manifest.sourceCommit===source&&cp.manifest.sourceCommit===source&&cp.runId===report.manifest.runId,'CIL_CELL_RUN_BINDING');
     check(report.manifest.drive?.testLevel==='controller_in_the_loop'&&report.manifest.drive.experimentId===campaign.cell.driveExperimentId,'CIL_CELL_MANIFEST_DRIVE');
     check(report.manifest.drive?.hostArch&&report.manifest.drive.hostArch===host,'CIL_HOSTARCH:'+String(report.manifest.drive?.hostArch));
     // the drive section is recomputed from the world evidence stream: states, faults, enable ticks, saturation and every metric must equal the report's (the events are the controllers' own: tick and axis in range)
     const admission=await readRetainedWorldAdmission(join(dir,'run'),cp.world.snapshot.sceneDigest),world=await readWorldEvidence(join(dir,'run/world-evidence'),admission);
     const rows=world.records.filter(r=>r.snapshot.drives).map(r=>({tick:r.snapshot.tick,drives:r.snapshot.drives!})),first=rows[0]?.drives??[];
     check(rows.length===world.records.length&&first.length===9&&report.driveEvidence?.axes.length===9,'CIL_CELL_DRIVE_SECTION');
     const axes=first.map(d=>({axisId:d.axisId,mode:/\/wheel-(left|right)$/.test(d.axisId)?'csv' as const:'csp' as const}));
     const again=buildDriveEvidence({axes} as Pick<DriveModelV1,'axes'>,rows,{complete:report.driveEvidence!.complete,issues:report.driveEvidence!.issues,events:[]});
     check(hashJson(again.axes as never)===hashJson(report.driveEvidence!.axes as never)&&again.ticks===report.driveEvidence!.ticks,'CIL_CELL_DRIVE_NOT_FROM_STREAM');
     check(report.driveEvidence!.events.every(e=>Number.isInteger(e.tick)&&e.tick>=0&&e.tick<=cp.tick&&(!e.axisId||first.some(d=>d.axisId===e.axisId))),'CIL_CELL_EVENTS');
     if(id.startsWith('nominal'))check(report.outcome.served==='2'&&report.driveEvidence!.axes.every(a=>a.faults.length===0),'CIL_CELL_NOMINAL');
     else{const falseServed=report.outcome.served!=='0';v.faultCases.push({id,detected:true,falseServed});check(!falseServed,'CIL_CELL_FALSE_SERVED');}
     v.completedCases++;
    }catch(e){v.missingArtifacts.push(`cell-${id}`);v.issues.push(`cell-${id}:${(e as Error).message}`);if(!id.startsWith('nominal'))v.faultCases.push({id,detected:false,falseServed:false});}
   }
  }catch(e){for(const c of cells){v.missingArtifacts.push(c.id);}v.issues.push('CIL_CELL_CAMPAIGN:'+(e as Error).message);}
 }
 return v;
}
