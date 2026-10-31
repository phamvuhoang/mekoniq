import {expect,test} from 'vitest';
import {mayEmitLiveEffect,liveEffectAllowed} from '../../packages/sync/src/effect-policy';
test('historical facts cannot enqueue physical or financial actions',()=>{
 for(const kind of ['accepted_fact','observation','historical_import'] as const)expect(mayEmitLiveEffect(kind)).toBe(false);
 expect(mayEmitLiveEffect('intent')).toBe(true);
});
test('intent alone cannot bypass epoch, safety, expiry or unknown receipt',()=>{
 const authorized={kind:'intent' as const,scopeMatches:true,epochMatches:true,policyAllowed:true,expiresAtMs:2000,nowMs:1000,durableReceipt:'none' as const};
 expect(liveEffectAllowed(authorized)).toBe(true);
 expect(liveEffectAllowed({...authorized,epochMatches:false})).toBe(false);expect(liveEffectAllowed({...authorized,durableReceipt:'unknown'})).toBe(false);expect(liveEffectAllowed({...authorized,nowMs:3000})).toBe(false);
});
import {beforeAll,afterAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {setupWave02} from '../support/wave02-db';
import {enqueueRelay,recordVenueReceipt} from '../../apps/cloud-web/src/server/modules/relay/commands';
import {hashPayload} from '../../packages/contracts/src/canonical';
import type {Actor} from '../../apps/cloud-web/src/server/modules/identity/rbac';
import type {CommandEnvelope} from '../../packages/contracts/generated/wire';
let db:Awaited<ReturnType<typeof setupWave02>>;const scope={organizationId:'relay-org-'+randomUUID(),venueId:'venue-a'};
const actor:Actor={id:'owner',organizationId:scope.organizationId,venueIds:[scope.venueId],permissions:['*'],role:'owner'};
beforeAll(async()=>{db=await setupWave02();await db.admin`INSERT INTO venue(organization_id,id,name) VALUES(${scope.organizationId},${scope.venueId},'Relay venue')`;await db.admin`INSERT INTO venue_ownership(organization_id,venue_id,resource_id,owner_device_id,owner_device_epoch,epoch,status) VALUES(${scope.organizationId},${scope.venueId},'coordinator','coordinator','epoch-coordinator',1,'active')`;});afterAll(async()=>{if(db)await db.close();});
test('cloud receipt stays pending and only a venue receipt proves acceptance',async()=>{
 const payload={note:'A'};const command:CommandEnvelope={schemaVersion:1,...scope,operationId:'relay-one',type:'Order.Place',actorRef:actor.id,deviceId:'cloud-web',deviceEpoch:'cloud-web-v1',coordinatorEpoch:1,policyRevision:1,occurredAt:'2026-10-30T00:00:00Z',recordedAt:'2026-10-30T00:00:00Z',payload,payloadHash:hashPayload(payload)};
 const expiry=new Date(Date.now()+60000).toISOString();expect((await enqueueRelay(actor,command,expiry)).status).toBe('pending');
 await expect(enqueueRelay(actor,{...command,type:'Order.Cancel'},expiry)).rejects.toThrow('IDEMPOTENCY_CONFLICT');
 const device={...actor,deviceId:'coordinator',deviceEpoch:'epoch-coordinator'};
 await recordVenueReceipt(device,scope,{coordinatorEpoch:1,result:{status:'accepted',value:{orderId:'order-1'},duplicate:false,ack:'venue',operationId:command.operationId}});
 const duplicate=await enqueueRelay(actor,command,'2020-01-01T00:00:00Z');expect(duplicate.status).toBe('accepted');expect(duplicate.duplicate).toBe(true);
});
test('relay permission cannot elevate a chef into billing or maintenance commands',async()=>{
 const chef={...actor,id:'chef',permissions:['relay.write','kitchen.write'],role:'chef'};const payload={};
 const command:CommandEnvelope={schemaVersion:1,...scope,operationId:'relay-forbidden',type:'Import.Apply',actorRef:chef.id,deviceId:'cloud-web',deviceEpoch:'cloud-web-v1',coordinatorEpoch:1,policyRevision:1,occurredAt:'2026-10-30T00:00:00Z',recordedAt:'2026-10-30T00:00:00Z',payload,payloadHash:hashPayload(payload)};
 await expect(enqueueRelay(chef,command,new Date(Date.now()+60000).toISOString())).rejects.toThrow('PERMISSION_DENIED');
});
import {generateKeyPairSync} from 'node:crypto';
import {createSupabaseActor} from '../support/supabase-auth';
import {actorFromToken} from '../../apps/cloud-web/src/server/modules/identity/session';
import {pendingRelay} from '../../apps/cloud-web/src/server/modules/relay/commands';
import {verifyGrant} from '../../apps/cloud-web/src/server/modules/devices/grants';
test('relay delegation binds the full command, recipient epoch and current actor membership',async()=>{
 const user=await createSupabaseActor(db.admin,scope);const signer=generateKeyPairSync('ec',{namedCurve:'P-256'});process.env.DEVICE_GRANT_PRIVATE_KEY=JSON.stringify(signer.privateKey.export({format:'jwk'}));
 const principal=await actorFromToken(user.accessToken);expect(principal).not.toBeNull();
 const payload={note:'delegated'};const command:CommandEnvelope={schemaVersion:1,...scope,operationId:'relay-delegation',type:'Catalog.Publish',actorRef:user.id,deviceId:'cloud-web',deviceEpoch:'cloud-web-v1',coordinatorEpoch:1,policyRevision:1,occurredAt:new Date().toISOString(),recordedAt:new Date().toISOString(),payload,payloadHash:hashPayload(payload)};
 try{
  await enqueueRelay(principal!,command,new Date(Date.now()+60000).toISOString());
  const device={...actor,deviceId:'coordinator',deviceEpoch:'epoch-coordinator'};const queued=await pendingRelay(device,scope);const next=queued.find(q=>q.command.operationId===command.operationId);expect(next).toBeTruthy();
  expect(next!.authorization.grant.commandHash).toBe(hashPayload({...command}));expect(next!.authorization.grant.recipientDeviceEpoch).toBe('epoch-coordinator');
  expect(verifyGrant({payload:next!.authorization.grant,signature:next!.authorization.signature},signer.publicKey.export({format:'jwk'}))).toBe(true);
  await db.admin`UPDATE venue_membership SET active=false WHERE user_id=${user.id}::uuid`;
  const revoked=(await pendingRelay(device,scope)).find(q=>q.command.operationId===command.operationId);expect(revoked?.authorization.grant.receiptOnly).toBe(true);expect(revoked?.authorization.grant.permissions).toEqual([]);
  const [stillPending]=await db.admin`SELECT status FROM relay_command WHERE organization_id=${scope.organizationId} AND operation_id=${command.operationId}`;expect(stillPending.status).toBe('pending');
 }finally{await user.cleanup();}
});
test('expired pending commands are receipt-only reconciliations, never fresh execution rights',async()=>{
 const user=await createSupabaseActor(db.admin,scope);const principal=await actorFromToken(user.accessToken);const payload={note:'expired'};
 const command:CommandEnvelope={schemaVersion:1,...scope,operationId:'relay-expired',type:'Catalog.Publish',actorRef:user.id,deviceId:'cloud-web',deviceEpoch:'cloud-web-v1',coordinatorEpoch:1,policyRevision:1,occurredAt:new Date().toISOString(),recordedAt:new Date().toISOString(),payload,payloadHash:hashPayload(payload)};
 try{
  await enqueueRelay(principal!,command,new Date(Date.now()+60000).toISOString());await db.admin`UPDATE relay_command SET expires_at=now()-interval '1 minute' WHERE organization_id=${scope.organizationId} AND operation_id=${command.operationId}`;
  const queued=await pendingRelay({...actor,deviceId:'coordinator',deviceEpoch:'epoch-coordinator'},scope);const expired=queued.find(q=>q.command.operationId===command.operationId);expect(expired?.authorization.grant.receiptOnly).toBe(true);expect(expired?.authorization.grant.permissions).toEqual([]);expect(Date.parse(expired!.authorization.grant.expiresAt)).toBeGreaterThan(Date.now());
 }finally{await user.cleanup();}
});
