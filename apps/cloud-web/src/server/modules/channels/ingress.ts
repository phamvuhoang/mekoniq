import {randomUUID} from 'node:crypto';
import type {CommandEnvelope,JsonObject} from '../../../../../../packages/contracts/generated/wire';
import {hashPayload,parseJsonStrict} from '../../../../../../packages/contracts/src/index';
import {profileFor,type NormalizedOrder} from '../../../../../../integrations/core/src/connector';
import {channelStatus,type ExternalStatus} from '../../../../../../integrations/core/src/inbox';
import {classifyReceipt,payloadFingerprint} from '../../../../../../integrations/core/src/external-ids';
import {KEY_HEADER,SIGNATURE_HEADER,TIMESTAMP_HEADER,verifyWebhook} from '../../../../../../integrations/core/src/webhook-signature';
import {createSandboxChannel} from '../../../../../../integrations/core/src/sandbox';
import {withTenant,type TenantScope} from '../identity/tenant-context';
import {channelRelaySource,enqueueChannelRelay} from '../relay/commands';
import {channelSecret,lookupCredential} from './credentials';
const MAX_BODY=65536,MAX_HORIZON_MS=24*3600_000,RELAY_WINDOW_MS=300_000,WEB_PENDING_LIMIT=20;
export type IngressResult={status:number;body:JsonObject};
/** Stateless: only `normalize` is used on the way in, so one shared simulator instance per profile is enough. */
const normalizers={'sandbox-channel':createSandboxChannel('sandbox-channel').connector,'web-sandbox':createSandboxChannel('web-sandbox').connector};
export function normalizerFor(provider:string){const c=(normalizers as Record<string,{normalize:(v:{provider:string;rawBody:string;body:Record<string,unknown>})=>NormalizedOrder}>)[provider];if(!c)throw new Error('PROVIDER_NOT_ENABLED');return c;}
export type Authenticated={scope:TenantScope;merchantId:string;policy:'hold'|'reject';actorRef:string};
/** Raw body is read once by the route and verified BEFORE it is parsed; a bad signature never reaches the parser or the database. */
export async function authenticateChannel(provider:string,rawBody:string,headers:Headers,nowMs:number,publicScope?:TenantScope):Promise<Authenticated>{
 const profile=profileFor(provider);
 if(profile.authentication==='none'){
  if(process.env.CHANNELS_SANDBOX_WEB!=='1'||!publicScope)throw new Error('PROVIDER_NOT_ENABLED');
  return {scope:publicScope,merchantId:'web',policy:'reject',actorRef:'channel:web-sandbox'};
 }
 const keyId=headers.get(KEY_HEADER)??'',credential=await lookupCredential(keyId);
 if(!credential||credential.status!=='active'||credential.providerId!==provider)throw new Error('INVALID_SIGNATURE');
 const verdict=verifyWebhook({secret:channelSecret(keyId),rawBody,signature:headers.get(SIGNATURE_HEADER),timestamp:headers.get(TIMESTAMP_HEADER),nowMs});
 if(!verdict.ok)throw new Error(verdict.code==='TIMESTAMP_OUT_OF_WINDOW'?'TIMESTAMP_EXPIRED':'INVALID_SIGNATURE');
 return {scope:{organizationId:credential.organizationId,venueId:credential.venueId},merchantId:credential.merchantId,policy:credential.unavailablePolicy,actorRef:'channel:'+keyId};
}
export function relayOrderCommand(scope:TenantScope,actorRef:string,type:'ExternalOrder.Receive'|'ExternalOrder.Expire'|'ExternalOrder.Cancel',payload:JsonObject,operationId:string,context:{epoch:number;policyRevision:number}):CommandEnvelope{
 const at=new Date().toISOString();
 return {schemaVersion:1,...scope,operationId,type,actorRef,...channelRelaySource,coordinatorEpoch:context.epoch,policyRevision:context.policyRevision,occurredAt:at,recordedAt:at,payload,payloadHash:hashPayload(payload)};
}
export async function venueContext(scope:TenantScope){
 return withTenant(scope,async sql=>{
  const [owner]=await sql`SELECT epoch FROM venue_ownership WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND resource_id='coordinator' AND status='active'`;
  const [policy]=await sql`SELECT policy_revision FROM authority WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId}`;
  if(!owner||!policy)throw new Error('OWNER_OR_POLICY_UNAVAILABLE');return {epoch:Number(owner.epoch),policyRevision:Number(policy.policy_revision)};
 });
}
/** Sends (or re-sends, with a new attempt number) the venue a Receive for this stored order. A repeat of the same attempt is the relay's own duplicate. */
export async function relayReceive(scope:TenantScope,actorRef:string,row:{normalized:NormalizedOrder;payloadHash:string;relayAttempts:number}){
 const n=row.normalized,attempt=row.relayAttempts+1,operationId=`ext-recv-${hashPayload({p:n.provider,m:n.merchantId,e:n.externalId}).slice(0,24)}-a${attempt}`;
 const command=relayOrderCommand(scope,actorRef,'ExternalOrder.Receive',{provider:n.provider,merchantId:n.merchantId,externalId:n.externalId,payloadHash:row.payloadHash,items:n.items,currency:n.currency,...(n.declaredTotalMinor?{declaredTotalMinor:n.declaredTotalMinor}:{}),expiresAt:n.expiresAt,sandbox:n.sandbox} as JsonObject,operationId,await venueContext(scope));
 await enqueueChannelRelay(command,new Date(Math.min(Date.parse(n.expiresAt),Date.now()+RELAY_WINDOW_MS)).toISOString());
 return {operationId,attempt};
}
function view(r:{status:ExternalStatus|string;code?:string|null;venue_recorded?:boolean;attention?:string|null;expires_at?:string|Date;cancel_status?:string|null;cancel_code?:string|null}):JsonObject{
 return {status:String(r.status),channelStatus:channelStatus(r.status==='accepted',r.status==='expired'||r.status==='rejected'||r.status==='cancelled'),...(r.cancel_status?{cancelStatus:r.cancel_status,...(r.cancel_code?{cancelCode:r.cancel_code}:{})}:{}),venueRecorded:r.venue_recorded===true,...(r.code?{code:String(r.code)}:{}),...(r.attention?{attention:String(r.attention)}:{}),...(r.expires_at?{expiresAt:new Date(r.expires_at).toISOString()}:{})};
}
/**
 * POST /v1/channels/:provider/webhooks. `202 received` means "stored durably and handed to the venue" — never that the restaurant accepted. The same event again returns the stored answer;
 * the same identity with different content is quarantined (the first order is untouched) and answered 409.
 */
export async function receiveExternalOrder(input:{provider:string;rawBody:string;headers:Headers;nowMs?:number;publicScope?:TenantScope}):Promise<IngressResult>{
 const nowMs=input.nowMs??Date.now();
 if(Buffer.byteLength(input.rawBody)>MAX_BODY)throw new Error('PAYLOAD_TOO_LARGE');
 const auth=await authenticateChannel(input.provider,input.rawBody,input.headers,nowMs,input.publicScope);
 let normalized:NormalizedOrder;
 try{normalized=normalizerFor(input.provider).normalize({provider:input.provider,rawBody:input.rawBody,body:parseJsonStrict(input.rawBody,MAX_BODY) as Record<string,unknown>});}catch(error){throw new Error(error instanceof Error&&/^INVALID_/.test(error.message)?error.message:'INVALID_ORDER');}
 if(normalized.merchantId!==auth.merchantId)throw new Error('MERCHANT_MISMATCH');
 const expires=Date.parse(normalized.expiresAt);
 if(expires<=nowMs)throw new Error('EXTERNAL_ORDER_EXPIRED');if(expires>nowMs+MAX_HORIZON_MS)throw new Error('INVALID_EXPIRY');
 if(input.provider==='web-sandbox'&&(normalized.items.length>20))throw new Error('INVALID_ORDER_ITEMS');
 const payloadHash=payloadFingerprint(normalized),scope=auth.scope;
 const stored=await withTenant(scope,async sql=>{
  await sql`SELECT pg_advisory_xact_lock(hashtext(${JSON.stringify(['ext',scope.organizationId,scope.venueId,normalized.provider,normalized.merchantId,normalized.externalId])}))`;
  const [row]=await sql`SELECT id,payload_hash,status,code,venue_recorded,attention,expires_at FROM external_order WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND provider_id=${normalized.provider} AND merchant_id=${normalized.merchantId} AND external_id=${normalized.externalId}`;
  const kind=classifyReceipt(row?.payload_hash as string|undefined,payloadHash);
  if(kind==='conflict'){await sql`INSERT INTO external_order_conflict(organization_id,venue_id,provider_id,merchant_id,external_id,payload_hash,raw_body) VALUES(${scope.organizationId},${scope.venueId},${normalized.provider},${normalized.merchantId},${normalized.externalId},${payloadHash},${input.rawBody})`;return {kind,row};}
  if(kind==='duplicate')return {kind,row};
  if(input.provider==='web-sandbox'){const [open]=await sql`SELECT count(*)::int AS n FROM external_order WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND provider_id='web-sandbox' AND status='received'`;if(Number(open!.n)>=WEB_PENDING_LIMIT)throw new Error('RATE_LIMITED');}
  await sql`INSERT INTO external_order(organization_id,venue_id,provider_id,merchant_id,external_id,payload_hash,normalized,expires_at,sandbox,unavailable_policy) VALUES(${scope.organizationId},${scope.venueId},${normalized.provider},${normalized.merchantId},${normalized.externalId},${payloadHash},${sql.json(normalized as unknown as JsonObject)},${new Date(expires)},${normalized.sandbox},${auth.policy})`;
  return {kind,row:undefined};
 });
 if(stored.kind==='conflict')throw new Error('EXTERNAL_ORDER_PAYLOAD_CONFLICT');
 if(stored.kind==='duplicate')return {status:202,body:{...view(stored.row as never),duplicate:true}};
 try{
  const sent=await relayReceive(scope,auth.actorRef,{normalized,payloadHash,relayAttempts:0});
  await withTenant(scope,sql=>sql`UPDATE external_order SET relay_operation_id=${sent.operationId},relay_attempts=${sent.attempt},updated_at=now() WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND provider_id=${normalized.provider} AND merchant_id=${normalized.merchantId} AND external_id=${normalized.externalId}`);
  await scheduleSweep(scope,normalized,1,nowMs+120_000);
 }catch(error){
  // The request is stored; the venue could not be reached yet (no owner/policy). The sweeper decides hold or reject — never a false accept.
  await scheduleSweep(scope,normalized,1,nowMs+30_000);
  return {status:202,body:{status:'received',venueRecorded:false,note:error instanceof Error?error.message:'RELAY_UNAVAILABLE'}};
 }
 return {status:202,body:{status:'received',venueRecorded:false,expiresAt:normalized.expiresAt}};
}
/** `gen` names a separate line of sweeps for the same order (a cancellation asked after the order's own sweeps finished): job ids are unique per (order, gen, round), so an old finished round never swallows a new one. */
export async function scheduleSweep(scope:TenantScope,n:{provider:string;merchantId:string;externalId:string},round:number,atMs:number,gen=''){
 const id=`channel-sweep:${hashPayload({p:n.provider,m:n.merchantId,e:n.externalId}).slice(0,24)}:${gen}${round}`;
 await withTenant(scope,sql=>sql`INSERT INTO cloud_job(organization_id,venue_id,id,type,payload,due_at) VALUES(${scope.organizationId},${scope.venueId},${id},'channel.sweep',${sql.json({provider:n.provider,merchantId:n.merchantId,externalId:n.externalId,round,...(gen?{gen}:{})})},${new Date(atMs)}) ON CONFLICT DO NOTHING`);
}
/** GET status for the channel: signed over an empty body like any other call (the sandbox web checkout is public, addressed by its unguessable id). */
export async function externalOrderStatus(input:{provider:string;merchantId:string;externalId:string;headers:Headers;nowMs?:number;publicScope?:TenantScope}):Promise<JsonObject>{
 const auth=await authenticateChannel(input.provider,'',input.headers,input.nowMs??Date.now(),input.publicScope);
 if(auth.merchantId!==input.merchantId)throw new Error('MERCHANT_MISMATCH');
 const [row]=await withTenant(auth.scope,sql=>sql`SELECT status,code,venue_recorded,attention,expires_at,provider_ref,cancel_status,cancel_code FROM external_order WHERE organization_id=${auth.scope.organizationId} AND venue_id=${auth.scope.venueId} AND provider_id=${input.provider} AND merchant_id=${input.merchantId} AND external_id=${input.externalId}`);
 if(!row)throw new Error('EXTERNAL_ORDER_NOT_FOUND');
 return view(row as never);
}
export const newWebExternalId=()=>'web-'+randomUUID();
/** POST …/cancellations: same authentication as an order, then relay. The answer is the venue's, read from the status endpoint (`cancelStatus`). */
export async function receiveChannelCancellation(input:{provider:string;rawBody:string;headers:Headers;nowMs?:number}):Promise<IngressResult>{
 const nowMs=input.nowMs??Date.now();
 if(Buffer.byteLength(input.rawBody)>MAX_BODY)throw new Error('PAYLOAD_TOO_LARGE');
 const auth=await authenticateChannel(input.provider,input.rawBody,input.headers,nowMs);
 let body:Record<string,unknown>;try{body=parseJsonStrict(input.rawBody,MAX_BODY) as Record<string,unknown>;}catch{throw new Error('INVALID_BODY');}
 if(body.merchantId!==auth.merchantId||typeof body.externalId!=='string')throw new Error('MERCHANT_MISMATCH');
 const {requestChannelCancellation}=await import('./restaurant-ack');
 return {status:202,body:await requestChannelCancellation(auth.scope,auth.actorRef,{provider:input.provider,merchantId:auth.merchantId,externalId:body.externalId},String(body.reason??''))};
}
