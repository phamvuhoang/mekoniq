import type {JsonObject} from '../../../../../../packages/contracts/generated/wire';
import {hashPayload} from '../../../../../../packages/contracts/src/index';
import {advance,onVenueSilent,type ExternalStatus,type UnavailablePolicy} from '../../../../../../integrations/core/src/inbox';
import type {NormalizedOrder} from '../../../../../../integrations/core/src/connector';
import {requirePermission,type Actor} from '../identity/rbac';
import {withTenant,type TenantScope} from '../identity/tenant-context';
import {enqueueChannelRelay} from '../relay/commands';
import {relayOrderCommand,relayReceive,scheduleSweep,venueContext} from './ingress';
type Row={id:string;provider_id:string;merchant_id:string;external_id:string;payload_hash:string;normalized:NormalizedOrder;status:ExternalStatus;relay_operation_id:string|null;relay_attempts:number;unavailable_policy:UnavailablePolicy;expires_at:string;venue_recorded:boolean};
const idOf=(r:{provider_id:string;merchant_id:string;external_id:string})=>`ext:${r.provider_id}:${r.merchant_id}:${r.external_id}`;
export type EffectKind='order.accepted'|'order.rejected'|'order.expired';
/** One durable effect job per (order, kind): the unique job id is the idempotency key the channel sees, so a restart can never queue a second "accepted" call. */
export async function queueEffect(scope:TenantScope,row:{provider_id:string;merchant_id:string;external_id:string},kind:EffectKind,reason?:string){
 const id=`channel-effect:${hashPayload({p:row.provider_id,m:row.merchant_id,e:row.external_id,k:kind}).slice(0,32)}`;
 await withTenant(scope,sql=>sql`INSERT INTO cloud_job(organization_id,venue_id,id,type,payload) VALUES(${scope.organizationId},${scope.venueId},${id},'channel.effect',${sql.json({provider:row.provider_id,merchantId:row.merchant_id,externalId:row.external_id,kind,...(reason?{reason}:{})})}) ON CONFLICT DO NOTHING`);
}
async function load(scope:TenantScope,key:{provider:string;merchantId:string;externalId:string}){
 const [row]=await withTenant(scope,sql=>sql`SELECT id,provider_id,merchant_id,external_id,payload_hash,normalized,status,relay_operation_id,relay_attempts,unavailable_policy,expires_at,venue_recorded FROM external_order WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND provider_id=${key.provider} AND merchant_id=${key.merchantId} AND external_id=${key.externalId}`);
 return row as unknown as Row|undefined;
}
async function setStatus(scope:TenantScope,row:Row,status:ExternalStatus,code?:string,attention?:string){
 await withTenant(scope,sql=>sql`UPDATE external_order SET status=${status},code=COALESCE(${code??null},code),attention=COALESCE(${attention??null},attention),updated_at=now() WHERE id=${row.id}`);
}
/**
 * Reads what the VENUE says (its relay receipt, then its synced `external-order` aggregate) and moves the cloud record forward. A venue decision is never overwritten by the cloud's own
 * timers; if the venue accepted something the cloud already told the channel was refused or expired, the record is flagged `attention` for an operator instead of pretending.
 */
export async function refreshFromVenue(scope:TenantScope,key:{provider:string;merchantId:string;externalId:string}):Promise<Row>{
 const row=await load(scope,key);if(!row)throw new Error('EXTERNAL_ORDER_NOT_FOUND');
 const {relay,fact}=await withTenant(scope,async sql=>({
  relay:row.relay_operation_id?(await sql`SELECT status,venue_receipt FROM relay_command WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND operation_id=${row.relay_operation_id}`)[0]:undefined,
  fact:(await sql`SELECT state FROM sync_projection WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND aggregate_type='external-order' AND aggregate_id=${idOf(row)}`)[0]?.state as JsonObject|undefined,
 }));
 let status=row.status;
 if(relay?.status==='accepted'&&!row.venue_recorded)await withTenant(scope,sql=>sql`UPDATE external_order SET venue_recorded=true WHERE id=${row.id}`);
 if(relay?.status==='rejected'&&status==='received'){ // the venue refused to even record it (AMOUNT_MISMATCH, ITEM_UNAVAILABLE, EXTERNAL_ORDER_EXPIRED …)
  const code=String((relay.venue_receipt as JsonObject|null)?.code??'REJECTED');status=advance(status,code==='EXTERNAL_ORDER_EXPIRED'?'expired':'rejected');
  await setStatus(scope,row,status,code);await queueEffect(scope,row,status==='expired'?'order.expired':'order.rejected',code);
 }
 const venue=fact?.status as string|undefined;
 if(venue==='accepted'||venue==='rejected'||venue==='expired'){
  const wanted=venue as ExternalStatus,next=advance(status,wanted);
  if(next===wanted&&status==='received'){await setStatus(scope,row,wanted,wanted==='rejected'?String(fact?.rejectionReason??'REJECTED'):undefined);await queueEffect(scope,row,wanted==='accepted'?'order.accepted':wanted==='rejected'?'order.rejected':'order.expired',wanted==='rejected'?String(fact?.rejectionReason??''):undefined);status=wanted;}
  else if(status!==wanted&&status!=='received')await setStatus(scope,row,status,undefined,`VENUE_${venue.toUpperCase()}_AFTER_${status.toUpperCase()}`); // contradiction: keep both facts visible
 }
 return {...row,status};
}
/**
 * One round of the per-order sweeper (job `channel.sweep`): learn the venue's answer, otherwise apply the silent-venue policy. `hold` keeps trying until the order's own deadline;
 * `reject` tells the channel "venue unavailable" once the relay window passed unanswered. Past its deadline an unanswered order is expired — and the venue is told to expire it too.
 */
export async function sweepExternalOrder(scope:TenantScope,key:{provider:string;merchantId:string;externalId:string},round:number,nowMs=Date.now()){
 const row=await refreshFromVenue(scope,key);if(row.status!=='received')return {status:row.status,done:true};
 const relay=row.relay_operation_id?(await withTenant(scope,sql=>sql`SELECT status,expires_at FROM relay_command WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND operation_id=${row.relay_operation_id}`))[0]:undefined;
 const answered=relay?.status==='accepted'||relay?.status==='unknown'; // recorded by the venue (waiting for a person) or an unknown receipt that needs reconciling, not resending
 const verdict=onVenueSilent(row.unavailable_policy,nowMs,Date.parse(row.expires_at as unknown as string));
 if(verdict==='expire'){
  await setStatus(scope,row,'expired','EXTERNAL_ORDER_EXPIRED');await queueEffect(scope,row,'order.expired');
  try{const ctx=await venueContext(scope);await enqueueChannelRelay(relayOrderCommand(scope,'channel:sweeper','ExternalOrder.Expire',{externalOrderId:idOf(row)},`ext-exp-${hashPayload({i:idOf(row)}).slice(0,24)}`,ctx),new Date(Date.now()+300_000).toISOString());}catch{/* the venue learns it when it reconnects: its own Accept refuses an expired order */}
  return {status:'expired',done:true};
 }
 if(!answered&&(!relay||Date.parse(relay.expires_at as string)<=nowMs)){
  if(verdict==='reject'){await setStatus(scope,row,'rejected','VENUE_UNAVAILABLE');await queueEffect(scope,row,'order.rejected','VENUE_UNAVAILABLE');return {status:'rejected',done:true};}
  try{ // hold: give the venue a fresh relay window; the same Receive is idempotent at the venue
   const sent=await relayReceive(scope,'channel:sweeper',{normalized:row.normalized,payloadHash:row.payload_hash,relayAttempts:row.relay_attempts});
   await withTenant(scope,sql=>sql`UPDATE external_order SET relay_operation_id=${sent.operationId},relay_attempts=${sent.attempt},updated_at=now() WHERE id=${row.id}`);
  }catch{/* still no owner: next round */}
 }
 await scheduleSweep(scope,{provider:key.provider,merchantId:key.merchantId,externalId:key.externalId},round+1,nowMs+Math.min(120_000,Math.max(5_000,Date.parse(row.expires_at as unknown as string)-nowMs)));
 return {status:'received',done:false};
}
/** A person clears a stuck channel call (dead_letter): retry sends it afresh with the same idempotency key, abandon records that nobody will. */
export async function resolveDeadLetter(actor:Actor,scope:TenantScope,jobId:string,action:'retry'|'abandon'){
 requirePermission(actor,'channel.operate',scope);
 if(action!=='retry'&&action!=='abandon')throw new Error('INVALID_ACTION');
 const rows=await withTenant(scope,sql=>action==='retry'
  ?sql`UPDATE cloud_job SET status='pending',attempts=0,due_at=now(),lease_until=NULL WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND id=${jobId} AND type='channel.effect' AND status='dead_letter' RETURNING id`
  :sql`UPDATE cloud_job SET status='failed',result=${sql.json({abandonedBy:actor.id})} WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND id=${jobId} AND type='channel.effect' AND status='dead_letter' RETURNING id`);
 if(rows.length!==1)throw new Error('DEAD_LETTER_NOT_FOUND');return {jobId,action};
}
