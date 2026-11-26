// The bench session (K04; spec B1 §3, §6; BK-D10, BK-D11): one case at a time on the 20 ms tick of a Clock, one `step` per tick, every row recorded.
// Gates before torque, each on its own: `requires` (case order), arming (an operator typed the code), and the torque gate in front of every step.
// Any abnormal end (operator abort, a fault the script did not provoke, a late tick, a refused step) sends a quick stop, then enable false until the power
// stages are off, and disarms the run: no later case gets torque without a new arming, and the caller stops the suite (ctx.disarmed).
import {validateDriveCommandShape,type DriveCommandV1,type DriveFeedbackV1} from '../../lab-runtime/src/v2/control/drive-io';
import type {Arming} from './arming';
import {scanRows,verdictOf,type CaseTrace,type CaseVerdict,type BenchCase,type ImuRow,type LidarFrameRow} from './cases/index';
import type {Clock} from './clock';
import type {BenchKitV1,BenchPolicy,BenchTickRecord,BenchCycleRow} from './contracts';
import type {BenchOp,BenchWorker} from './worker';

const TICK_NS=20_000_000n;
export interface RunContext{
 worker:BenchWorker;kit:BenchKitV1;policy:BenchPolicy;clock:Clock;
 sensors?:BenchWorker;                 // the sensors worker (K06), stepped in the same tick as the bus worker; its loss is an abnormal end (SENSOR_WORKER_LOST)
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

/** CiA 402 statusword bit 1 ("switched on") clear: Switch on disabled, Ready to switch on, Fault, Not ready; no torque from this drive. */
const powerOff=(v:{statusword:number})=>(v.statusword&0x02)===0;

/** How a case ends. Every path that sent anything ends with a stop that is sent and awaited: the stop sequence of steps (`stopAxes`), or the wire `stop` op once
 * a `silence` has been sent, also from the catch, whatever threw (a terminal worker refuses at once, so that is safe). Every end other than a clean script,
 * an `evaluate`d verdict and no recorded script error disarms the run; a thrown error is rethrown after the stop, every other abnormal end is a `failed` verdict.
 * A step sequence that is refused, does not end, or throws falls back to the wire `stop` (no clock, no step; a lost worker refuses it at once).
 * `meta.runner` and `meta.error` are the runner's: a script that sets either is refused before any step.
 * With ctx.sensors every tick also steps the sensors worker (after the bus step; during the stop ticks too, but the stop never waits for it). A sensors worker that is lost
 * or refuses a step ends the case like any abnormal end (reason SENSOR_WORKER_LOST or its code). Only a case with `needsSensors` keeps the frames in its trace.
 * The verdict is verdictOf(trace): whatever the runner decides itself is stored in trace.meta.runner, so the stored trace alone gives it back. */
export async function runCase(c:BenchCase,ctx:RunContext):Promise<{trace:CaseTrace;verdict:CaseVerdict}>{
 const trace:CaseTrace={ticks:[],cycles:[],prompts:[]},{worker,kit,policy,clock,sensors}=ctx;
 const decided=(status:'not_run'|'failed',reason:string)=>{trace.meta={...trace.meta,runner:{status,reason}};return {trace,verdict:verdictOf(c,trace,kit,policy)};};
 if(c.requires.some(id=>!ctx.passed.has(id)))return decided('not_run','BENCH_ORDER_VIOLATION');
 if(c.needsSensors&&!sensors)return decided('not_run','SENSORS_UNAVAILABLE');
 if(ctx.abort.aborted)return decided('not_run','OPERATOR_ABORT');
 const s=c.script(kit,policy);
 // ponytail: operator prompts (KCF01, KCF09) need a question io in the context; until a case has one, a case with prompts does not run
 if(s.prompts?.length)return decided('not_run','BENCH_PROMPT_UNAVAILABLE');
 if(s.silence&&s.silence.atTick!==s.ticks||s.meta&&(Object.hasOwn(s.meta,'runner')||Object.hasOwn(s.meta,'error')))return decided('not_run','BENCH_SCRIPT_INVALID');   // silence after the last tick only; runner and error are reserved
 if(c.needsTorque&&!armedRuns.has(ctx)){
  if(!await ctx.arming.arm(`${c.id}: torque on ${kit.axes.map(a=>a.axisId).join(', ')}`))return decided('not_run','BENCH_NOT_ARMED');
  armedRuns.add(ctx);
 }
 if(ctx.objects)trace.objects=ctx.objects;
 if(s.meta)trace.meta=s.meta;
 const t0=worker.tick,start=clock.nowNs(),expected=new Set<string>(s.expectedFaults??[]);
 let k=0,fb:DriveFeedbackV1[]=[],vendor:BenchTickRecord['vendor']=[],reason:string|null=null,scriptError:string|null=null,sensorError:string|null=null;
 const lidar:LidarFrameRow[]=[],imu:ImuRow[]=[],dropped={lidarBytes:0,imuBytes:0};
 const disarm=()=>{armedRuns.delete(ctx);ctx.disarmed=true;};
 /** Case code (commandsAt) and the caller's onTick never throw through the loop: the first error is kept and ends the case like any abnormal end. */
 const guarded=<T>(f:()=>T):T|undefined=>{try{return f();}catch(e){scriptError??=e instanceof Error?e.message:String(e);return undefined;}};
 /** One tick on the 20 ms grid: the step, its row, its cycles. A refused step returns its code; a lost worker throws. */
 const step=async(cmds:DriveCommandV1[])=>{
  const due=start+BigInt(k++)*TICK_NS;
  await clock.sleepUntilNs(due);
  const now=clock.nowNs(),ack=await worker.request('step',{commands:cmds},worker.tick);
  if(!ack.ok)return ack.error!.code;
  const r=ack.result as {feedback:DriveFeedbackV1[];vendor:BenchTickRecord['vendor'];cycles:BenchCycleRow[]};
  const row:BenchTickRecord={schemaVersion:1,tick:ack.tick-1,tMonoNs:Number(now),latenessNs:Number(now-due),armed:armedRuns.has(ctx),driveCommands:cmds,feedback:r.feedback,vendor:r.vendor};
  ({feedback:fb,vendor}=r);trace.ticks.push(row);trace.cycles.push(...r.cycles);guarded(()=>ctx.onTick?.(row));
  if(sensors&&!sensorError)await stepSensors(row.tick,row.tMonoNs);
  return null;
 };
 /** The sensors worker's step of the same tick; the first failure is kept (sensorError) and never thrown, so the stop sequence goes on without it. */
 const stepSensors=async(tick:number,tMonoNs:number)=>{
  try{
   const a=await sensors!.request('step',{commands:[]},sensors!.tick);
   if(!a.ok){sensorError=a.error!.code;return;}
   const r=a.result as unknown as {lidar:{frames:Omit<LidarFrameRow,'tick'|'tMonoNs'>[];droppedBytes:number};imu:{samples:Pick<ImuRow,'accelMps2'|'gyroRadS'|'rpyRad'>[];droppedBytes:number}};
   if(!c.needsSensors)return;
   for(const f of r.lidar.frames)lidar.push({tick,tMonoNs,...f});
   for(const x of r.imu.samples)imu.push({tick,tMonoNs,sensorTime:null,...x});
   dropped.lidarBytes+=r.lidar.droppedBytes;dropped.imuBytes+=r.imu.droppedBytes;
  }catch{sensorError='SENSOR_WORKER_LOST';}
 };
 /** THE stop sequence of steps: an abnormal end (`quick`) sends one quick-stop tick first; then quickStop/enable false ticks until every power stage is off
  * (the worker holds the ramp: stopseq rule 2), at most quickStopHoldMs + 10 ticks. Returns a code when it could not finish. */
 const stopAxes=async(quick:boolean)=>{
  const limit=Math.ceil((kit.channel.quickStopHoldMs??2000)/20)+10;
  for(let i=0;i<limit&&(i===0&&quick||!vendor.every(powerOff));i++){
   const seq=worker.tick+1,err=await step(kit.axes.map(a=>({axisId:a.axisId,seq,mode:'csv' as const,target:0,enable:quick&&i===0,quickStop:quick,faultReset:false})));
   if(err)return err;
  }
  return vendor.every(powerOff)?null:'BENCH_STOP_INCOMPLETE';
 };
 /** After a `silence` was sent (accepted or refused) the worker's session may be over, so steps are no longer the way: the wire `stop` holds the ramp itself. */
 let silenceSent=false;
 const stopOp=async()=>{const st=await worker.request('stop',{},worker.tick);if(st.ok){trace.stop=st.result;return null;}trace.stop={refused:st.error};return st.error!.code;};
 const stop=async(quick:boolean)=>{
  if(silenceSent)return stopOp();
  const err=await stopAxes(quick);
  if(err)await stopOp();   // refused or not ended: the wire stop holds the ramp itself, awaited here, never left to the caller's close()
  return err;
 };
 /** Case code must return a list of valid DriveCommandV1 (local seq included): anything else is a script error, never a request the wire refuses mid-case. */
 const commandsAt=(i:number)=>{
  const out=s.commandsAt(i,fb) as unknown,bad=Array.isArray(out)?out.findIndex(x=>!validateDriveCommandShape(x)):-2;
  if(bad!==-1)throw new Error(`commandsAt(${i}) returned ${bad===-2?`${String(out)}, not a command list`:`an invalid command [${bad}]: ${JSON.stringify(validateDriveCommandShape.errors?.[0]??null)}`}`);
  return out as DriveCommandV1[];
 };
 try{
  for(let i=0;i<s.ticks;i++){
   if(ctx.abort.aborted){reason='OPERATOR_ABORT';break;}
   const local=guarded(()=>commandsAt(i));
   if(!local){reason='CASE_SCRIPT_ERROR';break;}
   const cmds=local.map(x=>({...x,seq:t0+x.seq}));
   // the torque gate: a command that asks for torque (enable without quickStop) leaves only from an armed torque case
   if(cmds.some(x=>x.enable&&!x.quickStop)&&!(c.needsTorque&&armedRuns.has(ctx))){reason='BENCH_NOT_ARMED';break;}
   if((reason=await step(cmds)))break;
   if(sensorError){reason=sensorError;break;}
   if(scriptError){reason='CASE_SCRIPT_ERROR';break;}
   if(trace.ticks.at(-1)!.latenessNs>policy.tickLatenessMaxMs*1e6){reason='HOST_TICK_LATE';break;}   // the host's fault, not the drive's
   const bad=fb.filter(f=>f.state==='fault'&&!expected.has(f.fault!));
   if(bad.length){reason=`UNEXPECTED_FAULT ${bad.map(f=>`${f.axisId}:${f.fault}`).join(',')}`;break;}
  }
  if(!reason&&s.silence){
   // the session ends here (KCF07b; contracts §3: only stop follows), and a bus silence is an abnormal end by design: disarmed whatever the drive did
   silenceSent=true;disarm();
   const a=await worker.request('silence',{ms:s.silence.ms},worker.tick);
   if(a.ok)trace.silence=a.result;else reason=a.error!.code;
  }
  if(k>0||silenceSent){const err=await stop(reason!==null);reason??=err;}
  if(scriptError)reason??='CASE_SCRIPT_ERROR';   // also an onTick throw during the stop ticks of a clean end
  if(sensorError)reason??=sensorError;           // likewise a sensors worker lost during the stop ticks
 }catch(e){
  disarm();
  // best effort, whatever threw: the first error is the one reported. The step sequence needs the clock (or a worker request) that may be what threw; the wire
  // stop needs neither, and a lost worker refuses it at once (not_sent)
  try{await stop(true);}catch{await stopOp().catch(()=>{});}
  throw e;
 }
 if(c.needsSensors){trace.lidar=[...lidar,...scanRows(lidar)];trace.imu=imu;trace.sensorDropped=dropped;}
 if(scriptError)trace.meta={...trace.meta,error:scriptError};
 if(reason){disarm();return decided('failed',reason);}
 let v:CaseVerdict;
 try{v=verdictOf(c,trace,kit,policy);}
 catch(e){disarm();trace.meta={...trace.meta,error:e instanceof Error?e.message:String(e)};return decided('failed','CASE_EVALUATE_ERROR');}   // the axes are already stopped
 if(v.status==='tested')ctx.passed.add(c.id);
 return {trace,verdict:v};
}
