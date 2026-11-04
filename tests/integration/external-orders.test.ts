import {afterAll,beforeAll,expect,test} from 'vitest';
import {randomUUID} from 'node:crypto';
import {setupWave02} from '../support/wave02-db';
import {createRestaurantLab} from '../support/restaurant-lab';
import fixture from '../fixtures/restaurant-v1.json';
import type {JsonObject} from '../../packages/contracts/src/index';
import {rolePermissions,type Actor} from '../../apps/cloud-web/src/server/modules/identity/rbac';
import {issueChannelCredential,revokeChannelCredential} from '../../apps/cloud-web/src/server/modules/channels/credentials';
import {receiveExternalOrder,externalOrderStatus} from '../../apps/cloud-web/src/server/modules/channels/ingress';
import {refreshFromVenue,sweepExternalOrder,resolveDeadLetter} from '../../apps/cloud-web/src/server/modules/channels/restaurant-ack';
import {runJobBatch} from '../../apps/cloud-web/src/server/jobs/outbox-worker';
import {setConnectorResolver,resolveConnector,defaultJobRegistry} from '../../apps/cloud-web/src/server/jobs/registry';
import {dispatchRequest} from '../../apps/cloud-web/src/server/route-registry';
import {KEY_HEADER,SIGNATURE_HEADER,TIMESTAMP_HEADER,signWebhook,verifyWebhook} from '../../integrations/core/src/webhook-signature';
import {createSandboxChannel} from '../../integrations/core/src/sandbox';
import {classifyReceipt,payloadFingerprint} from '../../integrations/core/src/external-ids';
import {advance,onVenueSilent} from '../../integrations/core/src/inbox';
import {jobOutcome} from '../../integrations/core/src/outbox';
import {profileFor} from '../../integrations/core/src/connector';
let db:Awaited<ReturnType<typeof setupWave02>>;
const org='ext-org-'+randomUUID(),scope={organizationId:org,venueId:'venue-a'};
const owner:Actor={id:'owner',organizationId:org,venueIds:['venue-a'],permissions:rolePermissions('owner'),role:'owner'};
const cashier:Actor={id:'cashier',organizationId:org,venueIds:['venue-a'],permissions:rolePermissions('cashier'),role:'cashier'};
let key:{keyId:string;secret:string},rejectKey:{keyId:string;secret:string};
const NOW=Date.now();
const body=(over:JsonObject={})=>JSON.stringify({merchantId:'shop-1',externalId:'ext-1',currency:'VND',items:[{itemId:'tea',quantity:'1'}],expiresAt:new Date(NOW+3600_000).toISOString(),...over});
function headers(k=key,raw='',ts=NOW){return new Headers({[KEY_HEADER]:k.keyId,[TIMESTAMP_HEADER]:String(ts),[SIGNATURE_HEADER]:signWebhook(k.secret,ts,raw)});}
const send=(raw:string,k=key,provider='sandbox-channel',ts=NOW)=>receiveExternalOrder({provider,rawBody:raw,headers:headers(k,raw,ts),nowMs:NOW});
beforeAll(async()=>{
 process.env.CHANNEL_SECRET_MASTER='m'.repeat(40);
 db=await setupWave02();
 await db.admin`INSERT INTO venue(organization_id,id,name) VALUES(${org},'venue-a','A')`;
 await db.admin`INSERT INTO authority(organization_id,venue_id,coordinator_epoch,policy_revision) VALUES(${org},'venue-a',1,1)`;
 await db.admin`INSERT INTO venue_ownership(organization_id,venue_id,resource_id,owner_device_id,owner_device_epoch,epoch,status) VALUES(${org},'venue-a','coordinator','coordinator','epoch-coordinator',1,'active')`;
 key=await issueChannelCredential(owner,scope,{provider:'sandbox-channel',merchantId:'shop-1'});
 rejectKey=await issueChannelCredential(owner,scope,{provider:'sandbox-channel',merchantId:'shop-2',unavailablePolicy:'reject'});
});
afterAll(async()=>{delete process.env.CHANNEL_SECRET_MASTER;delete process.env.CHANNELS_SANDBOX_WEB;if(db)await db.close();});
const rows=(id:string)=>db.admin`SELECT * FROM external_order WHERE organization_id=${org} AND external_id=${id}`;
// ---- signature, replay, scope ---------------------------------------------------------------------------------------
test('forged, unsigned, replayed, revoked or wrongly scoped requests never reach the database',async()=>{
 const raw=body({externalId:'forged'});
 await expect(receiveExternalOrder({provider:'sandbox-channel',rawBody:raw,headers:new Headers({[KEY_HEADER]:key.keyId,[TIMESTAMP_HEADER]:String(NOW),[SIGNATURE_HEADER]:'v1='+'0'.repeat(64)}),nowMs:NOW})).rejects.toThrow('INVALID_SIGNATURE');
 await expect(receiveExternalOrder({provider:'sandbox-channel',rawBody:raw,headers:new Headers(),nowMs:NOW})).rejects.toThrow('INVALID_SIGNATURE');
 await expect(send(raw,{keyId:'ck_unknownunknown',secret:key.secret})).rejects.toThrow('INVALID_SIGNATURE');
 await expect(receiveExternalOrder({provider:'sandbox-channel',rawBody:raw+' ',headers:headers(key,raw),nowMs:NOW})).rejects.toThrow('INVALID_SIGNATURE'); // headers signed a different body than the bytes received
 await expect(send(raw,key,'sandbox-channel',NOW-10*60_000)).rejects.toThrow('TIMESTAMP_EXPIRED'); // a captured request, replayed later
 await expect(send(body({externalId:'other-merchant',merchantId:'shop-9'}))).rejects.toThrow('MERCHANT_MISMATCH');
 const spare=await issueChannelCredential(owner,scope,{provider:'sandbox-channel',merchantId:'shop-1'});await revokeChannelCredential(owner,scope,spare.keyId);
 await expect(send(raw,spare)).rejects.toThrow('INVALID_SIGNATURE');
 await expect(issueChannelCredential(cashier,scope,{provider:'sandbox-channel',merchantId:'x'})).rejects.toThrow('PERMISSION_DENIED');
 expect((await rows('forged')).length).toBe(0);
});
test('real channels stay disabled until certified; the public web checkout is off unless the sandbox flag is set',async()=>{
 await expect(issueChannelCredential(owner,scope,{provider:'zalo-mini-app',merchantId:'z'})).rejects.toThrow('PROVIDER_NOT_ENABLED');
 await expect(issueChannelCredential(owner,scope,{provider:'nope',merchantId:'z'})).rejects.toThrow('PROVIDER_NOT_FOUND');
 expect(()=>profileFor('delivery-marketplace')).toThrow('PROVIDER_NOT_ENABLED');
 await expect(receiveExternalOrder({provider:'web-sandbox',rawBody:body({merchantId:'web',externalId:'w1'}),headers:new Headers(),nowMs:NOW,publicScope:scope})).rejects.toThrow('PROVIDER_NOT_ENABLED');
});
// ---- received is not accepted ------------------------------------------------------------------------------------------
test('duplicate external order waits for the venue rather than creating twice; received is not accepted',async()=>{
 const raw=body();
 const first=await send(raw),again=await send(raw);
 expect(first).toMatchObject({status:202,body:{status:'received',venueRecorded:false}});expect(again.body).toMatchObject({status:'received',duplicate:true});
 expect((await rows('ext-1')).length).toBe(1);
 expect((await db.admin`SELECT count(*)::int AS n FROM relay_command WHERE organization_id=${org} AND command->>'type'='ExternalOrder.Receive' AND command->'payload'->>'externalId'='ext-1'`)[0].n).toBe(1);
 expect((await db.admin`SELECT count(*)::int AS n FROM sync_projection WHERE organization_id=${org} AND aggregate_type='order'`)[0].n).toBe(0); // nothing became an order
 const status=await externalOrderStatus({provider:'sandbox-channel',merchantId:'shop-1',externalId:'ext-1',headers:headers(key,''),nowMs:NOW});
 expect(status).toMatchObject({status:'received',venueRecorded:false});
 const [relay]=await db.admin`SELECT command,status FROM relay_command WHERE organization_id=${org} AND command->>'type'='ExternalOrder.Receive' AND command->'payload'->>'externalId'='ext-1'`;
 expect(relay.command).toMatchObject({deviceId:'cloud-channel'});expect(relay.command.actorRef).toMatch(/^channel:ck_/);expect(relay.status).toBe('pending');
});
test('the same identity with different content is quarantined; the first order is untouched',async()=>{
 await expect(send(body({items:[{itemId:'rice',quantity:'2'}]}))).rejects.toThrow('EXTERNAL_ORDER_PAYLOAD_CONFLICT');
 expect((await db.admin`SELECT count(*)::int AS n FROM external_order_conflict WHERE organization_id=${org} AND external_id='ext-1'`)[0].n).toBe(1);
 expect((await rows('ext-1'))[0]!.normalized.items).toEqual([{itemId:'tea',quantity:'1'}]);
});
test('prices from the channel are dropped on the way in; only items, quantities, currency and the declared total are kept',async()=>{
 await send(body({externalId:'ext-price',items:[{itemId:'tea',quantity:'1',price:'1'}],unitMinor:'1',totalMinor:'1',declaredTotalMinor:'20000'}));
 const n=(await rows('ext-price'))[0]!.normalized;
 expect(n.items).toEqual([{itemId:'tea',quantity:'1'}]);expect(JSON.stringify(n)).not.toMatch(/"price"|unitMinor|"totalMinor"/);expect(n.declaredTotalMinor).toBe('20000');
 await expect(send(body({externalId:'ext-bad',items:[{itemId:'tea',quantity:'0'}]}))).rejects.toThrow('INVALID_ORDER_ITEMS');
 await expect(send(body({externalId:'ext-bad',expiresAt:new Date(NOW-1000).toISOString()}))).rejects.toThrow('EXTERNAL_ORDER_EXPIRED');
});
test('routes verify the exact bytes before parsing: bad signature on bad JSON is 403, valid signature on bad JSON is 400, spaces inside valid JSON are fine',async()=>{
 const call=(raw:string,h:Headers)=>dispatchRequest(new Request('http://x/v1/channels/sandbox-channel/webhooks',{method:'POST',headers:h,body:raw}));
 expect((await call('{not json',new Headers({[KEY_HEADER]:key.keyId,[TIMESTAMP_HEADER]:String(Date.now()),[SIGNATURE_HEADER]:'v1='+'1'.repeat(64)}))).status).toBe(403);
 const bad='{not json',ts=Date.now();expect((await call(bad,headers(key,bad,ts))).status).toBe(400);
 const spaced=JSON.stringify(JSON.parse(body({externalId:'ext-route'})),null,3);
 const ok=await call(spaced,headers(key,spaced,Date.now()));expect(ok.status).toBe(202);expect((await ok.json()).status).toBe('received');
});
// ---- the venue's side, with the real domain ------------------------------------------------------------------------------
async function venueLab(){
 const lab=await createRestaurantLab();
 await lab.seed('configuration','applied',{...fixture.configuration,features:{...fixture.configuration.features,online:{status:'enabled',revision:1}}} as JsonObject);
 return lab;
}
const receive=(lab:Awaited<ReturnType<typeof venueLab>>,over:JsonObject={},op=randomUUID())=>lab.command('cloud-channel','ExternalOrder.Receive',{provider:'sandbox-channel',merchantId:'shop-1',externalId:'e1',payloadHash:'h1',items:[{itemId:'tea',quantity:'1'}],currency:'VND',expiresAt:new Date(lab.clock.nowMs+3600_000).toISOString(),...over},op);
test('venue: received is recorded but only Accept makes an order; price is ours, duplicates are no-ops',async()=>{
 const lab=await venueLab();
 try{
  const r=await receive(lab,{declaredTotalMinor:'20000'});expect(r.status).toBe('accepted');expect(r.value.totalMinor).toBe('20000');
  expect(await lab.count('ExternalOrderReceived')).toBe(1);expect(await lab.count('OrderAccepted')).toBe(0);
  expect((await receive(lab)).value.duplicate).toBe(true);expect(await lab.count('ExternalOrderReceived')).toBe(1);
  expect((await receive(lab,{payloadHash:'other'})).code).toBe('EXTERNAL_ORDER_PAYLOAD_CONFLICT');
  expect((await receive(lab,{externalId:'e2',declaredTotalMinor:'1'})).code).toBe('AMOUNT_MISMATCH');
  expect((await receive(lab,{externalId:'e3',items:[{itemId:'ghost',quantity:'1'}]})).status).toBe('rejected');
  expect((await receive(lab,{externalId:'e4',expiresAt:new Date(lab.clock.nowMs-1000).toISOString()})).code).toBe('EXTERNAL_ORDER_EXPIRED');
  expect((await lab.command('cashier','ExternalOrder.Receive',{})).code).toBe('FORBIDDEN'); // a cashier cannot inject channel orders
  await lab.command('cashier','Session.Open',{tableId:'table-1',sessionId:'s1'});
  const acc=await lab.command('cashier','ExternalOrder.Accept',{externalOrderId:'ext:sandbox-channel:shop-1:e1',sessionId:'s1'});
  expect(acc.status).toBe('accepted');expect(await lab.count('OrderAccepted')).toBe(1);
  expect((await lab.command('cashier','ExternalOrder.Accept',{externalOrderId:'ext:sandbox-channel:shop-1:e1',sessionId:'s1'},'again')).value.duplicate).toBe(true);expect(await lab.count('OrderAccepted')).toBe(1); // one order
  const order=await lab.state<{channel:string;externalOrderId:string;totalMinor:string}>('order','order-ext:sandbox-channel:shop-1:e1');expect(order).toMatchObject({channel:'sandbox-channel',totalMinor:'20000'});
 }finally{await lab.close();}
});
test('venue: reject, expire after the deadline, never expire an accepted order, and refuse when the menu price moved',async()=>{
 const lab=await venueLab();
 try{
  await receive(lab,{externalId:'r1'});
  expect((await lab.command('cashier','ExternalOrder.Reject',{externalOrderId:'ext:sandbox-channel:shop-1:r1',reason:'hết món'})).status).toBe('accepted');
  expect((await lab.command('cashier','ExternalOrder.Accept',{externalOrderId:'ext:sandbox-channel:shop-1:r1',sessionId:'s1'})).code).toBe('EXTERNAL_ORDER_NOT_PENDING');
  await receive(lab,{externalId:'x1'});
  expect((await lab.command('cloud-channel','ExternalOrder.Expire',{externalOrderId:'ext:sandbox-channel:shop-1:x1'})).code).toBe('EXTERNAL_ORDER_NOT_EXPIRED');
  await lab.advance(2*3600_000);
  expect((await lab.command('cloud-channel','ExternalOrder.Expire',{externalOrderId:'ext:sandbox-channel:shop-1:x1'})).status).toBe('accepted');
  await lab.command('cashier','Session.Open',{tableId:'table-1',sessionId:'s2'});
  expect((await lab.command('cashier','ExternalOrder.Accept',{externalOrderId:'ext:sandbox-channel:shop-1:x1',sessionId:'s2'})).code).toBe('EXTERNAL_ORDER_NOT_PENDING');
  await receive(lab,{externalId:'p1',expiresAt:new Date(lab.clock.nowMs+3600_000).toISOString()});
  await lab.command('manager','Catalog.Publish',{version:2,currency:'VND',prices:{tea:'25000'}});
  expect((await lab.command('cashier','ExternalOrder.Accept',{externalOrderId:'ext:sandbox-channel:shop-1:p1',sessionId:'s2'})).code).toBe('EXTERNAL_PRICE_CHANGED');
  expect(await lab.count('OrderAccepted')).toBe(0);
 }finally{await lab.close();}
});
// ---- the cloud learns the venue's answer; the provider is told once ---------------------------------------------------------
const jobs=(kind?:string)=>db.admin`SELECT id,status,payload,result FROM cloud_job WHERE organization_id=${org} AND type='channel.effect' ${kind?db.admin`AND payload->>'kind'=${kind}`:db.admin``} ORDER BY id`;
async function venueSays(externalId:string,state:JsonObject,merchant='shop-1'){
 const id=`ext:sandbox-channel:${merchant}:${externalId}`;
 await db.admin`INSERT INTO sync_projection(organization_id,venue_id,aggregate_type,aggregate_id,version,state,entry_id) VALUES(${org},'venue-a','external-order',${id},2,${db.admin.json(state)},${'e-'+randomUUID()}) ON CONFLICT(organization_id,venue_id,aggregate_type,aggregate_id) DO UPDATE SET state=EXCLUDED.state`;
}
const key1=(externalId:string,merchantId='shop-1')=>({provider:'sandbox-channel',merchantId,externalId});
test('venue acceptance (and only that) moves the cloud to accepted and queues exactly one provider call',async()=>{
 await send(body({externalId:'ack-1'}));
 expect((await refreshFromVenue(scope,key1('ack-1'))).status).toBe('received');expect((await jobs()).filter(j=>j.payload.externalId==='ack-1')).toHaveLength(0);
 await db.admin`UPDATE relay_command SET status='accepted',venue_receipt='{"status":"accepted","ack":"venue"}' WHERE organization_id=${org} AND command->'payload'->>'externalId'='ack-1'`;
 await refreshFromVenue(scope,key1('ack-1'));
 expect((await externalOrderStatus({provider:'sandbox-channel',merchantId:'shop-1',externalId:'ack-1',headers:headers(key,''),nowMs:NOW}))).toMatchObject({status:'received',venueRecorded:true}); // recorded by the venue, still not accepted
 await venueSays('ack-1',{status:'accepted',orderId:'order-1'});
 expect((await refreshFromVenue(scope,key1('ack-1'))).status).toBe('accepted');await refreshFromVenue(scope,key1('ack-1'));
 expect((await jobs('order.accepted')).filter(j=>j.payload.externalId==='ack-1')).toHaveLength(1);
});
test('a venue refusal reaches the channel with its reason; a late decision never overwrites a final one',async()=>{
 await send(body({externalId:'rej-1'}));
 await db.admin`UPDATE relay_command SET status='rejected',venue_receipt='{"status":"rejected","code":"AMOUNT_MISMATCH","ack":"venue"}' WHERE organization_id=${org} AND command->'payload'->>'externalId'='rej-1'`;
 expect((await refreshFromVenue(scope,key1('rej-1'))).status).toBe('rejected');
 expect((await rows('rej-1'))[0]).toMatchObject({status:'rejected',code:'AMOUNT_MISMATCH'});
 expect((await jobs('order.rejected')).some(j=>j.payload.externalId==='rej-1'&&j.payload.reason==='AMOUNT_MISMATCH')).toBe(true);
 await venueSays('rej-1',{status:'accepted'});await refreshFromVenue(scope,key1('rej-1'));
 expect((await rows('rej-1'))[0]).toMatchObject({status:'rejected',attention:'VENUE_ACCEPTED_AFTER_REJECTED'}); // both facts stay visible for an operator
});
// ---- silent venue: hold or reject, always with an expiry ----------------------------------------------------------------------
test('a silent venue: reject policy tells the channel at once; hold policy retries with a new window and expires at the deadline',async()=>{
 await send(body({externalId:'silent-r',merchantId:'shop-2'}),rejectKey);
 await db.admin`UPDATE relay_command SET expires_at=now()-interval '1 minute' WHERE organization_id=${org} AND command->'payload'->>'externalId'='silent-r'`;
 expect(await sweepExternalOrder(scope,key1('silent-r','shop-2'),1,NOW+400_000)).toMatchObject({status:'rejected'});
 expect((await rows('silent-r'))[0]).toMatchObject({status:'rejected',code:'VENUE_UNAVAILABLE'});
 await send(body({externalId:'silent-h'}));
 await db.admin`UPDATE relay_command SET expires_at=now()-interval '1 minute' WHERE organization_id=${org} AND command->'payload'->>'externalId'='silent-h'`;
 expect(await sweepExternalOrder(scope,key1('silent-h'),1,NOW+400_000)).toMatchObject({status:'received',done:false});
 expect((await db.admin`SELECT count(*)::int AS n FROM relay_command WHERE organization_id=${org} AND command->'payload'->>'externalId'='silent-h'`)[0].n).toBe(2); // a second, fresh relay window
 expect((await rows('silent-h'))[0]!.relay_attempts).toBe(2);
 expect(await sweepExternalOrder(scope,key1('silent-h'),2,NOW+2*3600_000)).toMatchObject({status:'expired',done:false}); // the decision is not the end of listening
 expect((await jobs('order.expired')).some(j=>j.payload.externalId==='silent-h')).toBe(true);
 expect((await db.admin`SELECT count(*)::int AS n FROM relay_command WHERE organization_id=${org} AND command->>'type'='ExternalOrder.Expire'`)[0].n).toBeGreaterThanOrEqual(1);
});
// ---- outbound effects: unknown -> query, 429, dead letter ------------------------------------------------------------------
async function runAll(sandbox:ReturnType<typeof createSandboxChannel>,rounds=8){
 const previous=resolveConnector;setConnectorResolver(()=>sandbox.connector);
 try{let t=Date.now();for(let i=0;i<rounds;i++){t+=3600_000;await runJobBatch(scope,defaultJobRegistry(),{now:()=>t});}}finally{setConnectorResolver(previous);}
}
test('outbound: a lost acknowledgement is queried, not repeated; a 429 is retried; success records the provider reference once',async()=>{
 await db.admin`DELETE FROM cloud_job WHERE organization_id=${org} AND type='channel.effect'`;
 for(const id of ['fx-1','fx-2','fx-3'])await send(body({externalId:id}));
 for(const id of ['fx-1','fx-2','fx-3']){await venueSays(id,{status:'accepted'});await refreshFromVenue(scope,key1(id));}
 const sandbox=createSandboxChannel();sandbox.faults.lostAckNext=1;sandbox.faults.rateLimitNext=1;
 await runAll(sandbox);
 const done=await jobs('order.accepted');expect(done.map(j=>j.status)).toEqual(['confirmed','confirmed','confirmed']);
 expect(sandbox.acted).toBe(3); // three orders, three provider-side effects: the lost ack and the 429 produced no duplicates
 for(const id of ['fx-1','fx-2','fx-3'])expect((await rows(id))[0]!.provider_ref).toMatch(/^sbx-[0-9a-f]{32}$/);
});
test('outbound: repeated refusal ends in dead_letter and only channel.operate resolves it',async()=>{
 await send(body({externalId:'dl-1'}));await venueSays('dl-1',{status:'accepted'});await refreshFromVenue(scope,key1('dl-1'));
 const sandbox=createSandboxChannel();sandbox.faults.rejectNext=99;await runAll(sandbox,8);
 const [dead]=(await jobs('order.accepted')).filter(j=>j.payload.externalId==='dl-1');expect(dead!.status).toBe('dead_letter');
 await expect(resolveDeadLetter(cashier,scope,dead!.id as string,'retry')).rejects.toThrow('PERMISSION_DENIED');
 await resolveDeadLetter(owner,scope,dead!.id as string,'retry');sandbox.faults.rejectNext=0;await runAll(sandbox,3);
 expect((await jobs('order.accepted')).find(j=>j.id===dead!.id)!.status).toBe('confirmed');
 await expect(resolveDeadLetter(owner,scope,dead!.id as string,'retry')).rejects.toThrow('DEAD_LETTER_NOT_FOUND');
});
// ---- sandbox web checkout ------------------------------------------------------------------------------------------------
test('web checkout (sandbox) is public, server-identified, tagged sandbox and capped',async()=>{
 process.env.CHANNELS_SANDBOX_WEB='1';
 const post=(items:unknown)=>dispatchRequest(new Request(`http://x/v1/channels/web-sandbox/${org}/venue-a/orders`,{method:'POST',body:JSON.stringify({items,currency:'VND',externalId:'attacker-chosen'})}));
 const res=await post([{itemId:'tea',quantity:'1'}]);expect(res.status).toBe(202);const out=await res.json();
 expect(out.externalId).toMatch(/^web-/);expect(out.externalId).not.toBe('attacker-chosen');
 const [row]=await rows(out.externalId);expect(row).toMatchObject({provider_id:'web-sandbox',merchant_id:'web',sandbox:true,status:'received'});
 expect((await post(Array.from({length:21},()=>({itemId:'tea',quantity:'1'})))).status).toBe(400);
 const cap=(await db.admin`SELECT count(*)::int AS n FROM external_order WHERE organization_id=${org} AND provider_id='web-sandbox' AND status='received'`)[0].n;
 for(let i=cap;i<20;i++)expect((await post([{itemId:'tea',quantity:'1'}])).status).toBe(202);
 expect((await post([{itemId:'tea',quantity:'1'}])).status).toBe(429);
 delete process.env.CHANNELS_SANDBOX_WEB;
});
test('pure pieces: signature, receipts, state machine, outcomes',()=>{
 const sig=signWebhook('s',1700000000000,'{}');
 expect(verifyWebhook({secret:'s',rawBody:'{}',signature:sig,timestamp:'1700000000000',nowMs:1700000000000})).toEqual({ok:true});
 expect(verifyWebhook({secret:'s',rawBody:'{ }',signature:sig,timestamp:'1700000000000',nowMs:1700000000000})).toEqual({ok:false,code:'INVALID_SIGNATURE'});
 expect(verifyWebhook({secret:'s',rawBody:'{}',signature:sig,timestamp:'1700000000000',nowMs:1700000900000})).toEqual({ok:false,code:'TIMESTAMP_OUT_OF_WINDOW'});
 expect(classifyReceipt(undefined,'a')).toBe('new');expect(classifyReceipt('a','a')).toBe('duplicate');expect(classifyReceipt('a','b')).toBe('conflict');
 expect(payloadFingerprint({b:1,a:2})).toBe(payloadFingerprint({a:2,b:1}));
 expect(advance('accepted','expired')).toBe('accepted');expect(advance('received','rejected')).toBe('rejected');
 expect(onVenueSilent('reject',1,10)).toBe('reject');expect(onVenueSilent('hold',1,10)).toBe('wait');expect(onVenueSilent('hold',10,10)).toBe('expire');
 expect(jobOutcome({threw:'T'}).status).toBe('unknown');expect(jobOutcome({status:'rate_limited',retryAfterMs:5}).status).toBe('failed');
});
