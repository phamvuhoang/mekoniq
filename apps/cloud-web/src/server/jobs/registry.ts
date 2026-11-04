import type {JsonObject} from '../../../../../packages/contracts/generated/wire';
import type {TenantScope} from '../modules/identity/tenant-context';
import {collectOrphanAssets} from '../modules/storage/garbage-collection';
import {publishHint} from '../modules/relay/subscriptions';
import {withTenant} from '../modules/identity/tenant-context';
import {externalIdentity} from '../../../../../integrations/core/src/external-ids';
import {profileFor,type Connector,type EffectIntent} from '../../../../../integrations/core/src/connector';
import {jobOutcome} from '../../../../../integrations/core/src/outbox';
import {createSandboxChannel} from '../../../../../integrations/core/src/sandbox';
import {sweepExternalOrder} from '../modules/channels/restaurant-ack';
/** Where a provider's outbound calls go. Production has none yet: a real channel is enabled only with a certified W10 profile, so only the sandbox simulator resolves. Tests swap the resolver. */
const sandboxes=new Map<string,Connector>();
export let resolveConnector=(provider:string):Connector=>{profileFor(provider);if(!sandboxes.has(provider))sandboxes.set(provider,createSandboxChannel(provider as 'sandbox-channel').connector);return sandboxes.get(provider)!;};
export function setConnectorResolver(fn:typeof resolveConnector){resolveConnector=fn;}
async function recordProviderRef(scope:{organizationId:string;venueId:string},p:JsonObject,ref:string){
 await withTenant(scope,sql=>sql`UPDATE external_order SET provider_ref=${ref} WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND provider_id=${String(p.provider)} AND merchant_id=${String(p.merchantId)} AND external_id=${String(p.externalId)}`);
}
function intentOf(id:string,p:JsonObject):EffectIntent{
 return {idempotencyKey:id,kind:p.kind as EffectIntent['kind'],identity:externalIdentity({provider:String(p.provider),merchantId:String(p.merchantId),externalId:String(p.externalId)}),...(typeof p.reason==='string'?{reason:p.reason}:{})};
}
export type JobContext={scope:TenantScope;id:string;payload:JsonObject;signal:AbortSignal};
export type JobResult={status:'confirmed'|'unknown'|'failed';value:JsonObject};
export type JobHandler={execute:(context:JobContext)=>Promise<JobResult>;reconcile:(context:JobContext)=>Promise<JobResult>};
export class JobRegistry {
 private handlers=new Map<string,JobHandler>();
 register(type:string,handler:JobHandler){if(this.handlers.has(type))throw new Error('DUPLICATE_JOB_HANDLER');this.handlers.set(type,handler);}
 get(type:string){return this.handlers.get(type);}
}
export function defaultJobRegistry(){
 const registry=new JobRegistry();
 // Outbound channel call. execute may throw (timeout): the runner records `unknown`, and the NEXT lease goes to reconcile, which asks the channel first — a call is never repeated blind.
 registry.register('channel.effect',{
  execute:async c=>{const intent=intentOf(c.id,c.payload);const out=jobOutcome(await resolveConnector(String(c.payload.provider)).execute(intent).catch((e:Error)=>({threw:e.message})));if(out.status==='confirmed')await recordProviderRef(c.scope,c.payload,String(out.value.providerRef));return out;},
  reconcile:async c=>{const intent=intentOf(c.id,c.payload),connector=resolveConnector(String(c.payload.provider));
   const known=await connector.query(intent).catch((e:Error)=>({threw:e.message}));
   if('threw' in known)return jobOutcome(known);
   const out=jobOutcome(known.status==='not_found'?await connector.execute(intent).catch((e:Error)=>({threw:e.message})):known);
   if(out.status==='confirmed')await recordProviderRef(c.scope,c.payload,String(out.value.providerRef));return out;},
 });
 registry.register('channel.sweep',{
  execute:async c=>({status:'confirmed',value:await sweepExternalOrder(c.scope,{provider:String(c.payload.provider),merchantId:String(c.payload.merchantId),externalId:String(c.payload.externalId)},Number(c.payload.round))}),
  reconcile:async c=>({status:'confirmed',value:await sweepExternalOrder(c.scope,{provider:String(c.payload.provider),merchantId:String(c.payload.merchantId),externalId:String(c.payload.externalId)},Number(c.payload.round))}),
 });registry.register('hint.publish',{
  execute:async c=>{await publishHint(c.scope,{ref:String(c.payload.ref),revision:Number(c.payload.revision),watermark:String(c.payload.watermark)});return {status:'confirmed',value:{}};},
  // Repeating a hint only wakes idempotent pull; it cannot trigger a physical/financial action.
  reconcile:async()=>({status:'confirmed',value:{hintMayHaveBeenLost:true}}),
 });registry.register('storage.gc',{
  execute:async c=>({status:'confirmed',value:await collectOrphanAssets(c.scope,20,c.signal)}),
  reconcile:async c=>({status:'confirmed',value:await collectOrphanAssets(c.scope,20,c.signal)}),
 });return registry;
}
