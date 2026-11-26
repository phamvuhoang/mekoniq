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
import {CONFORMANCE_CASES,MEASURE_CASES,SENSOR_CASES} from '../../packages/bench/src/cases/index';
import {checkManifest,readJsonFile,readManifest,readTrace} from '../../packages/bench/src/evidence';
import {sessionExtra,writeBenchPart} from '../../packages/bench/src/record';
import {armingFor,calibrationKind,casesOf,describeSession,identify,identityProblem,outProblem,prompterFor,run,sensors,writeCalibration,type Loaded,type Spawn}
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
 * `workerKit` makes the worker run another kit than the one the CLI loaded (serials changed on the bench); `lostAt` / `abortAt` act on the n-th bus step. */
function rig(kit=KIT,o:{workerKit?:BenchKitV1;lostAt?:number;abortAt?:number;session?:BenchSessionV1;arm?:boolean;spawnFails?:boolean}={}){
 const d=fresh('rig');mkdirSync(d);cpSync(join(FIXTURES,'bytes'),join(d,'bytes'),{recursive:true});
 const kitPath=join(d,'kit.json'),workerPath=o.workerKit?join(d,'worker-kit.json'):kitPath;
 writeFileSync(kitPath,JSON.stringify(kit));if(o.workerKit)writeFileSync(workerPath,JSON.stringify(o.workerKit));
 cpSync(join(FIXTURES,'sim-esi.summary.json'),join(d,'sim-esi.summary.json'));
 const calls:{role:string;readOnly:boolean}[]=[],ops:string[]=[],lines:string[]=[],ac=new AbortController();let steps=0;
 const spawn:Spawn=async(role,readOnly)=>{
  calls.push({role,readOnly});
  if(o.spawnFails)throw new BenchWorkerError('WORKER_LOST','not_sent','test: python is missing');
  const w=await spawnBenchWorker({role,python:PY,kitPath:workerPath,bus:'sim',readOnly,sessionId:'flow',deadlinesMs:{step:5000}});workers.push(w);
  return {get tick(){return w.tick;},get pid(){return w.pid;},get stderr(){return w.stderr;},close:()=>{ops.push(`${role}:close`);return w.close();},
   request(op,payload,t){
    ops.push(`${role}:${op}`);
    if(op==='step'&&role==='bus'){
     if(++steps===o.abortAt)ac.abort();
     if(o.lostAt!==undefined&&steps>=o.lostAt)return Promise.reject(new BenchWorkerError('WORKER_LOST','unknown','test: the worker is gone'));
    }
    return w.request(op,payload,t);
   }};
 };
 const l:Loaded={kit,kitPath,policy:POLICY,session:o.session??SESSION};
 return {l,calls,ops,lines,io:{spawn,clock:fakeClock(),arming:{arm:async()=>o.arm??true},abort:ac.signal,log:(x:string)=>{lines.push(x);}}};
}
const statuses=async(part:string)=>Object.fromEntries(await Promise.all(readdirSync(join(part,'cases')).map(async id=>{const t=await readTrace(join(part,'cases',id));return [id,t.meta?.runner??'evaluated'];})));
const clean=async(part:string)=>checkManifest(part,await readManifest(part));
async function identityOf(kit=KIT){const r=rig(kit),out=fresh('identity');expect(await identify(r.l,out,r.io)).toBe(0);return out;}

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
  expect(casesOf('measure',{}).map(c=>c.id)).toEqual(MEASURE_CASES.map(c=>c.id));
  expect(casesOf('conformance',{from:'KCF05'}).map(c=>c.id)).toEqual(CONFORMANCE_CASES.slice(2).map(c=>c.id));
  expect(casesOf('conformance',{only:'KCF05'}).map(c=>c.id)).toEqual(['KCF05']);
  expect(()=>casesOf('conformance',{from:'KCF05',only:'KCF05'})).toThrow(/INVALID_OPTION/);
  expect(()=>casesOf('measure',{only:'KCF02'})).toThrow(/INVALID_OPTION.*not a measure case/);
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
  const swapped=reseal(KIT,k=>{Object.assign(k.simSlave!,{serials:['SIM-0002','SIM-0001']});});
  const r=rig(KIT,{workerKit:swapped}),out=fresh('conformance');
  expect(await run(r.l,{identity,suite:'conformance',out},r.io)).toBe(1);
  expect(r.lines.join('\n')).toMatch(/BENCH_IDENTITY_CHANGED.*serials on the bus now 1:SIM-0002, 2:SIM-0001; in the identity part 1:SIM-0001, 2:SIM-0002/);
  expect(r.ops).toEqual(['bus:describe','bus:open','bus:scan','bus:close']);
  expect(Object.values(await statuses(out)).every(s=>(s as {reason:string}).reason==='BENCH_IDENTITY_CHANGED')).toBe(true);
  expect(await clean(out)).toEqual([]);
  // another kit's identity part, and a tampered one
  expect(await identityProblem(await identityOf(reseal(KIT,k=>{Object.assign(k.simSlave!,{velocityScale:0.9});})),KIT,[{position:1,serial:'SIM-0001'},{position:2,serial:'SIM-0002'}])).toMatch(/kit digest/);
  appendFileSync(join(identity,'identity.json'),' ');
  expect(await identityProblem(identity,KIT,[{position:1,serial:'SIM-0001'},{position:2,serial:'SIM-0002'}])).toMatch(/manifest/);
 },120_000);
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
  for(const c of CONFORMANCE_CASES.slice(1))expect(s[c.id]).toEqual({status:'not_run',reason:'SUITE_STOPPED_AFTER_OPERATOR_ABORT'});
  expect(r.ops).not.toContain('bus:silence');
  expect(r.lines.join('\n')).toMatch(/--from KCF02/);
 },120_000);
 it('a lost worker: the case failed WORKER_LOST, the suite stopped, the part written, the worker closed',async()=>{
  const identity=await identityOf(),r=rig(KIT,{lostAt:4}),out=fresh('conformance');
  expect(await run(r.l,{identity,suite:'conformance',out},r.io)).toBe(1);
  const s=await statuses(out);
  expect(s.KCF02).toEqual({status:'failed',reason:'WORKER_LOST'});expect(s.KCF03).toEqual({status:'not_run',reason:'SUITE_STOPPED_AFTER_WORKER_LOST'});
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
  expect(s.KCF05).toEqual({status:'not_run',reason:'SUITE_STOPPED_AFTER_OPERATOR_ABORT'});
  expect(await clean(out)).toEqual([]);expect(readdirSync(dir).filter(f=>/\.(new|old)-/.test(f))).toEqual([]);
 },180_000);
 it('measure on the simulated slave: requires is enforced across parts, and no calibration dataset comes from an empty KMS01',async()=>{
  const identity=await identityOf(),r=rig(),out=fresh('measure');
  expect(await run(r.l,{identity,suite:'measure',out},r.io)).toBe(1);
  expect(Object.values(await statuses(out)).every(s=>(s as {reason:string}).reason==='BENCH_ORDER_VIOLATION')).toBe(true);
  expect(r.lines.join('\n')).toMatch(/no calibration dataset: NO_CALIBRATION_TRIALS/);expect(existsSync(join(out,'calibration'))).toBe(false);
 },120_000);
});

describe('the calibration dataset of a measure part',()=>{
 it('sourceKind follows the stored worker backend: synthetic with a generator on sim, measured only on soem with an attestation',async()=>{
  expect(calibrationKind('sim',SESSION)).toBe('synthetic');expect(calibrationKind('soem',SESSION)).toBe('measured');
  expect(calibrationKind('soem',{...SESSION,operator:' '})).toBeNull();expect(calibrationKind(undefined,SESSION)).toBeNull();
  const w=await spawnBenchWorker({role:'bus',python:PY,kitPath:join(FIXTURES,'kit-sim-v1.json'),bus:'sim',readOnly:false,sessionId:'c',deadlinesMs:{step:5000}});workers.push(w);
  const describe=(await w.request('describe',{},0)).result!,{scan}=await startBenchSession(w);
  const ctx={worker:w,kit:KIT,policy:POLICY,clock:fakeClock(),arming:{arm:async()=>true},passed:new Set(['KCF02','KCF04','KCF01']),abort:new AbortController().signal};
  const results=[{caseId:'KMS01',...await runCase(MEASURE_CASES[0]!,ctx)}],data={session:SESSION,kit:KIT,policy:POLICY,results};
  expect(results[0]!.verdict.status).toBe('tested');
  const part=fresh('measure');await writeBenchPart(part,'measure',{...data,extra:{...sessionExtra(describe,scan),describe}});
  expect(await writeCalibration(part,data)).toMatch(/calibration dataset \(synthetic\)/);
  const sidecar=JSON.parse(readFileSync(join(part,'calibration/sidecar.json'),'utf8')) as {sourceKind:string;generator?:string;attestation?:unknown;configDigest:string};
  expect(sidecar).toMatchObject({sourceKind:'synthetic',configDigest:KIT.digest});expect(sidecar.generator).toMatch(/simulated slave/);expect(sidecar.attestation).toBeUndefined();
  // the stored backend, not the kit, decides: a part that says soem on a sim kit gets no dataset
  const soem=fresh('measure');await writeBenchPart(soem,'measure',{...data,extra:{...sessionExtra(describe,scan),describe:{...describe,backend:'soem'}}});
  expect(await writeCalibration(soem,data)).toMatch(/no calibration dataset: SYNTHETIC_CANNOT_BE_MEASURED/);expect(existsSync(join(soem,'calibration'))).toBe(false);
 },120_000);
});

describe('sensors',()=>{
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
