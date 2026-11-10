// Bounded IR-SIM campaign runner (C02, INT03). A campaign is a server-owned JSON file under robotics/navigation-2d/campaigns: scenario/fixture ids, seeds, repeats, the
// policy identity and the assertions each run must pass. It names no module, script, schedule or path; the fixtures it names are compiled here by the portable compiler.
// At most two worlds run at once (one IR-SIM process each, the runner's host slots); every run has its own directory, seed, digests and timeout, and either finalizes its
// evidence and assertions or is recorded fail/not_run. Nothing falls back to another provider: a missing prerequisite leaves every run not_run.
import {createHash} from 'node:crypto';
import {lstat,mkdir,open,readdir,readFile,realpath,rename,writeFile} from 'node:fs/promises';
import {dirname,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createEngineeringService,type LockedEngineering} from '../../engineering/gateway';
import {createNavigationCompiler} from '../../engineering/navigation-compiler';
import {createWebotsCompiler} from '../../engineering/webots-compiler';
import type {CompilerPort} from '../../engineering/gateway';
import type {EngineeringProject} from '../../engineering/contracts';
import {defaultCatalog} from '../capabilities';
import {scenarioRegistry} from '../scenario-registry';
import {outcomeDigest,type RunReport} from '../report';
import type {ScenarioRun} from '../scenario-runner';
import type {NavigationSceneV1} from './contracts';
import {readNavigationEvidence} from './evidence';
import {portableSimulationFromOptions} from './readiness';
import {createFixedStepScenarioRun,createIRSimScenarioRun,type IRSimRuntimeOptions} from './runner';
import {webotsFromOptions,type WebotsProvider} from '../simulation3d/readiness';
import {loadOracleProfile} from '../algorithm/checker';
import {FIXTURE_3D_COMPONENTS,FIXTURE_3D_DIRECTORY,FIXTURE_COMPONENTS,FIXTURE_DIRECTORY,NAVIGATION_FIXTURES,RIG_SCENARIOS,SCENARIO_FIXTURES,resolveScenarioFixture,scenarioAssertions,type ScenarioAssertion,type ScenarioFixtureSpec} from './scenario-fixtures';
import {navigationMetrics,openNavigationRecorder} from './evidence';
import {spawnIRSimWorker} from './worker-client';
import type {IRSimSnapshotV1} from './contracts';
import {execFileSync} from 'node:child_process';

export type BatchResult='pass'|'fail'|'not_run';
export interface BatchSummary{runs:{id:string;result:BatchResult}[];complete:boolean;
 /** completed: every run ran and passed; failed: a run failed or is incomplete; not_run: a prerequisite is missing (nothing ran); interrupted: stopped by a signal */
 status:'completed'|'failed'|'not_run'|'interrupted';summaryPath:string;reasons:string[]}
/** Operator-only options (CLI flags), never fields of a campaign or a request. `entry` selects a worker test double: its runs are labelled protocol_double, never irsim_2d evidence. */
export interface BatchOptions{campaignPath:string;outDir:string;concurrency:1|2;sourceCommit:string;
 sourceRoot?:string;python?:string;/** the plant the operator expects: a campaign of the other plant is refused */plant?:BatchPlant;/** Webots plant only: the host Webots.app (default $MEKONIQ_WEBOTS_HOME or /Applications/Webots.app) and the pinned .venv-webots interpreter */webotsHome?:string;webotsPython?:string;entry?:string[];runTimeoutMs?:number;signal?:AbortSignal;stepTicks?:number;
 /** caller-measured identity stamped into the summary as given (e.g. the tool-closure digests the CLI computed before the run) */identity?:Record<string,unknown>}
export interface CampaignEntry{scenarioId:string;scenarioRevision:number;fixtureId:string;seed:number;repeat:number;policyRef:{id:string;revision:number;hash:string};expectedAssertions:string[]}
export interface Campaign{schemaVersion:1;id:string;title:string;runs:CampaignEntry[]}
/** The two plants a campaign can run on, chosen by its fixtures (never by a field of the campaign): the backend set each admits through, and where its campaigns live. */
export type BatchPlant='irsim_2d'|'webots_3d';
const SETS:Readonly<Record<BatchPlant,string>>={irsim_2d:'engineering-irsim-2d-v1',webots_3d:'engineering-webots-3d-v1'},CAMPAIGN_DIRS=['robotics/navigation-2d/campaigns','robotics/simulation-3d/campaigns'];
const plantOf=(fixtureId:string):BatchPlant=>NAVIGATION_FIXTURES[fixtureId]?.provider??'irsim_2d';
const SET=SETS.irsim_2d,MAX_CAMPAIGN_BYTES=64*1024,MAX_RUNS=200,PREVIEW={reasons:10,chars:200};
/** Assertions decided across runs of one campaign (not by one run's evidence): repeatability of a seed, and noise visible against a noise-free twin. */
export const CAMPAIGN_ASSERTIONS=['REPEATABLE','NOISE_VISIBLE'] as const;
const ID=/^[A-Za-z0-9_.:-]{1,64}$/,HEX=/^[0-9a-f]{64}$/;
const here=dirname(fileURLToPath(import.meta.url)),SOURCE_ROOT=resolve(here,'../../../../..');
const sha256=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
export class BatchError extends Error{constructor(readonly code:string,detail:string){super(`${code}: ${detail}`.slice(0,400));this.name='BatchError';}}

const exact=(o:unknown,keys:readonly string[],what:string)=>{
 if(!o||typeof o!=='object'||Array.isArray(o))throw new BatchError('CAMPAIGN_INVALID',`${what} is not an object`);
 const extra=Object.keys(o).filter(k=>!keys.includes(k)),missing=keys.filter(k=>!Object.hasOwn(o,k));
 if(extra.length||missing.length)throw new BatchError('CAMPAIGN_INVALID',`${what}: ${extra.length?`unknown ${extra.join(',')}`:''}${missing.length?` missing ${missing.join(',')}`:''}`);
 return o as Record<string,unknown>;
};
const int=(v:unknown,min:number,max:number,what:string)=>{if(!Number.isSafeInteger(v)||(v as number)<min||(v as number)>max)throw new BatchError('CAMPAIGN_INVALID',`${what} must be an integer in ${min}..${max}`);return v as number;};
const id=(v:unknown,what:string)=>{if(typeof v!=='string'||!ID.test(v))throw new BatchError('CAMPAIGN_INVALID',`${what} is not an id`);return v;};

/**
 * Operator boundary for a campaign file: a regular .json file (no symbolic link anywhere below the root) inside <sourceRoot>/robotics/navigation-2d/campaigns, at most
 * 64 KiB, exactly the campaign schema (unknown fields refused), and only server-registered scenarios/fixtures/assertions. Returns the parsed campaign and its bytes' digest.
 */
export async function loadCampaign(path:string,sourceRoot=SOURCE_ROOT):Promise<{campaign:Campaign;bytes:Buffer;sha256:string;plant:BatchPlant}>{
 const abs=resolve(path),allowed=CAMPAIGN_DIRS.map(d=>resolve(sourceRoot,d)).find(d=>abs.startsWith(d+sep))??resolve(sourceRoot,CAMPAIGN_DIRS[0]!);
 if(!abs.endsWith('.json'))throw new BatchError('CAMPAIGN_PATH_REJECTED','a campaign is a .json file');
 // inside the allowlisted directory as written (resolve() already folded any '..'), and no symbolic link below it: the real path is the directory's real path + the same rest
 const rel=relative(allowed,abs);
 if(!abs.startsWith(allowed+sep)||!rel||rel.split(sep).includes('..'))throw new BatchError('CAMPAIGN_PATH_REJECTED',`${path} is not a file inside ${CAMPAIGN_DIRS.join(' or ')}`);
 let real:string,root:string;
 try{root=await realpath(allowed);real=await realpath(abs);}catch{throw new BatchError('CAMPAIGN_PATH_REJECTED',`${path} does not exist`);}
 if(real!==join(root,rel))throw new BatchError('CAMPAIGN_PATH_REJECTED',`${path} passes through a symbolic link`);
 const st=await lstat(abs);
 if(!st.isFile())throw new BatchError('CAMPAIGN_PATH_REJECTED',`${path} is not a regular file`);
 if(st.size>MAX_CAMPAIGN_BYTES)throw new BatchError('CAMPAIGN_TOO_LARGE',`${st.size} bytes > ${MAX_CAMPAIGN_BYTES}`);
 const bytes=await readFile(abs);
 let doc:unknown;try{doc=JSON.parse(bytes.toString('utf8'));}catch{throw new BatchError('CAMPAIGN_INVALID','not JSON');}
 const c=exact(doc,['schemaVersion','id','title','runs'],'campaign');
 if(c.schemaVersion!==1)throw new BatchError('CAMPAIGN_INVALID','schemaVersion must be 1');
 id(c.id,'id');if(typeof c.title!=='string'||c.title.length>200)throw new BatchError('CAMPAIGN_INVALID','title');
 if(!Array.isArray(c.runs)||!c.runs.length||c.runs.length>50)throw new BatchError('CAMPAIGN_INVALID','runs must list 1..50 entries');
 const planes=new Set<BatchPlant>();
 const runs=c.runs.map((raw,i):CampaignEntry=>{
  const e=exact(raw,['scenarioId','scenarioRevision','fixtureId','seed','repeat','policyRef','expectedAssertions'],`runs[${i}]`);
  // a campaign names a server-owned case: a registry scenario of the IR set, a campaign-only rig, an operator fault on a registry scenario, or a raw drive
  const scenarioId=id(e.scenarioId,`runs[${i}].scenarioId`),fixtureId=id(e.fixtureId,`runs[${i}].fixtureId`),spec=SCENARIO_FIXTURES.get(scenarioId),base=spec?.runs??scenarioId,plant=plantOf(fixtureId),set=defaultCatalog.sets[SETS[plant]]!;planes.add(plant);
  const scenario=spec?.kind==='raw_drive'?{revision:1}:spec?.kind==='contention_rig'?RIG_SCENARIOS.get(base):set.scenarioIds?.includes(base)?scenarioRegistry.get(base):undefined;
  if(!scenario||!spec)throw new BatchError('CAMPAIGN_INVALID',`runs[${i}]: ${scenarioId} is not ${plant==='webots_3d'?'a Webots 3D':'an IR-SIM'} case of ${SETS[plant]}`);
  if(int(e.scenarioRevision,1,2**31,`runs[${i}].scenarioRevision`)!==scenario.revision)throw new BatchError('CAMPAIGN_INVALID',`runs[${i}]: ${scenarioId} revision ${String(e.scenarioRevision)} is not ${scenario.revision}`);
  if(!Object.hasOwn(NAVIGATION_FIXTURES,fixtureId)||!spec.fixtures.includes(fixtureId))throw new BatchError('CAMPAIGN_INVALID',`runs[${i}]: fixture ${fixtureId} is not one ${scenarioId} runs on`);
  const p=exact(e.policyRef,['id','revision','hash'],`runs[${i}].policyRef`);
  id(p.id,`runs[${i}].policyRef.id`);int(p.revision,1,2**31,`runs[${i}].policyRef.revision`);if(typeof p.hash!=='string'||!HEX.test(p.hash))throw new BatchError('CAMPAIGN_INVALID',`runs[${i}].policyRef.hash`);
  if(!Array.isArray(e.expectedAssertions)||!e.expectedAssertions.length||e.expectedAssertions.length>32)throw new BatchError('CAMPAIGN_INVALID',`runs[${i}].expectedAssertions must list 1..32 ids`);
  const repeat=int(e.repeat,1,20,`runs[${i}].repeat`);
  for(const a of e.expectedAssertions){
   if(typeof a!=='string'||!(spec.oracles.includes(a)||(CAMPAIGN_ASSERTIONS as readonly string[]).includes(a)))throw new BatchError('CAMPAIGN_INVALID',`runs[${i}]: ${String(a)} is not an assertion of ${scenarioId}`);
   if(a==='REPEATABLE'&&repeat<2)throw new BatchError('CAMPAIGN_INVALID',`runs[${i}]: REPEATABLE needs repeat >= 2`);
  }
  // every entry is judged by at least one oracle of its own run: campaign-level checks alone (repeatability, noise) never stand in for a business/trace verdict
  if(!(e.expectedAssertions as string[]).some(a=>spec.oracles.includes(a)))throw new BatchError('CAMPAIGN_INVALID',`runs[${i}]: expectedAssertions name no oracle of ${scenarioId} (campaign-level checks alone are not a verdict)`);
  return {scenarioId,scenarioRevision:scenario.revision,fixtureId,seed:int(e.seed,0,0xffffffff,`runs[${i}].seed`),repeat,policyRef:{id:p.id as string,revision:p.revision as number,hash:p.hash as string},expectedAssertions:[...new Set(e.expectedAssertions as string[])]};
 });
 if(planes.size!==1)throw new BatchError('CAMPAIGN_INVALID',`a campaign runs on one plant; this one names ${[...planes].join(' and ')||'none'}`);
 if(runs.reduce((n,r)=>n+r.repeat,0)>MAX_RUNS)throw new BatchError('CAMPAIGN_INVALID',`more than ${MAX_RUNS} runs`);
 // deep-frozen: the loaded campaign is what the summary's digest names; nothing downstream can change an entry after loading
 return {campaign:Object.freeze({schemaVersion:1,id:c.id as string,title:c.title as string,runs:Object.freeze(runs.map(r=>Object.freeze({...r,policyRef:Object.freeze(r.policyRef),expectedAssertions:Object.freeze(r.expectedAssertions)})))}) as unknown as Campaign,bytes,sha256:sha256(bytes),plant:[...planes][0]!};
}

/** `evidenceComplete`: the durable evidence read back complete; `evidenceAsExpected`: complete, or exactly the gap a fault case declares (IR10). `kind`/`label` name the case honestly. */
export interface RunRecord{id:string;index:number;scenarioId:string;fixtureId:string;seed:number;repeat:number;expectedAssertions:string[];result:BatchResult;reasons:string[];
 kind?:string;label?:string;stepTicks?:number;/** Webots only: the largest drive-frame pose difference between this run's repeats of one seed (m) */repeatWorstPoseM?:number;
 assertions?:{id:string;result:string}[];digests?:{trajectoryDigest:string;sensorDigest:string;assertionDigest:string;outcomeDigest:string};outcome?:RunReport['outcome'];horizon?:number|null;wallMs?:number;evidenceComplete?:boolean;evidenceAsExpected?:boolean}
/** tmp + fsync + rename: a reader (or a crash) sees the previous summary or this one, never half of it. */
async function writeDurable(file:string,text:string){const tmp=`${file}.tmp`,h=await open(tmp,'w',0o600);try{await h.writeFile(text);await h.sync();}finally{await h.close();}await rename(tmp,file);}
/** The summary's per-run preview (what a UI lists). Bounded copies only: the record itself (and the run.json/assertions.json written from it) keeps everything. */
export const summaryPreview=(r:RunRecord)=>({id:r.id,scenarioId:r.scenarioId,fixtureId:r.fixtureId,seed:r.seed,repeat:r.repeat,result:r.result,...r.kind?{kind:r.kind,label:r.label}:{},...r.stepTicks?{stepTicks:r.stepTicks}:{},
 ...r.repeatWorstPoseM!==undefined?{repeatWorstPoseM:r.repeatWorstPoseM}:{},
 ...r.evidenceComplete!==undefined?{evidenceComplete:r.evidenceComplete,evidenceAsExpected:r.evidenceAsExpected}:{},
 // UI preview only: the durable per-run assertions.json/run.json keep every reason and detail in full
 reasons:r.reasons.slice(0,PREVIEW.reasons).map(x=>x.length>PREVIEW.chars?`${x.slice(0,PREVIEW.chars-1)}…`:x),reasonsTruncated:r.reasons.length>PREVIEW.reasons||r.reasons.some(x=>x.length>PREVIEW.chars),
 ...r.assertions?{assertions:r.assertions}:{},...r.digests?{digests:r.digests}:{},...r.outcome?{outcome:r.outcome}:{},...r.wallMs!==undefined?{wallMs:r.wallMs}:{}});
/** complete = the campaign proved what it set out to: every run ran and passed, its evidence is as its case requires, and every expected assertion is present and passes.
 * Evidence completeness alone is reported apart (summary.evidenceComplete) and never makes a failed campaign complete. */
export const campaignComplete=(records:readonly RunRecord[])=>records.length>0&&records.every(r=>r.result==='pass'&&r.evidenceAsExpected===true&&(r.assertions?.length??0)>0&&r.assertions!.every(a=>a.result==='pass'));
/**
 * pass only with the evidence the case requires, every expected run-level assertion present and passing, and no oracle of the case failing: an oracle the
 * campaign did not list still belongs to the case, so its failure fails the run (it is recorded in assertions.json either way); `r.assertions` lists the expected ones.
 */
export const judgeRun=(r:RunRecord,e:Pick<CampaignEntry,'expectedAssertions'>,oracles:readonly ScenarioAssertion[],timeout:string|null,evidenceReasons:readonly string[])=>{
 r.assertions=e.expectedAssertions.filter(a=>!(CAMPAIGN_ASSERTIONS as readonly string[]).includes(a)).map(a=>({id:a,result:oracles.find(x=>x.id===a)?.result??'missing'}));
 const why:string[]=[];
 if(timeout)why.push(timeout);
 if(!r.evidenceAsExpected)why.push(`EVIDENCE_NOT_AS_EXPECTED:${evidenceReasons.join(',')}`);
 for(const a of r.assertions){const x=oracles.find(y=>y.id===a.id);
  if(!x)why.push(`ASSERTION_MISSING:${a.id}`);else if(x.result==='inconclusive')why.push(`INCONCLUSIVE:${a.id}: ${x.actual}`);else if(x.result==='fail')why.push(`FAIL:${a.id}: expected ${x.expected}; actual ${x.actual}`);}
 for(const x of oracles)if(x.result==='fail'&&!r.assertions.some(a=>a.id===x.id))why.push(`FAIL:${x.id} (not listed by the campaign): expected ${x.expected}; actual ${x.actual}`);
 r.result=why.length?'fail':'pass';r.reasons=why;
};
/** A native compiler port that refuses: the portable profile has its own compiler, and nothing in a campaign may reach the native one. */
const refusingNative:CompilerPort={version:'refused',async compileResolved(){throw new Error('NATIVE_COMPILER_DISABLED');},runnable:()=>false};

/** The server-owned fixture projects compiled by the portable compiler into `<out>/engineering` from a catalog copy in `<out>/catalog` (the campaign's and the measurement's shared setup). */
export async function compileFixtures(o:{root:string;out:string;python:string;fixtureIds:Iterable<string>;plant?:BatchPlant}){
 const plant=o.plant??'irsim_2d',set=SETS[plant],workerRoot=join(o.root,'robotics/navigation-2d'),
  fixtureRoot=plant==='webots_3d'?join(o.root,FIXTURE_3D_DIRECTORY):join(workerRoot,FIXTURE_DIRECTORY),catalog=join(o.out,'catalog');
 const components=JSON.parse(await readFile(join(fixtureRoot,plant==='webots_3d'?FIXTURE_3D_COMPONENTS:FIXTURE_COMPONENTS),'utf8')) as {components:Record<string,unknown>;models:Record<string,unknown>};
 for(const d of ['components','models','documents'])await mkdir(join(catalog,d),{recursive:true});
 const entries=[];
 for(const [digest,c] of Object.entries(components.components)){const file=`components/${digest}.json`;await writeFile(join(catalog,file),JSON.stringify(c));entries.push({file,digest});}
 for(const [digest,m] of Object.entries(components.models))await writeFile(join(catalog,'models',`${digest}.json`),JSON.stringify(m));
 await writeFile(join(catalog,'catalog.json'),JSON.stringify({schemaVersion:1,id:plant==='webots_3d'?'serve-3d-v1':'serve-demo-v1',components:entries,quotes:[]}));
 const compiler=plant==='webots_3d'?createWebotsCompiler():createNavigationCompiler({python:o.python,workerRoot,descriptionHelperRoot:join(o.root,'robotics/simulation')});
 const service=createEngineeringService({directory:join(o.out,'engineering'),catalogRoot:catalog,compiler:refusingNative,compilers:{[set]:compiler}});
 const compiled=new Map<string,{locked:LockedEngineering;scene:NavigationSceneV1}|{error:string}>();
 for(const fixtureId of new Set(o.fixtureIds)){
  try{
   const project=JSON.parse(await readFile(join(fixtureRoot,NAVIGATION_FIXTURES[fixtureId]!.project),'utf8')) as EngineeringProject;
   const receipt=await service.compileEngineeringProject(project,'campaign');
   if(receipt.state!=='compiled')throw new Error(`FIXTURE_NOT_COMPILED:${receipt.problems.map(p=>p.code).join(',').slice(0,200)}`);
   const locked=await service.admitRun('campaign',{bundleDigest:receipt.bundleDigest,projectDigest:receipt.projectDigest},set,undefined);
   const scene=JSON.parse(Buffer.from(await service.bundleFile(receipt.bundleDigest!,'navigation-scene.json')).toString('utf8')) as NavigationSceneV1;
   if(JSON.stringify([...scene.robots.map(r=>r.robotId)].sort())!==JSON.stringify([...NAVIGATION_FIXTURES[fixtureId]!.robots].sort()))throw new Error('FIXTURE_ROBOTS_MISMATCH');
   compiled.set(fixtureId,{locked,scene});
  }catch(e){compiled.set(fixtureId,{error:(e as Error).message.slice(0,300)});}
 }
 return {service,compiled};
}
/** Scenario definitions a batch (or a measurement) may run: the gateway registry plus the campaign-only rig, and the IR set extended with the rig ids. */
export const batchScenarios=(catalog:Awaited<ReturnType<typeof portableSimulationFromOptions>>['catalog'],plant:BatchPlant='irsim_2d')=>{
 if(plant==='webots_3d')return {catalog,scenarios:new Map(scenarioRegistry)}; // no contention rig on the Webots plant in this release
 const scenarios=new Map([...scenarioRegistry,...RIG_SCENARIOS]),set=catalog.sets[SET]!;
 return {catalog:{...catalog,sets:{...catalog.sets,[SET]:{...set,scenarioIds:[...set.scenarioIds??[],...RIG_SCENARIOS.keys()]}}},scenarios};
};

export async function runIRSimBatch(o:BatchOptions):Promise<BatchSummary>{
 const root=resolve(o.sourceRoot??SOURCE_ROOT),out=resolve(o.outDir),summaryPath=join(out,'summary.json');
 if(o.concurrency!==1&&o.concurrency!==2)throw new BatchError('USAGE','concurrency is 1 or 2');
 if(typeof o.sourceCommit!=='string'||!o.sourceCommit)throw new BatchError('USAGE','sourceCommit required');
 const {campaign,bytes,sha256:campaignSha,plant}=await loadCampaign(o.campaignPath,root);
 if(o.plant&&o.plant!==plant)throw new BatchError('USAGE',`this is a ${plant} campaign, not a ${o.plant} one`);
 if(plant==='webots_3d'&&o.concurrency!==1)throw new BatchError('USAGE','a Webots campaign runs with concurrency 1 (one Webots world per host)');
 // fresh output only: an earlier campaign's directory is never reused, merged or overwritten
 await mkdir(out,{recursive:true,mode:0o700});
 if((await readdir(out)).length)throw new BatchError('OUT_DIR_NOT_EMPTY',out);
 await writeFile(join(out,'campaign.json'),bytes,{mode:0o600,flag:'wx'});
 const provider=o.entry?{id:plant,kind:'protocol_double',note:`worker test double: protocol wiring only, never ${plant} evidence`}:{id:plant,kind:plant==='webots_3d'?'webots_engine':'irsim_worker'};
 const records:RunRecord[]=[];let n=0;
 // repeats are paced differently (500, 25, 100 ticks per step request): REPEATABLE across them is also IR09's pacing invariance
 const PACING=[500,25,100];
 campaign.runs.forEach((e,i)=>{const spec=SCENARIO_FIXTURES.get(e.scenarioId)!;for(let k=1;k<=e.repeat;k++)records.push({id:`${String(++n).padStart(3,'0')}-${e.scenarioId}-${e.fixtureId}-s${e.seed}-r${k}`,index:i,scenarioId:e.scenarioId,fixtureId:e.fixtureId,seed:e.seed,repeat:k,expectedAssertions:e.expectedAssertions,
  kind:spec.kind??'scenario',label:spec.label,stepTicks:o.stepTicks??PACING[(k-1)%PACING.length],result:'not_run',reasons:['NOT_STARTED']});});
 let status:BatchSummary['status']='failed';const reasons:string[]=[],started=new Date().toISOString();
 // one writer: every summary write waits for the previous one, so the file on disk always moves forward
 let writing=Promise.resolve();
 const save=(final:boolean)=>{const body=JSON.stringify({schemaVersion:1,documentType:'irsim-campaign-summary',status:final?status:'running',campaignId:campaign.id,campaignSha256:campaignSha,sourceCommit:o.sourceCommit,...o.identity?{identity:o.identity}:{},provider,concurrency:o.concurrency,startedAt:started,...final?{finishedAt:new Date().toISOString()}:{},
  reasons,complete:final&&isComplete(),evidenceComplete:records.every(r=>r.evidenceComplete===true),runs:records.map(summaryPreview)},null,1)+'\n';writing=writing.then(()=>writeDurable(summaryPath,body));return writing;};
 const isComplete=()=>campaignComplete(records);
 const finish=async(s:BatchSummary['status']):Promise<BatchSummary>=>{status=s;await save(true);return {runs:records.map(r=>({id:r.id,result:r.result})),complete:isComplete(),status,summaryPath,reasons:[...reasons]};};
 // the durable marker comes first: a campaign that dies from here on leaves status 'running', complete false and every unfinished run not_run
 await save(false);

 // ---- prerequisites: the real worker answers describe with the pinned versions and lock; nothing else is tried in its place ----
 const workerRoot=join(root,'robotics/navigation-2d'),python=o.python??join(root,'.venv-irsim/bin/python'),schemaDir=join(root,'packages/contracts/schemas');
 let portable:Awaited<ReturnType<typeof portableSimulationFromOptions>>|undefined,webots:WebotsProvider|undefined,runtime:IRSimRuntimeOptions|undefined,catalogOf:Awaited<ReturnType<typeof portableSimulationFromOptions>>['catalog'],enabledBackends:readonly string[];
 if(plant==='irsim_2d'){
  portable=await portableSimulationFromOptions({enabled:true,python,workerRoot,lockPath:join(workerRoot,'requirements.lock'),directory:join(out,'probe'),schemaDir,...o.entry?{entry:o.entry}:{}});
  if(portable.unavailable||!portable.describe){reasons.push(`PREREQUISITE_MISSING:${portable.unavailable??'IRSIM_WORKER_UNAVAILABLE'}`);for(const r of records)r.reasons=[...reasons];return finish('not_run');}
  runtime={python,workerRoot,schemaDir,lockDigest:portable.describe.lockDigest,...o.entry?{entry:o.entry}:{},maxActiveRuns:2};catalogOf=portable.catalog;enabledBackends=portable.enabledBackends;
 }else{
  const webotsRoot=join(root,'robotics/simulation-3d');
  webots=await webotsFromOptions({enabled:true,python:o.webotsPython??join(root,'.venv-webots/bin/python'),workerRoot:webotsRoot,lockPath:join(webotsRoot,'requirements.lock'),webotsHome:o.webotsHome??process.env.MEKONIQ_WEBOTS_HOME??'/Applications/Webots.app',directory:join(out,'probe'),schemaDir,...o.entry?{entry:o.entry}:{}});
  if(!webots.plant){reasons.push(`PREREQUISITE_MISSING:${webots.capability.reason??'WEBOTS_UNAVAILABLE'}`);for(const r of records)r.reasons=[...reasons];return finish('not_run');}
  catalogOf={...defaultCatalog,backends:defaultCatalog.backends.map(b=>b.id==='webots_3d'?webots!.capability:b)};enabledBackends=['webots_3d'];
 }

 // ---- fixtures: compiled once each by the plant's own compiler from the server-owned files ----
 const {service,compiled}=await compileFixtures({root,out,python,plant,fixtureIds:new Set(records.map(r=>r.fixtureId))});

 // ---- runs: a pool of at most `concurrency` worlds; a signal stops scheduling and closes what runs ----
 // campaign-only rig definitions run here and only here: the gateway's catalog and registry never contain them
 const {catalog:batchCatalog,scenarios}=batchScenarios(catalogOf,plant),providerOf={catalog:batchCatalog,enabledBackends,scenarios};
 /** Worker processes of one run: their argv names the run's own bundle root (never matched by pattern on anything else). */
 const workersOf=(dir:string)=>{try{return execFileSync('ps',['-A','-o','pid=,command='],{encoding:'utf8'}).split('\n').filter(l=>l.includes(`--bundle-root ${join(dir,'run','bundle')} `)&&!l.includes('lab-irsim')).map(l=>Number(l.trim().split(/\s+/)[0]));}catch{return [];}};
 /** Webots engine processes (anchored at the start of the command line: a shell that merely mentions the path never matches). One world per host, so those of this campaign are all of them. */
 const enginesOf=()=>{try{return execFileSync('ps',['-A','-o','pid=,command='],{encoding:'utf8'}).split('\n').filter(l=>/^\s*\d+\s+\S*\/Contents\/MacOS\/webots(\s|$)/.test(l)).map(l=>Number(l.trim().split(/\s+/)[0]));}catch{return [];}};
 const judge=judgeRun,poseTraces=new Map<string,number[]>();
 /** Drive-frame poses of every tick of the completed Webots runs (a repeat is compared against these, not against a digest). */
 /** IR06 raw drive (test-only, never admitted by the gateway): the compiled scene, the real worker, raw velocities, the evidence recorder; no controller, no source session. */
 const rawDrive=async(r:RunRecord,e:CampaignEntry,spec:ScenarioFixtureSpec,locked:LockedEngineering,scene:NavigationSceneV1,dir:string)=>{
  const bundle=join(dir,'run','bundle');
  for(const f of ['navigation-scene.json',...scene.files.map(x=>x.path)]){await mkdir(dirname(join(bundle,f)),{recursive:true});await writeFile(join(bundle,f),await service.bundleFile(locked.ref.bundleDigest,f),{mode:0o600,flag:'wx'});}
  const runId=`raw-${r.id}`,w=await spawnIRSimWorker({python,workerRoot,runId,bundleRoot:bundle,runDirectory:join(dir,'run','worker'),lockDigest:runtime!.lockDigest,schemaDir:runtime!.schemaDir,sceneDigest:scene.sceneDigest,...o.entry?{entry:o.entry}:{}});
  const rec=await openNavigationRecorder({directory:join(dir,'run','evidence'),scene,runId});
  const named=new Set<string>();
  try{
   let q=0,tick=0;
   const ask=async(op:string,payload:Record<string,unknown>)=>{const res=await w.request({protocol:'mekoniq-irsim/1',requestId:`q${++q}`,runId,expectedTick:tick,op,payload} as never);if(!res.ok)throw new Error(`${op}:${res.error.code}`);tick=res.tick;return res.result as IRSimSnapshotV1;};
   await rec.append(await ask('create',{sceneRef:'navigation-scene.json',seed:e.seed}),null);await ask('start',{});
   for(let k=1;k<=spec.raw!.ticks;k++){const payload={targetTick:k,velocities:spec.raw!.velocities.map(v=>({...v})),actorUpdates:[]};const snap=await ask('step',payload);for(const x of snap.robots)for(const c of x.collisionIds)named.add(c);await rec.append(snap,payload);}
   await rec.flush();
  }finally{await w.close('raw drive over').catch(()=>{});}
  const listed=rec.committed();await rec.close().catch(()=>{});
  const read=await readNavigationEvidence(join(dir,'run','evidence'),listed,{scene}),m=navigationMetrics(scene,read),ids=scene.robots.map(x=>x.robotId).sort();
  const pair=ids.join('|'),touch=read.trajectory.find(t=>t.robots.some(x=>x.collisionIds.length)),last=read.trajectory.at(-1);
  const say=(id:string,ok:boolean,expected:string,actual:string,oracle:string):ScenarioAssertion=>({id,result:ok?'pass':'fail',expected,actual,oracle});
  const oracles=[
   say('EVIDENCE_COMPLETE',read.complete,'every tick 0..N recorded and verified',`read ${read.complete?'complete':'incomplete'} horizon ${read.horizon}`,'readNavigationEvidence'),
   say('CONTACT_NAMED_BY_ID',!!touch&&named.size>0&&[...named].every(x=>ids.includes(x))&&touch.robots.every(x=>x.collisionIds.join()===ids.filter(i=>i!==x.robotId).join()),'each robot names the other by robotId, never an engine index',touch?`${JSON.stringify(Object.fromEntries(touch.robots.map(x=>[x.robotId,x.collisionIds])))} at ${touch.tick}; all ids ${[...named].join(',')}`:'no contact','engine snapshots as recorded'),
   say('ONE_ENGINE_EPISODE_PER_PAIR',m.episodes.filter(x=>x.source==='engine_discrete').map(x=>x.pair.join('|')).join()===pair,'one engine_discrete episode for the unordered pair, though both robots report it',JSON.stringify(m.episodes.filter(x=>x.source==='engine_discrete')),'collisionEpisodes over the trace'),
   say('ORACLE_AGREES_CONTACT',m.episodes.some(x=>x.source==='swept_oracle'&&x.pair.join('|')===pair)&&m.minSeparationM===0,'the independent polygon oracle finds the same pair in contact',`swept episodes ${m.episodes.filter(x=>x.source==='swept_oracle').length}, minSeparationM ${m.minSeparationM}`,'assessTrajectory'),
   say('STOPPED_AT_CONTACT',!!last&&!!touch&&last.robots.every(x=>Math.abs(x.bodyVelocity[0])<1e-9),'collision_mode stop: both robots stand still after the contact (no motion through each other)',last?JSON.stringify(last.robots.map(x=>[x.robotId,x.bodyVelocity])):'no trace','last recorded tick'),
  ];
  r.horizon=read.horizon;r.evidenceComplete=read.complete;r.evidenceAsExpected=read.complete;
  await writeFile(join(dir,'assertions.json'),JSON.stringify({runId,scenarioId:e.scenarioId,kind:r.kind,label:r.label,fixtureId:r.fixtureId,seed:e.seed,expected:e.expectedAssertions,oracles,evidence:listed},null,1)+'\n',{mode:0o600,flag:'wx'});
  judge(r,e,oracles,null,read.reasons);
 };
 const runOne=async(r:RunRecord)=>{
  const e=campaign.runs[r.index]!,spec=SCENARIO_FIXTURES.get(e.scenarioId)!,fx=compiled.get(r.fixtureId)!,dir=join(out,'runs',r.id),t0=Date.now();
  if(o.signal?.aborted){r.reasons=['INTERRUPTED'];return;}
  if('error' in fx){r.result='fail';r.reasons=[`FIXTURE_COMPILE_FAILED:${fx.error}`];return;}
  const {locked,scene}=fx,policy=scene.policy;
  if(policy.id!==e.policyRef.id||policy.revision!==e.policyRef.revision||policy.hash!==e.policyRef.hash){r.result='fail';r.reasons=[`POLICY_MISMATCH: campaign ${e.policyRef.id}@${e.policyRef.revision} ${e.policyRef.hash.slice(0,12)}, bundle ${policy.id}@${policy.revision} ${policy.hash.slice(0,12)}`];return;}
  await mkdir(dir,{recursive:true,mode:0o700});
  r.reasons=['RUNNING'];await save(false);
  let run:ScenarioRun|undefined;
  try{
   if(spec.kind==='raw_drive'){await rawDrive(r,e,spec,locked,scene,dir);return;}
   const base=spec.runs??e.scenarioId,def=scenarios.get(base)!;
   const input={project:locked.runtimeProjection.project,scenarioId:base,scenarioRevision:def.revision,seed:e.seed,mode:'simulation' as const,access:'simulated' as const,backendSetId:SETS[plant],sourceCommit:o.sourceCommit,engineering:locked};
   run=plant==='irsim_2d'?await createIRSimScenarioRun(input,{directory:join(dir,'run'),...providerOf,bundleFile:(d,p)=>service.bundleFile(d,p),irsim:runtime!})
    :await createFixedStepScenarioRun(input,{directory:join(dir,'run'),...providerOf,bundleFile:(d,p)=>service.bundleFile(d,p),plant:webots!.plant!.port,runtime:webots!.plant!.runtime as never});
   let v=await run.start(),timedOut=false;
   const deadline=t0+(o.runTimeoutMs??600_000),max=def.maxTicks,operator:{cancelTick?:number;killTick?:number;workersAfterKill?:number}={};
   const start=new Map(v.entities.map(x=>[x.id,x.pose]));
   const away=()=>v.entities.some(x=>x.moving&&Math.hypot(x.pose.x-start.get(x.id)!.x,x.pose.y-start.get(x.id)!.y)>0.5);
   const step=async(ticks:number)=>{v=await run!.action({actionId:`campaign-step-${v.tick}`,expectedRevision:v.run.runRevision,kind:'step',payload:{ticks:Math.min(ticks,max-v.tick)}});};
   while(['running','awaiting_confirmation'].includes(v.run.status)&&v.tick<max){
    if(o.signal?.aborted)break;
    if(Date.now()>deadline){timedOut=true;break;}
    // scripted operator acts, checked every 25 ticks (a fixed cadence: the act lands on the same tick for the same seed)
    if(spec.operator?.cancelWhenMoving&&operator.cancelTick===undefined&&away()){
     operator.cancelTick=v.tick;v=await run.action({actionId:'campaign-cancel',expectedRevision:v.run.runRevision,kind:'cancel',payload:{}});continue;
    }
    if(spec.operator?.killWorkerOnTableLeg&&operator.killTick===undefined&&v.entities.some(x=>x.moving)&&(await run.journal()).some(j=>j.events.some(x=>x.type==='CargoLoaded'))){
     operator.killTick=v.tick;const pids=workersOf(dir);if(pids.length!==1)throw new Error(`WORKER_NOT_FOUND:${pids.length}`);process.kill(pids[0]!,'SIGKILL');
     await step(25);operator.workersAfterKill=workersOf(dir).length;continue;
    }
    if(spec.operator?.killEngineOnTableLeg&&operator.killTick===undefined&&v.entities.some(x=>x.moving)&&(await run.journal()).some(j=>j.events.some(x=>x.type==='CargoLoaded'))){
     // the engine dies between steps: no resend, no second engine. Its controllers exit by themselves within a few ticks of the pipe closing, so the count is taken after they had time to.
     operator.killTick=v.tick;const pids=enginesOf();if(pids.length!==1)throw new Error(`ENGINE_NOT_FOUND:${pids.length}`);process.kill(pids[0]!,'SIGKILL');
     await step(25);
     for(let k=0;k<30&&(enginesOf().length||workersOf(dir).length);k++)await new Promise(res=>setTimeout(res,100));
     operator.workersAfterKill=enginesOf().length+workersOf(dir).length;continue;
    }
    await step(spec.operator?25:r.stepTicks!);
   }
   if(operator.killTick!==undefined)operator.workersAfterKill=Math.max(operator.workersAfterKill??0,plant==='webots_3d'?enginesOf().length+workersOf(dir).length:workersOf(dir).length);
   const report=await run.report();
   await writeFile(join(dir,'report.json'),JSON.stringify(report)+'\n',{mode:0o600,flag:'wx'});
   const ev=report.navigation2d,read=ev?await readNavigationEvidence(join(dir,'run','evidence'),{chunks:ev.artifacts,...ev.recording},{scene}):null;
   const fixture=resolveScenarioFixture(base,scene,e.seed);
   const oracles:ScenarioAssertion[]=read?scenarioAssertions({report,read,scene,fixture,caseId:e.scenarioId,operator}):[];
   const evidence=(ev?.assertions??[]).map(a=>({id:`evidence:${a.id}`,result:a.result,detail:a.detail}));
   await writeFile(join(dir,'assertions.json'),JSON.stringify({runId:report.manifest.runId,scenarioId:e.scenarioId,kind:r.kind,label:r.label,fixtureId:r.fixtureId,seed:e.seed,stepTicks:r.stepTicks,operator,expected:e.expectedAssertions,oracles,evidence},null,1)+'\n',{mode:0o600,flag:'wx'});
   r.outcome=report.outcome;r.horizon=read?.horizon??null;r.evidenceComplete=!!read?.complete&&ev?.completeness?.status==='complete';
   r.evidenceAsExpected=(spec.evidence??'complete')==='complete'?r.evidenceComplete:oracles.find(x=>x.id==='EVIDENCE_GAP_AS_DECLARED')?.result==='pass';
   if(plant==='webots_3d'&&read&&read.complete)poseTraces.set(r.id,read.trajectory.flatMap(t=>t.robots.flatMap(x=>x.poseDriveMap)));
   r.digests=ev?{trajectoryDigest:ev.digests.trajectoryDigest,sensorDigest:ev.digests.sensorDigest,assertionDigest:ev.digests.assertionDigest,outcomeDigest:outcomeDigest(report)}:undefined;
   if(o.signal?.aborted&&!['completed','cancelled','needs_attention'].includes(report.outcome.status)){r.result='not_run';r.reasons=['INTERRUPTED'];return;}
   judge(r,e,oracles,timedOut?`RUN_TIMEOUT:${o.runTimeoutMs??600_000}ms at tick ${report.outcome.tick}`:null,ev?.completeness?.reasons??['no evidence']);
  }catch(err){r.result='fail';r.reasons=[`RUN_ERROR:${(err as Error).message.slice(0,300)}`];}
  finally{await run?.close().catch(()=>{});r.wallMs=Date.now()-t0;
   await writeFile(join(dir,'run.json'),JSON.stringify({...r,provider},null,1)+'\n',{mode:0o600}).catch(()=>{});await save(false);}
 };
 const queue=[...records];
 await Promise.all(Array.from({length:o.concurrency},async()=>{for(let r=queue.shift();r;r=queue.shift()){if(o.signal?.aborted){r.reasons=['INTERRUPTED'];continue;}await runOne(r);}}));

 // ---- campaign assertions: the same seed must reproduce its digests; noise must be visible against a noise-free twin of the same scenario ----
 for(const r of records){
  if(r.result!=='pass')continue;
  const why:string[]=[];
  if(r.expectedAssertions.includes('REPEATABLE')){
   const group=records.filter(x=>x.index===r.index);
   if(plant==='webots_3d'){
    // the engine is not bit-reproducible (1e-12 m was measured): same seed means the same business outcome tick for tick and every pose within the oracle profile's tolerance
    const tol=loadOracleProfile().profile.webots!.repeatPoseM,first=poseTraces.get(group[0]!.id),sameOutcome=group.every(x=>x.outcome&&x.outcome.status===group[0]!.outcome?.status&&x.outcome.tick===group[0]!.outcome?.tick&&x.outcome.served===group[0]!.outcome?.served);
    let worst=0,comparable=!!first;
    for(const x of group.slice(1)){const t=poseTraces.get(x.id);if(!first||!t||t.length!==first.length){comparable=false;break;}for(let k=0;k<t.length;k++)worst=Math.max(worst,Math.abs(t[k]!-first[k]!));}
    const ok=group.every(x=>x.result==='pass')&&comparable&&sameOutcome&&worst<=tol;
    r.assertions?.push({id:'REPEATABLE',result:ok?'pass':'fail'});r.repeatWorstPoseM=comparable?worst:undefined;
    if(!ok)why.push(`FAIL:REPEATABLE: ${group.length} runs of seed ${r.seed}: ${comparable?`worst pose difference ${worst} m (tolerance ${tol} m)`:'traces not comparable'}${sameOutcome?'':', outcomes differ'}`);
   }else{
   const ok=group.every(x=>x.result==='pass'&&x.digests)&&new Set(group.map(x=>JSON.stringify(x.digests))).size===1;
   r.assertions?.push({id:'REPEATABLE',result:ok?'pass':'fail'});if(!ok)why.push(`FAIL:REPEATABLE: ${group.length} runs of seed ${r.seed} give ${new Set(group.map(x=>JSON.stringify(x.digests))).size} digest set(s)`);
   }
  }
  if(r.expectedAssertions.includes('NOISE_VISIBLE')){
   const twin=records.find(x=>x.scenarioId===r.scenarioId&&x.fixtureId==='serve-demo-v1'&&x.result==='pass');
   const delta=twin?await tick0ScanDelta(join(out,'runs',r.id),join(out,'runs',twin.id)):null;
   const ok=delta!==null&&delta.meanAbsM>0.002&&delta.meanAbsM<0.03&&delta.beams>100;
   r.assertions?.push({id:'NOISE_VISIBLE',result:ok?'pass':'fail'});
   if(!ok)why.push(`FAIL:NOISE_VISIBLE: tick-0 scan vs noise-free ${twin?.id??'(no passing noise-free twin)'}: ${delta?`${delta.beams} hit beams, mean |dr| ${delta.meanAbsM.toFixed(5)} m`:'not comparable'} (expected 0.002..0.03 m for stddev 0.01)`);
  }
  if(why.length||r.repeatWorstPoseM!==undefined){if(why.length){r.result='fail';r.reasons=why;}await writeFile(join(out,'runs',r.id,'run.json'),JSON.stringify({...r,provider},null,1)+'\n',{mode:0o600});}
 }
 if(o.signal?.aborted){reasons.push('INTERRUPTED');return finish('interrupted');}
 return finish(records.every(r=>r.result==='pass')&&isComplete()?'completed':'failed');
}

/** Mean |range difference| of the first LiDAR publication (tick 0: both robots stand at the same start pose) between two run directories, over beams that hit in both. */
async function tick0ScanDelta(a:string,b:string){
 const scan=async(dir:string)=>{const report=JSON.parse(await readFile(join(dir,'report.json'),'utf8')) as RunReport,ev=report.navigation2d!,scene=JSON.parse(await readFile(join(dir,'run','bundle','navigation-scene.json'),'utf8')) as NavigationSceneV1;
  return (await readNavigationEvidence(join(dir,'run','evidence'),{chunks:ev.artifacts,...ev.recording},{scene})).sensors.find(s=>s.tick===0)?.scan;};
 const [x,y]=await Promise.all([scan(a),scan(b)]);if(!x||!y||x.rangesM.length!==y.rangesM.length)return null;
 let sum=0,beams=0;x.rangesM.forEach((v,i)=>{const w=y.rangesM[i];if(v!==null&&w!==null&&w!==undefined){sum+=Math.abs(v-w);beams++;}});
 return beams?{meanAbsM:sum/beams,beams}:null;
}
