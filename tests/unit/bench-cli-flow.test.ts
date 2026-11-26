// K07b: the flow rules of the bench CLI (scripts/bench.mjs), through packages/bench/src/cli-flow.ts with the real bench worker (simulated slave) and a fakeClock.
// Faults are injected by wrapping the worker client: a step that never answers (worker lost), an abort key at a given step. Temp directories live under os.tmpdir().
import {appendFileSync,cpSync,existsSync,mkdirSync,mkdtempSync,readdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterAll,afterEach,describe,expect,it,vi} from 'vitest';
import {sealBench,type BenchKitV1,type BenchPolicy,type BenchSessionV1} from '../../packages/bench/src/contracts';
import {fakeClock} from '../../packages/bench/src/clock';
import {BenchWorkerError,spawnBenchWorker,type BenchWorker} from '../../packages/bench/src/worker';
import {runCase,startBenchSession} from '../../packages/bench/src/session';
import {BENCH_CASES,CONFORMANCE_CASES,MEASURE_CASES,SENSOR_CASES,type BenchCase,type ScanSlave} from '../../packages/bench/src/cases/index';
import {checkManifest,readJsonFile,readManifest,readTrace} from '../../packages/bench/src/evidence';
import {sessionExtra,writeBenchPart} from '../../packages/bench/src/record';
import {armingFor,calibrationKind,casesOf,describeSession,identify,identityPart,outProblem,prompterFor,run,sensors,writeCalibration,type Loaded,type Spawn}
 from '../../packages/bench/src/cli-flow';

const PY=process.env.BENCH_PYTHON??'python3',ROOT=fileURLToPath(new URL('../..',import.meta.url));
const FIXTURES=fileURLToPath(new URL('../../robotics/bench/fixtures/',import.meta.url));
const dir=mkdtempSync(join(tmpdir(),'bench-cli-flow-'));
const fixture=<T>(f:string)=>JSON.parse(readFileSync(join(FIXTURES,f),'utf8')) as T;
const reseal=<T extends {digest:string}>(doc:T,edit:(d:T)=>void):T=>{const {digest:_,...k}=structuredClone(doc);void _;edit(k as T);return sealBench<T>(k as Omit<T,'digest'>);};
const KIT=fixture<BenchKitV1>('kit-sim-v1.json'),AC=fixture<BenchKitV1>('kit-sim-ac-v1.json');
const POLICY=reseal(fixture<BenchPolicy>('policy-v1.json'),p=>{p.soakMinutes=0.1;p.lagTrials=4;});
const SOEM=reseal(KIT,k=>{k.bus.backend='soem';k.bus.interface='enx-bench';delete k.simSlave;});
const SESSION:BenchSessionV1={schemaVersion:1,documentType:'bench-session',operator:'Lan',observer:'Minh',location:'bench',startedAt:'2026-11-27T09:00:00Z',
 declarations:{estopCutsMotorPower:true,estopTestedToday:true,motorsClamped:true,shaftLoad:'bare',powerWiredBy:'An',mainsQualified:null,readManualSections:['3.2']},instruments:[]};
const SENSOR_KIT=reseal(KIT,k=>{Object.assign(k.simSlave!,{sensorBytes:{lidar:'bytes/ld19-synth.bin',imu:'bytes/wit-synth.bin'}});});
let n=0;
const workers:BenchWorker[]=[];
const fresh=(name:string)=>join(dir,`${name}-${++n}`);
afterEach(async()=>{await Promise.all(workers.splice(0).map(w=>w.close()));});
afterAll(()=>rmSync(dir,{recursive:true,force:true}));

/** A kit file (beside a copy of fixtures/bytes), the spawn the CLI would use, and what the flow did: spawned roles, ops sent, printed lines.
 * `serials` makes the worker's scan report other drives (as on real hardware, where the serials are not in the kit: same kit digest); `kitDigest` makes its describe
 * report another kit; `closeFails` makes close() reject after the worker stopped; `lostAt` / `abortAt` act on the n-th bus step. */
function rig(kit=KIT,o:{serials?:string[];kitDigest?:string;closeFails?:boolean;lostAt?:number;abortAt?:number;session?:BenchSessionV1;arm?:boolean;spawnFails?:boolean;
 summary?:(s:{objects:{index:string}[]})=>void}={}){
 const d=fresh('rig');mkdirSync(d);cpSync(join(FIXTURES,'bytes'),join(d,'bytes'),{recursive:true});
 const kitPath=join(d,'kit.json'),workerPath=kitPath;
 writeFileSync(kitPath,JSON.stringify(kit));
 const summary=fixture<{objects:{index:string}[]}>('sim-esi.summary.json');o.summary?.(summary);writeFileSync(join(d,'sim-esi.summary.json'),JSON.stringify(summary));
 const calls:{role:string;readOnly:boolean}[]=[],ops:string[]=[],lines:string[]=[],ac=new AbortController();let steps=0;
 const spawn:Spawn=async(role,readOnly)=>{
  calls.push({role,readOnly});
  if(o.spawnFails)throw new BenchWorkerError('WORKER_LOST','not_sent','test: python is missing');
  const w=await spawnBenchWorker({role,python:PY,kitPath:workerPath,bus:'sim',readOnly,sessionId:'flow',deadlinesMs:{step:5000}});workers.push(w);
  return {get tick(){return w.tick;},get pid(){return w.pid;},get stderr(){return w.stderr;},close:async()=>{ops.push(`${role}:close`);await w.close();if(o.closeFails)throw new Error('test: close failed');},
   request(op,payload,t){
    ops.push(`${role}:${op}`);
    if(op==='step'&&role==='bus'){
     if(++steps===o.abortAt)ac.abort();
     if(o.lostAt!==undefined&&steps>=o.lostAt)return Promise.reject(new BenchWorkerError('WORKER_LOST','unknown','test: the worker is gone'));
    }
    return w.request(op,payload,t).then(a=>{
     if(a.ok&&op==='scan'&&o.serials)a.result={...a.result,slaves:(a.result!.slaves as ScanSlave[]).map((x,i)=>({...x,serial:o.serials![i]!}))};
     if(a.ok&&op==='describe'&&o.kitDigest)a.result={...a.result,kitDigest:o.kitDigest};
     return a;
    });
   }};
 };
 const l:Loaded={kit,kitPath,policy:POLICY,session:o.session??SESSION};
 return {l,calls,ops,lines,io:{spawn,clock:fakeClock(),arming:{arm:async()=>o.arm??true},abort:ac.signal,log:(x:string)=>{lines.push(x);}}};
}
const statuses=async(part:string)=>Object.fromEntries(await Promise.all(readdirSync(join(part,'cases')).map(async id=>{const t=await readTrace(join(part,'cases',id));return [id,t.meta?.runner??'evaluated'];})));
const clean=async(part:string)=>checkManifest(part,await readManifest(part));
async function identityOf(kit=KIT,o:{summary?:(s:{objects:{index:string}[]})=>void;code?:number}={}){const r=rig(kit,o),out=fresh('identity');expect(await identify(r.l,out,r.io)).toBe(o.code??0);return out;}
const FIRST_MOTION=['KCF02'];   // KCF04 and KCF01 join by id once they are registered

describe('the two test hooks are honoured only on the simulated slave',()=>{
 it('BENCH_TEST_ARMING=1 arms a sim kit without a question; with a soem kit it is ignored and said so; otherwise ttyArming decides',async()=>{
  const lines:string[]=[],log=(x:string)=>{lines.push(x);},q=vi.fn(async()=>'');
  expect(await armingFor(KIT,{BENCH_TEST_ARMING:'1'},{isTTY:false,question:q},log).arm('x')).toBe(true);
  expect(await armingFor(SOEM,{BENCH_TEST_ARMING:'1'},{isTTY:false,question:q},log).arm('x')).toBe(false);
  expect(lines).toEqual([expect.stringMatching(/^BENCH_TEST_ARMING is ignored: the kit's bus is soem/)]);
  expect(await armingFor(KIT,{BENCH_TEST_ARMING:'yes'},{isTTY:false,question:q},log).arm('x')).toBe(false);
  expect(await armingFor(KIT,{},{isTTY:false,question:q},log).arm('x')).toBe(false);
  expect(q).not.toHaveBeenCalled();
  const wrong=vi.fn(async(_q:string)=>'not the code');   // a terminal: ttyArming shows its own (crypto) code; three wrong answers, no torque
  expect(await armingFor(SOEM,{BENCH_TEST_ARMING:'1'},{isTTY:true,question:wrong},log).arm('KCF02')).toBe(false);
  expect(wrong).toHaveBeenCalledTimes(3);expect(wrong.mock.calls[0]![0]).toMatch(/type \d{4} to arm/);
 });
 it('BENCH_TEST_ANSWERS answers prompts on a sim kit only; without a terminal there is no prompter',async()=>{
  const f=join(dir,'answers.json'),lines:string[]=[];writeFileSync(f,JSON.stringify({'markOffsetDeg:amr-1/wheel-left':'3'}));
  expect(await prompterFor(KIT,{BENCH_TEST_ANSWERS:f},{isTTY:false,question:async()=>''},()=>{})!.ask({id:'markOffsetDeg:amr-1/wheel-left',text:'?'})).toBe('3');
  await expect(prompterFor(KIT,{BENCH_TEST_ANSWERS:f},{isTTY:false,question:async()=>''},()=>{})!.ask({id:'other',text:'?'})).rejects.toThrow(/no answer for other/);
  expect(prompterFor(SOEM,{BENCH_TEST_ANSWERS:f},{isTTY:false,question:async()=>''},x=>{lines.push(x);})).toBeUndefined();
  expect(lines).toEqual([expect.stringMatching(/^BENCH_TEST_ANSWERS is ignored/)]);
  expect(prompterFor(KIT,{},{isTTY:false,question:async()=>''},()=>{})).toBeUndefined();
  const bad=join(dir,'bad-answers.json');writeFileSync(bad,'{not json');
  expect(()=>prompterFor(KIT,{BENCH_TEST_ANSWERS:bad},{isTTY:false,question:async()=>''},()=>{})).toThrow(expect.objectContaining({code:'BENCH_TEST_ANSWERS_INVALID'}) as Error);
  expect(await prompterFor(KIT,{},{isTTY:true,question:async q=>`typed after ${q.trim()}`},()=>{})!.ask({id:'p',text:'Mark?'})).toBe('typed after Mark?\n>');
 });
 it('cli-flow reads the environment only inside testHook',()=>{
  const src=readFileSync(join(ROOT,'packages/bench/src/cli-flow.ts'),'utf8');
  expect([...src.matchAll(/\benv\s*(\[|\.\w)/g)]).toHaveLength(1);
  expect(src).not.toMatch(/process\.env/);
 });
});

describe('arguments and outputs',()=>{
 it('suites run in their registered order; --from starts at a case, --case runs one; together or unknown is refused',()=>{
  expect(casesOf('conformance',{}).map(c=>c.id)).toEqual(CONFORMANCE_CASES.map(c=>c.id));
  expect(casesOf('measure',{}).map(c=>c.id)).toEqual([...FIRST_MOTION,...MEASURE_CASES.map(c=>c.id)]);   // a measurement session re-runs the first-motion cases
  expect(casesOf('conformance',{from:'KCF05'}).map(c=>c.id)).toEqual(CONFORMANCE_CASES.slice(2).map(c=>c.id));
  expect(casesOf('conformance',{only:'KCF05'}).map(c=>c.id)).toEqual(['KCF05']);
  expect(()=>casesOf('conformance',{from:'KCF05',only:'KCF05'})).toThrow(/INVALID_OPTION/);
  expect(()=>casesOf('measure',{only:'KCF05'})).toThrow(/INVALID_OPTION.*not a measure case/);
 });
 it('an output inside any repository is refused, an existing one too unless --from',()=>{
  expect(outProblem(join(ROOT,'not-yet/deep/out'),false)).toBe('OUTPUT_MUST_BE_OUTSIDE_REPOSITORIES');
  expect(outProblem(join(ROOT,'packages'),true)).toBe('OUTPUT_MUST_BE_OUTSIDE_REPOSITORIES');
  expect(outProblem(dir,false)).toBe('OUT_EXISTS');expect(outProblem(dir,true)).toBeNull();expect(outProblem(join(dir,'new/out'),false)).toBeNull();
 });
 it('the session declarations are read back in plain words, said to be unchecked',()=>{
  const text=describeSession(SESSION).join('\n');
  expect(text).toMatch(/Lan/);expect(text).toMatch(/emergency stop cuts motor power: yes/);expect(text).toMatch(/motors are clamped: yes/);expect(text).toMatch(/cannot check/);
 });
});

describe('identify is read-only',()=>{
 it('a read-only worker; describe, open, scan, nothing else; KID02-KID05 judged; the identity part written and intact',async()=>{
  const r=rig(),out=fresh('identity');
  expect(await identify(r.l,out,r.io)).toBe(0);
  expect(r.calls).toEqual([{role:'bus',readOnly:true}]);
  expect(r.ops).toEqual(['bus:describe','bus:open','bus:scan','bus:close']);
  expect(await clean(out)).toEqual([]);
  expect(Object.keys(await statuses(out)).sort()).toEqual(['KID02','KID03','KID04','KID05']);
  const x=await readJsonFile(join(out,'identity.json')) as {slaves:{serial:string}[];describe:{backend:string}};
  expect(x.slaves.map(s=>s.serial)).toEqual(['SIM-0001','SIM-0002']);expect(x.describe.backend).toBe('sim');
  expect(await readJsonFile(join(out,'session.json'))).toEqual(SESSION);
 },60_000);
 it('a refused scan is recorded: KID02 failed with the code, the part still written, exit 1',async()=>{
  const r=rig(reseal(KIT,k=>{Object.assign(k.simSlave!,{serials:['SIM-0001']});})),out=fresh('identity');
  expect(await identify(r.l,out,r.io)).toBe(1);
  expect(r.ops).not.toContain('bus:configure');
  const s=await statuses(out);
  expect(s.KID02).toEqual({status:'failed',reason:'BENCH_SLAVE_COUNT'});expect(s.KID03).toBe('evaluated');
  expect((await readJsonFile(join(out,'identity.json')) as {refusal:{code:string};slaves:unknown[]})).toMatchObject({refusal:{code:'BENCH_SLAVE_COUNT'},slaves:[]});
  expect(await clean(out)).toEqual([]);
 },60_000);
});

describe('run',()=>{
 it('refuses torque on the session declarations before any worker starts',async()=>{
  const bad={...SESSION,declarations:{...SESSION.declarations,motorsClamped:false}},r=rig(KIT,{session:bad}),out=fresh('conformance');
  expect(await run(r.l,{identity:fresh('none'),suite:'conformance',out},r.io)).toBe(1);
  expect(r.calls).toEqual([]);expect(r.lines.join('\n')).toMatch(/SESSION_CLAMP_REQUIRED/);expect(existsSync(out)).toBe(false);
  const ac=rig(AC);
  expect(await run(ac.l,{identity:fresh('none'),suite:'conformance',out},ac.io)).toBe(1);
  expect(ac.calls).toEqual([]);expect(ac.lines.join('\n')).toMatch(/SESSION_MAINS_QUALIFICATION_REQUIRED/);
 });
 it('needs the identity of these very serials, of this kit, intact: otherwise BENCH_IDENTITY_CHANGED and nothing is enabled',async()=>{
  const identity=await identityOf();
  const r=rig(KIT,{serials:['SIM-0002','SIM-0001']}),out=fresh('conformance');
  expect(await run(r.l,{identity,suite:'conformance',out},r.io)).toBe(1);
  expect(r.lines.join('\n')).toMatch(/BENCH_IDENTITY_CHANGED.*serials on the bus now 1:SIM-0002, 2:SIM-0001; in the identity part 1:SIM-0001, 2:SIM-0002/);
  expect(r.ops).toEqual(['bus:describe','bus:open','bus:scan','bus:close']);
  expect(Object.values(await statuses(out)).every(s=>(s as {reason:string}).reason==='BENCH_IDENTITY_CHANGED')).toBe(true);
  expect(await clean(out)).toEqual([]);
  // another kit's identity part, and a tampered one: refused before any worker (G2), the manifest checked before its verdicts are read
  expect(await identityPart(await identityOf(reseal(KIT,k=>{Object.assign(k.simSlave!,{velocityScale:0.9});})),KIT)).toMatchObject({problem:expect.stringMatching(/kit digest/) as string});
  appendFileSync(join(identity,'identity.json'),' ');
  expect(await identityPart(identity,KIT)).toMatchObject({problem:expect.stringMatching(/manifest/) as string});
  const t=rig();
  expect(await run(t.l,{identity,suite:'conformance',out:fresh('conformance')},t.io)).toBe(1);
  expect(t.calls).toEqual([]);expect(t.lines.join('\n')).toMatch(/REFUSED BENCH_IDENTITY_CHANGED: the identity part does not match its manifest/);
 },120_000);
 it('the worker must have loaded the kit the CLI validated: another digest in describe is BENCH_KIT_CHANGED before any scan',async()=>{
  const identity=await identityOf(),r=rig(KIT,{kitDigest:'f'.repeat(64)}),out=fresh('conformance');
  expect(await run(r.l,{identity,suite:'conformance',out,only:'KCF02'},r.io)).toBe(1);
  expect(r.ops).toEqual(['bus:describe','bus:close']);expect(r.lines.join('\n')).toMatch(/BENCH_KIT_CHANGED/);
  expect(await statuses(out)).toEqual({KCF02:{status:'not_run',reason:'BENCH_KIT_CHANGED'}});
  const i=rig(KIT,{kitDigest:'f'.repeat(64)}),io=fresh('identity');
  expect(await identify(i.l,io,i.io)).toBe(1);expect(i.ops).toEqual(['bus:describe','bus:close']);
  expect((await statuses(io)).KID02).toEqual({status:'failed',reason:'BENCH_KIT_CHANGED'});
 },120_000);
 it('a worker whose close() rejects: the part is still written, then the close failure is reported, exit 1',async()=>{
  const identity=await identityOf(),r=rig(KIT,{closeFails:true}),out=fresh('conformance');
  expect(await run(r.l,{identity,suite:'conformance',out,only:'KCF02'},r.io)).toBe(1);
  expect(await statuses(out)).toEqual({KCF02:'evaluated'});expect(await clean(out)).toEqual([]);
  expect(r.lines.join('\n')).toMatch(/WORKER_CLOSE_FAILED.*test: close failed/);
 },120_000);
 it('--from with other drives on the bus (same kit digest, as on hardware) is BENCH_IDENTITY_CHANGED; the stored part is left untouched',async()=>{
  const identityA=await identityOf(),out=fresh('conformance'),first=rig();
  expect(await run(first.l,{identity:identityA,suite:'conformance',out,only:'KCF02'},first.io)).toBe(0);
  const before=readFileSync(join(out,'manifest.json'),'utf8'),other=['SIM-0003','SIM-0004'];
  const b=rig(KIT,{serials:other}),identityB=fresh('identity');expect(await identify(b.l,identityB,b.io)).toBe(0);   // a clean identity of the other drives, same kit digest
  const r=rig(KIT,{serials:other});
  expect(await run(r.l,{identity:identityB,suite:'conformance',out,from:'KCF03'},r.io)).toBe(1);
  expect(r.calls).toEqual([]);
  expect(r.lines.join('\n')).toMatch(/BENCH_IDENTITY_CHANGED.*stored part 1:SIM-0001, 2:SIM-0002.*identity part 1:SIM-0003, 2:SIM-0004/);
  expect(readFileSync(join(out,'manifest.json'),'utf8')).toBe(before);
  // the stored part and the identity agree but the bus now shows other drives: refused after the scan, before configure, and still not rewritten
  const s=rig(KIT,{serials:other});
  expect(await run(s.l,{identity:identityA,suite:'conformance',out,from:'KCF03'},s.io)).toBe(1);
  expect(s.ops).toEqual(['bus:describe','bus:open','bus:scan','bus:close']);expect(s.lines.join('\n')).toMatch(/BENCH_IDENTITY_CHANGED/);
  expect(readFileSync(join(out,'manifest.json'),'utf8')).toBe(before);
 },180_000);
 it('one case, armed: configure, start, KCF02 tested, the part intact with the session copied in',async()=>{
  const identity=await identityOf(),r=rig(),out=fresh('conformance');
  expect(await run(r.l,{identity,suite:'conformance',out,only:'KCF02'},r.io)).toBe(0);
  expect(r.ops.slice(0,5)).toEqual(['bus:describe','bus:open','bus:scan','bus:configure','bus:start']);
  expect(await statuses(out)).toEqual({KCF02:'evaluated'});expect(await clean(out)).toEqual([]);
  expect(await readJsonFile(join(out,'session.json'))).toEqual(SESSION);
  expect(r.lines.join('\n')).toMatch(/simulated slave \(protocol_double\).*proves nothing about a drive/);
 },120_000);
 it('not armed: the torque case is not_run BENCH_NOT_ARMED and the exit code is 1',async()=>{
  const identity=await identityOf(),r=rig(KIT,{arm:false}),out=fresh('conformance');
  expect(await run(r.l,{identity,suite:'conformance',out,only:'KCF02'},r.io)).toBe(1);
  expect(await statuses(out)).toEqual({KCF02:{status:'not_run',reason:'BENCH_NOT_ARMED'}});
  expect(r.ops).not.toContain('bus:step');
 },120_000);
 it('a key during a case aborts it; the suite stops there, the rest is recorded not_run, and the operator is told to continue with --from',async()=>{
  const identity=await identityOf(),r=rig(KIT,{abortAt:3}),out=fresh('conformance');
  expect(await run(r.l,{identity,suite:'conformance',out},r.io)).toBe(1);
  const s=await statuses(out);
  expect(s.KCF02).toEqual({status:'failed',reason:'OPERATOR_ABORT'});
  for(const c of CONFORMANCE_CASES.slice(1))expect(s[c.id]).toEqual({status:'not_run',reason:'SUITE_STOPPED_AFTER_KCF02'});
  expect(r.ops).not.toContain('bus:silence');
  expect(r.lines.join('\n')).toMatch(/--from KCF02/);
 },120_000);
 it('a lost worker: the case failed WORKER_LOST, the suite stopped, the part written, the worker closed',async()=>{
  const identity=await identityOf(),r=rig(KIT,{lostAt:4}),out=fresh('conformance');
  expect(await run(r.l,{identity,suite:'conformance',out},r.io)).toBe(1);
  const s=await statuses(out);
  expect(s.KCF02).toEqual({status:'failed',reason:'WORKER_LOST'});expect(s.KCF03).toEqual({status:'not_run',reason:'SUITE_STOPPED_AFTER_KCF02'});
  expect(await clean(out)).toEqual([]);expect(r.ops.at(-1)).toBe('bus:close');
  // no worker at all: still a part, every case not_run with the code
  const none=rig(KIT,{spawnFails:true}),out2=fresh('conformance');
  expect(await run(none.l,{identity,suite:'conformance',out:out2},none.io)).toBe(1);
  expect(Object.values(await statuses(out2)).every(x=>(x as {reason:string}).reason==='WORKER_LOST')).toBe(true);expect(await clean(out2)).toEqual([]);
 },120_000);
 it('--from keeps the stored results and extends them; earlier cases must be tested in the stored part; without --from an existing part is not replaced',async()=>{
  const identity=await identityOf(),out=fresh('conformance'),first=rig();
  expect(await run(first.l,{identity,suite:'conformance',out,only:'KCF02'},first.io)).toBe(0);
  const no=rig();
  expect(await run(no.l,{identity,suite:'conformance',out,from:'KCF05'},no.io)).toBe(1);
  expect(no.calls).toEqual([]);expect(no.lines.join('\n')).toMatch(/FROM_EARLIER_NOT_TESTED.*KCF03/);
  const again=rig();
  await expect(run(again.l,{identity,suite:'conformance',out,only:'KCF02'},again.io)).rejects.toThrow(/OUT_EXISTS/);
  const next=rig(KIT,{abortAt:3});
  expect(await run(next.l,{identity,suite:'conformance',out,from:'KCF03'},next.io)).toBe(1);
  const s=await statuses(out);
  expect(s.KCF02).toBe('evaluated');expect(s.KCF03).toEqual({status:'failed',reason:'OPERATOR_ABORT'});   // not BENCH_ORDER_VIOLATION: KCF02 counted as passed
  expect(s.KCF05).toEqual({status:'not_run',reason:'SUITE_STOPPED_AFTER_KCF03'});
  expect(await clean(out)).toEqual([]);expect(readdirSync(dir).filter(f=>/\.(new|old)-/.test(f))).toEqual([]);
 },180_000);
 it('measure re-runs KCF02 first; without KCF04 and KCF01 the measurement cases stay not_run, and no calibration dataset is written',async()=>{
  const identity=await identityOf(),r=rig(),out=fresh('measure');
  expect(await run(r.l,{identity,suite:'measure',out},r.io)).toBe(1);
  const s=await statuses(out);
  expect(s.KCF02).toBe('evaluated');
  for(const c of MEASURE_CASES)expect(s[c.id]).toEqual({status:'not_run',reason:'BENCH_ORDER_VIOLATION'});
  expect(r.lines.join('\n')).toMatch(/no calibration dataset: no KMS01 trial was tested/);expect(existsSync(join(out,'calibration'))).toBe(false);
 },120_000);
 it('measure once KCF04 and KCF01 are registered (test-local stand-ins, picked up by id): the trials run and the dataset is synthetic',async()=>{
  // stand-ins with real (empty) traces and a real verdict, registered only for this test; the suite and the part writer find them by id like the real ones later
  const stand=(id:string,requires:string[]):BenchCase=>({id,needsTorque:true,requires,script:()=>({ticks:0,commandsAt:()=>[]}),evaluate:()=>({status:'tested',reason:null,measurements:[]})});
  const extra=[stand('KCF04',['KCF02']),stand('KCF01',['KCF02','KCF04'])];(BENCH_CASES as BenchCase[]).push(...extra);
  try{
  expect(casesOf('measure',{}).map(c=>c.id)).toEqual(['KCF02','KCF04','KCF01',...MEASURE_CASES.map(c=>c.id)]);
  const identity=await identityOf(),r=rig(),out=fresh('measure');
  expect(await run(r.l,{identity,suite:'measure',out},r.io)).toBe(1);   // KMS04 asks the operator: no prompter, not_run
  const s=await statuses(out);
  expect(s.KCF02).toBe('evaluated');expect(s.KMS01).toBe('evaluated');expect(s.KMS04).toEqual({status:'not_run',reason:'BENCH_PROMPT_UNAVAILABLE'});
  const sidecar=JSON.parse(readFileSync(join(out,'calibration/sidecar.json'),'utf8')) as {sourceKind:string;generator?:string};
  expect(sidecar.sourceKind).toBe('synthetic');expect(sidecar.generator).toMatch(/simulated slave/);
  expect(await clean(out)).toEqual([]);
  }finally{for(const c of extra)(BENCH_CASES as BenchCase[]).splice((BENCH_CASES as BenchCase[]).indexOf(c),1);}
 },180_000);
 it('a failed torque case stops the suite like a disarmed one, even when evaluate failed it',async()=>{
  const slow=reseal(KIT,k=>{Object.assign(k.simSlave!,{velocityScale:0.8});});   // KCF02 passes, KCF03 fails on trackingToleranceRadS (evaluate, not the runner)
  const identity=await identityOf(slow),r=rig(slow),out=fresh('conformance');
  expect(await run(r.l,{identity,suite:'conformance',out},r.io)).toBe(1);
  const s=await statuses(out),k3=await readTrace(join(out,'cases/KCF03'));
  expect(s.KCF02).toBe('evaluated');expect(s.KCF03).toBe('evaluated');expect(k3.meta?.runner).toBeUndefined();
  for(const c of CONFORMANCE_CASES.slice(2)){
   expect(s[c.id]).toEqual({status:'not_run',reason:'SUITE_STOPPED_AFTER_KCF03'});   // a code without spaces; the free-text reason is beside it
   expect((await readTrace(join(out,'cases',c.id))).meta?.stoppedBy).toEqual({caseId:'KCF03',reason:expect.stringMatching(/^trackingToleranceRadS exceeded/) as string});
  }
  expect(r.lines.join('\n')).toMatch(/--from KCF03/);
 },180_000);
 it('torque needs a clean identity: a KID case failed or not_run refuses the run before any worker, listing them',async()=>{
  const failed=await identityOf(KIT,{summary:x=>{x.objects=x.objects.filter(o=>!/6064/i.test(o.index));},code:1});
  let r=rig();
  expect(await run(r.l,{identity:failed,suite:'conformance',out:fresh('conformance'),only:'KCF02'},r.io)).toBe(1);
  expect(r.calls).toEqual([]);expect(r.lines.join('\n')).toMatch(/BENCH_IDENTITY_NOT_CLEAN: KID03 failed OBJECT_NOT_IN_DESCRIPTION/);
  const blind=reseal(KIT,k=>{Object.assign(k.simSlave!,{strings:{}});});
  const notRun=await identityOf(blind,{code:1});r=rig(blind);
  expect(await run(r.l,{identity:notRun,suite:'conformance',out:fresh('conformance'),only:'KCF02'},r.io)).toBe(1);
  expect(r.calls).toEqual([]);expect(r.lines.join('\n')).toMatch(/BENCH_IDENTITY_NOT_CLEAN: KID02 not_run FIRMWARE_NOT_READ/);
 },120_000);
});

describe('the calibration dataset of a measure part',()=>{
 it('sourceKind follows the stored worker backend: synthetic with a generator on sim, measured only on soem with an attestation',async()=>{
  expect(calibrationKind('sim')).toBe('synthetic');expect(calibrationKind('soem')).toBe('measured');expect(calibrationKind(undefined)).toBeNull();
  const w=await spawnBenchWorker({role:'bus',python:PY,kitPath:join(FIXTURES,'kit-sim-v1.json'),bus:'sim',readOnly:false,sessionId:'c',deadlinesMs:{step:5000}});workers.push(w);
  const describe=(await w.request('describe',{},0)).result!,{scan}=await startBenchSession(w);
  const ctx={worker:w,kit:KIT,policy:POLICY,clock:fakeClock(),arming:{arm:async()=>true},passed:new Set(['KCF02','KCF04','KCF01']),abort:new AbortController().signal};
  const results=[{caseId:'KMS01',...await runCase(MEASURE_CASES[0]!,ctx)}],data={session:SESSION,kit:KIT,policy:POLICY,results};
  expect(results[0]!.verdict.status).toBe('tested');
  const part=fresh('measure');await writeBenchPart(part,'measure',{...data,extra:{...sessionExtra(describe,scan),describe}});
  expect(await writeCalibration(part,data)).toEqual({line:expect.stringMatching(/calibration dataset \(synthetic\)/) as string});
  const sidecar=JSON.parse(readFileSync(join(part,'calibration/sidecar.json'),'utf8')) as {sourceKind:string;generator?:string;attestation?:unknown;configDigest:string};
  expect(sidecar).toMatchObject({sourceKind:'synthetic',configDigest:KIT.digest});expect(sidecar.generator).toMatch(/simulated slave/);expect(sidecar.attestation).toBeUndefined();
  // the stored backend, not the kit, decides: a part that says soem on a sim kit gets no dataset
  const soem=fresh('measure');await writeBenchPart(soem,'measure',{...data,extra:{...sessionExtra(describe,scan),describe:{...describe,backend:'soem'}}});
  // an export that throws is a failure with its code (the session exits 1), and nothing is left under calibration/
  expect(await writeCalibration(soem,data)).toEqual({line:expect.stringMatching(/calibration dataset export FAILED: SYNTHETIC_CANNOT_BE_MEASURED/) as string,error:'SYNTHETIC_CANNOT_BE_MEASURED'});
  expect(existsSync(join(soem,'calibration'))).toBe(false);
 },120_000);
});

describe('sensors',()=>{
 it('the sensors suite keeps going after a failed case (no torque)',async()=>{
  const r=rig(reseal(SENSOR_KIT,k=>{Object.assign(k.simSlave!,{sensorCorruptEvery:10});})),out=fresh('sensors');
  expect(await sensors(r.l,{out},r.io)).toBe(1);
  const s=await statuses(out);
  expect(s.KSN01).toBe('evaluated');expect(Object.keys(s).sort()).toEqual(SENSOR_CASES.map(c=>c.id).sort());
  expect(Object.values(s).some(x=>/SUITE_STOPPED/.test(JSON.stringify(x)))).toBe(false);
  expect((await readTrace(join(out,'cases/KSN05'))).ticks.length).toBeGreaterThan(0);   // ran after KSN01 failed
 },180_000);
 it('the sensors worker read-only, never armed even with an arming that would say yes, no enable sent; the sensors part written',async()=>{
  const r=rig(SENSOR_KIT,{arm:true}),out=fresh('sensors');
  expect(await sensors(r.l,{out,only:SENSOR_CASES[0]!.id},r.io)).toBe(0);
  // a read-only bus worker refuses `start`, and `step` needs it: the bus worker is writable, the runner's torque gate keeps every enable false
  expect(r.calls).toEqual([{role:'bus',readOnly:false},{role:'sensors',readOnly:true}]);
  const t=await readTrace(join(out,'cases',SENSOR_CASES[0]!.id));
  expect(t.ticks.length).toBeGreaterThan(0);expect(t.ticks.every(x=>!x.armed&&x.driveCommands.every(c=>!c.enable))).toBe(true);
  expect(await statuses(out)).toEqual({[SENSOR_CASES[0]!.id]:'evaluated'});expect(await clean(out)).toEqual([]);
 },120_000);
});
