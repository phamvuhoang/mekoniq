import type {Lab} from './lab';
import {setupWave02} from './wave02-db';
import {testPublicJwk} from './storage-cases';
import {ingestSignedBatch} from '../../apps/cloud-web/src/server/modules/sync/ingest';
import type {JsonObject} from '../../packages/contracts/src/index';
import {ingestSettlementObservation} from '../../packages/sync/src/settlement-observations';
import {ingestContinuityObservation} from '../../packages/sync/src/continuity-observations';
export async function syncLab(lab:Lab) {
  const db=await setupWave02(),scope=lab.scope;
  try {
    await db.admin`INSERT INTO venue(organization_id,id,name) VALUES(${scope.organizationId},${scope.venueId},'Durable test venue') ON CONFLICT DO NOTHING`;
    await db.admin`INSERT INTO device_enrollment(organization_id,venue_id,device_id,device_epoch,public_jwk,status) VALUES(${scope.organizationId},${scope.venueId},'coordinator','epoch-1',${db.admin.json(testPublicJwk as Record<string,string>)},'active') ON CONFLICT DO NOTHING`;
    await db.admin`INSERT INTO venue_ownership(organization_id,venue_id,resource_id,owner_device_id,owner_device_epoch,epoch,status) VALUES(${scope.organizationId},${scope.venueId},'coordinator','coordinator','epoch-1',1,'active') ON CONFLICT DO NOTHING`;
    for(const seed of lab.initialSnapshots())await db.admin`INSERT INTO sync_projection(organization_id,venue_id,aggregate_type,aggregate_id,version,state,entry_id) VALUES(${scope.organizationId},${scope.venueId},${seed.kind},${seed.id},${seed.version},${db.admin.json(seed.state)},'fixture-genesis') ON CONFLICT DO NOTHING`;
    for(const [deviceId,store] of lab.devices()) {
      const entries=await store.journal(scope);if(!entries.length)continue;
      await db.admin`INSERT INTO device_enrollment(organization_id,venue_id,device_id,device_epoch,public_jwk,status) VALUES(${scope.organizationId},${scope.venueId},${deviceId},'epoch-1',${db.admin.json(testPublicJwk as Record<string,string>)},'active') ON CONFLICT DO NOTHING`;
      for(let offset=0;offset<entries.length;offset+=100) {
        const ack=await ingestSignedBatch(scope,entries.slice(offset,offset+100));
        if(lab.faults.consume('drop-cloud-ack'))throw new Error('CLOUD_ACK_LOST');
        await store.acknowledge(ack);
        for(const receipt of ack.entries)if(receipt.status==='applied')lab.markCloudApplied(receipt.entryId);
      }
    }
    // Observation promotion deliberately invokes a separate reconciliation command;
    // original raw producer entries remain untouched in PostgreSQL sync_inbox.
    for(const [deviceId,store] of lab.devices()) {
      if(deviceId==='coordinator')continue;
      for(const entry of await store.journal(scope))if(['Continuity.CaptureTicket','Continuity.RecordPaymentObservation'].includes(String(entry.payload.operationType))) {
        const result=await ingestContinuityObservation(await lab.getStore('coordinator'),entry);
        if(result.status!=='accepted')throw new Error(`CAPTURE_MERGE_${result.code}`);
      }
      const observations=(await store.journal(scope)).filter(e=>['SettlementGrant.Use','SettlementGrant.Return'].includes(String(e.payload.operationType))).sort((a,b)=>BigInt(a.sequence)<BigInt(b.sequence)?-1:1);
      for(const entry of observations) {
        const result=await ingestSettlementObservation(await lab.getStore('coordinator'),entry);
        if(result.status!=='accepted')throw new Error(`SETTLEMENT_MERGE_${result.code}`);
      }
    }
    const coordinator=await lab.getStore('coordinator'),entries=await coordinator.journal(scope);
    for(let offset=0;offset<entries.length;offset+=100){const ack=await ingestSignedBatch(scope,entries.slice(offset,offset+100));await coordinator.acknowledge(ack);for(const receipt of ack.entries)if(receipt.status==='applied')lab.markCloudApplied(receipt.entryId);}
  }finally{await db.close();}
}
export type ObservedTicket=JsonObject;
