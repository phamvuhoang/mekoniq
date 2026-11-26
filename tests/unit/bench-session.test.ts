// K04: the TS session layer against the real bench worker on its simulated slave (protocol_double). Wire discipline (KSW01), refusals (KSW05), worker and TS loss (KSW10).
import {chmodSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll,afterEach,describe,expect,it} from 'vitest';
import {sealBench,type BenchKitV1,type BenchPolicy,type BenchTickRecord} from '../../packages/bench/src/contracts';
import {fakeClock} from '../../packages/bench/src/clock';
import {ttyArming,type Arming} from '../../packages/bench/src/arming';
import {BENCH_DEADLINES_MS,BenchWorkerError,spawnBenchWorker,type BenchOp,type BenchWorker} from '../../packages/bench/src/worker';
import {PROMPT_HOLD_MAX_TICKS,runCase,startBenchSession,type RunContext} from '../../packages/bench/src/session';
import {verdictOf,type BenchCase} from '../../packages/bench/src/cases/index';

const PY=process.env.BENCH_PYTHON??'python3';
const dir=mkdtempSync(join(tmpdir(),'bench-session-'));
const fixture=<T>(f:string)=>JSON.parse(readFileSync(new URL(`../../robotics/bench/fixtures/${f}`,import.meta.url),'utf8')) as T;
const KIT=fixture<BenchKitV1>('kit-sim-v1.json'),POLICY=fixture<BenchPolicy>('policy-v1.json');
let files=0;
const workers:BenchWorker[]=[];
/** A re-sealed copy of the DC kit with simSlave knobs, written where the worker can read it. */
/** A generous step deadline (the 200 ms contract runs in real time; a loaded host is not the subject here), except where `deadlinesMs` says otherwise. */
async function open(o:{sim?:Record<string,unknown>;python?:string;deadlinesMs?:Partial<Record<BenchOp,number>>}={}){
 const {digest:_,...k}=structuredClone(KIT);void _;Object.assign(k.simSlave!,o.sim);
 const kit=sealBench<BenchKitV1>(k),kitPath=join(dir,`kit-${++files}.json`);writeFileSync(kitPath,JSON.stringify(kit));
 const w=await spawnBenchWorker({role:'bus',python:o.python??PY,kitPath,bus:'sim',readOnly:false,sessionId:'t',deadlinesMs:o.deadlinesMs??{step:5000}});workers.push(w);
 return {w,kit};
}
afterEach(async()=>{await Promise.all(workers.splice(0).map(w=>w.close()));});
afterAll(()=>rmSync(dir,{recursive:true,force:true}));

const yes:Arming={arm:async()=>true},no:Arming={arm:async()=>false};
const counting=(answer:boolean)=>{const a={calls:0,arm:async()=>{a.calls++;return answer;}};return a;};
const ctx=(worker:BenchWorker,kit:BenchKitV1,extra:Partial<RunContext>={}):RunContext=>({worker,kit,policy:POLICY,clock:fakeClock(),arming:yes,passed:new Set(),abort:new AbortController().signal,...extra});
const cmd=(seq:number,o:Record<string,unknown>={})=>KIT.axes.map(a=>({axisId:a.axisId,seq,mode:'csv' as const,target:0,enable:true,quickStop:false,faultReset:false,...o}));
/** A torque case that asks for `target` on both axes for `ticks` ticks; its evaluate passes. */
const holdCase=(o:Partial<BenchCase>&{ticks?:number;target?:number}={}):BenchCase=>({id:'T',needsTorque:true,requires:[],
 script:()=>({ticks:o.ticks??20,commandsAt:k=>cmd(k+1,{target:o.target??1})}),evaluate:()=>({status:'tested',reason:null,measurements:[]}),...o});
const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch{return false;}};
const gone=async(pid:number)=>{for(let i=0;i<100&&alive(pid);i++)await new Promise(r=>setTimeout(r,20));return !alive(pid);};
/** No torque request (enable without quickStop) in these ticks. */
const noTorque=(ticks:BenchTickRecord[])=>ticks.every(t=>t.driveCommands.every(c=>!c.enable||c.quickStop));

describe('worker wire discipline (KSW01)',()=>{
 it('a second request while one is in flight is refused and never queued',async()=>{
  const {w}=await open(),first=w.request('describe',{},0);
  await expect(w.request('describe',{},0)).rejects.toMatchObject({code:'BENCH_REQUEST_IN_FLIGHT',outcome:'not_sent'});
  expect((await first).ok).toBe(true);
 },20_000);
 it('a worker silent past the 200 ms step deadline: WORKER_TIMEOUT, the process group is killed, nothing is sent again',async()=>{
  const log=join(dir,'received.log'),pidFile=join(dir,'python.pid'),wrapper=join(dir,'tee-python.sh');
  // every line the worker receives goes through tee into the log; the python pid is written so the test can freeze only the worker
  writeFileSync(wrapper,`#!/bin/sh\ntee -a '${log}' | sh -c 'echo $$ > "$0"; exec "$@"' '${pidFile}' '${PY}' "$@"\n`);chmodSync(wrapper,0o755);
  const {w}=await open({python:wrapper,deadlinesMs:{}});   // the production deadlines: the 200 ms step contract is the subject
  for(const op of ['open','scan','configure','start'] as const)expect((await w.request(op,{},0)).ok).toBe(true);
  const py=Number(readFileSync(pidFile,'utf8'));process.kill(py,'SIGSTOP');
  const t0=Date.now();
  await expect(w.request('step',{commands:cmd(1)},0)).rejects.toMatchObject({code:'WORKER_TIMEOUT',outcome:'unknown'});
  expect(Date.now()-t0).toBeGreaterThanOrEqual(190);
  expect(await gone(py)).toBe(true);   // the timeout itself killed the group, before close()
  await expect(w.request('step',{commands:cmd(1)},0)).rejects.toMatchObject({code:'WORKER_LOST',outcome:'not_sent'});
  await w.close();
  expect(readFileSync(log,'utf8').trim().split('\n').map(l=>(JSON.parse(l) as {op:string}).op)).toEqual(['open','scan','configure','start','step']);
 },20_000);
});

describe('arming and case order (KSW05)',()=>{
 it('a torque case without arming is not_run BENCH_NOT_ARMED and the worker gets no step',async()=>{
  const {w,kit}=await open();await startBenchSession(w);
  const ticks:BenchTickRecord[]=[],r=await runCase(holdCase(),ctx(w,kit,{arming:no,onTick:t=>ticks.push(t)}));
  expect(r.verdict).toEqual({status:'not_run',reason:'BENCH_NOT_ARMED',measurements:[]});
  expect(ticks).toEqual([]);expect(w.tick).toBe(0);
 },20_000);
 it('ttyArming: no TTY never asks; three wrong codes refuse; the right four digits arm',async()=>{
  const asked:string[]=[];
  const io=(answers:string[],isTTY=true)=>({isTTY,random:()=>0.5,question:async(q:string)=>{asked.push(q);return answers.shift()??'';}});
  expect(await ttyArming(io(['5000'],false)).arm('KCF02')).toBe(false);expect(asked).toEqual([]);
  expect(await ttyArming(io(['0000','50000','1234','5000'])).arm('KCF02')).toBe(false);expect(asked).toHaveLength(3);
  asked.length=0;
  expect(await ttyArming(io(['x',' 5000\n'])).arm('KCF02')).toBe(true);expect(asked).toHaveLength(2);expect(asked[0]).toContain('5000');expect(asked[0]).toContain('KCF02');
  expect(await ttyArming({...io(['0000']),random:()=>0}).arm('x')).toBe(true);
 });
 it('ttyArming without an injected random draws an unpredictable four-digit code',async()=>{
  const codes:string[]=[];
  for(let i=0;i<20;i++)await ttyArming({isTTY:true,question:async q=>{codes.push(/type (\S+) to arm/.exec(q)![1]!);return '';}}).arm('x');
  expect(codes.every(c=>/^\d{4}$/.test(c))).toBe(true);expect(new Set(codes).size).toBeGreaterThan(1);
 });
 it('unmet requires is not_run BENCH_ORDER_VIOLATION before arming is asked',async()=>{
  const {w,kit}=await open();await startBenchSession(w);const arming=counting(true);
  const r=await runCase(holdCase({requires:['KCF04']}),ctx(w,kit,{arming}));
  expect(r.verdict).toEqual({status:'not_run',reason:'BENCH_ORDER_VIOLATION',measurements:[]});expect(arming.calls).toBe(0);expect(w.tick).toBe(0);
 },20_000);
 it('a case that needs no torque cannot ask for it: failed BENCH_NOT_ARMED, nothing sent',async()=>{
  const {w,kit}=await open();await startBenchSession(w);
  const r=await runCase(holdCase({needsTorque:false}),ctx(w,kit));
  expect(r.verdict).toMatchObject({status:'failed',reason:'BENCH_NOT_ARMED'});expect(w.tick).toBe(0);
 },20_000);
 it('a tested case joins passed; arming is asked once per run until something disarms it',async()=>{
  const {w,kit}=await open();await startBenchSession(w);const arming=counting(true),c=ctx(w,kit,{arming});
  expect((await runCase(holdCase({id:'A'}),c)).verdict.status).toBe('tested');
  expect((await runCase(holdCase({id:'B',requires:['A']}),c)).verdict.status).toBe('tested');
  expect([...c.passed]).toEqual(['A','B']);expect(arming.calls).toBe(1);expect(c.disarmed).toBeFalsy();
 },20_000);
});

describe('ending a case',()=>{
 it('abort: quick stop, then enable false; failed OPERATOR_ABORT; the run is disarmed and the next case needs a new arming',async()=>{
  const {w,kit}=await open();await startBenchSession(w);
  const ac=new AbortController(),ticks:BenchTickRecord[]=[];
  const c=ctx(w,kit,{abort:ac.signal,onTick:t=>{ticks.push(t);if(ticks.length===20)ac.abort();}});
  const r=await runCase(holdCase({ticks:100,target:2}),c);
  expect(r.verdict).toEqual({status:'failed',reason:'OPERATOR_ABORT',measurements:[]});
  expect(ticks[19]!.feedback.map(f=>f.state)).toEqual(['enabled','enabled']);
  expect(ticks[20]!.driveCommands.every(x=>x.quickStop&&x.enable)).toBe(true);
  expect(ticks.at(-1)!.driveCommands.every(x=>x.quickStop&&!x.enable)).toBe(true);
  expect(noTorque(ticks.slice(20))).toBe(true);
  expect(ticks.at(-1)!.feedback.map(f=>f.state)).toEqual(['disabled','disabled']);
  expect(r.trace.ticks).toEqual(ticks);
  expect(c.disarmed).toBe(true);
  Object.assign(c,{arming:no,abort:new AbortController().signal});   // the same run context: the disarm itself must refuse
  const again=await runCase(holdCase({id:'next'}),c);
  expect(again.verdict.reason).toBe('BENCH_NOT_ARMED');expect(ticks).toHaveLength(r.trace.ticks.length);
 },20_000);
 it('an unexpected fault: quick stop, then enable false; the run is disarmed',async()=>{
  const {w,kit}=await open({sim:{events:[{atCycle:60,do:'inject_error',position:1,code:0x7500}]}});await startBenchSession(w);
  const arming=counting(true),c=ctx(w,kit,{arming});
  const r=await runCase(holdCase({ticks:100}),c),k=r.trace.ticks.findIndex(t=>t.feedback.some(f=>f.state==='fault'));
  expect(r.verdict).toMatchObject({status:'failed',reason:'UNEXPECTED_FAULT amr-1/wheel-left:EXTERNAL_TRIP'});
  expect(r.trace.ticks[k+1]!.driveCommands.every(x=>x.quickStop)).toBe(true);expect(noTorque(r.trace.ticks.slice(k+1))).toBe(true);
  expect(r.trace.ticks.at(-1)!.driveCommands.every(x=>!x.enable)).toBe(true);
  expect(c.disarmed).toBe(true);
  await runCase(holdCase({id:'next'}),c);expect(arming.calls).toBe(2);   // a new arming, never the old one
 },20_000);
 it.each(['commandsAt','onTick'])('a throw from %s ends the case CASE_SCRIPT_ERROR: quick stop, enable false, axes disabled, run disarmed',async where=>{
  const {w,kit}=await open();await startBenchSession(w);
  const base=holdCase({ticks:100,target:2}),ticks:BenchTickRecord[]=[];
  const c:BenchCase=where==='commandsAt'?{...base,script:(k,p)=>{const s=base.script(k,p);return {...s,commandsAt:(i,f)=>{if(i===20)throw new Error('index bug');return s.commandsAt(i,f);}};}}:base;
  const x=ctx(w,kit,{onTick:t=>{ticks.push(t);if(where==='onTick'&&ticks.length===20)throw new Error('ui bug');}});
  const r=await runCase(c,x);
  expect(r.verdict).toEqual({status:'failed',reason:'CASE_SCRIPT_ERROR',measurements:[]});expect(r.trace.meta).toMatchObject({error:expect.stringContaining('bug')});
  const stop=r.trace.ticks.slice(20);
  expect(stop[0]!.driveCommands.every(y=>y.quickStop)).toBe(true);expect(noTorque(stop)).toBe(true);
  expect(r.trace.ticks.at(-1)!.driveCommands.every(y=>!y.enable)).toBe(true);expect(r.trace.ticks.at(-1)!.feedback.map(f=>f.state)).toEqual(['disabled','disabled']);
  expect(x.disarmed).toBe(true);
 },20_000);
 it.each([['without seq',(c:ReturnType<typeof cmd>)=>c.map(({seq:_,...x})=>x)],['as null',()=>null],['as undefined',()=>undefined],['with an extra field',(c:ReturnType<typeof cmd>)=>c.map(x=>({...x,speed:1}))]])('a malformed command list from commandsAt (%s) is CASE_SCRIPT_ERROR: stop sequence, axes disabled, run disarmed',async(_,mangle)=>{
  const {w,kit}=await open();await startBenchSession(w);
  const base=holdCase({ticks:100,target:2});
  const c:BenchCase={...base,script:(k,p)=>{const s=base.script(k,p);return {...s,commandsAt:(i,f)=>(i===20?mangle(s.commandsAt(i,f) as ReturnType<typeof cmd>):s.commandsAt(i,f)) as never};}};
  const x=ctx(w,kit),r=await runCase(c,x);
  expect(r.verdict).toEqual({status:'failed',reason:'CASE_SCRIPT_ERROR',measurements:[]});expect(String(r.trace.meta?.error)).toMatch(/commandsAt\(20\)/);
  expect(r.trace.ticks[20]!.driveCommands.every(y=>y.quickStop)).toBe(true);expect(noTorque(r.trace.ticks.slice(20))).toBe(true);
  expect(r.trace.ticks.at(-1)!.driveCommands.every(y=>!y.enable)).toBe(true);expect(r.trace.ticks.at(-1)!.feedback.map(f=>f.state)).toEqual(['disabled','disabled']);
  expect(x.disarmed).toBe(true);
 },20_000);
 it('an onTick throw during the stop ticks of a passing case still fails it CASE_SCRIPT_ERROR and disarms',async()=>{
  const {w,kit}=await open();await startBenchSession(w);
  const x=ctx(w,kit,{onTick:t=>{if(t.driveCommands.every(y=>!y.enable))throw new Error('ui bug at stop');}}),r=await runCase(holdCase({ticks:20,target:2}),x);
  expect(r.verdict).toEqual({status:'failed',reason:'CASE_SCRIPT_ERROR',measurements:[]});expect(r.trace.meta).toMatchObject({error:'ui bug at stop'});
  expect(r.trace.ticks.at(-1)!.feedback.map(f=>f.state)).toEqual(['disabled','disabled']);expect(x.disarmed).toBe(true);expect(x.passed.has('T')).toBe(false);
 },20_000);
 it('a refused silence still ends with the wire stop (never step after a silence request), recorded, and disarms',async()=>{
  const {w,kit}=await open();await startBenchSession(w);
  const base=holdCase({ticks:30,target:2}),c:BenchCase={...base,script:(k,p)=>({...base.script(k,p),silence:{atTick:30,ms:0}})};   // ms 0: BENCH_LIMIT_EXCEEDED
  const x=ctx(w,kit),r=await runCase(c,x);
  expect(r.verdict).toEqual({status:'failed',reason:'BENCH_LIMIT_EXCEEDED',measurements:[]});expect(r.trace.ticks).toHaveLength(30);
  const stop=r.trace.stop as {controlwords:number[];velocityRadS:number[]};
  expect(stop.controlwords).toEqual([0,0]);expect(stop.velocityRadS.every(v=>Math.abs(v)<=POLICY.restSpeedRadS)).toBe(true);   // the held ramp, no coast
  expect(x.disarmed).toBe(true);
  await w.close();expect(JSON.parse(w.stderr.trim().split('\n').at(-1)!)).toEqual({event:'stopped',controlwords:[0,0]});
 },20_000);
 it('any other throw inside runCase (here the clock) still stops the live worker before it is rethrown',async()=>{
  const {w,kit}=await open();await startBenchSession(w);
  const clock=fakeClock(),sleep=clock.sleepUntilNs.bind(clock),ticks:BenchTickRecord[]=[];let n=0;
  clock.sleepUntilNs=async t=>{if(++n===21)throw new Error('clock bug');return sleep(t);};
  const x=ctx(w,kit,{clock,onTick:t=>ticks.push(t)});
  await expect(runCase(holdCase({ticks:100,target:2}),x)).rejects.toThrow('clock bug');
  expect(ticks).not.toHaveLength(20);expect(noTorque(ticks.slice(20))).toBe(true);
  expect(ticks.at(-1)!.driveCommands.every(y=>!y.enable)).toBe(true);expect(ticks.at(-1)!.feedback.map(f=>f.state)).toEqual(['disabled','disabled']);
  expect(x.disarmed).toBe(true);
 },20_000);
 it('the worker killed mid-case (KSW10): runCase rejects WORKER_LOST and sends nothing more',async()=>{
  const {w,kit}=await open();await startBenchSession(w);let sent=0;const lost:string[]=[];
  const spy:BenchWorker={request:(...a)=>{sent++;const p=w.request(...a);p.catch((e:{outcome:string})=>lost.push(e.outcome));return p;},close:()=>w.close(),get tick(){return w.tick;},get pid(){return w.pid;},get stderr(){return w.stderr;}};
  const c=ctx(spy,kit,{onTick:t=>{if(t.tick===5)process.kill(-w.pid!,'SIGKILL');}});
  await expect(runCase(holdCase({ticks:50}),c)).rejects.toMatchObject({code:'WORKER_LOST'});
  // 6 steps, the 7th lost on the wire (unknown, never resent), then the catch's best-effort stop sequence and wire stop, which the terminal client refuses without writing
  expect(sent).toBe(9);expect(lost).toEqual(['unknown','not_sent','not_sent']);expect(c.disarmed).toBe(true);
  await expect(runCase(holdCase(),c)).rejects.toMatchObject({code:'WORKER_LOST',outcome:'not_sent'});
 },20_000);
 it('stdin closed while the axes are enabled (KSW10): the worker stops and its last stderr line says controlwords 0',async()=>{
  const {w}=await open();await startBenchSession(w);
  let fb:{state:string}[]=[];
  for(let k=0;k<15;k++)fb=(await w.request('step',{commands:cmd(k+1,{target:2})},k)).result!.feedback as {state:string}[];
  expect(fb.map(f=>f.state)).toEqual(['enabled','enabled']);
  await w.close();
  expect(JSON.parse(w.stderr.trim().split('\n').at(-1)!)).toEqual({event:'stopped',controlwords:[0,0]});
 },20_000);
 it('a late tick: latenessNs is measured against the 20 ms grid, the case fails HOST_TICK_LATE and the stop sequence runs',async()=>{
  const {w,kit}=await open();await startBenchSession(w);
  const clock=fakeClock(),ticks:BenchTickRecord[]=[];
  const c=ctx(w,kit,{clock,onTick:t=>{ticks.push(t);if(ticks.length===5)clock.advance(30_000_000n);}});
  const r=await runCase(holdCase({ticks:20}),c);
  expect(ticks.slice(0,5).map(t=>t.latenessNs)).toEqual([0,0,0,0,0]);expect(ticks[5]!.latenessNs).toBe(10_000_000);
  expect(r.verdict).toEqual({status:'failed',reason:'HOST_TICK_LATE',measurements:[]});
  expect(noTorque(ticks.slice(6))).toBe(true);expect(ticks.at(-1)!.feedback.map(f=>f.state)).toEqual(['disabled','disabled']);
  expect(c.disarmed).toBe(true);
 },20_000);

 it.each(['refused','incomplete'])('a stop sequence that is %s falls back to the wire stop, awaited and recorded in trace.stop',async mode=>{
  const {w,kit}=await open();await startBenchSession(w);
  const ac=new AbortController();let stopping=false;
  // after the abort, every step is refused, or reports a power stage that never switches off (statusword bit 1 held)
  const spy:BenchWorker={request:async(op,payload,t)=>{
   if(op!=='step'||!stopping)return w.request(op,payload,t);
   if(mode==='refused')return {requestId:'x',ok:false,tick:w.tick,error:{code:'BENCH_TEST_REFUSED',detail:'test'}};
   const a=await w.request(op,payload,t),r=a.result as {vendor:{statusword:number}[]};r.vendor=r.vendor.map(v=>({...v,statusword:v.statusword|0x02}));return a;
  },close:()=>w.close(),get tick(){return w.tick;},get pid(){return w.pid;},get stderr(){return w.stderr;}};
  const x=ctx(spy,kit,{abort:ac.signal,onTick:t=>{if(t.tick===20){ac.abort();stopping=true;}}}),r=await runCase(holdCase({ticks:100,target:2}),x);
  expect(r.verdict).toEqual({status:'failed',reason:'OPERATOR_ABORT',measurements:[]});
  const stop=r.trace.stop as {controlwords:number[];velocityRadS:number[]};
  expect(stop.controlwords).toEqual([0,0]);expect(x.disarmed).toBe(true);
  await expect(w.request('describe',{},w.tick)).rejects.toMatchObject({code:'WORKER_LOST',outcome:'not_sent'});   // the wire stop ended the session
 },30_000);
 it('a clock that keeps throwing: the best-effort stop in the catch falls back to the wire stop, which needs no clock',async()=>{
  const {w,kit}=await open();await startBenchSession(w);
  const clock=fakeClock(),sleep=clock.sleepUntilNs.bind(clock);let n=0;
  clock.sleepUntilNs=async t=>{if(++n>=21)throw new Error('clock bug');return sleep(t);};
  const x=ctx(w,kit,{clock});
  await expect(runCase(holdCase({ticks:100,target:2}),x)).rejects.toThrow('clock bug');
  expect(x.disarmed).toBe(true);
  await expect(w.request('describe',{},w.tick)).rejects.toMatchObject({code:'WORKER_LOST',outcome:'not_sent'});   // closed by an accepted stop, not left to close()
  await w.close();expect(JSON.parse(w.stderr.trim().split('\n').at(-1)!)).toEqual({event:'stopped',controlwords:[0,0]});
 },20_000);
 it('evaluate that throws: failed CASE_EVALUATE_ERROR with the message in trace.meta.error, the run disarmed, axes already stopped',async()=>{
  const {w,kit}=await open();await startBenchSession(w);
  const x=ctx(w,kit),r=await runCase(holdCase({ticks:20,target:2,evaluate:()=>{throw new Error('evaluate bug');}}),x);
  expect(r.verdict).toEqual({status:'failed',reason:'CASE_EVALUATE_ERROR',measurements:[]});expect(r.trace.meta).toMatchObject({error:'evaluate bug'});
  expect(r.trace.ticks.at(-1)!.feedback.map(f=>f.state)).toEqual(['disabled','disabled']);expect(x.disarmed).toBe(true);expect(x.passed.size).toBe(0);
 },20_000);
});

describe('fix round 1',()=>{
 it('a BenchWorkerError from a live worker (request in flight) in the catch path still ends with the wire stop',async()=>{
  const {w,kit}=await open();await startBenchSession(w);let broken=false;
  const spy:BenchWorker={request:(op,payload,t)=>op==='step'&&broken?Promise.reject(new BenchWorkerError('BENCH_REQUEST_IN_FLIGHT','not_sent','test')):w.request(op,payload,t),
   close:()=>w.close(),get tick(){return w.tick;},get pid(){return w.pid;},get stderr(){return w.stderr;}};
  const x=ctx(spy,kit,{onTick:t=>{if(t.tick===20)broken=true;}});
  await expect(runCase(holdCase({ticks:100,target:2}),x)).rejects.toMatchObject({code:'BENCH_REQUEST_IN_FLIGHT'});
  expect(x.disarmed).toBe(true);
  await expect(w.request('describe',{},w.tick)).rejects.toMatchObject({code:'WORKER_LOST',outcome:'not_sent'});   // the worker took the stop and closed
 },20_000);
 it.each(['runner','error'])('a script whose meta carries the reserved key %s is not_run BENCH_SCRIPT_INVALID before any step',async key=>{
  const {w,kit}=await open();await startBenchSession(w);
  const base=holdCase(),c:BenchCase={...base,script:(k,p)=>({...base.script(k,p),meta:{[key]:{status:'tested',reason:null}}})};
  const r=await runCase(c,ctx(w,kit));
  expect(r.verdict).toEqual({status:'not_run',reason:'BENCH_SCRIPT_INVALID',measurements:[]});expect(w.tick).toBe(0);
 },20_000);
});

describe('a verdict is a pure function of the stored trace (verdictOf)',()=>{
 it('runCase returns verdictOf of its own trace; a runner decision is stored in trace.meta.runner',async()=>{
  const {w,kit}=await open();await startBenchSession(w);
  const x=ctx(w,kit,{arming:no}),r=await runCase(holdCase(),x);
  expect(r.trace.meta).toEqual({runner:{status:'not_run',reason:'BENCH_NOT_ARMED'}});
  const t=JSON.parse(JSON.stringify(r.trace));expect(verdictOf(holdCase(),t,kit,POLICY)).toEqual(r.verdict);
  const ok=await runCase(holdCase(),ctx(w,kit));expect(ok.trace.meta?.runner).toBeUndefined();expect(verdictOf(holdCase(),ok.trace,kit,POLICY)).toEqual(ok.verdict);
 },20_000);
 it('a trace that carries a runner decision never yields tested, whatever evaluate says or the decision claims',()=>{
  const c=holdCase(),t={ticks:[],cycles:[],prompts:[]};
  expect(verdictOf(c,{...t,meta:{runner:{status:'failed',reason:'HOST_TICK_LATE'}}},KIT,POLICY)).toEqual({status:'failed',reason:'HOST_TICK_LATE',measurements:[]});
  expect(verdictOf(c,{...t,meta:{runner:{status:'tested',reason:null}}},KIT,POLICY).status).toBe('failed');
  expect(verdictOf(c,{...t,meta:{runner:'x'}},KIT,POLICY).status).toBe('failed');
 });
});

describe('ACK deadlines (KSW01): injectable for tests only',()=>{
 it('the production contract is unchanged, and an override applies to that worker alone',async()=>{
  expect(BENCH_DEADLINES_MS).toEqual({describe:5000,open:10000,scan:30000,configure:30000,start:15000,step:200,silence:5000,imuConfigure:5000,stop:5000});
  const pidFile=join(dir,'python-400.pid'),wrapper=join(dir,'pid-python.sh');
  writeFileSync(wrapper,`#!/bin/sh\necho $$ > '${pidFile}'\nexec '${PY}' "$@"\n`);chmodSync(wrapper,0o755);
  const {w}=await open({python:wrapper,deadlinesMs:{step:400}});
  for(const op of ['open','scan','configure','start'] as const)expect((await w.request(op,{},0)).ok).toBe(true);
  process.kill(Number(readFileSync(pidFile,'utf8')),'SIGSTOP');
  const t0=Date.now();
  await expect(w.request('step',{commands:cmd(1)},0)).rejects.toMatchObject({code:'WORKER_TIMEOUT',outcome:'unknown'});
  expect(Date.now()-t0).toBeGreaterThanOrEqual(390);
  expect(BENCH_DEADLINES_MS.step).toBe(200);   // the override did not leak into the contract
 },20_000);
 it('an override that is not a positive number of ms is refused before the worker starts',async()=>{
  const kitPath=join(dir,`kit-${++files}.json`);writeFileSync(kitPath,JSON.stringify(KIT));
  for(const bad of [{step:0},{step:-1},{step:Number.NaN},{bogus:5}] as Partial<Record<BenchOp,number>>[])
   await expect(spawnBenchWorker({role:'bus',python:PY,kitPath,bus:'sim',readOnly:false,sessionId:'t',deadlinesMs:bad})).rejects.toMatchObject({code:'WORKER_REQUEST_INVALID',outcome:'not_sent'});
 });
});

/** A prompter whose answer the test gives later (resolve/reject), counting the questions. */
const later=()=>{
 const p={asked:[] as {id:string;text:string}[],answer:(_:string)=>{},fail:(_:Error)=>{},ask:(q:{id:string;text:string})=>{p.asked.push(q);return new Promise<string>((ok,no)=>{p.answer=ok;p.fail=no;});}};
 return p;
};
/** A torque case with one prompt at `atTick`; evaluate is tested only when the stored answer is '12.5'. */
type P={id:string;atTick:number;text:string;motion?:'running'};
/** A prompt before the last tick is a mid-motion question (motion: 'running'); one at atTick = ticks is post-motion (the default). */
const promptCase=(o:{atTick?:number;ticks?:number;prompts?:P[];silence?:boolean}={}):BenchCase=>holdCase({ticks:o.ticks??20,
 script:()=>({ticks:o.ticks??20,prompts:o.prompts??[{id:'mark',atTick:o.atTick??10,text:'Mark offset (deg)?',...(o.atTick??10)<(o.ticks??20)?{motion:'running' as const}:{}}],
  ...o.silence?{silence:{atTick:o.ticks??20,ms:100}}:{},commandsAt:k=>cmd(k+1,{target:1})}),
 evaluate:t=>t.prompts[0]?.answer==='12.5'?{status:'tested',reason:null,measurements:[]}:{status:'failed',reason:'ANSWER',measurements:[]}});

describe('operator prompts (P1)',()=>{
 it('without a prompter a case with prompts is not_run BENCH_PROMPT_UNAVAILABLE, nothing sent',async()=>{
  const {w,kit}=await open();await startBenchSession(w);
  expect((await runCase(promptCase(),ctx(w,kit))).verdict).toEqual({status:'not_run',reason:'BENCH_PROMPT_UNAVAILABLE',measurements:[]});expect(w.tick).toBe(0);
 },20_000);
 it('at atTick the runner holds the last commands on fresh seqs until the answer, stores it, then continues; evaluate and readback see the answer',async()=>{
  const {w,kit}=await open();await startBenchSession(w);
  const p=later();let held=0;
  const x=ctx(w,kit,{prompter:p,onTick:()=>{if(p.asked.length&&++held===12)p.answer('12.5');}}),r=await runCase(promptCase(),x);
  expect(p.asked).toEqual([{id:'mark',text:'Mark offset (deg)?'}]);
  expect(r.verdict).toEqual({status:'tested',reason:null,measurements:[]});expect(r.trace.prompts).toEqual([{id:'mark',answer:'12.5'}]);
  const t=r.trace.ticks,hold=t.slice(10,22);
  expect(hold.every(y=>y.driveCommands.every(c=>c.target===1&&c.enable&&!c.quickStop))).toBe(true);
  // every held tick is a new seq (no stale command, so the channel watchdog never trips), and the script's seqs go on above them
  const seqs=t.slice(0,23).map(y=>y.driveCommands[0]!.seq);
  expect(seqs.every((s,i)=>i===0||s===seqs[i-1]!+1)).toBe(true);
  expect(t.slice(5,30).every(y=>y.feedback.every(f=>f.state==='enabled'&&f.fault===null))).toBe(true);
  expect(t.filter(y=>y.driveCommands.every(c=>c.enable&&!c.quickStop))).toHaveLength(20+12);
  expect(verdictOf(promptCase(),JSON.parse(JSON.stringify(r.trace)),kit,POLICY)).toEqual(r.verdict);
  expect(x.disarmed).toBeFalsy();
 },20_000);
 it('a post-motion prompt (atTick = ticks) is asked only after the stop sequence: every power stage off, and every held tick asks for nothing',async()=>{
  const {w,kit}=await open();await startBenchSession(w);
  const ticks:BenchTickRecord[]=[];let at=-1,held=0;
  const mk=later(),x=ctx(w,kit,{prompter:{ask:q=>{at=ticks.length;return mk.ask(q);}},onTick:t=>{ticks.push(t);if(at>=0&&++held===8)mk.answer('12.5');}});
  const r=await runCase(promptCase({atTick:20}),x);
  expect(r.verdict.status).toBe('tested');expect(r.trace.prompts).toEqual([{id:'mark',answer:'12.5'}]);
  expect(at).toBeGreaterThan(20);   // the scripted ticks, then the stop sequence, then the question
  expect(ticks[at-1]!.vendor.every(v=>(v.statusword&0x02)===0)).toBe(true);expect(ticks[at-1]!.driveCommands.every(c=>!c.enable)).toBe(true);
  const hold=ticks.slice(at,at+8);
  expect(hold).toHaveLength(8);
  expect(hold.every(t=>t.driveCommands.every(c=>!c.enable&&!c.quickStop&&c.target===0)&&t.vendor.every(v=>(v.statusword&0x02)===0)&&t.feedback.every(f=>f.state==='disabled'))).toBe(true);
  const seqs=ticks.slice(at-1,at+8).map(t=>t.driveCommands[0]!.seq);expect(seqs.every((q,i)=>i===0||q>seqs[i-1]!)).toBe(true);   // fresh seqs: the channel watchdog never trips
  expect(x.disarmed).toBeFalsy();
 },20_000);
 it('a post-motion prompt whose stop sequence does not finish is never asked: the case ends BENCH_STOP_INCOMPLETE on the wire stop',async()=>{
  const {w,kit}=await open();await startBenchSession(w);
  let n=0;   // after the 20 scripted ticks every step reports a power stage that never switches off
  const spy:BenchWorker={request:async(op,payload,t)=>{
   const a=await w.request(op,payload,t);if(op!=='step'||++n<=20)return a;
   const r=a.result as {vendor:{statusword:number}[]};r.vendor=r.vendor.map(v=>({...v,statusword:v.statusword|0x02}));return a;
  },close:()=>w.close(),get tick(){return w.tick;},get pid(){return w.pid;},get stderr(){return w.stderr;}};
  const p=later(),x=ctx(spy,kit,{prompter:p}),r=await runCase(promptCase({atTick:20}),x);
  expect(p.asked).toEqual([]);expect(r.verdict).toEqual({status:'failed',reason:'BENCH_STOP_INCOMPLETE',measurements:[]});
  expect((r.trace.stop as {controlwords:number[]}).controlwords).toEqual([0,0]);expect(x.disarmed).toBe(true);
 },30_000);
 it('a mid-motion prompt at 0 is asked before anything is sent',async()=>{
  const {w,kit}=await open();await startBenchSession(w);
  const t0=w.tick,ticks:BenchTickRecord[]=[];let first=-1;
  const start=await runCase(promptCase({atTick:0}),ctx(w,kit,{prompter:{ask:async()=>{first=ticks.length;return '12.5';}},onTick:t=>ticks.push(t)}));
  expect(start.verdict.status).toBe('tested');expect(first).toBe(0);expect(ticks[0]!.tick).toBe(t0);
 },20_000);
 it.each([['atTick above ticks',[{id:'a',atTick:21,text:'?'}]],['a negative atTick',[{id:'a',atTick:-1,text:'?'}]],['two prompts with one id',[{id:'a',atTick:1,text:'?',motion:'running'},{id:'a',atTick:2,text:'?',motion:'running'}]],
  ['a mid-motion prompt without motion running',[{id:'a',atTick:5,text:'?'}]],['a post-motion prompt marked running',[{id:'a',atTick:20,text:'?',motion:'running'}]]] as [string,P[]][])(
  'a script with %s is not_run BENCH_SCRIPT_INVALID before any step',async(_,prompts)=>{
  const {w,kit}=await open();await startBenchSession(w);
  expect((await runCase(promptCase({prompts}),ctx(w,kit,{prompter:{ask:async()=>'12.5'}}))).verdict).toEqual({status:'not_run',reason:'BENCH_SCRIPT_INVALID',measurements:[]});expect(w.tick).toBe(0);
 },20_000);
 it('a post-motion prompt in a script that ends with a silence is not_run BENCH_SCRIPT_INVALID (after a silence only the wire stop follows)',async()=>{
  const {w,kit}=await open();await startBenchSession(w);
  expect((await runCase(promptCase({atTick:20,silence:true}),ctx(w,kit,{prompter:{ask:async()=>'12.5'}}))).verdict).toEqual({status:'not_run',reason:'BENCH_SCRIPT_INVALID',measurements:[]});expect(w.tick).toBe(0);
 },20_000);
 it('an abort while the question is open ends the case OPERATOR_ABORT: quick stop, enable false, disarmed',async()=>{
  const {w,kit}=await open();await startBenchSession(w);
  const p=later(),ac=new AbortController();let held=0;
  const x=ctx(w,kit,{prompter:p,abort:ac.signal,onTick:()=>{if(p.asked.length&&++held===5)ac.abort();}}),r=await runCase(promptCase(),x);
  expect(r.verdict).toEqual({status:'failed',reason:'OPERATOR_ABORT',measurements:[]});expect(r.trace.meta?.runner).toEqual({status:'failed',reason:'OPERATOR_ABORT'});
  expect(r.trace.prompts).toEqual([]);expect(r.trace.ticks[15]!.driveCommands.every(c=>c.quickStop)).toBe(true);
  expect(noTorque(r.trace.ticks.slice(15))).toBe(true);expect(r.trace.ticks.at(-1)!.feedback.map(f=>f.state)).toEqual(['disabled','disabled']);expect(x.disarmed).toBe(true);
 },20_000);
 it.each([['throws',()=>{throw new Error('tty gone');}],['rejects',async()=>{throw new Error('tty gone');}],['answers a non-string',async()=>12.5 as unknown as string]])(
  'a prompter that %s is CASE_SCRIPT_ERROR: the stop sequence runs, the run is disarmed',async(_,ask)=>{
  const {w,kit}=await open();await startBenchSession(w);
  const x=ctx(w,kit,{prompter:{ask}}),r=await runCase(promptCase(),x);
  expect(r.verdict).toEqual({status:'failed',reason:'CASE_SCRIPT_ERROR',measurements:[]});expect(String(r.trace.meta?.error)).toMatch(/tty gone|not a string/);
  expect(r.trace.ticks[10]!.driveCommands.every(c=>c.quickStop)).toBe(true);expect(r.trace.ticks.at(-1)!.feedback.map(f=>f.state)).toEqual(['disabled','disabled']);
  expect(x.disarmed).toBe(true);
 },20_000);
 it('no answer within PROMPT_HOLD_MAX_TICKS held ticks (60 s) ends the case PROMPT_TIMEOUT with the stop sequence, recorded for readback',async()=>{
  const {w,kit}=await open();await startBenchSession(w);
  expect(PROMPT_HOLD_MAX_TICKS).toBe(3000);
  const x=ctx(w,kit,{prompter:later()}),r=await runCase(promptCase(),x);
  expect(r.verdict).toEqual({status:'failed',reason:'PROMPT_TIMEOUT',measurements:[]});expect(r.trace.meta?.runner).toEqual({status:'failed',reason:'PROMPT_TIMEOUT'});
  expect(r.trace.ticks[10+PROMPT_HOLD_MAX_TICKS]!.driveCommands.every(c=>c.quickStop)).toBe(true);
  expect(r.trace.ticks.slice(10,10+PROMPT_HOLD_MAX_TICKS).every(y=>y.driveCommands.every(c=>c.enable&&!c.quickStop))).toBe(true);
  expect(r.trace.ticks.at(-1)!.feedback.map(f=>f.state)).toEqual(['disabled','disabled']);expect(x.disarmed).toBe(true);
  expect(verdictOf(promptCase(),JSON.parse(JSON.stringify(r.trace)),kit,POLICY)).toEqual(r.verdict);
 },60_000);
});

/** A sensors worker that answers every step at once with `frames`, recording whether it was asked before the bus ACK of the same tick had arrived. */
const fakeSensors=(bus:{acked:number},frames:(n:number)=>unknown[]=()=>[]):BenchWorker&{overlap:boolean[]}=>{
 let tick=0;const overlap:boolean[]=[];
 return {overlap,get tick(){return tick;},pid:undefined,stderr:'',close:async()=>{},
  request:async op=>{if(op==='step')overlap.push(bus.acked===tick);const n=tick++;return {requestId:'s',ok:true,tick,result:{lidar:{frames:frames(n),droppedBytes:0},imu:{samples:[],droppedBytes:0}}};}};
};
describe('bus and sensors stepped together (P2)',()=>{
 it('both requests of a tick are sent before either is awaited',async()=>{
  const {w,kit}=await open();await startBenchSession(w);
  const bus={acked:0},spy:BenchWorker={request:(op,payload,t)=>op==='step'?w.request(op,payload,t).then(a=>{bus.acked++;return a;}):w.request(op,payload,t),
   close:()=>w.close(),get tick(){return w.tick;},get pid(){return w.pid;},get stderr(){return w.stderr;}};
  // awaiting the bus step before sending the sensors step would make every overlap false
  const sensors=fakeSensors(bus),r=await runCase(holdCase({ticks:20}),ctx(spy,kit,{sensors}));
  expect(r.verdict.status).toBe('tested');expect(sensors.overlap.length).toBe(r.trace.ticks.length);expect(sensors.overlap.every(Boolean)).toBe(true);
 },20_000);
 it('a throw while turning frames into scans (after the stop) is CASE_SCRIPT_ERROR, the run disarmed, the axes already disabled',async()=>{
  const {w,kit}=await open();await startBenchSession(w);
  // two frames whose first angle goes down end a turn; points:null makes the scan conversion throw
  const sensors=fakeSensors({acked:-1},n=>n<2?[{speedDegS:3600,startDeg:n?0:90,endDeg:99,sensorMs:0,points:null}]:[]);
  const x=ctx(w,kit,{sensors}),r=await runCase(holdCase({ticks:20,target:2,needsSensors:true}),x);
  expect(r.verdict).toEqual({status:'failed',reason:'CASE_SCRIPT_ERROR',measurements:[]});expect(r.trace.meta?.error).toBeTruthy();
  expect(r.trace.ticks.at(-1)!.feedback.map(f=>f.state)).toEqual(['disabled','disabled']);expect(x.disarmed).toBe(true);
 },20_000);
});
