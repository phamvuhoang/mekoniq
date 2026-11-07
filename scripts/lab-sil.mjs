#!/usr/bin/env node
// Lab v2 SIL campaigns on a Linux host with ROS 2 Jazzy + Gazebo Harmonic (robotics/simulation/image.lock.json).
//   node scripts/lab-sil.mjs doctor --backend gazebo_nav2 [--json] [--environment-profile ID]
//   node scripts/lab-sil.mjs run --scenario FD07 --seed 17 [--repeat 3] --out DIR [--backend-set simulation-default]
//   node scripts/lab-sil.mjs run --campaign food-beverage [--seed 23] [--repeat 3] --out DIR     (tests/fixtures/digital-twin/campaigns/<id>.json; every scenario or nothing)
//   node scripts/lab-sil.mjs verify --input DIR
// Exit codes: 0 verified/ok, 1 failed (assertion, zero samples, bad hash), 2 prerequisite or usage missing -> not_run, never a pass with skips.
import {validNativeProfileReport} from './native-sim/profile-report.mjs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),SIM=join(root,'robotics/simulation'),TSX=join(root,'node_modules/.bin/tsx'),CLI=join(root,'packages/lab-runtime/src/v2/sil/cli.ts');
const BACKENDS=['gazebo_nav2','linuxcnc_sim'],ARM=join(root,'integrations/arm-controller');
const sha=(s)=>createHash('sha256').update(s).digest('hex');
const usage=(m)=>{console.error(`${m}\nusage: lab-sil.mjs doctor --backend gazebo_nav2 [--json] [--environment-profile ID] | run (--scenario ID --seed N | --campaign ID [--seed N]) [--repeat N] --out DIR [--backend-set ID] [--environment-profile ID] [--engineering-project PATH] | verify --input DIR`);process.exit(2);};
const SCHEMA={doctor:{backend:'string',json:'flag','environment-profile':'id','native-config':'path'},run:{scenario:'id',campaign:'id',seed:'int',repeat:'int',out:'path','backend-set':'id','environment-profile':'id','native-config':'path','engineering-project':'path'},verify:{input:'path'}};
function parse(command,argv){
 const schema=SCHEMA[command];if(!schema)usage(`UNKNOWN_COMMAND:${command??''}`);
 const o={};
 for(let i=0;i<argv.length;i++){
  const a=argv[i];if(!a.startsWith('--'))usage(`UNEXPECTED_ARGUMENT:${a}`);
  const key=a.slice(2),kind=schema[key];if(!kind)usage(`UNKNOWN_OPTION:${a}`);
  if(kind==='flag'){o[key]=true;continue;}
  const v=argv[++i];if(v===undefined||v.startsWith('--'))usage(`MISSING_VALUE:${a}`);
  if(kind==='int'&&!/^[0-9]{1,9}$/.test(v))usage(`INVALID_INT:${a}`);
  if(kind==='id'&&!/^[A-Za-z0-9_.:-]{1,200}$/.test(v))usage(`INVALID_ID:${a}`);
  o[key]=kind==='int'?Number(v):kind==='path'?resolve(v):v;
 }
 return o;
}
const ok=(cmd,args,opts={})=>{const r=spawnSync(cmd,args,{encoding:'utf8',timeout:20000,...opts});return {ok:r.status===0,detail:(r.stdout||r.stderr||'').trim().split('\n')[0]||(r.error?String(r.error.code??r.error.message):`exit ${r.status}`)};};
export async function doctor(backend,environmentProfile,nativeConfig){
 if(backend==='coffee_io_sim')return {backend,prerequisitesMet:true,checks:[{id:'modeled-coffee-package',ok:existsSync(join(root,'packages/cell-adapters/src/coffee-io-sim.ts')),detail:'coffee_io_sim modeled process'}]};
 if(backend==='linuxcnc_sim'&&nativeConfig){const r=spawnSync(TSX,[CLI,'doctor-arm','--native-config',nativeConfig],{encoding:'utf8',timeout:15000});try{return JSON.parse(r.stdout);}catch{return {backend,prerequisitesMet:false,checks:[{id:'remote-controller-bridge',ok:false,detail:'REMOTE_PROBE_UNREADABLE'}]};}}
 if(backend==='linuxcnc_sim'&&environmentProfile)return {backend,prerequisitesMet:false,checks:[{id:'remote-controller-config',ok:false,detail:'NATIVE_SERVER_CONFIG_REQUIRED'}]};
 if(!BACKENDS.includes(backend))usage(`BACKEND_UNSUPPORTED:${backend}`);
 let image=null;try{image=JSON.parse(await readFile(join(SIM,'image.lock.json'),'utf8'));}catch{image=null;}
 const env={...process.env,PYTHONPATH:`${SIM}:${join(root,'robotics/agent')}`};
 const py=ok('python3',['--version']);
 let environment=null;
 if(environmentProfile){
  if(backend!=='gazebo_nav2')usage('PROFILE_BACKEND_MISMATCH');
  const p=spawnSync('python3',['-m','bridge.native_profile','--profile',environmentProfile],{cwd:SIM,env,encoding:'utf8',timeout:30000});
  try{environment=JSON.parse(p.stdout);if(p.status!==0||!validNativeProfileReport(environment,environmentProfile))throw new Error('invalid');}catch{environment={id:environmentProfile,available:false,reasonCodes:['PROFILE_INVENTORY_UNREADABLE'],image:null};}
  image=null;
 }
 if(backend==='linuxcnc_sim'){
  // the controller package: LinuxCNC + its python module, the bridge's python deps, the pinned profile/model; the bridge itself is started by systemd or by hand
  const checks=[
   {id:'node24',ok:process.versions.node.startsWith('24.'),detail:`node ${process.versions.node}`},
   {id:'linux',ok:process.platform==='linux',detail:`platform ${process.platform} (LinuxCNC runs on Linux only)`},
   {id:'python3',...py},
   {id:'linuxcnc',...ok('linuxcnc',['--version'])},
   {id:'linuxcnc-python',...ok('python3',['-c','import linuxcnc'])},
   {id:'bridge-deps',...ok('python3',['-c','import jsonschema, referencing'],{cwd:ARM})},
   {id:'profile',ok:existsSync(join(ARM,'configs/sim/puma560/profile.json'))&&existsSync(join(ARM,'models/puma560-reference/manifest.json')),detail:'configs/sim/puma560/profile.json + models/puma560-reference/manifest.json'},
   {id:'checker',...ok('python3',['-c','import collision.arm_swept_path'],{cwd:SIM,env})},
  ];
  const report={backend,host:{platform:process.platform,node:process.versions.node,python:py.ok?py.detail:null},image:null,checks,prerequisitesMet:checks.every(c=>c.ok)};
  return {...report,reportSha256:sha(JSON.stringify(report))};
 }
 const checks=[
  {id:'node24',ok:process.versions.node.startsWith('24.'),detail:`node ${process.versions.node}`},
  {id:'linux',ok:process.platform==='linux',detail:`platform ${process.platform} (a Gazebo/Nav2 SIL runs on Linux only)`},
  {id:'python3',...py},
  {id:'python-deps',...ok('python3',['-c','import rfc8785, jsonschema'],{cwd:SIM,env})},
  {id:'compiler',...ok('python3',['-c','import compiler, bridge, actors, metrics, collision, beverage_cell, cup_transfer'],{cwd:SIM,env})},
  {id:'ros2',...ok('ros2',['-h'])},
  {id:'gz',...ok('gz',['sim','--versions'])},
  ...(environment?[{id:'environment-profile',ok:environment.available===true,detail:environment.reasonCodes.join(',')||environment.inventorySha256}]:[{id:'image-lock',ok:!!image&&/^sha256:[0-9a-f]{64}$/.test(String(image.digest)),detail:image?`${image.image}@${image.digest}`:'image.lock.json unreadable'}]),
 ];
 const report={backend,host:{platform:process.platform,node:process.versions.node,python:py.ok?py.detail:null},image,environment,checks,prerequisitesMet:checks.every(c=>c.ok)};
 return {...report,reportSha256:sha(JSON.stringify(report))};
}
const preflightOf=(scenario,backendSet)=>{
 const pre=spawnSync(TSX,[CLI,'preflight','--scenario',scenario,'--backend-set',backendSet],{encoding:'utf8',timeout:120000});
 let parsed=null;try{parsed=JSON.parse(pre.stdout.trim().split('\n').pop());}catch{parsed=null;}
 return parsed??{ok:false,reasons:[`PREFLIGHT_UNREADABLE:${(pre.stdout||pre.stderr).trim().split('\n')[0]??''}`],required:[]};
};
/** A campaign fixture names its scenarios, seeds, repeats and the backend set each needs; --seed/--repeat override for every scenario. */
async function campaignEntries(o){
 let fixture;try{fixture=JSON.parse(await readFile(join(root,'tests/fixtures/digital-twin/campaigns',`${o.campaign}.json`),'utf8'));}catch{usage(`CAMPAIGN_UNKNOWN:${o.campaign}`);}
 if(fixture.schemaVersion!==1||fixture.id!==o.campaign||!Array.isArray(fixture.scenarios)||!fixture.scenarios.length)usage(`CAMPAIGN_INVALID:${o.campaign}`);
 return fixture.scenarios.map(s=>({id:s.id,seed:o.seed??s.seed,repeat:o.repeat??s.repeat,backendSet:s.simulation.backendSetId,requires:s.simulation.requires}));
}
async function run(o){
 if(!o.out)usage('MISSING_OPTION:--out');
 if(o.campaign&&(o.scenario||o['backend-set']))usage('CAMPAIGN_EXCLUDES:--scenario/--backend-set');
 // engineering sets run a compiled project, never a preset; a project with a legacy set is a mistake, not a fallback
 const engineeringSet=String(o['backend-set']??'').startsWith('engineering-');
 if(engineeringSet&&!o['engineering-project'])usage('MISSING_OPTION:--engineering-project');
 if(o['engineering-project']&&!engineeringSet)usage('ENGINEERING_PROJECT_NEEDS_ENGINEERING_BACKEND_SET');
 if(o['engineering-project']&&!/^engineering-(arm64|amd64)$/.test(String(o['environment-profile']??'')))usage('ENGINEERING_PROJECT_NEEDS_ENGINEERING_ENVIRONMENT_PROFILE');
 if(o['engineering-project']&&!existsSync(o['engineering-project']))usage(`ENGINEERING_PROJECT_MISSING:${o['engineering-project']}`);
 if(!o.campaign)for(const k of ['scenario','seed'])if(o[k]===undefined)usage(`MISSING_OPTION:--${k}`);
 const entries=o.campaign?await campaignEntries(o):[{id:o.scenario,seed:o.seed,repeat:o.repeat??1,backendSet:o['backend-set']??'simulation-default',requires:null}];
 for(const e of entries){e.preflight=preflightOf(e.id,e.backendSet);if(e.requires&&e.preflight.ok&&[...e.requires].sort().join()!==[...e.preflight.required].sort().join())e.preflight={...e.preflight,ok:false,reasons:[...e.preflight.reasons,`CAMPAIGN_REQUIRES_MISMATCH:${e.requires.join(',')}`]};}
 const blocked=entries.filter(e=>!e.preflight.ok);
 if(!o.campaign&&blocked.length){console.error(`PREFLIGHT_FAILED: ${JSON.stringify(blocked[0].preflight)}`);process.exit(2);}
 const reports=await Promise.all([...new Set(entries.flatMap(e=>e.preflight.required))].map(b=>doctor(b,o['environment-profile'],o['native-config']??process.env.LAB_NATIVE_CONFIG)));
 const report=reports.length===1?reports[0]:{prerequisitesMet:reports.length>0&&reports.every(r=>r.prerequisitesMet),checks:reports.flatMap(r=>r.checks.map(c=>({...c,id:`${r.backend}:${c.id}`}))),providers:reports};
 await mkdir(o.out,{recursive:true});
 const manifestFile=join(o.out,o.campaign?'campaign-manifest.json':'run-manifest.json');
 const scenarios=entries.map(e=>({scenarioId:e.id,seed:e.seed,repeat:e.repeat,backendSetId:e.backendSet,requiredBackends:e.preflight.required,...e.preflight.ok?{}:{reasons:e.preflight.reasons}}));
 const expectedRuns=entries.reduce((n,e)=>n+e.repeat,0);
 if(!report.prerequisitesMet||blocked.length){
  // every scenario or nothing: a campaign with one blocked scenario is not_run as a whole, never "pass with skips"
  const reasons=[...report.checks.filter(c=>!c.ok).map(c=>`PREREQUISITE_MISSING:${c.id}`),...blocked.map(e=>`SCENARIO_BLOCKED:${e.id}:${e.preflight.reasons.join('|')}`)];
  await writeFile(manifestFile,JSON.stringify({schemaVersion:1,status:'not_run',result:'blocked_external',...o.campaign?{campaignId:o.campaign,scenarios,expectedRuns}:{scenarioId:o.scenario,seed:o.seed,repeat:o.repeat??1,backendSetId:entries[0].backendSet,requiredBackends:entries[0].preflight.required},reasons,doctor:report},null,2)+'\n');
  console.error(`NOT_RUN: ${reasons.join(', ')} (see ${manifestFile})`);process.exit(2);
 }
 const fixtures=join(root,'tests/fixtures/digital-twin');
 const commit=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim();
 if(o.campaign)await writeFile(manifestFile,JSON.stringify({schemaVersion:1,status:'running',campaignId:o.campaign,sourceCommit:commit,scenarios,expectedRuns,doctor:report},null,2)+'\n');
 let failed=0,completed=0;
 for(const e of entries){
  const fixture=join(fixtures,e.preflight.fixture.project),scenarioFile=e.preflight.fixture.scenario?join(fixtures,e.preflight.fixture.scenario):null;
  for(let i=1;i<=e.repeat;i++){
   const dir=o.campaign?join(o.out,e.id,`run-${i}`):join(o.out,`run-${i}`);await mkdir(dir,{recursive:true});
   const compiled=spawnSync('python3',['-m','compiler','--fixture',fixture,'--out',join(dir,'bundle'),...scenarioFile?['--scenario',scenarioFile]:[]],{cwd:SIM,env:{...process.env,PYTHONPATH:`${SIM}:${join(root,'robotics/agent')}`},encoding:'utf8'});
   if(compiled.status!==0){console.error(`COMPILE_FAILED: ${compiled.stderr.trim()}`);process.exit(1);}
   const r=spawnSync(TSX,[CLI,'run','--scenario',e.id,'--seed',String(e.seed),'--out',dir,'--fixture',fixture,'--bundle',join(dir,'bundle'),'--backend-set',e.backendSet,'--source-commit',commit,...o['environment-profile']?['--environment-profile',o['environment-profile']]:[],...(o['native-config']??process.env.LAB_NATIVE_CONFIG)?['--native-config',o['native-config']??process.env.LAB_NATIVE_CONFIG]:[]],{stdio:'inherit',timeout:3600000});
   if(r.status!==0)failed++;else completed++;
  }
 }
 if(o.campaign)await writeFile(manifestFile,JSON.stringify({schemaVersion:1,status:failed?'failed':'completed',campaignId:o.campaign,sourceCommit:commit,scenarios,expectedRuns,completedRuns:completed,failedRuns:failed,doctor:report},null,2)+'\n');
 process.exit(failed?1:0);
}
async function verify(o){
 if(!o.input)usage('MISSING_OPTION:--input');
 let entries;try{entries=await readdir(o.input,{withFileTypes:true});}catch{console.error(`INPUT_MISSING:${o.input}`);process.exit(2);}
 let campaign=null;try{campaign=JSON.parse(await readFile(join(o.input,'campaign-manifest.json'),'utf8'));}catch{campaign=null;}
 if(campaign?.status==='not_run'){console.error(`NOT_RUN:\n${o.input}: ${(campaign.reasons??[]).join(',')||'not_run'}`);process.exit(2);}
 const runDir=/^run-\d+$/;
 const dirs=[o.input,...entries.filter(e=>e.isDirectory()&&runDir.test(e.name)).map(e=>join(o.input,e.name))];
 // a campaign nests <scenario>/run-N
 for(const e of entries)if(e.isDirectory()&&!runDir.test(e.name))try{for(const r of await readdir(join(o.input,e.name),{withFileTypes:true}))if(r.isDirectory()&&runDir.test(r.name))dirs.push(join(o.input,e.name,r.name));}catch{/* not a scenario directory */}
 const manifests=[];
 for(const d of dirs){try{manifests.push([d,JSON.parse(await readFile(join(d,'run-manifest.json'),'utf8'))]);}catch{/* not a run directory */}}
 if(!manifests.length){console.error('INPUT_EMPTY: no run-manifest.json');process.exit(2);}
 let failures=[],notRun=[];
 for(const [d,m] of manifests){
  if(m.status==='not_run'||m.evidence!=='sil'){notRun.push(`${d}: ${m.status==='not_run'?(m.reasons??[]).join(',')||'not_run':`evidence ${m.evidence}`}`);continue;}
  for(const out of m.outputs??[]){let bytes;try{bytes=await readFile(join(d,out.path));}catch{failures.push(`${d}: missing ${out.path}`);continue;}if(sha(bytes)!==out.sha256)failures.push(`${d}: hash mismatch ${out.path}`);}
  if(m.scenario?.id==='BV01'&&m.nativeFaultExpectation){
   try{const path='fault-case-assessment.json',assessment=JSON.parse(await readFile(join(d,path),'utf8'));if(!m.outputs?.some(o=>o.path===path)||JSON.stringify(assessment.expectation)!==JSON.stringify(m.nativeFaultExpectation)||assessment.producer!=='native'||assessment.businessOutcome?.status!=='needs_attention'||assessment.businessOutcome?.served!=='0'||!Array.isArray(assessment.assessment)||!assessment.assessment.length)failures.push(`${d}: invalid negative-case assessment`);if(assessment.result==='not_run')notRun.push(`${d}: negative-case assessment not_run`);if(!['pass','not_run'].includes(assessment.result)||assessment.assessment.some(a=>a.result==='fail')||assessment.result==='pass'&&assessment.assessment.some(a=>a.result!=='pass'))failures.push(`${d}: negative-case assessment failed`);}catch{failures.push(`${d}: negative-case assessment unreadable`);}
  }
  try{const t=JSON.parse(await readFile(join(d,'telemetry.json'),'utf8'));if(!Array.isArray(t.samples)||!t.samples.length)failures.push(`${d}: zero telemetry samples`);}catch{failures.push(`${d}: telemetry unreadable`);}
  try{const a=JSON.parse(await readFile(join(d,'assertions.json'),'utf8'));if(!Array.isArray(a)||!a.length)failures.push(`${d}: no assertions`);for(const x of a){if(x.result==='fail')failures.push(`${d}: ${x.id} failed`);if(m.scenario?.id==='BV01'&&x.result==='not_run')notRun.push(`${d}: ${x.id} not_run`);}if(m.scenario?.id==='BV01')for(const required of ['ARM03','SIM.engine-samples','BV01.cup-ledger','SIM.no-contact','BV01.native-verification',...m.nativeFaultExpectation?['BV01.fault-schedule','BV01.fault-observed','BV01.expected-attention','BV01.custody-preserved','BV01.no-replay']:['BV01.served-after-handoff']])if(!a.some(x=>x.id===required))failures.push(`${d}: missing ${required}`);}catch{failures.push(`${d}: assertions unreadable`);}
 }
 if(campaign){
  // exact run count, one source commit and one world/backend identity per scenario across its repeats
  if(manifests.length!==campaign.expectedRuns)failures.push(`${o.input}: ${manifests.length} runs, campaign expects ${campaign.expectedRuns}`);
  for(const s of campaign.scenarios??[]){
   const runs=manifests.filter(([,m])=>m.scenario?.id===s.scenarioId);
   if(runs.length!==s.repeat)failures.push(`${s.scenarioId}: ${runs.length} runs, expected ${s.repeat}`);
   for(const key of ['sourceCommit','backendSetId'])if(new Set(runs.map(([,m])=>m[key])).size>1)failures.push(`${s.scenarioId}: ${key} differs across repeats`);
   if(new Set(runs.map(([,m])=>m.world?.inputHash)).size>1)failures.push(`${s.scenarioId}: world inputHash differs across repeats`);
   if(runs.some(([,m])=>JSON.stringify(m.backends)!==JSON.stringify(s.requiredBackends)))failures.push(`${s.scenarioId}: backends differ from the campaign requirement`);
  }
  if(new Set(manifests.map(([,m])=>m.sourceCommit)).size>1)failures.push(`${o.input}: sourceCommit differs across scenarios`);
 }
 if(failures.length){console.error(`FAILED:\n${failures.join('\n')}`);process.exit(1);}
 if(notRun.length){console.error(`NOT_RUN:\n${notRun.join('\n')}`);process.exit(2);}
 const m=manifests[0][1];
 console.log(campaign?`verified campaign=${campaign.campaignId} runs=${manifests.length}/${campaign.expectedRuns} scenarios=${campaign.scenarios.map(s=>s.scenarioId).join(',')} source=${m.sourceCommit}`
  :`verified runs=${manifests.length} scenario=${m.scenario?.id}@${m.scenario?.revision} seed=${m.seed} inputHash=${m.world?.inputHash} source=${m.sourceCommit} backends=${(m.backends??[]).join(',')}`);
 process.exit(0);
}
const [command,...rest]=process.argv.slice(2);
const o=parse(command,rest);
if(command==='doctor'){if(!o.backend)usage('MISSING_OPTION:--backend');const r=await doctor(o.backend,o['environment-profile'],o['native-config']??process.env.LAB_NATIVE_CONFIG);console.log(o.json?JSON.stringify(r,null,2):r.checks.map(c=>`${c.ok?'OK':'MISSING'} ${c.id}: ${c.detail}`).join('\n'));process.exit(r.prerequisitesMet?0:2);}
if(command==='run')await run(o);
if(command==='verify')await verify(o);
