#!/usr/bin/env node
// Headless IR-SIM 2D campaigns on the pinned portable worker (C02). Independent of the Lab UI.
//   node scripts/lab-irsim.mjs doctor [--json] [--irsim-python PATH]
//   node scripts/lab-irsim.mjs run --campaign ID|robotics/navigation-2d/campaigns/FILE.json --out DIR [--concurrency 1|2] [--irsim-python PATH] [--run-timeout-s N] [--expect-portable-digest HEX]
//   node scripts/lab-irsim.mjs verify --input DIR
// Exit codes: 0 every run ran and passed with complete evidence, 1 a run failed or is incomplete, 2 a prerequisite or the usage is missing (not_run), 130/143 on SIGINT/SIGTERM.
// The campaign is a server-owned file: an id or a path inside robotics/navigation-2d/campaigns only (no traversal, no symbolic link, no module/shell/YAML path).
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {nativeToolClosure,portableToolClosure,PORTABLE_TOOL_PATHS} from './native-sim/tool-identity.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const usage=(m)=>{console.error(`${m}\nusage: lab-irsim.mjs doctor [--json] [--irsim-python PATH] | run --campaign ID|PATH --out DIR [--concurrency 1|2] [--irsim-python PATH] [--run-timeout-s N] [--expect-portable-digest HEX] | verify --input DIR`);process.exit(2);};
const SCHEMA={doctor:{json:'flag','irsim-python':'path'},run:{campaign:'campaign',out:'path',concurrency:'int','irsim-python':'path','run-timeout-s':'int','expect-portable-digest':'hex'},verify:{input:'path'}};
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
  if(kind==='hex'&&!/^[0-9a-f]{64}$/.test(v))usage(`INVALID_DIGEST:${a}`);
  if(/[\0\n\r]/.test(v)||v.length>1024)usage(`INVALID_VALUE:${a}`);
  // an id names robotics/navigation-2d/campaigns/<id>.json; anything else is a repository path checked by the batch loader (allowlisted directory, no link, .json)
  o[key]=kind==='int'?Number(v):kind==='path'?resolve(v):kind==='campaign'?(/^[A-Za-z0-9_.-]{1,64}$/.test(v)&&!v.endsWith('.json')?join(root,'robotics/navigation-2d/campaigns',`${v}.json`):resolve(v)):v;
 }
 return o;
}
const load=async()=>{const {tsImport}=await import('tsx/esm/api');return tsImport('../packages/lab-runtime/src/v2/navigation2d/batch.ts',import.meta.url);};
/** Ignored files under a tool root that can never run: bytecode inside __pycache__ (never read: PYTHONPYCACHEPREFIX / -X pycache_prefix), pytest caches, the walkers' tests/ dirs. */
const HARMLESS_IGNORED=/(^|\/)(__pycache__\/[^/]+\.pyc|\.pytest_cache\/.*|tests\/.*)$/;
/**
 * What the checked-out tree is: HEAD, and every reason it is not exactly HEAD. Dirty = any tracked change, any untracked file anywhere (an untracked
 * sitecustomize.py next to the worker would otherwise pass as clean), or any ignored file inside a portable tool root other than HARMLESS_IGNORED.
 */
export function treeState(dir=root,exclude=[]){
 const git=(...a)=>spawnSync('git',a,{cwd:dir,encoding:'utf8'}),head=git('rev-parse','HEAD').stdout.trim()||'unknown';
 // `exclude`: repository-relative directories whose files are this process's own output (a campaign/record written inside the repo), never code that can run
 const changed=git('status','--porcelain','--untracked-files=all','--','.',...exclude.map(p=>`:(exclude)${p}`)).stdout.split('\n').filter(Boolean);
 const ignored=git('status','--porcelain','--ignored','--untracked-files=all','--',...PORTABLE_TOOL_PATHS).stdout.split('\n').filter(l=>l.startsWith('!! ')).map(l=>l.slice(3)).filter(p=>!HARMLESS_IGNORED.test(p));
 const reasons=[...changed.map(l=>`${l.slice(0,2).trim()||'?'} ${l.slice(3)}`),...ignored.map(p=>`ignored-in-tool-root ${p}`)];
 return {head,dirty:reasons.length>0,reasons};
}
/** The checked-out commit; a tree that is not exactly that commit is named as such, never passed off as it. */
export const sourceCommit=(dir=root,exclude=[])=>{const s=treeState(dir,exclude);return s.dirty?`${s.head}-dirty`:s.head;};
/** The output directory as a repository-relative pathspec to leave out of the dirty check when it lies inside the repository (else nothing is excluded). */
export const ownOutput=(out,dir=root)=>{const rel=relative(realpathSync(dir),resolve(out));return rel&&!rel.startsWith('..')&&!isAbsolute(rel)?[rel]:[];};
/** Digests of the tool trees the worker and compilers actually run (files as on disk, not as committed). */
export const closureIdentity=(dir=root)=>({portable:portableToolClosure(dir).digest,native:nativeToolClosure(dir).digest});

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
 // the tool trees that will run, before: refused at once when an expected pin is given and differs
 const before=closureIdentity();
 if(o['expect-portable-digest']&&before.portable!==o['expect-portable-digest']){console.error(`NOT_RUN: TOOL_CLOSURE_MISMATCH: portable tools ${before.portable}, expected ${o['expect-portable-digest']}`);process.exit(2);}
 const own=ownOutput(o.out);let s;
 try{s=await runIRSimBatch({campaignPath:o.campaign,outDir:o.out,concurrency,sourceCommit:sourceCommit(root,own),identity:{toolClosures:before},...o['irsim-python']?{python:o['irsim-python']}:{},...o['run-timeout-s']?{runTimeoutMs:o['run-timeout-s']*1000}:{},signal:abort.signal});}
 catch(e){if(e instanceof BatchError){console.error(`NOT_RUN: ${e.message}`);process.exit(signalled||2);}throw e;}
 // and after: a tree that changed under the campaign makes every result untrustworthy
 const after=closureIdentity(),stable=after.portable===before.portable&&after.native===before.native;
 await writeFile(join(o.out,'identity.json'),JSON.stringify({sourceCommit:sourceCommit(root,own),toolClosures:{before,after},stable},null,1)+'\n',{flag:'wx'});
 if(!stable){console.error(`NOT_RUN: TOOL_CLOSURE_CHANGED during the campaign: portable ${before.portable} -> ${after.portable}, native ${before.native} -> ${after.native}`);process.exit(signalled||2);}
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
  // complete evidence, or exactly the gap a fault case declares (judged by its own oracle when the run was made)
  if(rec.evidenceAsExpected!==true)problems.push(`${r.id}: evidence not as its case requires`);
 }
 let identity=null;try{identity=JSON.parse(await readFile(join(o.input,'identity.json'),'utf8'));}catch{identity=null;}
 if(identity&&identity.stable!==true)problems.push('the tool closure changed during the campaign');
 if(summary.provider?.kind!=='irsim_worker')problems.push(`provider ${summary.provider?.kind}: not irsim_2d evidence`);
 if(problems.length){console.error(`FAILED:\n${problems.join('\n')}`);process.exit(1);}
 console.log(`verified campaign=${summary.campaignId} runs=${summary.runs.length} source=${summary.sourceCommit}`);process.exit(0);
}

// run as a script (paths compared after realpath: /var vs /private/var), not when imported by record-irsim or a test
if(process.argv[1]&&realpathSync(resolve(process.argv[1]))===realpathSync(fileURLToPath(import.meta.url))){
 const [command,...rest]=process.argv.slice(2);
 const o=parse(command,rest);
 if(command==='doctor')await doctor(o);
 if(command==='run')await run(o);
 if(command==='verify')await verify(o);
}
