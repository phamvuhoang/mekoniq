import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync,sign,randomUUID} from 'node:crypto';
import postgres from 'postgres';
import {hashPayload} from '../../packages/contracts/src/index';
import type {CommandEnvelope,CommitBatch,JsonObject} from '../../packages/contracts/src/index';
import {openStore} from '../../packages/sync/src/store';
export function command(operationId:string,payload:JsonObject={},overrides:Partial<CommandEnvelope>={}):CommandEnvelope {
  return {schemaVersion:1,organizationId:'org-a',venueId:'venue-a',operationId,type:'Journal.RecordNote',actorRef:'cashier',deviceId:'device-a',deviceEpoch:'epoch-a',coordinatorEpoch:1,policyRevision:1,occurredAt:'2026-10-30T00:00:00Z',recordedAt:'2026-10-30T00:00:00Z',payload,payloadHash:hashPayload(payload),...overrides};
}
export function batch(c:CommandEnvelope):CommitBatch {
  return {command:c,expectedAuthority:{coordinatorEpoch:1,policyRevision:1},mutations:[{ref:{organizationId:c.organizationId,venueId:c.venueId,kind:'note',id:'note-1'},expectedVersion:0,newState:{note:c.payload.note??'note'}}],events:[{type:'NoteRecorded',data:{note:c.payload.note??'note'}}],effects:[],result:{status:'accepted',value:{},duplicate:false,ack:'local',operationId:c.operationId}};
}
const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'P-256'});
export const testPublicJwk=publicKey.export({format:'jwk'});
export const testPrivateJwk=privateKey.export({format:'jwk'});
export const testSigner=(bytes:Uint8Array)=>sign('sha256',bytes,{key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
export async function storageCase(driver:'sqlite'|'postgres') {
  const directory=await mkdtemp(join(tmpdir(),'mekoniq-store-'));
  const scope={organizationId:`org-${randomUUID()}`,venueId:'venue-test'};
  const url=driver==='sqlite'?join(directory,'journal.db'):process.env.TEST_DATABASE_URL??'postgresql://mekoniq_app:local_test_only@127.0.0.1:57422/postgres';
  return {name:driver,scope,url,command:(id:string,p:JsonObject={})=>command(id,p,scope),batch,
    open:async()=>{const store=await openStore({driver,url,signer:testSigner});await store.provision(scope,1,1);return store;},
    destroy:async()=>{
      if(driver==='postgres') {
        const sql=postgres(url,{max:1,prepare:false});
        await sql.begin(async tx=>{
          await tx.unsafe("select set_config('app.organization_id',$1,true),set_config('app.venue_id',$2,true)",[scope.organizationId,scope.venueId]);
          for(const table of ['authority','aggregate_snapshot','operation_receipt','journal','audit','domain_event','outbox']) await tx.unsafe(`DELETE FROM ${table} WHERE organization_id=$1 AND venue_id=$2`,[scope.organizationId,scope.venueId]);
        });await sql.end();
      }
      await rm(directory,{recursive:true,force:true});
    }
  };
}
