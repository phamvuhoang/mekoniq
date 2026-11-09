#!/usr/bin/env node
// Steady-state measurement of the IR-SIM 2D provider on this host (verification.md §4 performance target: a measurement, not a gate):
// the two-robot fleet fixture (IR-FD07 scene: 2 robots, their LiDARs, publish 10 Hz) stepped for 60 s of simulation (3000 ticks) through the real runner and
// the real worker, in batches of 50 ticks. Reports wall time per tick (mean of each batch; p50/p95 across batches), realtime factor, worker RSS and the output
// size. Per-tick numbers are batch means: an action-level step of 1 tick would add checkpoint persistence to every tick and measure the wrong thing.
//   node scripts/measure-irsim.mjs --out FILE [--irsim-python PATH] [--ticks N]
import {execFileSync} from 'node:child_process';
import {mkdtemp,readdir,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir,cpus,totalmem,platform,release,arch} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const argv=process.argv.slice(2),opt=(k,d)=>{const i=argv.indexOf(k);return i>=0?argv[i+1]:d;};
const out=opt('--out'),python=resolve(opt('--irsim-python',join(root,'.venv-irsim/bin/python'))),ticks=Number(opt('--ticks','3000')),BATCH=50;
if(!out)throw new Error('usage: measure-irsim.mjs --out FILE [--irsim-python PATH] [--ticks N]');
const {tsImport}=await import('tsx/esm/api');
const {compileFixtures,batchScenarios}=await tsImport('../packages/lab-runtime/src/v2/navigation2d/batch.ts',import.meta.url);
const {portableSimulationFromOptions}=await tsImport('../packages/lab-runtime/src/v2/navigation2d/readiness.ts',import.meta.url);
const {createIRSimScenarioRun}=await tsImport('../packages/lab-runtime/src/v2/navigation2d/runner.ts',import.meta.url);
const workerRoot=join(root,'robotics/navigation-2d'),dir=await mkdtemp(join(tmpdir(),'irsim-measure-')),SET='engineering-irsim-2d-v1',SCENARIO='IR-FD07',FIXTURE='serve-fleet-v1';
const q=(xs,p)=>{const s=[...xs].sort((a,b)=>a-b);return s.length?s[Math.min(s.length-1,Math.floor(p*(s.length-1)))]:null;};
const rssKiB=(bundle)=>{try{const pid=execFileSync('ps',['-A','-o','pid=,command='],{encoding:'utf8'}).split('\n').find(l=>l.includes(`--bundle-root ${bundle} `));return pid?Number(execFileSync('ps',['-o','rss=','-p',String(Number(pid.trim().split(/\s+/)[0]))],{encoding:'utf8'}).trim()):null;}catch{return null;}};
const du=async(d)=>{let n=0;for(const e of await readdir(d,{withFileTypes:true})){const p=join(d,e.name);n+=e.isDirectory()?await du(p):(await stat(p)).size;}return n;};
let run;
try{
 const portable=await portableSimulationFromOptions({enabled:true,python,workerRoot,lockPath:join(workerRoot,'requirements.lock'),directory:join(dir,'probe'),schemaDir:join(root,'packages/contracts/schemas')});
 if(portable.unavailable||!portable.describe)throw new Error(`PREREQUISITE_MISSING:${portable.unavailable??'IRSIM_WORKER_UNAVAILABLE'}`);
 const {service,compiled}=await compileFixtures({root,out:dir,python,fixtureIds:[FIXTURE]}),fx=compiled.get(FIXTURE);
 if('error' in fx)throw new Error(fx.error);
 const {catalog,scenarios}=batchScenarios(portable.catalog),def=scenarios.get(SCENARIO);
 const runDir=join(dir,'run');
 run=await createIRSimScenarioRun({project:fx.locked.runtimeProjection.project,scenarioId:SCENARIO,scenarioRevision:def.revision,seed:7,mode:'simulation',access:'simulated',backendSetId:SET,sourceCommit:'measurement',engineering:fx.locked},
  {directory:runDir,catalog,enabledBackends:portable.enabledBackends,scenarios,bundleFile:(d,p)=>service.bundleFile(d,p),irsim:{python,workerRoot,schemaDir:join(root,'packages/contracts/schemas'),lockDigest:portable.describe.lockDigest,maxActiveRuns:2}});
 let v=await run.start();const t0=process.hrtime.bigint(),perTickMs=[],rss=[];
 while(v.tick<ticks&&['running','awaiting_confirmation'].includes(v.run.status)){
  const n=Math.min(BATCH,ticks-v.tick),a=process.hrtime.bigint();
  v=await run.action({actionId:`measure-${v.tick}`,expectedRevision:v.run.runRevision,kind:'step',payload:{ticks:n}});
  perTickMs.push(Number(process.hrtime.bigint()-a)/1e6/n);const r=rssKiB(join(runDir,'bundle'));if(r)rss.push(r);
 }
 const wallMs=Number(process.hrtime.bigint()-t0)/1e6,simMs=v.tick*20,report=await run.report();
 const scene=JSON.parse(await readFile(join(runDir,'bundle/navigation-scene.json'),'utf8'));
 const result={schemaVersion:1,documentType:'irsim-performance-measurement',note:'a measurement on this host, not a gate; per-tick values are means over 50-tick step batches, p50/p95 across batches',
  host:{platform:platform(),release:release(),arch:arch(),cpu:cpus()[0]?.model,cpus:cpus().length,memGiB:Math.round(totalmem()/2**30),node:process.version,python:portable.describe.pythonVersion,irsim:portable.describe.packageVersion},
  workload:{scenarioId:SCENARIO,fixtureId:FIXTURE,robots:scene.robots?.map(r=>({robotId:r.robotId,beams:r.model.sensors.map(s=>s.beamCount),publishEveryTicks:r.model.sensors.map(s=>s.publishEveryTicks)})),ticks:v.tick,simSeconds:simMs/1000,finalStatus:v.run.status,maxConcurrentMovers:report.metrics.maxConcurrentMovers},
  steadyState:{batches:perTickMs.length,perTickMs:{p50:q(perTickMs,0.5),p95:q(perTickMs,0.95),max:Math.max(...perTickMs)},realtimeFactor:simMs/wallMs,wallSeconds:wallMs/1000,workerRssMiB:{max:rss.length?Math.max(...rss)/1024:null,samples:rss.length},evidenceBytes:await du(join(runDir,'evidence'))},
  targets:{realtimeFactorAt1x:'>= 1 (median)',stepP95Ms:'<= 20',workerRssMiB:'<= 1024',source:'specs/2026-11-08-linkforge-irsim/verification.md §4 (Mac arm64 reference, 2 robots, 360 beams each, publish 10 Hz)'},
  meetsTargets:{realtimeFactor:simMs/wallMs>=1,stepP95:q(perTickMs,0.95)<=20,workerRss:rss.length?Math.max(...rss)/1024<=1024:null}};
 await writeFile(out,JSON.stringify(result,null,1)+'\n',{flag:'wx'});
 console.log(JSON.stringify({ticks:v.tick,status:v.run.status,...result.steadyState,meetsTargets:result.meetsTargets}));
}finally{await run?.close().catch(()=>{});await rm(dir,{recursive:true,force:true});}
