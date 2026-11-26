// K04: the conformance cases (contracts §6.2) on the real bench worker's simulated slave (protocol_double). Every verdict is re-evaluated from its stored trace.
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll,afterEach,describe,expect,it} from 'vitest';
import {sealBench,validateBenchTick,type BenchKitV1,type BenchPolicy} from '../../packages/bench/src/contracts';
import {fakeClock} from '../../packages/bench/src/clock';
import {spawnBenchWorker,type BenchWorker} from '../../packages/bench/src/worker';
import {runCase,startBenchSession,type RunContext} from '../../packages/bench/src/session';
import {CONFORMANCE_CASES,trackingCase} from '../../packages/bench/src/cases/conformance';
import type {BenchCase,CaseTrace} from '../../packages/bench/src/cases/types';

const PY=process.env.BENCH_PYTHON??'python3';
const dir=mkdtempSync(join(tmpdir(),'bench-cases-'));
const fixture=<T>(f:string)=>JSON.parse(readFileSync(new URL(`../../robotics/bench/fixtures/${f}`,import.meta.url),'utf8')) as T;
const KIT=fixture<BenchKitV1>('kit-sim-v1.json'),POLICY=fixture<BenchPolicy>('policy-v1.json');
const SOAK={...POLICY,soakMinutes:0.05};   // 150 ticks; the case derives its length from the policy
let files=0;
const workers:BenchWorker[]=[];
async function open(sim:Record<string,unknown>={}){
 const {digest:_,...k}=structuredClone(KIT);void _;Object.assign(k.simSlave!,sim);
 const kit=sealBench<BenchKitV1>(k),kitPath=join(dir,`kit-${++files}.json`);writeFileSync(kitPath,JSON.stringify(kit));
 const w=await spawnBenchWorker({role:'bus',python:PY,kitPath,bus:'sim',readOnly:false,sessionId:'c',deadlinesMs:{step:5000}});workers.push(w);
 return {w,kit};
}
afterEach(async()=>{await Promise.all(workers.splice(0).map(w=>w.close()));});
afterAll(()=>rmSync(dir,{recursive:true,force:true}));
const ctxOf=async(cases:BenchCase[],sim:Record<string,unknown>={},policy=POLICY):Promise<RunContext>=>{
 const {w,kit}=await open(sim),{objects}=await startBenchSession(w,[...new Set(cases.flatMap(c=>c.reads??[]))]);
 return {worker:w,kit,policy,clock:fakeClock(),arming:{arm:async()=>true},passed:new Set(['KCF02']),abort:new AbortController().signal,objects};
};
/** Runs one case on a fresh worker and checks that evaluate is pure: the stored (serialised) trace gives the same verdict. */
async function run(c:BenchCase,sim:Record<string,unknown>={},policy=POLICY){
 const ctx=await ctxOf([c],sim,policy),r=await runCase(c,ctx);
 expect(JSON.stringify(c.evaluate(JSON.parse(JSON.stringify(r.trace)) as CaseTrace,ctx.kit,policy))).toBe(JSON.stringify(r.verdict));
 return {...r,ctx};
}
const byId=(id:string)=>CONFORMANCE_CASES.find(c=>c.id===id)!;
const measured=(r:{verdict:{measurements:{id:string;value:number}[]}},id:string)=>r.verdict.measurements.find(m=>m.id===id)?.value;
const states=(t:CaseTrace,axis=0)=>t.ticks.map(x=>x.feedback[axis]!.state);

describe('conformance cases on the simulated slave',()=>{
 it('the suite of this package, in order, KCF07b last; every case but KCF02 requires KCF02',()=>{
  expect(CONFORMANCE_CASES.map(c=>c.id)).toEqual(['KCF02','KCF03','KCF05','KCF06','KCF07a','KCF08','KCF10','KCF07b']);
  expect(CONFORMANCE_CASES.map(c=>c.requires)).toEqual([[],...Array(7).fill(['KCF02'])]);
  expect(CONFORMANCE_CASES.every(c=>c.needsTorque)).toBe(true);
 });
 it('KCF02: enabled in time, at rest; enableDelayMs measured',async()=>{
  const r=await run(byId('KCF02'));
  expect(r.verdict).toMatchObject({status:'tested',reason:null});expect(measured(r,'enableDelayMs')).toBeGreaterThan(0);
  expect(r.ctx.passed.has('KCF02')).toBe(true);
 },30_000);
 it('KCF03 step 2 rad/s tracks; 20 % low tracking fails on trackingToleranceRadS',async()=>{
  const step2=trackingCase([{kind:'step',amplitude:2,atTick:0}]);
  const good=await run(step2);
  expect(good.verdict).toMatchObject({status:'tested',reason:null});expect(measured(good,'trackingErrorMaxRadS')).toBeLessThan(0.05);
  const bad=await run(step2,{velocityScale:0.8});
  expect(bad.verdict.status).toBe('failed');expect(bad.verdict.reason).toContain('trackingToleranceRadS');
 },30_000);
 it('KCF03 as registered: step, trapezoid and hold at 2 and 5 rad/s, both directions',async()=>{
  const r=await run(byId('KCF03'));
  expect(r.verdict).toMatchObject({status:'tested',reason:null});
  const targets=r.trace.ticks.map(t=>t.driveCommands[0]!.target);
  expect(Math.max(...targets)).toBeCloseTo(5,9);expect(Math.min(...targets)).toBeCloseTo(-5,9);
 },60_000);
 it.each([[2,'disabled'],[6,'quick_stop']])('KCF05 with 605Ah=%i: quick_stop, then %s; never enabled while quickStop is 1',async(option,after)=>{
  const r=await run(byId('KCF05'),{quickStopOption:option});
  expect(r.verdict).toMatchObject({status:'tested',reason:null});expect(r.trace.objects!['amr-1/wheel-left']).toEqual({'605A:00':option});
  const q=r.trace.ticks.filter(t=>t.driveCommands.every(c=>c.quickStop)).map(t=>t.feedback.map(f=>f.state));
  expect(q[0]).toEqual(['quick_stop','quick_stop']);expect(q.at(-1)).toEqual([after,after]);expect(q.flat()).not.toContain('enabled');
 },30_000);
 it('KCF05: a slave that stays enabled during quick stop fails ENABLED_DURING_QUICK_STOP',async()=>{
  expect((await run(byId('KCF05'),{ignoreQuickStop:true})).verdict).toMatchObject({status:'failed',reason:'ENABLED_DURING_QUICK_STOP'});
 },30_000);
 it('KCF06: the fault latches, a held faultReset does not clear it, a rising edge does',async()=>{
  const r=await run(byId('KCF06'));
  expect(r.verdict).toMatchObject({status:'tested',reason:null});
  expect(states(r.trace)).toContain('fault');expect(r.trace.ticks.at(-1)!.feedback.map(f=>f.fault)).toEqual([null,null]);
 },30_000);
 it('KCF07a: the worker trips on the 5th tick after the last fresh seq',async()=>{
  const r=await run(byId('KCF07a'));
  expect(r.verdict).toMatchObject({status:'tested',reason:null});expect(measured(r,'watchdogTrippedAtTick')).toBe(5);
 },30_000);
 it.each([[100,'tested',null],[null,'failed','DRIVE_KEPT_RUNNING_WITHOUT_MASTER']])('KCF07b with slave watchdog %s: %s %s; runCase then sends stop itself, the axes end at rest, the run is disarmed',async(watchdogMs,status,reason)=>{
  const r=await run(byId('KCF07b'),{watchdogMs}),s=r.trace.silence as {alState:string;slaves:{errorCode:number}[];axes:{velocityRadS:number}[]};
  expect(r.verdict).toMatchObject({status,reason});
  if(watchdogMs){
   expect(s.alState).not.toBe('OP');expect(s.slaves.every(x=>x.errorCode!==0)).toBe(true);expect(s.axes.map(a=>Math.abs(a.velocityRadS))).toEqual([0,0]);
   expect(measured(r,'travelDuringSilenceRad')).toBeGreaterThan(0);
  }else expect(s.axes.every(a=>a.velocityRadS>0.4)).toBe(true);
  const stop=r.trace.stop as {controlwords:number[];velocityRadS:(number|null)[]};
  // the last word is 0x0000 on every axis; where the bus still reads (no slave watchdog: still in OP), it went out at rest, so the ramp was held, not cut into a coast
  expect(stop.controlwords).toEqual([0,0]);
  if(!watchdogMs)expect(stop.velocityRadS.every(v=>v!==null&&Math.abs(v)<=POLICY.restSpeedRadS)).toBe(true);
  expect(r.ctx.disarmed).toBe(true);
  await expect(r.ctx.worker.request('describe',{},r.ctx.worker.tick)).rejects.toMatchObject({code:'WORKER_LOST',outcome:'not_sent'});   // the session is over: nothing is written after stop
  await r.ctx.worker.close();   // waits for the exit the stop already caused
  expect(JSON.parse(r.ctx.worker.stderr.trim().split('\n').at(-1)!)).toEqual({event:'stopped',controlwords:[0,0]});
 },30_000);
 it('after silence the worker takes only stop (and describe)',async()=>{
  const {worker:w}=await ctxOf([]);
  for(let k=0;k<5;k++)await w.request('step',{commands:KIT.axes.map(a=>({axisId:a.axisId,seq:k+1,mode:'csv',target:0.5,enable:true,quickStop:false,faultReset:false}))},k);
  expect((await w.request('silence',{ms:200},w.tick)).ok).toBe(true);
  for(const op of ['open','scan','configure','start','silence'] as const)expect((await w.request(op,{ms:100},w.tick)).error?.code).toBe('BENCH_ORDER_VIOLATION');
  expect((await w.request('step',{commands:[]},w.tick)).error?.code).toBe('BENCH_ORDER_VIOLATION');
  expect((await w.request('describe',{},w.tick)).ok).toBe(true);
  expect((await w.request('stop',{},w.tick)).result).toMatchObject({controlwords:[0,0]});
 },30_000);
 it('KCF08 (KSW08): diffDriveBaseV1 drives both axes through straight, arc, spin, normal and protective stop',async()=>{
  const r=await run(byId('KCF08'));
  expect(r.verdict).toMatchObject({status:'tested',reason:null});
  expect(r.trace.meta).toMatchObject({controller:{id:'diff-drive-base-v1',config:{wheelRadiusM:0.09,wheelSeparationM:0.36}}});
  expect(r.trace.ticks.flatMap(t=>validateBenchTick(t))).toEqual([]);
  const v=r.trace.ticks.map(t=>t.feedback.map(f=>f.velocityRadS!));
  expect(v.some(([l,rr])=>l!>1&&rr!>1)).toBe(true);expect(v.some(([l,rr])=>l!<-0.5&&rr!>0.5)).toBe(true);   // straight and spin
  expect(r.trace.ticks.some(t=>t.driveCommands.every(c=>c.quickStop))).toBe(true);                           // the protective stop
 },30_000);
 it('KCF10: a soak with the length the policy gives',async()=>{
  const r=await run(byId('KCF10'),{},SOAK);
  expect(r.verdict).toMatchObject({status:'tested',reason:null});
  expect(r.trace.ticks.filter(t=>t.driveCommands[0]!.target===2)).toHaveLength(SOAK.soakMinutes*60*50);
 },30_000);
 it('the whole package suite runs in order on one worker and every case is tested',async()=>{
  const ctx=await ctxOf(CONFORMANCE_CASES,{},SOAK);ctx.passed.clear();
  const out:[string,string,string|null][]=[];
  for(const c of CONFORMANCE_CASES){const r=await runCase(c,ctx);out.push([c.id,r.verdict.status,r.verdict.reason]);}
  expect(out).toEqual(CONFORMANCE_CASES.map(c=>[c.id,'tested',null]));expect(ctx.disarmed).toBe(true);   // only by the silence of KCF07b, the last case
 },120_000);
});
