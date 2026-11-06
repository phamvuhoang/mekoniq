// gazebo_nav2 backend: an isolated simulation worker (robotics/simulation/bridge, Python) spoken to over an allowlisted JSON-lines protocol on
// stdio. The worker launches the compiled world and talks Nav2; this side never names a topic, an executable or a network endpoint.
// Without a worker (no python3 / no ROS on the host) the backend is honestly unavailable: no mock fallback, no fabricated goal state.
import {validNativeProfileReport} from '../../../../../scripts/native-sim/profile-report.mjs';
import {spawn,spawnSync,type ChildProcess} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {JsonObject,RobotCommand} from '../../../../contracts/src/index';
export const GAZEBO_NAV2={id:'gazebo_nav2',version:'1',model:'physics_sim',dynamics:true} as const;
export interface SemanticBinding {waypointId:string;mapId:string;mapRevision:string;frame:'map';x:number;y:number;yaw:number}
export interface CompiledWorld {bindings:Record<string,SemanticBinding>;inputHash:string;manifestHash:string;outputDirectory:string;worldFile:string;mapIdentityFile:string;sceneIndexFile:string;mapId:string;mapRevision:string;robots:{entityId:string;namespace:string}[]}
const SHA=/^[0-9a-f]{64}$/;
/** Read a compiled bundle's manifest back (compiler-manifest.json, written by robotics/simulation/compiler). Paths stay server-side. */
export async function readCompiledWorld(directory:string):Promise<CompiledWorld>{
 let text:string;
 try{text=await readFile(join(directory,'compiler-manifest.json'),'utf8');}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')throw new Error('BUNDLE_MISSING');throw e;}
 const m=JSON.parse(text) as JsonObject,outputs=Array.isArray(m.outputs)?(m.outputs as {path:string}[]).map(o=>o.path):[],map=m.map as JsonObject|undefined,robots=m.robots as JsonObject[]|undefined;
 const has=(f:string)=>outputs.includes(f)?f:undefined;
 if(!SHA.test(String(m.inputHash))||!SHA.test(String(m.manifestHash))||!map||typeof map.mapId!=='string'||typeof map.mapRevision!=='string'||!Array.isArray(robots)||!has('world.sdf')||!has('map.identity.json')||!has('scene-index.json'))throw new Error('BUNDLE_INVALID');
 const raw=await readFile(join(directory,'bindings.json'));
 const bindingOutput=(m.outputs as JsonObject[]).find(o=>o.path==='bindings.json');
 if(!bindingOutput||bindingOutput.sha256!==createHash('sha256').update(raw).digest('hex'))throw new Error('BINDINGS_DIGEST_MISMATCH');
 const data=JSON.parse(raw.toString()) as {frame:string;mapId:string;mapRevision:string;bindings:Record<string,SemanticBinding>};
 if(data.frame!=='map'||data.mapId!==map.mapId||data.mapRevision!==map.mapRevision||!data.bindings||typeof data.bindings!=='object'||Array.isArray(data.bindings))throw new Error('BINDINGS_INVALID');
 for(const [id,b] of Object.entries(data.bindings))if(!b||b.waypointId!==id||b.mapId!==map.mapId||b.mapRevision!==map.mapRevision||b.frame!=='map'||![b.x,b.y,b.yaw].every(Number.isFinite))throw new Error('BINDINGS_INVALID');
 return {bindings:data.bindings,inputHash:String(m.inputHash),manifestHash:String(m.manifestHash),outputDirectory:resolve(directory),worldFile:'world.sdf',mapIdentityFile:'map.identity.json',sceneIndexFile:'scene-index.json',mapId:map.mapId,mapRevision:map.mapRevision,
  robots:robots.map(r=>({entityId:String(r.entityId),namespace:String(r.namespace)}))};
}
export type WorkerOp='capability'|'execute'|'cancel'|'stop'|'query'|'pause'|'step'|'barrier'|'bind_transfer'|'cup_pose'|'native_blocker'|'close';
export interface WorkerRequest {op:WorkerOp;args:JsonObject}
/** Transport to one worker process (or a test double). A rejected promise means no usable reply: the caller treats the outcome as unknown. */
export interface WorkerEvent {event:string;payload:JsonObject}
export interface WorkerPort {request(op:WorkerOp,args:JsonObject,timeoutMs?:number):Promise<JsonObject>;close():Promise<void>;
 /** Unsolicited worker lines (telemetry samples, contacts, clock marks); absent on a double that produces none. */
 onEvent?(listener:(e:WorkerEvent)=>void):()=>void}
export interface BackendCapability {backendId:'gazebo_nav2';available:boolean;step:boolean;version:string;reasons:string[];evidence:string;bootId:string|null;robots:string[];image?:JsonObject;environment?:JsonObject;beverage?:{available:boolean;reasonCodes:string[];producer?:string;fidelity?:string}}
export interface GazeboBackend {
 readonly world:CompiledWorld;readonly runId:string;
 capability():Promise<BackendCapability>;
 /** Worker events (telemetry, contacts); a no-op unsubscribe when the port has no event channel. */
 onEvent(listener:(e:WorkerEvent)=>void):()=>void;
 execute(robotId:string,command:RobotCommand):Promise<JsonObject>;
 query(robotId:string,commandId:string):Promise<JsonObject>;
 cancel(robotId:string,commandId:string):Promise<JsonObject>;
 stop(robotId:string,reason:string):Promise<JsonObject>;
 pause(paused:boolean):Promise<JsonObject>;
 /** Transfer barrier: each participant answers with the world clock and the worker clock (SIM-07); an unavailable backend acks nobody. */
 barrier(barrierId:string,participants:string[],proof?:{nonce:string;bootId:string;afterSeq:string;state:'stationary'}):Promise<JsonObject>;
 /** Model effects and receiver binding use only pinned fixture ids; observations arrive independently through onEvent. */
 bindTransfer?(identity:{worldRevision:string;cupId:string;fixtureId:string;transferId:string;commandId:string;payloadHash:string;controlEpoch:number;robotId:string;slot:number}):Promise<JsonObject>;
 setBlocker?(enabled:boolean):Promise<JsonObject>;
 setCupPose?(effect:{worldRevision:string;fixtureId:string;positionM:[number,number,number]}):Promise<JsonObject>;
 close():Promise<void>;
}
const SIM_ROOT=resolve(fileURLToPath(new URL('../../../../../robotics/simulation/',import.meta.url)));
/** Per-run ROS domain (1..100) and Gazebo partition from the run id: two runs on one host never share a graph (the worker keeps them if set). */
export function partitionEnv(runId:string){const n=parseInt(createHash('sha256').update(runId).digest('hex').slice(0,8),16);return {ROS_DOMAIN_ID:String(1+n%100),GZ_PARTITION:`lab-${runId}`};}
/** Fixed argv for the worker (shell:false): module, bundle, run id, namespaces, state dir, optional scenario fixture. No user string reaches it. */
export function workerArgv(world:CompiledWorld,runId:string,python='python3',scenarioFile?:string,simulationRoot=SIM_ROOT){
 return {command:python,args:['-m','bridge.nav2_session','--bundle',world.outputDirectory,'--run-id',runId,'--robots',world.robots.map(r=>r.namespace).join(','),'--state-dir',join(world.outputDirectory,'.bridge'),...scenarioFile?['--scenario',scenarioFile]:[]],cwd:simulationRoot,
  env:{...process.env,PYTHONPATH:`${simulationRoot}:${resolve(simulationRoot,'../agent')}`,...partitionEnv(runId)}};
}
/** JSON-lines request/response over a child's stdio; one in-flight request at a time per id, bounded wait. */
export class StdioWorkerPort implements WorkerPort {
 private pending=new Map<string,{resolve:(v:JsonObject)=>void;reject:(e:Error)=>void}>();private seq=0;private exited:Error|null=null;private listeners=new Set<(e:WorkerEvent)=>void>();
 constructor(private child:ChildProcess,private timeoutMs=10000){
  createInterface({input:child.stdout!}).on('line',line=>{let m:JsonObject;try{m=JSON.parse(line) as JsonObject;}catch{return;}
   if(typeof m.event==='string'){for(const l of this.listeners)l({event:m.event,payload:(m.payload??{}) as JsonObject});return;}
   const p=typeof m.id==='string'?this.pending.get(m.id):undefined;if(!p)return;this.pending.delete(String(m.id));
   if(m.ok===true)p.resolve(m.result as JsonObject);else p.reject(new Error(`WORKER_ERROR:${String((m.error as JsonObject|undefined)?.code??'UNKNOWN')}`));});
  const gone=(e:Error)=>{this.exited=e;for(const p of this.pending.values())p.reject(e);this.pending.clear();};
  child.once('exit',code=>gone(new Error(`WORKER_EXITED:${code}`)));
  child.stdin!.on('error',e=>gone(new Error(`WORKER_STDIN:${(e as NodeJS.ErrnoException).code??e.message}`))); // EPIPE after a worker death must never escape the event loop
 }
 request(op:WorkerOp,args:JsonObject,timeoutMs=this.timeoutMs):Promise<JsonObject>{
  if(this.exited)return Promise.reject(this.exited);
  const id=`r${++this.seq}`;
  return new Promise((res,rej)=>{
   const timer=setTimeout(()=>{this.pending.delete(id);rej(new Error('WORKER_TIMEOUT'));},timeoutMs);
   this.pending.set(id,{resolve:v=>{clearTimeout(timer);res(v);},reject:e=>{clearTimeout(timer);rej(e);}});
   this.child.stdin!.write(JSON.stringify({id,op,args})+'\n');
  });
 }
 onEvent(listener:(e:WorkerEvent)=>void){this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};}
 async close(){if(this.exited)return;await this.request('close',{}).catch(()=>{});this.child.kill('SIGTERM');}
}
async function spawnWorker(world:CompiledWorld,runId:string,python:string,scenarioFile?:string,simulationRoot=SIM_ROOT):Promise<{port:WorkerPort|null;reasons:string[]}>{
 const a=workerArgv(world,runId,python,scenarioFile,simulationRoot);
 return new Promise(res=>{
  // stderr is inherited: rclpy/Nav2 logging never fills a pipe nobody drains (which would block the worker into WORKER_TIMEOUT)
  const child=spawn(a.command,a.args,{cwd:a.cwd,env:a.env,stdio:['pipe','pipe','inherit'],shell:false});
  child.once('error',e=>res({port:null,reasons:[(e as NodeJS.ErrnoException).code==='ENOENT'?'PYTHON_MISSING':`WORKER_SPAWN_FAILED:${(e as Error).message}`]}));
  child.once('spawn',()=>res({port:new StdioWorkerPort(child),reasons:[]}));
 });
}
/**
 * Start the backend for one run. `options.port` injects a worker transport (tests: a protocol double); otherwise the Python worker is spawned.
 * Poll only the same worker during bounded startup; terminal failure remains unavailable, with no fallback.
 */
export async function startGazeboBackend(world:CompiledWorld,runId:string,options:{simulationRoot?:string;port?:WorkerPort;python?:string;scenarioFile?:string;startupTimeoutMs?:number;startupPollMs?:number;environmentProfile?:string}={}):Promise<GazeboBackend>{
 const simRoot=options.simulationRoot??SIM_ROOT;
 let image:JsonObject|undefined;try{image=JSON.parse(await readFile(join(simRoot,'image.lock.json'),'utf8')) as JsonObject;}catch{image=undefined;}
 let environment:JsonObject|undefined;
 if(options.environmentProfile){
  image=undefined;
  const p=spawnSync(options.python??'python3',['-m','bridge.native_profile','--profile',options.environmentProfile],{cwd:simRoot,env:{...process.env,PYTHONPATH:`${simRoot}:${resolve(simRoot,'../agent')}`},encoding:'utf8',timeout:30000});
  try{const inspected:unknown=JSON.parse(p.stdout);if(p.status!==0||!validNativeProfileReport(inspected,options.environmentProfile))throw new Error();environment=inspected as JsonObject;}catch{environment={id:options.environmentProfile,available:false,reasonCodes:['PROFILE_INVENTORY_UNREADABLE']};}
 }
 let port=options.port??null,reasons:string[]=[];
 if(environment&&environment.available!==true){reasons=Array.isArray(environment.reasonCodes)?environment.reasonCodes.map(String):['PROFILE_UNAVAILABLE'];await port?.close();port=null;}
 if(!port&&(!environment||environment.available===true)){const spawned=await spawnWorker(world,runId,options.python??'python3',options.scenarioFile,simRoot);port=spawned.port;reasons=spawned.reasons;}
 let capability:BackendCapability={backendId:'gazebo_nav2',available:false,step:false,version:GAZEBO_NAV2.version,reasons,evidence:'none',bootId:null,robots:[],...image?{image}:{},...environment?{environment}:{}};
 if(port){
  const timeoutMs=options.startupTimeoutMs??60_000,pollMs=options.startupPollMs??250;
  if(!Number.isFinite(timeoutMs)||timeoutMs<0||!Number.isFinite(pollMs)||pollMs<=0)throw new Error('STARTUP_POLICY_INVALID');
  const deadline=performance.now()+timeoutMs;
  do{
   let timer:ReturnType<typeof setTimeout>|undefined;
   try{
    // ROS health probes may exceed the normal command timeout; readiness owns this request's bounded budget.
    const c=await Promise.race([port.request('capability',{},Math.max(1,deadline-performance.now())),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('STARTUP_TIMEOUT')),Math.max(1,deadline-performance.now()));})]);
    capability={...capability,available:c.available===true,step:c.step===true,version:String(c.version??GAZEBO_NAV2.version),reasons:Array.isArray(c.reasons)?c.reasons.map(String):[],evidence:options.port?'protocol_double':String(c.evidence??'unknown'),bootId:typeof c.bootId==='string'?c.bootId:null,robots:Array.isArray(c.robots)?c.robots.map(String):[],...c.beverage&&typeof c.beverage==='object'&&!Array.isArray(c.beverage)?{beverage:structuredClone(c.beverage) as unknown as NonNullable<BackendCapability['beverage']>}:{}};
   }catch(e){capability={...capability,reasons:[`WORKER_UNAVAILABLE:${(e as Error).message}`]};break;}
   finally{if(timer)clearTimeout(timer);}
   if(capability.available||!capability.reasons.length||capability.reasons.some(r=>r!=='CLOCK_MISSING'&&!r.startsWith('NAV2_NOT_READY:'))||performance.now()>=deadline)break;
   await new Promise(r=>setTimeout(r,Math.min(pollMs,Math.max(0,deadline-performance.now()))));
  }while(performance.now()<deadline);
 }

 const namespaceOf=(robotId:string)=>world.robots.find(r=>r.entityId===robotId)?.namespace;
 const unavailable=(commandId:string|null):JsonObject=>({...commandId?{commandId}:{},status:'rejected',reason:'BACKEND_UNAVAILABLE'});
 return {
  world,runId,
  async capability(){if(port&&capability.beverage){try{const c=await port.request('capability',{});if(c.beverage&&typeof c.beverage==='object'&&!Array.isArray(c.beverage))capability.beverage=structuredClone(c.beverage) as unknown as NonNullable<BackendCapability['beverage']>;}catch{capability.beverage={available:false,reasonCodes:['TRAY_WORKER_UNREACHABLE']};}}return structuredClone(capability);},
  onEvent(listener){return port?.onEvent?.(e=>listener(e.event==='barrier'?{...e,payload:{...e.payload,participant:world.robots.find(r=>r.namespace===e.payload.participant)?.entityId??String(e.payload.participant)}}:e))??(()=>{});},
  async execute(robotId,command){
   const ns=namespaceOf(robotId);if(!ns)return {commandId:command.commandId,status:'rejected',reason:'ROBOT_UNKNOWN'};
   if(!capability.available||!port)return unavailable(command.commandId);
   const t=command.target as JsonObject;
   return port.request('execute',{commandId:command.commandId,robotId:ns,target:{waypointId:String(t.waypointId),mapId:String(t.mapId),mapRevision:String(t.mapRevision),frame:String(t.frame),x:Number(t.x),y:Number(t.y),...typeof t.yaw==='number'?{yaw:t.yaw}:{}},expiresAt:command.expiresAt,...typeof command.limits.speedLimitMps==='number'?{speedLimitMps:command.limits.speedLimitMps}:{}});
  },
  async query(robotId,commandId){const ns=namespaceOf(robotId);if(!ns||!capability.available||!port)return {commandId,status:'unknown',evidence:{reason:ns?'BACKEND_UNAVAILABLE':'ROBOT_UNKNOWN'}};return port.request('query',{commandId,robotId:ns});},
  async cancel(robotId,commandId){const ns=namespaceOf(robotId);if(!ns||!capability.available||!port)return {commandId,acknowledged:false,unknown:true};return port.request('cancel',{commandId,robotId:ns});},
  async stop(robotId,reason){const ns=namespaceOf(robotId);if(!ns||!capability.available||!port)return {robotId,acknowledged:false,physicalStopConfirmed:false};return port.request('stop',{robotId:ns,reason});},
  async pause(paused){if(!capability.available||!port)return {acknowledged:false,paused:null};return port.request('pause',{paused});},
  async barrier(barrierId,participants,proof):Promise<JsonObject>{if(!capability.available||!port)return {barrierId,acks:[]};const ns=participants.map(namespaceOf);if(ns.some(n=>!n))return {barrierId,acks:[],reason:'ROBOT_UNKNOWN'};const reply=await port.request('barrier',{barrierId,participants:ns as string[],...proof});return {...reply,acks:Array.isArray(reply.acks)?(reply.acks as JsonObject[]).map(a=>({...a,participant:world.robots.find(r=>r.namespace===a.participant)?.entityId??String(a.participant)})):[]};},
  async bindTransfer(identity){const ns=namespaceOf(identity.robotId);if(!ns||!capability.available||!port)throw new Error('TRAY_BACKEND_UNAVAILABLE');return port.request('bind_transfer',{...identity,runId,robotId:ns});},
  async setBlocker(enabled){if(!port||!capability.available)throw new Error('BACKEND_UNAVAILABLE');return port.request('native_blocker',{enabled});},
  async setCupPose(effect){if(!capability.available||!port||!effect.positionM.every(Number.isFinite))throw new Error('CUP_WORLD_EFFECT_UNAVAILABLE');return port.request('cup_pose',{runId,worldRevision:effect.worldRevision,fixtureId:effect.fixtureId,xM:effect.positionM[0],yM:effect.positionM[1],zM:effect.positionM[2]});},
  async close(){await port?.close();},
 };
}
