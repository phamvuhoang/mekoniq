// LinuxCNC arm adapter (plan 03 A05): the Lab's only path to the controller is the bridge arbiter over its local socket, as arm.command.v1
// with the lab_simulation lease. Capabilities are the allowlisted cell capabilities (programs by id + sha256); jog/MDI/HAL/endpoints do not
// exist here. Accepted is never completed: completion is the bridge's command_completed event. A lost reply is unknown and is never resent;
// a controller restart drops the lease and turns in-flight jobs unknown. Without a reachable bridge the backend is unavailable, never a mock.
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {ARM_PROGRAMS} from '../../../../domain/src/beverage/transfer';
import {readFileSync} from 'node:fs';
import {createConnection,type Socket} from 'node:net';
import {hashJson} from '../hash';
import {validateArmCommand,validateArmObservation,type ArmCommand,type ArmObservation,type CellCommand,type CellObservation} from '../contracts';
import type {CellAcceptance,CellAdapter,CellExecutionState,CellManifest,CellReport,TransferEvidence} from '../../../../cell-adapters/src/contract';
import type {JsonObject} from '../../../../contracts/src/index';
export const LINUXCNC_SIM={id:'linuxcnc_sim',version:'1',model:'puma560-reference',dynamics:false} as const;
export const ARM_CAPABILITIES=['stage_program','start_job','pause_job','resume_job','cancel_job','query_outcome'] as const;
export interface ArmProfile {machineId:string;backend:'linuxcnc_sim';mode:'simulation';model:{id:string;revision:number;manifestSha256:string};lease:{ttlMs:number;renewBeforeMs:number};channel:{socketPath:string};
 programs:Record<string,{path:string;sha256:string}>;telemetry:{staleMs:number;deviceStatusStaleMs:number;rateHz:number};[k:string]:unknown}
export const loadArmProfile=(path:string):ArmProfile=>JSON.parse(readFileSync(path,'utf8')) as ArmProfile;
export type SimSceneUpdate=NonNullable<ArmCommand['simScene']>;
export type ArmReply=Extract<ArmObservation,{kind:'arm.reply.v1'}>;
export type ArmStatus=Extract<ArmObservation,{kind:'arm.status.v1'}>;
export type ArmEvent=Extract<ArmObservation,{kind:'arm.event.v1'}>;
export interface ArmBridgePort {send(message:ArmCommand):Promise<ArmObservation>;onMessage(listener:(m:ArmObservation)=>void):()=>void;close():Promise<void>}
/** Newline-delimited JSON over the bridge's Unix socket; a reply is matched to its request by requestId (a late reply never answers the next request), status/events fan out to listeners. */
export class SocketBridgePort implements ArmBridgePort {
 private listeners=new Set<(m:ArmObservation)=>void>();private waiting=new Map<string,{resolve(m:ArmObservation):void;reject(e:Error):void}>();private buffer='';
 constructor(private socket:Socket,private timeoutMs=5000){
  socket.setEncoding('utf8');
  socket.on('data',(chunk:string)=>{this.buffer+=chunk;let i;while((i=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,i);this.buffer=this.buffer.slice(i+1);if(!line.trim())continue;let m:ArmObservation;try{m=JSON.parse(line);}catch{continue;}
   if(!validateArmObservation(m).ok)continue;
   if(m.kind==='arm.reply.v1'){const id=m.requestId??'';const w=this.waiting.get(id);if(w){this.waiting.delete(id);w.resolve(m);}}      // an unmatched (late) reply is dropped, never misrouted
   else for(const l of this.listeners)l(m);}});
  socket.on('close',()=>{for(const w of this.waiting.values())w.reject(new Error('BRIDGE_CLOSED'));this.waiting.clear();});
  socket.on('error',()=>{/* surfaced through close */});
 }
 onMessage(l:(m:ArmObservation)=>void){this.listeners.add(l);return ()=>{this.listeners.delete(l);};}
 send(m:ArmCommand){const id=m.requestId??`req-${randomUUID()}`;const msg={...m,requestId:id};return new Promise<ArmObservation>((resolve,reject)=>{
  const timer=setTimeout(()=>{this.waiting.delete(id);reject(new Error('BRIDGE_TIMEOUT'));},this.timeoutMs);
  this.waiting.set(id,{resolve:(x:ArmObservation)=>{clearTimeout(timer);resolve(x);},reject:(e:Error)=>{clearTimeout(timer);reject(e);}});this.socket.write(JSON.stringify(msg)+'\n');});}
 async close(){this.socket.end();this.socket.destroy();}
}
export function connectBridge(socketPath:string,timeoutMs=2000):Promise<SocketBridgePort>{
 return new Promise((resolve,reject)=>{const s=createConnection(socketPath);const timer=setTimeout(()=>{s.destroy();reject(new Error('BRIDGE_UNREACHABLE:TIMEOUT'));},timeoutMs);
  s.once('connect',()=>{clearTimeout(timer);resolve(new SocketBridgePort(s,timeoutMs));});s.once('error',(e:NodeJS.ErrnoException)=>{clearTimeout(timer);reject(new Error(`BRIDGE_UNREACHABLE:${e.code??e.message}`));});});
}
export interface ArmBackendCapability {backendId:'linuxcnc_sim';available:boolean;evidence:'controller_sim'|'none';reasons:string[];machineId?:string;controllerEpoch?:number;bootId?:string;port?:ArmBridgePort}
/** Reachability + the first status frame of the bridge (which only runs with a live LinuxCNC module): controller_sim evidence or an explicit reason. */
export async function connectArmBackend(o:{socketPath:string;timeoutMs?:number}):Promise<ArmBackendCapability>{
 let port:SocketBridgePort;
 try{port=await connectBridge(o.socketPath,o.timeoutMs??2000);}catch(e){return {backendId:'linuxcnc_sim',available:false,evidence:'none',reasons:[(e as Error).message]};}
 const first=await new Promise<ArmStatus|null>(resolve=>{const timer=setTimeout(()=>{off();resolve(null);},o.timeoutMs??2000);const off=port.onMessage(m=>{if(m.kind==='arm.status.v1'){clearTimeout(timer);off();resolve(m);}});});
 if(!first){await port.close();return {backendId:'linuxcnc_sim',available:false,evidence:'none',reasons:['BRIDGE_SILENT']};}
 return {backendId:'linuxcnc_sim',available:true,evidence:'controller_sim',reasons:[],machineId:first.machineId,controllerEpoch:first.controllerEpoch,bootId:first.bootId,port};
}
interface TransferOutboxEntry {commandId:string;report:CellReport;acked:boolean;controllerEpoch?:number}
interface WireDeadline {identity:string;logicalExpiresAt:string;expiresAt:string;mapping:{controllerAtMs:number;receivedWallMs:number;roundTripMs:number;uncertaintyMs:number;clockDomain:string}}
interface JournaledJob {controllerIdentity?:{bootId:string;epoch:number};command:CellCommand;identity:string;stageId:string;phase:string;completion?:CellReport}
export class LinuxcncArmAdapter implements CellAdapter {
 private wireDeadlines=new Map<string,WireDeadline>();private journal:DatabaseSync|null=null;private durable=new Map<string,JournaledJob>();private execution:Promise<unknown>=Promise.resolve();
 private completed=new Set<string>();private sceneNegotiated=false;private transferOutbox=new Map<string,TransferOutboxEntry>();
 private token='';private lease='';private epoch=1;private ownerLost=false;private bootId='bridge';private seq=0;private n=0;private lastStatus:string|null=null;private lastStatusAt=-Infinity;private renewTimer:ReturnType<typeof setInterval>|null=null;
 private listeners=new Set<(r:CellReport)=>void>();private statusListeners=new Set<(s:ArmStatus)=>void>();private inflight=new Map<string,CellCommand>();private jobs=new Map<string,string>();private acked=new Set<string>();private unsub:()=>void;
 constructor(private o:{port:ArmBridgePort;profile:ArmProfile;runId:string;cellId:string;deviceId:string;nowMs:()=>number;actor?:string;journalPath?:string;afterJournal?:(phase:string)=>void;simulationScene?:{worldRevision:string};correlatedBarrier?:boolean;wireDeadline?:{wallNowMs?:()=>number;monotonicMs?:()=>number}}){
  if(o.journalPath){this.journal=new DatabaseSync(o.journalPath);this.journal.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS arm_jobs (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, record TEXT NOT NULL); CREATE TABLE IF NOT EXISTS arm_wire_deadlines(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,record TEXT NOT NULL); CREATE TABLE IF NOT EXISTS arm_transfer_outbox(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,record TEXT NOT NULL)');
   for(const row of this.journal.prepare('SELECT * FROM arm_jobs').all() as {id:string;run_id:string;record:string}[]){if(row.run_id!==o.runId)throw new Error('ARM_JOURNAL_RUN_MISMATCH');const job=JSON.parse(row.record) as JournaledJob;this.durable.set(row.id,job);if(job.phase==='completed'||job.phase==='completion_ingested')this.completed.add(row.id);else if(job.phase.startsWith('start_'))this.inflight.set(row.id,job.command);this.jobs.set(row.id,String((job.command.payload as {jobId:string}).jobId));}
  }
  if(this.journal)for(const row of this.journal.prepare('SELECT * FROM arm_transfer_outbox').all() as {id:string;run_id:string;record:string}[]){if(row.run_id!==o.runId)throw new Error('ARM_JOURNAL_RUN_MISMATCH');this.transferOutbox.set(row.id,JSON.parse(row.record));}
  if(o.wireDeadline&&!this.journal)throw new Error('ARM_WIRE_JOURNAL_REQUIRED');
  if(this.journal)for(const row of this.journal.prepare('SELECT * FROM arm_wire_deadlines').all() as {id:string;run_id:string;record:string}[]){if(row.run_id!==o.runId)throw new Error('ARM_JOURNAL_RUN_MISMATCH');this.wireDeadlines.set(row.id,JSON.parse(row.record));}
  this.unsub=o.port.onMessage(m=>this.onMessage(m));
 }
 private checkpoint(job:JournaledJob,phase:string){job.phase=phase;this.durable.set(job.command.commandId,job);this.journal?.prepare('INSERT INTO arm_jobs VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record').run(job.command.commandId,this.o.runId,JSON.stringify(job));this.o.afterJournal?.(phase);}
 get journalPath(){return this.o.journalPath??null;}
 get hasOwner(){return !!this.lease&&!this.ownerLost;}
 get profile(){return this.o.profile;}
 private envelope(shape:Partial<ArmCommand>):ArmCommand{const p=this.o.profile;return {schemaVersion:1,kind:'arm.command.v1',requestId:`req-${++this.n}-${randomUUID().slice(0,8)}`,machineId:p.machineId,controllerEpoch:this.epoch,owner:{token:this.token,actor:'lab_simulation'},leaseId:this.lease,expected:{profileHash:hashJson(p as unknown as JsonObject),modelManifestSha256:p.model.manifestSha256},...shape} as ArmCommand;}
 private async send(m:ArmCommand):Promise<ArmReply>{const v=validateArmCommand(m);if(!v.ok)throw new Error(`ARM_ENVELOPE_INVALID:${v.issues[0]!.code}`);const r=await this.o.port.send(m);if(r.kind!=='arm.reply.v1')throw new Error('BRIDGE_REPLY_INVALID');return r;}
 /** Measure the controller wall clock through the existing lease protocol. Its expiry is exactly controller-now + requested TTL.
  * A full RTT bounds sample age; 1 ms covers timestamp quantisation. No remote monotonic clocks are subtracted.
  * Fresh commands allow <=250 ms uncertainty and <=5 s host/controller wall skew; the first expiry is never renewed.
  */
 private async wireCommand(command:CellCommand):Promise<CellCommand>{
  if(!this.o.wireDeadline)return command;
  const identity=hashJson({...command,expiresAt:null} as unknown as JsonObject),prior=this.wireDeadlines.get(command.commandId);
  if(prior){if(prior.identity!==identity)throw new Error('COMMAND_ID_CONFLICT');return {...command,expiresAt:prior.expiresAt};}
  const ttl=Date.parse(command.expiresAt)-this.o.nowMs();if(!Number.isFinite(ttl)||ttl<=0||ttl>30000)throw new Error('WIRE_CLOCK_LOGICAL_DEADLINE_INVALID');
  const mono=this.o.wireDeadline.monotonicMs??(()=>performance.now()),wall=this.o.wireDeadline.wallNowMs??Date.now;
  const before=mono(),wallBefore=wall(),r=await this.send(this.envelope({renew:{leaseId:this.lease}})),roundTripMs=mono()-before,receivedWallMs=wall();
  if(r.status!=='accepted'){this.loseOwner();throw new Error('WIRE_CLOCK_OWNER_LOST');}
  const uncertaintyMs=Math.ceil(roundTripMs)+1,controllerAtMs=Number(r.expiresAtMs)-this.o.profile.lease.ttlMs;
  if(!Number.isSafeInteger(controllerAtMs)||!Number.isFinite(roundTripMs)||roundTripMs<0||uncertaintyMs>250||Math.abs(receivedWallMs-wallBefore-roundTripMs)>250||Math.abs(controllerAtMs-receivedWallMs)>5000+uncertaintyMs)throw new Error('WIRE_CLOCK_MAPPING_UNBOUNDED');
  const expiresAt=new Date(controllerAtMs+ttl-uncertaintyMs).toISOString(),record:WireDeadline={identity,logicalExpiresAt:command.expiresAt,expiresAt,mapping:{controllerAtMs,receivedWallMs,roundTripMs,uncertaintyMs,clockDomain:'controller-wall-ms'}};
  this.journal!.prepare('INSERT INTO arm_wire_deadlines VALUES(?,?,?)').run(command.commandId,this.o.runId,JSON.stringify(record));this.wireDeadlines.set(command.commandId,record);
  return {...command,expiresAt};
 }
 wireDeadlineEvidence(){return [...this.wireDeadlines].map(([commandId,record])=>({commandId,...structuredClone(record)}));}
 /** Acquire the lab_simulation lease; the bridge decides (owner held, epoch, profile/model expectations) and the refusal is the error. */
 async open(){const r=await this.send(this.envelope({acquire:{actor:this.o.actor??'lab-runtime',leaseMs:this.o.profile.lease.ttlMs,...this.o.simulationScene?{simulationScene:{runId:this.o.runId,worldRevision:this.o.simulationScene.worldRevision}}:{}}}));if(r.status!=='accepted'||!r.token||!r.leaseId)throw new Error(`ARM_OWNER_UNAVAILABLE:${r.reasonCodes.join(',')||'NO_REASON'}`);this.token=r.token;this.lease=r.leaseId;this.ownerLost=false;
  if(this.o.simulationScene){if(!r.capabilities?.includes('simulation_scene.v1')){await this.send(this.envelope({release:{leaseId:this.lease}}));this.loseOwner();throw new Error('SIM_SCENE_CAPABILITY_REQUIRED');}this.sceneNegotiated=true;}
  if(this.o.correlatedBarrier&&!r.capabilities?.includes('correlated_barrier.v1')){await this.holdForReconcile();throw new Error('CORRELATED_BARRIER_CAPABILITY_REQUIRED');}
  // renew before expiry for the life of the lease; a refused renewal means the lease is gone (never assumed to still hold)
  const {ttlMs,renewBeforeMs}=this.o.profile.lease;this.stopRenew();this.renewTimer=setInterval(()=>{void this.renew().catch(()=>{this.loseOwner();});},Math.max(1000,ttlMs-renewBeforeMs));this.renewTimer.unref?.();}
 /** Scene ACK only updates the bounded virtual plant; it is never a custody observation. */
 async updateSimScene(scene:SimSceneUpdate):Promise<void>{
  if(!this.sceneNegotiated||this.ownerLost||!this.lease)throw new Error('SIM_SCENE_NOT_NEGOTIATED');
  if(scene.runId!==this.o.runId||scene.worldRevision!==this.o.simulationScene?.worldRevision)throw new Error('SIM_SCENE_PIN_MISMATCH');
  const r=await this.send(this.envelope({simScene:scene}));if(r.status!=='accepted')throw new Error(`SIM_SCENE_REJECTED:${r.reasonCodes.join(',')}`);
 }
 async barrier(proof:NonNullable<ArmCommand['barrier']>):Promise<JsonObject>{
  const r=await this.send(this.envelope({barrier:proof}));
  if(r.status!=='accepted'||!r.outcome)throw new Error(`ARM_BARRIER_REJECTED:${r.reasonCodes.join(',')}`);
  return r.outcome.evidence as JsonObject;
 }
 /** Lease release stops through the arbiter's existing cancel-and-reconcile semantics. */
 async holdForReconcile(){if(this.lease&&!this.ownerLost){const r=await this.send(this.envelope({release:{leaseId:this.lease}}));this.loseOwner();if(r.status!=='accepted')throw new Error('ARM_HOLD_UNKNOWN');}}
 private stopRenew(){if(this.renewTimer){clearInterval(this.renewTimer);this.renewTimer=null;}}
 private loseOwner(){this.sceneNegotiated=false;this.ownerLost=true;this.token='';this.lease='';this.stopRenew();}
 async renew(){if(this.ownerLost||!this.lease)return false;const r=await this.send(this.envelope({renew:{leaseId:this.lease}}));if(r.status!=='accepted'){this.loseOwner();}return r.status==='accepted';}
 async describe():Promise<CellManifest>{return {cellId:this.o.cellId,deviceIds:[this.o.deviceId],adapter:LINUXCNC_SIM.id,version:LINUXCNC_SIM.version,model:this.o.profile.model.id,validation:'simulated',capabilities:[...ARM_CAPABILITIES]};}
 private report(r:Omit<CellReport,'deviceId'|'bootId'|'seq'|'observedAt'>&Partial<CellReport>){this.seq++;const at=new Date(this.o.nowMs()).toISOString();const full:CellReport={deviceId:this.o.deviceId,bootId:this.bootId,seq:String(this.seq),observedAt:at,...r};for(const l of this.listeners)l(full);}
 private observation(c:CellCommand,result:CellObservation['result'],reasonCodes:string[]=[]):CellObservation{return {schemaVersion:2,commandId:c.commandId,deviceId:c.deviceId,controlEpoch:c.controlEpoch,payloadHash:c.payloadHash,bootId:this.bootId,seq:String(this.seq+1),result,observedAt:new Date(this.o.nowMs()).toISOString(),reasonCodes};}
 execute(command:CellCommand):Promise<CellAcceptance>{
  const task=this.execution.then(()=>this.executeOnce(command));this.execution=task.catch(()=>{});return task;
 }
 private async executeOnce(command:CellCommand):Promise<CellAcceptance>{
  const no=(reason:string):CellAcceptance=>({accepted:false,unknown:false,reason});
  if(command.runId!==this.o.runId)return no('RUN_MISMATCH');
  if(!(ARM_CAPABILITIES as readonly string[]).includes(command.capability))return no(`ARM_CAPABILITY_UNSUPPORTED:${command.capability}`);
  const ref=command.programRef;
  if(ref){const p=this.o.profile.programs[ref.id];if(!p)return no(`PROGRAM_NOT_ALLOWLISTED:${ref.id}`);if(p.sha256!==ref.hash&&ARM_PROGRAMS[ref.id]?.hash!==ref.hash)return no('PROGRAM_HASH_MISMATCH');}
  else if(command.capability==='stage_program')return no('PROGRAM_REF_REQUIRED');
  if(this.ownerLost)return no('ARM_OWNER_LOST');
  if(command.capability==='start_job')return this.startLogical(command);
  let m:ArmCommand;try{m=this.envelope({command:await this.wireCommand(command)});const v=validateArmCommand(m);if(!v.ok)return no(`ARM_ENVELOPE_INVALID:${v.issues[0]!.code}`);}catch(e){return no((e as Error).message);}
  let r:ArmReply;
  try{r=await this.send(m);}catch(e){return {accepted:false,unknown:true,reason:`NO_ACK:${(e as Error).message}`};}
  if(r.status==='accepted'){if(!r.duplicate&&!this.acked.has(command.commandId)){this.acked.add(command.commandId);this.report({observation:this.observation(command,'accepted')});}return {accepted:true,unknown:false};}
  if(r.status==='outcome_unknown')return {accepted:false,unknown:true,reason:r.reasonCodes.join(',')||'OUTCOME_UNKNOWN'};
  this.inflight.delete(command.commandId);
  return no(r.reasonCodes[0]??r.status.toUpperCase());
 }
 /** Persist intent before each write. Once an id exists, recovery is read-only even if no ACK was recorded. */
 private async startLogical(command:CellCommand):Promise<CellAcceptance>{
  if(!command.programRef)return {accepted:false,unknown:false,reason:'PROGRAM_REF_REQUIRED'};
  const identity=hashJson(command as unknown as JsonObject),prior=this.durable.get(command.commandId);
  if(prior){
   if(prior.identity!==identity)return {accepted:false,unknown:false,reason:'COMMAND_ID_CONFLICT'};
   if(this.acked.has(command.commandId)&&prior.phase==='start_accepted')return {accepted:true,unknown:false};
   await this.reconcile(command.commandId); // Never stage/start again, including an intent recorded before a send.
   return prior.phase==='start_accepted'||prior.phase==='completed'||prior.phase==='completion_ingested'?{accepted:true,unknown:false}:{accepted:false,unknown:true,reason:'RECONCILE_REQUIRED'};
  }
  const wire=await this.wireCommand(command);
  const programRef={id:command.programRef.id,hash:this.o.profile.programs[command.programRef.id]!.sha256};
  const stageId=`stage-${hashJson({logicalId:command.commandId,programHash:programRef.hash})}`;
  const job:JournaledJob={command:structuredClone(command),identity,stageId,phase:'stage_intent'};
  this.checkpoint(job,'stage_intent');
  const payload={profileId:this.o.profile.machineId};
  const stage={...wire,commandId:stageId,programRef,capability:'stage_program',payload,payloadHash:hashJson(payload)} as CellCommand;
  let reply:ArmReply;
  try{reply=await this.send(this.envelope({command:stage}));}catch(e){this.checkpoint(job,'stage_unknown');return {accepted:false,unknown:true,reason:`STAGE_NO_ACK:${(e as Error).message}`};}
  if(reply.status!=='accepted'){this.checkpoint(job,'stage_unknown');return {accepted:false,unknown:reply.status==='outcome_unknown',reason:reply.reasonCodes[0]??'STAGE_REJECTED'};}
  this.checkpoint(job,'stage_accepted');
  this.checkpoint(job,'start_intent');this.inflight.set(command.commandId,command);this.jobs.set(command.commandId,String((command.payload as {jobId:string}).jobId));
  try{reply=await this.send(this.envelope({command:{...wire,programRef}}));}catch(e){this.checkpoint(job,'start_unknown');return {accepted:false,unknown:true,reason:`NO_ACK:${(e as Error).message}`};}
  if(reply.status!=='accepted'){this.checkpoint(job,'start_unknown');return {accepted:false,unknown:reply.status==='outcome_unknown',reason:reply.reasonCodes[0]??'START_REJECTED'};}
  this.checkpoint(job,'start_accepted');
  if(!this.acked.has(command.commandId)){this.acked.add(command.commandId);this.report({observation:this.observation(command,'accepted')});}
  return {accepted:true,unknown:false};
 }
 /** Run reopen queries both cuts; an accepted stage is never promoted into a completed logical job. */
 async recover(){
  for(const job of this.durable.values()){
   const entries=[...this.transferOutbox.values()].filter(e=>e.commandId===job.command.commandId&&!e.acked);
   if(job.phase==='completion_ingested'&&!entries.length)continue;
   // Query the current controller/job identity before releasing any retained proof.
   // A fresh receipt alone cannot bridge a controller reboot or an unknown outcome.
   const outcome=await this.reconcile(job.command.commandId);
   const fenced=entries.some(entry=>!this.recoveryProofMatches(job,entry.report,entry.controllerEpoch,outcome));
   if(!fenced)for(const entry of entries)this.report(structuredClone(entry.report));
   if(!fenced&&job.phase==='completion_ingested')continue;
   if(!fenced&&job.phase==='completed'&&job.completion&&outcome.status==='completed'&&
      (job.completion.evidence?.transferObservation?this.recoveryProofMatches(job,job.completion,job.controllerIdentity?.epoch,outcome):entries.length>0)){
    // Retain the original coordinator receipt; recovery never renews sensor age.
    this.report(structuredClone(job.completion));
   }else this.report({observation:this.observation(job.command,'outcome_unknown',job.phase==='completed'?['RECOVERY_UNKNOWN',job.completion?'COMPLETION_PROOF_RECOVERY_REQUIRED':'COMPLETION_PROOF_MISSING']:['RECOVERY_UNKNOWN'])});
  }
 }
 private recoveryProofMatches(job:JournaledJob,report:CellReport,controllerEpoch:number|undefined,outcome:CellExecutionState):boolean{
  const proof=report.evidence?.transferObservation as import('../beverage/cup-ledger').TransferObservation|undefined;
  const controller=outcome.evidence.controllerIdentity as JsonObject|undefined,command=outcome.evidence.commandIdentity as JsonObject|undefined;
  return !!proof&&['accepted','running','completed'].includes(outcome.status)&&Number.isSafeInteger(controllerEpoch)&&
   controller?.bootId===proof.bootId&&controller?.epoch===controllerEpoch&&command?.controllerEpoch===controllerEpoch&&
   command?.commandId===job.command.commandId&&command?.deviceId===job.command.deviceId&&command?.payloadHash===job.command.payloadHash&&command?.controlEpoch===job.command.controlEpoch&&
   proof.commandId===job.command.commandId&&proof.runId===this.o.runId&&proof.deviceId===job.command.deviceId&&proof.payloadHash===job.command.payloadHash&&proof.controlEpoch===job.command.controlEpoch;
 }
 /** Called only after the custody journal has durably ingested this command's observation. */
 acknowledgeCompletion(commandId:string,observationId:string){
  const entry=this.transferOutbox.get(observationId);if(entry&&entry.commandId===commandId){entry.acked=true;this.persistTransfer(observationId,entry);const job=this.durable.get(commandId);if(job?.phase==='completed'&&this.transferProvesMotion(entry))this.checkpoint(job,'completion_ingested');}
  const job=this.durable.get(commandId),retained=job?.completion?.evidence?.transferObservation as {observationId?:string}|undefined;
  if(job?.phase==='completed'&&retained?.observationId===observationId)this.checkpoint(job,'completion_ingested');
 }
 completionReceipt(observationId:string):string|null{
  const entry=this.transferOutbox.get(observationId),proof=entry?.report.evidence?.transferObservation as {receivedMonotonicNs?:string}|undefined;if(proof)return proof.receivedMonotonicNs??null;
  for(const job of this.durable.values()){
   const observation=job.completion?.evidence?.transferObservation as {observationId?:string;receivedMonotonicNs?:string}|undefined;
   if(observation?.observationId===observationId)return observation.receivedMonotonicNs??null;
  }
  return null;
 }

 /** Cancel the job a start command started: a cancel_job command through the arbiter; the held cup is never released by this. */
 async cancel(commandId:string){const jobId=this.jobs.get(commandId);if(!jobId||this.ownerLost)return {acknowledged:false,unknown:true};
  const c:CellCommand={commandId:`${commandId}:cancel`,runId:this.o.runId,deviceId:this.o.deviceId,controlEpoch:this.inflight.get(commandId)?.controlEpoch??1,expiresAt:new Date(this.o.nowMs()+30000).toISOString(),recipeRevision:null,programRef:null,capability:'cancel_job',payloadHash:hashJson({jobId}),payload:{jobId}} as CellCommand;
  try{const r=await this.send(this.envelope({command:await this.wireCommand(c)}));return r.status==='accepted'?{acknowledged:true,unknown:false}:r.status==='outcome_unknown'?{acknowledged:false,unknown:true}:{acknowledged:false,unknown:false};}catch{return {acknowledged:false,unknown:true};}}
 observe(l:(r:CellReport)=>void){this.listeners.add(l);return ()=>{this.listeners.delete(l);};}
 onStatus(l:(s:ArmStatus)=>void){this.statusListeners.add(l);return ()=>{this.statusListeners.delete(l);};}
 /** Ask the bridge what became of a command: query_outcome (a read) while the lease holds, the ownerless reconcile shape once it is gone; unreachable stays unknown. */
 async reconcile(commandId:string):Promise<CellExecutionState>{
  const map=(r:ArmReply):CellExecutionState=>{const s=r.outcome?.status;return {status:s==='not_found'?'not_found':s==='running'||s==='completed'||s==='failed'||s==='accepted'?s:'unknown',evidence:(r.outcome?.evidence??{reasonCodes:r.reasonCodes}) as JsonObject};};
  try{
   const job=this.durable.get(commandId);
   if(job&&(job.phase.startsWith('stage_')||job.phase==='start_intent')){
    // Ask the stage for audit, but it has no authority over the logical start outcome.
    const r=await this.send(this.envelope({reconcile:{commandId:job.stageId}}));
    if(job.phase.startsWith('stage_'))return {status:'unknown',evidence:{stageStatus:r.outcome?.status??'unknown',reason:'RECONCILE_REQUIRED'}};
   }
   if(this.ownerLost||!this.token)return map(await this.send(this.envelope({reconcile:{commandId}})));
   const c:CellCommand={commandId:`q-${commandId}-${++this.n}`,runId:this.o.runId,deviceId:this.o.deviceId,controlEpoch:this.inflight.get(commandId)?.controlEpoch??1,expiresAt:new Date(this.o.nowMs()+30000).toISOString(),recipeRevision:null,programRef:null,capability:'query_outcome',payloadHash:hashJson({targetCommandId:commandId}),payload:{targetCommandId:commandId}} as CellCommand;
   return map(await this.send(this.envelope({command:await this.wireCommand(c)})));
  }catch(e){return {status:'unknown',evidence:{reason:(e as Error).message}};}
 }
 private transferProvesMotion(e:{report:CellReport;acked:boolean}){const o=e.report.evidence?.transferObservation as import('../beverage/cup-ledger').TransferObservation|undefined;return e.acked&&o?.quality==='valid'&&(o.phase==='release'||o.phase==='grasp'&&o.liftPoseReached===true);}
 private persistTransfer(id:string,entry:TransferOutboxEntry){this.transferOutbox.set(id,entry);this.journal?.prepare('INSERT INTO arm_transfer_outbox VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record').run(id,this.o.runId,JSON.stringify(entry));}
 private onMessage(m:ArmObservation){
  if(m.kind==='arm.status.v1'){
   this.bootId=m.bootId;this.epoch=m.controllerEpoch;for(const l of this.statusListeners)l(m);
   if(this.lease&&m.owner.leaseId!==this.lease)this.loseOwner();                                          // the bridge no longer shows our lease: it is gone
   const unresolved=m.reconcileRequired===true,status=unresolved||m.task.fault?'fault':m.task.state==='on'&&m.task.homed?'ready':'warming';
   const codes=[...unresolved?['RECONCILE_REQUIRED']:[],...m.task.fault?[m.task.fault]:m.task.state!=='on'?['MACHINE_OFF']:m.task.homed?[]:['NOT_HOMED']];
   const key=`${status}:${codes.join()}`;
   if(key!==this.lastStatus||this.o.nowMs()-this.lastStatusAt>=1000){this.lastStatus=key;this.lastStatusAt=this.o.nowMs();this.report({bootId:m.bootId,seq:m.seq,status:{status,reasonCodes:codes}});}
   return;
  }
  if(m.kind!=='arm.event.v1')return;
  this.bootId=m.bootId;this.epoch=m.controllerEpoch;
  if(m.event==='virtual_grip'){
   if(!this.sceneNegotiated||!m.observation||!m.evidence?.transferObservation)return;
   const proof=structuredClone(m.evidence.transferObservation) as import('../beverage/cup-ledger').TransferObservation,job=this.durable.get(m.observation.commandId);
   if(!job||proof.runId!==this.o.runId||proof.commandId!==job.command.commandId||proof.payloadHash!==job.command.payloadHash||proof.controlEpoch!==job.command.controlEpoch||proof.deviceId!==job.command.deviceId||proof.producer!=='linuxcnc_virtual_grip'||proof.fidelity!=='modeled'||proof.bootId!==m.bootId||proof.seq!==m.seq)return;
   const retained=this.transferOutbox.get(proof.observationId);if(retained){const prior=retained.report.evidence!.transferObservation as typeof proof;if(hashJson({...proof,receivedMonotonicNs:prior.receivedMonotonicNs})!==hashJson(prior))this.report({status:{status:'fault',reasonCodes:['OBSERVATION_ID_CONFLICT']}});return;}
   proof.receivedMonotonicNs=String(process.hrtime.bigint());
   const report:CellReport={deviceId:proof.deviceId,bootId:m.bootId,seq:m.seq,observedAt:m.observedAt,observation:structuredClone(m.observation),evidence:{source:'linuxcnc_virtual_grip',transferObservation:proof}};
   this.persistTransfer(proof.observationId,{commandId:proof.commandId,report,acked:false,controllerEpoch:m.controllerEpoch});this.report(report);return;
  }
  if(m.event==='command_completed'||m.event==='command_failed'||m.event==='outcome_unknown'){
   if(m.observation){
    const id=m.observation.commandId,job=this.durable.get(id);
    if(this.completed.has(id))return;
    if(job&&(m.observation.payloadHash!==job.command.payloadHash||m.observation.controlEpoch!==job.command.controlEpoch||m.observation.deviceId!==job.command.deviceId))return;
    if([...this.durable.values()].some(j=>j.stageId===id))return;
    this.inflight.delete(id);
    const report:CellReport={deviceId:this.o.deviceId,bootId:m.bootId,seq:m.seq,observedAt:m.observation.observedAt??new Date(this.o.nowMs()).toISOString(),observation:structuredClone(m.observation),...m.evidence?{evidence:structuredClone(m.evidence) as TransferEvidence}:{}};
    if(m.observation.result==='completed'){
     const observation=report.evidence?.transferObservation as {receivedMonotonicNs:string}|undefined;
     if(observation)observation.receivedMonotonicNs=String(process.hrtime.bigint());
     if(job){job.completion=report;job.controllerIdentity={bootId:m.bootId,epoch:m.controllerEpoch};const ingested=[...this.transferOutbox.values()].some(e=>e.commandId===id&&this.transferProvesMotion(e));this.checkpoint(job,ingested?'completion_ingested':'completed');}this.completed.add(id);
    }
    this.report(report);
   }
   else if(m.commandId&&this.inflight.has(m.commandId)){const c=this.inflight.get(m.commandId)!;this.inflight.delete(m.commandId);this.report({observation:this.observation(c,'outcome_unknown',m.reasonCodes.length?m.reasonCodes:['OUTCOME_UNKNOWN'])});}
  }else if(m.event==='controller_restart'||m.event==='bridge_restart'||m.event==='bridge_start'){
   this.loseOwner();
   for(const c of this.inflight.values())this.report({observation:this.observation(c,'outcome_unknown',['OBSERVER_REBOOT'])});
   this.inflight.clear();
  }else if(m.event==='lease_expired'||m.event==='owner_revoked'){this.loseOwner();}                      // the bridge announces each affected job's outcome_unknown itself
  else if(m.event==='fault'){this.report({status:{status:'fault',reasonCodes:m.reasonCodes.length?m.reasonCodes:['CONTROLLER_FAULT']}});}
 }
 async close(){await this.execution;this.stopRenew();if(this.lease&&!this.ownerLost){try{await this.send(this.envelope({release:{leaseId:this.lease}}));}catch{/* the lease dies with the socket */}}this.token='';this.lease='';this.unsub();await this.o.port.close();this.journal?.close();this.journal=null;}
}
