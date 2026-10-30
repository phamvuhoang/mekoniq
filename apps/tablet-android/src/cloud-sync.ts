import {canonicalBytes,hashPayload,validateEnvelope,validateJournal,validateSyncAck,verifyEs256,type PublicEcJwk} from '../../../packages/contracts/src/index';
import type {CommandEnvelope,CommandResult,JournalEntry,JsonObject,JsonValue,Scope,Snapshot} from '../../../packages/contracts/src/index';
import type {DurableStore} from '../../../packages/sync/src/store';
import {contiguousCursor} from '../../../packages/sync/src/cursor';

export type CloudRequest=(input:{method:'GET'|'POST';path:string;body?:JsonObject})=>Promise<{status:number;body:JsonObject}>;
export type VerifiedCloudAuthorization=Scope & {actorRef:string;deviceId:string;deviceEpoch:string;permissions:string[];stationIds:string[];expiresAt:string;receiptOnly?:boolean};
export type CloudSyncOptions={
 store:DurableStore;scope:Scope;deviceId:string;deviceEpoch:string;isCoordinator:boolean;
 request:CloudRequest;cloudPublicJwk:PublicEcJwk;
 dispatchDelegated:(command:CommandEnvelope,authorization:VerifiedCloudAuthorization)=>Promise<CommandResult>;
 applyConfiguration?:(command:CommandEnvelope,authorization:VerifiedCloudAuthorization)=>Promise<CommandResult>;
 receiveEntries?:(entries:JournalEntry[])=>Promise<{received:number;applied:number}>;
 nowMs?:()=>number;random?:()=>number;intervalMs?:number;maxBatches?:number;maxCycleMs?:number;requestTimeoutMs?:number;autostart?:boolean;
};
export type SyncCycleReport={status:'synced'|'unavailable';pushed:number;pulled:number;relayed:number;pendingJournal:number|null;receivedCursor:string;appliedCursor:string;configurationRevision?:number;errors:string[]};
const byteLength=(value:JsonValue)=>new TextEncoder().encode(JSON.stringify(value)).byteLength;
const object=(value:unknown):JsonObject=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('INVALID_CLOUD_RESPONSE');return value as JsonObject;};
const string=(value:JsonValue|undefined):string=>{if(typeof value!=='string'||!value||value.length>128)throw new Error('INVALID_CLOUD_RESPONSE');return value;};
const strings=(value:JsonValue|undefined):string[]=>{if(!Array.isArray(value)||value.length>100||value.some(v=>typeof v!=='string'))throw new Error('INVALID_CLOUD_AUTHORIZATION');return value as string[];};
const cursor=(value:JsonValue|undefined):string=>{if(typeof value!=='string'||!/^(0|[1-9][0-9]*)$/.test(value))throw new Error('INVALID_CLOUD_CURSOR');return value;};
function signedPayload(raw:JsonValue|undefined,options:CloudSyncOptions,nowMs:number):JsonObject {
 const signed=object(raw),grant=object(signed.grant);
 if(!verifyEs256(canonicalBytes(grant),string(signed.signature),options.cloudPublicJwk))throw new Error('CLOUD_SIGNATURE_INVALID');
 if(grant.schemaVersion!==1||grant.organizationId!==options.scope.organizationId||grant.venueId!==options.scope.venueId)throw new Error('CLOUD_SCOPE_MISMATCH');
 const issued=Date.parse(String(grant.issuedAt)),expires=Date.parse(String(grant.expiresAt));
 if(!Number.isFinite(issued)||!Number.isFinite(expires)||issued>nowMs+30000||expires<=nowMs||expires<=issued||expires-issued>300000)throw new Error('CLOUD_AUTHORIZATION_EXPIRED');
 return grant;
}
export function verifiedRelay(command:CommandEnvelope,raw:JsonValue|undefined,options:CloudSyncOptions,authority:Snapshot,nowMs:number):VerifiedCloudAuthorization {
 const grant=signedPayload(raw,options,nowMs);
 if(grant.recipientDeviceId!==options.deviceId||grant.recipientDeviceEpoch!==options.deviceEpoch||grant.coordinatorEpoch!==authority.state.coordinatorEpoch||grant.commandHash!==hashPayload(command as unknown as JsonValue))throw new Error('CLOUD_COMMAND_BINDING_MISMATCH');
 if(grant.actorRef!==command.actorRef||grant.deviceId!==command.deviceId||grant.deviceEpoch!==command.deviceEpoch||command.coordinatorEpoch!==authority.state.coordinatorEpoch)throw new Error('CLOUD_ACTOR_BINDING_MISMATCH');
 return {...options.scope,actorRef:string(grant.actorRef),deviceId:string(grant.deviceId),deviceEpoch:string(grant.deviceEpoch),permissions:strings(grant.permissions),stationIds:strings(grant.stationIds),expiresAt:String(grant.expiresAt),receiptOnly:grant.receiptOnly===true};
}
/** Periodic HTTP recovery is authoritative; Realtime may only request an earlier tick. */
export function startCloudSync(options:CloudSyncOptions) {
 let stopped=false,running:Promise<SyncCycleReport>|undefined,timer:ReturnType<typeof setTimeout>|undefined,failures=0;
 const now=options.nowMs ?? Date.now;
 const interval=options.intervalMs ?? 5000,maxBatches=options.maxBatches ?? 2,maxCycleMs=options.maxCycleMs ?? 20000;
 if((options.requestTimeoutMs!==undefined&&(options.requestTimeoutMs<1||options.requestTimeoutMs>maxCycleMs))||interval<500||maxBatches<1||maxBatches>10||maxCycleMs<1000||maxCycleMs>30000)throw new Error('INVALID_SYNC_BUDGET');
 let cycleDeadline=0,cycleStartedMonotonic=0;
 const remaining=()=>Math.min(cycleDeadline-now(),maxCycleMs-(globalThis.performance.now()-cycleStartedMonotonic));
 const request=async(path:string,body:JsonObject):Promise<JsonObject>=>{
  if(remaining()<=0)throw new Error('CLOUD_CYCLE_DEADLINE');
  const timeoutMs=Math.min(options.requestTimeoutMs ?? 5000,Math.max(1,remaining()));
  let timeout:ReturnType<typeof setTimeout>|undefined;
  const response=await Promise.race([options.request({method:'POST',path,body}),new Promise<never>((_resolve,reject)=>{timeout=setTimeout(()=>reject(new Error('CLOUD_REQUEST_TIMEOUT')),timeoutMs);})]).finally(()=>{if(timeout)clearTimeout(timeout);});
  if(response.status!==200)throw new Error(`CLOUD_HTTP_${response.status}`);
  if(byteLength(response.body)>1048576)throw new Error('CLOUD_RESPONSE_TOO_LARGE');
  return object(response.body);
 };
 const snapshotAuthority=(snapshots:Snapshot[])=>snapshots.find(s=>s.ref.kind==='__scope__'&&s.ref.id==='authority') ?? (()=>{throw new Error('NATIVE_AUTHORITY_REQUIRED');})();
 const venuePath=`/v1/venues/${encodeURIComponent(options.scope.venueId)}`;
 async function flushConfigurationReceipts():Promise<void> {
  const effects=(await options.store.effects(options.scope,'cloud.configurationAck')).filter(e=>!['confirmed','failed'].includes(String(e.status)));
  for(const effect of effects.slice(0,20)) {
   if(remaining()<=0)break;
   const payload=object(effect.payload),id=string(effect.id);
   if(effect.status==='pending'&&!await options.store.claimEffect(options.scope,id))continue;
   try {
    // Repeating this metadata ACK is safe; it never emits a financial or physical effect.
    await request(venuePath+'/configuration/apply',{revision:Number(payload.revision),coordinatorEpoch:Number(payload.coordinatorEpoch),receiptHash:hashPayload({operationId:payload.operationId!,revision:payload.revision!,payloadHash:payload.payloadHash!})});
    await options.store.completeEffect(options.scope,id,'confirmed');
   } catch(error) {await options.store.completeEffect(options.scope,id,'unknown');throw error;}
  }
 }
 async function cycle():Promise<SyncCycleReport> {
  const report:SyncCycleReport={status:'synced',pushed:0,pulled:0,relayed:0,pendingJournal:null,receivedCursor:'0',appliedCursor:'0',errors:[]};
  cycleDeadline=now()+maxCycleMs;cycleStartedMonotonic=globalThis.performance.now();
  try {
   const handshake=await request('/v1/sync/handshake',{venueId:options.scope.venueId,deviceId:options.deviceId,deviceEpoch:options.deviceEpoch});
   if(!Array.isArray(handshake.schemaVersions)||!handshake.schemaVersions.includes(1))throw new Error('CLOUD_SCHEMA_UNSUPPORTED');
   report.receivedCursor=cursor(handshake.receivedCursor);report.appliedCursor=cursor(handshake.appliedCursor);
   for(let count=0;count<maxBatches&&remaining()>0;count++) {
    const pending=(await options.store.pending(options.scope)).filter(e=>e.type==='sync.journal');
    const own=pending.map(e=>validateJournal(e.payload)).filter(e=>e.deviceId===options.deviceId&&e.deviceEpoch===options.deviceEpoch).sort((a,b)=>BigInt(a.sequence)<BigInt(b.sequence)?-1:1);
    const batch:JournalEntry[]=[];
    for(const entry of own) {
     if(entry.organizationId!==options.scope.organizationId||entry.venueId!==options.scope.venueId)throw new Error('JOURNAL_SCOPE_MISMATCH');
     if(batch.length>=100||byteLength({entries:[...batch,entry] as unknown as JsonValue[]})>1048576-8192)break;
     batch.push(entry);
    }
    if(!batch.length){if(own.length)throw new Error('JOURNAL_ENTRY_TOO_LARGE');break;}
    const ack=validateSyncAck(await request('/v1/sync/push',{entries:batch as unknown as JsonValue[]}));
    if(ack.organizationId!==options.scope.organizationId||ack.venueId!==options.scope.venueId||ack.deviceId!==options.deviceId||ack.deviceEpoch!==options.deviceEpoch)throw new Error('CLOUD_ACK_SCOPE_MISMATCH');
    // Native storage validates each hash/producer/sequence before pruning any outbox entry.
    await options.store.acknowledge(ack);report.pushed+=ack.entries.filter(e=>e.status!=='rejected').length;
    report.receivedCursor=ack.receivedCursor;report.appliedCursor=ack.appliedCursor;
   }
   if(remaining()>0) {
    const local=(await options.store.journal(options.scope)).filter(e=>e.deviceId===options.deviceId&&e.deviceEpoch===options.deviceEpoch);
    const after=contiguousCursor(local.map(e=>e.sequence),'0');
    const response=await request('/v1/sync/pull',{venueId:options.scope.venueId,producerDeviceId:options.deviceId,producerDeviceEpoch:options.deviceEpoch,after});
    if(!Array.isArray(response.entries)||response.entries.length>100)throw new Error('INVALID_CLOUD_BATCH');
    const entries=response.entries.map(row=>validateJournal(object(row).raw_entry));
    for(const entry of entries)if(entry.organizationId!==options.scope.organizationId||entry.venueId!==options.scope.venueId||entry.deviceId!==options.deviceId||entry.deviceEpoch!==options.deviceEpoch)throw new Error('CLOUD_PULL_SCOPE_MISMATCH');
    if(entries.length) {
     if(!options.receiveEntries)throw new Error('NATIVE_JOURNAL_RECOVERY_REQUIRED');
     const receipt=await options.receiveEntries(entries);
     if(receipt.received!==entries.length||receipt.applied!==receipt.received)throw new Error('NATIVE_RECOVERY_INCOMPLETE');
     report.pulled=receipt.received;
    }
    const watermark=await request('/v1/sync/ack',{venueId:options.scope.venueId,deviceId:options.deviceId,deviceEpoch:options.deviceEpoch});
    report.receivedCursor=cursor(watermark.receivedCursor);report.appliedCursor=cursor(watermark.appliedCursor);
   }
   if(options.isCoordinator&&remaining()>0) {
    let snapshots=await options.store.snapshots(options.scope),authority=snapshotAuthority(snapshots);
    if(authority.state.ownerDeviceId!==options.deviceId||authority.state.deviceEpoch!==options.deviceEpoch)throw new Error('COORDINATOR_FENCED');
    await flushConfigurationReceipts();
    const current=snapshots.find(s=>s.ref.kind==='configuration'&&s.ref.id==='applied');
    const config=await request(venuePath+'/configuration/pull',{afterRevision:Number(current?.state.revision ?? 0)});
    if(config.publication) {
     const publication=signedPayload(config.publication,options,now());
     const revision=publication.revision;
     if(!Number.isSafeInteger(revision)||Number(revision)<1||revision!==config.revision)throw new Error('INVALID_CONFIGURATION_PUBLICATION');
     const appliedRevision=Number(current?.state.revision ?? 0);
     if(Number(revision)!==appliedRevision+1)throw new Error('CONFIGURATION_REVISION_GAP');
     const payload:JsonObject={revision:Number(revision),features:object(publication.features),readiness:current?.state.readiness ?? {}};
     const command:CommandEnvelope={schemaVersion:1,...options.scope,operationId:'config-'+hashPayload({revision:Number(revision),deviceId:options.deviceId}).slice(0,32),type:'Configuration.Apply',actorRef:'cloud-configuration',deviceId:options.deviceId,deviceEpoch:options.deviceEpoch,coordinatorEpoch:Number(authority.state.coordinatorEpoch),policyRevision:Number(authority.state.policyRevision),occurredAt:String(publication.issuedAt),recordedAt:new Date(now()).toISOString(),payload,payloadHash:hashPayload(payload)};
     const authorization:VerifiedCloudAuthorization={...options.scope,actorRef:command.actorRef,deviceId:command.deviceId,deviceEpoch:command.deviceEpoch,permissions:['configuration.publish'],stationIds:[],expiresAt:String(publication.expiresAt)};
     const result=await(options.applyConfiguration ?? options.dispatchDelegated)(command,authorization);
     if(result.status!=='accepted'||result.ack!=='venue')throw new Error('CONFIGURATION_NOT_COMMITTED');
     const committed=await options.store.readSnapshot({...options.scope,kind:'configuration',id:'applied'});
     if(committed.state.revision!==revision)throw new Error('CONFIGURATION_RECEIPT_MISMATCH');
     const ackEffect=(await options.store.effects(options.scope,'cloud.configurationAck')).find(e=>object(e.payload).operationId===result.operationId);
     if(!ackEffect)throw new Error('CONFIGURATION_ACK_OUTBOX_REQUIRED');
     await flushConfigurationReceipts();
     report.configurationRevision=Number(revision);
    }
    if(remaining()>0) {
     snapshots=await options.store.snapshots(options.scope);authority=snapshotAuthority(snapshots);
     const response=await request(venuePath+'/relay/pull',{});
     if(!Array.isArray(response.commands)||response.commands.length>100)throw new Error('INVALID_RELAY_BATCH');
     for(const value of response.commands) {
      if(remaining()<=0)break;
      const row=object(value),command=validateEnvelope(row.command),authorization=verifiedRelay(command,row.authorization,options,authority,now());
      if(command.policyRevision>Number(authority.state.policyRevision))continue;
      const previous=await options.store.receipt(options.scope,command.operationId,command.payloadHash,command);
      const result:CommandResult=previous?{...previous,duplicate:true}:authorization.receiptOnly?{status:'rejected',code:'ACTOR_PERMISSION_REVOKED',ack:'none',value:{},operationId:command.operationId,duplicate:false}:await options.dispatchDelegated(command,authorization);
      if(result.operationId!==command.operationId)throw new Error('RELAY_RECEIPT_MISMATCH');
      // Unknown transport outcomes stay pending. They are queried/retried by operation ID.
      if(result.status==='unknown'||result.status==='pending')continue;
      if(result.status==='accepted'&&result.ack!=='venue')throw new Error('RELAY_NOT_COMMITTED');
      await request(venuePath+'/relay/receipt',{coordinatorEpoch:command.coordinatorEpoch,result:result as unknown as JsonObject});report.relayed++;
     }
    }
   }
   failures=0;
  } catch(error) {
   report.status='unavailable';failures++;
   const code=error instanceof Error?error.message:'SYNC_FAILURE';report.errors.push(/^[A-Z0-9_]+$/.test(code)?code:'SYNC_FAILURE');
  }
  try{report.pendingJournal=(await options.store.pending(options.scope)).filter(e=>e.type==='sync.journal').length;}catch{report.status='unavailable';report.errors.push('NATIVE_STORAGE_UNAVAILABLE');}
  return report;
 }
 const schedule=()=>{
  if(stopped)return;
  const backoff=Math.min(60000,interval*2**Math.min(failures,4));
  const jitter=Math.floor(backoff*0.2*(options.random ?? Math.random)());
  timer=setTimeout(()=>{void tick().then(schedule,schedule);},backoff+jitter);
 };
 function tick():Promise<SyncCycleReport> {
  if(stopped)return Promise.reject(new Error('SYNC_STOPPED'));
  if(running)return running;
  running=cycle().finally(()=>{running=undefined;});return running;
 }
 if(options.autostart!==false)timer=setTimeout(()=>{void tick().then(schedule,schedule);},0);
 return {tick,async close(){stopped=true;if(timer)clearTimeout(timer);await running?.catch(()=>{});}};
}
