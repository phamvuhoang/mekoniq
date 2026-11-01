import {mkdir,readFile,writeFile,rename,chmod,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createPrivateKey,createPublicKey,generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {hashPayload,type CommandEnvelope,type JsonObject,type Scope,type Snapshot,type DomainEvent} from '../../contracts/src/index';
import {createProductionRegistry,authorizeVenueCommand,requiredPermissions} from '../../domain/src/application';
import {openStore,type DurableStore} from '../../sync/src/store';
import {processCommand} from '../../sync/src/command-processor';
import {SimulatorAdapter} from '../../robot-adapters/src/simulator';
import {dispatchRobotEffects,robotEventCommand} from '../../robot-adapters/src/dispatch';
import type {RobotEvent} from '../../robot-adapters/src/contract';
import {initializeFixture} from './fixture';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import projectSchema from '../../contracts/schemas/lab-project.schema.json';
const ajv=new Ajv({allErrors:true,strict:true});addFormats(ajv);const projectValidator=ajv.compile(projectSchema);
import type {LabProject,RunSnapshot,RunAction} from './types';
export type {LabProject,RunSnapshot,RunAction} from './types';
const EPOCH=Date.parse('2026-11-01T00:00:00Z');
const allowed=new Set(['Session.Open','Order.Place','Kitchen.Ready','Fulfillment.Allocate','Mission.Create','Mission.ConfirmStop','Mission.Cancel','Robot.Observe','Robot.RequestStop']);
interface Checkpoint {id:string;project:LabProject;sourceCommit:string;scenarioId:string;seed:number;nowMs:number;revision:number;started:boolean;missionId?:string;parkingMissionId?:string;lineId?:string;attentionReason?:string;cancelled?:boolean;inFlight?:boolean;receipts:Record<string,{hash:string;snapshot:RunSnapshot}>;faults:string[];}
export interface SessionOptions {directory:string;project:unknown;sourceCommit:string;scenarioId:string;seed:number;mode?:string;}
export function validateProject(value:unknown):asserts value is LabProject {
 if(!projectValidator(value))throw new Error('INVALID_PROJECT');
 const p=value as unknown as LabProject;
 if(!p||p.schemaVersion!==1||typeof p.id!=='string'||!p.id||p.id.length>100||typeof p.name!=='string'||!Number.isInteger(p.revision)||p.revision<1||!p.design||!p.world)throw new Error('INVALID_PROJECT');
 const d=p.design,w=p.world;
 if(!['service','valetudo'].includes(d.chassis)||!['lidar','depth'].includes(d.sensor)||!Number.isInteger(d.trays)||d.trays<1||d.trays>10||![d.batteryAh,d.payloadKg].every(n=>Number.isFinite(n)&&n>=0&&n<=1000)||!Number.isInteger(w.revision)||w.revision<1||![w.width,w.height].every(n=>Number.isFinite(n)&&n>0&&n<=1000)||!Array.isArray(w.points)||!Array.isArray(w.obstacles)||w.points.length+w.obstacles.length>200)throw new Error('INVALID_PROJECT');
 const ids=new Set<string>();
 for(const point of w.points){if(!point||typeof point.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(point.id)||ids.has(point.id)||!['table','kitchen','parking','dock'].includes(point.kind)||![point.x,point.y].every(Number.isFinite)||point.x<0||point.y<0||point.x>w.width||point.y>w.height)throw new Error('INVALID_PROJECT');ids.add(point.id);}
 if(!w.points.some(p=>p.id==='kitchen'&&p.kind==='kitchen')||!w.points.some(p=>p.id==='parking'&&p.kind==='parking')||!w.points.some(p=>p.id==='table-1'&&p.kind==='table'))throw new Error('INVALID_PROJECT');
 for(const o of w.obstacles)if(!o||typeof o.id!=='string'||![o.x,o.y,o.width,o.height].every(Number.isFinite)||o.x<0||o.y<0||o.width<=0||o.height<=0||o.x+o.width>w.width||o.y+o.height>w.height)throw new Error('INVALID_PROJECT');
}
export class LabSession {
 readonly scope:Scope;
 private readonly registry=createProductionRegistry();
 private adapter!:SimulatorAdapter;
 private observations:RobotEvent[]=[];
 private readonly adapterBootId=randomUUID();
 private store!:DurableStore;
 private queue:Promise<unknown>=Promise.resolve();
 private closed=false;
 private constructor(readonly directory:string,private checkpoint:Checkpoint){this.scope={organizationId:`lab-${checkpoint.id}`,venueId:'simulation'};}
 static async open(options:SessionOptions){
  validateProject(options.project);
  if(options.mode&&options.mode!=='business_sim')throw new Error('BACKEND_UNAVAILABLE');
  if(options.scenarioId!=='S01')throw new Error('SCENARIO_UNSUPPORTED');
  if(!Number.isSafeInteger(options.seed)||options.seed<0||options.seed>0xffffffff)throw new Error('INVALID_SEED');
  await mkdir(options.directory,{recursive:true,mode:0o700});await chmod(options.directory,0o700);
  let checkpoint:Checkpoint|undefined;
  try{checkpoint=JSON.parse(await readFile(join(options.directory,'run.json'),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  if(checkpoint&&(checkpoint.sourceCommit!==options.sourceCommit||hashPayload(checkpoint.project as unknown as JsonObject)!==hashPayload(options.project as unknown as JsonObject)||checkpoint.seed!==options.seed||checkpoint.scenarioId!==options.scenarioId))throw new Error('RUN_IDENTITY_MISMATCH');
  const fresh=!checkpoint;
  if(fresh&&(await readdir(options.directory)).length)throw new Error('RECOVERY_CHECKPOINT_MISSING');
  checkpoint??={id:randomUUID(),project:structuredClone(options.project),sourceCommit:options.sourceCommit,scenarioId:options.scenarioId,seed:options.seed,nowMs:EPOCH,revision:0,started:false,receipts:{},faults:[]};
  const s=new LabSession(options.directory,checkpoint);
  let privateJwk;
  try{privateJwk=JSON.parse(await readFile(join(options.directory,'signing-key.json'),'utf8'));}catch(e){if(!fresh||(e as NodeJS.ErrnoException).code!=='ENOENT')throw e;privateJwk=generateKeyPairSync('ec',{namedCurve:'P-256'}).privateKey.export({format:'jwk'});await writeFile(join(options.directory,'signing-key.json'),JSON.stringify(privateJwk),{mode:0o600,flag:'wx'});}
  const privateKey=createPrivateKey({key:privateJwk,format:'jwk'}),publicJwk=createPublicKey(privateKey).export({format:'jwk'}) as JsonObject;
  s.store=await openStore({driver:'sqlite',url:join(options.directory,'journal.db'),nowMs:()=>checkpoint!.nowMs,authority:{ownerDeviceId:'lab-coordinator',deviceEpoch:'lab-epoch-1',publicJwk},ackLevel:'venue',producer:{deviceId:'lab-coordinator',deviceEpoch:'lab-epoch-1'},signerPublicJwk:publicJwk,signer:bytes=>sign('sha256',bytes,{key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url')});
  await s.store.provision(s.scope,1,1);
  if(fresh)await initializeFixture(s.store,s.scope,checkpoint.project,publicJwk);
  s.adapter=new SimulatorAdapter({id:'sim-1',adapter:'simulator',protocolVersion:'1',firmware:'lab-business-sim-v1',capabilities:['delivery'],mapId:'lab-world',mapRevision:String(checkpoint.project.world.revision),offlineExecution:true,maxLoadMinor:String(Math.round(checkpoint.project.design.payloadKg*1000)),trays:checkpoint.project.design.trays,validation:'simulated'},checkpoint.nowMs);
  s.adapter.observe(event=>s.observations.push({...event,id:`${s.adapterBootId}-${event.id}`,bootId:`${s.adapterBootId}-${event.bootId}`}));
  for(const fault of checkpoint.faults)if(['offline','online','blocked','clear'].includes(fault))s.adapter.fault(fault as 'offline'|'online'|'blocked'|'clear');
  if(!fresh){
   // SQLite can commit before the harness checkpoint. Discover its active resource first.
   const robot=await s.read('robot','sim-1');
   if(typeof robot.state.missionId==='string'){
    const known=checkpoint.missionId?await s.read('mission',checkpoint.missionId):undefined;
    if(known?.state.status==='completed'&&known.ref.id!==robot.state.missionId)checkpoint.parkingMissionId=robot.state.missionId;
    else if(!checkpoint.parkingMissionId)checkpoint.missionId=robot.state.missionId;
    checkpoint.started=true;
   }
   if(!checkpoint.lineId){const snapshots=await s.store.snapshots(s.scope);checkpoint.lineId=snapshots.find(row=>row.ref.kind==='fulfillment')?.ref.id;}
   // A process-local adapter cannot recover native goals. Never reconstruct or resend movement.
   const mission=await s.activeMission();
   const stop=mission?.state.stops as JsonObject[]|undefined;
   if(checkpoint.inFlight||mission&& !['completed','cancelled'].includes(String(mission.state.status))&&stop?.some(st=>st.status==='travelling')){
    checkpoint.attentionReason='RECOVERY_UNKNOWN';checkpoint.revision++;
    await s.markUnknown();
   }
  }
  await s.persist();return s;
 }
 private async persist(){const path=join(this.directory,'run.json');await writeFile(path+'.tmp',JSON.stringify(this.checkpoint),{mode:0o600});await rename(path+'.tmp',path);}
 private async command(type:string,payload:JsonObject,operationId:string= randomUUID()){
  if(!allowed.has(type))throw new Error('COMMAND_NOT_ALLOWED');
  const at=new Date(this.checkpoint.nowMs).toISOString();
  const c:CommandEnvelope={schemaVersion:1,...this.scope,type,operationId,actorRef:'lab-scenario',deviceId:'lab-coordinator',deviceEpoch:'lab-epoch-1',coordinatorEpoch:1,policyRevision:1,occurredAt:at,recordedAt:at,payload,payloadHash:hashPayload(payload),...(typeof payload.expectedVersion==='number'?{expectedVersion:payload.expectedVersion}:{})};
  const principal={id:'lab-scenario',deviceId:'lab-coordinator',scope:this.scope,permissions:[...new Set([...allowed].flatMap(t=>requiredPermissions(t,{})))],expiresAtMs:this.checkpoint.nowMs+60000,stationIds:['kitchen']};
  const result=await processCommand(this.store,c,(command,snapshots)=>this.registry.decide(command,snapshots),async command=>authorizeVenueCommand(principal,command,this.checkpoint.nowMs));
  if(result.status!=='accepted')throw new Error(`SOURCE_${result.code??result.status}`);
  return result;
 }
 private async read(kind:string,id:string){return this.store.readSnapshot({...this.scope,kind,id});}
 private async activeMission(){const id=this.checkpoint.parkingMissionId??this.checkpoint.missionId;return id?this.read('mission',id):undefined;}
 private async observe(){while(this.observations.length){const e=this.observations.shift()!;await this.command('Robot.Observe',robotEventCommand(e),e.id);}}
 private async dispatch(){await dispatchRobotEffects(this.store,this.scope,this.adapter,this.checkpoint.nowMs);await this.observe();const uncertain=(await this.store.effects(this.scope)).some(e=>e.status==='unknown');if(uncertain){this.checkpoint.attentionReason='EXECUTION_UNKNOWN';await this.markUnknown();}}
 private async markUnknown(){const m=await this.activeMission();if(!m||['completed','cancelled','needs_attention'].includes(String(m.state.status)))return;const command=await this.read('robot-command',String(m.state.commandId));await this.command('Robot.Observe',{robotId:'sim-1',missionId:m.ref.id,commandId:m.state.commandId!,missionRevision:command.state.missionRevision!,controlEpoch:1,type:'unknown',eventId:`recovery-${this.checkpoint.revision}`,bootId:'lab-recovery',sequence:String(this.checkpoint.revision)},`recovery-${this.checkpoint.revision}`);}
 async snapshot():Promise<RunSnapshot>{await this.queue;return this.buildSnapshot();}
 private async buildSnapshot():Promise<RunSnapshot>{
  const c=this.checkpoint,m=await this.activeMission(),robot=await this.read('robot','sim-1');
  const stops=m?.state.stops as JsonObject[]|undefined,stop=stops?.find(s=>s.id===m!.state.currentStopId),bindings=robot.state.bindings as JsonObject;
  const position=bindings[String(robot.state.position??'parking')] as {x:number;y:number}|undefined;
  const target=stop?bindings[String(stop.targetId)] as {x:number;y:number}:undefined;
  const fulfillment=c.lineId?await this.read('fulfillment',c.lineId):undefined;
  let stage:RunSnapshot['stage']='idle',status:RunSnapshot['status']='ready';
  if(c.started){status='running';stage=c.parkingMissionId?'to_parking':stop?.action==='load'?'to_kitchen':'to_table';if(stop?.status==='awaiting_action'&&!c.parkingMissionId){stage=stop.action==='load'?'load':'handoff';status=stop.action==='load'?'awaiting_load':'awaiting_handoff';}if(c.parkingMissionId&&m?.state.status==='completed'){status='completed';stage='finished';}}
  if(c.cancelled||m?.state.status==='cancelled'){status='cancelled';stage='finished';}
  if(c.attentionReason||m?.state.status==='needs_attention')status='needs_attention';
  const journal=await this.store.journal(this.scope);
  const events=journal.flatMap(entry=>(entry.payload.events as unknown as DomainEvent[]).map(e=>({type:e.type,at:entry.recordedAt,...e.data})));
  return {id:c.id,mode:'business_sim',status,stage,revision:c.revision,robotPosition:position?{x:position.x,y:position.y}:{x:1,y:1},target:target?{x:target.x,y:target.y}:null,served:String(fulfillment?.state.served??'0'),loaded:Boolean(m?.state.loaded),events,elapsedMs:c.nowMs-EPOCH,sourceCommit:c.sourceCommit,scenarioId:c.scenarioId,seed:c.seed,...(c.attentionReason?{attentionReason:c.attentionReason}:{})};
 }
 action(action:RunAction):Promise<RunSnapshot>{const promise=this.queue.then(()=>this.execute(action));this.queue=promise.catch(()=>{});return promise;}
 private async execute(a:RunAction){
  if(this.closed)throw new Error('RUN_CLOSED');
  if(!a||typeof a.actionId!=='string'||!/^[\w-]{1,100}$/.test(a.actionId)||!Number.isSafeInteger(a.expectedRevision)||!['start','step','confirm','cancel','injectFault'].includes(a.kind))throw new Error('INVALID_ACTION');
  const p=a.payload??{};if(!p||typeof p!=='object'||Array.isArray(p))throw new Error('INVALID_ACTION');
  if(a.kind==='step'&&(!Number.isInteger(p.ms)||Number(p.ms)<0||Number(p.ms)>60000))throw new Error('INVALID_STEP');
  if(a.kind==='injectFault'&&!['blocked','clear','offline','online','reboot','duplicate-completed'].includes(String(p.fault)))throw new Error('INVALID_FAULT');
  const hash=hashPayload(a as unknown as JsonObject),old=this.checkpoint.receipts[a.actionId];
  if(old){if(hash!==old.hash)throw new Error('ACTION_CONFLICT');return structuredClone(old.snapshot);}
  if(Object.keys(this.checkpoint.receipts).length>=1000)throw new Error('ACTION_LIMIT');
  if(a.expectedRevision!==this.checkpoint.revision)throw new Error('REVISION_CONFLICT');
  const before=await this.buildSnapshot();
  if(a.kind==='start'&&this.checkpoint.started||a.kind==='confirm'&&!['awaiting_load','awaiting_handoff'].includes(before.status)||a.kind==='cancel'&&['completed','cancelled'].includes(before.status))throw new Error('INVALID_STATE');
  if(this.checkpoint.attentionReason&&a.kind!=='step')throw new Error('RECONCILIATION_REQUIRED');
  this.checkpoint.inFlight=true;await this.persist();
  try{
   if(a.kind==='start')await this.start();
   else if(a.kind==='step'&&!this.checkpoint.attentionReason){this.checkpoint.nowMs+=Number(p.ms);await this.dispatch();this.adapter.advance(Number(p.ms));await this.observe();const m=await this.activeMission();if(this.checkpoint.parkingMissionId&&m?.state.status==='executing'&&(m.state.stops as JsonObject[]).some(s=>s.status==='awaiting_action'))await this.confirmMission(m);}
   else if(a.kind==='confirm'){const m=await this.activeMission();await this.confirmMission(m!);if(!this.checkpoint.parkingMissionId&&(await this.activeMission())?.state.status==='completed'){const created=await this.command('Mission.Create',{robotId:'sim-1',stops:[{action:'standby',targetId:'parking'}]});this.checkpoint.parkingMissionId=String(created.value.missionId);}await this.dispatch();}
   else if(a.kind==='injectFault'){this.adapter.fault(p.fault as Parameters<SimulatorAdapter['fault']>[0]);this.checkpoint.faults.push(String(p.fault));if(p.fault==='reboot'){this.checkpoint.attentionReason='REBOOT_UNKNOWN';await this.markUnknown();}await this.observe();}
   else if(a.kind==='cancel'){const m=await this.activeMission();if(!m)this.checkpoint.cancelled=true;else{await this.command('Mission.Cancel',{missionId:m.ref.id,expectedVersion:m.version});await this.dispatch();const after=await this.activeMission();if(after?.state.status==='cancelled')this.checkpoint.cancelled=true;else{this.checkpoint.attentionReason='CANCELLATION_REQUIRES_RECONCILIATION';await this.markUnknown();}}}
   this.checkpoint.revision++;delete this.checkpoint.inFlight;
   const snapshot=await this.buildSnapshot();this.checkpoint.receipts[a.actionId]={hash,snapshot};await this.persist();return snapshot;
  }catch(e){this.checkpoint.attentionReason='ACTION_INTERRUPTED';this.checkpoint.revision++;await this.persist();throw e;}
 }
 private async start(){
  const c=this.checkpoint;await this.command('Session.Open',{sessionId:'lab-session',tableId:'table-1'});
  const placed=await this.command('Order.Place',{sessionId:'lab-session',tableId:'table-1',menuVersion:1,items:[{itemId:'lab-meal',quantity:'1'}]});
  c.lineId=(placed.value.lineIds as string[])[0]!;
  await this.command('Kitchen.Ready',{lineId:c.lineId,quantity:'1',stationId:'kitchen',expectedVersion:1});
  const allocation=await this.command('Fulfillment.Allocate',{lineId:c.lineId,quantity:'1',expectedVersion:2,method:'robot'});
  const mission=await this.command('Mission.Create',{allocationIds:[allocation.value.allocationId!],robotId:'sim-1'});c.missionId=String(mission.value.missionId);c.started=true;await this.dispatch();
 }
 private async confirmMission(m:Snapshot){return this.command('Mission.ConfirmStop',{missionId:m.ref.id,expectedVersion:m.version,missionRevision:m.state.revision!,stopId:m.state.currentStopId!});}
 async report(){await this.queue;return {schemaVersion:1,mode:'business_sim',snapshot:await this.buildSnapshot(),project:structuredClone(this.checkpoint.project),sourceCommit:this.checkpoint.sourceCommit,events:await this.store.events(this.scope),journal:await this.store.journal(this.scope),effects:await this.store.effects(this.scope),faults:[...this.checkpoint.faults],coverage:{businessSimulation:true,nativeExecution:false,physicalStop:false,collisionAvoidance:false,sse:false},limitations:['Synthetic observations are software evidence only.','Blocked fault holds movement; no path planner or collision proof.','Gateway polling snapshots; SSE event stream is not implemented.','Adapter goals do not survive process restart; active travel remains unknown without resend.']};}
 async close(){await this.queue;if(!this.closed){this.closed=true;await this.store.close();}}
}
export const createLabSession=(options:SessionOptions)=>LabSession.open(options);
