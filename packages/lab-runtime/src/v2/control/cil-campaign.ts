/** Five mobile experiments, three seeds, same-profile repeats, and eight shared-world cell cases.
 * The immutable cil-v1 table remains readable with its original nominal-only repeat scope. */
import {createHash} from 'node:crypto';
import {lstat,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import historicalCampaign from '../../../../../robotics/simulation-mujoco/campaigns/cil-v1.json';
import campaign from '../../../../../robotics/simulation-mujoco/campaigns/cil-v2.json';
import {readNavigationEvidence} from '../navigation2d/evidence';
import {readCampaignJournal,verifyCampaignOutcome} from './campaign-source-evidence';
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
import {experimentOfMobileModel,mobileDriveBundle,type DriveExperimentId} from './drive-experiments';
import {buildDriveEvidence} from './drive-report';
import {driveManifest,mobileDrive,replayMobileCommands,type HostArch} from './drive-run';
import type {ControlProfileV1,DriveAxisSnapshot,DriveCommandV1,DriveModelV1} from './drive-io';

export interface CilCampaignVerdict {expectedRuns:number;completedCases:number;missingArtifacts:string[];issues:string[];equivalence:{id:string;bitIdentical:boolean}[];faultCases:{id:string;detected:boolean;falseServed:boolean}[]}
export const CIL_CAMPAIGN=campaign;
type Oracle=(typeof campaign.oracles.mobile)[keyof typeof campaign.oracles.mobile];
export interface CilCase {id:string;kind:'mobile'|'repeat'|'cell';experimentId:DriveExperimentId;seed:number;repeat?:number;cellCase?:string}
const experiments=campaign.experiments as DriveExperimentId[];
type Registry=typeof campaign|typeof historicalCampaign;
function casesFor(table:Registry):CilCase[]{
 const repeatIds='experimentIds' in table.repeats?table.repeats.experimentIds:[table.repeats.experimentId];
 return [
 ...(table.experiments as DriveExperimentId[]).flatMap(e=>table.seeds.map(seed=>({id:`fd01-${e}-s${seed}`,kind:'mobile' as const,experimentId:e,seed}))),
 ...repeatIds.flatMap(e=>Array.from({length:table.repeats.count},(_,i)=>({id:`repeat-${e.replace(/^drive-|-v1$/g,'')}-s${table.repeats.seed}-r${i+1}`,kind:'repeat' as const,experimentId:e as DriveExperimentId,seed:table.repeats.seed,repeat:i+1}))),
 ...CELL_CASES.map(c=>({id:`cell-${c.id}`,kind:'cell' as const,experimentId:table.cell.driveExperimentId as DriveExperimentId,seed:c.seed,cellCase:c.id})),
 ];
}
export const CIL_CASES=casesFor(campaign);
const workerRoot=fileURLToPath(new URL('../../../../../robotics/simulation-mujoco/',import.meta.url));
const baseline=(spec:CilCase)=>`fd01-${spec.experimentId}-s${spec.seed}`;
function dependencies(spec:CilCase){
 const ids:string[]=[];
 if(spec.experimentId==='drive-torque-limited-v1')ids.push(`fd01-drive-nominal-v1-s${spec.seed}`);
 if(spec.kind==='repeat')ids.push(baseline(spec));
 return ids;
}
function withDependencies(selected:CilCase[],table:CilCase[]){
 const needed=new Set(selected.flatMap(c=>[c.id,...dependencies(c)]));
 return table.filter(c=>needed.has(c.id));
}
const SET=campaign.backendSetId,OWNER='cil-campaign';
/** The architecture of the recording machine (Node's own: the same machine runs the worker; a worker that reports another one is a mismatch the verifier names). */
export const recordingHostArch=():HostArch=>process.arch==='arm64'?'arm64':'x86_64';

const json=(v:unknown)=>JSON.stringify(v,null,2)+'\n';

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
 await writeFile(join(catalogRoot,'catalog.json'),json({schemaVersion:1,id:campaign.id,components:Object.keys(c.components).map(digest=>({digest,file:`components/${digest}.json`})),quotes:[]}));
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
 const wanted=CIL_CASES.filter(c=>!o.caseId||c.id===o.caseId),mobile=withDependencies(wanted,CIL_CASES).filter(c=>c.kind!=='cell');
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
async function readStream(dir:string,cp:{runId:string;plant:{snapshot:{bootId:string}};tick:number}){
 const scene=JSON.parse(await readFile(join(dir,'bundle/navigation-scene.json'),'utf8')) as NavigationSceneV1;
 const valid=validateNavigationDocument(scene);if(!valid.ok)throw Error('CIL_SCENE_INVALID');
 const prepared=await preparePhysicsAdmission(scene,async p=>readFile(join(dir,'bundle',p))),physicsDir=join(dir,'run/physics'),manifest=await readPhysicsManifest(physicsDir);
 const read=await readPhysicsEvidence(physicsDir,manifest,{admission:prepared.admission,metricsPolicyDigest:prepared.metricsPolicyDigest,identity:{runId:cp.runId,bootId:cp.plant.snapshot.bootId,sceneDigest:scene.sceneDigest,loadProfileDigest:prepared.loadProfileDigest,physicsProfileDigest:prepared.physicsProfileDigest},runTick:cp.tick});
 return {scene,read,prepared};
}
type Rec=Record<string,unknown>&{tick:number;drives?:DriveAxisSnapshot[]};
const strip=(r:Rec)=>{const {drives:_d,...rest}=r;void _d;return rest;};

async function replayMobile(dir:string,cp:{tick:number;runId:string;plant:{snapshot:{bootId:string}}},scene:NavigationSceneV1,docs:{model:DriveModelV1;control:ControlProfileV1},records:Rec[],trace:Trace){
 const manifest=await readJson(dir,'run/evidence/manifest.json');
 const nav=await readNavigationEvidence(join(dir,'run/evidence'),manifest,{scene,runTick:cp.tick});
 if(!nav.complete||manifest.runId!==cp.runId||manifest.sceneDigest!==scene.sceneDigest||manifest.boots?.length!==1||manifest.boots[0].bootId!==cp.plant.snapshot.bootId||nav.control.length!==cp.tick)throw Error('CIL_CONTROL_EVIDENCE');
 const robot=scene.robots[0]!,controller=mobileDrive(docs,{robotId:robot.robotId,...robot.model.kinematics});
 return replayMobileCommands(controller,robot.robotId,records,nav.control,trace.steps);
}

export async function verifyCilCampaign(root:string,onlyCase?:string):Promise<CilCampaignVerdict>{
 const v:CilCampaignVerdict={expectedRuns:0,completedCases:0,missingArtifacts:[],issues:[],equivalence:[],faultCases:[]};let source:string,host:HostArch,table:Registry;
 try{const c=await readJson(root,'campaign.json');table=c.campaign?.id===historicalCampaign.id?historicalCampaign:campaign;
  if(c.accepted!==false||c.execution!=='actual_mujoco'||c.calibration!=='not_calibrated'||hashJson(c.campaign)!==hashJson(table)||!/^[a-f0-9]{40}$/.test(c.sourceCommit)||!['arm64','x86_64'].includes(c.hostArch))throw Error();source=c.sourceCommit;host=c.hostArch;
 }catch{v.issues.push('CIL_CAMPAIGN_IDENTITY');return v;}
 const cases=casesFor(table),selected=cases.filter(c=>!onlyCase||c.id===onlyCase),wanted=new Set(selected.map(c=>c.id));
 v.expectedRuns=selected.length;if(!selected.length){v.issues.push('CIL_CASE_UNREGISTERED');return v;}
 const verified=new Map<string,{stream:string;deficits:ReturnType<typeof buildDriveEvidence>['axes'][number]['speedDeficit'][]}>();
 const repeated=new Map<string,boolean>(),executions=new Set<string>();
 const claimExecution=(runId:unknown)=>{
  if(typeof runId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(runId))throw Error('CIL_EXECUTION_IDENTITY');
  if(executions.has(runId))throw Error('CIL_DUPLICATE_EXECUTION');
  executions.add(runId);
 };
 for(const spec of withDependencies(selected,cases).filter(c=>c.kind!=='cell')){
  const repeatId=`repeat-${spec.experimentId.replace(/^drive-|-v1$/g,'')}-s${spec.seed}`;
  const dir=join(root,spec.id),check=(ok:unknown,code:string)=>{if(!ok)throw Error(code);};
  try{
   for(const id of dependencies(spec))check(verified.has(id),'CIL_DEPENDENCY:'+id);
   const rec=await readJson(dir,'case.json');check(rec.schemaVersion===1&&rec.engineVersion==='3.17.0'&&rec.accepted===false&&rec.execution==='actual_mujoco'&&rec.sourceCommit===source&&hashJson(rec.case)===hashJson(spec)&&rec.error===null,'CIL_CASE_IDENTITY');
   check(hashJson(await cellArtifacts(dir))===hashJson(rec.artifacts),'CIL_ARTIFACT_INVENTORY');
   const report=await readJson(dir,'report.json') as RunReport,cp=await readJson(dir,'run/run.json'),trace=await readJson(dir,'trace.json') as Trace;
   check(cp.manifest.seed===spec.seed&&cp.manifest.sourceCommit===source&&cp.runId===report.manifest.runId&&cp.tick===report.outcome.tick&&report.manifest.sourceCommit===source&&report.manifest.seed===spec.seed&&cp.manifest.scenario.id===table.scenarioId&&trace.spawns===1&&!trace.error,'CIL_RUN_IDENTITY');
   claimExecution(cp.runId);
   // the scene the run used names exactly the registered experiment, and the manifest carries the digests of those very documents
   const {scene,read}=await readStream(dir,cp);const e=scene.engine as {driveModelRef?:{path:string;sha256:string};controlProfileRef?:{path:string;sha256:string}};
   check(experimentOfMobileModel(e.driveModelRef?.path??'')===spec.experimentId,'CIL_EXPERIMENT_MISMATCH');
   const model=JSON.parse(await readFile(join(dir,'bundle',e.driveModelRef!.path),'utf8')) as DriveModelV1,control=JSON.parse(await readFile(join(dir,'bundle',e.controlProfileRef!.path),'utf8')) as ControlProfileV1;
   const registered=await mobileDriveBundle(workerRoot,spec.experimentId,scene.robots[0]!.model.physicalModelDigest,table===historicalCampaign);
   for(const f of registered.files)check((await readFile(join(dir,'bundle',f.path))).equals(f.bytes),'CIL_DRIVE_DOCUMENT_BYTES');
   const expectedManifest=driveManifest(registered,spec.experimentId,host);
   check(report.manifest.drive?.hostArch===host&&cp.engine?.hostArch===host,'CIL_HOSTARCH');
   check(hashJson(registered.refs)===hashJson({driveModelRef:e.driveModelRef,controlProfileRef:e.controlProfileRef})&&hashJson(registered.model)===hashJson(model)&&hashJson(registered.control)===hashJson(control)&&hashJson(report.manifest.drive)===hashJson(expectedManifest),'CIL_MANIFEST_DRIVE');
   const journal=await readCampaignJournal(join(dir,'run'),cp.runId);const outcome=verifyCampaignOutcome(cp,journal,report,'CIL');
   check(read.complete&&read.records.length===cp.tick+1,'CIL_PHYSICS_COVERAGE:'+read.issues.join(','));
   const records=read.records as unknown as Rec[];
   // the controller's events are recomputed from the stream and the retained commands; the whole section must equal what the report says
   const again=buildDriveEvidence(model,records.map(r=>({tick:r.tick,drives:r.drives??[]})),{complete:read.complete,issues:read.issues,events:await replayMobile(dir,cp,scene,{model,control},records,trace)});
   check(hashJson(again as never)===hashJson(report.driveEvidence as never),'CIL_DRIVE_REPORT_NOT_FROM_STREAM');
   const oracle=table.oracles.mobile[spec.experimentId] as Oracle&Record<string,unknown>;
   const out=outcome;check((oracle.status as string[]).includes(out.status),'CIL_OUTCOME_STATUS:'+out.status);
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
    const nominal=verified.get(`fd01-drive-nominal-v1-s${spec.seed}`)!.deficits,factor=oracle.speedDeficitAtLeastTimesNominal as number;
    check(again.axes.every((a,i)=>a.speedDeficit?.available&&nominal[i]?.available&&a.speedDeficit.value>=factor*nominal[i]!.value),'CIL_TORQUE_LIMIT_NOT_OBSERVED:'+again.axes.map((a,i)=>`${a.speedDeficit?.available?a.speedDeficit.value.toFixed(3):'n/a'}/${nominal[i]?.available?nominal[i]!.value.toFixed(3):'n/a'}`).join(','));
   }
   if('speedDeficitRecorded' in oracle)check(again.axes.every(a=>a.speedDeficit?.available===true),'CIL_SPEED_DEFICIT_NOT_MEASURED');
   if('trackingRmsRecorded' in oracle)check(again.axes.every(a=>a.trackingRms.available),'CIL_TRACKING_NOT_MEASURED');
   if('equivalentToLegacy' in oracle){
    const legacyDir=join(dir,'baseline'),legacyCp=await readJson(legacyDir,'run/run.json'),legacyReport=await readJson(legacyDir,'report.json'),legacyTrace=await readJson(legacyDir,'trace.json');
    check(legacyCp.manifest.sourceCommit===source&&legacyCp.manifest.seed===spec.seed&&legacyCp.manifest.scenario.id===table.scenarioId&&legacyCp.runId===legacyReport.manifest.runId&&!legacyReport.manifest.drive&&legacyTrace.spawns===1&&legacyTrace.error===null&&legacyTrace.steps.length===legacyCp.tick,'CIL_BASELINE_NOT_LEGACY');
    claimExecution(legacyCp.runId);
    verifyCampaignOutcome(legacyCp,await readCampaignJournal(join(legacyDir,'run'),legacyCp.runId),legacyReport,'CIL');
    const base=await readStream(legacyDir,legacyCp),legacy=base.read.records as unknown as Rec[];
    check(base.read.complete&&base.scene.engine.id==='mujoco_3d'&&!(base.scene.engine as {driveModelRef?:unknown}).driveModelRef,'CIL_BASELINE_NOT_LEGACY');
    // same mission, same seed: the physics of the ideal drive equals the physics of the legacy path tick for tick, byte for byte
    const same=legacy.length===records.length&&records.every((r,i)=>JSON.stringify(strip(r))===JSON.stringify(strip(legacy[i]!)));
    if(wanted.has(spec.id)&&spec.kind==='mobile')v.equivalence.push({id:`ideal-vs-legacy-s${spec.seed}`,bitIdentical:same});check(same,`CIL_IDEAL_NOT_LEGACY:s${spec.seed}`);
   }
   const hash=createHash('sha256');for(const record of records)hash.update(JSON.stringify(record)+'\n');
   const stream=hash.digest('hex');
   if(spec.kind==='repeat'){
    const same=stream===verified.get(baseline(spec))!.stream;
    repeated.set(repeatId,(repeated.get(repeatId)??true)&&same);check(same,'CIL_REPEAT_NOT_BIT_IDENTICAL');
   }
   verified.set(spec.id,{stream,deficits:again.axes.map(a=>a.speedDeficit)});
   if(wanted.has(spec.id))v.completedCases++;
  }catch(e){if(spec.kind==='repeat')repeated.set(repeatId,false);if(wanted.has(spec.id))v.missingArtifacts.push(spec.id);v.issues.push(`${spec.id}:${(e as NodeJS.ErrnoException).code==='ENOENT'?'CIL_ARTIFACT_MISSING':(e as Error).message}`);}
 }
 for(const [id,bitIdentical] of repeated)v.equivalence.push({id,bitIdentical});
 // the cell part: the cell campaign's own verifier, then the drive facts of each run
 const cells=selected.filter(c=>c.kind==='cell');
 if(cells.length){
  try{
   const cv=await verifyCellCampaign(join(root,'cell'),cells.map(c=>c.cellCase!),table===historicalCampaign),failed=new Set(cv.missingArtifacts),cellCampaign=await readJson(join(root,'cell'),'campaign.json').catch(()=>({}));
   const cellCommit=cellCampaign.sourceCommit,cellExperiment=cellCampaign.driveExperimentId,cellHost=cellCampaign.hostArch;
   for(const c of cells){
    const id=c.cellCase!,check=(ok:unknown,code:string)=>{if(!ok)throw Error(code);};
    try{
     check(!failed.has(id),'CELL_VERIFY:'+cv.issues.filter(i=>!i.includes(':')||i.startsWith(id+':')).join(';'));
     const dir=join(root,'cell',id),report=await readJson(dir,'report.json') as RunReport,cp=await readJson(dir,'run/run.json');
     // the cell campaign is the one this campaign recorded (same commit, same experiment, same architecture), and the run is the one the report is of
     check(cellCommit===source&&cellExperiment===campaign.cell.driveExperimentId&&cellHost===host,'CIL_CELL_CAMPAIGN_BINDING');
     check(report.manifest.sourceCommit===source&&cp.manifest.sourceCommit===source&&cp.runId===report.manifest.runId,'CIL_CELL_RUN_BINDING');
     claimExecution(cp.runId);
     check(report.manifest.drive?.testLevel==='controller_in_the_loop'&&report.manifest.drive.experimentId===campaign.cell.driveExperimentId,'CIL_CELL_MANIFEST_DRIVE');
     check(report.manifest.drive?.hostArch&&report.manifest.drive.hostArch===host,'CIL_HOSTARCH:'+String(report.manifest.drive?.hostArch));
     if(id.startsWith('nominal'))check(report.outcome.served==='2'&&report.driveEvidence!.axes.every(a=>a.faults.length===0),'CIL_CELL_NOMINAL');
     else{const falseServed=report.outcome.served!=='0';v.faultCases.push({id,detected:true,falseServed});check(!falseServed,'CIL_CELL_FALSE_SERVED');}
     v.completedCases++;
    }catch(e){v.missingArtifacts.push(`cell-${id}`);v.issues.push(`cell-${id}:${(e as Error).message}`);if(!id.startsWith('nominal'))v.faultCases.push({id,detected:false,falseServed:false});}
   }
  }catch(e){for(const c of cells){v.missingArtifacts.push(c.id);}v.issues.push('CIL_CELL_CAMPAIGN:'+(e as Error).message);}
 }
 return v;
}
