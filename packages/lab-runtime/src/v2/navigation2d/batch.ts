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
import type {CompilerPort} from '../../engineering/gateway';
import type {EngineeringProject} from '../../engineering/contracts';
import {defaultCatalog} from '../capabilities';
import {scenarioRegistry} from '../scenario-registry';
import {outcomeDigest,type RunReport} from '../report';
import type {ScenarioRun} from '../scenario-runner';
import type {NavigationSceneV1} from './contracts';
import {readNavigationEvidence} from './evidence';
import {portableSimulationFromOptions} from './readiness';
import {createIRSimScenarioRun,type IRSimRuntimeOptions} from './runner';
import {FIXTURE_COMPONENTS,FIXTURE_DIRECTORY,NAVIGATION_FIXTURES,SCENARIO_FIXTURES,resolveScenarioFixture,scenarioAssertions,type ScenarioAssertion} from './scenario-fixtures';

export type BatchResult='pass'|'fail'|'not_run';
export interface BatchSummary{runs:{id:string;result:BatchResult}[];complete:boolean;
 /** completed: every run ran and passed; failed: a run failed or is incomplete; not_run: a prerequisite is missing (nothing ran); interrupted: stopped by a signal */
 status:'completed'|'failed'|'not_run'|'interrupted';summaryPath:string;reasons:string[]}
/** Operator-only options (CLI flags), never fields of a campaign or a request. `entry` selects a worker test double: its runs are labelled protocol_double, never irsim_2d evidence. */
export interface BatchOptions{campaignPath:string;outDir:string;concurrency:1|2;sourceCommit:string;
 sourceRoot?:string;python?:string;entry?:string[];runTimeoutMs?:number;signal?:AbortSignal;stepTicks?:number}
export interface CampaignEntry{scenarioId:string;scenarioRevision:number;fixtureId:string;seed:number;repeat:number;policyRef:{id:string;revision:number;hash:string};expectedAssertions:string[]}
export interface Campaign{schemaVersion:1;id:string;title:string;runs:CampaignEntry[]}
const SET='engineering-irsim-2d-v1',MAX_CAMPAIGN_BYTES=64*1024,MAX_RUNS=200,PREVIEW={reasons:10,chars:200};
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
export async function loadCampaign(path:string,sourceRoot=SOURCE_ROOT):Promise<{campaign:Campaign;bytes:Buffer;sha256:string}>{
 const allowed=resolve(sourceRoot,'robotics/navigation-2d/campaigns'),abs=resolve(path);
 if(!abs.endsWith('.json'))throw new BatchError('CAMPAIGN_PATH_REJECTED','a campaign is a .json file');
 // inside the allowlisted directory as written (resolve() already folded any '..'), and no symbolic link below it: the real path is the directory's real path + the same rest
 const rel=relative(allowed,abs);
 if(!abs.startsWith(allowed+sep)||!rel||rel.split(sep).includes('..'))throw new BatchError('CAMPAIGN_PATH_REJECTED',`${path} is not a file inside robotics/navigation-2d/campaigns`);
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
 const set=defaultCatalog.sets[SET]!;
 const runs=c.runs.map((raw,i):CampaignEntry=>{
  const e=exact(raw,['scenarioId','scenarioRevision','fixtureId','seed','repeat','policyRef','expectedAssertions'],`runs[${i}]`);
  const scenarioId=id(e.scenarioId,`runs[${i}].scenarioId`),fixtureId=id(e.fixtureId,`runs[${i}].fixtureId`),scenario=scenarioRegistry.get(scenarioId),spec=SCENARIO_FIXTURES.get(scenarioId);
  if(!scenario||!spec||!set.scenarioIds?.includes(scenarioId))throw new BatchError('CAMPAIGN_INVALID',`runs[${i}]: ${scenarioId} is not an IR-SIM scenario of ${SET}`);
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
  return {scenarioId,scenarioRevision:scenario.revision,fixtureId,seed:int(e.seed,0,0xffffffff,`runs[${i}].seed`),repeat,policyRef:{id:p.id as string,revision:p.revision as number,hash:p.hash as string},expectedAssertions:[...new Set(e.expectedAssertions as string[])]};
 });
 if(runs.reduce((n,r)=>n+r.repeat,0)>MAX_RUNS)throw new BatchError('CAMPAIGN_INVALID',`more than ${MAX_RUNS} runs`);
 // deep-frozen: the loaded campaign is what the summary's digest names; nothing downstream can change an entry after loading
 return {campaign:Object.freeze({schemaVersion:1,id:c.id as string,title:c.title as string,runs:Object.freeze(runs.map(r=>Object.freeze({...r,policyRef:Object.freeze(r.policyRef),expectedAssertions:Object.freeze(r.expectedAssertions)})))}) as unknown as Campaign,bytes,sha256:sha256(bytes)};
}

export interface RunRecord{id:string;index:number;scenarioId:string;fixtureId:string;seed:number;repeat:number;expectedAssertions:string[];result:BatchResult;reasons:string[];
 assertions?:{id:string;result:string}[];digests?:{trajectoryDigest:string;sensorDigest:string;assertionDigest:string;outcomeDigest:string};outcome?:RunReport['outcome'];horizon?:number|null;wallMs?:number;evidenceComplete?:boolean}
/** tmp + fsync + rename: a reader (or a crash) sees the previous summary or this one, never half of it. */
async function writeDurable(file:string,text:string){const tmp=`${file}.tmp`,h=await open(tmp,'w',0o600);try{await h.writeFile(text);await h.sync();}finally{await h.close();}await rename(tmp,file);}
/** The summary's per-run preview (what a UI lists). Bounded copies only: the record itself (and the run.json/assertions.json written from it) keeps everything. */
export const summaryPreview=(r:RunRecord)=>({id:r.id,scenarioId:r.scenarioId,fixtureId:r.fixtureId,seed:r.seed,repeat:r.repeat,result:r.result,
 // UI preview only: the durable per-run assertions.json/run.json keep every reason and detail in full
 reasons:r.reasons.slice(0,PREVIEW.reasons).map(x=>x.length>PREVIEW.chars?`${x.slice(0,PREVIEW.chars-1)}…`:x),reasonsTruncated:r.reasons.length>PREVIEW.reasons||r.reasons.some(x=>x.length>PREVIEW.chars),
 ...r.assertions?{assertions:r.assertions}:{},...r.digests?{digests:r.digests}:{},...r.outcome?{outcome:r.outcome}:{},...r.wallMs!==undefined?{wallMs:r.wallMs}:{}});
/** A native compiler port that refuses: the portable profile has its own compiler, and nothing in a campaign may reach the native one. */
const refusingNative:CompilerPort={version:'refused',async compileResolved(){throw new Error('NATIVE_COMPILER_DISABLED');},runnable:()=>false};

export async function runIRSimBatch(o:BatchOptions):Promise<BatchSummary>{
 const root=resolve(o.sourceRoot??SOURCE_ROOT),out=resolve(o.outDir),summaryPath=join(out,'summary.json');
 if(o.concurrency!==1&&o.concurrency!==2)throw new BatchError('USAGE','concurrency is 1 or 2');
 if(typeof o.sourceCommit!=='string'||!o.sourceCommit)throw new BatchError('USAGE','sourceCommit required');
 const {campaign,bytes,sha256:campaignSha}=await loadCampaign(o.campaignPath,root);
 // fresh output only: an earlier campaign's directory is never reused, merged or overwritten
 await mkdir(out,{recursive:true,mode:0o700});
 if((await readdir(out)).length)throw new BatchError('OUT_DIR_NOT_EMPTY',out);
 await writeFile(join(out,'campaign.json'),bytes,{mode:0o600,flag:'wx'});
 const provider=o.entry?{id:'irsim_2d',kind:'protocol_double',note:'worker test double: protocol wiring only, never irsim_2d evidence'}:{id:'irsim_2d',kind:'irsim_worker'};
 const records:RunRecord[]=[];let n=0;
 campaign.runs.forEach((e,i)=>{for(let k=1;k<=e.repeat;k++)records.push({id:`${String(++n).padStart(3,'0')}-${e.scenarioId}-${e.fixtureId}-s${e.seed}-r${k}`,index:i,scenarioId:e.scenarioId,fixtureId:e.fixtureId,seed:e.seed,repeat:k,expectedAssertions:e.expectedAssertions,result:'not_run',reasons:['NOT_STARTED']});});
 let status:BatchSummary['status']='failed';const reasons:string[]=[],started=new Date().toISOString();
 // one writer: every summary write waits for the previous one, so the file on disk always moves forward
 let writing=Promise.resolve();
 const save=(final:boolean)=>{const body=JSON.stringify({schemaVersion:1,documentType:'irsim-campaign-summary',status:final?status:'running',campaignId:campaign.id,campaignSha256:campaignSha,sourceCommit:o.sourceCommit,provider,concurrency:o.concurrency,startedAt:started,...final?{finishedAt:new Date().toISOString()}:{},
  reasons,complete:final&&isComplete(),runs:records.map(summaryPreview)},null,1)+'\n';writing=writing.then(()=>writeDurable(summaryPath,body));return writing;};
 const isComplete=()=>records.every(r=>r.result!=='not_run'&&r.evidenceComplete===true&&!r.reasons.some(x=>x.startsWith('INCONCLUSIVE:')||x.startsWith('ASSERTION_MISSING:')));
 const finish=async(s:BatchSummary['status']):Promise<BatchSummary>=>{status=s;await save(true);return {runs:records.map(r=>({id:r.id,result:r.result})),complete:isComplete(),status,summaryPath,reasons:[...reasons]};};
 // the durable marker comes first: a campaign that dies from here on leaves status 'running', complete false and every unfinished run not_run
 await save(false);

 // ---- prerequisites: the real worker answers describe with the pinned versions and lock; nothing else is tried in its place ----
 const workerRoot=join(root,'robotics/navigation-2d'),python=o.python??join(root,'.venv-irsim/bin/python');
 const portable=await portableSimulationFromOptions({enabled:true,python,workerRoot,lockPath:join(workerRoot,'requirements.lock'),directory:join(out,'probe'),schemaDir:join(root,'packages/contracts/schemas'),...o.entry?{entry:o.entry}:{}});
 if(portable.unavailable||!portable.describe){reasons.push(`PREREQUISITE_MISSING:${portable.unavailable??'IRSIM_WORKER_UNAVAILABLE'}`);for(const r of records)r.reasons=[...reasons];return finish('not_run');}
 const runtime:IRSimRuntimeOptions={python,workerRoot,schemaDir:join(root,'packages/contracts/schemas'),lockDigest:portable.describe.lockDigest,...o.entry?{entry:o.entry}:{},maxActiveRuns:2};

 // ---- fixtures: compiled once each by the portable compiler from the server-owned files ----
 const fixtureRoot=join(workerRoot,FIXTURE_DIRECTORY),catalog=join(out,'catalog');
 const components=JSON.parse(await readFile(join(fixtureRoot,FIXTURE_COMPONENTS),'utf8')) as {components:Record<string,unknown>;models:Record<string,unknown>};
 for(const d of ['components','models','documents'])await mkdir(join(catalog,d),{recursive:true});
 const entries=[];
 for(const [digest,c] of Object.entries(components.components)){const file=`components/${digest}.json`;await writeFile(join(catalog,file),JSON.stringify(c));entries.push({file,digest});}
 for(const [digest,m] of Object.entries(components.models))await writeFile(join(catalog,'models',`${digest}.json`),JSON.stringify(m));
 await writeFile(join(catalog,'catalog.json'),JSON.stringify({schemaVersion:1,id:'serve-demo-v1',components:entries,quotes:[]}));
 const service=createEngineeringService({directory:join(out,'engineering'),catalogRoot:catalog,compiler:refusingNative,compilers:{[SET]:createNavigationCompiler({python,workerRoot,descriptionHelperRoot:join(root,'robotics/simulation')})}});
 const compiled=new Map<string,{locked:LockedEngineering;scene:NavigationSceneV1}|{error:string}>();
 for(const fixtureId of new Set(records.map(r=>r.fixtureId))){
  try{
   const project=JSON.parse(await readFile(join(fixtureRoot,NAVIGATION_FIXTURES[fixtureId]!.project),'utf8')) as EngineeringProject;
   const receipt=await service.compileEngineeringProject(project,'campaign');
   if(receipt.state!=='compiled')throw new Error(`FIXTURE_NOT_COMPILED:${receipt.problems.map(p=>p.code).join(',').slice(0,200)}`);
   const locked=await service.admitRun('campaign',{bundleDigest:receipt.bundleDigest,projectDigest:receipt.projectDigest},SET,undefined);
   const scene=JSON.parse(Buffer.from(await service.bundleFile(receipt.bundleDigest!,'navigation-scene.json')).toString('utf8')) as NavigationSceneV1;
   if(JSON.stringify([...scene.robots.map(r=>r.robotId)].sort())!==JSON.stringify([...NAVIGATION_FIXTURES[fixtureId]!.robots].sort()))throw new Error('FIXTURE_ROBOTS_MISMATCH');
   compiled.set(fixtureId,{locked,scene});
  }catch(e){compiled.set(fixtureId,{error:(e as Error).message.slice(0,300)});}
 }

 // ---- runs: a pool of at most `concurrency` worlds; a signal stops scheduling and closes what runs ----
 const providerOf={catalog:portable.catalog,enabledBackends:portable.enabledBackends};
 const runOne=async(r:RunRecord)=>{
  const e=campaign.runs[r.index]!,fx=compiled.get(r.fixtureId)!,dir=join(out,'runs',r.id),t0=Date.now();
  if(o.signal?.aborted){r.reasons=['INTERRUPTED'];return;}
  if('error' in fx){r.result='fail';r.reasons=[`FIXTURE_COMPILE_FAILED:${fx.error}`];return;}
  const {locked,scene}=fx,policy=scene.policy;
  if(policy.id!==e.policyRef.id||policy.revision!==e.policyRef.revision||policy.hash!==e.policyRef.hash){r.result='fail';r.reasons=[`POLICY_MISMATCH: campaign ${e.policyRef.id}@${e.policyRef.revision} ${e.policyRef.hash.slice(0,12)}, bundle ${policy.id}@${policy.revision} ${policy.hash.slice(0,12)}`];return;}
  await mkdir(dir,{recursive:true,mode:0o700});
  r.reasons=['RUNNING'];await save(false);
  let run:ScenarioRun|undefined;
  try{
   run=await createIRSimScenarioRun({project:locked.runtimeProjection.project,scenarioId:e.scenarioId,scenarioRevision:e.scenarioRevision,seed:e.seed,mode:'simulation',access:'simulated',backendSetId:SET,sourceCommit:o.sourceCommit,engineering:locked},
    {directory:join(dir,'run'),...providerOf,bundleFile:(d,p)=>service.bundleFile(d,p),irsim:runtime});
   let v=await run.start(),timedOut=false;
   const deadline=t0+(o.runTimeoutMs??600_000),max=scenarioRegistry.get(e.scenarioId)!.maxTicks;
   while(['running','awaiting_confirmation'].includes(v.run.status)&&v.tick<max){
    if(o.signal?.aborted)break;
    if(Date.now()>deadline){timedOut=true;break;}
    v=await run.action({actionId:`campaign-step-${v.tick}`,expectedRevision:v.run.runRevision,kind:'step',payload:{ticks:Math.min(o.stepTicks??500,max-v.tick)}});
   }
   const report=await run.report();
   await writeFile(join(dir,'report.json'),JSON.stringify(report)+'\n',{mode:0o600,flag:'wx'});
   const ev=report.navigation2d,read=ev?await readNavigationEvidence(join(dir,'run','evidence'),{chunks:ev.artifacts,...ev.recording},{scene}):null;
   const fixture=resolveScenarioFixture(e.scenarioId,scene,e.seed);
   const oracles:ScenarioAssertion[]=read?scenarioAssertions({report,read,scene,fixture}):[];
   const evidence=(ev?.assertions??[]).map(a=>({id:`evidence:${a.id}`,result:a.result,detail:a.detail}));
   await writeFile(join(dir,'assertions.json'),JSON.stringify({runId:report.manifest.runId,scenarioId:e.scenarioId,fixtureId:r.fixtureId,seed:e.seed,expected:e.expectedAssertions,oracles,evidence},null,1)+'\n',{mode:0o600,flag:'wx'});
   r.outcome=report.outcome;r.horizon=read?.horizon??null;r.evidenceComplete=!!read?.complete&&ev?.completeness?.status==='complete';
   r.digests=ev?{trajectoryDigest:ev.digests.trajectoryDigest,sensorDigest:ev.digests.sensorDigest,assertionDigest:ev.digests.assertionDigest,outcomeDigest:outcomeDigest(report)}:undefined;
   r.assertions=e.expectedAssertions.filter(a=>!(CAMPAIGN_ASSERTIONS as readonly string[]).includes(a)).map(a=>({id:a,result:oracles.find(x=>x.id===a)?.result??'missing'}));
   const why:string[]=[];
   if(o.signal?.aborted&&!['completed','cancelled','needs_attention'].includes(report.outcome.status)){r.result='not_run';r.reasons=['INTERRUPTED'];return;}
   if(timedOut)why.push(`RUN_TIMEOUT:${o.runTimeoutMs??600_000}ms at tick ${report.outcome.tick}`);
   if(!r.evidenceComplete)why.push(`EVIDENCE_INCOMPLETE:${(ev?.completeness?.reasons??['no evidence']).join(',')}`);
   for(const a of r.assertions){const x=oracles.find(y=>y.id===a.id);
    if(!x)why.push(`ASSERTION_MISSING:${a.id}`);else if(x.result==='inconclusive')why.push(`INCONCLUSIVE:${a.id}: ${x.actual}`);else if(x.result==='fail')why.push(`FAIL:${a.id}: expected ${x.expected}; actual ${x.actual}`);}
   r.result=why.length?'fail':'pass';r.reasons=why;
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
   const ok=group.every(x=>x.result==='pass'&&x.digests)&&new Set(group.map(x=>JSON.stringify(x.digests))).size===1;
   r.assertions?.push({id:'REPEATABLE',result:ok?'pass':'fail'});if(!ok)why.push(`FAIL:REPEATABLE: ${group.length} runs of seed ${r.seed} give ${new Set(group.map(x=>JSON.stringify(x.digests))).size} digest set(s)`);
  }
  if(r.expectedAssertions.includes('NOISE_VISIBLE')){
   const twin=records.find(x=>x.scenarioId===r.scenarioId&&x.fixtureId==='serve-demo-v1'&&x.result==='pass');
   const delta=twin?await tick0ScanDelta(join(out,'runs',r.id),join(out,'runs',twin.id)):null;
   const ok=delta!==null&&delta.meanAbsM>0.002&&delta.meanAbsM<0.03&&delta.beams>100;
   r.assertions?.push({id:'NOISE_VISIBLE',result:ok?'pass':'fail'});
   if(!ok)why.push(`FAIL:NOISE_VISIBLE: tick-0 scan vs noise-free ${twin?.id??'(no passing noise-free twin)'}: ${delta?`${delta.beams} hit beams, mean |dr| ${delta.meanAbsM.toFixed(5)} m`:'not comparable'} (expected 0.002..0.03 m for stddev 0.01)`);
  }
  if(why.length){r.result='fail';r.reasons=why;await writeFile(join(out,'runs',r.id,'run.json'),JSON.stringify(r,null,1)+'\n',{mode:0o600});}
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
