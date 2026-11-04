import {expect,test} from 'vitest';
import {createProviderRig} from '../support/provider-rig';
import '../support/einvoice-rig';
import {createRestaurantLab} from '../support/restaurant-lab';
import fixture from '../fixtures/restaurant-v1.json';
import type {JsonObject} from '../../packages/contracts/src/index';
import {nextInvoiceAction,afterQuery,requestKeyFor} from '../../integrations/einvoice/src/issue-query';
import {adjustmentAllowed,refundNeedsAmendment} from '../../integrations/einvoice/src/amendment';
import {accountingCsv,accountingLines} from '../../integrations/accounting/src/export';
import {amendInvoice,issueInvoice,collectInvoiceRequests,listInvoices,resolveInvoiceProvider,setInvoiceProviderResolver} from '../../apps/cloud-web/src/server/modules/invoices/issuer';
import {rolePermissions,type Actor} from '../../apps/cloud-web/src/server/modules/identity/rbac';
type Rig=Awaited<ReturnType<typeof createProviderRig<'einvoice'>>>;
const owner=(rig:Rig):Actor=>({id:'owner',organizationId:rig.scope.organizationId,venueIds:[rig.scope.venueId],permissions:rolePermissions('owner'),role:'owner'});
test('issue timeout is queried before any second issue request',async()=>{
 const rig=await createProviderRig('einvoice');
 try{
  expect(rig.emulated).toBe(true);
  await rig.fault('issue-response-lost');
  expect((await rig.issue('bill-1')).status).toBe('unknown'); // the provider acted, we never heard
  expect((await rig.state('bill-1')).status).toBe('unknown');
  expect((await rig.reconcile('bill-1')).status).toBe('issued');
  expect(rig.callCount('issue')).toBe(1);
  expect(rig.callCount('query')).toBeGreaterThan(0);
  expect(rig.sim.issuedCount()).toBe(1); // one invoice at the provider
  const [relay]=await rig.admin`SELECT command FROM relay_command WHERE organization_id=${rig.scope.organizationId} AND command->>'type'='Invoice.Record'`;
  expect(relay!.command).toMatchObject({deviceId:'cloud-provider',payload:{requestId:'inv-bill-1',status:'issued'}});expect(relay!.command.payload.code).toMatch(/^SIM\//);
 }finally{await rig.close();}
});
test('an unknown request is never issued again by calling issue; only the provider saying "never saw it" re-opens it',async()=>{
 const rig=await createProviderRig('einvoice');
 try{
  await rig.fault('issue-dropped'); // the call died before the provider saw it
  expect((await rig.issue('bill-1')).status).toBe('unknown');
  await rig.fault('query-fails');
  expect((await rig.reconcile('bill-1')).status).toBe('unknown'); // cannot tell yet
  await issueInvoice(rig.scope,'inv-bill-1');expect(rig.callCount('issue')).toBe(1); // issueInvoice on an unknown request only queries
  expect((await rig.reconcile('bill-1')).status).toBe('draft'); // the provider answered "not found": safe to issue
  expect((await issueInvoice(rig.scope,'inv-bill-1')).status).toBe('issued');
  expect(rig.callCount('issue')).toBe(2);expect(rig.sim.issuedCount()).toBe(1);
  expect((await issueInvoice(rig.scope,'inv-bill-1')).status).toBe('issued'); // done: nothing more to do
  expect(rig.callCount('issue')).toBe(2);
 }finally{await rig.close();}
});
test('duplicate issue key: collecting and issuing repeatedly yields one request, one provider call, one answer to the venue',async()=>{
 const rig=await createProviderRig('einvoice');
 try{
  await rig.issue('bill-1');
  await collectInvoiceRequests(rig.scope,'sim-einvoice');await collectInvoiceRequests(rig.scope,'sim-einvoice');
  await issueInvoice(rig.scope,'inv-bill-1');await issueInvoice(rig.scope,'inv-bill-1');
  expect((await rig.admin`SELECT count(*)::int AS n FROM invoice_request WHERE organization_id=${rig.scope.organizationId}`)[0]!.n).toBe(1);
  expect(rig.callCount('issue')).toBe(1);expect(await rig.relayCount('Invoice.Record')).toBe(1);
  expect(requestKeyFor('o','v','r')).toBe('o:v:r');
 }finally{await rig.close();}
});
test('a provider rejection is final and shown with its reason; invalid tax totals are never issued; a 429 changes nothing',async()=>{
 const rig=await createProviderRig('einvoice');
 try{
  await rig.addBill('bill-bad',{totalMinor:'100000',taxMinor:'999999999'}); // tax larger than the total: the lines cannot add up
  expect((await rig.issue('bill-bad')).status).toBe('rejected');
  const [rejected]=await rig.admin`SELECT command FROM relay_command WHERE organization_id=${rig.scope.organizationId} AND command->>'type'='Invoice.Record'`;expect(rejected!.command.payload).toMatchObject({status:'rejected'});expect(rejected!.command.payload.reason).toMatch(/tax/);expect(rig.callCount('issue')).toBe(0); // caught before the provider was bothered
  expect((await rig.state('bill-bad')).invoice_code).toBeNull();
  await rig.fault('issue-rate-limit');
  await expect(rig.issue('bill-ok')).rejects.toThrow('RATE_LIMITED');
  expect((await rig.state('bill-ok')).status).toBe('draft'); // nothing happened at the provider
  expect((await rig.issue('bill-ok')).status).toBe('issued');expect(rig.sim.issuedCount()).toBe(1);
 }finally{await rig.close();}
});
test('adjust and cancel work only on an issued invoice, are idempotent by key, never delete, and need the provider to support them',async()=>{
 const rig=await createProviderRig('einvoice');
 try{
  const actor=owner(rig),scope=rig.scope,input={requestId:'inv-bill-1',action:'adjust' as const,reason:'customer returned a dish',deltaMinor:'-20000',key:'adj-1'};
  await rig.issue('bill-1');
  await expect(amendInvoice({...actor,permissions:rolePermissions('cashier'),role:'cashier'},scope,input)).rejects.toThrow('PERMISSION_DENIED');
  expect(await amendInvoice(actor,scope,input)).toMatchObject({status:'issued',providerRef:expect.stringMatching(/^sim-adj-/)});
  expect(await amendInvoice(actor,scope,input)).toMatchObject({duplicate:true});expect(rig.callCount('amend')).toBe(1);
  expect(await rig.relayCount('Invoice.Record')).toBe(2); // issued + adjusted
  expect(await amendInvoice(actor,scope,{...input,action:'cancel',key:'can-1',reason:'issued by mistake'})).toMatchObject({status:'cancelled'});
  await expect(amendInvoice(actor,scope,{...input,key:'adj-2'})).rejects.toThrow('INVOICE_NOT_ISSUED'); // cancelled is final
  await rig.addBill('bill-2');await rig.fault('issue-dropped');await rig.issue('bill-2');
  await expect(amendInvoice(actor,scope,{...input,requestId:'inv-bill-2',key:'adj-3'})).rejects.toThrow('INVOICE_NOT_ISSUED'); // never issued
  const previous=resolveInvoiceProvider;setInvoiceProviderResolver(p=>({...previous(p),amend:undefined,cancel:undefined}));
  await rig.addBill('bill-3');await issueInvoice(rig.scope,'inv-bill-3').catch(()=>{});await collectInvoiceRequests(rig.scope,'sim-einvoice');await issueInvoice(rig.scope,'inv-bill-3');
  await expect(amendInvoice(actor,scope,{...input,requestId:'inv-bill-3',key:'adj-4'})).rejects.toThrow('UNSUPPORTED_BY_PROVIDER');setInvoiceProviderResolver(previous);
  expect((await listInvoices(actor,scope)).invoices.find(i=>i.requestId==='inv-bill-1')!.status).toBe('cancelled'); // kept, with its history
 }finally{await rig.close();}
});
test('a refund of an issued invoice needs a matching adjustment; other states are not blocked; statuses and next steps are exact',()=>{
 expect(refundNeedsAmendment('issued','20000','0')).toBe(true);expect(refundNeedsAmendment('issued','20000','-20000')).toBe(false);expect(refundNeedsAmendment('issued','20000','-5000')).toBe(true);
 expect(refundNeedsAmendment('cancelled','20000','0')).toBe(false);expect(refundNeedsAmendment('requested','20000','0')).toBe(false);expect(refundNeedsAmendment('external','20000','0')).toBe(false);
 expect(adjustmentAllowed('issued','adjust')).toBe(true);for(const s of ['draft','unknown','rejected','cancelled'])expect(adjustmentAllowed(s,'cancel')).toBe(false);
 expect(nextInvoiceAction('unknown')).toBe('query');expect(nextInvoiceAction('draft')).toBe('issue');expect(nextInvoiceAction('issued')).toBe('none');expect(afterQuery('not_found')).toBe('draft');
});
test('lapsed relay of a provider answer is resent; the venue accepting it ends the resends',async()=>{
 const rig=await createProviderRig('einvoice');
 try{
  await rig.issue('bill-1');
  await rig.admin`UPDATE relay_command SET expires_at=now()-interval '1 minute' WHERE organization_id=${rig.scope.organizationId} AND command->>'type'='Invoice.Record'`; // venue offline past the window
  expect((await rig.reconcileAll()).resent).toBe(1);expect(await rig.relayCount('Invoice.Record')).toBe(2);
  await rig.admin`UPDATE relay_command SET status='accepted',venue_receipt='{"status":"accepted","ack":"venue"}' WHERE organization_id=${rig.scope.organizationId} AND command->>'type'='Invoice.Record' AND status='pending'`;
  expect((await rig.reconcileAll()).recorded).toBe(1);expect((await rig.state('bill-1')).venue_status).toBe('recorded');
  expect((await rig.reconcileAll()).resent).toBe(0);
 }finally{await rig.close();}
});
test('a cancellation or rejection is re-sent in a form the venue accepts', async () => {
  const rig = await createProviderRig('einvoice');
  try {
    await rig.issue('bill-1'); await amendInvoice(owner(rig), rig.scope, { requestId: 'inv-bill-1', action: 'cancel', reason: 'mistake', key: 'c-1' });
    await rig.admin`UPDATE relay_command SET status='accepted',venue_receipt='{"status":"accepted","ack":"venue"}' WHERE organization_id=${rig.scope.organizationId} AND operation_id LIKE '%issued%'`;
    await rig.admin`UPDATE relay_command SET expires_at=now()-interval '1 minute' WHERE organization_id=${rig.scope.organizationId} AND command->'payload'->>'status'='cancelled'`; // venue offline when the cancellation was sent
    await rig.admin`UPDATE invoice_request SET venue_status='pending' WHERE organization_id=${rig.scope.organizationId}`;
    await rig.reconcileAll();
    const rows = await rig.admin`SELECT command->'payload' AS p FROM relay_command WHERE organization_id=${rig.scope.organizationId} AND command->'payload'->>'status'='cancelled' ORDER BY created_at DESC LIMIT 1`;
    expect(rows[0]!.p).toMatchObject({ status: 'cancelled', providerRef: expect.stringMatching(/^sim-can-/), reason: 'mistake' }); // not "resent" with no reference
  } finally { await rig.close(); }
});
test('venue side: request needs the feature and a closed bill, validates the buyer, is one per bill; issued needs the provider code; an external link is never an issue',async()=>{
 const lab=await createRestaurantLab();
 try{
  const features=(fixture.configuration as unknown as {features:Record<string,unknown>}).features;
  await lab.seed('bill','closed-1',{status:'closed',totalMinor:'110000',paidMinor:'110000',refundedMinor:'0',currency:'VND',summary:{subtotalMinor:'100000',taxMinor:'10000'},orderIds:[],lines:[],version:1});
  await lab.seed('bill','open-1',{status:'prepared',totalMinor:'1000',paidMinor:'0',refundedMinor:'0',currency:'VND',orderIds:[],lines:[],version:1});
  const request=(billId:string,buyer:JsonObject={name:'Công ty ABC',taxCode:'0312345678'},actor='cashier')=>lab.command(actor,'Invoice.Request',{billId,buyer});
  expect((await request('closed-1')).code).toBe('FEATURE_DISABLED'); // einvoice is off by default
  await lab.seed('configuration','applied',{...fixture.configuration,features:{...features,billing:{status:'enabled',revision:1},einvoice:{status:'enabled',revision:1}}} as JsonObject);
  expect((await request('open-1')).code).toBe('BILL_NOT_CLOSED');
  expect((await request('closed-1',{name:'A',taxCode:'12345'})).code).toBe('INVALID_TAX_CODE');
  expect((await request('closed-1',{name:'  '})).code).toBe('BUYER_NAME_REQUIRED');
  expect((await request('closed-1',{name:'A',email:'not-an-email'})).code).toBe('INVALID_EMAIL');
  const ok=await request('closed-1');expect(ok.status).toBe('accepted');
  expect(await lab.state<{status:string;totalMinor:string}>('invoice-request','inv-closed-1')).toMatchObject({status:'requested',totalMinor:'110000'});
  expect((await request('closed-1')).value.duplicate).toBe(true);expect(await lab.count('InvoiceRequested')).toBe(1);
  const record=(over:JsonObject,op?:string)=>lab.command('cloud-provider','Invoice.Record',{requestId:'inv-closed-1',...over},op);
  expect((await record({status:'issued'})).code).toBe('PROVIDER_ID_REQUIRED'); // no "issued" without the provider's id AND code
  expect((await record({status:'issued',providerInvoiceId:'p-1'})).code).toBe('PROVIDER_CODE_REQUIRED');
  expect((await lab.command('owner','Invoice.Record',{requestId:'inv-closed-1',status:'issued',providerInvoiceId:'p',code:'c'})).code).toBe('CLOUD_SOURCE_REQUIRED');
  expect((await lab.command('cashier','Invoice.Record',{requestId:'inv-closed-1',status:'issued',providerInvoiceId:'p',code:'c'})).code).toBe('FORBIDDEN'); // staff cannot declare an invoice issued
  expect((await record({status:'adjusted',providerRef:'x',reason:'r'})).code).toBe('INVOICE_NOT_ISSUED');
  expect((await record({status:'issued',providerInvoiceId:'p-1',code:'SIM/000001'},'rec-1')).status).toBe('accepted');
  expect((await record({status:'issued',providerInvoiceId:'p-1',code:'SIM/000001'},'rec-1b')).value.duplicate).toBe(true);
  expect((await record({status:'issued',providerInvoiceId:'p-2',code:'SIM/000002'},'rec-2')).code).toBe('INVOICE_ALREADY_ISSUED');
  expect((await record({status:'adjusted',providerRef:'adj-1',reason:'return',deltaMinor:'-20000'},'rec-3')).status).toBe('accepted');
  expect((await record({status:'adjusted',providerRef:'adj-1',reason:'return',deltaMinor:'-20000'},'rec-3b')).value.duplicate).toBe(true);
  expect((await record({status:'cancelled',providerRef:'can-1',reason:'mistake'},'rec-4')).status).toBe('accepted');
  expect((await lab.state<{status:string;adjustments:unknown[]}>('invoice-request','inv-closed-1'))).toMatchObject({status:'cancelled',adjustments:[{providerRef:'adj-1'}]});
  await lab.seed('bill','old-1',{status:'closed',totalMinor:'5000',paidMinor:'5000',refundedMinor:'0',currency:'VND',orderIds:[],lines:[],version:1});
  expect((await lab.command('cashier','Invoice.LinkExternal',{billId:'old-1',invoiceNumber:'AB/23E-0001',source:'paper book'})).status).toBe('accepted');
  expect((await lab.state<{status:string}>('invoice-request','inv-old-1')).status).toBe('external'); // a link, not an issue
  expect((await lab.command('cashier','Invoice.LinkExternal',{billId:'old-1',invoiceNumber:'x',source:'y'},'again')).code).toBe('INVOICE_EXISTS');
 }finally{await lab.close();}
});
test('accounting export: one line per closed bill of the venue business date, invoice status stated, CSV escaped, completeness in the header',()=>{
 const at=(h:string)=>`2026-10-30T${h}:00:00.000Z`;
 const bill=(id:string,state:JsonObject)=>({ref:{organizationId:'o',venueId:'v',kind:'bill',id},version:1,state});
 const inv=(billId:string,state:JsonObject)=>({ref:{organizationId:'o',venueId:'v',kind:'invoice-request',id:'inv-'+billId},version:1,state:{billId,...state}});
 const snaps=[bill('b-2',{status:'closed',closedAt:at('05'),currency:'VND',totalMinor:'110000',paidMinor:'110000',refundedMinor:'0',summary:{subtotalMinor:'100000',taxMinor:'10000'}}),
  bill('=cmd|b-1',{status:'closed',closedAt:at('04'),currency:'VND',totalMinor:'50000',paidMinor:'50000'}),bill('b-open',{status:'prepared',currency:'VND',totalMinor:'1'}),
  bill('b-other-day',{status:'closed',closedAt:'2026-10-29T05:00:00.000Z',currency:'VND',totalMinor:'7'}),
  inv('b-2',{status:'issued',code:'SIM/000001'}),inv('=cmd|b-1',{status:'external',externalNumber:'AB/1'})];
 const lines=accountingLines(snaps,'2026-10-30','UTC');
 expect(lines.map(l=>l.billId)).toEqual(['=cmd|b-1','b-2']);expect(lines[1]).toMatchObject({invoiceStatus:'issued',invoiceCode:'SIM/000001',taxMinor:'10000',totalMinor:'110000'});expect(lines[0]).toMatchObject({invoiceStatus:'external',invoiceCode:'AB/1'});
 const csv=accountingCsv(lines,{venueId:'v',businessDate:'2026-10-30',asOf:'2026-10-30T10:00:00.000Z',complete:false});
 expect(csv.split('\n')[0]).toContain('mekoniq-accounting-1');expect(csv.split('\n')[0]).toContain('complete=false');expect(csv).toContain("'=cmd|b-1"); // formula-looking text is neutralised
 expect(accountingLines(snaps.slice(2,3),'2026-10-30','UTC')).toEqual([]);expect(accountingLines([bill('t',{status:'closed',closedAt:'2026-10-30T20:00:00.000Z',currency:'VND',totalMinor:'1'})],'2026-10-31','Asia/Ho_Chi_Minh')).toHaveLength(1); // business date is the venue's local day
});
test('a refund on a bill whose invoice was issued leaves a tracked amendment obligation until the provider confirms a matching adjustment', async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.seed('bill', 'bill-r', { status: 'closed', totalMinor: '100000', paidMinor: '100000', refundedMinor: '0', unappliedMinor: '0', currency: 'VND', orderIds: [], lines: [], version: 1 });
    await lab.seed('payment', 'pay-r', { status: 'captured', billId: 'bill-r', method: 'transfer', capturedMinor: '100000', appliedMinor: '100000', unappliedMinor: '0', refundedMinor: '0', currency: 'VND', version: 1 });
    await lab.seed('invoice-request', 'inv-bill-r', { billId: 'bill-r', status: 'issued', providerInvoiceId: 'P1', code: 'C1', currency: 'VND', totalMinor: '100000', adjustments: [], version: 1 });
    const refund = await lab.command('manager', 'Refund.Record', { paymentId: 'pay-r', expectedVersion: 1, amountMinor: '20000', reason: 'cold', evidenceRef: 'ev-1' }); expect(refund.status).toBe('accepted');
    expect(await lab.state('invoice-request', 'inv-bill-r')).toMatchObject({ status: 'issued', refundedSinceRequestMinor: '20000', amendmentDue: true });
    const adjusted = await lab.command('cloud-provider', 'Invoice.Record', { requestId: 'inv-bill-r', status: 'adjusted', providerRef: 'adj-1', reason: 'refund', deltaMinor: '-20000' }); expect(adjusted.status).toBe('accepted');
    expect(await lab.state('invoice-request', 'inv-bill-r')).toMatchObject({ amendmentDue: false });
  } finally { await lab.close(); }
});
test('a refund made while the tablet still sees the request as requested is owed as an amendment once the provider issues it', async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.seed('bill', 'bill-q', { status: 'closed', totalMinor: '100000', paidMinor: '100000', refundedMinor: '0', unappliedMinor: '0', currency: 'VND', orderIds: [], lines: [], version: 1 });
    await lab.seed('payment', 'pay-q', { status: 'captured', billId: 'bill-q', method: 'transfer', capturedMinor: '100000', appliedMinor: '100000', unappliedMinor: '0', refundedMinor: '0', currency: 'VND', version: 1 });
    await lab.seed('invoice-request', 'inv-bill-q', { billId: 'bill-q', status: 'requested', currency: 'VND', totalMinor: '100000', adjustments: [], version: 1 });
    expect((await lab.command('manager', 'Refund.Record', { paymentId: 'pay-q', expectedVersion: 1, amountMinor: '20000', reason: 'cold', evidenceRef: 'ev-q' })).status).toBe('accepted');
    expect(await lab.state('invoice-request', 'inv-bill-q')).toMatchObject({ status: 'requested', refundedSinceRequestMinor: '20000', amendmentDue: false }); // nothing to adjust yet: nothing is issued
    expect((await lab.command('cloud-provider', 'Invoice.Record', { requestId: 'inv-bill-q', status: 'issued', providerInvoiceId: 'P9', code: 'C9' })).status).toBe('accepted');
    expect(await lab.state('invoice-request', 'inv-bill-q')).toMatchObject({ status: 'issued', amendmentDue: true }); // issued for the full 100000: the 20000 already returned is now owed
  } finally { await lab.close(); }
});
