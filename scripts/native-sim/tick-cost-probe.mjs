#!/usr/bin/env node
// Tick-cost probe: steps world `coffee-delivery-cell-v1` through the real scenario runner + real MuJoCo worker (.venv-mujoco) and counts/times fsyncs.
// Re-runnable, prints one JSON object: {ticks, wallMs, fsyncCount, fsyncPerTick, msPerTick, fsyncMsP50, fsyncMsP95, flushMs:[...], ...}.
//   node scripts/native-sim/tick-cost-probe.mjs [--ticks 500] [--seed 1] [--chunk 25]
// Measures only: it wraps node:fs/promises `open`/`unlink` (to learn which file a FileHandle belongs to) and FileHandle.prototype.sync; runtime code is untouched.
// flushMs = wall time of each evidence-chunk flush, from the open of `write.intent` to its unlink (world and physics recorders both use that name).
import fsp from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join,resolve,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const argv=process.argv.slice(2),opt=(k,d)=>{const i=argv.indexOf(k);return i>=0?argv[i+1]:d;};
const TICKS=Number(opt('--ticks','500')),SEED=Number(opt('--seed','1')),CHUNK=Number(opt('--chunk','25'));
const stats={syncMs:[],flushMs:[],bySuffix:{}};let flushStart=0;const paths=new WeakMap();
const realOpen=fsp.open,realUnlink=fsp.unlink;
fsp.open=async function(path,...rest){const h=await realOpen.call(this,path,...rest);if(typeof path==='string'){paths.set(h,path);if(basename(path).includes('write.intent')&&!flushStart)flushStart=performance.now();}return h;};
fsp.unlink=async function(path,...rest){const r=await realUnlink.call(this,path,...rest);if(typeof path==='string'&&basename(path)==='write.intent'&&flushStart){stats.flushMs.push(performance.now()-flushStart);flushStart=0;}return r;};
syncBuiltinESMExports();
const proto=Object.getPrototypeOf(await realOpen(fileURLToPath(import.meta.url),'r').then(async h=>{await h.close();return h;})),realSync=proto.sync;
proto.sync=async function(){const t=performance.now();try{return await realSync.call(this);}finally{const ms=performance.now()-t,p=paths.get(this)??'?',b=basename(p),k=b.startsWith('mekoniq-tickcost-')?'run-dir':/^\.?(world|physics)-\d+-[a-f0-9]+\.ndjson\.gz/.test(b)?'evidence-chunk.tmp':b.replace(/^\./,'');stats.syncMs.push(ms);(stats.bySuffix[k]??=[]).push(ms);}};
const {tsImport}=await import('tsx/esm/api');
const imp=p=>tsImport(p,import.meta.url);
const [{createScenarioRun},{defaultCatalog},{mujocoWorldPorts},{lockDigestOf},{amrAsset}]=await Promise.all([
 imp('../../packages/lab-runtime/src/v2/scenario-runner.ts'),imp('../../packages/lab-runtime/src/v2/capabilities.ts'),imp('../../packages/lab-runtime/src/v2/simulation3d/mujoco-world-ports.ts'),imp('../../packages/lab-runtime/src/engineering/linkforge.ts'),imp('../../tests/support/lab-v2.ts')]);
const cellRoot=resolve(root,'robotics/simulation-mujoco'),directory=await mkdtemp(join(tmpdir(),'mekoniq-tickcost-'));
const project=JSON.parse(await readFile(join(cellRoot,'fixtures/coffee-delivery-cell-v1/project.json'),'utf8'));
const catalog={...defaultCatalog,backends:defaultCatalog.backends.map(b=>['mujoco_arm','mujoco_3d'].includes(b.id)?{...b,installed:true,compatible:true,reachable:true}:b)};
const factory=mujocoWorldPorts({python:resolve(root,'.venv-mujoco/bin/python'),workerRoot:cellRoot,schemaDir:resolve(root,'packages/contracts/schemas'),lockDigest:await lockDigestOf(join(cellRoot,'requirements.lock')),engineVersion:'3.17.0'});
const manifest={project,scenarioId:'MJ-CELL-BV01',scenarioRevision:1,seed:SEED,mode:'simulation',access:'simulated',backendSetId:'engineering-mujoco-cell-v1',sourceCommit:'development:tick-cost-probe'};
const pct=(a,p)=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y);return +s[Math.min(s.length-1,Math.ceil(p*s.length)-1)].toFixed(3);};
const r3=x=>+x.toFixed(3);
let run,n=0,view,wallMs=0,done=0,error=null;try{
run=await createScenarioRun(manifest,{directory,catalog,assets:[amrAsset],enabledBackends:['mujoco_3d','mujoco_arm','mock_coffee'],worldPorts:factory});
view=await run.snapshot();view=await run.action({actionId:`probe-${++n}`,expectedRevision:view.run.runRevision,kind:'start',payload:{}});
// No warm-up is excluded: every tick of the stepping loop is measured; setup (worker spawn, run creation, start) is not.
stats.syncMs.length=0;stats.flushMs.length=0;for(const k of Object.keys(stats.bySuffix))delete stats.bySuffix[k];
const t0=performance.now();
try{while(done<TICKS&&!['completed','needs_attention','cancelled'].includes(view.run.status)){const ticks=Math.min(CHUNK,TICKS-done);view=await run.action({actionId:`probe-${++n}`,expectedRevision:view.run.runRevision,kind:'step',payload:{ticks}});done=view.tick;}}catch(e){error=String(e?.message??e);}
wallMs=performance.now()-t0;
}finally{await run?.close().catch(()=>{});await rm(directory,{recursive:true,force:true});}
const sum=a=>a.reduce((x,y)=>x+y,0),by=Object.fromEntries(Object.entries(stats.bySuffix).map(([k,a])=>[k,{count:a.length,perTick:r3(a.length/Math.max(1,done)),totalMs:r3(sum(a))}]));
console.log(JSON.stringify({world:'coffee-delivery-cell-v1',seed:SEED,chunk:CHUNK,ticks:done,status:view.run.status,error,wallMs:r3(wallMs),msPerTick:r3(wallMs/Math.max(1,done)),fsyncCount:stats.syncMs.length,fsyncPerTick:r3(stats.syncMs.length/Math.max(1,done)),fsyncTotalMs:r3(sum(stats.syncMs)),fsyncMsP50:pct(stats.syncMs,.5),fsyncMsP95:pct(stats.syncMs,.95),flushMs:stats.flushMs.map(r3),fsyncByFile:by}));
process.exit(error||done<TICKS?1:0);
