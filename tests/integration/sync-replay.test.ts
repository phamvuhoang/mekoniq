import {command as makeCommand} from '../support/storage-cases';
import {beforeAll,afterAll,expect,test} from 'vitest';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {setupWave02} from '../support/wave02-db';
import {contiguousCursor} from '../../packages/sync/src/cursor';
import {ingestSignedBatch,journalSigningPayload,syncWatermark} from '../../apps/cloud-web/src/server/modules/sync/ingest';
import {canonicalBytes,hashPayload} from '../../packages/contracts/src/canonical';
import type {JournalEntry} from '../../packages/contracts/generated/wire';
let db:Awaited<ReturnType<typeof setupWave02>>;
const scope={organizationId:'sync-org-'+randomUUID(),venueId:'venue-a'};
const keys=generateKeyPairSync('ec',{namedCurve:'P-256'});
function entry(sequence:string,version=Number(sequence),schemaVersion=1){
 const payload={text:'note-'+sequence};const value={schemaVersion,entryId:scope.organizationId+'-entry-'+sequence,operationId:scope.organizationId+'-op-'+sequence,...scope,deviceId:'coordinator',deviceEpoch:'epoch-a',sequence,coordinatorEpoch:1,aggregateType:'note',aggregateId:'note-1',expectedVersion:version-1,resultingVersion:version,kind:'accepted_fact',occurredAt:'2026-10-30T00:00:00Z',recordedAt:'2026-10-30T00:00:00Z',timezone:'Asia/Ho_Chi_Minh',businessDate:'2026-10-30',clockConfidence:'trusted',actorRef:'cashier',payload,payloadHash:hashPayload(payload),signature:''};
 value.signature=sign('sha256',canonicalBytes(journalSigningPayload(value)),{key:keys.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');return value;
}
beforeAll(async()=>{db=await setupWave02();await db.admin`INSERT INTO venue(organization_id,id,name) VALUES(${scope.organizationId},${scope.venueId},'Sync venue')`;
 await db.admin`INSERT INTO device_enrollment(organization_id,venue_id,device_id,device_epoch,public_jwk,status) VALUES(${scope.organizationId},${scope.venueId},'coordinator','epoch-a',${db.admin.json(keys.publicKey.export({format:'jwk'}) as Record<string,string>)},'active')`;
 await db.admin`INSERT INTO venue_ownership(organization_id,venue_id,resource_id,owner_device_id,owner_device_epoch,epoch,status) VALUES(${scope.organizationId},${scope.venueId},'coordinator','coordinator','epoch-a',1,'active')`;
});
afterAll(async()=>{if(db)await db.close();});
test('out-of-order entries cannot advance ACK across a gap',()=>{
 expect(contiguousCursor(['1','3'],'0')).toBe('1');expect(contiguousCursor(['2','3'],'1')).toBe('3');
 expect(contiguousCursor(['9007199254740993'],'9007199254740992')).toBe('9007199254740993');
});
test('commit ACK is durable; gaps fill without duplicate projection',async()=>{
 const a=entry('1'),b=entry('2'),c=entry('3');
 expect((await ingestSignedBatch(scope,[a,c])).receivedCursor).toBe('1');
 const filled=await ingestSignedBatch(scope,[b,c]);expect(filled.receivedCursor).toBe('3');expect(filled.appliedCursor).toBe('3');
 const replay=await ingestSignedBatch(scope,[a,b,c]);expect(replay.appliedCursor).toBe('3');
 const rows=await db.admin`SELECT count(*)::int AS count FROM sync_inbox WHERE organization_id=${scope.organizationId}`;expect(rows[0].count).toBe(3);
 expect(await syncWatermark(scope,'coordinator','epoch-a')).toEqual({receivedCursor:'3',appliedCursor:'3'});
});
test('valid signed unsupported schema remains raw in quarantine and does not advance applied cursor',async()=>{
 const unsupported=entry('4',4,2);const result=await ingestSignedBatch(scope,[unsupported]);
 expect(result.receivedCursor).toBe('4');expect(result.appliedCursor).toBe('3');expect(result.entries[0].status).toBe('quarantined');
 const rows=await db.admin`SELECT raw_entry FROM sync_inbox WHERE organization_id=${scope.organizationId} AND producer_sequence=4`;expect(rows[0].raw_entry).toEqual(unsupported);
});
test('invalid signatures and changed content never overwrite committed facts',async()=>{
 const invalid=entry('5',5);invalid.signature='AAAA';await expect(ingestSignedBatch(scope,[invalid])).rejects.toThrow('INVALID_SIGNATURE');
 const changed=entry('1');changed.payload.text='changed';changed.payloadHash=hashPayload(changed.payload);changed.signature=sign('sha256',canonicalBytes(journalSigningPayload(changed)),{key:keys.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
 expect((await ingestSignedBatch(scope,[changed])).entries[0].status).toBe('quarantined');
 const conflicts=await db.admin`SELECT raw_json FROM quarantine WHERE organization_id=${scope.organizationId} AND reason='IDEMPOTENCY_CONFLICT'`;expect(conflicts.length).toBe(1);
 const rows=await db.admin`SELECT raw_entry FROM sync_inbox WHERE organization_id=${scope.organizationId} AND producer_sequence=1`;expect((rows[0].raw_entry as JournalEntry).payload.text).toBe('note-1');
});
test('a first isolated observation may reference a cached shared version without becoming its writer',async()=>{
 const observed=entry('5',4);observed.kind='observation';observed.aggregateType='grant';observed.aggregateId='grant-offline';observed.signature=sign('sha256',canonicalBytes(journalSigningPayload(observed)),{key:keys.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
 const result=await ingestSignedBatch(scope,[observed]);expect(result.entries[0].status).toBe('applied');
 const rows=await db.admin`SELECT aggregate_type,version FROM sync_projection WHERE organization_id=${scope.organizationId} AND aggregate_id='grant-offline'`;
 expect(rows).toHaveLength(1);expect(rows[0].aggregate_type).toBe('observation:coordinator:grant');expect(rows[0].version).toBe(4);
});
test.each(['intent-first','fact-first','mismatch'] as const)('accepted owner decision resolves only matching original intent: %s',async(order)=>{
 const peerKeys=generateKeyPairSync('ec',{namedCurve:'P-256'}),peerId='peer-'+order;
 await db.admin`INSERT INTO device_enrollment(organization_id,venue_id,device_id,device_epoch,public_jwk,status) VALUES(${scope.organizationId},${scope.venueId},${peerId},'peer-epoch',${db.admin.json(peerKeys.publicKey.export({format:'jwk'}) as Record<string,string>)},'active')`;
 const op='lifecycle-'+order+scope.organizationId,c=makeCommand(op,{note:'original'},{...scope,type:'Session.Open',actorRef:'cashier',deviceId:peerId,deviceEpoch:'peer-epoch'});
 const intent=entry('1');intent.deviceId=peerId;intent.deviceEpoch='peer-epoch';intent.kind='intent';intent.entryId=peerId+scope.organizationId;intent.operationId=op;intent.payload={commandEnvelope:c} as unknown as typeof intent.payload;intent.payloadHash=hashPayload(intent.payload);intent.signature=sign('sha256',canonicalBytes(journalSigningPayload(intent)),{key:peerKeys.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
 const accepted=entry(String(6+['intent-first','fact-first','mismatch'].indexOf(order)),1);accepted.operationId=op;accepted.aggregateId='lifecycle-'+order;
 const retry={...c,occurredAt:'2026-10-30T01:00:00Z',recordedAt:'2026-10-30T01:00:01Z',...(order==='mismatch'?{policyRevision:c.policyRevision+1}:{})};
 accepted.payload={commandEnvelope:retry} as unknown as typeof accepted.payload;accepted.payloadHash=hashPayload(accepted.payload);accepted.signature=sign('sha256',canonicalBytes(journalSigningPayload(accepted)),{key:keys.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
 if(order==='fact-first'){expect((await ingestSignedBatch(scope,[accepted])).entries[0].status).toBe('applied');await ingestSignedBatch(scope,[intent]);}
 else {expect((await ingestSignedBatch(scope,[intent])).entries[0].status).toBe('pending');expect((await ingestSignedBatch(scope,[accepted])).entries[0].status).toBe('applied');}
 const rows=await db.admin`SELECT raw_entry,status,reason FROM sync_inbox WHERE organization_id=${scope.organizationId} AND operation_id=${op}`;expect(rows).toHaveLength(2);expect(rows.map(row=>row.raw_entry.signature).sort()).toEqual([intent.signature,accepted.signature].sort());
 const raw=rows.find(row=>row.raw_entry.kind==='intent')!;expect(raw.status).toBe(order==='mismatch'?'quarantined':'applied');expect(raw.reason).toBe(order==='mismatch'?'OWNER_COMMAND_CONFLICT':'OWNER_DECISION_RECORDED');
 expect(await syncWatermark(scope,peerId,'peer-epoch')).toEqual({receivedCursor:'1',appliedCursor:order==='mismatch'?'0':'1'});
});
