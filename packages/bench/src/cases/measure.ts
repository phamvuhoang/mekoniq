// Measurement cases (KMS, contracts §6.2; spec B1 §7.4), first part (K07a): KMS01, KMS02, KMS04, KMS05. KMS03 (the drive's own watchdog) and KMS06 (unloaded coast) come later.
// Torque cases after KCF02, KCF04 and KCF01; trials are registered bench signals (bench-signals.ts: steps of 2 and 5 rad/s, at most BENCH_MAX_TICKS ticks). Every number the
// policy holds comes from it. evaluate() is a pure function of (trace, kit, policy): readback re-runs it on the stored trace.
// Bus time is the cycle counter x cycleMs, not the cycle rows' tMonoNs: in step mode a tick's exchanges run back to back, so their host times are one burst.
// ponytail: cycle-counter time assumes one exchange every cycleMs; true for the bus clock on hardware (K08's cyclic thread with DC); compare it with tMonoNs there.
import {BENCH_AMPLITUDES,benchTarget,type BenchSignal} from '../../../lab-runtime/src/v2/control/bench-signals';
import type {BenchCycleRow,BenchKitV1,BenchPolicy,Measurement} from '../contracts';
import {afterEnable,allEnabled,settleTicks} from './conformance';
import {mean,median,std} from './sensors';
import type {BenchCase,CaseTrace,CaseVerdict} from './types';

const TICK_MS=20,REQUIRES=['KCF02','KCF04','KCF01'];
const tested=(ms:Measurement[]):CaseVerdict=>({status:'tested',reason:null,measurements:ms});
const failed=(reason:string):CaseVerdict=>({status:'failed',reason,measurements:[]});
const m=(caseId:string,id:string,value:number,unit:string,uncertaintyAbs:number,n:number):Measurement=>({id,value,unit,uncertaintyAbs,caseId,n});
const spread=(x:number[])=>x.length>1?std(x):0;
const measureCase=(id:string,o:Pick<BenchCase,'script'|'evaluate'>):BenchCase=>({id,needsTorque:true,requires:REQUIRES,...o});
const cpt=(kit:BenchKitV1)=>TICK_MS/kit.bus.cycleMs;
/** Every step returns 20 / cycleMs rows, so tick k owns cycles [k cpt, (k + 1) cpt): anything else and no row can be put on its tick. */
const aligned=(t:CaseTrace,kit:BenchKitV1)=>t.cycles.length===t.ticks.length*cpt(kit);
/** afterEnable's j = 0: the tick after the first one whose feedback shows every axis enabled; -1 if none did. */
const enabledAt=(t:CaseTrace)=>{const e=t.ticks.findIndex(x=>allEnabled(x.feedback));return e<0?-1:e+1;};
const timeMs=(r:BenchCycleRow,kit:BenchKitV1)=>r.cycle*kit.bus.cycleMs;

// ---- KMS01: tracking lag --------------------------------------------------------------------------------------------------------------------------------------------
const LAG_PRE=5;   // rest ticks of a trial before its step, so the dataset (calibration export) starts at rest
/** Trial n: a gap of settleMs at 0 (back to rest), then the step signal of LAG_PRE + settleMs ticks; the first half of the trials at the smaller registered size, the rest at the larger. */
const lagLayout=(p:BenchPolicy)=>{
 const gap=settleTicks(p),len=LAG_PRE+settleTicks(p),[small,large]=BENCH_AMPLITUDES.wheelRadS;
 return {gap,len,block:gap+len,signal:(n:number)=>({kind:'step',amplitude:n<p.lagTrials/2?small:large,atTick:LAG_PRE}) as const};
};
export interface LagTrial{n:number;trialId:string;condition:string;split:'tune'|'validation';signal:Extract<BenchSignal,{kind:'step'}>;from:number;ticks:number}
/** The trials of a KMS01 trace in policy order: the tick index of each trial's signal tick 0 and its length (split alternates tune, validation). Null when the axes never enabled. */
export function lagTrialsOf(t:CaseTrace,_kit:BenchKitV1,p:BenchPolicy):LagTrial[]|null{
 const on=enabledAt(t),L=lagLayout(p);
 return on<0?null:Array.from({length:p.lagTrials},(_,n)=>{const signal=L.signal(n);
  return {n,trialId:`KMS01-${String(n).padStart(2,'0')}`,condition:`step-${signal.amplitude}`,split:n%2?'validation' as const:'tune' as const,signal,from:on+n*L.block+L.gap,ticks:L.len};});
}
/** The cycle rows of a trial, with the row just before its first tick. */
export const trialRows=(t:CaseTrace,kit:BenchKitV1,x:LagTrial)=>t.cycles.slice(x.from*cpt(kit)-1,(x.from+x.ticks)*cpt(kit));
/** When a series first crosses `level` x `amp` (a fraction of amp, so the sign does not matter), linearly between the two rows around it; null if it never does. */
function cross(rows:BenchCycleRow[],kit:BenchKitV1,v:(r:BenchCycleRow)=>number,amp:number,level:number):number|null{
 for(let j=1;j<rows.length;j++){
  const a=v(rows[j-1]!)/amp,b=v(rows[j]!)/amp;
  if(a<level&&b>=level){const t0=timeMs(rows[j-1]!,kit);return t0+(level-a)/(b-a)*(timeMs(rows[j]!,kit)-t0);}
 }
 return null;
}
/** Per axis: for each trial, the mean over policy.lagLevels of (velocityRaw crosses the level) - (the bus-written targetRaw crosses it); the median over the trials, uncertainty
 * max(one bus cycle, standard deviation). An upper bound of the command plus feedback delay that includes the velocity loop of an unloaded rotor (spec B1 §7.4), never the
 * drive's latency alone: the id says so. */
const KMS01=measureCase('KMS01',{
 script(kit,p){
  const L=lagLayout(p),trials=p.lagTrials*L.block,total=trials+settleTicks(p);
  return afterEnable(kit,p,total,j=>j>=total?{enable:false}:j>=trials||j%L.block<L.gap?{}:{target:benchTarget(L.signal(Math.floor(j/L.block)),0,j%L.block-L.gap,'csv')});
 },
 evaluate(t,kit,p){
  const trials=lagTrialsOf(t,kit,p),ms:Measurement[]=[];
  if(!trials)return failed('ENABLE_TIMEOUT');
  if(!aligned(t,kit))return failed('CYCLES_MISALIGNED');
  for(const [i,a] of kit.axes.entries()){
   const lags:number[]=[];
   for(const x of trials){
    if(x.from+x.ticks>t.ticks.length)return failed(`TRIAL_SHORT ${x.trialId}`);
    const rows=trialRows(t,kit,x),ax=(r:BenchCycleRow)=>r.axes[i]!,amp=ax(rows.at(-1)!).targetRaw;
    if(rows.some(r=>ax(r).velocityRaw===null))return failed(`VELOCITY_NOT_MAPPED ${a.axisId}`);
    if(!amp)return failed(`STEP_NOT_WRITTEN ${a.axisId} trial ${x.n}`);
    const d=p.lagLevels.map(l=>{const tt=cross(rows,kit,r=>ax(r).targetRaw,amp,l),tv=cross(rows,kit,r=>ax(r).velocityRaw!,amp,l);return tt===null||tv===null?null:tv-tt;});
    const miss=d.indexOf(null);
    if(miss>=0)return failed(`LAG_LEVEL_NOT_REACHED ${a.axisId} trial ${x.n} level ${p.lagLevels[miss]}`);
    lags.push(mean(d as number[]));
   }
   ms.push(m('KMS01',`trackingLagUpperBoundMs:${a.axisId}`,median(lags),'ms',Math.max(kit.bus.cycleMs,spread(lags)),lags.length));
  }
  return tested(ms);
 },
});

// ---- KMS02: enable delay --------------------------------------------------------------------------------------------------------------------------------------------
const ENABLE_TRIALS=10,REST_TICKS=5;   // ponytail: a count of repetitions, not a threshold, so not a policy key; raise it if the spread matters
/** Enable at rest until every axis reports enabled, hold REST_TICKS, disable until every axis reports disabled, rest REST_TICKS; ENABLE_TRIALS times. */
const KMS02=measureCase('KMS02',{
 script(kit,p){
  let phase=0,left=0,started=1;   // 0 enabling, 1 holding, 2 disabling, 3 resting
  return {ticks:ENABLE_TRIALS*(p.enableTimeoutTicks+3*REST_TICKS+10),commandsAt(k,fb){
   if(phase===0&&allEnabled(fb)){phase=1;left=REST_TICKS;}
   else if(phase===1&&--left===0)phase=2;
   else if(phase===2&&fb.length&&fb.every(f=>f.state==='disabled')){phase=3;left=REST_TICKS;}
   else if(phase===3&&--left===0&&started<ENABLE_TRIALS){phase=0;started++;}
   return kit.axes.map(a=>({axisId:a.axisId,seq:k+1,mode:'csv' as const,target:0,enable:phase<2,quickStop:false,faultReset:false}));
  }};
 },
 /** Per axis: from the first cycle of each tick that newly asks for enable to the first cycle whose statusword reads Operation enabled, cycles counted inclusive. */
 evaluate(t,kit,p){
  if(!aligned(t,kit))return failed('CYCLES_MISALIGNED');
  const on=(k:number)=>t.ticks[k]!.driveCommands.every(c=>c.enable&&!c.quickStop),edges=t.ticks.flatMap((_,k)=>on(k)&&!(k>0&&on(k-1))?[k]:[]),ms:Measurement[]=[];
  if(edges.length<ENABLE_TRIALS)return failed(`ENABLE_TRIALS_SHORT ${edges.length} of ${ENABLE_TRIALS}`);
  for(const [i,a] of kit.axes.entries()){
   const d:number[]=[];
   for(const k of edges){
    const j=t.cycles.slice(k*cpt(kit),(k+p.enableTimeoutTicks)*cpt(kit)).findIndex(r=>(r.axes[i]!.statusword&0x6f)===0x27);
    if(j<0)return failed(`ENABLE_TIMEOUT ${a.axisId} at tick ${k}`);
    d.push((j+1)*kit.bus.cycleMs);
   }
   ms.push(m('KMS02',`enableDelayMs:${a.axisId}`,median(d),'ms',Math.max(kit.bus.cycleMs,spread(d)),d.length));
  }
  return tested(ms);
 },
});

// ---- KMS04: counts per revolution -----------------------------------------------------------------------------------------------------------------------------------
/** At creepSpeedRadS each axis turns until its positionRad has advanced revolutionCheck.revolutions x 2 pi, stops at 0, is disabled, and the operator then reads its mark. */
const KMS04=measureCase('KMS04',{
 script(kit,p){
  const goal=p.revolutionCheck.revolutions*2*Math.PI,S=settleTicks(p),move=Math.ceil(goal/p.creepSpeedRadS/(TICK_MS/1000))+S,ticks=p.enableTimeoutTicks+move+2*S;
  let on=-1,p0:number[]=[];const reached=kit.axes.map(()=>false);
  return {ticks,prompts:kit.axes.map(a=>({id:`markOffsetDeg:${a.axisId}`,atTick:ticks,
   text:`${a.axisId} turned ${p.revolutionCheck.revolutions} revolution(s) by its encoder and is disabled. How many degrees is its mark past the start position, in the direction it turned (negative if short)?`})),
   commandsAt(k,fb){
    if(on<0&&allEnabled(fb)){on=k;p0=fb.map(f=>f.positionRad??NaN);}
    if(on>=0)fb.forEach((f,i)=>{reached[i]||=!((f.positionRad??NaN)-p0[i]!<goal);});   // an unknown position stops the axis
    const j=on<0?-1:k-on;
    return kit.axes.map((a,i)=>({axisId:a.axisId,seq:k+1,mode:'csv' as const,target:j>=0&&j<move&&!reached[i]?p.creepSpeedRadS:0,enable:j<move+S,quickStop:false,faultReset:false}));
   }};
 },
 /** The mark offset the encoder predicts is (travel - revolutions x 360) degrees; the operator's reading agrees within toleranceDeg, or the counts per revolution are wrong. */
 evaluate(t,kit,p){
  const e=t.ticks.findIndex(x=>allEnabled(x.feedback)),last=t.ticks.at(-1),N=p.revolutionCheck.revolutions,tol=p.revolutionCheck.toleranceDeg,ms:Measurement[]=[];
  if(e<0||!last)return failed('ENABLE_TIMEOUT');
  for(const [i,a] of kit.axes.entries()){
   const p0=t.ticks[e]!.feedback[i]!.positionRad,p1=last.feedback[i]!.positionRad;
   if(p0===null||p1===null)return failed(`POSITION_UNKNOWN ${a.axisId}`);
   const travelDeg=(p1-p0)*180/Math.PI,ans=t.prompts.find(q=>q.id===`markOffsetDeg:${a.axisId}`)?.answer??'';
   if(travelDeg<N*360)return failed(`REVOLUTIONS_NOT_REACHED ${a.axisId} ${travelDeg.toFixed(1)} deg`);
   const x=/^\s*[+-]?(\d+\.?\d*|\.\d+)\s*$/.test(ans)?Number(ans):NaN;
   if(!Number.isFinite(x))return failed(`PROMPT_ANSWER_INVALID ${a.axisId}`);
   const expected=travelDeg-N*360,diff=((x-expected)%360+540)%360-180;
   if(Math.abs(diff)>tol)return failed(`MARK_OFFSET ${a.axisId} ${x} deg, the encoder says ${expected.toFixed(2)} deg`);
   const cpr=a.units.positionCountsPerRev.value;
   ms.push(m('KMS04',`countsPerRevConfirmed:${a.axisId}`,cpr,'count/rev',cpr*tol/(N*360),1));
  }
  return tested(ms);
 },
});

// ---- KMS05: velocity-estimate noise ---------------------------------------------------------------------------------------------------------------------------------
const NOISE_TICKS=250;   // ponytail: a 5 s window, not a threshold; with settleMs it stays inside BENCH_MAX_TICKS
const NOISE_SIGNAL:BenchSignal={kind:'step',amplitude:BENCH_AMPLITUDES.wheelRadS[0],atTick:0};
const wrap32=(d:number)=>((d%2**32)+2**32+2**31)%2**32-2**31;
/** After settleMs at the smaller registered speed, NOISE_TICKS of cycles: the standard deviation of the drive's 606Ch and of the differenced 6064h, per axis. */
const KMS05=measureCase('KMS05',{
 script:(kit,p)=>{const S=settleTicks(p);return afterEnable(kit,p,2*S+NOISE_TICKS,j=>j<S+NOISE_TICKS?{target:benchTarget(NOISE_SIGNAL,0,j,'csv')}:j<2*S+NOISE_TICKS?{}:{enable:false});},
 evaluate(t,kit,p){
  const on=enabledAt(t),from=on+settleTicks(p),ms:Measurement[]=[];
  if(on<0)return failed('ENABLE_TIMEOUT');
  if(!aligned(t,kit))return failed('CYCLES_MISALIGNED');
  if(from+NOISE_TICKS>t.ticks.length)return failed('WINDOW_SHORT');
  const rows=t.cycles.slice(from*cpt(kit),(from+NOISE_TICKS)*cpt(kit)),n=rows.length;
  for(const [i,a] of kit.axes.entries()){
   const u=a.units,raw=rows.map(r=>r.axes[i]!.velocityRaw);
   if(raw.includes(null))return failed(`VELOCITY_NOT_MAPPED ${a.axisId}`);
   const v=raw.map(x=>x!/u.velocityRawPerRadS.value*u.polarity),posStep=2*Math.PI/u.positionCountsPerRev.value*u.polarity;
   const diff=rows.slice(1).map((r,j)=>wrap32(r.axes[i]!.positionRaw-rows[j]!.axes[i]!.positionRaw)*posStep/((r.cycle-rows[j]!.cycle)*kit.bus.cycleMs/1000));
   const sv=std(v),sd=std(diff);
   ms.push(m('KMS05',`velocityNoiseDriveRadS:${a.axisId}`,sv,'rad/s',Math.max(sv/Math.sqrt(2*(n-1)),1/u.velocityRawPerRadS.value),n),
    m('KMS05',`velocityNoiseDiffRadS:${a.axisId}`,sd,'rad/s',Math.max(sd/Math.sqrt(2*(n-2)),Math.abs(posStep)/(kit.bus.cycleMs/1000)),n-1));
  }
  return tested(ms);
 },
});

export const MEASURE_CASES:BenchCase[]=[KMS01,KMS02,KMS04,KMS05];
