// Dev-only SIL rig: the real source domain/journal/dispatcher with the simulated navigation adapter over a worker PROTOCOL DOUBLE.
// The double keeps a durable command table shared across "worker restarts" (like a Nav2 action server outliving the bridge), counts physical
// sends and can lose the reply after a send. Evidence label `protocol_double`: never Gazebo/Nav2 physics.
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {JsonObject} from '../../packages/contracts/src/index';
import {dispatchRobotEffects,robotEventCommand} from '../../packages/robot-adapters/src/dispatch';
import type {RobotEvent,RobotManifest} from '../../packages/robot-adapters/src/contract';
import {SourceSession,mealFor} from '../../packages/lab-runtime/src/v2/session';
import {GAZEBO_NAV2,startGazeboBackend,type CompiledWorld,type GazeboBackend,type WorkerPort,type WorkerRequest} from '../../packages/lab-runtime/src/v2/backends/gazebo-nav2';
import {SimulatedNavigationAdapter} from '../../packages/lab-runtime/src/v2/backends/simulated-navigation';
import {restaurant,corridor} from './lab-v2';
export type NativeResult='accepted'|'completed'|'canceled'|'result_missing'|'aborted'|'covariance_high';
/** Durable command table of the fake action server: outlives a FakeWorkerPort (worker restart). */
export interface DurableCommands {table:Map<string,JsonObject>;sends:number}
/** What a scripted "worker" shows per poll: contact-sensor liveness per robot, ground-truth telemetry, footprint separation, contacts. */
export interface FakeScene {robots:{entityId:string;namespace:string}[];liveness:boolean;gapM?:number;contacts?:JsonObject[];telemetry?:boolean}
export class FakeWorkerPort implements WorkerPort {
 queryCalls=0;unreachable=false;loseReply=false;closed=0;cancelled:string[]=[];runId='run-unknown';barriers:JsonObject[]=[];
 private listeners=new Set<(e:{event:string;payload:JsonObject})=>void>();private tick=0;private seq=new Map<string,number>();
 constructor(private o:{nativeResult:NativeResult;capability?:Partial<{available:boolean;evidence:string;reasons:string[]}>;scene?:FakeScene},readonly durable:DurableCommands={table:new Map(),sends:0},readonly bootId='fake-boot-1'){}
 get commands(){return this.durable.table;}
 get executeCalls(){return this.durable.sends;}
 onEvent(listener:(e:{event:string;payload:JsonObject})=>void){this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};}
 emit(event:string,payload:JsonObject){for(const l of this.listeners)l({event,payload});}
 /** One "world tick" of scripted evidence, as the real scene loop would emit it. */
 private scene(){
  const s=this.o.scene;if(!s)return;
  const tick=++this.tick,simTimeNs=String(tick*20_000_000);
  for(const r of s.robots){
   if(s.liveness)this.emit('contact-sensor',{robot:r.entityId,tick,simTimeNs,alive:true,contacts:0});
   if(s.telemetry!==false){const n=(this.seq.get(r.entityId)??0)+1;this.seq.set(r.entityId,n);
    this.emit('telemetry',{schemaVersion:2,runId:this.runId,entityId:r.entityId,providerId:'gazebo_nav2',bootId:this.bootId,seq:String(n),simTimeNs,observedAt:null,receivedMonotonicNs:'0',frameId:'map',origin:'physics_sim',quality:'valid',reasonCodes:[],commanded:null,observed:{xM:1+tick*0.01,yM:1,yawRad:0},estimated:null,causationId:null});}
  }
  if(s.gapM!==undefined&&s.robots.length>1)this.emit('separation',{tick,simTimeNs,a:s.robots[0]!.entityId,b:s.robots[1]!.entityId,gapM:s.gapM,centreM:s.gapM+0.6,provenance:'physics_sim'});
  for(const c of s.contacts??[])this.emit('contact',{...c,tick,simTimeNs,provenance:'physics_sim'});
  s.contacts=[];
 }
 async request(op:WorkerRequest['op'],args:JsonObject):Promise<JsonObject>{
  if(this.unreachable)throw new Error('WORKER_TIMEOUT');
  if(op==='capability')return {backendId:'gazebo_nav2',available:true,step:false,version:'protocol-double',reasons:[],evidence:'protocol_double',bootId:this.bootId,robots:(this.o.scene?.robots??[{namespace:'robot_amr_1'}]).map(r=>r.namespace),...this.o.capability};
  if(op==='barrier'){const simTimeNs=this.o.scene?String(this.tick*20_000_000):null;const r={barrierId:args.barrierId,acks:(args.participants as string[]).map(participant=>({participant,simTimeNs,clockNs:String(process.hrtime.bigint())}))};this.barriers.push(r);return r;}
  if(op==='execute'){
   const id=String(args.commandId),old=this.commands.get(id);if(old)return old;
   this.durable.sends++;
   const answer:JsonObject=this.o.nativeResult==='covariance_high'?{commandId:id,status:'rejected',reason:'COVARIANCE_TOO_LARGE'}:{commandId:id,status:'accepted',nativeGoalId:`goal-${id}`};
   this.commands.set(id,answer);
   if(this.loseReply){this.loseReply=false;throw new Error('WORKER_TIMEOUT');} // the goal was sent; only the reply is lost
   return answer;
  }
  if(op==='query'){
   this.queryCalls++;this.scene();const id=String(args.commandId),sent=this.commands.get(id);
   if(!sent||sent.status!=='accepted')return {commandId:id,status:'unknown',evidence:{reason:'NOT_JOURNALED'}};
   const r=this.o.nativeResult,ev=(nav2Status:string,reason:string|null,errorCode:number|null)=>({goalUuid:sent.nativeGoalId,nav2Status,reason,errorCode});
   if(this.cancelled.includes(id))return {commandId:id,status:'cancelled',evidence:ev('CANCELED',null,0)};
   return r==='completed'?{commandId:id,status:'completed',evidence:ev('SUCCEEDED',null,0)}:r==='canceled'?{commandId:id,status:'cancelled',evidence:ev('CANCELED',null,0)}
    :r==='result_missing'?{commandId:id,status:'unknown',evidence:ev('SUCCEEDED','RESULT_UNAVAILABLE',null)}:r==='aborted'?{commandId:id,status:'failed',evidence:ev('ABORTED','NAV2_ABORTED',0)}:{commandId:id,status:'executing',evidence:ev('EXECUTING',null,null)};
  }
  if(op==='cancel'){this.cancelled.push(String(args.commandId));return {commandId:String(args.commandId),acknowledged:true,unknown:false};}
  if(op==='stop')return {robotId:String(args.robotId),acknowledged:true,physicalStopConfirmed:false};
  if(op==='pause')return {acknowledged:true,paused:args.paused};
  if(op==='close'){this.closed++;return {closed:true};}
  throw new Error('OP_NOT_ALLOWED');
 }
 async close(){this.closed++;}
}
export const compiledWorld=(directory:string,robots:{entityId:string;namespace:string}[]=[{entityId:'amr-1',namespace:'robot_amr_1'}]):CompiledWorld=>({bindings:Object.fromEntries(((robots.length>1?corridor():restaurant()).world.points as {id:string;x:number;y:number}[]).map(p=>[p.id,{waypointId:p.id,mapId:'lab-world',mapRevision:'1',frame:'map' as const,x:p.x,y:p.y,yaw:0}])),inputHash:'a'.repeat(64),manifestHash:'b'.repeat(64),outputDirectory:directory,worldFile:'world.sdf',mapIdentityFile:'map.identity.json',sceneIndexFile:'scene-index.json',mapId:'lab-world',mapRevision:'1',robots});
export const manifestFor=(id='amr-1'):RobotManifest=>({id,adapter:'simulator',protocolVersion:'1',firmware:`${GAZEBO_NAV2.id}@${GAZEBO_NAV2.version}`,capabilities:['delivery'],mapId:'lab-world',mapRevision:'1',offlineExecution:true,maxLoadMinor:'10000',trays:3,validation:'simulated'});
const dirs:string[]=[];
export async function cleanupSil(){for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});}
export async function makeSilRig(o:{nativeResult:NativeResult}){
 const dir=await mkdtemp(join(tmpdir(),'lab-v2-sil-'));dirs.push(dir);await mkdir(join(dir,'run'));
 let t=Date.parse('2026-11-05T08:00:00Z');const nowMs=()=>t;
 const project=restaurant() as unknown as Parameters<typeof SourceSession.open>[3]['project'];
 const source=await SourceSession.open(join(dir,'run'),'run-1',nowMs,{project,robots:[{id:'amr-1',parkingId:'bay-1',trays:3}],stationIds:['pass']},true);
 let port=new FakeWorkerPort(o),backend:GazeboBackend=await startGazeboBackend(compiledWorld(dir),'run-1',{port}),adapter=new SimulatedNavigationAdapter(backend,manifestFor(),nowMs);
 const events:RobotEvent[]=[];let unsubscribe=adapter.observe(e=>events.push(e));
 let op=0;const submit=(type:string,payload:JsonObject,robotId?:string)=>source.submit(type,payload,`op-${++op}`,robotId);
 const must=async(type:string,payload:JsonObject)=>{const r=await submit(type,payload);if(r.status!=='accepted')throw new Error(`${type}:${r.code}`);return r;};
 const drain=async()=>{const out:string[]=[];while(events.length){const e=events.shift()!;const r=await submit('Robot.Observe',robotEventCommand(e),'amr-1');out.push(r.status==='accepted'?e.type:`rejected:${r.code}`);}return out;};
 const dispatch=async()=>{await dispatchRobotEffects(source.store,source.scope,adapter,nowMs());t+=1000;return drain();};
 const rig={source,events,lineId:'',submit,must,drain,dispatch,nowMs,advance(ms:number){t+=ms;},
  get port(){return port;},get backend(){return backend;},get adapter(){return adapter;},
  async startDelivery(){
   await must('Session.Open',{sessionId:'s-1',tableId:'t-north'});
   const placed=await must('Order.Place',{sessionId:'s-1',tableId:'t-north',menuVersion:1,items:[{itemId:mealFor('pass'),quantity:'1'}]});
   rig.lineId=(placed.value.lineIds as string[])[0]!;
   await must('Kitchen.Ready',{lineId:rig.lineId,quantity:'1',stationId:'pass',expectedVersion:(await source.read('fulfillment',rig.lineId)).version});
   const a=await must('Fulfillment.Allocate',{lineId:rig.lineId,quantity:'1',expectedVersion:(await source.read('fulfillment',rig.lineId)).version,method:'robot'});
   await must('Mission.Create',{allocationIds:[String(a.value.allocationId)]});
   return dispatch();
  },
  async poll(){await adapter.poll();t+=1000;return drain();},
  async fulfillmentServed(){return String((await source.read('fulfillment',rig.lineId)).state.served);},
  async mission(){const r=await source.read('robot','amr-1');return (await source.read('mission',String(r.state.missionId))).state;},
  async missionSnapshot(){const r=await source.read('robot','amr-1');return source.read('mission',String(r.state.missionId));},
  async observeAsBrowser(){const m=await rig.mission();const r=await submit('Robot.Observe',robotEventCommand({type:'completed',id:'browser-1',commandId:String(m.commandId),bootId:'browser',sequence:'1',observedAt:new Date(nowMs()).toISOString(),payload:{robotId:'amr-1',missionId:String(m.missionId??''),missionRevision:1,controlEpoch:1}}),'browser');if(r.status!=='accepted')throw new Error(String(r.code));return r;},
  async robotExecuteAttempts(){return (await source.effects()).filter(e=>e.type==='robot.execute').reduce((n,e)=>n+Number(e.attempts),0);},
  async journalTypes(){return (await source.journal()).flatMap(j=>(j.payload.events as {type:string}[]).map(e=>e.type));},
  async reservationStatus(){return String((await source.store.snapshots(source.scope)).find(s=>s.ref.kind==='reservation'&&s.state.robotId==='amr-1')?.state.status);},
  async allocationStatus(){return (await source.store.snapshots(source.scope)).filter(s=>s.ref.kind==='allocation').map(s=>String(s.state.status));},
  /** The worker process dies and comes back over the same durable action-server table: a new boot, a fresh adapter, no in-memory goals. */
  async restartWorker(){
   unsubscribe();await backend.close();
   port=new FakeWorkerPort(o,port.durable,`fake-boot-${Math.random().toString(16).slice(2,8)}`);
   backend=await startGazeboBackend(compiledWorld(dir),'run-1',{port});adapter=new SimulatedNavigationAdapter(backend,manifestFor(),nowMs);
   unsubscribe=adapter.observe(e=>events.push(e));
  },
  async close(){await backend.close();await source.close();}};
 return rig;
}
