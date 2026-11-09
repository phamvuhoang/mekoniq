// C02 INT03 / IR08 campaigns on the real IR-SIM worker (runIRSimBatch, scripts/lab-irsim.mjs): twenty sequential runs, two worlds at once, noisy repeats,
// a crashed and an interrupted campaign. The protocol-double suite at the end is labelled protocol_double and is never counted as irsim_2d evidence.
// Skipped, with the reason, where the pinned IR-SIM venv is not provisioned.
import {afterAll,expect,test} from 'vitest';
import {execFileSync,spawn,type ChildProcess} from 'node:child_process';
import {existsSync,readdirSync} from 'node:fs';
import {readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {runIRSimBatch} from '../../packages/lab-runtime/src/v2/navigation2d/batch';
import type {RunReport} from '../../packages/lab-runtime/src/v2/report';
import {double,irsimAvailable,temp} from '../support/irsim-mission';

const dirs:string[]=[];
afterAll(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
const campaign=(id:string)=>resolve('robotics/navigation-2d/campaigns',`${id}.json`);
const children=()=>{try{return execFileSync('pgrep',['-P',String(process.pid)],{encoding:'utf8'}).trim().split('\n').filter(Boolean).map(Number).sort();}catch{return [];}};
/** Every process whose command line names `dir` (the workers of a campaign carry their run directory in --bundle-root). */
const under=(dir:string)=>{try{return execFileSync('pgrep',['-f',dir],{encoding:'utf8'}).trim().split('\n').filter(Boolean).map(Number);}catch{return [];}};
const bySeed0=(s:Summary,seed:number)=>s.runs.filter(r=>r.id.includes(`-IR-FD01-serve-demo-v1-s${seed}-`));
const json=async<T>(p:string)=>JSON.parse(await readFile(p,'utf8')) as T;
const cli=(...args:string[])=>spawn(process.execPath,['scripts/lab-irsim.mjs',...args],{stdio:['ignore','pipe','pipe']});
const exited=(p:ChildProcess)=>new Promise<number|null>(done=>p.once('close',code=>done(code)));
const until=async(ok:()=>boolean,ms:number)=>{const end=Date.now()+ms;while(!ok()){if(Date.now()>end)return false;await new Promise(r=>setTimeout(r,100));}return true;};
interface Summary{status:string;complete:boolean;evidenceComplete?:boolean;provider:{kind:string};runs:{id:string;scenarioId:string;result:string;reasons:string[];kind?:string;label?:string;stepTicks?:number;evidenceComplete?:boolean;evidenceAsExpected?:boolean;digests?:Record<string,string>;wallMs?:number;assertions?:{id:string;result:string}[]}[]}

test.skipIf(!irsimAvailable)('INT03 twenty-five sequential runs (IR01-IR06, IR08-IR10, contention rig): every run passes its own oracles with the evidence its case requires, seeds reproduce across pacing, noise is visible, outputs are separate, and no child outlives the campaign',async()=>{
 const out=await temp('irsim-batch-20-');dirs.push(out);
 const activeChildPidsBeforeStart=children(),t0=Date.now();
 const summary=await runIRSimBatch({campaignPath:campaign('c02-qualification'),outDir:join(out,'c'),concurrency:1,sourceCommit:'test-commit'});
 const activeChildPidsAfterClose=children(),wall=(Date.now()-t0)/1000;
 expect(summary.runs).toHaveLength(25);
 expect(summary.runs.filter(r=>r.result!=='pass')).toEqual([]);
 expect(summary.complete).toBe(true);
 expect(summary.runs.every(r=>r.result==='pass')).toBe(true);
 expect(activeChildPidsAfterClose).toEqual(activeChildPidsBeforeStart);
 const s=await json<Summary>(summary.summaryPath);
 expect(s).toMatchObject({status:'completed',complete:true,provider:{kind:'irsim_worker'}});
 // each run has its own directory, run id, bundle copy and evidence; nothing is shared between two runs
 const scenarioRuns=s.runs.filter(r=>r.kind!=='raw_drive'),reports=await Promise.all(scenarioRuns.map(r=>json<RunReport>(join(out,'c','runs',r.id,'report.json'))));
 expect(new Set(reports.map(r=>r.manifest.runId)).size).toBe(24);
 for(const r of s.runs){for(const f of [...r.kind==='raw_drive'?[]:['report.json'],'assertions.json','run.json','run/bundle/navigation-scene.json','run/evidence/manifest.json'])expect(existsSync(join(out,'c','runs',r.id,f)),`${r.id}/${f}`).toBe(true);}
 // every case is labelled for what it is: the contention rig (no missions, venue serialization bypassed) says so in the summary and in its report
 const rig=s.runs.filter(r=>r.kind==='contention_rig');expect(rig).toHaveLength(2);
 for(const r of rig){expect(r.label).toMatch(/^CONTENTION RIG \(not a production scenario\)/);expect((await json<RunReport>(join(out,'c','runs',r.id,'report.json'))).limitations[0]).toMatch(/^CONTENTION RIG \(IR-RIG-ZONE\)/);}
 for(const r of rig)expect(r.assertions!.filter(a=>['ZONE_CONTENDED','ZONE_PROMOTED_AT_RELEASE','ZONE_SINGLE_OWNER'].includes(a.id)).map(a=>a.result)).toEqual(['pass','pass','pass']);
 // IR10: its evidence is incomplete by design (the unknown tick) and that is exactly what its case declares; the campaign is still complete
 const kill=s.runs.find(r=>r.scenarioId==='IR-FD01-workerkill')!;expect([kill.result,kill.evidenceComplete,kill.evidenceAsExpected]).toEqual(['pass',false,true]);
 expect([s.complete,s.evidenceComplete]).toEqual([true,false]);
 // IR09 durable: the three IR-FD01 seed-11 repeats were stepped 500, 25 and 100 ticks per request and give one digest set
 expect(bySeed0(s,11).map(r=>r.stepTicks)).toEqual([500,25,100]);
 // RNG: a seed reproduces every digest; other seeds draw other order times (the actor stream), so their business events differ
 const bySeed=(seed:number,fixture='serve-demo-v1')=>s.runs.filter(r=>r.id.includes(`-${fixture}-s${seed}-`));
 for(const [seed,fixture] of [[11,'serve-demo-v1'],[11,'serve-noisy-v1'],[21,'serve-demo-v1'],[31,'serve-fleet-v1']] as const){const g=bySeed(seed,fixture);expect(g.length,`${fixture}/${seed}`).toBeGreaterThanOrEqual(2);expect(new Set(g.map(r=>JSON.stringify(r.digests))).size,`${fixture}/${seed}`).toBe(1);}
 const fd01=reports.filter(r=>r.manifest.scenario.id==='IR-FD01'&&r.manifest.models.some(m=>m.id==='navigation-model:amr-1'));
 expect(new Set(fd01.map(r=>r.workload[0]!.atTick)).size).toBeGreaterThan(5);
 // noise: same seed + noisy LiDAR repeats exactly (REPEATABLE) and differs from the noise-free twin by a few millimetres per beam (NOISE_VISIBLE)
 const noisy=s.runs.filter(r=>r.id.includes('serve-noisy-v1'));
 expect(noisy).toHaveLength(3);
 for(const r of noisy)expect(r.assertions!.filter(a=>a.id==='REPEATABLE'||a.id==='NOISE_VISIBLE').map(a=>a.result)).toEqual(['pass','pass']);
 expect(noisy[0]!.digests!.sensorDigest).not.toBe(bySeed(11)[0]!.digests!.sensorDigest);
 // every scenario of C02 ran with every oracle it declares, each written in full with expected/actual/oracle
 for(const r of s.runs){const a=await json<{oracles:{id:string;result:string;expected:string;actual:string;oracle:string}[]}>(join(out,'c','runs',r.id,'assertions.json'));for(const x of a.oracles)expect(x.expected&&x.actual&&x.oracle,`${r.id}/${x.id}`).toBeTruthy();}
 expect(new Set(reports.map(r=>r.manifest.scenario.id))).toEqual(new Set(['IR-FD01','IR-FD03','IR-FD04','IR-FD04-blocked','IR-FD07','IR-RIG-ZONE']));
 expect(new Set(s.runs.map(r=>r.scenarioId))).toEqual(new Set(['IR-FD01','IR-FD03','IR-FD04','IR-FD04-blocked','IR-FD07','IR-RIG-ZONE','IR-FD01-cancel','IR-FD01-workerkill','IR-RAW-PAIR-CONTACT']));
 // the headless CLI re-reads the directory from disk and agrees
 const verify=spawn(process.execPath,['scripts/lab-irsim.mjs','verify','--input',join(out,'c')],{stdio:'ignore'});
 expect(await exited(verify)).toBe(0);
 console.info(`INT03 sequential: 25 runs in ${wall.toFixed(0)} s; per run ${s.runs.map(r=>`${r.id.split('-').slice(1,3).join('-')} ${((r.wallMs??0)/1000).toFixed(1)}s`).join(', ')}`);
},1_800_000);

test.skipIf(!irsimAvailable)('INT03 two worlds at once: a one-robot and a two-robot world run concurrently (never more than two workers), and each gives the digests it gives alone',async()=>{
 const out=await temp('irsim-batch-2-');dirs.push(out);
 const before=children();let peak=0;
 const poll=setInterval(()=>{peak=Math.max(peak,under(join(out,'par')).length);},200);
 const par=await runIRSimBatch({campaignPath:campaign('c02-concurrent'),outDir:join(out,'par'),concurrency:2,sourceCommit:'test-commit'}).finally(()=>clearInterval(poll));
 const seq=await runIRSimBatch({campaignPath:campaign('c02-concurrent'),outDir:join(out,'seq'),concurrency:1,sourceCommit:'test-commit'});
 expect(children()).toEqual(before);
 expect([par.complete,seq.complete]).toEqual([true,true]);expect([...par.runs,...seq.runs].every(r=>r.result==='pass')).toBe(true);
 expect(peak).toBe(2);
 // the two runs really overlapped in wall time (two worlds at once), with no clock, RNG or id contamination: digests equal the sequential runs'
 const [ps,ss]=[await json<Summary>(par.summaryPath),await json<Summary>(seq.summaryPath)];
 expect(ps.runs.map(r=>r.digests)).toEqual(ss.runs.map(r=>r.digests));
 const span=async(dir:string,id:string)=>{const r=await json<RunReport>(join(dir,'runs',id,'report.json'));return r;};
 const [a,b]=await Promise.all(ps.runs.map(r=>span(join(out,'par'),r.id)));
 expect(a!.manifest.runId).not.toBe(b!.manifest.runId);
 const times=await Promise.all(ps.runs.map(async r=>{const {mtimeMs}=await import('node:fs').then(f=>f.statSync(join(out,'par','runs',r.id,'run.json')));return {end:mtimeMs,start:mtimeMs-(r.wallMs??0)};}));
 expect(Math.max(times[0]!.start,times[1]!.start)).toBeLessThan(Math.min(times[0]!.end,times[1]!.end));
},1_200_000);

test.skipIf(!irsimAvailable)('crash image: a campaign process killed (SIGKILL) mid-run leaves status running, complete false and unfinished runs not_run; its workers end with their stdin; verify refuses it',async()=>{
 const out=await temp('irsim-batch-kill-');dirs.push(out);const dir=join(out,'c');
 const p=cli('run','--campaign','c02-concurrent','--out',dir,'--concurrency','1');
 expect(await until(()=>under(dir).some(pid=>{try{return execFileSync('ps',['-o','command=','-p',String(pid)],{encoding:'utf8'}).includes('irsim_worker')&&execFileSync('ps',['-o','command=','-p',String(pid)],{encoding:'utf8'}).includes('/runs/');}catch{return false;}}),120_000)).toBe(true);
 await new Promise(r=>setTimeout(r,1500));
 p.kill('SIGKILL');expect(await exited(p)).toBe(null);
 // the worker group was detached: it notices the closed stdin and exits by itself; nothing is left running (PPID 1 orphans included)
 expect(await until(()=>under(dir).length===0,15_000)).toBe(true);
 const s=await json<Summary>(join(dir,'summary.json'));
 expect(s.status).toBe('running');expect(s.complete).toBe(false);
 expect(s.runs.some(r=>r.result==='not_run')).toBe(true);expect(s.runs.every(r=>r.result!=='pass'||r.reasons.length===0)).toBe(true);
 const v=spawn(process.execPath,['scripts/lab-irsim.mjs','verify','--input',dir],{stdio:'ignore'});
 expect(await exited(v)).toBe(1);
},600_000);

test.skipIf(!irsimAvailable)('SIGINT on the campaign CLI: exit 130 latched at the signal, the run in progress is closed (worker group gone), the rest recorded not_run, status interrupted',async()=>{
 const out=await temp('irsim-batch-int-');dirs.push(out);const dir=join(out,'c');
 const p=cli('run','--campaign','c02-concurrent','--out',dir,'--concurrency','1');let err='';p.stderr!.on('data',d=>{err+=String(d);});
 expect(await until(()=>existsSync(join(dir,'runs'))&&readdirSync(join(dir,'runs')).length>0&&under(dir).length>0,120_000)).toBe(true);
 await new Promise(r=>setTimeout(r,1500));
 p.kill('SIGINT');
 expect(await exited(p),err).toBe(130);
 expect(under(dir)).toEqual([]);
 const s=await json<Summary>(join(dir,'summary.json'));
 expect(s).toMatchObject({status:'interrupted',complete:false});
 expect(s.runs.some(r=>r.result==='not_run'&&r.reasons.includes('INTERRUPTED'))).toBe(true);
},600_000);

// ---- protocol_double: wiring only, labelled, never evidence of the real provider ----
test.skipIf(!irsimAvailable)('protocol_double: a worker double that dies on its first step fails every run (labelled protocol_double, never pass); a double that answers garbage is a missing prerequisite (not_run)',async()=>{
 const out=await temp('irsim-batch-double-');dirs.push(out);
 const crash=await runIRSimBatch({campaignPath:campaign('c02-concurrent'),outDir:join(out,'crash'),concurrency:2,sourceCommit:'test-commit',entry:[double('crash_after_step.py')]});
 const cs=await json<Summary>(crash.summaryPath);
 expect(cs.provider.kind).toBe('protocol_double');
 expect(crash.runs.map(r=>r.result)).toEqual(['fail','fail']);expect(crash.complete).toBe(false);expect(crash.status).toBe('failed');
 for(const r of cs.runs)expect(r.reasons.join(' ')).toMatch(/EVIDENCE_INCOMPLETE|BUSINESS_OUTCOME|RUN_ERROR/);
 const garbage=await runIRSimBatch({campaignPath:campaign('c02-concurrent'),outDir:join(out,'garbage'),concurrency:1,sourceCommit:'test-commit',entry:[double('scripted.py'),'--mode','garbage']});
 expect(garbage.status).toBe('not_run');expect(garbage.complete).toBe(false);
 expect(garbage.runs.every(r=>r.result==='not_run')).toBe(true);
 expect(garbage.reasons[0]).toMatch(/^PREREQUISITE_MISSING:IRSIM_WORKER_UNAVAILABLE/);
 expect(existsSync(join(out,'garbage','runs'))).toBe(false); // nothing ran in its place
},600_000);
