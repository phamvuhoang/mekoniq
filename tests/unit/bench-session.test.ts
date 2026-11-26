// K04: the TS session layer against the real bench worker on its simulated slave (protocol_double). Wire discipline (KSW01), refusals (KSW05), worker and TS loss (KSW10).
import {chmodSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll,afterEach,describe,expect,it} from 'vitest';
import {sealBench,type BenchKitV1,type BenchPolicy,type BenchTickRecord} from '../../packages/bench/src/contracts';
import {fakeClock} from '../../packages/bench/src/clock';
import {ttyArming,type Arming} from '../../packages/bench/src/arming';
import {spawnBenchWorker,type BenchWorker} from '../../packages/bench/src/worker';
import {runCase,startBenchSession,type RunContext} from '../../packages/bench/src/session';
import type {BenchCase} from '../../packages/bench/src/cases/types';

const PY=process.env.BENCH_PYTHON??'python3';
const dir=mkdtempSync(join(tmpdir(),'bench-session-'));
const fixture=<T>(f:string)=>JSON.parse(readFileSync(new URL(`../../robotics/bench/fixtures/${f}`,import.meta.url),'utf8')) as T;
const KIT=fixture<BenchKitV1>('kit-sim-v1.json'),POLICY=fixture<BenchPolicy>('policy-v1.json');
let files=0;
const workers:BenchWorker[]=[];
/** A re-sealed copy of the DC kit with simSlave knobs, written where the worker can read it. */
async function open(o:{sim?:Record<string,unknown>;python?:string}={}){
 const {digest:_,...k}=structuredClone(KIT);void _;Object.assign(k.simSlave!,o.sim);
 const kit=sealBench<BenchKitV1>(k),kitPath=join(dir,`kit-${++files}.json`);writeFileSync(kitPath,JSON.stringify(kit));
 const w=await spawnBenchWorker({role:'bus',python:o.python??PY,kitPath,bus:'sim',readOnly:false,sessionId:'t'});workers.push(w);
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
  const {w}=await open({python:wrapper});
  for(const op of ['open','scan','configure','start'] as const)expect((await w.request(op,{},0)).ok).toBe(true);
  const py=Number(readFileSync(pidFile,'utf8'));process.kill(py,'SIGSTOP');
  const t0=Date.now();
  await expect(w.request('step',{commands:cmd(1)},0)).rejects.toMatchObject({code:'WORKER_TIMEOUT',outcome:'unknown'});
  expect(Date.now()-t0).toBeGreaterThanOrEqual(190);
  await expect(w.request('step',{commands:cmd(1)},0)).rejects.toMatchObject({code:'WORKER_LOST',outcome:'not_sent'});
  await w.close();
  expect(await gone(py)).toBe(true);
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
  const again=await runCase(holdCase({id:'next'}),{...c,arming:no,abort:new AbortController().signal,onTick:t=>ticks.push(t)});
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
 it('the worker killed mid-case (KSW10): runCase rejects WORKER_LOST and sends nothing more',async()=>{
  const {w,kit}=await open();await startBenchSession(w);let sent=0;
  const spy:BenchWorker={request:(...a)=>{sent++;return w.request(...a);},close:()=>w.close(),get tick(){return w.tick;},get pid(){return w.pid;},get stderr(){return w.stderr;}};
  const c=ctx(spy,kit,{onTick:t=>{if(t.tick===5)process.kill(-w.pid!,'SIGKILL');}});
  await expect(runCase(holdCase({ticks:50}),c)).rejects.toMatchObject({code:'WORKER_LOST'});
  expect(sent).toBe(7);expect(c.disarmed).toBe(true);
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
});
