/** The tray-v1 campaign (plan V10): MJ-TRAY01 under its five registered experiments on the real MuJoCo worker, each run read back from its immutable evidence. */
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createEngineeringService,type LockedEngineering} from '../../engineering/gateway';
import {createMujocoCompiler} from '../../engineering/mujoco-compiler';
import type {EngineeringProject} from '../../engineering/contracts';
import {createFixedStepScenarioRun} from '../navigation2d/runner';
import {defaultCatalog} from '../capabilities';
import {mujocoMobilePlant} from './mujoco-mobile';
import {preparePhysicsAdmission,readPhysicsEvidence,readPhysicsManifest} from './physics-evidence';
import {readJson} from '../control/cil-campaign';
import {validateNavigationDocument,type NavigationSceneV1,type PhysicsTickRecord} from '../navigation2d/contracts';
import type {RunReport} from '../report';
import {TRAY_EXPERIMENTS,type TrayExperimentId} from './tray-experiments';

const SET='engineering-mujoco-3d-v1',OWNER='tray-campaign',json=(v:unknown)=>JSON.stringify(v,null,2)+'\n';
export const TRAY_SCENARIO='MJ-TRAY01',TRAY_MAX_TICKS=30000;

/** The engineering service with the five tray projects compiled and locked, as the gateway would admit them. */
export async function setupTray(o:{root:string;out:string},only?:readonly TrayExperimentId[]){
 const workerRoot=join(o.root,'robotics/simulation-mujoco'),fixture=join(workerRoot,'fixtures/serve-payload-v1'),catalogRoot=join(o.out,'catalog');
 const c=JSON.parse(await readFile(join(fixture,'serve-3d-components.json'),'utf8')) as {components:Record<string,unknown>;models:Record<string,unknown>};
 for(const dir of ['components','models','documents'])await mkdir(join(catalogRoot,dir),{recursive:true});
 for(const [id,doc] of Object.entries(c.components))await writeFile(join(catalogRoot,'components',id+'.json'),json(doc));
 for(const [id,doc] of Object.entries(c.models))await writeFile(join(catalogRoot,'models',id+'.json'),json(doc));
 await writeFile(join(catalogRoot,'catalog.json'),json({schemaVersion:1,id:'tray-v1',components:Object.keys(c.components).map(digest=>({digest,file:`components/${digest}.json`})),quotes:[]}));
 const service=createEngineeringService({directory:join(o.out,'engineering'),catalogRoot,compiler:{version:'refused',runnable:()=>false,async compileResolved(){throw new Error('NATIVE_DISABLED');}},compilers:{[SET]:createMujocoCompiler({workerRoot})}});
 const compiled=new Map<string,{locked:LockedEngineering;scene:NavigationSceneV1}>();
 for(const id of only??Object.keys(TRAY_EXPERIMENTS) as TrayExperimentId[]){
  const project:EngineeringProject={...JSON.parse(await readFile(join(fixture,'serve-3d-project.json'),'utf8')),requestedProfile:SET,mujocoExperimentId:id};
  const receipt=await service.compileEngineeringProject(project,OWNER);if(receipt.state!=='compiled')throw new Error(`TRAY_COMPILE_FAILED:${JSON.stringify(receipt.problems)}`);
  const locked=await service.admitRun(OWNER,{bundleDigest:receipt.bundleDigest,projectDigest:receipt.projectDigest},SET,undefined);
  const scene=JSON.parse(Buffer.from(await service.bundleFile(receipt.bundleDigest!,'navigation-scene.json')).toString()) as NavigationSceneV1;
  compiled.set(id,{locked,scene});
 }
 return {service,compiled,workerRoot};
}
export interface TrayContext{service:Awaited<ReturnType<typeof setupTray>>['service'];compiled:Awaited<ReturnType<typeof setupTray>>['compiled'];runtime:Parameters<typeof mujocoMobilePlant>[0];catalog:typeof defaultCatalog;sourceCommit:string;signal?:AbortSignal}
export const trayRuntime=(root:string,workerRoot:string,lockDigest:string,python?:string)=>({python:python??join(root,'.venv-mujoco/bin/python'),workerRoot,schemaDir:join(root,'packages/contracts/schemas'),lockDigest,engineVersion:'3.17.0',maxActiveRuns:1});
export const trayCatalog=()=>({...defaultCatalog,backends:defaultCatalog.backends.map(b=>b.id==='mujoco_3d'?{...b,installed:true,compatible:true,reachable:true}:b)});

/** One MJ-TRAY01 run into `dir`: its bundle copy, its run directory and its report. The run goes on until the mission ends (completed, cancelled, failed) or the tick bound. */
export async function runTray(c:TrayContext,dir:string,experimentId:TrayExperimentId,seed:number):Promise<RunReport>{
 const {locked,scene}=c.compiled.get(experimentId)!;await mkdir(dir,{recursive:true});
 const bundle=join(dir,'bundle');for(const path of ['navigation-scene.json',...scene.files.map(f=>f.path)]){await mkdir(join(bundle,path,'..'),{recursive:true});await writeFile(join(bundle,path),await c.service.bundleFile(locked.ref.bundleDigest,path));}
 const run=await createFixedStepScenarioRun({project:locked.runtimeProjection.project,scenarioId:TRAY_SCENARIO,scenarioRevision:1,seed,mode:'simulation',access:'simulated',backendSetId:SET,sourceCommit:c.sourceCommit,engineering:locked},
  {directory:join(dir,'run'),catalog:c.catalog,enabledBackends:['mujoco_3d'],bundleFile:(d,p)=>c.service.bundleFile(d,p),plant:mujocoMobilePlant(c.runtime),runtime:c.runtime});
 let n=0,report:RunReport|undefined;
 try{
  await run.start();let v=await run.snapshot();
  while(['running','awaiting_confirmation'].includes(v.run.status)&&v.tick<TRAY_MAX_TICKS){c.signal?.throwIfAborted();const before=v.tick;v=await run.action({actionId:`tray-${++n}`,expectedRevision:v.run.runRevision,kind:'step',payload:{ticks:250}});if(v.tick===before&&v.run.status==='running')break;}
  report=await run.report();
 }finally{await run.close();if(report)await writeFile(join(dir,'report.json'),json(report));}
 return report;
}

/** The durable physics records of a finished tray run, read with the admission of the bundle it used (including the scripted person's solid, if the variant has one). */
export async function readTrayRun(dir:string){
 const cp=await readJson(dir,'run/run.json') as {runId:string;tick:number;plant:{snapshot:{bootId:string}}};
 const scene=JSON.parse(await readFile(join(dir,'bundle/navigation-scene.json'),'utf8')) as NavigationSceneV1;
 if(!validateNavigationDocument(scene).ok)throw new Error('TRAY_SCENE_INVALID');
 const fixture=await readFile(join(dir,'run/bundle/scenario-fixture.json'),'utf8').then(t=>JSON.parse(t) as {actors:{id:string;radiusM:number;initialPoseMap:number[]}[]},()=>({actors:[]}));
 const prepared=await preparePhysicsAdmission(scene,async p=>readFile(join(dir,'bundle',p)),fixture.actors.map(a=>a.id)),physicsDir=join(dir,'run/physics'),manifest=await readPhysicsManifest(physicsDir);
 const read=await readPhysicsEvidence(physicsDir,manifest,{admission:prepared.admission,metricsPolicyDigest:prepared.metricsPolicyDigest,identity:{runId:cp.runId,bootId:cp.plant.snapshot.bootId,sceneDigest:scene.sceneDigest,loadProfileDigest:prepared.loadProfileDigest,physicsProfileDigest:prepared.physicsProfileDigest},runTick:cp.tick});
 return {cp,scene,read,records:read.records as PhysicsTickRecord[],actors:fixture.actors,prepared};
}

// ---- the campaign: run every case of campaigns/tray-v1.json, then verify it from the files alone ----
import {createHash} from 'node:crypto';
import table from '../../../../../robotics/simulation-mujoco/campaigns/tray-v1.json';
import {lockDigestOf} from '../../engineering/linkforge';
import {hashJson} from '../hash';
import {cellArtifacts} from './cell-campaign';
import {readCampaignJournal,verifyCampaignOutcome} from '../control/campaign-source-evidence';
import {SCENARIO_FIXTURES,TRAY_PERSON_FIXTURE,actorPoseAt,resolveScenarioFixture} from '../navigation2d/scenario-fixtures';
import {buildTrayEvidence,summariseTrayRun,trayInputIssues,type TrayPolicy,type TrayRunSummary} from './tray-verdict';
import {TRAY_POLICY_SHA,isTrayExperiment} from './tray-experiments';
import {DRIVE_DOC_PINS} from './physics-inputs';

export const TRAY_CAMPAIGN=table;
export interface TrayCase{id:string;experimentId:TrayExperimentId;seed:number}
export const TRAY_CASES=table.cases as TrayCase[];
export interface TrayCampaignVerdict{expectedRuns:number;completedCases:number;missingArtifacts:string[];issues:string[];summaries:(TrayRunSummary&{caseId:string;seed:number})[]}
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const hostArch=()=>process.arch==='arm64'?'arm64':'x86_64';

export async function runTrayCampaign(o:{root:string;out:string;sourceCommit:string;python?:string;caseId?:string;signal?:AbortSignal}):Promise<TrayCampaignVerdict>{
 o.signal?.throwIfAborted();
 if(!/^[a-f0-9]{40}$/.test(o.sourceCommit))throw Error('TRAY_SOURCE_COMMIT_REQUIRED');
 if(o.caseId&&!TRAY_CASES.some(c=>c.id===o.caseId))throw Error('CAMPAIGN_CASE_UNREGISTERED');
 await mkdir(o.out);await writeFile(join(o.out,'campaign.json'),json({campaign:table,sourceCommit:o.sourceCommit,hostArch:hostArch(),accepted:false,execution:'actual_mujoco',calibration:'not_calibrated'}));
 const wanted=TRAY_CASES.filter(c=>!o.caseId||c.id===o.caseId),{service,compiled,workerRoot}=await setupTray(o,[...new Set(wanted.map(c=>c.experimentId))]);
 const ctx:TrayContext={service,compiled,runtime:trayRuntime(o.root,workerRoot,await lockDigestOf(join(workerRoot,'requirements.lock')),o.python),catalog:trayCatalog(),sourceCommit:o.sourceCommit,...o.signal?{signal:o.signal}:{}};
 for(const spec of wanted){
  const dir=join(o.out,spec.id);let error:string|null=null;
  try{await runTray(ctx,dir,spec.experimentId,spec.seed);}catch(e){error=String((e as Error).stack??e);await mkdir(dir,{recursive:true});await writeFile(join(dir,'error.txt'),error);}
  await writeFile(join(dir,'case.json'),json({schemaVersion:1,case:spec,sourceCommit:o.sourceCommit,accepted:false,execution:'actual_mujoco',engineVersion:'3.17.0',error,artifacts:await cellArtifacts(dir)}));
  if(o.signal?.aborted)break;
 }
 const verdict=await verifyTrayCampaign(o.out,o.caseId);await writeFile(join(o.out,'summary.json'),json({accepted:false,...verdict}));return verdict;
}

/** Every case from its own files: identity, the journal's outcome, the durable physics records, then the verdicts of its variant. A failing oracle is an issue of the campaign. */
export async function verifyTrayCampaign(root:string,onlyCase?:string):Promise<TrayCampaignVerdict>{
 const v:TrayCampaignVerdict={expectedRuns:0,completedCases:0,missingArtifacts:[],issues:[],summaries:[]};let source:string;
 try{const c=await readJson(root,'campaign.json');if(c.accepted!==false||c.execution!=='actual_mujoco'||c.calibration!=='not_calibrated'||hashJson(c.campaign)!==hashJson(table)||!/^[a-f0-9]{40}$/.test(c.sourceCommit)||!['arm64','x86_64'].includes(c.hostArch))throw Error();source=c.sourceCommit;}
 catch{v.issues.push('TRAY_CAMPAIGN_IDENTITY');return v;}
 const selected=TRAY_CASES.filter(c=>!onlyCase||c.id===onlyCase);v.expectedRuns=selected.length;if(!selected.length){v.issues.push('TRAY_CASE_UNREGISTERED');return v;}
 const runs=new Set<string>();
 for(const spec of selected){
  const dir=join(root,spec.id),check=(ok:unknown,code:string)=>{if(!ok)throw Error(code);};
  try{
   const rec=await readJson(dir,'case.json');
   check(rec.schemaVersion===1&&rec.engineVersion==='3.17.0'&&rec.accepted===false&&rec.execution==='actual_mujoco'&&rec.sourceCommit===source&&hashJson(rec.case)===hashJson(spec)&&rec.error===null,'TRAY_CASE_IDENTITY');
   check(hashJson(await cellArtifacts(dir))===hashJson(rec.artifacts),'TRAY_ARTIFACT_INVENTORY');
   const report=await readJson(dir,'report.json') as RunReport,{cp,scene,records,actors}=await readTrayRun(dir);
   check((cp as unknown as {manifest:{seed:number;sourceCommit:string;scenario:{id:string}}}).manifest.seed===spec.seed&&(cp as unknown as {manifest:{sourceCommit:string}}).manifest.sourceCommit===source&&(cp as unknown as {manifest:{scenario:{id:string}}}).manifest.scenario.id===TRAY_SCENARIO&&cp.tick===report.outcome.tick&&report.manifest.seed===spec.seed,'TRAY_RUN_IDENTITY');
   check(!runs.has(cp.runId),'TRAY_DUPLICATE_EXECUTION');runs.add(cp.runId);check(report.manifest.runId===cp.runId,'TRAY_RUN_IDENTITY');
   // the bundle names exactly the registered variant, and every document the verdicts read is byte-verified against the scene's file list
   const doc=async(path:string)=>{const f=scene.files.find(f=>f.path===path);check(f,'TRAY_BUNDLE_FILE:'+path);const b=await readFile(join(dir,'bundle',path));check(sha(b)===f!.sha256&&b.length===f!.bytes,'TRAY_BUNDLE_HASH:'+path);return JSON.parse(b.toString());};
   const named=await doc('tray-experiment.json');check(isTrayExperiment(named.id)&&named.id===spec.experimentId,'TRAY_EXPERIMENT_MISMATCH');
   const engine=scene.engine as unknown as {loadProfileRef:{path:string};physicsProfileRef:{path:string}};
   const policy=await doc('tray-policy-v1.json') as TrayPolicy&Record<string,unknown>,load=await doc(engine.loadProfileRef.path),physics=await doc(engine.physicsProfileRef.path);
   // the inputs the run really used are the registered ones of its variant (not only its name): thresholds, load and contact friction, acceleration limit, drive documents
   const drive=scene.engine as unknown as {driveModelRef?:{path:string;sha256:string};controlProfileRef?:{path:string}};check(drive.driveModelRef&&drive.controlProfileRef,'TRAY_DRIVE_MISSING');
   const driveModel=await doc(drive.driveModelRef!.path),driveControl=await doc(drive.controlProfileRef!.path),base=(driveControl.controllers as {controllerId:string;params:{maxAccelerationMps2?:number}}[]).find(c=>c.controllerId==='diff-drive-base-v1');
   const issues=trayInputIssues(spec.experimentId,{policySha:scene.files.find(f=>f.path==='tray-policy-v1.json')!.sha256,loadId:load.id,cupSliding:Math.min(...load.props.map((p:{friction:{sliding:number}})=>p.friction.sliding)),physicsId:physics.id,traySliding:physics.contact.sliding,accelerationLimitMps2:scene.policy.parameters.maxAccelerationMps2,driveModelPath:drive.driveModelRef!.path,baseLimitMps2:base?.params.maxAccelerationMps2??null},TRAY_POLICY_SHA);
   check(!issues.length,'TRAY_INPUTS_NOT_REGISTERED:'+issues.join(','));
   check(driveModel.digest===DRIVE_DOC_PINS[TRAY_EXPERIMENTS[spec.experimentId].driveExperimentId]?.model,'TRAY_DRIVE_MODEL_NOT_REGISTERED');
   const journal=await readCampaignJournal(join(dir,'run'),cp.runId),outcome=verifyCampaignOutcome(cp as never,journal,report,'TRAY');
   check(report.outcome&&hashJson(outcome)===hashJson(report.outcome),'TRAY_OUTCOME_NOT_FROM_JOURNAL');
   check(records.length===cp.tick+1,'TRAY_PHYSICS_COVERAGE');
   // the report's own tray evidence is what the durable records say: the same numbers, recomputed here
   const policyDigest=scene.files.find(f=>f.path==='tray-policy-v1.json')!.sha256;
   check(report.trayEvidence&&hashJson(report.trayEvidence)===hashJson(buildTrayEvidence({experimentId:spec.experimentId,records,businessEvents:report.businessEvents,status:outcome.status,accelerationLimitMps2:scene.policy.parameters.maxAccelerationMps2,policy,policyDigest})),'TRAY_EVIDENCE_NOT_FROM_STREAM');
   let personAt:undefined|((t:number)=>{x:number;y:number}|null),personRadiusM:number|undefined;
   if(spec.experimentId==='tray-person-crossing-v1'){
    const fixture=resolveScenarioFixture(TRAY_SCENARIO,scene,spec.seed,SCENARIO_FIXTURES.get(TRAY_PERSON_FIXTURE)),a=fixture.actors[0]!;
    check(fixture.actors.length===1&&actors.length===1&&actors[0]!.id===a.id,'TRAY_ACTOR_MISMATCH');personRadiusM=a.radiusM;personAt=t=>{const p=actorPoseAt(a,t);return {x:p[0],y:p[1]};};
   }
   const summary=summariseTrayRun({experimentId:spec.experimentId,status:outcome.status,served:outcome.served,tick:cp.tick,attention:report.attention.map(a=>a.reason),records,businessEvents:report.businessEvents,
    accelerationLimitMps2:scene.policy.parameters.maxAccelerationMps2,cupSliding:Math.min(...load.props.map((p:{friction:{sliding:number}})=>p.friction.sliding)),traySliding:physics.contact.sliding,...personAt?{personAt,personRadiusM}:{}},policy);
   v.summaries.push({...summary,caseId:spec.id,seed:spec.seed});
   for(const x of summary.verdicts)if(x.result==='fail')v.issues.push(`TRAY_ORACLE:${spec.id}:${x.id}`);
   v.completedCases++;
  }catch(e){v.issues.push(`${spec.id}:${(e as Error).message}`);}
 }
 return v;
}
