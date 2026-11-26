// The client of one bench_worker process (contracts §3). The wire discipline is copied from lab-runtime's worker-client.ts (K01 decision: COPY), not shared:
// one request in flight, an ACK deadline per op, a lost ACK is `unknown` and never sent again, any doubt kills the whole process group, and the client is then
// terminal: a lost worker is never replaced inside a run.
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {bytecodeEnv,isolatedPythonArgs} from '../../lab-runtime/src/engineering/python-env';
import {validateBenchCycle,validateBenchKit,validateBenchTick,validateBenchWire} from './contracts';

export type BenchOp='describe'|'open'|'scan'|'configure'|'start'|'step'|'silence'|'imuConfigure'|'stop';
export interface BenchAck{requestId:string;ok:boolean;tick:number;result?:Record<string,unknown>;error?:{code:string;detail:string}}
/** `unknown`: the request was on the wire and may have been applied; `not_sent`: it never left this process. */
export class BenchWorkerError extends Error{
 constructor(readonly code:string,readonly outcome:'unknown'|'not_sent',detail:string){super(`${code}: ${detail}`);this.name='BenchWorkerError';}
}
export interface BenchWorker{
 request(op:BenchOp,payload:Record<string,unknown>,expectedTick:number):Promise<BenchAck>;
 /** Closes stdin, which the worker treats as `stop`, waits for it to exit (the 5 s of `stop`), then kills the group. Idempotent. */
 close():Promise<void>;
 /** The tick of the last ACK. */
 readonly tick:number;readonly pid:number|undefined;
 /** The last 8 KiB of the worker's stderr (its last line is {"event":"stopped",...}); never printed. */
 readonly stderr:string;
}
/** ACK deadlines of contracts §3; `silence` gets its own `ms` on top. */
export const BENCH_DEADLINES_MS:Record<BenchOp,number>={describe:5000,open:10000,scan:30000,configure:30000,start:15000,step:200,silence:5000,imuConfigure:5000,stop:5000};
const isNum=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x),vec=(x:unknown)=>Array.isArray(x)&&x.length===3&&x.every(isNum),MAX_FRAMES_PER_STEP=2000;
/** The sensors role's step result (K06): decoded LD19 frames and IMU samples with the bytes each decoder dropped. Structural, hand-checked like the Python side. */
function sensorStepProblem(res:unknown):{path:string;detail:string}|undefined{
 const r=res as {lidar?:{frames?:unknown;droppedBytes?:unknown};imu?:{samples?:unknown;droppedBytes?:unknown}},f=r?.lidar?.frames,s=r?.imu?.samples;
 const lf=(x:unknown)=>{const y=x as {speedDegS?:unknown;startDeg?:unknown;endDeg?:unknown;sensorMs?:unknown;points?:unknown};
  return !!y&&isNum(y.speedDegS)&&isNum(y.startDeg)&&isNum(y.endDeg)&&isNum(y.sensorMs)&&Array.isArray(y.points)&&y.points.length===12&&y.points.every(p=>Array.isArray(p)&&p.length===2&&isNum(p[0])&&isNum(p[1]));};
 if(!Array.isArray(f)||f.length>MAX_FRAMES_PER_STEP||!f.every(lf))return {path:'/lidar/frames',detail:'not a list of LD19 frames'};
 if(!Array.isArray(s)||s.length>MAX_FRAMES_PER_STEP||!s.every(x=>vec((x as {accelMps2?:unknown})?.accelMps2)&&vec((x as {gyroRadS?:unknown}).gyroRadS)&&vec((x as {rpyRad?:unknown}).rpyRad)))return {path:'/imu/samples',detail:'not a list of IMU samples'};
 return [r.lidar?.droppedBytes,r.imu?.droppedBytes].every(d=>Number.isSafeInteger(d)&&(d as number)>=0)?undefined:{path:'/droppedBytes',detail:'not a count'};
}
const ROOT=fileURLToPath(new URL('../../../robotics/bench',import.meta.url)),MAX_LINE_BYTES=1<<20;

/** `deadlinesMs` overrides BENCH_DEADLINES_MS for this worker only and is for tests (a loaded host must not fail a test whose subject is not the deadline); there is no
 * environment variable or other ambient way to change a deadline, and production callers never pass it. */
export async function spawnBenchWorker(o:{role:'bus'|'sensors';python:string;kitPath:string;bus:'sim'|'soem';readOnly:boolean;sessionId:string;deadlinesMs?:Partial<Record<BenchOp,number>>}):Promise<BenchWorker>{
 const over=Object.entries(o.deadlinesMs??{});
 if(over.some(([op,ms])=>!Object.hasOwn(BENCH_DEADLINES_MS,op)||!(typeof ms==='number'&&ms>0&&Number.isFinite(ms))))throw new BenchWorkerError('WORKER_REQUEST_INVALID','not_sent',`deadlinesMs ${JSON.stringify(o.deadlinesMs)}`);
 const deadlines={...BENCH_DEADLINES_MS,...o.deadlinesMs};
 const kitPath=resolve(o.kitPath),kit=validateBenchKit(JSON.parse(readFileSync(kitPath,'utf8')));   // the worker does not check the digest: never start it on a kit TS refuses
 if(!kit.ok)throw new BenchWorkerError('BENCH_KIT_INVALID','not_sent',kit.problems.map(p=>`${p.code} ${p.path}`).join('; '));
 const args=isolatedPythonArgs([ROOT],['-m','bench_worker'],['--role',o.role,'--kit',kitPath,'--bus',o.bus,'--session-id',o.sessionId,...o.readOnly?['--read-only']:[]]);
 const child=spawn(o.python,args,{cwd:ROOT,env:{PATH:'/usr/bin:/bin',...bytecodeEnv(),LANG:'C.UTF-8'} as unknown as NodeJS.ProcessEnv,stdio:['pipe','pipe','pipe'],detached:true});
 await new Promise<void>((ok,no)=>{child.once('spawn',ok);child.once('error',e=>no(new BenchWorkerError('WORKER_LOST','not_sent',e.message)));});
 let state:'ready'|'lost'|'closed'='ready',tick=0,n=0,buffer='',stderr='',closing:Promise<void>|undefined;
 let inFlight:{op:BenchOp;requestId:string;expectedTick:number;timer:NodeJS.Timeout;resolve:(a:BenchAck)=>void;reject:(e:Error)=>void}|undefined;
 // settled by the process ending; after 'exit' the pipes get 500 ms, then are destroyed (a grandchild holding them must not hold us: worker-client.ts)
 const exited=new Promise<void>(done=>{
  let settled=false;const fin=()=>{if(settled)return;settled=true;for(const s of [child.stdin,child.stdout,child.stderr])s.destroy();done();};
  child.once('close',fin);child.once('exit',()=>{setTimeout(fin,500).unref();});
 });
 const killGroup=()=>{try{if(child.pid)process.kill(-child.pid,'SIGKILL');}catch{/* already gone */}};
 const fail=(code:string,detail:string)=>{
  if(state!=='ready')return;
  state='lost';killGroup();
  const cur=inFlight;inFlight=undefined;
  if(cur){clearTimeout(cur.timer);cur.reject(new BenchWorkerError(code,'unknown',detail));}
 };
 const onLine=(line:string)=>{
  let r:BenchAck;
  try{r=JSON.parse(line) as BenchAck;}catch{return fail('WORKER_PROTOCOL','a worker line is not JSON');}
  const bad=validateBenchWire('response',r)[0],cur=inFlight;
  if(bad)return fail('WORKER_PROTOCOL',`response violates bench-wire-v1: ${bad.path} ${bad.detail}`);
  if(!cur||r.requestId!==cur.requestId)return fail('WORKER_PROTOCOL','late, duplicate or foreign response');
  if(r.ok?r.result===undefined||r.error!==undefined:r.result!==undefined)return fail('WORKER_PROTOCOL','ok disagrees with result/error');
  if(r.tick<tick)return fail('WORKER_PROTOCOL','tick went backwards');
  if(cur.op==='step'&&r.ok){
   // the rows a step returns are data only after they pass the same schemas the evidence uses
   const res=r.result as {feedback?:unknown;vendor?:unknown;cycles?:unknown};
   const problem=r.tick!==cur.expectedTick+1?{path:'/tick',detail:`a step at ${cur.expectedTick} answered at ${r.tick}`}
    :o.role==='sensors'?sensorStepProblem(r.result)
    :validateBenchTick({schemaVersion:1,tick:cur.expectedTick,tMonoNs:0,latenessNs:0,armed:false,driveCommands:[],feedback:res.feedback,vendor:res.vendor})[0]
    ??(Array.isArray(res.cycles)?res.cycles.flatMap(c=>validateBenchCycle(c))[0]:{path:'/cycles',detail:'missing'});
   if(problem)return fail('WORKER_PROTOCOL',`step result: ${problem.path} ${problem.detail}`);
  }
  tick=r.tick;clearTimeout(cur.timer);inFlight=undefined;
  if(cur.op==='stop'&&r.ok)state='closed';   // the worker exits after stop: later requests are refused here, never written
  cur.resolve(r);
 };
 child.stdout.on('data',(d:Buffer)=>{
  buffer+=d.toString('utf8');
  if(buffer.length>2*MAX_LINE_BYTES)return fail('WORKER_PROTOCOL','response line too large');
  let i:number;
  while((i=buffer.indexOf('\n'))>=0&&state==='ready'){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(line.trim())onLine(line);}
 });
 child.stderr.on('data',(d:Buffer)=>{stderr=(stderr+d.toString()).slice(-8192);});
 child.stdin.on('error',()=>{});
 // a stop's ACK is written just before the worker exits: let stdout drain before calling the exit a loss
 child.once('exit',(code,signal)=>{const lost=()=>fail('WORKER_LOST',`worker exited (${signal??code}); ${stderr.slice(-300)}`);if(inFlight?.op==='stop')void exited.then(lost);else lost();});
 child.on('error',e=>fail('WORKER_LOST',e.message));

 const self:BenchWorker={
  get tick(){return tick;},get pid(){return child.pid;},get stderr(){return stderr;},
  request(op,payload,expectedTick){
   if(state!=='ready')return Promise.reject(new BenchWorkerError('WORKER_LOST','not_sent',`the worker is ${state}; a lost worker is never replaced within a run`));
   if(inFlight)return Promise.reject(new BenchWorkerError('BENCH_REQUEST_IN_FLIGHT','not_sent',`${inFlight.op} has no ACK yet`));
   const req={protocol:'mekoniq-bench/1',requestId:`${op}-${++n}`,sessionId:o.sessionId,expectedTick,op,payload},bad=validateBenchWire('request',req)[0];
   if(bad)return Promise.reject(new BenchWorkerError('WORKER_REQUEST_INVALID','not_sent',`${bad.path} ${bad.detail}`));
   const line=JSON.stringify(req)+'\n';
   if(Buffer.byteLength(line)>MAX_LINE_BYTES)return Promise.reject(new BenchWorkerError('WORKER_REQUEST_INVALID','not_sent','request exceeds 1 MiB'));
   const ms=deadlines[op]+(op==='silence'?Number(payload.ms)||0:0);
   return new Promise((res,rej)=>{
    inFlight={op,requestId:req.requestId,expectedTick,resolve:res,reject:rej,timer:setTimeout(()=>fail('WORKER_TIMEOUT',`no ACK for ${op} within ${ms} ms`),ms)};
    child.stdin.write(line);
   });
  },
  close(){
   closing??=(async()=>{
    if(inFlight)fail('WORKER_LOST','closed with a request in flight');
    if(state==='ready')state='closed';
    child.stdin.end();
    const grace=setTimeout(killGroup,deadlines.stop);
    await exited;clearTimeout(grace);killGroup();
   })();
   return closing;
  },
 };
 return self;
}
