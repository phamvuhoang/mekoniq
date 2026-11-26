// The session flow of scripts/bench.mjs (K07b; spec B1 §1, §6; BK-D09, BK-D11): everything between parsing the arguments and printing, here so that each flow
// rule is tested with injected workers and a fakeClock. It adds no way around a gate below it: arming is ttyArming, prompts are the terminal's, order is runCase's
// `requires`. The only exceptions are the two test hooks (testHook), honoured only on the simulated slave. Every session writes its part, whatever happens.
import {existsSync,readFileSync,realpathSync} from 'node:fs';
import {mkdir,readdir,rename,rm,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {ttyArming,type Arming} from './arming';
import {exportCalibration} from './calibration-export';
import {CONFORMANCE_CASES,IDENTITY_CASES,MEASURE_CASES,SENSOR_CASES,benchCase,identityScan,simDescriptions,verdictOf,type BenchCase,type CaseTrace,type CaseVerdict,
 type ScanSlave} from './cases/index';
import type {Clock} from './clock';
import {sessionAllowsTorque,type BenchKitV1,type BenchPolicy,type BenchSessionV1} from './contracts';
import {checkManifest,readJsonFile,readManifest,readTrace,writeManifest} from './evidence';
import {sessionExtra,writeBenchPart,type PartKind} from './record';
import {runCase,startBenchSession,type Prompter,type RunContext} from './session';
import type {BenchOp,BenchWorker} from './worker';

export type Log=(line:string)=>void;
export type Spawn=(role:'bus'|'sensors',readOnly:boolean)=>Promise<BenchWorker>;
export interface Loaded{kit:BenchKitV1;kitPath:string;policy:BenchPolicy;session:BenchSessionV1}
export interface FlowIo{spawn:Spawn;clock:Clock;arming:Arming;prompter?:Prompter;abort:AbortSignal;log:Log}
export interface CaseResult{caseId:string;trace:CaseTrace;verdict:CaseVerdict}
type Tty={isTTY:boolean;question(q:string):Promise<string>};
/** spec B1 §6: the first-motion cases pass in the SAME session before any other torque case, so a measurement session re-runs every one that is registered. */
export const FIRST_MOTION=['KCF02','KCF04','KCF01'];
export const SUITES={conformance:CONFORMANCE_CASES,measure:[...FIRST_MOTION.flatMap(id=>benchCase(id)??[]),...MEASURE_CASES],sensors:SENSOR_CASES};
const refused=(code:string,detail:string)=>Object.assign(new Error(`${code}: ${detail}`),{code});
const msg=(e:unknown)=>e instanceof Error?e.message:String(e);
const codeOf=(e:unknown)=>{const c=(e as {code?:unknown}|null)?.code;return typeof c==='string'&&c?c:'CASE_EXCEPTION';};

/** BENCH_TEST_ARMING and BENCH_TEST_ANSWERS: honoured only when the kit's bus is the simulated slave; on any other kit ignored, and said so. */
export function testHook(name:'BENCH_TEST_ARMING'|'BENCH_TEST_ANSWERS',kit:BenchKitV1,env:Record<string,string|undefined>,log:Log):string|undefined{
 const v=env[name];
 if(!v)return undefined;
 if(kit.bus.backend==='sim')return v;
 log(`${name} is ignored: the kit's bus is ${kit.bus.backend}; test hooks work only on the simulated slave`);return undefined;
}
/** BK-D11: the operator types the code ttyArming shows (its own crypto random). Not a terminal: never armed. */
export function armingFor(kit:BenchKitV1,env:Record<string,string|undefined>,tty:Tty,log:Log):Arming{
 return testHook('BENCH_TEST_ARMING',kit,env,log)==='1'?{arm:async()=>true}:ttyArming({isTTY:tty.isTTY,question:q=>tty.question(q)});
}
/** The operator answers at the terminal; not a terminal: no prompter, and a case with prompts is not_run BENCH_PROMPT_UNAVAILABLE. */
export function prompterFor(kit:BenchKitV1,env:Record<string,string|undefined>,tty:Tty,log:Log):Prompter|undefined{
 const file=testHook('BENCH_TEST_ANSWERS',kit,env,log);
 if(file!==undefined){
  const a=JSON.parse(readFileSync(file,'utf8')) as Record<string,unknown>;
  return {ask:async p=>{const x=a[p.id];if(typeof x!=='string')throw new Error(`BENCH_TEST_ANSWERS has no answer for ${p.id}`);return x;}};
 }
 return tty.isTTY?{ask:p=>tty.question(`${p.text}\n> `)}:undefined;
}
/** The repository holding `p` (the nearest ancestor, by real path, with a `.git` entry), or null. */
function repositoryOf(p:string):string|null{
 let d=resolve(p);
 while(!existsSync(d))d=dirname(d);
 for(d=realpathSync(d);;d=dirname(d)){if(existsSync(join(d,'.git')))return d;if(dirname(d)===d)return null;}
}
export const outProblem=(out:string,mayExist:boolean)=>repositoryOf(out)?'OUTPUT_MUST_BE_OUTSIDE_REPOSITORIES':!mayExist&&existsSync(out)?'OUT_EXISTS':null;
export function describeSession(s:BenchSessionV1):string[]{
 const d=s.declarations,yn=(b:boolean|null)=>b===null?'not applicable':b?'yes':'NO';
 return [`Session: operator ${s.operator}, observer ${s.observer??'none'}, at ${s.location}, started ${s.startedAt}.`,
  `You declare: the emergency stop cuts motor power: ${yn(d.estopCutsMotorPower)}; it was tested today: ${yn(d.estopTestedToday)}; the motors are clamped: ${yn(d.motorsClamped)}; `
  +`shaft: ${d.shaftLoad==='bare'?'bare':'light marker disc'}; motor power wired by: ${d.powerWiredBy.trim()||'(nobody named)'}; mains wired by a qualified person: ${yn(d.mainsQualified)}; `
  +`manual sections read: ${d.readManualSections.join(', ')||'none'}.`,
  'These are your declarations. The software cannot check any of them.'];
}
/** The cases of one run: the suite in its registered order, from `from` on, or `only`. */
export function casesOf(suite:keyof typeof SUITES,o:{from?:string;only?:string}):BenchCase[]{
 const all=SUITES[suite],id=o.from??o.only;
 if(o.from&&o.only)throw refused('INVALID_OPTION','--from and --case together');
 if(id===undefined)return [...all];
 const i=all.findIndex(c=>c.id===id);
 if(i<0)throw refused('INVALID_OPTION',`${id} is not a ${suite} case (${all.map(c=>c.id).join(', ')})`);
 return o.only?[all[i]!]:all.slice(i);
}
/** A verdict the CLI decides itself, stored like runCase's own (trace.meta.runner), so verdictOf gives it back from the stored trace. */
const decided=(c:BenchCase,l:{kit:BenchKitV1;policy:BenchPolicy},status:'not_run'|'failed',reason:string,error?:string):CaseResult=>{
 const trace:CaseTrace={ticks:[],cycles:[],prompts:[],meta:{runner:{status,reason},...error?{error}:{}}};
 return {caseId:c.id,trace,verdict:verdictOf(c,trace,l.kit,l.policy)};
};
const show=(r:CaseResult)=>`${r.caseId} ${r.verdict.status}${r.verdict.reason?` ${r.verdict.reason}`:''}`;
/** BK-D11: the cases in order on one context. After every case a disarmed context stops the suite, and so does a `failed` verdict when `stopOnFailed`
 * (the torque suites: plan 02, one case fails, the suite stops; not_run and unsupported_by_device do not): no later case starts, each is not_run
 * SUITE_STOPPED_AFTER_<reason>, and nothing re-arms. A case that throws (a lost worker) is failed with the error's code and stops the suite the same way. */
export async function runSuite(cases:readonly BenchCase[],ctx:RunContext,log:Log,stopOnFailed:boolean):Promise<{results:CaseResult[];stoppedAfter:CaseResult|null}>{
 const results:CaseResult[]=[];let stoppedAfter:CaseResult|null=null;
 for(const c of cases){
  if(stoppedAfter){results.push(decided(c,ctx,'not_run',`SUITE_STOPPED_AFTER_${stoppedAfter.verdict.reason??'DISARMED'}`));continue;}
  log(`${c.id} ...`);
  let r:CaseResult;
  try{r={caseId:c.id,...await runCase(c,ctx)};}catch(e){ctx.disarmed=true;r=decided(c,ctx,'failed',codeOf(e),msg(e));}
  results.push(r);log(show(r));
  if(ctx.disarmed||stopOnFailed&&r.verdict.status==='failed')stoppedAfter=r;
 }
 return {results,stoppedAfter};
}
/** BK-D09: `run` needs the identity part of these very slaves: intact, of this kit, with the same serial at every position. The problem, or null. */
export async function identityProblem(dir:string,kit:BenchKitV1,slaves:readonly {position:number;serial:string}[]):Promise<string|null>{
 try{
  const issues=await checkManifest(dir,await readManifest(dir));
  if(issues.length)return `the identity part does not match its manifest (${issues[0]!.code} ${issues[0]!.path})`;
  const k=await readJsonFile(join(dir,'bench-kit.json')) as {digest?:unknown},x=await readJsonFile(join(dir,'identity.json')) as {slaves?:unknown};
  if(k.digest!==kit.digest)return `the identity part is of kit digest ${String(k.digest)}, this kit is ${kit.digest}`;
  const list=(s:readonly {position:number;serial:string}[])=>[...s].sort((a,b)=>a.position-b.position).map(v=>`${v.position}:${v.serial}`).join(', ')||'none';
  const stored=Array.isArray(x.slaves)?x.slaves as {position:number;serial:string}[]:[];
  return list(stored)===list(slaves)?null:`serials on the bus now ${list(slaves)}; in the identity part ${list(stored)}`;
 }catch(e){return `the identity part cannot be read (${msg(e)})`;}
}
/** The results stored in an existing part (for --from), each verdict recomputed from its reloaded trace; the part must be intact and of this kit and policy. */
async function storedResults(dir:string,l:Loaded,kind:PartKind):Promise<CaseResult[]>{
 const issues=await checkManifest(dir,await readManifest(dir));
 if(issues.length||!existsSync(join(dir,`${kind}.json`)))throw refused('PART_MANIFEST_MISMATCH',`${dir} is not an intact ${kind} part`);
 for(const [file,digest,code] of [['bench-kit.json',l.kit.digest,'KIT_DIGEST_MISMATCH'],['policy.json',l.policy.digest,'POLICY_DIGEST_MISMATCH']] as const)
  if((await readJsonFile(join(dir,file)) as {digest?:unknown}).digest!==digest)throw refused(code,`${dir}/${file}`);
 return Promise.all((await readdir(join(dir,'cases'))).map(async id=>{
  const c=benchCase(id);if(!c)throw refused('CASE_UNKNOWN',id);
  const trace=await readTrace(join(dir,'cases',id));return {caseId:id,trace,verdict:verdictOf(c,trace,l.kit,l.policy)};
 }));
}
/** spec B1 §7.5 step 1 (KSW09): the label follows what the part stored of the worker that ran, never a flag; measured needs the session's attestation. */
export const calibrationKind=(backend:unknown,s:BenchSessionV1)=>backend==='sim'?'synthetic' as const:backend==='soem'&&!!s.operator.trim()&&!!s.startedAt.trim()?'measured' as const:null;
/** The KMS01 trials of a measure part as <part>/calibration/{sidecar.json, <trial>.csv}; returns what to tell the operator. The caller rewrites the manifest. */
export async function writeCalibration(dir:string,data:{session:BenchSessionV1;kit:BenchKitV1;policy:BenchPolicy;results:CaseResult[]}):Promise<string>{
 if(data.results.find(r=>r.caseId==='KMS01')?.verdict.status!=='tested')return 'no calibration dataset: no KMS01 trial was tested';
 try{
  const backend=(await readJsonFile(join(dir,'measure.json')) as {describe?:{backend?:unknown}}).describe?.backend,kind=calibrationKind(backend,data.session);
  if(!kind)return `no calibration dataset: the part's worker backend is ${String(backend)} or the session has no attestation`;
  const {sidecar,files}=exportCalibration({...data,backend:backend as 'sim'|'soem'},{sourceKind:kind,configDigest:data.kit.digest}),d=join(dir,'calibration');
  await mkdir(d);
  for(const f of files)await writeFile(join(d,f.name),f.csv);
  await writeFile(join(d,'sidecar.json'),JSON.stringify(sidecar,null,1));
  return `calibration dataset (${kind}) in ${d}: ${files.length} files`;
 }catch(e){return `no calibration dataset: ${msg(e)}`;}
}
/** writeBenchPart (then, for measure, the calibration dataset and the manifest again). With --from the stored part is replaced only once the new one is complete. */
async function writePart(dir:string,kind:PartKind,data:Parameters<typeof writeBenchPart>[2]&{results:CaseResult[]},replace:boolean,log:Log){
 if(existsSync(dir)&&!replace)throw refused('OUT_EXISTS',dir);
 const target=replace&&existsSync(dir)?`${dir}.new-${process.pid}`:dir;
 await writeBenchPart(target,kind,data);
 if(kind==='measure'){log(await writeCalibration(target,data));await writeManifest(target);}
 if(target!==dir){const old=`${dir}.old-${process.pid}`;await rename(dir,old);await rename(target,dir);await rm(old,{recursive:true,force:true});}
 log(`${kind} part written: ${dir}`);
}
const call=async(w:BenchWorker,op:BenchOp)=>{const a=await w.request(op,{},w.tick);if(!a.ok)throw refused(a.error!.code,a.error!.detail);return a.result!;};
const protocolDouble=(l:Loaded,log:Log)=>{if(l.kit.bus.backend==='sim')log('This ran on the simulated slave (protocol_double). It proves nothing about a drive; every hardware gate of its record stays blocked_external.');};

/** `identify` (BK-D09; spec B1 §6 "read-only first"): a read-only bus worker; describe, open, scan, then KID02-KID05 judged on what scan read. Never configure,
 * start or a step. A refused scan is recorded (identity.json `refusal`) and KID02 is failed with its code. */
export async function identify(l:Loaded,out:string,io:Pick<FlowIo,'spawn'|'log'>):Promise<number>{
 let w:BenchWorker|undefined,describe:Record<string,unknown>={},scan:{slaves:ScanSlave[]}|null=null,refusal:{code:string;detail:string}|null=null;
 const results:CaseResult[]=[];
 try{
  w=await io.spawn('bus',true);describe=await call(w,'describe');
  const q=identityScan(l.kit);
  try{scan=(await startBenchSession(w,q.objects,{strings:q.strings,scanOnly:true})).scan as unknown as {slaves:ScanSlave[]};}
  catch(e){refusal={code:codeOf(e),detail:msg(e)};}
  const descriptions=simDescriptions(l.kit,l.kitPath);
  for(const c of IDENTITY_CASES){
   const trace:CaseTrace={ticks:[],cycles:[],prompts:[],...scan?{scan,descriptions}:{}};
   results.push(!scan&&c.id==='KID02'?decided(c,l,'failed',refusal!.code,refusal!.detail):{caseId:c.id,trace,verdict:verdictOf(c,trace,l.kit,l.policy)});
  }
 }catch(e){refusal??={code:codeOf(e),detail:msg(e)};}
 finally{await w?.close();}
 if(refusal)io.log(`REFUSED ${refusal.detail}`);
 for(const c of IDENTITY_CASES)if(!results.some(r=>r.caseId===c.id))results.push(decided(c,l,'failed',refusal!.code,refusal!.detail));
 for(const r of results)io.log(show(r));
 await writePart(out,'identity',{...l,results,extra:{...sessionExtra(describe,scan??{slaves:[]}),describe,...refusal?{refusal}:{}}},false,io.log);
 protocolDouble(l,io.log);
 return results.every(r=>r.verdict.status==='tested')?0:1;
}

/** spec B1 §7.2: torque only after a clean identity: KID02-KID05 all tested in the identity part (each recomputed from its trace). What is not, or []. */
export async function identityNotClean(dir:string,l:{kit:BenchKitV1;policy:BenchPolicy}):Promise<string[]>{
 const out=await Promise.all(IDENTITY_CASES.map(async c=>{
  try{const v=verdictOf(c,await readTrace(join(dir,'cases',c.id)),l.kit,l.policy);return v.status==='tested'?null:`${c.id} ${v.status} ${v.reason}`;}
  catch(e){return `${c.id} unreadable (${msg(e)})`;}
 }));
 return out.filter((x):x is string=>x!==null);
}
/** One case session (run, sensors): spawn, scan, the identity check (run), configure and start, the suite, close, the part. `seedPassed` is for tests only (the
 * prerequisites of the measurement cases that are not registered yet); bench.mjs never passes it, so the CLI has no way to it. */
export async function caseSession(kind:'conformance'|'measure'|'sensors',l:Loaded,o:{out:string;cases:BenchCase[];stored:CaseResult[];identity?:string;replace:boolean;seedPassed?:string[]},
 io:FlowIo):Promise<number>{
 const torque=kind!=='sensors',ctx:RunContext={worker:undefined as unknown as BenchWorker,kit:l.kit,policy:l.policy,clock:io.clock,arming:torque?io.arming:{arm:async()=>false},
  prompter:io.prompter,abort:io.abort,passed:new Set([...o.stored.filter(r=>r.verdict.status==='tested').map(r=>r.caseId),...o.seedPassed??[]])};
 let bus:BenchWorker|undefined,sensors:BenchWorker|undefined,describe:Record<string,unknown>={},scan:Record<string,unknown>={slaves:[]},refusal:{code:string;detail:string}|null=null;
 let results:CaseResult[]=[],stoppedAfter:CaseResult|null=null;
 try{
  // the bus worker is writable for sensors too: a read-only worker refuses `start`, and `step` needs it (session.py ORDER); no torque because arming always refuses.
  // ponytail: accepted for the simulated backend only; before the first hardware sensors session the sensor cases must run with no bus worker at all (drive power is
  // off in that session and nothing should be written to a drive)
  bus=await io.spawn('bus',false);
  if(!torque)sensors=await io.spawn('sensors',true);
  describe=await call(bus,'describe');
  const s=await startBenchSession(bus,[...new Set(o.cases.flatMap(c=>c.reads??[]))],{scanOnly:true});scan=s.scan;
  if(o.identity){const p=await identityProblem(o.identity,l.kit,s.scan.slaves as ScanSlave[]);if(p)throw refused('BENCH_IDENTITY_CHANGED',p);}
  await call(bus,'configure');await call(bus,'start');
  if(sensors)await call(sensors,'open');
  Object.assign(ctx,{worker:bus,sensors,objects:s.objects});
  ({results,stoppedAfter}=await runSuite(o.cases,ctx,io.log,torque));
 }catch(e){refusal={code:codeOf(e),detail:msg(e)};io.log(`REFUSED ${refusal.detail}`);}
 finally{await Promise.all([bus?.close(),sensors?.close()]);}
 for(const c of o.cases)if(!results.some(r=>r.caseId===c.id))results.push(decided(c,l,'not_run',refusal?.code??'NOT_STARTED',refusal?.detail));
 const all=[...o.stored.filter(r=>!o.cases.some(c=>c.id===r.caseId)),...results];
 await writePart(o.out,kind,{...l,results:all,extra:{...sessionExtra(describe,scan),describe}},o.replace,io.log);
 io.log(`${all.filter(r=>r.verdict.status==='tested').length} of ${all.length} cases tested: ${all.map(show).join('; ')}`);
 if(stoppedAfter)io.log(`The suite stopped after ${stoppedAfter.caseId} (${stoppedAfter.verdict.reason}). Nothing was re-armed. Find the cause first; then continue in the same part with `
  +`--from ${stoppedAfter.caseId} --out ${o.out}.`);
 protocolDouble(l,io.log);
 return all.every(r=>r.verdict.status==='tested')?0:1;
}
/** `run` (BK-D09, D11, D12; spec B1 §7.2): the declarations must allow torque, the identity must be clean; --from needs every earlier case of the suite tested in the stored part; then caseSession. */
export async function run(l:Loaded,o:{identity:string;suite:string;out:string;from?:string;only?:string},io:FlowIo):Promise<number>{
 if(o.suite!=='conformance'&&o.suite!=='measure')throw refused('INVALID_OPTION',`--suite ${o.suite} (conformance or measure)`);
 if(!o.from&&existsSync(o.out))throw refused('OUT_EXISTS',o.out);
 const cases=casesOf(o.suite,o),problems=sessionAllowsTorque(l.session,l.kit);
 if(problems.length){for(const p of problems)io.log(`REFUSED ${p.code} ${p.path}: ${p.detail}`);return 1;}
 const unclean=await identityNotClean(o.identity,l);
 if(unclean.length){io.log(`REFUSED BENCH_IDENTITY_NOT_CLEAN: ${unclean.join('; ')}. Correct the profile (a new revision) and identify again.`);return 1;}
 const stored=o.from&&existsSync(o.out)?await storedResults(o.out,l,o.suite):[];
 const all=SUITES[o.suite],earlier=o.from?all.slice(0,all.indexOf(cases[0]!)):[];
 const missing=earlier.filter(c=>stored.find(r=>r.caseId===c.id)?.verdict.status!=='tested');
 if(missing.length){io.log(`REFUSED FROM_EARLIER_NOT_TESTED: ${missing.map(c=>c.id).join(', ')} not tested in ${o.out}`);return 1;}
 return caseSession(o.suite,l,{out:o.out,cases,stored,identity:o.identity,replace:!!o.from},io);
}
/** `sensors`: the sensors worker read-only, an arming that always refuses (the torque gate of runCase lets no enable leave), the sensor cases. */
export const sensors=(l:Loaded,o:{out:string;only?:string},io:FlowIo)=>caseSession('sensors',l,{out:o.out,cases:casesOf('sensors',o),stored:[],replace:false},io);
