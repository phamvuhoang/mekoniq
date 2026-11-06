// Physical custody is a projection of modeled observations. It never grants domain custody by itself.
import {DatabaseSync} from 'node:sqlite';
import Ajv from 'ajv';
import {assertJson,canonicalBytes,hashPayload} from '../../../../contracts/src/canonical';
import type {JsonValue} from '../../../../contracts/src/index';
import type {TransferObservation,CorrelatedTransferEvidence,CupPhysicalState} from '../../../../contracts/generated/lab-v2';
import schema from '../../../../contracts/schemas/lab-transfer-evidence.schema.json';
export type {TransferObservation,CorrelatedTransferEvidence,CupPhysicalState,SimProducer} from '../../../../contracts/generated/lab-v2';
export interface PendingTransferIdentity {
 runId:string;cupId:string;transferId:string;commandId:string;payloadHash:string;controlEpoch:number;deviceId:string;
 to:{kind:'arm'|'robot'|'table';id:string;slot?:number};
}
export interface TransferPolicy {nowMonotonicNs:string;freshnessNs:string;dockToleranceM:number}
export type TransferValidation<T>={ok:true;value:T}|{ok:false;reasonCodes:string[]};
const ajv=new Ajv({strict:true,allErrors:true});ajv.addSchema(schema);
const observationShape=ajv.getSchema<TransferObservation>(schema.$id)!;
const evidenceShape=ajv.getSchema<CorrelatedTransferEvidence>(`${schema.$id}#/definitions/CorrelatedTransferEvidence`)!;
const uint=(s:string)=>/^[0-9]{1,100}$/.test(s);
const targetParent=(p:PendingTransferIdentity)=>p.to.kind==='robot'?`robot:${p.to.id}/tray:${p.to.slot}`:p.to.kind==='arm'?`arm:${p.to.id}/tcp`:`table:${p.to.id}`;
function fresh(receipt:string,p:TransferPolicy){
 return uint(receipt)&&uint(p.nowMonotonicNs)&&uint(p.freshnessNs)&&BigInt(receipt)<=BigInt(p.nowMonotonicNs)&&BigInt(p.nowMonotonicNs)-BigInt(receipt)<=BigInt(p.freshnessNs);
}
function shape<T>(v:unknown,validate:(v:unknown)=>v is T):v is T {try{assertJson(v);return validate(v);}catch{return false;}}
/** Only coordinator receipt clocks participate in age checks; provider monotonic time belongs to its own clockDomain. */
export function validateTransferObservation(value:unknown,pending:PendingTransferIdentity,policy:TransferPolicy):TransferValidation<TransferObservation>{
 if(!shape(value,observationShape))return {ok:false,reasonCodes:['OBSERVATION_SHAPE_INVALID']};
 const o=value,codes:string[]=[];
 for(const k of ['runId','cupId','transferId','commandId','payloadHash','controlEpoch'] as const)if(o[k]!==pending[k])codes.push(`CORRELATION_${k.toUpperCase()}`);
 if(!Number.isSafeInteger(pending.controlEpoch)||pending.controlEpoch<1)codes.push('PENDING_EPOCH_INVALID');
 if(pending.to.kind==='robot'&&(!Number.isSafeInteger(pending.to.slot)||pending.to.slot!<1))codes.push('PENDING_SLOT_INVALID');
 if(!fresh(o.receivedMonotonicNs,policy)||o.quality==='stale')codes.push('OBSERVATION_STALE_OR_FUTURE');
 const receiver=o.phase==='receive';
 if(o.deviceId!==(receiver?pending.to.id:pending.deviceId))codes.push('DEVICE_MISMATCH');
 if(o.quality==='valid'&&o.phase!=='lost'){
  if(o.parent!==targetParent(pending))codes.push('PARENT_MISMATCH');
  if(o.phase==='grasp'&&(pending.to.kind!=='arm'||!o.grip?.closed||!o.grip.objectPresent))codes.push('GRASP_NOT_HELD');
  if(o.phase==='release'&&(pending.to.kind!=='robot'||o.grip?.closed!==false))codes.push('RELEASE_NOT_OPEN');
  if(receiver&&pending.to.kind!=='robot')codes.push('RECEIVER_NOT_TRAY');
 }
 return codes.length?{ok:false,reasonCodes:codes}:{ok:true,value:o};
}
export function validateCorrelatedTransferEvidence(value:unknown,pending:PendingTransferIdentity,policy:TransferPolicy):TransferValidation<CorrelatedTransferEvidence>{
 if(!shape(value,evidenceShape))return {ok:false,reasonCodes:['TRANSFER_EVIDENCE_SHAPE_INVALID']};
 const {giver,receiver,dock}=value,codes:string[]=[];
 for(const o of [giver,receiver]){const r=validateTransferObservation(o,pending,policy);if(!r.ok)codes.push(...r.reasonCodes);}
 if(giver.phase!=='release'||receiver.phase!=='receive'||giver.quality!=='valid'||receiver.quality!=='valid')codes.push('TRANSFER_PHASE_INVALID');
 if(giver.observerId===receiver.observerId)codes.push('OBSERVER_NOT_INDEPENDENT');
 if(dock.robotId!==pending.to.id||dock.slot!==pending.to.slot)codes.push('DOCK_IDENTITY_MISMATCH');
 if(!fresh(dock.receivedMonotonicNs,policy))codes.push('DOCK_STALE_OR_FUTURE');
 if(!Number.isFinite(policy.dockToleranceM)||policy.dockToleranceM<0||!dock.stationary||!dock.localizationValid||dock.errorM>policy.dockToleranceM)codes.push('DOCK_OUT_OF_TOLERANCE');
 return codes.length?{ok:false,reasonCodes:[...new Set(codes)]}:{ok:true,value};
}
/** One record per cup. Dedupe and ordering are deliberately journal responsibilities, not reducer state. */
export function applyCupObservation(state:readonly CupPhysicalState[],o:TransferObservation):readonly CupPhysicalState[]{
 if(!shape(o,observationShape))throw new Error('INVALID_TRANSFER_OBSERVATION');
 const known=o.quality==='valid'&&o.phase!=='lost';
 if(known){
  if(o.phase==='grasp'&&(!o.parent?.startsWith('arm:')||!o.parent.endsWith('/tcp')||!o.grip?.closed||!o.grip.objectPresent))throw new Error('CUP_GRASP_PARENT_OR_GRIP_INVALID');
  if((o.phase==='release'||o.phase==='receive')&&!/^robot:.+\/tray:[1-9][0-9]*$/.test(o.parent??''))throw new Error('CUP_TRAY_PARENT_INVALID');
 }
 const next:CupPhysicalState={cupId:o.cupId,parent:known?o.parent:null,status:o.phase==='lost'?'lost':known&&o.parent!==null?'known':'unknown',lastObservationId:o.observationId};
 const index=state.findIndex(c=>c.cupId===o.cupId);
 if(index>=0&&JSON.stringify(state[index])===JSON.stringify(next))return state;
 return index<0?[...state,next]:state.map((c,i)=>i===index?next:c);
}
export interface CupDomainState {pending:PendingTransferIdentity|null;parent:string|null}
export interface CupLedgerOptions {
 path:string;runId:string;nowMonotonicNs():bigint;freshnessNs:bigint;dockToleranceM?:number;
 /** Query current source custody on every recovery, including the cut after a successful domain commit. */
 domain(cupId:string):Promise<CupDomainState>;
 applyEffect?(observation:TransferObservation):Promise<void>|void;
 /** Persist any plant checkpoint before returning. Domain operation ids must derive from the transfer identity. */
 confirm(evidence:TransferObservation|CorrelatedTransferEvidence,pending:PendingTransferIdentity):Promise<void>;
 dock?():CorrelatedTransferEvidence['dock']|Promise<CorrelatedTransferEvidence['dock']>;
 afterCommit?():void;
}
export interface CupLedger {
 ingest(observation:TransferObservation):Promise<void>;recover():Promise<void>;
 snapshot():readonly CupPhysicalState[];observations():readonly TransferObservation[];
 bindEffect(effect:(observation:TransferObservation)=>Promise<void>|void):void;
 handoff(cupId:string,parent:string):Promise<void>;
 bindHandoffEffect(effect:(cup:CupPhysicalState)=>Promise<void>|void):void;
 close():void;
}
const canonical=(value:unknown)=>new TextDecoder().decode(canonicalBytes(value as JsonValue));
interface Row {ordinal:number;observation_id:string;hash:string;observation:string;pending:string;effects_done:number;confirmed:number}
/** SQLite FULL/WAL journal atomically commits receipt, hash, ordering cursor and projection before side effects. */
export function createCupLedger(options:CupLedgerOptions):CupLedger {
 if(options.freshnessNs<0n)throw new Error('CUP_FRESHNESS_INVALID');
 const db=new DatabaseSync(options.path);
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS cup_ledger_meta (id INTEGER PRIMARY KEY CHECK(id=1), run_id TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS cup_observation (ordinal INTEGER PRIMARY KEY AUTOINCREMENT, observation_id TEXT UNIQUE NOT NULL, hash TEXT NOT NULL, observation TEXT NOT NULL, pending TEXT NOT NULL, effects_done INTEGER NOT NULL DEFAULT 0, confirmed INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS cup_projection (cup_id TEXT PRIMARY KEY, state TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS cup_observer (observer_id TEXT PRIMARY KEY, boot_id TEXT NOT NULL, clock_domain TEXT NOT NULL, epoch INTEGER NOT NULL, seq TEXT NOT NULL, received_ns TEXT NOT NULL, observed_ns TEXT NOT NULL);`);
 const meta=db.prepare('SELECT run_id FROM cup_ledger_meta WHERE id=1').get();
 if(meta&&meta.run_id!==options.runId){db.close();throw new Error('CUP_LEDGER_RUN_MISMATCH');}
 db.prepare('INSERT OR IGNORE INTO cup_ledger_meta(id,run_id) VALUES(1,?)').run(options.runId);
 let tail:Promise<unknown>=Promise.resolve(),closed=false,effect=options.applyEffect,handoffEffect:((cup:CupPhysicalState)=>Promise<void>|void)|undefined;
 db.exec("CREATE TABLE IF NOT EXISTS cup_delivery (cup_id TEXT PRIMARY KEY, parent TEXT NOT NULL, state TEXT NOT NULL)");
 const policy=():TransferPolicy=>({nowMonotonicNs:String(options.nowMonotonicNs()),freshnessNs:String(options.freshnessNs),dockToleranceM:options.dockToleranceM??0.05});
 const rows=()=>db.prepare('SELECT * FROM cup_observation ORDER BY ordinal').all() as unknown as Row[];
 const readRow=(id:string)=>db.prepare('SELECT * FROM cup_observation WHERE observation_id=?').get(id) as unknown as Row|undefined;
 const snapshot=()=>db.prepare('SELECT state FROM cup_projection ORDER BY cup_id').all().map(r=>JSON.parse(r.state as string) as CupPhysicalState);
 const serial=<T>(work:()=>Promise<T>)=>{if(closed)return Promise.reject(new Error('CUP_LEDGER_CLOSED'));const result=tail.then(work);tail=result.catch(()=>{});return result;};
 const markConfirmed=(p:PendingTransferIdentity)=>db.prepare('UPDATE cup_observation SET confirmed=1 WHERE pending=?').run(canonical(p));
 async function finish(row:Row,attemptConfirmation=true){
  if(row.confirmed)return;
  const o=JSON.parse(row.observation) as TransferObservation,p=JSON.parse(row.pending) as PendingTransferIdentity;
  const domain=await options.domain(o.cupId);
  if(domain.pending){
   if(['runId','cupId','transferId','commandId','payloadHash','controlEpoch','deviceId'].some(k=>domain.pending![k as keyof PendingTransferIdentity]!==p[k as keyof PendingTransferIdentity])||targetParent(domain.pending)!==targetParent(p))throw new Error('CUP_RECONCILE_REQUIRED:PENDING_CHANGED');
  }else if(domain.parent!==targetParent(p))throw new Error('CUP_RECONCILE_REQUIRED:CUSTODY_CONFLICT');
  if(!row.effects_done){await effect?.(o);db.prepare('UPDATE cup_observation SET effects_done=1 WHERE observation_id=?').run(o.observationId);}
  if(o.quality!=='valid'||o.phase==='lost')throw new Error('CUP_RECONCILE_REQUIRED:PHYSICAL_UNKNOWN');
  if(!domain.pending){markConfirmed(p);return;}
  // Pre-ingest recovery must enforce custody/pending holds and finish effects, but a waiting proof can
  // be stale. Journal the fresh replacement before attempting correlation with the latest pair.
  if(!attemptConfirmation)return;
  let evidence:TransferObservation|CorrelatedTransferEvidence=o;
  if(p.to.kind==='robot'){
   const groupRows=rows().filter(r=>r.pending===row.pending),group=groupRows.map(r=>JSON.parse(r.observation) as TransferObservation);
   const giver=[...group].reverse().find(x=>x.phase==='release'),receiver=[...group].reverse().find(x=>x.phase==='receive');
   if(!giver||!receiver)return; // release alone never manufactures a receiver observation
   if([giver,receiver].some(x=>!readRow(x.observationId)?.effects_done))return;
   if(!options.dock)throw new Error('TRANSFER_EVIDENCE_INCOMPLETE:DOCK_MISSING');
   evidence={giver,receiver,dock:await options.dock()};
   const checked=validateCorrelatedTransferEvidence(evidence,p,policy());if(!checked.ok)throw new Error(`INVALID_TRANSFER_EVIDENCE:${checked.reasonCodes.join(',')}`);
  }else{
   if(p.to.kind!=='arm'||o.phase!=='grasp')throw new Error('CUP_RECONCILE_REQUIRED:DOMAIN_CONFIRMATION_REQUIRED');
   if(o.liftPoseReached!==true)return; // physical grasp can precede the domain's required lift proof
   const checked=validateTransferObservation(o,p,policy());if(!checked.ok)throw new Error(`INVALID_TRANSFER_OBSERVATION:${checked.reasonCodes.join(',')}`);
  }
  await options.confirm(evidence,p);
  const committed=await options.domain(o.cupId);
  if(committed.pending!==null||committed.parent!==targetParent(p))throw new Error('CUP_RECONCILE_REQUIRED:DOMAIN_CONFIRM_NOT_COMMITTED');
  markConfirmed(p);
 }
 async function handoff(cupId:string,parent:string){
  const domain=await options.domain(cupId);
  if(!/^table:.+/.test(parent)||domain.pending||domain.parent!==parent)throw new Error('CUP_RECONCILE_REQUIRED:DELIVERY_NOT_CONFIRMED');
  const prior=db.prepare('SELECT parent FROM cup_delivery WHERE cup_id=?').get(cupId),cup=snapshot().find(c=>c.cupId===cupId);
  if(prior&&prior.parent!==parent||!prior&&(!cup||cup.status!=='known'||!cup.parent?.startsWith('robot:')))throw new Error('CUP_RECONCILE_REQUIRED:DELIVERY_PARENT_CONFLICT');
  const state:CupPhysicalState={cupId,parent,status:'known',lastObservationId:`domain-delivery:${options.runId}:${cupId}:${parent}`};
  // This is a domain-confirmed effect, never a fabricated sensor observation. Commit before moving the modeled cup.
  db.exec('BEGIN IMMEDIATE');try{db.prepare('INSERT OR IGNORE INTO cup_delivery VALUES(?,?,?)').run(cupId,parent,JSON.stringify(state));db.prepare('INSERT OR REPLACE INTO cup_projection VALUES(?,?)').run(cupId,JSON.stringify(state));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  await handoffEffect?.(state);
 }
 const ledger:CupLedger={
  handoff:(cupId,parent)=>serial(()=>handoff(cupId,parent)),bindHandoffEffect(fn){handoffEffect=fn;},
  snapshot,observations:()=>rows().map(r=>JSON.parse(r.observation) as TransferObservation),bindEffect(fn){effect=fn;},
  ingest(o){return serial(async()=>{
   // Hash before schema/correlation so any reused id with changed content is always a conflict, even when malformed.
   assertJson(o);if(!o||typeof o.observationId!=='string')throw new Error('INVALID_TRANSFER_OBSERVATION:OBSERVATION_ID_MISSING');
   const hash=hashPayload(o as unknown as JsonValue),old=readRow(o.observationId);
   if(old){if(old.hash!==hash)throw new Error('OBSERVATION_ID_CONFLICT');await finish(old);return;}
   for(const row of rows().filter(r=>!r.confirmed&&(JSON.parse(r.observation) as TransferObservation).cupId===o.cupId))await finish(readRow(row.observation_id)!,false);
   const domain=await options.domain(o.cupId);
   // A settled attachment can later be lost. Reuse its exact journaled correlation only
   // to record uncertainty; this cannot create a new transfer or advance domain custody.
   const previous=(o.phase==='lost'||o.quality==='unknown')?[...rows()].reverse().find(r=>(JSON.parse(r.observation) as TransferObservation).cupId===o.cupId):undefined;
   const settled=previous?JSON.parse(previous.pending) as PendingTransferIdentity:null;
   const p=domain.pending??(settled&&domain.parent===targetParent(settled)?settled:null);
   if(!p)throw new Error('CUP_RECONCILE_REQUIRED:NO_PENDING_TRANSFER');
   const checked=validateTransferObservation(o,p,policy());if(!checked.ok||o.runId!==options.runId)throw new Error(`INVALID_TRANSFER_OBSERVATION:${!checked.ok?checked.reasonCodes.join(','):'RUN_MISMATCH'}`);
   db.exec('BEGIN IMMEDIATE');
   try{
    const prior=db.prepare('SELECT * FROM cup_observer WHERE observer_id=?').get(o.observerId);
    if(prior){
     if(prior.boot_id!==o.bootId||prior.clock_domain!==o.clockDomain)throw new Error('CUP_RECONCILE_REQUIRED:OBSERVER_CHANGED');
     if(o.controlEpoch<Number(prior.epoch))throw new Error('CUP_EPOCH_REPLAY');
     if(BigInt(o.seq)<=BigInt(prior.seq as string))throw new Error('CUP_SEQUENCE_REORDERED');
     if(BigInt(o.receivedMonotonicNs)<BigInt(prior.received_ns as string)||BigInt(o.observedMonotonicNs)<BigInt(prior.observed_ns as string))throw new Error('CUP_SEQUENCE_TIME_REORDERED');
    }
    const state=applyCupObservation(snapshot(),o).find(c=>c.cupId===o.cupId)!;
    db.prepare('INSERT INTO cup_observation(observation_id,hash,observation,pending) VALUES(?,?,?,?)').run(o.observationId,hash,JSON.stringify(o),canonical(p));
    db.prepare('INSERT OR REPLACE INTO cup_projection(cup_id,state) VALUES(?,?)').run(o.cupId,JSON.stringify(state));
    db.prepare('INSERT OR REPLACE INTO cup_observer(observer_id,boot_id,clock_domain,epoch,seq,received_ns,observed_ns) VALUES(?,?,?,?,?,?,?)').run(o.observerId,o.bootId,o.clockDomain,o.controlEpoch,o.seq,o.receivedMonotonicNs,o.observedMonotonicNs);
    db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   options.afterCommit?.();await finish(readRow(o.observationId)!);
  });},
  recover(){return serial(async()=>{for(const row of rows())await finish(readRow(row.observation_id)!);for(const cup of snapshot()){const d=await options.domain(cup.cupId);if(!d.pending&&d.parent?.startsWith('table:'))await handoff(cup.cupId,d.parent);}});},
  close(){if(!closed){closed=true;db.close();}},
 };
 return ledger;
}
