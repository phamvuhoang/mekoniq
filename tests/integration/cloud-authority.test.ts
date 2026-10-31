import {beforeAll,afterAll,expect,test} from 'vitest';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {setupWave02} from '../support/wave02-db';
import {ingestSignedBatch,journalSigningPayload} from '../../apps/cloud-web/src/server/modules/sync/ingest';
import {canonicalBytes,hashPayload} from '../../packages/contracts/src/canonical';
import {publishConfiguration,applyConfiguration} from '../../apps/cloud-web/src/server/modules/configuration/publish';
import {buildHandoffSnapshots} from '../../apps/cloud-web/src/server/modules/devices/handoff-checkpoint';
import {createDeviceProvision} from '../../apps/cloud-web/src/server/modules/devices/provision';
import {preset} from '../../packages/domain/src/policy/presets';
import type {Actor} from '../../apps/cloud-web/src/server/modules/identity/rbac';
import type {JsonObject,Mutation,JournalEntry} from '../../packages/contracts/generated/wire';
let db:Awaited<ReturnType<typeof setupWave02>>;const scope={organizationId:'authority-'+randomUUID(),venueId:'venue-a'};
const old=generateKeyPairSync('ec',{namedCurve:'P-256'}),replacement=generateKeyPairSync('ec',{namedCurve:'P-256'}),executor=generateKeyPairSync('ec',{namedCurve:'P-256'});
const actor:Actor={id:'manager',organizationId:scope.organizationId,venueIds:[scope.venueId],permissions:['*'],role:'owner'};
function mutation(kind:string,id:string,expectedVersion:number,newState:JsonObject):Mutation{return {ref:{...scope,kind,id},expectedVersion,newState};}
function signedEntry(deviceId:string,deviceEpoch:string,sequence:string,coordinatorEpoch:number,operationId:string,operationType:string,changes:Mutation[],keys:typeof old,commandPayload:JsonObject={operationId},kind:JournalEntry['kind']='accepted_fact'){
 const commandPayloadHash=hashPayload(commandPayload);const now=new Date().toISOString();
 const command={schemaVersion:1,...scope,deviceId,deviceEpoch,coordinatorEpoch,policyRevision:1,operationId,type:operationType,actorRef:actor.id,payload:commandPayload,payloadHash:commandPayloadHash,occurredAt:now,recordedAt:now};
 const commandFingerprint=hashPayload({...scope,type:operationType,actorRef:actor.id,deviceId,deviceEpoch,coordinatorEpoch,policyRevision:1,expectedVersion:null,payloadHash:commandPayloadHash});
 const payload={commandEnvelope:command,commandResult:{status:'accepted',value:{},duplicate:false,ack:'venue',operationId},commandFingerprint,events:changes.map(change=>({type:operationType==='Configuration.Apply'?'ConfigurationApplied':'OwnershipActivated',data:{kind:change.ref.kind,id:change.ref.id,state:change.newState}})),mutations:changes as unknown as JsonObject[],operationType,commandPayloadHash};
 const first=changes[0]!;const entry:JournalEntry={schemaVersion:1,...scope,entryId:randomUUID(),operationId,deviceId,deviceEpoch,sequence,coordinatorEpoch,aggregateType:first.ref.kind,aggregateId:first.ref.id,expectedVersion:first.expectedVersion,resultingVersion:first.expectedVersion+1,kind,occurredAt:new Date().toISOString(),recordedAt:new Date().toISOString(),timezone:'UTC',businessDate:'2026-10-30',clockConfidence:'trusted',actorRef:actor.id,payload, payloadHash:hashPayload(payload),signature:''};
 entry.signature=sign('sha256',canonicalBytes(journalSigningPayload(entry as unknown as Record<string,unknown>)),{key:keys.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');return entry;
}
beforeAll(async()=>{
 db=await setupWave02();await db.admin`INSERT INTO venue(organization_id,id,name) VALUES(${scope.organizationId},${scope.venueId},'Authority venue')`;
 for(const [id,epoch,keys] of [['old','old-epoch',old],['new','new-epoch',replacement]] as const)await db.admin`INSERT INTO device_enrollment(organization_id,venue_id,device_id,device_epoch,public_jwk,certificate_fingerprint,status) VALUES(${scope.organizationId},${scope.venueId},${id},${epoch},${db.admin.json(keys.publicKey.export({format:'jwk'}) as Record<string,string>)},${'a'.repeat(64)},'active')`;
 await db.admin`INSERT INTO venue_ownership(organization_id,venue_id,resource_id,owner_device_id,owner_device_epoch,epoch,status) VALUES(${scope.organizationId},${scope.venueId},'coordinator','old','old-epoch',1,'active'),(${scope.organizationId},${scope.venueId},'robot:sim-1','old','old-epoch',4,'active')`;
 await db.admin`INSERT INTO authority(organization_id,venue_id,coordinator_epoch,policy_revision) VALUES(${scope.organizationId},${scope.venueId},1,1)`;
 await db.admin`INSERT INTO sync_projection(organization_id,venue_id,aggregate_type,aggregate_id,version,state,entry_id) VALUES(${scope.organizationId},${scope.venueId},'robot','sim-1',1,${db.admin.json({ownerDeviceId:'old',controlEpoch:4,executorPublicJwk:executor.publicKey.export({format:'jwk'}) as Record<string,string>})},'robot-seed')`;
});afterAll(async()=>{if(db)await db.close();});
test('a verified handoff atomically changes cloud owner fences and accepts only the replacement epoch',async()=>{
 const checkpointHash='a'.repeat(64),handoffId='handoff-1';
 function proof(resourceId:string,oldEpoch:number,keys:typeof old){const value={...scope,resourceId,oldEpoch,newEpoch:oldEpoch+1,oldOwnerDeviceId:'old',newOwnerDeviceId:'new',handoffId,checkpointHash,status:'fenced'};return {...value,signature:sign('sha256',canonicalBytes(value),{key:keys.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url')};}
 const proofs=[proof('coordinator',1,old),proof('robot:sim-1',4,executor)];
 const ownership={owner:'new',newDeviceId:'new',deviceEpoch:'new-epoch',publicJwk:replacement.publicKey.export({format:'jwk'}) as Record<string,string>,epoch:2,status:'active',fenced:true,executorEpochAck:true,cursorComplete:true,checkpointHash,handoffId,proofs};
 const changes=[mutation('ownership',scope.venueId,0,ownership),mutation('robot','sim-1',1,{ownerDeviceId:'new',controlEpoch:5,executorPublicJwk:executor.publicKey.export({format:'jwk'}) as Record<string,string>,fencingProof:proofs[1]!})];
 const handoff=signedEntry('old','old-epoch','1',1,'activate-1','Ownership.Activate',changes,old);expect((await ingestSignedBatch(scope,[handoff])).entries[0].status).toBe('applied');
 const rows=await db.admin`SELECT resource_id,owner_device_id,owner_device_epoch,epoch FROM venue_ownership WHERE organization_id=${scope.organizationId} ORDER BY resource_id`;expect(rows.map(r=>[r.resource_id,r.owner_device_id,r.owner_device_epoch,Number(r.epoch)])).toEqual([['coordinator','new','new-epoch',2],['robot:sim-1','new','new-epoch',5]]);
 const next=signedEntry('new','new-epoch','1',2,'new-order','Order.Place',[mutation('order','order-1',0,{status:'accepted',totalMinor:'50000'})],replacement);expect((await ingestSignedBatch(scope,[next])).entries[0].status).toBe('applied');
 const stale=signedEntry('old','old-epoch','2',1,'stale-order','Order.Place',[mutation('order','order-stale',0,{status:'accepted'})],old);expect((await ingestSignedBatch(scope,[stale])).entries[0].status).toBe('quarantined');
});
test('configuration authority advances only from the published signed committed fact, then ACK matches its original command hash',async()=>{
 const device={...actor,deviceId:'new',deviceEpoch:'new-epoch'};const first=await publishConfiguration(actor,scope,{expectedRevision:0,features:preset('cash-only').features});
 await expect(applyConfiguration(device,scope,{revision:1,coordinatorEpoch:2,receiptHash:'a'.repeat(64)})).rejects.toThrow('CONFIGURATION_RECEIPT_PENDING');
 for(const [revision,sequence] of [[1,'2'],[2,'3']] as const){
  const publication=revision===1?first:await publishConfiguration(actor,scope,{expectedRevision:1,features:preset('cash-only').features});
  const input={revision,features:publication.features,readiness:{}},payloadHash=hashPayload(input),operationId='config-'+revision;
  const entry=signedEntry('new','new-epoch',sequence,2,operationId,'Configuration.Apply',[mutation('configuration','applied',revision-1,{revision,features:publication.features,readiness:{},appliedAt:new Date().toISOString()})],replacement,input);
  expect((await ingestSignedBatch(scope,[entry])).entries[0].status).toBe('applied');
  const receiptHash=hashPayload({operationId,revision,payloadHash});expect((await applyConfiguration(device,scope,{revision,coordinatorEpoch:2,receiptHash})).status).toBe('applied');
 }
 process.env.DEVICE_GRANT_PRIVATE_KEY=JSON.stringify(generateKeyPairSync('ec',{namedCurve:'P-256'}).privateKey.export({format:'jwk'}));
 const provision=await createDeviceProvision(actor,scope,'new');expect(provision.authority.grant.coordinatorEpoch).toBe(2);expect(provision.authority.grant.policyRevision).toBe(2);expect(provision.authority.grant.previousCoordinatorEpoch).toBe(1);
});

test('disabled publication accepts owner-proven draining while preserving the desired configuration',async()=>{
 const publication=await publishConfiguration(actor,scope,{expectedRevision:2,features:preset('robot-only').features});
 const effective=structuredClone(publication.features);effective.orders!.status='draining';
 const input={revision:3,features:publication.features,readiness:{}},payloadHash=hashPayload(input),operationId='config-drain';
 const entry=signedEntry('new','new-epoch','4',2,operationId,'Configuration.Apply',[mutation('configuration','applied',2,{revision:3,features:effective,readiness:{},appliedAt:new Date().toISOString()})],replacement,input);
 expect((await ingestSignedBatch(scope,[entry])).entries[0].status).toBe('applied');
 await applyConfiguration({...actor,deviceId:'new',deviceEpoch:'new-epoch'},scope,{revision:3,coordinatorEpoch:2,receiptHash:hashPayload({operationId,revision:3,payloadHash})});
 const [desired]=await db.admin`SELECT features,status FROM configuration_revision WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND revision=3`;
 const [actual]=await db.admin`SELECT state FROM sync_projection WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND aggregate_type='configuration' AND aggregate_id='applied'`;
 expect(desired!.features.orders.status).toBe('disabled');expect(desired!.status).toBe('applied');expect(actual!.state.features.orders.status).toBe('draining');
});

test('handoff reconstructs canonical owner historical receipts and includes all enrolled peers',async()=>{
 const importEntry=signedEntry('new','new-epoch','5',2,'historical-1','Import.ApplyRow',[mutation('historical-receipt','paper-1',0,{amountMinor:'50000'}),mutation('source-link','link-1',0,{receiptId:'paper-1'})],replacement,{},'historical_import');
 expect((await ingestSignedBatch(scope,[importEntry])).entries[0].status).toBe('applied');
 const peer=generateKeyPairSync('ec',{namedCurve:'P-256'});
 await db.admin`INSERT INTO device_enrollment(organization_id,venue_id,device_id,device_epoch,public_jwk,status) VALUES(${scope.organizationId},${scope.venueId},'peer','peer-epoch',${db.admin.json(peer.publicKey.export({format:'jwk'}) as Record<string,string>)},'active')`;
 const provision=await createDeviceProvision(actor,scope,'new');const snapshots=provision.authority.grant.handoffSnapshots!;
 expect(snapshots.find(s=>s.ref.kind==='historical-receipt'&&s.ref.id==='paper-1')?.state.amountMinor).toBe('50000');
 expect(snapshots.find(s=>s.ref.kind==='source-link'&&s.ref.id==='link-1')?.state.receiptId).toBe('paper-1');
 expect(snapshots.find(s=>s.ref.kind==='device'&&s.ref.id==='peer')?.state).toMatchObject({deviceEpoch:'peer-epoch',status:'active'});
 expect(()=>buildHandoffSnapshots(scope,[{...importEntry,deviceId:'peer',deviceEpoch:'peer-epoch'}],[],[],{deviceId:'new',deviceEpoch:'new-epoch',epoch:2})).toThrow('HANDOFF_HISTORICAL_OWNER_UNVERIFIED');
});

test('replacement provision signs the complete active checkpoint and original durable receipts',async()=>{
 const provision=await createDeviceProvision(actor,scope,'new');const grant=provision.authority.grant;
 expect(grant).toHaveProperty('handoffReceiptsComplete',true);
 expect(grant).toHaveProperty('handoffReceiptCount',6);
 const snapshots=(grant as unknown as {handoffSnapshots:{ref:{kind:string};state:{status?:string;owner?:string}}[]}).handoffSnapshots;
 expect(snapshots.find(s=>s.ref.kind==='ownership')?.state).toMatchObject({status:'active',owner:'new'});
 expect((grant as unknown as {handoffEntries:JournalEntry[]}).handoffEntries.map(e=>e.operationId)).toContain('new-order');
 const [row]=await db.admin`SELECT raw_entry FROM sync_inbox WHERE organization_id=${scope.organizationId} AND operation_id='new-order'`;
 const incomplete=row!.raw_entry as JournalEntry;delete incomplete.payload.commandEnvelope;incomplete.payloadHash=hashPayload(incomplete.payload);incomplete.signature=sign('sha256',canonicalBytes(journalSigningPayload(incomplete as unknown as Record<string,unknown>)),{key:replacement.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
 await db.admin`UPDATE sync_inbox SET raw_entry=${db.admin.json(incomplete as unknown as JsonObject)} WHERE organization_id=${scope.organizationId} AND operation_id='new-order'`;
 await expect(createDeviceProvision(actor,scope,'new')).rejects.toThrow('HANDOFF_RECEIPT_METADATA_MISSING');
});
