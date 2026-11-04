import type {CommandEnvelope,JsonObject} from '../../../../../../packages/contracts/generated/wire';
import {hashPayload} from '../../../../../../packages/contracts/src/index';
import {catalog,type IntegrationProfile} from '../../../../../../integrations/core/src/profile';
import type {InvoiceProvider,IssueInput,IssueResult} from '../../../../../../integrations/einvoice/src/provider-adapter';
import {afterQuery,nextInvoiceAction,requestKeyFor} from '../../../../../../integrations/einvoice/src/issue-query';
import {adjustmentAllowed} from '../../../../../../integrations/einvoice/src/amendment';
import {createSimInvoiceProvider} from '../../../../../../integrations/einvoice/src/sim-provider';
import {loadEnabledProfiles} from '../../../../../../integrations/core/src/profile';
import {requirePermission,type Actor} from '../identity/rbac';
import {withTenant,type TenantScope} from '../identity/tenant-context';
import {enqueueChannelRelay,providerRelaySource} from '../relay/commands';
import {venueContext} from '../channels/ingress';
import {integrationRuntime} from '../payments/provider';
export function enabledInvoiceProfile(profileId:string,profiles:IntegrationProfile[]=catalog):IntegrationProfile{
 const profile=loadEnabledProfiles(profiles,integrationRuntime()).find(p=>p.kind==='einvoice'&&p.id===profileId);
 if(!profile)throw new Error('PROVIDER_NOT_ENABLED');return profile;
}
const sims=new Map<string,ReturnType<typeof createSimInvoiceProvider>>();
/** Only the emulator resolves today; a real provider is added with its own profile and adapter. Tests replace the resolver. */
export let resolveInvoiceProvider=(profile:IntegrationProfile):InvoiceProvider=>{
 if(profile.mode!=='simulation')throw new Error('PROVIDER_NOT_ENABLED');
 if(!sims.has(profile.id))sims.set(profile.id,createSimInvoiceProvider(profile));return sims.get(profile.id)!.provider;
};
export function setInvoiceProviderResolver(fn:typeof resolveInvoiceProvider){resolveInvoiceProvider=fn;}
const RELAY_WINDOW_MS=300_000;
type Row={request_id:string;bill_id:string;profile_id:string;request_key:string;status:string;attempts:number;snapshot:JsonObject;provider_invoice_id:string|null;invoice_code:string|null;adjustments:JsonObject[];venue_operation_id:string|null;venue_status:string|null;last_error:string|null};
async function load(scope:TenantScope,requestId:string){return (await withTenant(scope,sql=>sql`SELECT * FROM invoice_request WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND request_id=${requestId}`))[0] as unknown as Row|undefined;}
/** Pull the venue's invoice requests (what the venue synced) into the cloud's work list. Idempotent: one row per request, whatever happens in the provider. */
export async function collectInvoiceRequests(scope:TenantScope,profileId:string){
 enabledInvoiceProfile(profileId);
 const requests=await withTenant(scope,sql=>sql`SELECT aggregate_id,state FROM sync_projection WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND aggregate_type='invoice-request' AND state->>'status'='requested'`);
 let added=0;
 for(const r of requests){
  const bill=(await withTenant(scope,sql=>sql`SELECT state FROM sync_projection WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND aggregate_type='bill' AND aggregate_id=${String(r.state.billId)}`))[0]?.state as JsonObject|undefined;
  if(!bill||bill.status!=='closed')continue; // the invoice is made from a closed bill the venue has synced
  const made=await withTenant(scope,sql=>sql`INSERT INTO invoice_request(organization_id,venue_id,request_id,bill_id,profile_id,request_key,snapshot) VALUES(${scope.organizationId},${scope.venueId},${String(r.aggregate_id)},${String(r.state.billId)},${profileId},${requestKeyFor(scope.organizationId,scope.venueId,String(r.aggregate_id))},${sql.json({request:r.state,bill} as unknown as JsonObject)}) ON CONFLICT DO NOTHING RETURNING request_id`);
  added+=made.length;
 }
 return {added};
}
export function invoiceTotalsProblem(row:Row):string|undefined{
 const snap=row.snapshot as {request:JsonObject},tax=BigInt(String(((snap.request.summary??{}) as JsonObject).taxMinor??'0')),total=BigInt(String(snap.request.totalMinor));
 return tax<0n||tax>total?'INVALID_TAX_TOTALS':undefined;
}
/** One summary line from the frozen bill: net of tax, with the tax amount beside it, so lines + tax = total always holds. Line-level detail is a per-provider profile concern. */
export function issueInputFor(row:Row):IssueInput{
 const snap=row.snapshot as {request:JsonObject;bill:JsonObject},summary=(snap.request.summary??{}) as JsonObject;
 const total=String(snap.request.totalMinor),tax=String(summary.taxMinor??'0'),net=String(BigInt(total)-BigInt(tax));
 return {requestKey:row.request_key,billId:row.bill_id,currency:String(snap.request.currency),totalMinor:total,subtotalMinor:net,taxMinor:tax,
  lines:[{description:`Food and beverage, bill ${row.bill_id}`,quantity:'1',unitMinor:net,amountMinor:net}],buyer:snap.request.buyer as IssueInput['buyer']};
}
async function setState(scope:TenantScope,row:Row,status:string,extra:{providerInvoiceId?:string;code?:string;rejectionCode?:string;error?:string}={}){
 await withTenant(scope,sql=>sql`UPDATE invoice_request SET status=${status},provider_invoice_id=COALESCE(${extra.providerInvoiceId??null},provider_invoice_id),invoice_code=COALESCE(${extra.code??null},invoice_code),rejection_code=COALESCE(${extra.rejectionCode??null},rejection_code),last_error=${extra.error??null},updated_at=now() WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND request_id=${row.request_id}`);
}
/** Tell the venue what the provider said. The venue's Invoice.Record decides what it will record; a lapsed relay is resent by reconcile. */
async function forward(scope:TenantScope,row:Row,payload:JsonObject,suffix:string){
 const ctx=await venueContext(scope),at=new Date().toISOString(),operationId=`invoice-${row.request_id}-${suffix}`.slice(0,128);
 const full={requestId:row.request_id,...payload};
 const command:CommandEnvelope={schemaVersion:1,...scope,operationId,type:'Invoice.Record',actorRef:'provider:'+row.profile_id,...providerRelaySource,coordinatorEpoch:ctx.epoch,policyRevision:ctx.policyRevision,occurredAt:at,recordedAt:at,payload:full,payloadHash:hashPayload(full)};
 await enqueueChannelRelay(command,new Date(Date.now()+RELAY_WINDOW_MS).toISOString());
 await withTenant(scope,sql=>sql`UPDATE invoice_request SET venue_operation_id=${operationId},venue_status='pending',updated_at=now() WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND request_id=${row.request_id}`);
}
const answer=(r:IssueResult):JsonObject=>r.status==='issued'?{status:'issued',providerInvoiceId:r.providerInvoiceId,code:r.code}:r.status==='rejected'?{status:'rejected',reason:r.reason}:{};
async function applyResult(scope:TenantScope,row:Row,result:IssueResult){
 if(result.status==='issued'){await setState(scope,row,'issued',{providerInvoiceId:result.providerInvoiceId,code:result.code});await forward(scope,row,answer(result),'issued');}
 else if(result.status==='rejected'){await setState(scope,row,'rejected',{rejectionCode:result.code});await forward(scope,row,answer(result),'rejected');}
}
/**
 * Issue once. The row is claimed as `unknown` BEFORE the call, so a crash or a lost answer can only be followed by a QUERY with the same requestKey. `rate_limited` proves nothing happened (back to draft).
 * Issued is recorded only with the provider's invoice id and code.
 */
export async function issueInvoice(scope:TenantScope,requestId:string){
 const row=await load(scope,requestId);if(!row)throw new Error('INVOICE_REQUEST_NOT_FOUND');
 const provider=resolveInvoiceProvider(enabledInvoiceProfile(row.profile_id)),action=nextInvoiceAction(row.status);
 if(action==='none')return {status:row.status};
 if(action==='query')return reconcileInvoice(scope,requestId);
 const bad=invoiceTotalsProblem(row);
 if(bad){await setState(scope,row,'rejected',{rejectionCode:bad});await forward(scope,row,{status:'rejected',reason:'tax exceeds the invoice total: the lines cannot add up'},'rejected');return {status:'rejected'};} // never sent to the provider
 const claimed=await withTenant(scope,sql=>sql`UPDATE invoice_request SET status='unknown',attempts=attempts+1,updated_at=now() WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND request_id=${requestId} AND status='draft' RETURNING request_id`);
 if(!claimed.length)return {status:'unknown'};
 let result:IssueResult;
 try{result=await provider.issue(issueInputFor(row));}
 catch(error){await setState(scope,row,'unknown',{error:error instanceof Error?error.message:'ISSUE_FAILED'});return {status:'unknown'};}
 if(result.status==='rate_limited'){await setState(scope,row,'draft');throw new Error('RATE_LIMITED');}
 if(result.status==='not_found'){await setState(scope,row,'unknown');return {status:'unknown'};}
 await applyResult(scope,row,result);return {status:result.status};
}
/** Ask the provider what became of an `unknown` request (same key). Only `not_found` makes a second issue possible. */
export async function reconcileInvoice(scope:TenantScope,requestId:string){
 const row=await load(scope,requestId);if(!row)throw new Error('INVOICE_REQUEST_NOT_FOUND');
 if(row.status!=='unknown')return {status:row.status};
 const provider=resolveInvoiceProvider(enabledInvoiceProfile(row.profile_id));
 let result:IssueResult;
 try{result=await provider.query({requestKey:row.request_key});}catch{return {status:'unknown'};}
 if(result.status==='rate_limited')return {status:'unknown'};
 const next=afterQuery(result.status==='not_found'?'not_found':result.status);
 if(next==='draft'){await setState(scope,row,'draft');return {status:'draft'};}
 await applyResult(scope,row,result);return {status:next};
}
/** Sweep: resolve unknowns, issue drafts, and resend provider answers the venue has not recorded (offline venue, lapsed relay). */
export async function reconcileInvoices(scope:TenantScope,nowMs=Date.now(),limit=50){
 const rows=await withTenant(scope,sql=>sql`SELECT * FROM invoice_request WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND (status IN('draft','unknown') OR (status IN('issued','rejected','cancelled') AND COALESCE(venue_status,'pending')<>'recorded')) ORDER BY created_at LIMIT ${limit}`) as unknown as Row[];
 const report={issued:0,queried:0,resent:0,recorded:0,errors:0};
 for(const row of rows){
  try{
   if(row.status==='draft'){await issueInvoice(scope,row.request_id);report.issued++;}
   else if(row.status==='unknown'){await reconcileInvoice(scope,row.request_id);report.queried++;}
   else{
    const [relay]=row.venue_operation_id?await withTenant(scope,sql=>sql`SELECT status,expires_at FROM relay_command WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND operation_id=${row.venue_operation_id}`):[];
    if(relay?.status==='accepted'){await withTenant(scope,sql=>sql`UPDATE invoice_request SET venue_status='recorded',updated_at=now() WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND request_id=${row.request_id}`);report.recorded++;}
    else if(!relay||(relay.status==='pending'&&Date.parse(relay.expires_at)<=nowMs)){
     const attempt=1+Number((await withTenant(scope,sql=>sql`SELECT count(*)::int AS n FROM relay_command WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND operation_id LIKE ${'invoice-'+row.request_id+'-'+row.status+'%'}`))[0]!.n);
     await forward(scope,row,row.status==='issued'?{status:'issued',providerInvoiceId:row.provider_invoice_id,code:row.invoice_code}:{status:row.status,reason:'resent'},`${row.status}-r${attempt}`);report.resent++;
    }
   }
  }catch{report.errors++;}
 }
 return report;
}
/** Adjust or cancel an ISSUED invoice through the provider (its own status machine); a provider without the operation refuses, nothing is deleted. */
export async function amendInvoice(actor:Actor,scope:TenantScope,input:{requestId:string;action:'adjust'|'cancel';reason:string;deltaMinor?:string;key:string}){
 requirePermission(actor,'invoice.operate',scope);
 if(!input.reason?.trim()||!/^[A-Za-z0-9_-]{1,64}$/.test(input.key))throw new Error('INVALID_ADJUSTMENT');
 const row=await load(scope,input.requestId);if(!row)throw new Error('INVOICE_REQUEST_NOT_FOUND');
 if(!adjustmentAllowed(row.status,input.action))throw new Error('INVOICE_NOT_ISSUED');
 if(row.adjustments.some(a=>a.key===input.key))return {status:row.status,duplicate:true};
 const provider=resolveInvoiceProvider(enabledInvoiceProfile(row.profile_id));
 const fn=input.action==='adjust'?provider.amend:provider.cancel;if(!fn)throw new Error('UNSUPPORTED_BY_PROVIDER');
 const delta=input.deltaMinor??'0';
 if(input.action==='adjust'&&!/^-?(0|[1-9][0-9]{0,29})$/.test(delta))throw new Error('INVALID_ADJUSTMENT');
 let result;
 try{result=input.action==='adjust'?await provider.amend!({requestKey:row.request_key,adjustmentKey:input.key,reason:input.reason,deltaMinor:delta}):await provider.cancel!({requestKey:row.request_key,cancelKey:input.key,reason:input.reason});}
 catch{throw new Error('PROVIDER_UNAVAILABLE');} // same key again is idempotent at the provider
 if(result.status!=='confirmed')throw new Error('REJECTED_BY_PROVIDER:'+result.code);
 await withTenant(scope,sql=>sql`UPDATE invoice_request SET adjustments=adjustments||${sql.json([{key:input.key,action:input.action,providerRef:result.providerRef,reason:input.reason,deltaMinor:delta}] as unknown as JsonObject[])},status=${input.action==='cancel'?'cancelled':row.status},updated_at=now() WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND request_id=${input.requestId}`);
 await forward(scope,{...row,status:input.action==='cancel'?'cancelled':row.status},{status:input.action==='cancel'?'cancelled':'adjusted',providerRef:result.providerRef,reason:input.reason,deltaMinor:delta},`${input.action}-${input.key}`);
 return {status:input.action==='cancel'?'cancelled':row.status,providerRef:result.providerRef};
}
export async function listInvoices(actor:Actor,scope:TenantScope){
 requirePermission(actor,'invoice.request',scope);
 const rows=await withTenant(scope,sql=>sql`SELECT request_id,bill_id,status,invoice_code,rejection_code,venue_status,attempts,last_error FROM invoice_request WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} ORDER BY created_at DESC LIMIT 200`);
 return {invoices:rows.map(r=>({requestId:r.request_id as string,billId:r.bill_id as string,status:r.status as string,...(r.invoice_code?{code:r.invoice_code as string}:{}),...(r.rejection_code?{rejectionCode:r.rejection_code as string}:{}),venueStatus:(r.venue_status as string|null)??'none',attempts:Number(r.attempts)}))};
}
