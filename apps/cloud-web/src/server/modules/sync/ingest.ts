import {createPublicKey,verify,randomUUID} from 'node:crypto';
import {canonicalBytes,hashPayload,assertJson} from '../../../../../../packages/contracts/src/canonical';
import {validateEnvelope,validateJournal} from '../../../../../../packages/contracts/src/validate';
import type {JournalEntry,JsonObject,JsonValue,SyncAck,SyncAckEntry} from '../../../../../../packages/contracts/generated/wire';
import {contiguousCursor} from '../../../../../../packages/sync/src/cursor';
import {withTenant,type CloudTransaction,type TenantScope} from '../identity/tenant-context';
import {applyJournalProjection} from './projection';
export function journalSigningPayload(entry:Record<string,unknown>):JsonObject {const {signature:_,...payload}=entry;void _;assertJson(payload);return payload as JsonObject;}
function minimalEntry(value:unknown):Record<string,unknown> {
 assertJson(value);
 if(!value||Array.isArray(value)||typeof value!=='object')throw new Error('INVALID_JOURNAL');
 const p=value as Record<string,unknown>;
 for(const key of ['organizationId','venueId','deviceId','deviceEpoch','entryId','operationId','sequence','aggregateType','aggregateId','payloadHash','signature'])if(typeof p[key]!=='string'||(p[key] as string).length>1024)throw new Error('INVALID_JOURNAL');
 if(!/^[1-9][0-9]{0,39}$/.test(p.sequence as string))throw new Error('INVALID_SEQUENCE');
 if(typeof p.resultingVersion!=='number'||!Number.isSafeInteger(p.resultingVersion)||p.resultingVersion<0)throw new Error('INVALID_JOURNAL');
 return p;
}
function commandIdentity(entry:JournalEntry){
 const c=validateEnvelope(entry.payload.commandEnvelope);
 if(c.organizationId!==entry.organizationId||c.venueId!==entry.venueId||c.operationId!==entry.operationId||c.actorRef!==entry.actorRef||(entry.kind==='intent'&&(c.deviceId!==entry.deviceId||c.deviceEpoch!==entry.deviceEpoch)))throw new Error('COMMAND_IDENTITY_MISMATCH');
 return hashPayload({operationId:c.operationId,organizationId:c.organizationId,venueId:c.venueId,type:c.type,actorRef:c.actorRef,deviceId:c.deviceId,deviceEpoch:c.deviceEpoch,coordinatorEpoch:c.coordinatorEpoch,policyRevision:c.policyRevision,expectedVersion:c.expectedVersion??null,payloadHash:c.payloadHash});
}
async function resolveAcceptedIntents(sql:CloudTransaction,scope:TenantScope){
 const pairs=await sql`SELECT intent.entry_id,intent.device_id,intent.device_epoch,intent.raw_entry AS intent,fact.raw_entry AS fact FROM sync_inbox intent JOIN sync_inbox fact ON fact.organization_id=intent.organization_id AND fact.venue_id=intent.venue_id AND fact.operation_id=intent.operation_id WHERE intent.organization_id=${scope.organizationId} AND intent.venue_id=${scope.venueId} AND intent.raw_entry->>'kind'='intent' AND intent.status='pending' AND fact.raw_entry->>'kind'='accepted_fact' AND fact.status='applied'`;
 const producers=new Map<string,{deviceId:string;deviceEpoch:string}>();
 for(const pair of pairs){
  let matches=false;try{matches=commandIdentity(pair.intent)===commandIdentity(pair.fact);}catch{/* Missing legacy command evidence cannot resolve an intent. */}
  const reason=matches?'OWNER_DECISION_RECORDED':'OWNER_COMMAND_CONFLICT';
  await sql`UPDATE sync_inbox SET status=${matches?'applied':'quarantined'},reason=${reason} WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND entry_id=${pair.entry_id}`;
  if(matches)producers.set(JSON.stringify([pair.device_id,pair.device_epoch]),{deviceId:pair.device_id,deviceEpoch:pair.device_epoch});
 }
 for(const producer of producers.values()){
  const rows=await sql`SELECT producer_sequence::text FROM sync_inbox WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND device_id=${producer.deviceId} AND device_epoch=${producer.deviceEpoch} AND status='applied'`;
  const cursor=contiguousCursor(rows.map(row=>row.producer_sequence),'0');
  await sql`UPDATE sync_watermark SET applied_cursor=${cursor}::numeric WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND device_id=${producer.deviceId} AND device_epoch=${producer.deviceEpoch}`;
 }
}
export async function ingestSignedBatch(scope:TenantScope,entries:unknown[]):Promise<SyncAck> {
 if(!entries.length||entries.length>100||Buffer.byteLength(JSON.stringify(entries))>1048576)throw new Error('INVALID_SYNC_BATCH');
 const normalized=entries.map(minimalEntry);const first=normalized[0];
 for(const entry of normalized)if(entry.organizationId!==scope.organizationId||entry.venueId!==scope.venueId||entry.deviceId!==first.deviceId||entry.deviceEpoch!==first.deviceEpoch)throw new Error('SCOPE_DENIED');
 return withTenant(scope,async sql=>{
  // Serialize producer reconciliation before taking individual watermark locks.
  await sql`SELECT pg_advisory_xact_lock(hashtext(${'sync:'+JSON.stringify(scope)}))`;
  const [device]=await sql`SELECT public_jwk,status FROM device_enrollment WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND device_id=${first.deviceId as string} AND device_epoch=${first.deviceEpoch as string}`;
  if(!device)throw new Error('UNENROLLED_DEVICE');
  await sql`INSERT INTO sync_watermark(organization_id,venue_id,device_id,device_epoch) VALUES(${scope.organizationId},${scope.venueId},${first.deviceId as string},${first.deviceEpoch as string}) ON CONFLICT DO NOTHING`;
  const [watermark]=await sql`SELECT received_cursor,applied_cursor FROM sync_watermark WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND device_id=${first.deviceId as string} AND device_epoch=${first.deviceEpoch as string} FOR UPDATE`;
  const conflicts=new Set<string>();
  for(const raw of normalized) {
   const payload=journalSigningPayload(raw);const signature=Buffer.from(raw.signature as string,'base64url');
   if(signature.length!==64||!verify('sha256',canonicalBytes(payload),{key:createPublicKey({key:device.public_jwk,format:'jwk'}),dsaEncoding:'ieee-p1363'},signature))throw new Error('INVALID_SIGNATURE');
   const canonicalHash=hashPayload(payload);
   const existing=await sql`SELECT canonical_hash FROM sync_inbox WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND (entry_id=${raw.entryId as string} OR (operation_id=${raw.operationId as string} AND raw_entry->>'kind'=${String(raw.kind)}) OR (device_id=${raw.deviceId as string} AND device_epoch=${raw.deviceEpoch as string} AND producer_sequence=${raw.sequence as string}::numeric))`;
   if(existing.length){if(existing.some(e=>e.canonical_hash!==canonicalHash)){
    await sql`INSERT INTO quarantine(organization_id,venue_id,id,raw_json,reason) VALUES(${scope.organizationId},${scope.venueId},${randomUUID()},${JSON.stringify(raw)},'IDEMPOTENCY_CONFLICT')`;
    conflicts.add(raw.entryId as string);
   }continue;}
   let status='pending';let reason:string|null=null;
   if(raw.schemaVersion!==1){status='quarantined';reason='UNSUPPORTED_SCHEMA';}
   else if(device.status!=='active'){status='quarantined';reason='REVOKED_DEVICE_LATE_FACT';}
   else {
    try{validateJournal(raw);}catch{status='quarantined';reason='INVALID_JOURNAL_SCHEMA';}
    if(status==='pending'&&raw.kind==='accepted_fact'){
     const [owner]=await sql`SELECT owner_device_id,owner_device_epoch,epoch,status FROM venue_ownership WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND resource_id='coordinator'`;
     if(!owner||owner.owner_device_id!==raw.deviceId||owner.owner_device_epoch!==raw.deviceEpoch||Number(owner.epoch)!==raw.coordinatorEpoch||owner.status!=='active'){status='quarantined';reason='SOURCE_NOT_OWNER';}
    }
   }
   await sql`INSERT INTO sync_inbox(organization_id,venue_id,device_id,device_epoch,producer_sequence,entry_id,operation_id,payload_hash,canonical_hash,aggregate_type,aggregate_id,resulting_version,raw_entry,status,reason)
    VALUES(${scope.organizationId},${scope.venueId},${raw.deviceId as string},${raw.deviceEpoch as string},${raw.sequence as string}::numeric,${raw.entryId as string},${raw.operationId as string},${raw.payloadHash as string},${canonicalHash},${raw.aggregateType as string},${raw.aggregateId as string},${raw.resultingVersion as number},${sql.json(raw as JsonObject)},${status},${reason})`;
  }
  const received=await sql`SELECT producer_sequence::text,status FROM sync_inbox WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND device_id=${first.deviceId as string} AND device_epoch=${first.deviceEpoch as string}`;
  const receivedCursor=contiguousCursor(received.map(e=>e.producer_sequence),String(watermark.received_cursor));
  const pending=await sql`SELECT entry_id,raw_entry FROM sync_inbox WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND device_id=${first.deviceId as string} AND device_epoch=${first.deviceEpoch as string} AND status='pending' AND producer_sequence<=${receivedCursor}::numeric ORDER BY producer_sequence`;
  for(const row of pending) {
   const outcome=await applyJournalProjection(sql,scope,row.raw_entry as JournalEntry);
   await sql`UPDATE sync_inbox SET status=${outcome.status},reason=${outcome.reason} WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND entry_id=${row.entry_id}`;
  }
  await resolveAcceptedIntents(sql,scope);
  const applied=await sql`SELECT producer_sequence::text FROM sync_inbox WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND device_id=${first.deviceId as string} AND device_epoch=${first.deviceEpoch as string} AND status='applied'`;
  const appliedCursor=contiguousCursor(applied.map(e=>e.producer_sequence),String(watermark.applied_cursor));
  await sql`UPDATE sync_watermark SET received_cursor=${receivedCursor}::numeric,applied_cursor=${appliedCursor}::numeric WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND device_id=${first.deviceId as string} AND device_epoch=${first.deviceEpoch as string}`;
  const all=await sql`SELECT raw_entry,status FROM sync_inbox WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND device_id=${first.deviceId as string} AND device_epoch=${first.deviceEpoch as string}`;
  const results:SyncAckEntry[]=normalized.map(raw=>{const row=all.find(row=>row.raw_entry.entryId===raw.entryId);return {entryId:raw.entryId as string,organizationId:scope.organizationId,venueId:scope.venueId,deviceId:raw.deviceId as string,deviceEpoch:raw.deviceEpoch as string,sequence:raw.sequence as string,payloadHash:raw.payloadHash as string,status:conflicts.has(raw.entryId as string)?'quarantined':row?.status??'rejected'};});
  return {schemaVersion:1,...scope,deviceId:first.deviceId as string,deviceEpoch:first.deviceEpoch as string,receivedCursor,appliedCursor,entries:results};
 });
}
export async function syncWatermark(scope:TenantScope,deviceId:string,deviceEpoch:string){return withTenant(scope,async sql=>{
 const [row]=await sql`SELECT received_cursor::text,applied_cursor::text FROM sync_watermark WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND device_id=${deviceId} AND device_epoch=${deviceEpoch}`;
 return {receivedCursor:row?.received_cursor??'0',appliedCursor:row?.applied_cursor??'0'};
});}
export async function pullEntries(scope:TenantScope,producer:{deviceId:string;deviceEpoch:string},after:string,limit=100){
 if(!/^(0|[1-9][0-9]*)$/.test(after)||limit<1||limit>100)throw new Error('INVALID_CURSOR');
 return withTenant(scope,async sql=>{
  const rows=await sql`SELECT raw_entry,status FROM sync_inbox WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND device_id=${producer.deviceId} AND device_epoch=${producer.deviceEpoch} AND producer_sequence>${after}::numeric ORDER BY producer_sequence LIMIT ${limit}`;
  const batch:typeof rows[number][]=[];
  for(const row of rows){if(Buffer.byteLength(JSON.stringify({entries:[...batch,row]}))>1048576-8192){if(!batch.length)throw new Error('JOURNAL_TOO_LARGE_FOR_PULL');break;}batch.push(row);}
  return batch;
 });
}
export type SyncJson=JsonValue;
