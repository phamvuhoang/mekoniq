import {expect,test} from 'vitest';
import {createProviderRig} from '../support/provider-rig';
import '../support/payment-rig';
import {createRestaurantLab} from '../support/restaurant-lab';
import {parseVietQr,vietQrPayload,crc16ccitt} from '../../integrations/payments/src/vietqr';
import {matchesPayment,judge,refundable} from '../../integrations/payments/src/reconciliation';
import {IMPLEMENTED_SCHEMES,verifyPaymentWebhook} from '../../integrations/payments/src/provider-adapter';
import {catalog} from '../../integrations/core/src/profile';
import {createPaymentIntent,receivePaymentWebhook,requestProviderRefund,unappliedFunds,setPaymentProviderResolver,resolvePaymentProvider} from '../../apps/cloud-web/src/server/modules/payments/provider';
import {rolePermissions,type Actor} from '../../apps/cloud-web/src/server/modules/identity/rbac';
const rows=<T>(rig:Awaited<ReturnType<typeof createProviderRig<'payment'>>>,sql:string)=>rig.admin.unsafe(sql) as unknown as Promise<T[]>;
test('provider callback for a different amount cannot settle the bill',async()=>{
 const rig=await createProviderRig('payment');
 try{
  expect(rig.emulated).toBe(true); // this rig proves our behaviour, not a provider's
  await rig.deliverFixture('signed-amount-mismatch');
  expect(await rig.settledCount()).toBe(0);
  expect(await rig.unappliedFundsCount()).toBe(1);
  expect(await rig.relayCount('Payment.RecordProvider')).toBe(0); // nothing was sent to the bill
  const [i]=await rows<{status:string;attention:string;captured_minor:string}>(rig,`SELECT status,attention,captured_minor FROM payment_intent WHERE intent_id='${rig.currentIntent()}'`);
  expect(i).toMatchObject({status:'unapplied',attention:'AMOUNT_MISMATCH',captured_minor:'90000'}); // the real money is kept and visible, never dropped
 }finally{await rig.close();}
});
test('an exact verified capture is forwarded to the venue once; the webhook body is only a hint, a duplicate is a no-op',async()=>{
 const rig=await createProviderRig('payment');
 try{
  const first=await rig.deliverFixture('signed-exact');expect(first).toMatchObject({duplicate:false,outcome:'settle'});
  expect(await rig.settledCount()).toBe(1);expect(await rig.relayCount('Payment.RecordProvider')).toBe(1);
  const [relay]=await rows<{command:{actorRef:string;deviceId:string;payload:{billId:string;reference:{provider:string;merchantId:string;transactionId:string}}}}>(rig,`SELECT command FROM relay_command WHERE organization_id='${rig.scope.organizationId}' AND command->>'type'='Payment.RecordProvider'`);
  expect(relay!.command).toMatchObject({deviceId:'cloud-provider',payload:{billId:'bill-1',reference:{provider:'sim-payment',merchantId:'merchant-1',transactionId:'TX-1'}}});expect(relay!.command.actorRef).toMatch(/^provider:/);
  const queries=rig.callCount('query');
  expect(await rig.deliverFixture('signed-exact')).toEqual({duplicate:true});expect(await rig.relayCount('Payment.RecordProvider')).toBe(1);expect(rig.callCount('query')).toBe(queries);
  // a second DIFFERENT event for the same intent changes nothing (already captured)
  await rig.deliverFixture('signed-exact',{eventId:'evt-again'});expect(await rig.relayCount('Payment.RecordProvider')).toBe(1);expect(await rig.settledCount()).toBe(1);
 }finally{await rig.close();}
});
test('foreign merchant is not our money; a wrong currency is kept as unapplied; failure closes the intent',async()=>{
 const rig=await createProviderRig('payment');
 try{
  expect((await rig.deliverFixture('signed-foreign-merchant')).outcome).toBe('foreign');
  expect(await rig.settledCount()).toBe(0);expect(await rig.unappliedFundsCount()).toBe(0);
  const [i]=await rows<{attention:string;status:string}>(rig,`SELECT status,attention FROM payment_intent WHERE intent_id='${rig.currentIntent()}'`);expect(i).toMatchObject({status:'pending',attention:'FOREIGN_MERCHANT_EVENT'});
  const second=await rig.newIntent();expect((await rig.deliverFixture('signed-wrong-currency',{intentId:second})).outcome).toBe('unapplied');
  const third=await rig.newIntent();expect((await rig.deliverFixture('payment-failed'.replace('payment-',''),{intentId:third})).outcome).toBe('close');
  expect(await rig.unappliedFundsCount()).toBe(1);expect(await rig.settledCount()).toBe(0);
 }finally{await rig.close();}
});
test('forged, replayed or wrongly-schemed webhooks are refused before the provider is asked anything',async()=>{
 const rig=await createProviderRig('payment');
 try{
  const intentId=await rig.newIntent(),good=rig.signedWebhook(intentId,'evt-x');
  const call=(raw:string,headers:Headers,nowMs?:number)=>receivePaymentWebhook({profileId:'sim-payment',rawBody:raw,headers,...(nowMs?{nowMs}:{})});
  await expect(call(good.raw+' ',good.headers)).rejects.toThrow('INVALID_SIGNATURE');
  await expect(call(good.raw,new Headers({'x-mekoniq-timestamp':String(Date.now()),'x-mekoniq-signature':'v1='+'0'.repeat(64)}))).rejects.toThrow('INVALID_SIGNATURE');
  await expect(call(good.raw,good.headers,Date.now()+3600_000)).rejects.toThrow('TIMESTAMP_EXPIRED');
  const stranger=rig.signedWebhook('00000000-0000-4000-8000-000000000000','evt-y');await expect(call(stranger.raw,stranger.headers)).rejects.toThrow('INTENT_NOT_FOUND');
  expect(rig.callCount('query')).toBe(0);
  const profile=catalog.find(p=>p.id==='sim-payment')!;
  expect(()=>verifyPaymentWebhook({...profile,webhook:{...profile.webhook!,signatureScheme:'some-provider-scheme'}},'s',good.raw,good.headers,Date.now())).toThrow('SIGNATURE_SCHEME_UNSUPPORTED');
  expect(IMPLEMENTED_SCHEMES.has('some-provider-scheme')).toBe(false);
  await expect(receivePaymentWebhook({profileId:'payment-provider',rawBody:good.raw,headers:good.headers})).rejects.toThrow('PROVIDER_NOT_ENABLED'); // a draft profile never runs
 }finally{await rig.close();}
});
test('webhook before our own provider response: the intent already exists, so it still settles',async()=>{
 const rig=await createProviderRig('payment');
 try{
  rig.sim.faults.createTimeoutNext=1; // the provider created the payment, our call got no answer
  const intentId=await rig.newIntent();
  const [before]=await rows<{status:string;provider_ref:string|null}>(rig,`SELECT status,provider_ref FROM payment_intent WHERE intent_id='${intentId}'`);expect(before).toMatchObject({status:'created',provider_ref:null});
  await rig.deliverFixture('signed-exact',{intentId});
  expect(await rig.settledCount()).toBe(1);expect(rig.callCount('createIntent')).toBe(1); // never created a second payment
 }finally{await rig.close();}
});
test('provider 429 on the authoritative query: the callback is retried and processed exactly once',async()=>{
 const rig=await createProviderRig('payment');
 try{
  const intentId=await rig.newIntent();rig.sim.faults.queryRateLimitNext=1;
  await expect(rig.deliverFixture('signed-exact',{intentId})).rejects.toThrow('PROVIDER_RATE_LIMITED');
  expect(await rig.settledCount()).toBe(0);
  expect((await rows<{status:string}>(rig,`SELECT status FROM payment_intent WHERE intent_id='${intentId}'`))[0]!.status).toBe('unknown'); // waiting, not failed
  expect(await rig.deliverFixture('signed-exact',{intentId})).toMatchObject({duplicate:false,outcome:'settle'}); // the same event id is processed now: the earlier attempt never finished
  expect(await rig.settledCount()).toBe(1);expect(await rig.relayCount('Payment.RecordProvider')).toBe(1);
 }finally{await rig.close();}
});
test('no callback at all: reconciliation queries the provider; an intent the provider never knew expires',async()=>{
 const rig=await createProviderRig('payment');
 try{
  const intentId=await rig.newIntent();rig.sim.program(intentId,{status:'captured',amountMinor:'100000',currency:'VND',merchantId:'merchant-1',transactionId:'TX-9',capturedAt:new Date().toISOString()});
  expect((await rig.reconcile()).queried).toBe(1);expect(await rig.settledCount()).toBe(1);
  const lonely=await rig.newIntent();await rig.admin`UPDATE payment_intent SET expires_at=now()-interval '1 minute' WHERE intent_id=${lonely}::uuid`;
  expect((await rig.reconcile()).expired).toBe(1);
  expect((await rows<{status:string}>(rig,`SELECT status FROM payment_intent WHERE intent_id='${lonely}'`))[0]!.status).toBe('expired');
 }finally{await rig.close();}
});
test('offline venue / cashier conflict: a lapsed relay is resent; a venue that refuses the capture leaves visible unapplied money, never a deleted payment',async()=>{
 const rig=await createProviderRig('payment');
 try{
  await rig.deliverFixture('signed-exact');
  await rig.admin`UPDATE relay_command SET expires_at=now()-interval '1 minute' WHERE organization_id=${rig.scope.organizationId} AND command->>'type'='Payment.RecordProvider'`; // venue stayed offline
  expect((await rig.reconcile()).resent).toBe(1);expect(await rig.relayCount('Payment.RecordProvider')).toBe(2);
  const [latest]=await rows<{operation_id:string}>(rig,`SELECT operation_id FROM relay_command WHERE organization_id='${rig.scope.organizationId}' AND command->>'type'='Payment.RecordProvider' ORDER BY created_at DESC LIMIT 1`);expect(latest!.operation_id).toMatch(/-a2$/);
  await rig.admin`UPDATE relay_command SET status='rejected',venue_receipt='{"status":"rejected","code":"BILL_NOT_COLLECTABLE","ack":"venue"}' WHERE operation_id=${latest!.operation_id}`; // the cashier took cash meanwhile
  expect((await rig.reconcile()).venueRefused).toBe(1);
  expect(await rig.settledCount()).toBe(0);expect(await rig.unappliedFundsCount()).toBe(1);
  const [i]=await rows<{captured_minor:string;attention:string}>(rig,`SELECT captured_minor,attention FROM payment_intent WHERE intent_id='${rig.currentIntent()}'`);expect(i).toMatchObject({captured_minor:'100000',attention:'VENUE_REJECTED:BILL_NOT_COLLECTABLE'});
  // and the real money can be returned through the provider
  const r=await requestProviderRefund(rig.owner,rig.scope,{intentId:rig.currentIntent()!,amountMinor:'100000',reason:'bill already paid in cash'});expect(r).toMatchObject({refundedMinor:'100000',refundStatus:'confirmed'});
 }finally{await rig.close();}
});
test('refunds: never above captured, one at a time, a lost answer is queried not re-issued, a 429 retries the same id',async()=>{
 const rig=await createProviderRig('payment');
 try{
  await rig.deliverFixture('signed-exact');const intentId=rig.currentIntent()!;
  await expect(requestProviderRefund(rig.owner,rig.scope,{intentId,amountMinor:'100001',reason:'x'})).rejects.toThrow('REFUND_EXCEEDS_CAPTURED');
  await expect(requestProviderRefund({...rig.owner,permissions:rolePermissions('cashier'),role:'cashier'},rig.scope,{intentId,amountMinor:'1000',reason:'x'})).rejects.toThrow('PERMISSION_DENIED');
  rig.sim.faults.refundRateLimitNext=1;
  await expect(requestProviderRefund(rig.owner,rig.scope,{intentId,amountMinor:'30000',reason:'late',refundId:'refund-1'})).rejects.toThrow('RATE_LIMITED');
  rig.sim.faults.refundTimeoutNext=1; // the provider refunds, the answer is lost
  const lost=await requestProviderRefund(rig.owner,rig.scope,{intentId,amountMinor:'30000',reason:'late',refundId:'refund-1'});expect(lost.refundStatus).toBe('unknown');expect(lost.refundedMinor).toBe('0');
  await expect(requestProviderRefund(rig.owner,rig.scope,{intentId,amountMinor:'10000',reason:'second',refundId:'refund-2'})).rejects.toThrow('REFUND_IN_PROGRESS');
  expect((await rig.reconcile()).refunds).toBe(1);
  const [after]=await rows<{refunded_minor:string;refund_status:string}>(rig,`SELECT refunded_minor,refund_status FROM payment_intent WHERE intent_id='${intentId}'`);expect(after).toMatchObject({refunded_minor:'30000',refund_status:'confirmed'});
  expect(rig.sim.calls.refund).toBe(2);expect(rig.sim.calls.queryRefund).toBe(1); // the 429 and the lost answer; nothing is re-issued after it, the provider is asked instead
  await expect(requestProviderRefund(rig.owner,rig.scope,{intentId,amountMinor:'70001',reason:'too much'})).rejects.toThrow('REFUND_EXCEEDS_CAPTURED');
 }finally{await rig.close();}
});
test('intents need the feature on, a bound merchant, a payable bill, and an amount within the due; real providers do not run without a profile',async()=>{
 const rig=await createProviderRig('payment');
 try{
  const cashier:Actor={...rig.owner,id:'cashier',permissions:rolePermissions('cashier'),role:'cashier'},input={billId:'bill-1',amountMinor:'100000',profileId:'sim-payment'};
  await expect(createPaymentIntent({...cashier,permissions:rolePermissions('chef')},rig.scope,input)).rejects.toThrow('PERMISSION_DENIED');
  await expect(createPaymentIntent(cashier,rig.scope,{...input,amountMinor:'100001'})).rejects.toThrow('AMOUNT_EXCEEDS_DUE');
  await expect(createPaymentIntent(cashier,rig.scope,{...input,billId:'ghost'})).rejects.toThrow('BILL_NOT_PAYABLE');
  await expect(createPaymentIntent(cashier,rig.scope,{...input,profileId:'payment-provider'})).rejects.toThrow('PROVIDER_NOT_ENABLED');
  const intentId=randomUuid();
  const a=await createPaymentIntent(cashier,rig.scope,{...input,intentId}),b=await createPaymentIntent(cashier,rig.scope,{...input,intentId});expect(b.intentId).toBe(a.intentId);expect(rig.callCount('createIntent')).toBe(1);
  await expect(createPaymentIntent(cashier,rig.scope,{...input,intentId,amountMinor:'5'})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  expect(a.status).toBe('pending');expect(parseVietQr(a.qrPayload!)).toMatchObject({bin:'970436',account:'0123456789',amountMinor:'100000',dynamic:true}); // the QR asks for payment; the intent is not paid
  await rig.admin`UPDATE configuration_revision SET features=${rig.admin.json({'payment.provider':{status:'disabled',revision:2}})} WHERE organization_id=${rig.scope.organizationId}`;
  await expect(createPaymentIntent(cashier,rig.scope,{...input,intentId:randomUuid()})).rejects.toThrow('FEATURE_DISABLED');
  setPaymentProviderResolver(()=>{throw new Error('PROVIDER_NOT_ENABLED');});await expect(requestProviderRefund(rig.owner,rig.scope,{intentId,amountMinor:'1',reason:'x'})).rejects.toThrow();setPaymentProviderResolver(resolvePaymentProvider);
 }finally{await rig.close();}
});
const randomUuid=()=>crypto.randomUUID();
test('venue side: Payment.RecordProvider records money once per reference, applies up to the due and keeps the rest unapplied; a closed bill refuses it',async()=>{
 const lab=await createRestaurantLab();
 try{
  await lab.seed('bill','bill-1',{status:'prepared',totalMinor:'100000',paidMinor:'0',refundedMinor:'0',currency:'VND',orderIds:[],lines:[],version:1});
  const record=(amountMinor:string,tx='TX-1',billId='bill-1')=>lab.command('cloud-provider','Payment.RecordProvider',{billId,amountMinor,currency:'VND',status:'captured',reference:{provider:'sim-payment',merchantId:'merchant-1',transactionId:tx}},'op-'+tx+amountMinor+billId);
  expect(await record('100000')).toMatchObject({status:'accepted',value:{appliedMinor:'100000',unappliedMinor:'0'}});
  expect((await record('100000')).duplicate).toBe(true);expect(await lab.count('ProviderPaymentCaptured')).toBe(1); // a re-sent relay is one payment
  expect(await record('50000','TX-2')).toMatchObject({status:'accepted',value:{appliedMinor:'0',unappliedMinor:'50000'}}); // paid in full: the extra money is KEPT as unapplied, not hidden and not applied
  await lab.seed('bill','bill-closed',{status:'closed',totalMinor:'1000',paidMinor:'1000',refundedMinor:'0',currency:'VND',orderIds:[],lines:[],version:1});
  expect((await record('1000','TX-3','bill-closed')).status).toBe('rejected'); // a closed bill takes nothing: the cloud then shows it as unapplied funds
  expect((await lab.command('cashier','Payment.RecordProvider',{})).code).toBe('FORBIDDEN'); // only the provider relay (payment.capture) may send it
  expect((await lab.command('manager','Payment.RecordProvider',{})).code).toBe('FORBIDDEN');
  const typed = { billId: 'bill-1', amountMinor: '1', currency: 'VND', status: 'captured', reference: { provider: 'x', merchantId: 'y', transactionId: 'z' } };
  expect((await lab.command('owner', 'Payment.RecordProvider', typed)).code).toBe('CLOUD_SOURCE_REQUIRED'); // not even a wildcard owner on a tablet can type provider money;
 }finally{await lab.close();}
});
test('VietQR: CRC vector, round trip, dynamic vs static, and strict inputs; displaying it is not payment',()=>{
 expect(crc16ccitt('123456789')).toBe('29B1'); // CRC-16/CCITT-FALSE check value
 const dynamic=vietQrPayload({bin:'970436',account:'0123456789',amountMinor:'150000',purpose:'ban 12'}),stat=vietQrPayload({bin:'970436',account:'0123456789'});
 expect(parseVietQr(dynamic)).toEqual({bin:'970436',account:'0123456789',amountMinor:'150000',purpose:'ban 12',dynamic:true,toCard:false});
 expect(parseVietQr(stat)).toMatchObject({dynamic:false});expect(parseVietQr(stat).amountMinor).toBeUndefined();
 expect(dynamic.startsWith('000201010212')).toBe(true);expect(dynamic).toContain('A000000727');expect(dynamic).toContain('5303704');expect(dynamic).toContain('5802VN');
 expect(parseVietQr(vietQrPayload({bin:'970436',account:'5555',toCard:true})).toCard).toBe(true);
 expect(()=>parseVietQr(dynamic.slice(0,-1)+'0')).toThrow('VIETQR_BAD_CRC');
 const bad=[{bin:'97043',account:'1'},{bin:'970436',account:'12 3'},{bin:'970436',account:'1',amountMinor:'0'},{bin:'970436',account:'1',amountMinor:'12.5'},{bin:'970436',account:'1',purpose:'<script>'}];
 for(const b of bad)expect(()=>vietQrPayload(b)).toThrow(/VIETQR_INVALID/);
});
test('reconciliation rules are pure and exact',()=>{
 const exp={merchant:'m',currency:'VND',amount:'100'};
 expect(matchesPayment(exp,{merchant:'m',currency:'VND',amount:'100'})).toBe(true);expect(matchesPayment(exp,{merchant:'m',currency:'VND',amount:'99'})).toBe(false);expect(matchesPayment(exp,{merchant:'x',currency:'VND',amount:'100'})).toBe(false);
 const cap=(over:object)=>({status:'captured' as const,amountMinor:'100',currency:'VND',merchantId:'m',transactionId:'t',capturedAt:'x',...over});
 expect(judge(exp,cap({}))).toBe('settle');expect(judge(exp,cap({amountMinor:'101'}))).toBe('unapplied');expect(judge(exp,cap({merchantId:'z'}))).toBe('foreign');
 expect(judge({...exp,payee:'A'},cap({payee:'B'}))).toBe('foreign');expect(judge(exp,{status:'pending'})).toBe('wait');expect(judge(exp,{status:'not_found'})).toBe('wait');expect(judge(exp,{status:'expired'})).toBe('close');
 expect(refundable('100','30')).toBe('70');
});

test('money captured after our own expiry is kept as unapplied funds, never dropped', async () => {
  const rig = await createProviderRig('payment');
  try {
    const intentId = await rig.newIntent();
    await rig.admin`UPDATE payment_intent SET status='expired' WHERE intent_id=${intentId}::uuid`; // reconcile closed it on our TTL
    await rig.deliverFixture('signed-exact', { intentId }); // the customer scanned late; the provider captured exactly
    expect(await rig.settledCount()).toBe(0);expect(await rig.unappliedFundsCount()).toBe(1);
    const [i] = await rows<{ status: string; attention: string; captured_minor: string }>(rig, `SELECT status,attention,captured_minor FROM payment_intent WHERE intent_id='${intentId}'`);
    expect(i).toMatchObject({ status: 'unapplied', attention: 'LATE_CAPTURE', captured_minor: '100000' });
  } finally { await rig.close(); }
});
test('a refund whose call never reached the provider is re-sent under the SAME id; two refunds cannot together exceed the capture', async () => {
  const rig = await createProviderRig('payment');
  try {
    await rig.deliverFixture('signed-exact'); const intentId = rig.currentIntent()!;
    const refundCalls = rig.sim.calls.refund!, original = rig.sim.provider.refund!;
    rig.sim.provider.refund = async () => { throw new Error('CONNECTION_RESET'); }; // dies before the provider sees it
    const first = await requestProviderRefund(rig.owner, rig.scope, { intentId, amountMinor: '40000', reason: 'x', refundId: 'refund-stuck' });
    rig.sim.provider.refund = original; expect(first.refundStatus).toBe('unknown');
    await rig.reconcile(); // queryRefund: not found -> the same refund id is sent again
    const [after] = await rows<{ refunded_minor: string; refund_status: string }>(rig, `SELECT refunded_minor,refund_status FROM payment_intent WHERE intent_id='${intentId}'`);
    expect(after).toMatchObject({ refunded_minor: '40000', refund_status: 'confirmed' }); expect(rig.sim.calls.refund).toBe(refundCalls + 1);
    // the limit holds even if a stale read lets two requests start: the claim itself re-checks it
    await expect(Promise.all([requestProviderRefund(rig.owner, rig.scope, { intentId, amountMinor: '40000', reason: 'a', refundId: 'r-a' }), requestProviderRefund(rig.owner, rig.scope, { intentId, amountMinor: '40000', reason: 'b', refundId: 'r-b' })])).rejects.toThrow(/REFUND_EXCEEDS_CAPTURED|REFUND_IN_PROGRESS/);
    const [end] = await rows<{ refunded_minor: string }>(rig, `SELECT refunded_minor FROM payment_intent WHERE intent_id='${intentId}'`); expect(Number(end!.refunded_minor)).toBeLessThanOrEqual(100000);
  } finally { await rig.close(); }
});
test('refund ledger: a retried older refund id is not counted again, and a sweeper that confirms first is not counted twice by the late HTTP answer', async () => {
  const rig = await createProviderRig('payment');
  try {
    await rig.deliverFixture('signed-exact'); const intentId = rig.currentIntent()!, ask = (amountMinor: string, refundId: string) => requestProviderRefund(rig.owner, rig.scope, { intentId, amountMinor, reason: 'x', refundId });
    await ask('10000', 'ref-A'); await ask('10000', 'ref-B');
    const again = await ask('10000', 'ref-A'); // the client retries A after B went through
    expect(again.refundedMinor).toBe('20000'); expect(rig.sim.calls.refund).toBe(2); // the provider was not asked again and nothing was added
    const original = rig.sim.provider.refund!;
    rig.sim.provider.refund = async input => { const r = await original(input); await rig.reconcile(); return r; }; // the sweeper confirms while our own HTTP answer is still on its way
    const racing = await ask('30000', 'ref-C'); expect(racing.refundedMinor).toBe('50000');
    const [end] = await rows<{ refunded_minor: string }>(rig, `SELECT refunded_minor FROM payment_intent WHERE intent_id='${intentId}'`); expect(end!.refunded_minor).toBe('50000');
  } finally { await rig.close(); }
});
test('money the provider took after our intent closed is found by reconciliation alone, no webhook needed', async () => {
  const rig = await createProviderRig('payment');
  try {
    const intentId = await rig.newIntent();
    await rig.admin`UPDATE payment_intent SET status='expired' WHERE intent_id=${intentId}::uuid`;
    rig.sim.program(intentId, { status: 'captured', amountMinor: '100000', currency: 'VND', merchantId: 'merchant-1', transactionId: 'TX-LATE', capturedAt: new Date().toISOString() });
    await rig.reconcile();
    const [i] = await rows<{ status: string; attention: string; captured_minor: string }>(rig, `SELECT status,attention,captured_minor FROM payment_intent WHERE intent_id='${intentId}'`);
    expect(i).toMatchObject({ status: 'unapplied', attention: 'LATE_CAPTURE', captured_minor: '100000' });
    const calls = rig.sim.calls.query!; await rig.reconcile(); expect(rig.sim.calls.query).toBe(calls); // an unapplied intent is not asked again
  } finally { await rig.close(); }
});
test('the amount and currency the provider actually took are kept apart from the ones we expected', async () => {
  const rig = await createProviderRig('payment');
  try {
    await rig.deliverFixture('signed-wrong-currency'); const intentId = rig.currentIntent()!;
    const [i] = await rows<{ currency: string; amount_minor: string; captured_minor: string; captured_currency: string }>(rig, `SELECT currency,amount_minor,captured_minor,captured_currency FROM payment_intent WHERE intent_id='${intentId}'`);
    expect(i!.currency).toBe('VND'); expect(i!.captured_currency).not.toBe('VND'); expect(Number(i!.captured_minor)).toBeGreaterThan(0);
    const [view] = (await unappliedFunds(rig.owner, rig.scope)).intents; expect(view).toMatchObject({ currency: 'VND', capturedCurrency: i!.captured_currency, capturedMinor: i!.captured_minor });
  } finally { await rig.close(); }
});
test('a 429 for the first request cannot erase a refund the sweeper has re-sent and the provider has made', async () => {
  const rig = await createProviderRig('payment');
  try {
    await rig.deliverFixture('signed-exact'); const intentId = rig.currentIntent()!, original = rig.sim.provider.refund!;
    let calls = 0, release!: () => void; const gate = new Promise<void>(r => { release = r; });
    rig.sim.provider.refund = async input => {
      if (++calls === 1) { await gate; return { status: 'rate_limited', retryAfterMs: 1 }; } // the first request: still waiting, then told to slow down
      const made = await original(input); release(); await new Promise(r => setTimeout(r, 300)); return made; // the sweeper's re-send: the provider acts, and the first request's 429 lands before we record it
    };
    const first = requestProviderRefund(rig.owner, rig.scope, { intentId, amountMinor: '30000', reason: 'x', refundId: 'ref-race' }).then(() => 'ok', (e: Error) => e.message);
    while (calls < 1) await new Promise(r => setTimeout(r, 10));
    await rig.reconcile(); expect(await first).toBe('RATE_LIMITED');
    const [i] = await rows<{ refunded_minor: string; refund_status: string }>(rig, `SELECT refunded_minor,refund_status FROM payment_intent WHERE intent_id='${intentId}'`); expect(i).toMatchObject({ refunded_minor: '30000', refund_status: 'confirmed' });
    expect(await rows(rig, `SELECT status FROM payment_refund WHERE refund_id='ref-race'`)).toEqual([{ status: 'confirmed' }]);
  } finally { await rig.close(); }
});
