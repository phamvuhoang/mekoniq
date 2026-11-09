import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {validateIRSimRequest,validateIRSimResponse} from './contracts';
import type {IRSimRequestV1,IRSimResponseV1,IRSimSnapshotV1} from './contracts';
import {bytecodeEnv,isolatedPythonArgs} from '../../engineering/python-env';

const TICK_NS=20_000_000n;
export const MAX_LINE_BYTES=2*1024*1024,QUEUE_LIMIT=64;
/** Default wall-clock ACK deadlines (workers-runtime §2): create 15 s, step 5 s, pause/cancel 2 s. */
export const DEFAULT_DEADLINES_MS:Record<string,number>={describe:5000,create:15000,start:5000,step:5000,pause:2000,resume:2000,getState:5000,stop:2000};

/** The worker is gone or untrustworthy. `outcome: 'unknown'` means the request may have been applied: the caller must suspend, never resend to a new process. */
export class WorkerLostError extends Error{
 constructor(readonly code:string,readonly outcome:'unknown'|'not_sent',detail:string){super(`${code}: ${detail}`);this.name='WorkerLostError';}
}
export interface IRSimWorkerClient{
 request(request:IRSimRequestV1):Promise<IRSimResponseV1>;
 close(reason:string):Promise<void>;
 readonly state:'ready'|'failed'|'closed';
 readonly pid:number|undefined;
 readonly bootId:string|null;
 readonly stderrTail:string;
}
export interface SpawnOptions{
 python:string;workerRoot:string;runId:string;bundleRoot:string;runDirectory:string;lockDigest:string;
 /** Directory with the contract schemas the worker validates against (the same irsim-worker-v1 file this process uses). */
 schemaDir:string;sceneDigest?:string;
 /** sha256 of <bundleRoot>/scenario-fixture.json (scripted actors), bound at spawn like the scene digest: the worker loads actors only from a file with exactly this digest. */
 fixtureSha256?:string;
 /** Per-op ACK deadlines in ms (tests shorten them). */
 deadlinesMs?:Partial<Record<string,number>>;
 /** Interpreter arguments; default `-m irsim_worker`. Operator/test option only: never derived from a request. */
 entry?:string[];
}
interface Pending{request:IRSimRequestV1;resolve:(r:IRSimResponseV1)=>void;reject:(e:Error)=>void}

/** Starts one worker process for one run. There is never a second process for the same run: after a failure the client is terminal and recovery is a new run with locked inputs. */
export async function spawnIRSimWorker(o:SpawnOptions):Promise<IRSimWorkerClient>{
 await mkdir(o.runDirectory,{recursive:true});
 const deadlines={...DEFAULT_DEADLINES_MS,...o.deadlinesMs},root=resolve(o.workerRoot);
 const args=isolatedPythonArgs([root],o.entry??['-m','irsim_worker'],['--run-id',o.runId,'--bundle-root',resolve(o.bundleRoot),'--schema-dir',resolve(o.schemaDir),'--lock-digest',o.lockDigest,...o.sceneDigest?['--scene-digest',o.sceneDigest]:[],...o.fixtureSha256?['--fixture-sha256',o.fixtureSha256]:[]]);
 // fixed argv, allowlisted environment (no credentials, no ROS discovery), a private working directory; the venv isolates dependencies but is not a sandbox
 const env={PATH:'/usr/bin:/bin',PYTHONPATH:root,...bytecodeEnv(),PYTHONNOUSERSITE:'1',PYTHONUNBUFFERED:'1',PYTHONUTF8:'1',LANG:'C.UTF-8',MPLBACKEND:'Agg'} as unknown as NodeJS.ProcessEnv;
 const child=spawn(o.python,args,{cwd:resolve(o.runDirectory),env,stdio:['pipe','pipe','pipe'],detached:true});
 let state:'ready'|'failed'|'closed'='ready',bootId:string|null=null,buffer='',stderrTail='',lastTick=0,lastSeq=0n,sceneDigest=o.sceneDigest,timer:NodeJS.Timeout|undefined,closing:Promise<void>|undefined;
 const queue:Pending[]=[];let inFlight:Pending|undefined;
 // Settled by the process ending ('exit'; 'close' covers a spawn error where 'exit' never fires). It must not wait for stdio to drain: a grandchild that
 // inherited the pipes (recordings hung ~15 min on exactly that) would hold 'close' open, so after 'exit' the streams get 500 ms to flush and are then destroyed.
 const exited=new Promise<void>(done=>{
  let settled=false;const fin=()=>{if(settled)return;settled=true;for(const s of [child.stdin,child.stdout,child.stderr])s?.destroy();done();};
  child.once('close',fin);child.once('exit',()=>{setTimeout(fin,500).unref();});
 });
 child.stderr.on('data',(d:Buffer)=>{stderrTail=(stderrTail+d.toString()).slice(-4096);});
 child.stdin.on('error',()=>{});
 const killGroup=()=>{try{if(child.pid)process.kill(-child.pid,'SIGKILL');}catch{/* already gone */}};

 const fail=(code:string,detail:string)=>{
  if(state==='failed'||state==='closed')return;
  state='failed';clearTimeout(timer);killGroup();
  const current=inFlight;inFlight=undefined;
  // the request that was on the wire may have been applied; everything queued behind it never left this process
  current?.reject(new WorkerLostError(code,'unknown',detail));
  for(const p of queue.splice(0))p.reject(new WorkerLostError(code,'not_sent',detail));
 };
 const pump=()=>{
  if(state!=='ready'||inFlight)return;
  const next=queue.shift();
  if(!next)return;
  inFlight=next;
  timer=setTimeout(()=>fail('WORKER_TIMEOUT',`no ACK for ${next.request.op} within ${deadlines[next.request.op]} ms`),deadlines[next.request.op]??5000);
  child.stdin.write(JSON.stringify(next.request)+'\n');
 };
 const onLine=(line:string)=>{
  let parsed:unknown;
  try{parsed=JSON.parse(line);}catch{return fail('WORKER_PROTOCOL','a worker line is not JSON');}
  const checked=validateIRSimResponse(parsed);
  if(!checked.ok)return fail('WORKER_PROTOCOL',`response violates irsim-worker-v1: ${checked.issues[0]?.path} ${checked.issues[0]?.code}`);
  const r=checked.value,current=inFlight;
  if(!current||r.requestId!==current.request.requestId||r.runId!==o.runId)return fail('WORKER_PROTOCOL','late, duplicate or foreign response');
  if(bootId===null)bootId=r.bootId;else if(r.bootId!==bootId)return fail('WORKER_PROTOCOL','bootId changed within one run');
  if(r.tick<lastTick)return fail('WORKER_PROTOCOL','tick went backwards');
  if(r.ok){
   const op=current.request.op,result=r.result as {schemaVersion?:number;state?:string;packageVersion?:string},snap=result.schemaVersion===1?r.result as IRSimSnapshotV1:null;
   // each op answers with its own kind of result; a snapshot is never replaced by a bare state, and a state op carries no snapshot
   const wantsSnapshot=op==='create'||op==='step'||op==='getState';
   if(wantsSnapshot&&!snap)return fail('WORKER_PROTOCOL',`${op} was acknowledged without a snapshot`);
   if(!wantsSnapshot&&snap)return fail('WORKER_PROTOCOL',`${op} was answered with a snapshot`);
   if(op==='describe'?result.packageVersion===undefined:op!=='create'&&op!=='step'&&op!=='getState'&&result.state===undefined)return fail('WORKER_PROTOCOL',`${op} was answered with the wrong kind of result`);
   // time moves only on a step: any other op answers at the tick it was asked for
   if(op!=='step'&&op!=='describe'&&r.tick!==current.request.expectedTick)return fail('WORKER_PROTOCOL',`${op} answered at tick ${r.tick}, not the expected ${current.request.expectedTick}`);
   if(op==='step'&&r.tick!==current.request.payload.targetTick)return fail('WORKER_PROTOCOL','a step was acknowledged at a tick other than its target');
   // a snapshot describes the run it was cut from: same process, run, tick (x 20 ms) and scene as the envelope and as every earlier one, in order
   if(snap){
    if(snap.runId!==o.runId||snap.bootId!==r.bootId||snap.tick!==r.tick)return fail('WORKER_PROTOCOL','the snapshot contradicts its own envelope (run, boot or tick)');
    if(BigInt(snap.simTimeNs)!==BigInt(snap.tick)*TICK_NS)return fail('WORKER_PROTOCOL','simTimeNs is not tick x 20 ms');
    if(BigInt(snap.seq)<lastSeq)return fail('WORKER_PROTOCOL','snapshot sequence went backwards');
    lastSeq=BigInt(snap.seq);
    sceneDigest??=snap.sceneDigest;
    if(snap.sceneDigest!==sceneDigest)return fail('WORKER_PROTOCOL','the snapshot is for a different scene than this run was bound to');
   }
  }
  lastTick=r.tick;clearTimeout(timer);inFlight=undefined;
  current.resolve(r);
  if(!r.ok&&['INVALID_JSON','INVALID_REQUEST','REQUEST_TOO_LARGE','WORKER_FAILED','CLOCK_DRIFT','SENSOR_INCONSISTENT'].includes((r as {error:{code:string}}).error.code))fail('WORKER_FATAL',(r as {error:{code:string}}).error.code);
  else pump();
 };
 child.stdout.on('data',(d:Buffer)=>{
  buffer+=d.toString('utf8');
  if(buffer.length>MAX_LINE_BYTES*2)return fail('WORKER_PROTOCOL','response line too large');
  let i:number;
  while((i=buffer.indexOf('\n'))>=0&&state==='ready'){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(line.trim())onLine(line);}
 });
 child.once('exit',(code,signal)=>{if(state==='ready')fail('WORKER_EXITED',`worker exited (${signal??code}); ${stderrTail.slice(-300)}`);});
 child.once('error',e=>fail('WORKER_SPAWN_FAILED',e.message));

 const self:IRSimWorkerClient={
  get state(){return state;},get pid(){return child.pid;},get bootId(){return bootId;},get stderrTail(){return stderrTail;},
  request(request){
   const checked=validateIRSimRequest(request);
   if(!checked.ok)return Promise.reject(new WorkerLostError('INVALID_REQUEST','not_sent',`${checked.issues[0]?.path} ${checked.issues[0]?.code}`));
   if(Buffer.byteLength(JSON.stringify(request))>MAX_LINE_BYTES)return Promise.reject(new WorkerLostError('REQUEST_TOO_LARGE','not_sent','request exceeds 2 MiB'));
   if(state!=='ready')return Promise.reject(new WorkerLostError('WORKER_LOST','not_sent',`the worker is ${state}; a lost run is never continued by a new process`));
   if(queue.length>=QUEUE_LIMIT)return Promise.reject(new WorkerLostError('WORKER_QUEUE_FULL','not_sent',`more than ${QUEUE_LIMIT} requests are waiting`));
   return new Promise((resolve,reject)=>{queue.push({request,resolve,reject});pump();});
  },
  close(reason){
   closing??=(async()=>{
    if(state==='ready'&&!inFlight&&!queue.length){
     // idle: a graceful stop lets the engine end cleanly; the 2 s deadline then the group kill give the same end state either way
     await self.request({protocol:'mekoniq-irsim/1',requestId:`close-${Date.now()}`,runId:o.runId,expectedTick:lastTick,op:'stop',payload:{reason:reason.slice(0,200)}}).catch(()=>undefined);
    }else if(state==='ready')fail('WORKER_CLOSED',`closed while a request was outstanding: ${reason}`); // busy: do not wait behind it
    state=state==='failed'?'failed':'closed';
    child.stdin.end();
    const grace=setTimeout(killGroup,2000);
    await exited;clearTimeout(grace);killGroup();
   })();
   return closing;
  },
 };
 return self;
}
