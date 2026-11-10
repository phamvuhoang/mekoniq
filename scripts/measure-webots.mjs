#!/usr/bin/env node
// Steady-state measurement of the Webots 3D plant on this host (a measurement, not a gate; the spec sets no Webots target): the two-robot fleet fixture (WB-FD07 scene: 2 robots,
// their LiDARs, publish 10 Hz) stepped through the real runner and the real engine, in batches of 50 ticks. Reports wall time per tick (mean of each batch; p50/p95 across
// batches), the realtime factor, the RSS of the Webots processes and the output size. Per-tick numbers are batch means: an action-level step of 1 tick would add checkpoint
// persistence to every tick and measure the wrong thing.
//   node scripts/measure-webots.mjs --out FILE [--webots-home DIR] [--webots-python PATH] [--ticks N]
import {execFileSync} from 'node:child_process';
import {mkdtemp,readdir,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir,cpus,totalmem,platform,release,arch} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const argv=process.argv.slice(2),opt=(k,d)=>{const i=argv.indexOf(k);return i>=0?argv[i+1]:d;};
const out=opt('--out'),python=resolve(opt('--webots-python',join(root,'.venv-webots/bin/python'))),home=resolve(opt('--webots-home',process.env.MEKONIQ_WEBOTS_HOME??'/Applications/Webots.app')),ticks=Number(opt('--ticks','1500')),BATCH=50;
if(!out)throw new Error('usage: measure-webots.mjs --out FILE [--webots-home DIR] [--webots-python PATH] [--ticks N]');
const {tsImport}=await import('tsx/esm/api');
const {compileFixtures}=await tsImport('../packages/lab-runtime/src/v2/navigation2d/batch.ts',import.meta.url);
const {webotsFromOptions}=await tsImport('../packages/lab-runtime/src/v2/simulation3d/readiness.ts',import.meta.url);
const {createFixedStepScenarioRun}=await tsImport('../packages/lab-runtime/src/v2/navigation2d/runner.ts',import.meta.url);
const {defaultCatalog}=await tsImport('../packages/lab-runtime/src/v2/capabilities.ts',import.meta.url);
const {scenarioRegistry}=await tsImport('../packages/lab-runtime/src/v2/scenario-registry.ts',import.meta.url);
const workerRoot=join(root,'robotics/simulation-3d'),dir=await mkdtemp(join(tmpdir(),'webots-measure-')),SET='engineering-webots-3d-v1',SCENARIO='WB-FD07',FIXTURE='serve-3d-fleet-v1';
const q=(xs,p)=>{const s=[...xs].sort((a,b)=>a-b);return s.length?s[Math.min(s.length-1,Math.floor(p*(s.length-1)))]:null;};
/** Resident set of every Webots process (the engine; its controllers are separate small Python processes counted apart), KiB. */
const rssKiB=()=>{try{const lines=execFileSync('ps',['-A','-o','pid=,rss=,command='],{encoding:'utf8'}).split('\n');
 const sum=(re)=>lines.filter(l=>re.test(l.trim().replace(/^\d+\s+\d+\s+/,''))).reduce((n,l)=>n+Number(l.trim().split(/\s+/)[1]),0);
 return {engine:sum(/^\S*\/Contents\/MacOS\/webots(\s|$)/),controllers:sum(/webots_worker\/(supervisor|robot_controller)\.py/)};}catch{return null;}};
const du=async(d)=>{let n=0;for(const e of await readdir(d,{withFileTypes:true})){const p=join(d,e.name);n+=e.isDirectory()?await du(p):(await stat(p)).size;}return n;};
let run;
try{
 const webots=await webotsFromOptions({enabled:true,python,workerRoot,lockPath:join(workerRoot,'requirements.lock'),webotsHome:home,directory:join(dir,'probe'),schemaDir:join(root,'packages/contracts/schemas')});
 if(!webots.plant)throw new Error(`PREREQUISITE_MISSING:${webots.capability.reason??'WEBOTS_UNAVAILABLE'}`);
 const {service,compiled}=await compileFixtures({root,out:dir,python,plant:'webots_3d',fixtureIds:[FIXTURE]}),fx=compiled.get(FIXTURE);
 if('error' in fx)throw new Error(fx.error);
 const catalog={...defaultCatalog,backends:defaultCatalog.backends.map(b=>b.id==='webots_3d'?webots.capability:b)},def=scenarioRegistry.get(SCENARIO),runDir=join(dir,'run');
 run=await createFixedStepScenarioRun({project:fx.locked.runtimeProjection.project,scenarioId:SCENARIO,scenarioRevision:def.revision,seed:7,mode:'simulation',access:'simulated',backendSetId:SET,sourceCommit:'measurement',engineering:fx.locked},
  {directory:runDir,catalog,enabledBackends:['webots_3d'],scenarios:scenarioRegistry,bundleFile:(d,p)=>service.bundleFile(d,p),plant:webots.plant.port,runtime:webots.plant.runtime});
 let v=await run.start();const t0=process.hrtime.bigint(),perTickMs=[],engine=[],controllers=[];
 while(v.tick<ticks&&['running','awaiting_confirmation'].includes(v.run.status)){
  const n=Math.min(BATCH,ticks-v.tick),a=process.hrtime.bigint();
  v=await run.action({actionId:`measure-${v.tick}`,expectedRevision:v.run.runRevision,kind:'step',payload:{ticks:n}});
  perTickMs.push(Number(process.hrtime.bigint()-a)/1e6/n);const r=rssKiB();if(r){engine.push(r.engine);controllers.push(r.controllers);}
 }
 const wallMs=Number(process.hrtime.bigint()-t0)/1e6,simMs=v.tick*20,report=await run.report();
 const result={schemaVersion:1,documentType:'webots-performance-measurement',note:'a measurement on this host, not a gate; per-tick values are means over 50-tick step batches, p50/p95 across batches; the first batch includes the first-world load',
  host:{platform:platform(),release:release(),arch:arch(),cpu:cpus()[0]?.model,cpus:cpus().length,memGiB:Math.round(totalmem()/2**30),node:process.version,webots:webots.plant.runtime.executableSha256.slice(0,16),basicTimeStepMs:webots.plant.runtime.basicTimeStepMs},
  workload:{scenarioId:SCENARIO,fixtureId:FIXTURE,ticks:v.tick,simSeconds:simMs/1000,finalStatus:v.run.status,outcome:report.outcome,outputBytes:await du(runDir)},
  steadyState:{batches:perTickMs.length,perTickMs:{p50:q(perTickMs,0.5),p95:q(perTickMs,0.95),max:Math.max(...perTickMs)},realtimeFactor:simMs/wallMs,wallSeconds:wallMs/1000,
   webotsRssMiB:{max:engine.length?Math.max(...engine)/1024:null,samples:engine.length},controllersRssMiB:{max:controllers.length?Math.max(...controllers)/1024:null}}};
 await writeFile(out,JSON.stringify(result,null,1)+'\n',{flag:'wx'});
 console.log(JSON.stringify({ticks:v.tick,status:v.run.status,...result.steadyState}));
}finally{await run?.close().catch(()=>{});await rm(dir,{recursive:true,force:true});}
