// The bench session (K04; spec B1 §3, §6; BK-D10, BK-D11): one case at a time on the 20 ms tick of a Clock, one `step` per tick, every row recorded.
// Gates before torque, each on its own: `requires` (case order), arming (an operator typed the code), and the torque gate in front of every step.
// Any abnormal end (operator abort, a fault the script did not provoke, a late tick, a refused step) sends a quick stop, then enable false until the power
// stages are off, and disarms the run: no later case gets torque without a new arming, and the caller stops the suite (ctx.disarmed).
import type {DriveCommandV1,DriveFeedbackV1} from '../../lab-runtime/src/v2/control/drive-io';
import type {Arming} from './arming';
import type {CaseTrace,CaseVerdict,BenchCase} from './cases/types';
import type {Clock} from './clock';
import type {BenchKitV1,BenchPolicy,BenchTickRecord,BenchCycleRow} from './contracts';
import type {BenchOp,BenchWorker} from './worker';

const TICK_NS=20_000_000n;
export interface RunContext{
 worker:BenchWorker;kit:BenchKitV1;policy:BenchPolicy;clock:Clock;
 sensors?:BenchWorker;                 // stepped in the same tick from K06; unused here
 arming:Arming;
 /** Ids of the cases that ended `tested` in this run; runCase adds to it. */
 passed:Set<string>;onTick?(t:BenchTickRecord):void;abort:AbortSignal;
 /** What `scan` read (startBenchSession), copied into every trace. */
 objects?:Record<string,Record<string,number>>;
 /** Set, never cleared, when a case ended abnormally: the run is no longer armed and the suite must stop (BK-D11). */
 disarmed?:boolean;
}
/** The runs an operator armed. Private on purpose: no field of the context can say "armed", so no caller can skip the code. */
const armedRuns=new WeakSet<RunContext>();

/** open, scan (reading `objects` on every slave), configure, start. A refusal throws {code}. Returns the objects per axis for RunContext.objects. */
export async function startBenchSession(w:BenchWorker,objects:string[]=[]):Promise<{scan:Record<string,unknown>;objects:Record<string,Record<string,number>>}>{
 const call=async(op:BenchOp,payload:Record<string,unknown>={})=>{
  const a=await w.request(op,payload,w.tick);
  if(!a.ok)throw Object.assign(new Error(`${a.error!.code}: ${a.error!.detail}`),{code:a.error!.code});
  return a.result!;
 };
 await call('open');
 const scan=await call('scan',{objects});
 await call('configure');await call('start');
 return {scan,objects:Object.fromEntries((scan.slaves as {axisId:string;objects:Record<string,number>}[]).map(s=>[s.axisId,s.objects]))};
}

const verdict=(trace:CaseTrace,status:CaseVerdict['status'],reason:string|null)=>({trace,verdict:{status,reason,measurements:[]}});
/** CiA 402 statusword bit 1 ("switched on") clear: Switch on disabled, Ready to switch on, Fault, Not ready; no torque from this drive. */
const powerOff=(v:{statusword:number})=>(v.statusword&0x02)===0;

export async function runCase(c:BenchCase,ctx:RunContext):Promise<{trace:CaseTrace;verdict:CaseVerdict}>{
 const trace:CaseTrace={ticks:[],cycles:[],prompts:[]},{worker,kit,policy,clock}=ctx;
 if(c.requires.some(id=>!ctx.passed.has(id)))return verdict(trace,'not_run','BENCH_ORDER_VIOLATION');
 if(ctx.abort.aborted)return verdict(trace,'not_run','OPERATOR_ABORT');
 const s=c.script(kit,policy);
 // ponytail: operator prompts (KCF01, KCF09) need a question io in the context; until a case has one, a case with prompts does not run
 if(s.prompts?.length)return verdict(trace,'not_run','BENCH_PROMPT_UNAVAILABLE');
 if(s.silence&&s.silence.atTick!==s.ticks)return verdict(trace,'not_run','BENCH_SCRIPT_INVALID');   // silence is sent after the last tick, never mid-script
 if(c.needsTorque&&!armedRuns.has(ctx)){
  if(!await ctx.arming.arm(`${c.id}: torque on ${kit.axes.map(a=>a.axisId).join(', ')}`))return verdict(trace,'not_run','BENCH_NOT_ARMED');
  armedRuns.add(ctx);
 }
 if(ctx.objects)trace.objects=ctx.objects;
 if(s.meta)trace.meta=s.meta;
 const t0=worker.tick,start=clock.nowNs(),expected=new Set<string>(s.expectedFaults??[]);
 let k=0,fb:DriveFeedbackV1[]=[],vendor:BenchTickRecord['vendor']=[],reason:string|null=null;
 /** One tick on the 20 ms grid: the step, its row, its cycles. A refused step returns its code; a lost worker throws. */
 const step=async(cmds:DriveCommandV1[])=>{
  const due=start+BigInt(k++)*TICK_NS;
  await clock.sleepUntilNs(due);
  const now=clock.nowNs(),ack=await worker.request('step',{commands:cmds},worker.tick);
  if(!ack.ok)return ack.error!.code;
  const r=ack.result as {feedback:DriveFeedbackV1[];vendor:BenchTickRecord['vendor'];cycles:BenchCycleRow[]};
  const row:BenchTickRecord={schemaVersion:1,tick:ack.tick-1,tMonoNs:Number(now),latenessNs:Number(now-due),armed:armedRuns.has(ctx),driveCommands:cmds,feedback:r.feedback,vendor:r.vendor};
  ({feedback:fb,vendor}=r);trace.ticks.push(row);trace.cycles.push(...r.cycles);ctx.onTick?.(row);
  return null;
 };
 try{
  for(let i=0;i<s.ticks;i++){
   if(ctx.abort.aborted){reason='OPERATOR_ABORT';break;}
   const cmds=s.commandsAt(i,fb).map(x=>({...x,seq:t0+x.seq}));
   // the torque gate: a command that asks for torque (enable without quickStop) leaves only from an armed torque case
   if(cmds.some(x=>x.enable&&!x.quickStop)&&!(c.needsTorque&&armedRuns.has(ctx))){reason='BENCH_NOT_ARMED';break;}
   if((reason=await step(cmds)))break;
   if(trace.ticks.at(-1)!.latenessNs>policy.tickLatenessMaxMs*1e6){reason='HOST_TICK_LATE';break;}   // the host's fault, not the drive's
   const bad=fb.filter(f=>f.state==='fault'&&!expected.has(f.fault!));
   if(bad.length){reason=`UNEXPECTED_FAULT ${bad.map(f=>`${f.axisId}:${f.fault}`).join(',')}`;break;}
  }
  if(!reason&&s.silence){    // the session ends here (KCF07b): only stop follows, so no stop sequence either
   const a=await worker.request('silence',{ms:s.silence.ms},worker.tick);
   if(a.ok)trace.silence=a.result;else reason=a.error!.code;
  }
  if(!trace.silence&&k>0){
   // the stop sequence: an abnormal end quick-stops first; then enable false until every power stage is off (the worker holds the ramp: stopseq rule 2)
   const quick=reason!==null,limit=Math.ceil((kit.channel.quickStopHoldMs??2000)/20)+10;
   for(let i=0;i<limit&&(i===0&&quick||!vendor.every(powerOff));i++){
    const seq=worker.tick+1,err=await step(kit.axes.map(a=>({axisId:a.axisId,seq,mode:'csv' as const,target:0,enable:quick&&i===0,quickStop:quick,faultReset:false})));
    if(err){reason??=err;break;}
   }
   if(!vendor.every(powerOff))reason??='BENCH_STOP_INCOMPLETE';
  }
 }catch(e){armedRuns.delete(ctx);ctx.disarmed=true;throw e;}   // WORKER_LOST / WORKER_TIMEOUT: nothing more is sent
 if(reason){armedRuns.delete(ctx);ctx.disarmed=true;return verdict(trace,'failed',reason);}
 const v=c.evaluate(trace,kit,policy);
 if(v.status==='tested')ctx.passed.add(c.id);
 return {trace,verdict:v};
}
