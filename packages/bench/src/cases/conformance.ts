// Conformance cases (KCF, contracts §6.2), first part (K04): KCF02, KCF03, KCF05, KCF06, KCF07a, KCF08, KCF10, KCF07b. KCF04, KCF01 and KCF09 come in K09.
// Every threshold is the policy's (BK-D19). evaluate() is a pure function of (trace, kit, policy): the evidence reader re-runs it on stored traces.
import serveScene from '../../../../robotics/simulation-mujoco/fixtures/serve-payload-v1/navigation-scene.json';
import {benchMotionEndTick,benchTarget,type BenchSignal} from '../../../lab-runtime/src/v2/control/bench-signals';
import {diffDriveBaseV1,type DiffDriveBaseConfig} from '../../../lab-runtime/src/v2/control/diff-drive-base';
import {BASE_CONTROLLER_DEFAULTS} from '../../../lab-runtime/src/v2/control/drive-run';
import type {DriveFeedbackV1} from '../../../lab-runtime/src/v2/control/drive-io';
import {validateBenchTick,type BenchKitV1,type BenchPolicy,type BenchTickRecord,type Measurement} from '../contracts';
import {freezeCases,type BenchCase,type CaseScript,type CaseTrace,type CaseVerdict} from './types';

const TICK_MS=20;
export type Part={target?:number|number[];enable?:boolean;quickStop?:boolean;faultReset?:boolean;/** repeat the last seq: a stale command */stale?:boolean};
const tested=(measurements:Measurement[]=[]):CaseVerdict=>({status:'tested',reason:null,measurements});
const failed=(reason:string):CaseVerdict=>({status:'failed',reason,measurements:[]});
const m=(caseId:string,id:string,value:number,unit:string,uncertaintyAbs:number,n=1):Measurement=>({id,value,unit,uncertaintyAbs,caseId,n});
export const allEnabled=(fb:readonly DriveFeedbackV1[])=>fb.length>0&&fb.every(f=>f.state==='enabled');
export const settleTicks=(p:BenchPolicy)=>Math.ceil(p.settleMs/TICK_MS);
const torque=(x:BenchTickRecord)=>x.driveCommands.every(c=>c.enable&&!c.quickStop);
const resolution=(kit:BenchKitV1)=>({velocity:1/Math.min(...kit.axes.map(a=>a.units.velocityRawPerRadS.value)),position:2*Math.PI/Math.min(...kit.axes.map(a=>a.units.positionCountsPerRev.value))});

/** Asks for enable at rest until every axis reports enabled (at most policy.enableTimeoutTicks), then plays `motion(j)` from j = 0. Each tick gets a new seq
 * unless the part says `stale`. */
export function afterEnable(kit:BenchKitV1,p:BenchPolicy,motionTicks:number,motion:(j:number)=>Part,extra:Partial<CaseScript>={}):CaseScript{
 let on=-1,seq=0;
 return {ticks:p.enableTimeoutTicks+motionTicks,...extra,commandsAt(k,fb){
  if(on<0&&allEnabled(fb))on=k;
  const part=on<0?{}:motion(k-on);
  if(!part.stale)seq=k+1;
  return kit.axes.map((a,i)=>({axisId:a.axisId,seq,mode:'csv' as const,target:(Array.isArray(part.target)?part.target[i]:part.target)??0,enable:part.enable??true,quickStop:part.quickStop??false,faultReset:part.faultReset??false}));
 }};
}
const torqueCase=(id:string,o:Omit<BenchCase,'id'|'needsTorque'|'requires'>):BenchCase=>({id,needsTorque:true,requires:['KCF02'],...o});   // K09 tightens requires to KCF04/KCF01

const KCF02:BenchCase={...torqueCase('KCF02',{
 script:(kit,p)=>afterEnable(kit,p,settleTicks(p),j=>j<settleTicks(p)?{}:{enable:false}),
 evaluate(t,kit,p){
  const e=t.ticks.findIndex(x=>allEnabled(x.feedback));
  if(e<0||e>=p.enableTimeoutTicks)return failed('ENABLE_TIMEOUT');
  const held=t.ticks.slice(e).filter(torque);
  if(held.some(x=>!allEnabled(x.feedback)))return failed('LEFT_ENABLED');
  if(held.some(x=>x.feedback.some(f=>f.velocityRadS===null||Math.abs(f.velocityRadS)>p.restSpeedRadS)))return failed('MOVED_AT_ZERO_TARGET');
  return tested([m('KCF02','enableDelayMs',(e+1)*TICK_MS,'ms',TICK_MS)]);
 },
}),requires:[]};

/** KCF03 on the given registered bench signals (bench-signals.ts), played one after the other. The check is the same for any signal: wherever the commanded
 * speed has not changed for settleMs, |measured - commanded| <= relative x |commanded| + absolute. */
export function trackingCase(signals:BenchSignal[]):BenchCase{
 const lengths=(p:BenchPolicy)=>signals.map(s=>s.kind==='hold'?s.ticks:(s.kind==='step'?s.atTick:benchMotionEndTick(s)+1)+2*settleTicks(p));
 return torqueCase('KCF03',{
  script(kit,p){
   const len=lengths(p),total=len.reduce((a,b)=>a+b,0);
   return afterEnable(kit,p,total,j=>{
    if(j>=total)return {enable:false};
    let i=0;for(;j>=len[i]!;i++)j-=len[i]!;
    return {target:benchTarget(signals[i]!,0,j,'csv')};
   });
  },
  evaluate(t,kit,p){
   const S=settleTicks(p);let worst=0,n=0;
   for(let k=S;k<t.ticks.length;k++){
    const x=t.ticks[k]!;
    if(!torque(x))continue;
    for(const [i,c] of x.driveCommands.entries()){
     if(t.ticks.slice(k-S,k).some(y=>!torque(y)||Math.abs(y.driveCommands[i]!.target-c.target)>1e-9)||x.feedback[i]!.state!=='enabled')continue;
     const v=x.feedback[i]!.velocityRadS,tol=p.trackingToleranceRadS.relative*Math.abs(c.target)+p.trackingToleranceRadS.absolute,err=v===null?Infinity:Math.abs(v-c.target);
     if(err>tol)return failed(`trackingToleranceRadS exceeded: ${c.axisId} at tick ${k}, |${v}-${c.target}| > ${tol.toFixed(3)} rad/s`);
     worst=Math.max(worst,err);n++;
    }
   }
   return n?tested([m('KCF03','trackingErrorMaxRadS',worst,'rad/s',resolution(kit).velocity,n)]):failed('NO_SETTLED_SAMPLE');
  },
 });
}
/** Registered sizes (BENCH_AMPLITUDES.wheelRadS) in both directions: reverse exists only on the bench (the simulated wheel bench runs forward only). */
const KCF03_SIGNALS:BenchSignal[]=[...[2,5].flatMap(a=>[1,-1].flatMap(sign=>[
 {kind:'step' as const,amplitude:sign*a,atTick:0},{kind:'trapezoid' as const,distance:sign*a*1.5,peakVelocity:a,acceleration:10,atTick:0}])),{kind:'hold',ticks:2*25}];

const KCF05=torqueCase('KCF05',{
 reads:['605A:00'],
 script:(kit,p)=>{const S=settleTicks(p);return afterEnable(kit,p,3*S,j=>j<S?{target:2}:j<3*S?{quickStop:true}:{enable:false});},
 evaluate(t,kit,p){
  const q=t.ticks.findIndex(x=>x.driveCommands.every(c=>c.quickStop));
  if(q<0)return failed('QUICK_STOP_NOT_SENT');
  const end=t.ticks.findIndex((x,k)=>k>q&&!x.driveCommands.every(c=>c.quickStop)),held=t.ticks.slice(q,end<0?undefined:end);
  let stopMs=0;
  for(const [i,a] of kit.axes.entries()){
   const option=t.objects?.[a.axisId]?.['605A:00'],states=held.map(x=>x.feedback[i]!.state);
   if(option===undefined)return {status:'not_run',reason:'OBJECT_NOT_READ 605A:00',measurements:[]};
   if(states.includes('enabled'))return failed('ENABLED_DURING_QUICK_STOP');
   if(states[0]!=='quick_stop')return failed(`QUICK_STOP_NOT_ENTERED ${a.axisId}:${states[0]}`);
   const want=[1,2,3].includes(option)?'disabled':[5,6,7].includes(option)?'quick_stop':null;
   if(!want)return failed(`QUICK_STOP_OPTION_NOT_COVERED 605Ah=${option}`);
   if(states.at(-1)!==want)return failed(`QUICK_STOP_END_STATE ${a.axisId}: ${states.at(-1)}, 605Ah=${option} gives ${want}`);
   const rest=held.findIndex(x=>Math.abs(x.feedback[i]!.velocityRadS??Infinity)<=p.restSpeedRadS);
   if(rest<0)return failed(`NOT_AT_REST ${a.axisId}`);
   stopMs=Math.max(stopMs,(rest+1)*TICK_MS);
  }
  return tested([m('KCF05','quickStopTimeMs',stopMs,'ms',TICK_MS)]);
 },
});

/** First tick (index) of a rising faultReset edge on a new seq, after `from`. */
const resetEdge=(t:CaseTrace,from:number)=>t.ticks.findIndex((x,k)=>k>from&&x.driveCommands.every(c=>c.faultReset)&&!t.ticks[k-1]!.driveCommands[0]!.faultReset&&x.driveCommands[0]!.seq>t.ticks[k-1]!.driveCommands[0]!.seq);
const tripped=(t:CaseTrace)=>t.ticks.findIndex(x=>x.feedback.every(f=>f.fault==='COMMAND_TIMEOUT'));

/** The fault is provoked from the host (the channel watchdog), which works on any drive: hold faultReset at 1, stop sending new seqs, send them again with
 * faultReset still 1 (no edge: the fault stays), then 0, then a rising edge. */
const KCF06=torqueCase('KCF06',{
 script:(kit,p)=>afterEnable(kit,p,48,j=>j<10?{}:j<13?{faultReset:true}:j<21?{faultReset:true,stale:true}:j<36?{faultReset:true,enable:false}:j<37?{enable:false}:j<42?{faultReset:true,enable:false}:{enable:false},{expectedFaults:['COMMAND_TIMEOUT']}),
 evaluate(t){
  const f=tripped(t);
  if(f<0)return failed('FAULT_NOT_LATCHED');
  const r=resetEdge(t,f);
  if(r<0)return failed('NO_RESET_EDGE');
  if(t.ticks.slice(f,r).some(x=>x.feedback.some(y=>y.state!=='fault')))return failed('FAULT_CLEARED_WITHOUT_EDGE');
  if(t.ticks[r]!.feedback.some(y=>y.state==='fault'||y.fault!==null))return failed('FAULT_NOT_CLEARED');
  return tested();
 },
});

const KCF07a=torqueCase('KCF07a',{
 script:(kit,p)=>{const S=settleTicks(p);return afterEnable(kit,p,S+40,j=>j<S?{target:p.creepSpeedRadS}:j<S+10?{target:p.creepSpeedRadS,stale:true}:j<S+35?{enable:false}:j<S+38?{enable:false,faultReset:true}:{enable:false},{expectedFaults:['COMMAND_TIMEOUT']});},
 evaluate(t,kit){
  const f=tripped(t),seq=t.ticks.map(x=>x.driveCommands[0]!.seq);
  if(f<0)return failed('WATCHDOG_DID_NOT_TRIP');
  let last=f;while(last>0&&seq[last]===seq[last-1])last--;
  const after=f-last;
  if(after>kit.channel.watchdogTicks)return failed(`WATCHDOG_LATE ${after} ticks > watchdogTicks ${kit.channel.watchdogTicks}`);
  if(resetEdge(t,f)<0||t.ticks.at(-1)!.feedback.some(y=>y.fault!==null))return failed('FAULT_NOT_CLEARED');
  return tested([m('KCF07a','watchdogTrippedAtTick',after,'tick',0)]);
 },
});

// KCF08: the real controller, unchanged, on both axes. Wheel geometry from the Serve fixture (the AMR whose drive the bench calibrates).
const kinematics=serveScene.robots[0]!.model.kinematics;
const PROFILE:[number,{vMps:number;omegaRadps:number;stopMode?:'normal'|'protective'}][]=[[10,{vMps:0,omegaRadps:0}],[50,{vMps:0.2,omegaRadps:0}],[50,{vMps:0.2,omegaRadps:0.5}],
 [50,{vMps:0,omegaRadps:0.5}],[30,{vMps:0,omegaRadps:0,stopMode:'normal'}],[30,{vMps:0,omegaRadps:0,stopMode:'protective'}]];
const PROFILE_TICKS=PROFILE.reduce((a,[n])=>a+n,0);
const setpointAt=(k:number)=>{let j=k-1;for(const [n,sp] of PROFILE){if(j<n)return sp;j-=n;}return PROFILE.at(-1)![1];};
export const kcf08Controller=(kit:BenchKitV1,p:BenchPolicy):DiffDriveBaseConfig=>({stopAware:true,axisLeft:kit.axes[0]!.axisId,axisRight:kit.axes[1]!.axisId,
 wheelRadiusM:kinematics.wheelRadiusM,wheelSeparationM:kinematics.wheelSeparationM,maxWheelAccelRadS2:kit.limits.maxAccelRadS2,enableTimeoutTicks:p.enableTimeoutTicks,
 trackingDegradedRadS:BASE_CONTROLLER_DEFAULTS.trackingDegradedRadS,trackingDegradedTicks:BASE_CONTROLLER_DEFAULTS.trackingDegradedTicks});
/** Runs the controller over ticks 1..PROFILE_TICKS; feedback(k) is what it sees at tick k (the feedback of tick k - 1). */
function drive(cfg:DiffDriveBaseConfig,feedback:(k:number)=>DriveFeedbackV1[]|undefined,onStep:(k:number,r:ReturnType<typeof diffDriveBaseV1.step>)=>void){
 let state=diffDriveBaseV1.init(cfg);
 return (k:number)=>{const fb=feedback(k);if(!fb)return;const r=diffDriveBaseV1.step(state,{tick:k,setpoint:setpointAt(k),feedback:fb});state=r.state;onStep(k,r);};
}
const KCF08=torqueCase('KCF08',{
 script(kit,p){
  const cfg=kcf08Controller(kit,p);let out:ReturnType<typeof diffDriveBaseV1.step>['commands']=[],last:DriveFeedbackV1[]=[];
  const tick=drive(cfg,()=>last,(_,r)=>{out=r.commands;});
  return {ticks:1+PROFILE_TICKS,meta:{controller:{id:diffDriveBaseV1.id,revision:diffDriveBaseV1.revision,config:cfg}},commandsAt(k,fb){
   // tick 0 asks for enable at rest: the controller needs a feedback for both axes before its first step; its seq n is sent as local seq n + 1
   if(k===0)return kit.axes.map(a=>({axisId:a.axisId,seq:1,mode:'csv' as const,target:0,enable:true,quickStop:false,faultReset:false}));
   last=fb;tick(k);return out.map(c=>({...c,seq:c.seq+1}));
  }};
 },
 evaluate(t,kit,p){
  const bad=t.ticks.flatMap(x=>validateBenchTick(x))[0];
  if(bad)return failed(`FEEDBACK_INVALID ${bad.path} ${bad.detail}`);
  const events:string[]=[],tick=drive(kcf08Controller(kit,p),k=>t.ticks[k-1]?.feedback,(_,r)=>events.push(...r.events.map(e=>e.code)));
  for(let k=1;k<=PROFILE_TICKS;k++)tick(k);
  const ev=events.find(e=>e==='DRIVE_FAULT'||e==='DRIVE_NOT_READY');
  if(ev)return failed(ev);
  if(t.ticks.length<=PROFILE_TICKS||t.ticks[PROFILE_TICKS]!.feedback.some(f=>f.state==='enabled'))return failed('PROTECTIVE_STOP_NOT_HELD');
  return tested();
 },
});

const soakTicks=(p:BenchPolicy)=>Math.round(p.soakMinutes*60*1000/TICK_MS);
const SOAK:BenchSignal={kind:'step',amplitude:2,atTick:0};
const KCF10=torqueCase('KCF10',{
 script:(kit,p)=>afterEnable(kit,p,soakTicks(p),j=>j<soakTicks(p)?{target:benchTarget(SOAK,0,j,'csv')}:{enable:false}),
 evaluate(t,kit,p){
  const run=t.ticks.filter(x=>torque(x)&&x.driveCommands.every(c=>c.target!==0));
  if(run.length!==soakTicks(p))return failed(`SOAK_SHORT ${run.length} of ${soakTicks(p)} ticks`);
  const wkc=t.cycles.filter(c=>c.wkc!==kit.axes.length).length;
  if(wkc)return failed(`WKC_ERRORS ${wkc} cycles`);
  if(run.slice(settleTicks(p)).some(x=>!allEnabled(x.feedback)))return failed('LEFT_ENABLED');
  return tested([m('KCF10','tickLatenessMaxMs',Math.max(...run.map(x=>x.latenessNs))/1e6,'ms',0,run.length),m('KCF10','wkcErrorCycles',0,'cycle',0,t.cycles.length)]);
 },
});

/** Last of a session: the silence ends it (only stop follows). */
const KCF07b=torqueCase('KCF07b',{
 script:(kit,p)=>{const s=afterEnable(kit,p,settleTicks(p),()=>({target:p.creepSpeedRadS}));return {...s,silence:{atTick:s.ticks,ms:p.silenceMs}};},
 evaluate(t,kit,p){
  const s=t.silence as {alState:string;slaves:{errorCode:number}[];axes:{positionRad:number;velocityRadS:number|null}[]}|undefined,before=t.ticks.at(-1)?.feedback;
  if(!s||!before)return failed('SILENCE_NOT_SENT');
  if(s.axes.some(a=>a.velocityRadS===null||Math.abs(a.velocityRadS)>p.restSpeedRadS))return failed('DRIVE_KEPT_RUNNING_WITHOUT_MASTER');
  if(s.alState==='OP'||s.slaves.some(x=>!x.errorCode))return failed('DRIVE_DID_NOT_LATCH');
  const travel=Math.max(...s.axes.map((a,i)=>Math.abs(a.positionRad-(before[i]!.positionRad??NaN))));
  return Number.isFinite(travel)?tested([m('KCF07b','travelDuringSilenceRad',travel,'rad',resolution(kit).position)]):failed('POSITION_UNKNOWN');
 },
});

/** The order of this package (spec B1 §6): KCF02 first, KCF07b last because its silence ends the session. */
export const CONFORMANCE_CASES:readonly BenchCase[]=freezeCases([KCF02,trackingCase(KCF03_SIGNALS),KCF05,KCF06,KCF07a,KCF08,KCF10,KCF07b]);   // frozen with its requires and reads: no code can add, drop or edit a case
