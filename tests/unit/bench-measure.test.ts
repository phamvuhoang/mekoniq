// K07a: the measurement cases KMS01, KMS02, KMS04, KMS05 (contracts §6.2, spec B1 §7.4) on the real bench worker's simulated slave (protocol_double), and KMS01's
// definition on a trace whose delay is known exactly. Every verdict is re-evaluated from its stored (serialised) trace.
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll,afterEach,describe,expect,it} from 'vitest';
import {sealBench,type BenchKitV1,type BenchPolicy,type BenchTickRecord} from '../../packages/bench/src/contracts';
import {fakeClock} from '../../packages/bench/src/clock';
import {spawnBenchWorker,type BenchWorker} from '../../packages/bench/src/worker';
import {runCase,startBenchSession,type Prompter,type RunContext} from '../../packages/bench/src/session';
import {BENCH_CASES,benchCase,verdictOf,type CaseTrace} from '../../packages/bench/src/cases/index';
import {MEASURE_CASES,lagTrialsOf} from '../../packages/bench/src/cases/measure';

const PY=process.env.BENCH_PYTHON??'python3';
const dir=mkdtempSync(join(tmpdir(),'bench-measure-'));
const fixture=<T>(f:string)=>JSON.parse(readFileSync(new URL(`../../robotics/bench/fixtures/${f}`,import.meta.url),'utf8')) as T;
const KIT=fixture<BenchKitV1>('kit-sim-v1.json'),BASE=fixture<BenchPolicy>('policy-v1.json');
const POLICY={...BASE,lagTrials:4,revolutionCheck:{revolutions:1,toleranceDeg:5}};   // short runs; the cases take every length from the policy
let n=0;
const workers:BenchWorker[]=[];
afterEach(async()=>{await Promise.all(workers.splice(0).map(w=>w.close()));});
afterAll(()=>rmSync(dir,{recursive:true,force:true}));
async function ctxOf(sim:Record<string,unknown>={},extra:Partial<RunContext>={},edit:(k:Omit<BenchKitV1,'digest'>)=>void=()=>{}):Promise<RunContext>{
 const {digest:_,...k}=structuredClone(KIT);void _;Object.assign(k.simSlave!,sim);edit(k);
 const kit=sealBench<BenchKitV1>(k),kitPath=join(dir,`kit-${++n}.json`);writeFileSync(kitPath,JSON.stringify(kit));
 const w=await spawnBenchWorker({role:'bus',python:PY,kitPath,bus:'sim',readOnly:false,sessionId:'m',deadlinesMs:{step:5000}});workers.push(w);
 await startBenchSession(w);
 return {worker:w,kit,policy:POLICY,clock:fakeClock(),arming:{arm:async()=>true},passed:new Set(['KCF02','KCF04','KCF01']),abort:new AbortController().signal,...extra};
}
const byId=(id:string)=>MEASURE_CASES.find(c=>c.id===id)!;
async function run(id:string,sim:Record<string,unknown>={},extra:Partial<RunContext>={}){
 const ctx=await ctxOf(sim,extra),r=await runCase(byId(id),ctx);
 expect(verdictOf(byId(id),JSON.parse(JSON.stringify(r.trace)) as CaseTrace,ctx.kit,POLICY)).toEqual(r.verdict);
 return {...r,ctx};
}
const m=(r:{verdict:{measurements:{id:string;value:number;uncertaintyAbs:number;n:number;unit:string}[]}},id:string)=>r.verdict.measurements.find(x=>x.id===id)!;
const AXES=KIT.axes.map(a=>a.axisId);

describe('the measurement cases',()=>{
 it('are registered torque cases after KCF02, KCF04 and KCF01; without them they do not run',async()=>{
  expect(MEASURE_CASES.map(c=>c.id)).toEqual(['KMS01','KMS02','KMS04','KMS05']);
  for(const c of MEASURE_CASES){expect(benchCase(c.id)).toBe(c);expect(c.needsTorque).toBe(true);expect(c.requires).toEqual(['KCF02','KCF04','KCF01']);}
  expect(BENCH_CASES.filter(c=>c.id.startsWith('KMS'))).toHaveLength(4);
  const ctx=await ctxOf({},{passed:new Set(['KCF02','KCF04'])});
  expect((await runCase(byId('KMS01'),ctx)).verdict).toEqual({status:'not_run',reason:'BENCH_ORDER_VIOLATION',measurements:[]});
 },30_000);
});

describe('KMS01 tracking lag (an upper bound, unloaded rotor)',()=>{
 it('on the simulated slave: one median per axis over lagTrials step trials of the registered sizes, uncertainty at least one bus cycle',async()=>{
  const r=await run('KMS01');
  expect(r.verdict.status).toBe('tested');
  const trials=lagTrialsOf(r.trace,r.ctx.kit,POLICY)!;
  expect(trials.map(t=>[t.condition,t.split])).toEqual([['step-2','tune'],['step-2','validation'],['step-5','tune'],['step-5','validation']]);
  expect(trials.every(t=>t.signal.kind==='step'&&t.ticks<=500)).toBe(true);
  for(const a of AXES){
   const x=m(r,`trackingLagUpperBoundUnloadedMs:${a}`);
   expect(x).toMatchObject({unit:'ms',caseId:'KMS01',n:4});
   expect(x.value).toBeGreaterThan(4);expect(x.value).toBeLessThan(60);expect(x.uncertaintyAbs).toBeGreaterThanOrEqual(KIT.bus.cycleMs);
  }
  // a property of this kit on an unloaded rotor, never "the latency of the drive" or of the robot
  expect(r.verdict.measurements.every(x=>!/latency/i.test(x.id)&&/UpperBound/.test(x.id)&&/Unloaded/.test(x.id))).toBe(true);
 },60_000);
 it('the definition: a velocity that is the bus-written target three cycles later gives exactly three cycles at every level, in every trial',async()=>{
  const r=await run('KMS01'),t=structuredClone(r.trace),cpt=20/KIT.bus.cycleMs;
  for(let j=t.cycles.length-1;j>=0;j--)for(const [i,ax] of t.cycles[j]!.axes.entries())ax.velocityRaw=j>=3?t.cycles[j-3]!.axes[i]!.targetRaw:0;
  const v=byId('KMS01').evaluate(t,r.ctx.kit,POLICY);
  expect(v.status).toBe('tested');expect(t.cycles.length).toBe(t.ticks.length*cpt);
  for(const a of AXES){const x=v.measurements.find(y=>y.id===`trackingLagUpperBoundUnloadedMs:${a}`)!;expect(x.value).toBeCloseTo(3*KIT.bus.cycleMs,9);expect(x.uncertaintyAbs).toBe(KIT.bus.cycleMs);}
  // a velocity that never reaches a level fails the case; a slave without 606Ch mapped cannot measure it
  const stuck=structuredClone(r.trace);for(const c of stuck.cycles)c.axes[1]!.velocityRaw=Math.round(c.axes[1]!.targetRaw*0.6);
  expect(byId('KMS01').evaluate(stuck,r.ctx.kit,POLICY)).toMatchObject({status:'failed',reason:expect.stringMatching(/^LAG_LEVEL_NOT_REACHED amr-1\/wheel-right trial 0 level 0.75/)});
  const none=structuredClone(r.trace);for(const c of none.cycles)c.axes[0]!.velocityRaw=null;
  expect(byId('KMS01').evaluate(none,r.ctx.kit,POLICY)).toMatchObject({status:'failed',reason:'VELOCITY_NOT_MAPPED amr-1/wheel-left'});
 },60_000);
});

/** The kit on a real bus (re-sealed: soem, no simSlave): KMS01 must then time the cycle rows by their own tMonoNs. */
const soem=()=>{const {digest:_,simSlave:__,...k}=structuredClone(KIT);void _;void __;return sealBench<BenchKitV1>({...k,bus:{...k.bus,backend:'soem',interface:'enp3s0'}} as Omit<BenchKitV1,'digest'>);};
describe('KMS01 time base on a real bus (fails closed)',()=>{
 it('cycle rows whose tMonoNs spacing is not cycleMs (a step-mode burst) are CYCLE_CLOCK_MISMATCH; rows one cycle apart give the cycle-counter result',async()=>{
  const r=await run('KMS01'),real=soem();
  expect(byId('KMS01').evaluate(r.trace,real,POLICY)).toMatchObject({status:'failed',reason:expect.stringMatching(/^CYCLE_CLOCK_MISMATCH/)});
  const clocked=structuredClone(r.trace);for(const c of clocked.cycles)c.tMonoNs=1e12+c.cycle*KIT.bus.cycleMs*1e6+(c.cycle%3)*200_000;   // 0.2 ms jitter, inside 20 %
  const v=byId('KMS01').evaluate(clocked,real,POLICY),sim=r.verdict.measurements;
  expect(v.status).toBe('tested');
  for(const a of AXES){const x=v.measurements.find(y=>y.id===`trackingLagUpperBoundUnloadedMs:${a}`)!,y=sim.find(z=>z.id===x.id)!;expect(Math.abs(x.value-y.value)).toBeLessThan(1);}
  const slow=structuredClone(r.trace);for(const c of slow.cycles)c.tMonoNs=1e12+c.cycle*KIT.bus.cycleMs*1.3e6;   // 30 % slow: the bus does not run at cycleMs
  expect(byId('KMS01').evaluate(slow,real,POLICY)).toMatchObject({status:'failed',reason:expect.stringMatching(/^CYCLE_CLOCK_MISMATCH/)});
 },60_000);
});

describe('KMS02 enable delay',()=>{
 it('from the first cycle of the tick that asks for enable to the first Operation enabled statusword, per axis, over repeated enables',async()=>{
  const fast=await run('KMS02'),slow=await run('KMS02',{enableDelayCycles:10});
  expect(fast.verdict.status).toBe('tested');expect(slow.verdict.status).toBe('tested');
  for(const a of AXES){
   const f=m(fast,`enableDelayMs:${a}`),s=m(slow,`enableDelayMs:${a}`);
   expect(f.unit).toBe('ms');expect(f.n).toBeGreaterThanOrEqual(5);expect(f.uncertaintyAbs).toBe(KIT.bus.cycleMs);
   expect(s.value-f.value).toBe(5*KIT.bus.cycleMs);   // five more cycles of 'enable operation' in Switched on
  }
  // every enable in the trace was a rising edge from disabled
  const edges=fast.trace.ticks.filter((t,k)=>t.driveCommands.every(c=>c.enable)&&!(k>0&&fast.trace.ticks[k-1]!.driveCommands[0]!.enable));
  expect(edges.length).toBe(m(fast,`enableDelayMs:${AXES[0]}`).n);
 },60_000);
});

describe('KMS04 counts per revolution',()=>{
 /** The operator: reads the travel off the trace (as a person reads the mark) and answers the offset past the start mark, plus `error` degrees. */
 const operator=(ticks:BenchTickRecord[],error=0):Prompter=>({ask:async q=>{
  const i=AXES.indexOf(q.id.split(':')[1]!),e=ticks.findIndex(t=>t.feedback.every(f=>f.state==='enabled')),p0=ticks[e]!.feedback[i]!.positionRad!,p1=ticks.at(-1)!.feedback[i]!.positionRad!;
  return String((p1-p0)*180/Math.PI-360*POLICY.revolutionCheck.revolutions+error);
 }});
 it('turns revolutionCheck.revolutions at creep speed, stops, asks the mark offset of each axis; within toleranceDeg the counts per revolution are confirmed',async()=>{
  const ticks:BenchTickRecord[]=[],r=await run('KMS04',{},{onTick:t=>ticks.push(t),prompter:operator(ticks)});
  expect(r.verdict.status).toBe('tested');expect(r.trace.prompts.map(p=>p.id)).toEqual(AXES.map(a=>`markOffsetDeg:${a}`));
  for(const a of AXES)expect(m(r,`countsPerRevConfirmed:${a}`)).toMatchObject({value:131072,unit:'count/rev',n:1,uncertaintyAbs:131072*5/360});
  expect(Math.max(...r.trace.ticks.flatMap(t=>t.feedback.map(f=>Math.abs(f.velocityRadS??0))))).toBeLessThan(POLICY.creepSpeedRadS*1.2);   // creep speed only
  expect(r.trace.ticks.at(-1)!.driveCommands.every(c=>!c.enable)).toBe(true);   // the question is asked with the axes disabled
  const off=structuredClone(r.trace);off.prompts[1]!.answer=String(Number(off.prompts[1]!.answer)+6);
  expect(byId('KMS04').evaluate(off,r.ctx.kit,POLICY)).toMatchObject({status:'failed',reason:expect.stringMatching(/^MARK_OFFSET amr-1\/wheel-right/)});
  const bad=structuredClone(r.trace);bad.prompts[0]!.answer='about ten';
  expect(byId('KMS04').evaluate(bad,r.ctx.kit,POLICY)).toMatchObject({status:'failed',reason:'PROMPT_ANSWER_INVALID amr-1/wheel-left'});
 },60_000);
 it('an operator mark off by more than toleranceDeg fails; without a prompter the case does not run',async()=>{
  const ticks:BenchTickRecord[]=[],r=await run('KMS04',{},{onTick:t=>ticks.push(t),prompter:operator(ticks,-7)});
  expect(r.verdict).toMatchObject({status:'failed',reason:expect.stringMatching(/^MARK_OFFSET amr-1\/wheel-left/)});
  expect((await run('KMS04')).verdict).toEqual({status:'not_run',reason:'BENCH_PROMPT_UNAVAILABLE',measurements:[]});
 },60_000);
});

describe('KMS04 with a drive that enables late or never (fix round 1, F1)',()=>{
 /** Answers `answer(q)` only after `after` ticks with the question open, recording the index of the first tick sent while it was open. */
 const slowOperator=(ticks:BenchTickRecord[],answer:(q:{id:string})=>string,after=6)=>{
  const o={at:-1,ask:(q:{id:string;text:string})=>{const at=ticks.length;if(o.at<0)o.at=at;return new Promise<string>(ok=>{const t=setInterval(()=>{if(ticks.length>=at+after){clearInterval(t);ok(answer(q));}},1);});}};
  return o;
 };
 const heldOff=(ticks:BenchTickRecord[],at:number)=>{
  expect(at).toBeGreaterThan(0);
  expect(ticks[at-1]!.vendor.every(v=>(v.statusword&0x02)===0)).toBe(true);   // the power stages were off before the question
  const held=ticks.slice(at);expect(held.length).toBeGreaterThanOrEqual(6);
  expect(held.every(t=>t.driveCommands.every(c=>!c.enable&&c.target===0)&&t.vendor.every(v=>(v.statusword&0x02)===0))).toBe(true);
 };
 it('a drive that enables late: the creep starts only once enabled, and every tick sent while the question is open asks for nothing, power stages off',async()=>{
  const ticks:BenchTickRecord[]=[];let first=-1;
  const op=slowOperator(ticks,q=>{const i=AXES.indexOf(q.id.split(':')[1]!),e=ticks.findIndex(t=>t.feedback.every(f=>f.state==='enabled'));first=e;
   return String((ticks[op.at-1]!.feedback[i]!.positionRad!-ticks[e]!.feedback[i]!.positionRad!)*180/Math.PI-360);});
  const r=await run('KMS04',{enableDelayCycles:200},{onTick:t=>ticks.push(t),prompter:op});
  expect(r.verdict.status).toBe('tested');expect(first).toBeGreaterThan(30);
  expect(ticks.slice(0,first+1).every(t=>t.driveCommands.every(c=>c.target===0))).toBe(true);   // no creep before every axis reported enabled
  heldOff(ticks,op.at);
 },60_000);
 it('a drive slower than policy.enableTimeoutTicks (the worker\'s own enable timeout set longer): no creep, no enable asked after the timeout, nothing held while the question is open',async()=>{
  const ticks:BenchTickRecord[]=[],op=slowOperator(ticks,()=>'0');
  const ctx=await ctxOf({enableDelayCycles:800},{onTick:t=>ticks.push(t),prompter:op},k=>{k.channel.enableTimeoutTicks=300;});   // enabled near tick 160 if still asked
  const r=await runCase(byId('KMS04'),ctx);
  expect(r.verdict).toEqual({status:'failed',reason:'ENABLE_TIMEOUT',measurements:[]});
  expect(ticks.slice(POLICY.enableTimeoutTicks).every(t=>t.driveCommands.every(c=>!c.enable))).toBe(true);expect(ticks.every(t=>t.driveCommands.every(c=>c.target===0))).toBe(true);
  heldOff(ticks,op.at);
 },60_000);
 it('a drive that never enables: KMS04 stops asking for enable after policy.enableTimeoutTicks, never creeps, fails ENABLE_TIMEOUT, and holds nothing while it asks',async()=>{
  const ticks:BenchTickRecord[]=[],policy={...POLICY,enableTimeoutTicks:50},op=slowOperator(ticks,()=>'0');
  const ctx=await ctxOf({enableDelayCycles:1_000_000},{onTick:t=>ticks.push(t),prompter:op,policy});
  const r=await runCase(byId('KMS04'),ctx);
  expect(r.verdict).toEqual({status:'failed',reason:'ENABLE_TIMEOUT',measurements:[]});
  expect(ticks.slice(50).every(t=>t.driveCommands.every(c=>!c.enable))).toBe(true);expect(ticks.every(t=>t.driveCommands.every(c=>c.target===0))).toBe(true);
  heldOff(ticks,op.at);
 },60_000);
});

describe('KMS05 velocity-estimate noise',()=>{
 it('the standard deviation of the drive-reported velocity and of the differenced position at a constant registered speed, per axis',async()=>{
  const r=await run('KMS05');
  expect(r.verdict.status).toBe('tested');
  for(const a of AXES)for(const id of [`velocityNoiseDriveRadS:${a}`,`velocityNoiseDiffRadS:${a}`]){
   const x=m(r,id);expect(x.unit).toBe('rad/s');expect(x.value).toBeGreaterThanOrEqual(0);expect(x.n).toBeGreaterThan(100);expect(x.uncertaintyAbs).toBeGreaterThan(0);
  }
  // the simulated slave rounds its position to counts: the differenced estimate is noisier than its own velocity report
  expect(m(r,`velocityNoiseDiffRadS:${AXES[0]}`).value).toBeGreaterThan(m(r,`velocityNoiseDriveRadS:${AXES[0]}`).value);
 },60_000);
});
