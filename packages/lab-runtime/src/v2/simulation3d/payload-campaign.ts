/** Headless registered experiments use the production fixed-step runner and both independent readers. */
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,lstat,readdir,realpath} from 'node:fs/promises';
import {join,sep} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import canonicalPhysical from '../../../../../robotics/simulation-mujoco/fixtures/serve-payload-v1/physical-model-amr-1.json';
import canonicalEmpty from '../../../../../robotics/simulation-mujoco/fixtures/serve-payload-v1/empty.json';
import canonicalCenter from '../../../../../robotics/simulation-mujoco/fixtures/serve-payload-v1/cup-center.json';
import canonicalOffset from '../../../../../robotics/simulation-mujoco/fixtures/serve-payload-v1/cup-offset.json';
import canonicalProject from '../../../../../robotics/simulation-mujoco/fixtures/serve-payload-v1/serve-3d-project.json';
import registeredPhysics from '../../../../../robotics/simulation-mujoco/fixtures/serve-payload-v1/registered-physics.json';
import campaign from '../../../../../robotics/simulation-mujoco/campaigns/payload-v1.json';
import {PAYLOAD_EXPERIMENTS,payloadExperiment,type PayloadExperimentId} from './payload-experiments';
import {createEngineeringService,type LockedEngineering} from '../../engineering/gateway';
import {createMujocoCompiler} from '../../engineering/mujoco-compiler';
import {lockDigestOf} from '../../engineering/linkforge';
import type {EngineeringProject} from '../../engineering/contracts';
import {createFixedStepScenarioRun} from '../navigation2d/runner';
import {defaultCatalog} from '../capabilities';
import {mujocoMobilePlant,MOBILE_PAYLOAD_IMPULSE,MOBILE_BRAKE_OBSERVATION} from './mujoco-mobile';
import {WorkerLostError} from '../navigation2d/plant';
import {engineSeedOf,readNavigationEvidence} from '../navigation2d/evidence';
import {preparePhysicsAdmission,readPhysicsEvidence,readPhysicsManifest} from './physics-evidence';
import {physicsMetrics} from './physics-metrics';
import {validateNavigationDocument,validateSim3DResponse,type NavigationSceneV1} from '../navigation2d/contracts';
import {composePose,invertPose,qrotate} from '../frames';
import {hashJson} from '../hash';
import type {RunReport} from '../report';
export interface PayloadCampaignVerdict {expectedRuns:number;completedCases:number;missingArtifacts:string[];faultCases:{id:string;detected:boolean;falseServed:boolean}[];issues:string[]}
export const PAYLOAD_CAMPAIGN=campaign;
const sha=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
const json=(v:unknown)=>JSON.stringify(v,null,2)+'\n';
const SET='engineering-mujoco-3d-v1',OWNER='payload-campaign';
type Case=typeof campaign.cases[number];
interface Trace {spawns:number;pid:number|null;createSeed:number|null;perturbationId:string|null;steps:{requestId:string;targetTick:number;ack:boolean}[];injection:null|{kind:string;method:string;pid:number;targetTick:number;appliedTick:number;responseSha256:string};cancelAtTick:number|null;retryRefused:boolean}
interface CaseRecord {schemaVersion:1;case:Case;sourceCommit:string;accepted:false;runId:string;inputs:{projectDigest:string;sceneDigest:string;loadProfileSha256:string;physicsProfileSha256:string;canonicalPhysicalSha256:string;physicalModelDigest:string;navigationModelDigest:string;policyHash:string;controllerPolicySha256:string;stopPolicySha256:string;entitySpeedLimitMps:number|null};artifacts:{path:string;bytes:number;sha256:string}[]}
async function bounded(root:string,path:string,max=16*1024*1024){
 if(!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(path)||path.split('/').some(p=>p==='.'||p==='..'))throw new Error('CAMPAIGN_PATH_REJECTED');
 const base=await realpath(root),file=join(root,path);
 let parent=root;for(const part of path.split('/').slice(0,-1)){parent=join(parent,part);const st=await lstat(parent);if(!st.isDirectory()||st.isSymbolicLink())throw new Error('CAMPAIGN_PATH_REJECTED');}
 const st=await lstat(file);if(!st.isFile()||st.size>max)throw new Error('CAMPAIGN_FILE_LIMIT_OR_PATH');
 if(!(await realpath(file)).startsWith(base+sep))throw new Error('CAMPAIGN_PATH_REJECTED');
 const bytes=await readFile(file);if(bytes.length!==st.size||bytes.length>max)throw new Error('CAMPAIGN_FILE_LIMIT');return bytes;
}
async function artifactPaths(root:string,base='',budget={left:10000}):Promise<string[]>{
 if(base.split('/').length>12)throw new Error('ARTIFACT_DEPTH_LIMIT');const out:string[]=[];
 for(const name of await readdir(join(root,base))){if(--budget.left<0)throw new Error('ARTIFACT_COUNT_LIMIT');const path=base?`${base}/${name}`:name;if(path==='case.json')continue;const st=await lstat(join(root,path));if(st.isSymbolicLink())throw new Error('CAMPAIGN_PATH_REJECTED');if(st.isDirectory())out.push(...await artifactPaths(root,path,budget));else if(st.isFile())out.push(path);else throw new Error('CAMPAIGN_PATH_REJECTED');}
 return out.sort();
}
async function listing(root:string,base=''):Promise<CaseRecord['artifacts']>{
 const out:CaseRecord['artifacts']=[];
 for(const name of (await readdir(join(root,base))).sort()){
  const path=base?`${base}/${name}`:name;if(path==='case.json')continue;
  const st=await lstat(join(root,path));if(st.isDirectory())out.push(...await listing(root,path));else {const b=await bounded(root,path,100*1024*1024);out.push({path,bytes:b.length,sha256:sha(b)});}
 }return out;
}
async function setup(o:{root:string;out:string}){
 const workerRoot=join(o.root,'robotics/simulation-mujoco'),fixture=join(workerRoot,'fixtures/serve-payload-v1'),catalogRoot=join(o.out,'catalog');
 const c=JSON.parse(await readFile(join(fixture,'serve-3d-components.json'),'utf8')) as {components:Record<string,unknown>;models:Record<string,unknown>};
 for(const dir of ['components','models','documents'])await mkdir(join(catalogRoot,dir),{recursive:true});
 for(const [id,doc] of Object.entries(c.components))await writeFile(join(catalogRoot,'components',id+'.json'),json(doc));
 for(const [id,doc] of Object.entries(c.models))await writeFile(join(catalogRoot,'models',id+'.json'),json(doc));
 await writeFile(join(catalogRoot,'catalog.json'),json({schemaVersion:1,id:'payload-v1',components:Object.keys(c.components).map(digest=>({digest,file:`components/${digest}.json`})),quotes:[]}));
 const compiler=createMujocoCompiler({workerRoot}),service=createEngineeringService({directory:join(o.out,'engineering'),catalogRoot,compiler:{version:'refused',runnable:()=>false,async compileResolved(){throw new Error('NATIVE_DISABLED');}},compilers:{[SET]:compiler}});
 const compiled=new Map<string,{locked:LockedEngineering;scene:NavigationSceneV1}>();
 for(const experimentId of Object.keys(PAYLOAD_EXPERIMENTS) as PayloadExperimentId[]){
  const project:EngineeringProject={...JSON.parse(await readFile(join(fixture,'serve-3d-project.json'),'utf8')),requestedProfile:SET,mujocoExperimentId:experimentId};
  const receipt=await service.compileEngineeringProject(project,OWNER);if(receipt.state!=='compiled')throw new Error(`PAYLOAD_COMPILE_FAILED:${JSON.stringify(receipt.problems)}`);
  const locked=await service.admitRun(OWNER,{bundleDigest:receipt.bundleDigest,projectDigest:receipt.projectDigest},SET,undefined);
  const scene=JSON.parse(Buffer.from(await service.bundleFile(receipt.bundleDigest!,'navigation-scene.json')).toString()) as NavigationSceneV1;
  compiled.set(experimentId,{locked,scene});
 }return {service,compiled,workerRoot};
}
export async function runPayloadCampaign(o:{root:string;out:string;sourceCommit:string;python?:string}):Promise<PayloadCampaignVerdict>{
 if(!/^[a-f0-9]{40}(?:-dirty)?$/.test(o.sourceCommit))throw new Error('SOURCE_COMMIT_REQUIRED');
 // Never overwrite a previous campaign, including a failed one.
 await mkdir(o.out);await writeFile(join(o.out,'campaign.json'),json({campaign,sourceCommit:o.sourceCommit,accepted:false,recording:'development_experimental'}));
 const {service,compiled,workerRoot}=await setup(o),runtime={python:o.python??join(o.root,'.venv-mujoco/bin/python'),workerRoot,schemaDir:join(o.root,'packages/contracts/schemas'),lockDigest:await lockDigestOf(join(workerRoot,'requirements.lock')),engineVersion:'3.17.0',maxActiveRuns:1};
 const catalog={...defaultCatalog,backends:defaultCatalog.backends.map(b=>b.id==='mujoco_3d'?{...b,installed:true,compatible:true,reachable:true}:b)};
 for(const spec of campaign.cases){
  const {locked,scene}=compiled.get(spec.experimentId)!,dir=join(o.out,spec.id);await mkdir(dir);
  const bundle=join(dir,'bundle');await mkdir(bundle);for(const path of ['navigation-scene.json',...scene.files.map(f=>f.path)]){await mkdir(join(bundle,path,'..'),{recursive:true});await writeFile(join(bundle,path),await service.bundleFile(locked.ref.bundleDigest,path));}
  await writeFile(join(dir,'input.json'),json(locked.project));
  const trace:Trace={spawns:0,pid:null,createSeed:null,perturbationId:spec.kind==='cup-fall'?'payload-cup-forward-impulse-v1':null,steps:[],injection:null,cancelAtTick:null,retryRefused:false},plant=mujocoMobilePlant(runtime,spec.kind==='cup-fall'?'payload-cup-forward-impulse-v1':spec.kind==='brake'?'payload-brake-observation-v1':undefined),spawn=plant.spawn;
  plant.spawn=async options=>{trace.spawns++;const worker=await spawn(options);trace.pid=worker.pid??null;return {get state(){return worker.state;},get pid(){return worker.pid;},get bootId(){return worker.bootId;},get stderrTail(){return worker.stderrTail;},close:reason=>worker.close(reason),async request(request){
   if(request.op==='create')trace.createSeed=(request.payload as {seed:number}).seed;
   const response=await worker.request(request);
   if(request.op==='step'){
    const targetTick=request.expectedTick+1,inject=['worker-kill','ack-loss'].includes(spec.kind)&&targetTick===(spec.atTick??0)+1;
    trace.steps.push({requestId:request.requestId,targetTick,ack:!inject&&response.ok});
    if(inject){if(!response.ok||!worker.pid)throw new Error('INJECTION_PREREQUISITE');
     trace.injection={kind:spec.kind,method:spec.kind==='worker-kill'?'owned-worker-pid-SIGKILL-after-applied-step-before-delivery':'drop-real-step-ACK-before-runner-delivery',pid:worker.pid,targetTick,appliedTick:(response.result as {tick:number}).tick,responseSha256:sha(JSON.stringify(response))};
     await writeFile(join(dir,'injected-ack.json'),json(response));await writeFile(join(dir,'trace.json'),json(trace));
     if(spec.kind==='worker-kill')process.kill(worker.pid,'SIGKILL');
     throw new WorkerLostError(spec.kind==='worker-kill'?'WORKER_EXITED':'WORKER_TIMEOUT','unknown','server-owned campaign injection after actual engine step');
    }
   }return response;
  }};};
  const run=await createFixedStepScenarioRun({project:locked.runtimeProjection.project,scenarioId:'MJ-FD01',scenarioRevision:1,seed:spec.seed,mode:'simulation',access:'simulated',backendSetId:SET,sourceCommit:o.sourceCommit,engineering:locked},{directory:join(dir,'run'),catalog,enabledBackends:['mujoco_3d'],bundleFile:(d,p)=>service.bundleFile(d,p),plant,runtime});
  let report:RunReport;let action=0;
  const act=async(kind:string,payload:object={})=>{const v=await run.snapshot();return run.action({actionId:`campaign-${++action}`,expectedRevision:v.run.runRevision,kind,payload});};
  try{
   await run.start();let v=await run.snapshot();
   while(['running','awaiting_confirmation'].includes(v.run.status)&&v.tick<30000){
    if(spec.kind==='brake'&&trace.cancelAtTick===null&&v.tick>=spec.atTick!){trace.cancelAtTick=v.tick;v=await act('cancel');}
    const ticks=spec.kind==='brake'&&trace.cancelAtTick===null?Math.min(250,spec.atTick!-v.tick):250;
    v=await act('step',{ticks});
   }
   if(spec.kind==='cup-fall'){let tail=await run.snapshot();while(tail.tick<650&&tail.attention.every(a=>a.reason==='CONTACT')){tail=await act('step',{ticks:10});} }
   if(trace.injection||spec.kind==='cup-fall'){try{await act('step',{ticks:1});}catch(e){trace.retryRefused=String(e).includes('PLANT_LOST');}}
   report=await run.report();
  }finally{await run.close();}
  await writeFile(join(dir,'report.json'),json(report!));await writeFile(join(dir,'trace.json'),json(trace));
  const engine=scene.engine;if(engine.id!=='mujoco_3d')throw new Error('WRONG_ENGINE');
  const load=JSON.parse(await readFile(join(bundle,engine.loadProfileRef.path),'utf8'));
  const record:CaseRecord={schemaVersion:1,case:spec,accepted:false,sourceCommit:o.sourceCommit,runId:report!.manifest.runId,inputs:{projectDigest:locked.ref.projectDigest,sceneDigest:scene.sceneDigest,loadProfileSha256:engine.loadProfileRef.sha256,physicsProfileSha256:engine.physicsProfileRef.sha256,canonicalPhysicalSha256:scene.files.find(f=>f.path==='canonical-physical-model.json')!.sha256,physicalModelDigest:scene.robots[0]!.model.physicalModelDigest,navigationModelDigest:scene.robots[0]!.model.modelDigest,policyHash:scene.policy.hash,controllerPolicySha256:engine.controllerPolicyRef!.sha256,stopPolicySha256:engine.stopPolicyRef!.sha256,entitySpeedLimitMps:locked.project.runtimeProject.entities[0]!.speedLimitMps??null},artifacts:await listing(dir)};
  if(load.id!==payloadExperiment(spec.experimentId).load)throw new Error('LOAD_IDENTITY_MISMATCH');
  await writeFile(join(dir,'case.json'),json(record));
 }
 const verdict=await verifyPayloadCampaign(o.out);await writeFile(join(o.out,'summary.json'),json({accepted:false,...verdict}));return verdict;
}

/** Readback is intentionally independent of summary.json and report metrics. Every required case has retained source/physics/navigation artifacts. */
export async function verifyPayloadCampaign(root:string):Promise<PayloadCampaignVerdict>{
 const verdict:PayloadCampaignVerdict={expectedRuns:campaign.cases.length,completedCases:0,missingArtifacts:[],faultCases:[],issues:[]},repeatDigests=new Map<string,string>();
 let sourceCommit:string|undefined;
 try{const allowed=new Set(['campaign.json','summary.json','catalog','engineering',...campaign.cases.map(c=>c.id)]);for(const name of await readdir(root))if(!allowed.has(name))verdict.issues.push(`UNEXPECTED_CAMPAIGN_ARTIFACT:${name}`);}catch(e){verdict.issues.push(String(e));}
 try{const c=JSON.parse((await bounded(root,'campaign.json',128*1024)).toString());if(hashJson(c.campaign)!==hashJson(campaign)||c.accepted!==false||! /^[a-f0-9]{40}(?:-dirty)?$/.test(c.sourceCommit))throw new Error('CAMPAIGN_IDENTITY');sourceCommit=c.sourceCommit;}catch(e){verdict.missingArtifacts.push('campaign.json');verdict.issues.push(String(e));}
 for(const spec of campaign.cases){
  const dir=join(root,spec.id),isFault=['worker-kill','ack-loss','cup-fall'].includes(spec.kind),isAckFault=['worker-kill','ack-loss'].includes(spec.kind),fault={id:spec.id,detected:false,falseServed:false};if(isFault)verdict.faultCases.push(fault);
  const check=(ok:unknown,why:string)=>{if(!ok)throw new Error(why);};
  try{
   check((await lstat(dir)).isDirectory()&&!(await lstat(dir)).isSymbolicLink(),'CAMPAIGN_PATH_REJECTED');
   const record=JSON.parse((await bounded(dir,'case.json',1024*1024)).toString()) as CaseRecord;
   check(Object.keys(record).sort().join(',')==='accepted,artifacts,case,inputs,runId,schemaVersion,sourceCommit','CASE_SHAPE_INVALID');
   check(record.schemaVersion===1&&record.accepted===false&&hashJson(record.case)===hashJson(spec)&&record.sourceCommit===sourceCommit,'CASE_IDENTITY_MISMATCH');
   check(Array.isArray(record.artifacts)&&record.artifacts.length>10&&record.artifacts.length<10000,'ARTIFACT_LIST_INVALID');
   const paths=new Set<string>();let bytes=0;
   for(const ref of record.artifacts){check(!paths.has(ref.path),'ARTIFACT_DUPLICATE');paths.add(ref.path);check(Number.isSafeInteger(ref.bytes)&&ref.bytes>=0&&ref.bytes<=100*1024*1024,'ARTIFACT_LIMIT');bytes+=ref.bytes;check(bytes<=250*1024*1024,'CASE_BYTE_LIMIT');const b=await bounded(dir,ref.path,100*1024*1024);check(b.length===ref.bytes&&sha(b)===ref.sha256,`ARTIFACT_HASH:${ref.path}`);}
   check(hashJson(await artifactPaths(dir))===hashJson([...paths].sort()),'UNLISTED_ARTIFACT');
   for(const path of ['input.json','report.json','trace.json','bundle/navigation-scene.json','run/run.json','run/journal.db','run/physics/manifest.json','run/evidence/manifest.json'])check(paths.has(path),`MISSING_ARTIFACT:${path}`);
   const read=async(path:string)=>JSON.parse((await bounded(dir,path)).toString());
   const scene=await read('bundle/navigation-scene.json') as NavigationSceneV1,project=await read('input.json') as EngineeringProject,report=await read('report.json') as RunReport,cp=await read('run/run.json'),trace=await read('trace.json') as Trace;
   check(validateNavigationDocument(scene).ok&&scene.engine.id==='mujoco_3d','SCENE_INVALID');if(scene.engine.id!=='mujoco_3d')throw new Error('ENGINE_INVALID');
   const exp=payloadExperiment(spec.experimentId),engine=scene.engine;
   check(hashJson(project)===hashJson({...canonicalProject,requestedProfile:SET,mujocoExperimentId:spec.experimentId}),'UNDECLARED_PROJECT_INPUT');
   check(trace.createSeed===engineSeedOf(spec.seed,scene).engineSeed&&trace.perturbationId===(spec.kind==='cup-fall'?'payload-cup-forward-impulse-v1':null),'ACTUAL_WORKER_INPUT');
   check(project.mujocoExperimentId===spec.experimentId&&hashJson(project)===record.inputs.projectDigest&&scene.inputs.project.digest===record.inputs.projectDigest,'PROJECT_IDENTITY');
   check(scene.sceneDigest===record.inputs.sceneDigest&&scene.policy.parameters.maxLinearMps===exp.maxLinearMps&&scene.policy.parameters.maxAngularRadps===exp.maxAngularRadps,'APPLIED_POLICY_IDENTITY');
   check(hashJson(report.manifest.completionObservation??null)===hashJson(spec.kind==='brake'?MOBILE_BRAKE_OBSERVATION:null)&&hashJson(cp.manifest.completionObservation??null)===hashJson(report.manifest.completionObservation??null),'COMPLETION_OBSERVATION_IDENTITY');
   if(spec.kind==='brake')check(cp.completionTail?.lastTick===cp.tick&&cp.completionTail.firstTick+5===cp.tick,'COMPLETION_OBSERVATION_HORIZON');
   check(hashJson(report.manifest.simulationPerturbation??null)===hashJson(spec.kind==='cup-fall'?MOBILE_PAYLOAD_IMPULSE:null)&&hashJson(cp.manifest.simulationPerturbation??null)===hashJson(report.manifest.simulationPerturbation??null),'PERTURBATION_MANIFEST_IDENTITY');
   check(cp.plant.bootId===cp.plant.snapshot.bootId,'COMMITTED_BOOT_IDENTITY');
   check(report.manifest.seed===spec.seed&&cp.manifest.seed===spec.seed&&report.manifest.sourceCommit===sourceCommit&&cp.manifest.sourceCommit===sourceCommit&&report.manifest.runId===record.runId&&cp.runId===record.runId,'RUN_IDENTITY');
   check(engine.loadProfileRef.id===exp.load&&engine.physicsProfileRef.path===`${exp.physics}.json`&&engine.physicsProfileRef.sha256===record.inputs.physicsProfileSha256&&engine.loadProfileRef.sha256===record.inputs.loadProfileSha256,'PROFILE_IDENTITY');
   check(engine.physicsProfileRef.sha256===registeredPhysics[exp.physics].sha256&&scene.files.find(f=>f.path==='canonical-physical-model.json')?.sha256==='830ba57f4f51272b533fd2c6a2c8743ba4857341af0e7af90f4525145b7249b9','REGISTERED_INPUT_BYTES');
   check(record.inputs.canonicalPhysicalSha256==='830ba57f4f51272b533fd2c6a2c8743ba4857341af0e7af90f4525145b7249b9'&&record.inputs.physicalModelDigest===scene.robots[0]!.model.physicalModelDigest&&record.inputs.navigationModelDigest===scene.robots[0]!.model.modelDigest&&record.inputs.policyHash===scene.policy.hash&&record.inputs.controllerPolicySha256===engine.controllerPolicyRef?.sha256&&record.inputs.stopPolicySha256===engine.stopPolicyRef?.sha256&&record.inputs.entitySpeedLimitMps===(project.runtimeProject.entities[0]!.speedLimitMps??null),'DERIVED_INPUT_IDENTITY');
   for(const f of scene.files){check(paths.has(`bundle/${f.path}`),'BUNDLE_ARTIFACT_MISSING');const b=await bounded(dir,`bundle/${f.path}`);check(sha(b)===f.sha256&&b.length===f.bytes,'BUNDLE_HASH');}
   const prepared=await preparePhysicsAdmission(scene,p=>bounded(dir,`bundle/${p}`)),physical=await read(`bundle/${prepared.load.modelRef.path}`);
   check(validateNavigationDocument(physical).ok&&physical.modelDigest===scene.robots[0]!.model.physicalModelDigest&&hashJson(physical.inputs)===hashJson(scene.inputs),'PHYSICAL_MODEL_PROVENANCE');
   const mechanical=(doc:Record<string,unknown>)=>Object.fromEntries(Object.entries(doc).filter(([key])=>!['inputs','modelDigest','robotId'].includes(key)));
   check(hashJson(mechanical(physical))===hashJson(mechanical(canonicalPhysical)),'UNREGISTERED_MECHANICS');
   const expectedLoad={'empty':canonicalEmpty,'cup-center':canonicalCenter,'cup-offset':canonicalOffset}[exp.load];
   check(hashJson(prepared.load.props)===hashJson(expectedLoad.props)&&hashJson(prepared.load.supports)===hashJson(expectedLoad.supports),'UNREGISTERED_LOAD');
   const manifest=await readPhysicsManifest(join(dir,'run/physics'));
   const physics=await readPhysicsEvidence(join(dir,'run/physics'),manifest,{admission:prepared.admission,metricsPolicyDigest:prepared.metricsPolicyDigest,identity:{runId:record.runId,bootId:cp.plant.bootId,sceneDigest:scene.sceneDigest,loadProfileDigest:engine.loadProfileRef.sha256,physicsProfileDigest:engine.physicsProfileRef.sha256},runTick:cp.tick});
   const navManifest=await read('run/evidence/manifest.json');check(navManifest.runId===record.runId&&navManifest.sceneDigest===scene.sceneDigest&&navManifest.boots.length===1&&navManifest.boots[0].bootId===cp.plant.bootId&&navManifest.boots[0].firstTick===0,'NAVIGATION_RUN_IDENTITY');
   const navigation=await readNavigationEvidence(join(dir,'run/evidence'),navManifest,{scene,runTick:cp.tick});
   const db=new DatabaseSync(join(dir,'run/journal.db'),{readOnly:true});let events:RunReport['businessEvents'];
   try{const rows=db.prepare('SELECT entry_json FROM journal ORDER BY length(producer_sequence),producer_sequence').all();check(rows.length>0&&rows.length<100000,'JOURNAL_LIMIT');events=rows.flatMap(row=>{const e=JSON.parse(String(row.entry_json));return e.payload.events.map((x:{type:string;data:{kind:string;id:string;state:unknown}})=>({sequence:e.sequence,at:e.recordedAt,type:x.type,kind:String(x.data.kind),id:String(x.data.id),state:x.data.state??{}}));});}finally{db.close();}
   check(hashJson(events!)===hashJson(report.businessEvents),'JOURNAL_REPORT_MISMATCH');
   const falseServed=events!.some(e=>e.kind==='fulfillment'&&BigInt(String(e.state.served??'0'))>0n);
   check(trace.spawns===1&&trace.steps.length===cp.tick+(isAckFault?1:0)&&trace.steps.every((s,i)=>s.targetTick===i+1)&&new Set(trace.steps.map(s=>s.requestId)).size===trace.steps.length,'STEP_RETRY_OR_GAP');
   check(report.outcome.tick===cp.tick&&manifest.coverage.lastTick===cp.tick&&physics.records.length===cp.tick+1,'COMMITTED_HORIZON');
   if(isFault)check(events!.some(e=>e.type==='RobotCommandObserved'&&e.state.status==='unknown'),'SOURCE_UNKNOWN_NOT_RECORDED');
   if(isAckFault){
    fault.falseServed=falseServed||report.outcome.served!=='0';
    const reason=spec.kind==='worker-kill'?'WORKER_EXITED':'WORKER_TIMEOUT',injection=trace.injection,ack=await read('injected-ack.json');
    check(injection?.kind===spec.kind&&injection.targetTick===spec.atTick!+1&&injection.appliedTick===injection.targetTick&&injection.pid===trace.pid&&sha(JSON.stringify(ack))===injection.responseSha256&&validateSim3DResponse(ack).ok&&ack.ok&&ack.runId===record.runId&&ack.bootId===cp.plant.bootId&&ack.result.sceneDigest===scene.sceneDigest&&ack.result.tick===injection.targetTick,'INJECTION_INVALID');
    check(cp.tick===spec.atTick&&trace.retryRefused&&!fault.falseServed&&report.outcome.status==='needs_attention'&&report.attention.some(a=>a.reason==='WORKER_LOST'&&a.subjectId===reason)&&cp.plant.reason===reason,'FAULT_NOT_DETECTED');
    check(physics.issues.length===1&&physics.issues[0]==='PHYSICS_COVERAGE_INCOMPLETE'&&manifest.terminalReason==='STEP_ACK_LOST'&&manifest.gaps.length===1&&manifest.gaps[0]!.firstTick===cp.tick+1&&manifest.gaps[0]!.lastTick===cp.tick+1&&manifest.gaps[0]!.reason==='STEP_ACK_LOST','UNRELATED_PHYSICS_GAP');
    check(navigation.issues.length===0&&navigation.horizon===cp.tick&&navigation.gaps.length===1&&navigation.gaps[0]!.fromTick===cp.tick+1&&navigation.gaps[0]!.toTick===cp.tick+1&&navigation.gaps[0]!.reason==='STEP_ACK_LOST','UNRELATED_NAVIGATION_GAP');fault.detected=true;
   }else if(spec.kind==='cup-fall'){
    fault.falseServed=falseServed||report.outcome.served!=='0';
    const receipt=await read('run/worker/payload-perturbation.json'),expected=spec.perturbation!;
    check(paths.has('run/worker/payload-perturbation.json')&&receipt.runId===record.runId&&receipt.bootId===cp.plant.bootId&&receipt.sceneDigest===scene.sceneDigest&&receipt.loadProfileSha256===engine.loadProfileRef.sha256&&receipt.tick===expected.targetTick,'PERTURBATION_IDENTITY');
    for(const key of ['id','frameSampleTick','forceTransform','frameId','supportId','forceN','durationS','impulseNs','substeps','propId','method'])check(hashJson(receipt[key])===hashJson(expected[key as keyof typeof expected]),'PERTURBATION_DOSE');
    check(trace.retryRefused&&!fault.falseServed&&report.outcome.status==='needs_attention'&&report.attention.some(a=>a.reason==='LOAD_FELL')&&cp.plant.reason==='LOAD_FELL','FALL_NOT_DETECTED');
    check(physics.issues.length===1&&physics.issues[0]==='PHYSICS_COVERAGE_INCOMPLETE'&&manifest.terminalReason==='LOAD_FELL'&&manifest.gaps.length===0&&navigation.complete,'UNRELATED_FALL_GAP');
    const rows=physics.records,before=rows[expected.targetTick-1]!.loads[0]!,after=rows[expected.targetTick]!.loads[0]!;
    const frame=composePose({position:before.poseMap.positionM,quaternionXyzw:before.poseMap.quaternionXyzw},invertPose({position:before.poseInSupport!.positionM,quaternionXyzw:before.poseInSupport!.quaternionXyzw})),force=qrotate(frame.quaternionXyzw,expected.forceN);
    check(frame.position.every((x,i)=>Math.abs(x-receipt.supportPoseMap.positionM[i])<1e-9)&&Math.abs(Math.abs(frame.quaternionXyzw.reduce((sum,x,i)=>sum+x*receipt.supportPoseMap.quaternionXyzw[i],0))-1)<1e-9,'PERTURBATION_SUPPORT_FRAME');
    check(Array.isArray(receipt.forceMapN)&&receipt.forceMapN.length===3&&force.every((x,i)=>Math.abs(x-receipt.forceMapN[i])<1e-9),'PERTURBATION_FORCE_FRAME');
    const delta=Math.hypot(...after.poseMap.positionM.map((x,i)=>x-before.poseMap.positionM[i]!));check(delta>0&&delta<.05,'PERTURBATION_TELEPORT');
    const initial=prepared.load.props[0]!.attachment;if(initial.kind!=='free')throw new Error('FALL_ATTACHMENT_INVALID');
    check(rows.slice(-5).every(r=>r.loads[0]!.poseInSupport!.positionM[2]!<=initial.initialPoseInSupport.positionM[2]!-.1)&&rows[rows.length-6]!.loads[0]!.poseInSupport!.positionM[2]!>initial.initialPoseInSupport.positionM[2]!-.1,'FALL_HOLD_MISMATCH');
    check(hashJson(receipt.beforePoseMap)===hashJson(before.poseMap)&&hashJson(receipt.afterPoseMap)===hashJson(after.poseMap),'PERTURBATION_POSE_RECEIPT');fault.detected=true;
   }else{
    check(physics.complete&&navigation.complete,'INCOMPLETE_EVIDENCE');
    check(trace.injection===null&&trace.steps.every(s=>s.ack),'UNDECLARED_FAULT');
    check(spec.kind==='brake'?report.outcome.status==='cancelled'&&trace.cancelAtTick===spec.atTick&&!falseServed:report.outcome.status==='completed'&&report.outcome.served==='1','OUTCOME_MISMATCH');
    const metrics=physicsMetrics(physics,prepared.admission,{...navigation,policy:scene.policy.parameters});check(metrics.contactImpulseNs.available&&metrics.maxTiltRad.available&&metrics.wheelPositionResidualM.available&&metrics.wheelYawResidualRad.available,'PHYSICS_METRIC_UNAVAILABLE');
    check(prepared.load.props.length===0?!metrics.loadDisplacementM.available:metrics.loadDisplacementM.available,'LOAD_METRIC_AVAILABILITY');
    check(navigation.control.some(c=>c.velocities.some(v=>Math.abs(v.omegaRadps)>.05)),'TURN_NOT_OBSERVED');
    if(spec.kind==='brake')check(metrics.stopDistanceM.available&&trace.cancelAtTick===spec.atTick,'STOP_WINDOW_UNAVAILABLE');
    if(spec.experimentId==='payload-center-v1'&&spec.seed===7)repeatDigests.set(spec.id,hashJson(physics.records));
   }
   verdict.completedCases++;
  }catch(e){const message=(e as Error).message;if(message.includes('ENOENT')||message.startsWith('MISSING_ARTIFACT'))verdict.missingArtifacts.push(`${spec.id}:${message}`);verdict.issues.push(`${spec.id}:${message}`);}
 }
 const baseline=repeatDigests.get('turn-center-s7');for(let i=1;i<=3;i++){const id=`repeat-center-s7-r${i}`;if(!baseline||repeatDigests.get(id)!==baseline){verdict.issues.push(`${id}:REPEAT_MISMATCH_OR_MISSING`);if(repeatDigests.has(id))verdict.completedCases--;}}
 return verdict;
}
