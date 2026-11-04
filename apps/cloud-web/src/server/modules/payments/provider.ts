import {randomUUID} from 'node:crypto';
import type {CommandEnvelope,JsonObject} from '../../../../../../packages/contracts/generated/wire';
import {hashPayload} from '../../../../../../packages/contracts/src/index';
import {catalog,loadEnabledProfiles,type IntegrationProfile} from '../../../../../../integrations/core/src/profile';
import {verifyPaymentWebhook,type PaymentProvider,type ProviderState} from '../../../../../../integrations/payments/src/provider-adapter';
import {judge,refundable,type Verdict} from '../../../../../../integrations/payments/src/reconciliation';
import {createSimPaymentProvider} from '../../../../../../integrations/payments/src/sim-provider';
import {cloudDatabase,withTenant,type TenantScope} from '../identity/tenant-context';
import {requirePermission,type Actor} from '../identity/rbac';
import {enqueueChannelRelay,providerRelaySource} from '../relay/commands';
import {venueContext} from '../channels/ingress';
import {channelSecret} from '../channels/credentials';
/** `release` runs only production-approved profiles; `sandbox` (development, a sandbox venue) also the contract-tested emulators. Anything else defaults to release. */
export const integrationRuntime=():'release'|'sandbox'=>process.env.INTEGRATION_RUNTIME==='sandbox'?'sandbox':'release';
export function enabledPaymentProfile(profileId:string,profiles:IntegrationProfile[]=catalog):IntegrationProfile{
 const profile=loadEnabledProfiles(profiles,integrationRuntime()).find(p=>p.kind==='payment'&&p.id===profileId);
 if(!profile)throw new Error('PROVIDER_NOT_ENABLED');return profile;
}
/** Where a profile's calls go. Only the emulator resolves here today: a real provider is added with its profile, from its own documentation. Tests replace the resolver. */
const sims=new Map<string,ReturnType<typeof createSimPaymentProvider>>();
export let resolvePaymentProvider=(profile:IntegrationProfile):PaymentProvider=>{
 if(profile.mode!=='simulation')throw new Error('PROVIDER_NOT_ENABLED');
 if(!sims.has(profile.id))sims.set(profile.id,createSimPaymentProvider(profile));return sims.get(profile.id)!.provider;
};
export function setPaymentProviderResolver(fn:typeof resolvePaymentProvider){resolvePaymentProvider=fn;}
/** Webhook secret of a profile. The emulator's is derived from the server master; a real profile reads the secret NAMED in its credentialRefs from the environment. */
export function paymentWebhookSecret(profile:IntegrationProfile):string{
 if(profile.mode==='simulation')return channelSecret('payment:'+profile.id);
 const name=profile.credentialRefs?.[0],value=name?process.env[name]:undefined;if(!value)throw new Error('PROVIDER_CREDENTIALS_UNAVAILABLE');return value;
}
const INTENT_TTL_MS=15*60_000,RELAY_WINDOW_MS=300_000;
type IntentRow={intent_id:string;bill_id:string;profile_id:string;merchant_id:string;amount_minor:string;currency:string;provider_ref:string|null;status:string;captured_minor:string;transaction_id:string|null;venue_operation_id:string|null;venue_status:string|null;attention:string|null;refunded_minor:string;refund_id:string|null;refund_minor:string|null;refund_status:string|null;expires_at:string|Date};
async function featureOn(scope:TenantScope,feature:string){
 const [row]=await withTenant(scope,sql=>sql`SELECT features FROM configuration_revision WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND status='applied' ORDER BY revision DESC LIMIT 1`);
 return (row?.features as Record<string,{status:string}>|undefined)?.[feature]?.status==='enabled';
}
/** One merchant binding per venue and profile: the account the venue's money goes to is configured by a person with `payment.operate`, never taken from a request. */
export async function bindMerchant(actor:Actor,scope:TenantScope,input:{profileId:string;merchantId:string;bin?:string;account?:string}){
 requirePermission(actor,'payment.operate',scope);enabledPaymentProfile(input.profileId);
 if(!/^[A-Za-z0-9._-]{1,60}$/.test(input.merchantId))throw new Error('INVALID_MERCHANT');
 if((input.bin===undefined)!==(input.account===undefined)||(input.bin!==undefined&&(!/^[0-9]{6}$/.test(input.bin)||!/^[A-Za-z0-9]{1,19}$/.test(input.account!))))throw new Error('INVALID_PAYEE');
 await withTenant(scope,sql=>sql`INSERT INTO payment_merchant(organization_id,venue_id,profile_id,merchant_id,payee_bin,payee_account,created_by) VALUES(${scope.organizationId},${scope.venueId},${input.profileId},${input.merchantId},${input.bin??null},${input.account??null},${actor.id}) ON CONFLICT(organization_id,venue_id,profile_id) DO UPDATE SET merchant_id=EXCLUDED.merchant_id,payee_bin=EXCLUDED.payee_bin,payee_account=EXCLUDED.payee_account,created_by=EXCLUDED.created_by`);
 return {profileId:input.profileId,merchantId:input.merchantId};
}
/**
 * Creates the payment request. The intent row exists BEFORE the provider is called (its id is the reference the provider echoes), so a webhook that beats our own response still finds it.
 * A provider failure leaves the intent `created`; reconciliation asks the provider by the same id instead of creating another.
 */
export async function createPaymentIntent(actor:Actor,scope:TenantScope,input:{billId:string;amountMinor:string;profileId:string;intentId?:string}){
 requirePermission(actor,'payment.intent',scope);
 const profile=enabledPaymentProfile(input.profileId);
 if(!await featureOn(scope,'payment.provider'))throw new Error('FEATURE_DISABLED');
 if(!/^[1-9][0-9]{0,29}$/.test(input.amountMinor))throw new Error('INVALID_AMOUNT');
 const intentId=(input.intentId??randomUUID()).toLowerCase();if(!/^[0-9a-f-]{36}$/.test(intentId))throw new Error('INVALID_INTENT_ID');
 const {bill,merchant,existing}=await withTenant(scope,async sql=>({
  bill:(await sql`SELECT state FROM sync_projection WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND aggregate_type='bill' AND aggregate_id=${input.billId}`)[0]?.state as JsonObject|undefined,
  merchant:(await sql`SELECT merchant_id,payee_bin,payee_account FROM payment_merchant WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND profile_id=${input.profileId}`)[0],
  existing:(await sql`SELECT * FROM payment_intent WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND intent_id=${intentId}`)[0] as IntentRow|undefined,
 }));
 if(existing){if(existing.bill_id!==input.billId||String(existing.amount_minor)!==input.amountMinor||existing.profile_id!==input.profileId)throw new Error('IDEMPOTENCY_CONFLICT');return intentView(existing);}
 if(!merchant)throw new Error('MERCHANT_NOT_BOUND');
 if(!bill||bill.status!=='prepared')throw new Error('BILL_NOT_PAYABLE');
 const due=BigInt(String(bill.totalMinor))-BigInt(String(bill.paidMinor??'0'))+BigInt(String(bill.refundedMinor??'0'));
 if(BigInt(input.amountMinor)>due)throw new Error('AMOUNT_EXCEEDS_DUE');
 const currency=String(bill.currency??'VND'),expiresAt=new Date(Date.now()+INTENT_TTL_MS);
 await withTenant(scope,sql=>sql`INSERT INTO payment_intent(organization_id,venue_id,intent_id,bill_id,profile_id,merchant_id,amount_minor,currency,expires_at,created_by) VALUES(${scope.organizationId},${scope.venueId},${intentId},${input.billId},${input.profileId},${merchant.merchant_id},${input.amountMinor},${currency},${expiresAt},${actor.id})`);
 try{
  const made=await resolvePaymentProvider(profile).createIntent({intentId,amountMinor:input.amountMinor,currency,merchantId:String(merchant.merchant_id),...(merchant.payee_bin?{payee:{bin:String(merchant.payee_bin),account:String(merchant.payee_account)}}:{}),expiresAt:expiresAt.toISOString()});
  await withTenant(scope,sql=>sql`UPDATE payment_intent SET provider_ref=${made.providerRef},qr_payload=${made.qrPayload??null},status=CASE WHEN status='created' THEN 'pending' ELSE status END,updated_at=now() WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND intent_id=${intentId}`);
 }catch{/* unknown: the row stays `created`; reconcile queries by intentId */}
 return intentView((await loadIntent(scope,intentId))!);
}
async function loadIntent(scope:TenantScope,intentId:string){return (await withTenant(scope,sql=>sql`SELECT * FROM payment_intent WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND intent_id=${intentId}`))[0] as IntentRow|undefined;}
export function intentView(r:IntentRow){
 return {intentId:r.intent_id,billId:r.bill_id,status:r.status,amountMinor:String(r.amount_minor),currency:r.currency,capturedMinor:String(r.captured_minor),refundedMinor:String(r.refunded_minor),...(r.provider_ref?{providerRef:r.provider_ref}:{}),
  // a QR on screen asks for payment; it is not a payment: only `captured` (verified provider fact) counts
  ...(r.status==='pending'||r.status==='created'?{qrPayload:(r as unknown as {qr_payload:string|null}).qr_payload}:{}),...(r.attention?{attention:r.attention}:{}),...(r.venue_status?{venueStatus:r.venue_status}:{}),...(r.refund_status?{refundStatus:r.refund_status}:{}),expiresAt:new Date(r.expires_at).toISOString()};
}
/** Tell the venue that verified money arrived (its own Payment.RecordProvider decides whether the bill can take it). Re-sendable: the payment reference makes the venue idempotent. */
async function forwardToVenue(scope:TenantScope,row:IntentRow,transactionId:string){
 const attempt=1+Number((await withTenant(scope,sql=>sql`SELECT count(*)::int AS n FROM relay_command WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND operation_id LIKE ${'pay-'+row.intent_id+'-a%'}`))[0]!.n);
 const payload:JsonObject={billId:row.bill_id,amountMinor:String(row.amount_minor),currency:row.currency,status:'captured',reference:{provider:row.profile_id,merchantId:row.merchant_id,transactionId}};
 const ctx=await venueContext(scope),at=new Date().toISOString(),operationId=`pay-${row.intent_id}-a${attempt}`;
 const command:CommandEnvelope={schemaVersion:1,...scope,operationId,type:'Payment.RecordProvider',actorRef:'provider:'+row.profile_id,...providerRelaySource,coordinatorEpoch:ctx.epoch,policyRevision:ctx.policyRevision,occurredAt:at,recordedAt:at,payload,payloadHash:hashPayload(payload)};
 await enqueueChannelRelay(command,new Date(Date.now()+RELAY_WINDOW_MS).toISOString());
 await withTenant(scope,sql=>sql`UPDATE payment_intent SET venue_operation_id=${operationId},venue_status='pending',updated_at=now() WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND intent_id=${row.intent_id}`);
}
async function settle(scope:TenantScope,row:IntentRow,verdict:Verdict,state:ProviderState){
 const captured=state.status==='captured'?state:undefined;
 if(verdict==='settle'&&captured){
  const moved=await withTenant(scope,sql=>sql`UPDATE payment_intent SET status='captured',captured_minor=${captured.amountMinor},transaction_id=${captured.transactionId},updated_at=now() WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND intent_id=${row.intent_id} AND status IN('created','pending','unknown') RETURNING intent_id`);
  if(moved.length||(row.status==='captured'&&!row.venue_operation_id))await forwardToVenue(scope,{...row,amount_minor:captured.amountMinor},captured.transactionId);
 }else if(verdict==='unapplied'&&captured){
  await withTenant(scope,sql=>sql`UPDATE payment_intent SET status='unapplied',captured_minor=${captured.amountMinor},transaction_id=${captured.transactionId},attention=${captured.currency!==row.currency?'CURRENCY_MISMATCH':'AMOUNT_MISMATCH'},updated_at=now() WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND intent_id=${row.intent_id} AND status IN('created','pending','unknown')`);
 }else if(verdict==='foreign'){
  await withTenant(scope,sql=>sql`UPDATE payment_intent SET attention='FOREIGN_MERCHANT_EVENT',updated_at=now() WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND intent_id=${row.intent_id}`);
 }else if(verdict==='close'){
  await withTenant(scope,sql=>sql`UPDATE payment_intent SET status=${state.status==='expired'?'expired':'failed'},updated_at=now() WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND intent_id=${row.intent_id} AND status IN('created','pending','unknown')`);
 }
}
/** Ask the provider for the truth about one intent and apply it. A thrown query leaves the intent as it was (or `unknown` once it has been waiting). */
async function examine(scope:TenantScope,row:IntentRow,provider:PaymentProvider){
 let state:ProviderState;
 try{state=await provider.query({intentId:row.intent_id,providerRef:row.provider_ref});}
 catch(error){if(row.status==='pending')await withTenant(scope,sql=>sql`UPDATE payment_intent SET status='unknown',updated_at=now() WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND intent_id=${row.intent_id} AND status='pending'`);throw error;}
 const payee=await withTenant(scope,async sql=>(await sql`SELECT payee_account FROM payment_merchant WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND profile_id=${row.profile_id}`)[0]?.payee_account as string|undefined);
 const verdict=judge({merchant:row.merchant_id,currency:row.currency,amount:String(row.amount_minor),...(payee?{payee}:{})},state);
 await settle(scope,row,verdict,state);return verdict;
}
/**
 * Provider webhook. Order: signature on the raw bytes + timestamp → event id seen before? → the intent (tenant) from OUR reference → QUERY the provider (the body is only a hint) →
 * bind merchant, currency and amount → record / forward. A failed query is answered 503 so the provider retries; the event stays unprocessed until one attempt completes.
 */
export async function receivePaymentWebhook(input:{profileId:string;rawBody:string;headers:{get(name:string):string|null};nowMs?:number}){
 const profile=enabledPaymentProfile(input.profileId),nowMs=input.nowMs??Date.now();
 const event=verifyPaymentWebhook(profile,paymentWebhookSecret(profile),input.rawBody,input.headers,nowMs);
 const [found]=await cloudDatabase()`SELECT * FROM public.payment_intent_lookup(${event.intentId}::uuid)`;
 if(!found||found.profile_id!==profile.id)throw new Error('INTENT_NOT_FOUND');
 const scope={organizationId:String(found.organization_id),venueId:String(found.venue_id)};
 const fresh=await withTenant(scope,async sql=>{
  const inserted=await sql`INSERT INTO payment_provider_event(profile_id,event_id,organization_id,venue_id,intent_id) VALUES(${profile.id},${event.eventId},${scope.organizationId},${scope.venueId},${event.intentId}) ON CONFLICT DO NOTHING RETURNING event_id`;
  if(inserted.length)return true;
  const [seen]=await sql`SELECT outcome FROM payment_provider_event WHERE profile_id=${profile.id} AND event_id=${event.eventId}`;
  return seen?.outcome==='received'; // an earlier attempt that never finished is processed now
 });
 if(!fresh)return {duplicate:true};
 const row=(await loadIntent(scope,event.intentId))!;
 const verdict=await examine(scope,row,resolvePaymentProvider(profile));
 await withTenant(scope,sql=>sql`UPDATE payment_provider_event SET outcome=${verdict} WHERE profile_id=${profile.id} AND event_id=${event.eventId}`);
 return {duplicate:false,outcome:verdict};
}
/** Periodic sweep (job-friendly, bounded): query intents still open, close old ones the provider does not know, resend captures the venue has not recorded, learn the venue's refusals. */
export async function reconcilePaymentIntents(scope:TenantScope,nowMs=Date.now(),limit=50){
 const rows=await withTenant(scope,sql=>sql`SELECT * FROM payment_intent WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND (status IN('created','pending','unknown') OR (status='captured' AND COALESCE(venue_status,'pending')<>'recorded') OR refund_status IN('pending','unknown')) ORDER BY created_at LIMIT ${limit}`) as unknown as IntentRow[];
 const report={queried:0,resent:0,venueRefused:0,expired:0,refunds:0,errors:0};
 for(const row of rows){
  const profile=enabledPaymentProfile(row.profile_id),provider=resolvePaymentProvider(profile);
  try{
   if(['created','pending','unknown'].includes(row.status)){
    const verdict=await examine(scope,row,provider);report.queried++;
    if(verdict==='wait'&&Date.parse(new Date(row.expires_at).toISOString())<=nowMs){await withTenant(scope,sql=>sql`UPDATE payment_intent SET status='expired',updated_at=now() WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND intent_id=${row.intent_id} AND status IN('created','pending','unknown')`);report.expired++;}
   }else if(row.status==='captured'){
    const [relay]=row.venue_operation_id?await withTenant(scope,sql=>sql`SELECT status,venue_receipt,expires_at FROM relay_command WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND operation_id=${row.venue_operation_id}`):[];
    if(relay?.status==='accepted')await withTenant(scope,sql=>sql`UPDATE payment_intent SET venue_status='recorded',updated_at=now() WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND intent_id=${row.intent_id}`);
    else if(relay?.status==='rejected'){ // the bill could not take it (already paid in cash, closed, voided …): the money is real, it stays visible as unapplied for a person
     await withTenant(scope,sql=>sql`UPDATE payment_intent SET status='unapplied',venue_status='refused',attention=${'VENUE_REJECTED:'+String((relay.venue_receipt as JsonObject|null)?.code??'REJECTED')},updated_at=now() WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND intent_id=${row.intent_id}`);report.venueRefused++;
    }else if(!relay||(relay.status==='pending'&&Date.parse(relay.expires_at)<=nowMs)){await forwardToVenue(scope,row,row.transaction_id!);report.resent++;}
   }
   if(row.refund_status&&['pending','unknown'].includes(row.refund_status)&&row.refund_id&&provider.queryRefund){
    const r=await provider.queryRefund({refundId:row.refund_id});
    if(r.status==='confirmed')await withTenant(scope,sql=>sql`UPDATE payment_intent SET refunded_minor=refunded_minor+${row.refund_minor!},refund_status='confirmed',updated_at=now() WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND intent_id=${row.intent_id} AND refund_status IN('pending','unknown')`);
    else if(r.status==='rejected')await withTenant(scope,sql=>sql`UPDATE payment_intent SET refund_status='rejected',updated_at=now() WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND intent_id=${row.intent_id} AND refund_status IN('pending','unknown')`);
    report.refunds++;
   }
  }catch{report.errors++;}
 }
 return report;
}
/** Refund through the provider. One at a time per intent; never more than captured − refunded; a lost answer is `unknown` and is queried by the same refundId, never re-issued under a new one. */
export async function requestProviderRefund(actor:Actor,scope:TenantScope,input:{intentId:string;amountMinor:string;reason:string;refundId?:string}){
 requirePermission(actor,'payment.refund',scope);
 if(!/^[1-9][0-9]{0,29}$/.test(input.amountMinor)||!input.reason?.trim())throw new Error('INVALID_REFUND');
 const refundId=input.refundId??randomUUID();
 const row=await loadIntent(scope,input.intentId);if(!row)throw new Error('INTENT_NOT_FOUND');
 const provider=resolvePaymentProvider(enabledPaymentProfile(row.profile_id));if(!provider.refund)throw new Error('REFUND_UNSUPPORTED');
 if(row.refund_id===refundId&&row.refund_status)return intentView(row); // the same request again
 if(!['captured','unapplied'].includes(row.status))throw new Error('INTENT_NOT_CAPTURED');
 if(row.refund_status&&['pending','unknown'].includes(row.refund_status))throw new Error('REFUND_IN_PROGRESS');
 if(BigInt(input.amountMinor)>BigInt(refundable(String(row.captured_minor),String(row.refunded_minor))))throw new Error('REFUND_EXCEEDS_CAPTURED');
 const claimed=await withTenant(scope,sql=>sql`UPDATE payment_intent SET refund_id=${refundId},refund_minor=${input.amountMinor},refund_status='pending',updated_at=now() WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND intent_id=${input.intentId} AND (refund_status IS NULL OR refund_status IN('confirmed','rejected')) RETURNING intent_id`);
 if(!claimed.length)throw new Error('REFUND_IN_PROGRESS');
 try{
  const result=await provider.refund({refundId,intentId:row.intent_id,providerRef:row.provider_ref,amountMinor:input.amountMinor,reason:input.reason});
  if(result.status==='confirmed')await withTenant(scope,sql=>sql`UPDATE payment_intent SET refunded_minor=refunded_minor+${input.amountMinor},refund_status='confirmed',updated_at=now() WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND intent_id=${input.intentId}`);
  else if(result.status==='rejected')await withTenant(scope,sql=>sql`UPDATE payment_intent SET refund_status='rejected',updated_at=now() WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND intent_id=${input.intentId}`);
  else{await withTenant(scope,sql=>sql`UPDATE payment_intent SET refund_id=NULL,refund_minor=NULL,refund_status=NULL,updated_at=now() WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND intent_id=${input.intentId}`);throw new Error('RATE_LIMITED');} // 429: nothing happened, the same refundId may be sent again
 }catch(error){
  if(error instanceof Error&&error.message==='RATE_LIMITED')throw error;
  await withTenant(scope,sql=>sql`UPDATE payment_intent SET refund_status='unknown',updated_at=now() WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND intent_id=${input.intentId}`);
 }
 return intentView((await loadIntent(scope,input.intentId))!);
}
/** Real money that is NOT on a bill: the provider took it but the amount/currency differed, or the venue refused to record it. Never silently dropped. */
export async function unappliedFunds(actor:Actor,scope:TenantScope){
 requirePermission(actor,'payment.operate',scope);
 const rows=await withTenant(scope,sql=>sql`SELECT * FROM payment_intent WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND status='unapplied' ORDER BY created_at`) as unknown as IntentRow[];
 return {intents:rows.map(intentView)};
}
export async function readPaymentIntent(actor:Actor,scope:TenantScope,intentId:string){
 requirePermission(actor,'payment.intent',scope);
 const row=await loadIntent(scope,intentId);if(!row)throw new Error('INTENT_NOT_FOUND');return intentView(row);
}
