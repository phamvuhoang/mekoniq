import {expect,test} from 'vitest';
import {createProviderRig} from '../support/provider-rig';
import '../support/channel-rig';
import {createRestaurantLab} from '../support/restaurant-lab';
import fixture from '../fixtures/restaurant-v1.json';
import type {JsonObject} from '../../packages/contracts/src/index';
import {channelStatus,advance} from '../../integrations/core/src/inbox';
import {channelConnectorFor} from '../../integrations/channels/src/registry';
import {createSandboxChannel} from '../../integrations/core/src/sandbox';
import {receiveExternalOrder} from '../../apps/cloud-web/src/server/modules/channels/ingress';
const rows=<T>(rig:Awaited<ReturnType<typeof createProviderRig<'channel'>>>,q:string)=>rig.admin.unsafe(q) as unknown as Promise<T[]>;
test('remote platform cannot report restaurant acceptance without venue ACK',async()=>{
 const rig=await createProviderRig('channel');
 try{
  expect(rig.emulated).toBe(true);
  await rig.partitionVenue();
  const sent=await rig.deliverFixture('new-order');
  expect(sent).toMatchObject({status:202,body:{status:'received',venueRecorded:false}});
  await rig.venueDecides('order-1',{status:'accepted'}); // ignored: the venue is partitioned
  await rig.runEffects();
  expect(rig.callCount('confirmRestaurantAccepted')).toBe(0);
  expect(await rig.status('order-1')).toMatchObject({status:'received',channelStatus:'awaiting_restaurant'});
 }finally{await rig.close();}
});
test('even a wrongly queued "accepted" call is refused until the venue itself accepted; then it is made once',async()=>{
 const rig=await createProviderRig('channel');
 try{
  await rig.deliverFixture('new-order');
  await rig.forceEffect('order-1','order.accepted'); // whatever bug queued it
  await rig.runEffects();
  expect(rig.callCount('confirmRestaurantAccepted')).toBe(0);
  const [job]=await rows<{status:string;result:{code:string}}>(rig,`SELECT status,result FROM cloud_job WHERE organization_id='${rig.scope.organizationId}' AND type='channel.effect'`);expect(job).toMatchObject({status:'pending',result:{code:'NO_VENUE_ACK'}}); // not sent; it retries and ends in dead_letter for a person to see
  await rig.venueDecides('order-1',{status:'accepted',orderId:'order-9'});await rig.sweep('order-1',Date.now()); // the cloud learns the decision from its sweeper
  await rig.runEffects();
  expect(rig.callCount('confirmRestaurantAccepted')).toBeGreaterThanOrEqual(1);expect(rig.sim.acted).toBe(1); // the forced job and the real one share the channel's idempotency key: one effect
  expect(await rig.status('order-1')).toMatchObject({status:'accepted',channelStatus:'accepted'});
 }finally{await rig.close();}
});
test('signed replays are de-duplicated, forged or tampered events never get in, and a conflicting replay is quarantined',async()=>{
 const rig=await createProviderRig('channel');
 try{
  await rig.deliverFixture('new-order');
  expect((await rig.deliverFixture('new-order')).body).toMatchObject({duplicate:true});
  expect((await rows<{n:number}>(rig,`SELECT count(*)::int AS n FROM external_order WHERE organization_id='${rig.scope.organizationId}'`))[0]!.n).toBe(1);
  await expect(rig.deliverFixture('new-order',{items:[{itemId:'rice',quantity:'2'}]})).rejects.toThrow('EXTERNAL_ORDER_PAYLOAD_CONFLICT');
  const forged=rig.signed('order',{merchantId:'shop-1',externalId:'x'},true);
  await expect(receiveExternalOrder({provider:'sandbox-channel',rawBody:forged.raw,headers:forged.headers})).rejects.toThrow('INVALID_SIGNATURE');
 }finally{await rig.close();}
});
test('venue offline past the order deadline: the channel is told expired, never accepted',async()=>{
 const rig=await createProviderRig('channel');
 try{
  await rig.deliverFixture('new-order');
  await rig.sweep('order-1',Date.now()+2*3600_000); // the order's own 1 h deadline has passed
  await rig.runEffects();
  expect(rig.callCount('reportExpired')).toBe(1);expect(rig.callCount('confirmRestaurantAccepted')).toBe(0);
  expect(await rig.status('order-1')).toMatchObject({status:'expired',channelStatus:'rejected'});
  await rig.venueDecides('order-1',{status:'accepted'}); // too late: the contradiction is shown, not hidden
  expect(await rig.sweep('order-1',Date.now()+2*3600_000+60_000)).toMatchObject({done:false}); // still listening: the venue may be offline and accept later
  expect(await rig.status('order-1')).toMatchObject({status:'expired',attention:'VENUE_ACCEPTED_AFTER_EXPIRED'});
 }finally{await rig.close();}
});
test('a cancellation of an ACCEPTED order is still answered: the sweeper keeps reading after the decision, and a cancelled order is shown to the channel as not accepted', async () => {
  const rig = await createProviderRig('channel');
  try {
    await rig.deliverFixture('new-order'); await rig.venueDecides('order-1', { status: 'accepted', orderId: 'o' }); await rig.sweep('order-1', Date.now());
    expect(await rig.cancel('order-1')).toEqual({ cancelStatus: 'pending' });
    expect(await rig.sweep('order-1', Date.now())).toMatchObject({ status: 'accepted', done: false }); // pending cancel: keep listening
    await rig.venueDecides('order-1', { status: 'cancelled' });
    expect(await rig.sweep('order-1', Date.now())).toMatchObject({ status: 'cancelled', done: true });
    expect(await rig.status('order-1')).toMatchObject({ status: 'cancelled', channelStatus: 'rejected', cancelStatus: 'done' });
  } finally { await rig.close(); }
});
test('a channel cancellation is relayed once; the venue answers: done, or refused with its reason',async()=>{
 const rig=await createProviderRig('channel');
 try{
  await rig.deliverFixture('new-order');
  expect(await rig.cancel('order-1')).toEqual({cancelStatus:'pending'});expect(await rig.cancel('order-1')).toEqual({cancelStatus:'pending'});
  expect(await rig.relayCount('ExternalOrder.Cancel')).toBe(1); // the same request, not two
  await rig.admin`UPDATE relay_command SET status='rejected',venue_receipt='{"status":"rejected","code":"REQUIRES_DISPOSITION","ack":"venue"}' WHERE organization_id=${rig.scope.organizationId} AND command->>'type'='ExternalOrder.Cancel'`;
  await rig.sweep('order-1',Date.now()); // read back by the sweeper, not by a test calling refresh
  expect(await rig.cancelStatus('order-1')).toEqual({cancelStatus:'refused'});
  expect(await rig.status('order-1')).toMatchObject({cancelStatus:'refused',cancelCode:'REQUIRES_DISPOSITION'});
  const second=await rig.deliverFixture('new-order',{externalId:'order-2'});expect(second.status).toBe(202);
  await rig.cancel('order-2');
  await rig.venueDecides('order-2',{status:'cancelled'});await rig.sweep('order-2',Date.now());
  expect(await rig.cancelStatus('order-2')).toMatchObject({cancelStatus:'done'});expect(await rig.status('order-2')).toMatchObject({status:'cancelled',cancelStatus:'done'});
  await expect(rig.cancel('order-missing')).rejects.toThrow('EXTERNAL_ORDER_NOT_FOUND');
 }finally{await rig.close();}
});
test('an unregistered or release-mode channel resolves to nothing; only emulator profiles run, only in a sandbox runtime',()=>{
 const make=()=>createSandboxChannel().connector;
 expect(channelConnectorFor('sandbox-channel',make).profile.id).toBe('sandbox-channel');
 expect(()=>channelConnectorFor('zalo-mini-app',make)).toThrow('PROVIDER_NOT_ENABLED');
 expect(()=>channelConnectorFor('delivery-marketplace',make)).toThrow('PROVIDER_NOT_ENABLED');
 const was=process.env.INTEGRATION_RUNTIME;process.env.INTEGRATION_RUNTIME='release';
 try{expect(()=>channelConnectorFor('sandbox-channel',make)).toThrow('PROVIDER_NOT_ENABLED');}finally{if(was===undefined)delete process.env.INTEGRATION_RUNTIME;else process.env.INTEGRATION_RUNTIME=was;}
});
test('venue side: the channel can cancel a received order, or an accepted one under the normal cancel rules; never silently throw away made food',async()=>{
 const lab=await createRestaurantLab();
 try{
  const features=(fixture.configuration as unknown as {features:Record<string,unknown>}).features;
  await lab.seed('configuration','applied',{...fixture.configuration,features:{...features,online:{status:'enabled',revision:1}}} as JsonObject);
  const receive=(externalId:string)=>lab.command('cloud-channel','ExternalOrder.Receive',{provider:'sandbox-channel',merchantId:'shop-1',externalId,payloadHash:'h-'+externalId,items:[{itemId:'tea',quantity:'1'}],currency:'VND',expiresAt:new Date(lab.clock.nowMs+3600_000).toISOString()});
  const cancel=(externalId:string,op?:string)=>lab.command('cloud-channel','ExternalOrder.Cancel',{externalOrderId:`ext:sandbox-channel:shop-1:${externalId}`,reason:'customer cancelled'},op);
  await receive('c1');expect((await cancel('c1')).status).toBe('accepted');expect((await lab.state<{status:string}>('external-order','ext:sandbox-channel:shop-1:c1')).status).toBe('cancelled');
  expect((await cancel('c1','c1-again')).value.duplicate).toBe(true);
  await lab.command('cashier','Session.Open',{tableId:'table-1',sessionId:'s1'});
  await receive('c2');await receive('c3');
  for(const e of ['c2','c3'])expect((await lab.command('cashier','ExternalOrder.Accept',{externalOrderId:`ext:sandbox-channel:shop-1:${e}`,sessionId:'s1'})).status).toBe('accepted');
  expect((await cancel('c2')).status).toBe('accepted'); // accepted but nothing started: cancelled like any order
  expect(await lab.state<{status:string}>('order','order-ext:sandbox-channel:shop-1:c2')).toMatchObject({status:'cancelled'});
  const order=await lab.state<{lines:{id:string}[]}>('order','order-ext:sandbox-channel:shop-1:c3'),ticket=await lab.state<JsonObject>('kitchen-ticket',order.lines[0]!.id);
  await lab.seed('kitchen-ticket',order.lines[0]!.id,{...ticket,prepared:'1'}); // the kitchen already made it
  expect((await cancel('c3')).code).toBe('REQUIRES_DISPOSITION');
  expect(await lab.state<{status:string}>('order','order-ext:sandbox-channel:shop-1:c3')).toMatchObject({status:'open'});
  expect((await lab.command('cashier','ExternalOrder.Cancel',{})).code).toBe('FORBIDDEN');
  expect((await lab.command('manager','ExternalOrder.Receive',{provider:'sandbox-channel',merchantId:'shop-1',externalId:'typed',payloadHash:'h',items:[{itemId:'tea',quantity:'1'}],currency:'VND',expiresAt:new Date(lab.clock.nowMs+3600_000).toISOString()})).code).toBe('CLOUD_SOURCE_REQUIRED'); // staff cannot fabricate a channel order
 }finally{await lab.close();}
});
test('channel wording and status order are exact',()=>{
 expect(channelStatus(false,false)).toBe('awaiting_restaurant');expect(channelStatus(true,false)).toBe('accepted');expect(channelStatus(false,true)).toBe('rejected');expect(channelStatus(true,true)).toBe('rejected');
 expect(advance('accepted','cancelled')).toBe('cancelled');expect(advance('cancelled','accepted')).toBe('cancelled');expect(advance('rejected','cancelled')).toBe('rejected');
});

test('a cancellation of an already accepted order starts a fresh sweep even though the order\'s first sweep finished long ago', async () => {
  const rig = await createProviderRig('channel');
  try {
    await rig.deliverFixture('new-order'); await rig.venueDecides('order-1', { status: 'accepted', orderId: 'o' }); await rig.sweep('order-1', Date.now());
    await rig.admin`UPDATE cloud_job SET status='confirmed' WHERE organization_id=${rig.scope.organizationId} AND type='channel.sweep'`; // every sweep scheduled so far has run
    expect(await rig.cancel('order-1')).toEqual({ cancelStatus: 'pending' });
    const [open] = await rig.admin`SELECT count(*)::int AS n FROM cloud_job WHERE organization_id=${rig.scope.organizationId} AND type='channel.sweep' AND status='pending'`;
    expect(open!.n).toBe(1); // someone will read the venue's answer
    await rig.venueDecides('order-1', { status: 'cancelled' });
    const [job] = await rig.admin`SELECT payload FROM cloud_job WHERE organization_id=${rig.scope.organizationId} AND type='channel.sweep' AND status='pending'`;
    expect(await rig.sweep('order-1', Date.now())).toMatchObject({ status: 'cancelled', done: true }); expect(job!.payload).toMatchObject({ gen: 'cancel-', round: 1 });
  } finally { await rig.close(); }
});

test('after the cloud itself expires or rejects an order, listening continues: a later venue decision is noticed without anyone asking', async () => {
  for (const policy of ['expire', 'reject'] as const) {
    const rig = await createProviderRig('channel');
    try {
      await rig.deliverFixture(policy === 'expire' ? 'new-order' : 'new-order');
      if (policy === 'reject') await rig.admin`UPDATE external_order SET unavailable_policy='reject' WHERE organization_id=${rig.scope.organizationId}`;
      await rig.admin`UPDATE cloud_job SET status='confirmed' WHERE organization_id=${rig.scope.organizationId} AND type='channel.sweep'`; // every sweep scheduled so far has run
      const r = await rig.sweep('order-1', Date.now() + (policy === 'expire' ? 2 * 3600_000 : 5 * 60_000));
      expect(r).toMatchObject({ status: policy === 'expire' ? 'expired' : 'rejected', done: false });
      const [open] = await rig.admin`SELECT count(*)::int AS n FROM cloud_job WHERE organization_id=${rig.scope.organizationId} AND type='channel.sweep' AND status='pending'`; expect(open!.n).toBe(1);
    } finally { await rig.close(); }
  }
});
