#!/usr/bin/env node
// Headless IR-SIM 2D campaigns on the pinned portable worker (C02). Independent of the Lab UI.
//   node scripts/lab-irsim.mjs doctor [--json] [--irsim-python PATH]
//   node scripts/lab-irsim.mjs run --campaign ID|robotics/navigation-2d/campaigns/FILE.json --out DIR [--concurrency 1|2] [--irsim-python PATH] [--run-timeout-s N]
//   node scripts/lab-irsim.mjs verify --input DIR
// Exit codes: 0 every run ran and passed with complete evidence, 1 a run failed or is incomplete, 2 a prerequisite or the usage is missing (not_run), 130/143 on SIGINT/SIGTERM.
// The campaign is a server-owned file: an id or a path inside robotics/navigation-2d/campaigns only (no traversal, no symbolic link, no module/shell/YAML path).
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const usage=(m)=>{console.error(`${m}\nusage: lab-irsim.mjs doctor [--json] [--irsim-python PATH] | run --campaign ID|PATH --out DIR [--concurrency 1|2] [--irsim-python PATH] [--run-timeout-s N] | verify --input DIR`);process.exit(2);};
const SCHEMA={doctor:{json:'flag','irsim-python':'path'},run:{campaign:'campaign',out:'path',concurrency:'int','irsim-python':'path','run-timeout-s':'int'},verify:{input:'path'}};
export function parse(command,argv){
 const schema=SCHEMA[command];if(!schema)usage(`UNKNOWN_COMMAND:${command??''}`);
 const o={};
 for(let i=0;i<argv.length;i++){
  const a=argv[i];if(!a.startsWith('--'))usage(`UNEXPECTED_ARGUMENT:${a}`);
  const key=a.slice(2),kind=schema[key];if(!kind)usage(`UNKNOWN_OPTION:${a}`);
  if(Object.hasOwn(o,key))usage(`DUPLICATE_OPTION:${a}`);
  if(kind==='flag'){o[key]=true;continue;}
  const v=argv[++i];if(v===undefined||v.startsWith('--'))usage(`MISSING_VALUE:${a}`);
  if(kind==='int'&&!/^[0-9]{1,6}$/.test(v))usage(`INVALID_INT:${a}`);
  if(/[\0\n\r]/.test(v)||v.length>1024)usage(`INVALID_VALUE:${a}`);
  // an id names robotics/navigation-2d/campaigns/<id>.json; anything else is a repository path checked by the batch loader (allowlisted directory, no link, .json)
  o[key]=kind==='int'?Number(v):kind==='path'?resolve(v):kind==='campaign'?(/^[A-Za-z0-9_.-]{1,64}$/.test(v)&&!v.endsWith('.json')?join(root,'robotics/navigation-2d/campaigns',`${v}.json`):resolve(v)):v;
 }
 return o;
}
const load=async()=>{const {tsImport}=await import('tsx/esm/api');return tsImport('../packages/lab-runtime/src/v2/navigation2d/batch.ts',import.meta.url);};
const git=(...a)=>spawnSync('git',a,{cwd:root,encoding:'utf8'});
/** The checked-out commit; a tree with uncommitted changes is named as such, never passed off as that commit. */
export const sourceCommit=()=>{const head=git('rev-parse','HEAD').stdout.trim()||'unknown',dirty=git('status','--porcelain','--untracked-files=no').stdout.trim();return dirty?`${head}-dirty`:head;};

async function doctor(o){
 const {tsImport}=await import('tsx/esm/api');
 const {portableSimulationFromOptions}=await tsImport('../packages/lab-runtime/src/v2/navigation2d/readiness.ts',import.meta.url);
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os');
 const dir=await mkdtemp(join(tmpdir(),'lab-irsim-doctor-')),workerRoot=join(root,'robotics/navigation-2d');
 try{
  const p=await portableSimulationFromOptions({enabled:true,python:o['irsim-python']??join(root,'.venv-irsim/bin/python'),workerRoot,lockPath:join(workerRoot,'requirements.lock'),directory:dir});
  const checks=[{id:'node24',ok:process.versions.node.startsWith('24.'),detail:`node ${process.versions.node}`},{id:'irsim-worker',ok:!p.unavailable,detail:p.unavailable?String(p.catalog.backends.find(b=>b.id==='irsim_2d')?.reason??p.unavailable):`ir-sim ${p.describe.packageVersion} python ${p.describe.pythonVersion} lock ${p.describe.lockDigest.slice(0,16)}`}];
  const report={provider:'irsim_2d',checks,prerequisitesMet:checks.every(c=>c.ok)};
  console.log(o.json?JSON.stringify(report,null,2):checks.map(c=>`${c.ok?'OK':'MISSING'} ${c.id}: ${c.detail}`).join('\n'));
  process.exit(report.prerequisitesMet?0:2);
 }finally{await rm(dir,{recursive:true,force:true});}
}

async function run(o){
 for(const k of ['campaign','out'])if(!o[k])usage(`MISSING_OPTION:--${k}`);
 const concurrency=o.concurrency??1;if(concurrency!==1&&concurrency!==2)usage('INVALID_CONCURRENCY: 1 or 2 (two IR-SIM worlds per host at most)');
 const {runIRSimBatch,BatchError}=await load();
 // the exit code is latched at the signal; the batch stops scheduling, closes its runs (their worker groups) and records the rest not_run
 const abort=new globalThis.AbortController();let signalled=0;
 for(const [sig,code] of [['SIGINT',130],['SIGTERM',143]])process.on(sig,()=>{if(!signalled){signalled=code;abort.abort();}});
 let s;
 try{s=await runIRSimBatch({campaignPath:o.campaign,outDir:o.out,concurrency,sourceCommit:sourceCommit(),...o['irsim-python']?{python:o['irsim-python']}:{},...o['run-timeout-s']?{runTimeoutMs:o['run-timeout-s']*1000}:{},signal:abort.signal});}
 catch(e){if(e instanceof BatchError){console.error(`NOT_RUN: ${e.message}`);process.exit(signalled||2);}throw e;}
 const pass=s.runs.filter(r=>r.result==='pass').length,fail=s.runs.filter(r=>r.result==='fail').length,notRun=s.runs.length-pass-fail;
 console.log(`campaign ${s.status}: ${s.runs.length} runs, ${pass} pass, ${fail} fail, ${notRun} not_run, complete ${s.complete} (${s.summaryPath})${s.reasons.length?` reasons ${s.reasons.join(',')}`:''}`);
 process.exit(signalled||(s.status==='not_run'?2:s.status==='completed'&&s.complete?0:1));
}

/** Re-reads a campaign directory from disk: the summary, the campaign copy's digest and each run's own record. Exit 0 only for a finished, complete, all-pass campaign. */
async function verify(o){
 if(!o.input)usage('MISSING_OPTION:--input');
 let summary,campaign;
 try{summary=JSON.parse(await readFile(join(o.input,'summary.json'),'utf8'));campaign=await readFile(join(o.input,'campaign.json'));}catch{console.error(`NOT_RUN: ${o.input} has no readable summary.json/campaign.json`);process.exit(2);}
 if(summary.status==='not_run'){console.error(`NOT_RUN: ${(summary.reasons??[]).join(',')||'not_run'}`);process.exit(2);}
 const problems=[];
 if(createHash('sha256').update(campaign).digest('hex')!==summary.campaignSha256)problems.push('campaign.json does not match the summary digest');
 if(summary.status!=='completed'||summary.complete!==true)problems.push(`campaign status ${summary.status}, complete ${summary.complete}`);
 for(const r of summary.runs??[]){
  let rec=null;try{rec=JSON.parse(await readFile(join(o.input,'runs',r.id,'run.json'),'utf8'));}catch{rec=null;}
  if(!rec){problems.push(`${r.id}: no run.json (not_run)`);continue;}
  if(rec.result!=='pass'||r.result!=='pass')problems.push(`${r.id}: ${rec.result} ${(rec.reasons??[]).join('; ').slice(0,300)}`);
  if(rec.evidenceComplete!==true)problems.push(`${r.id}: evidence incomplete`);
 }
 if(summary.provider?.kind!=='irsim_worker')problems.push(`provider ${summary.provider?.kind}: not irsim_2d evidence`);
 if(problems.length){console.error(`FAILED:\n${problems.join('\n')}`);process.exit(1);}
 console.log(`verified campaign=${summary.campaignId} runs=${summary.runs.length} source=${summary.sourceCommit}`);process.exit(0);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [command,...rest]=process.argv.slice(2);
 const o=parse(command,rest);
 if(command==='doctor')await doctor(o);
 if(command==='run')await run(o);
 if(command==='verify')await verify(o);
}
