import {hashPayload} from '../../../../../../packages/contracts/src/canonical';
import type {JsonObject} from '../../../../../../packages/contracts/generated/wire';
import type {Actor} from '../identity/rbac';
import {withOrganization,withTenant} from '../identity/tenant-context';
import {relayVenueCommand} from '../relay/venue-command';
import {requireChain} from './rollout-state';
/** Uses of a shared pool still out at a branch: granted − spent − already returned. Pure, bigint-safe. */
export function remainingEscrow(issued:string,used:string,returned:string){return String(BigInt(issued)-BigInt(used)-BigInt(returned));}
const ID=/^[A-Za-z0-9_-]{1,100}$/;
/** Operation ids are capped at 128 characters and two 100-character ids do not fit: the identity part is hashed, so the revision / delivery suffix is never cut off. */
const opBase=(kind:'shared'|'shared-return',balanceId:string,venueId:string,revision:number)=>`${kind}-${hashPayload({b:balanceId,v:venueId}).slice(0,32)}-r${revision}`;
export async function createSharedBalance(actor:Actor,organizationId:string,input:{balanceId:string;voucherId:string;total:number}){
 requireChain(actor,'chain.publish',organizationId,actor.venueIds);
 if(!ID.test(input.balanceId)||!ID.test(input.voucherId)||!Number.isSafeInteger(input.total)||input.total<1||input.total>1_000_000_000)throw new Error('INVALID_SHARED_BALANCE');
 return withOrganization(organizationId,async sql=>{
  const rows=await sql`INSERT INTO chain_shared_balance(organization_id,balance_id,voucher_id,total,available,created_by) VALUES(${organizationId},${input.balanceId},${input.voucherId},${input.total},${input.total},${actor.id}) ON CONFLICT DO NOTHING RETURNING balance_id`;
  if(!rows.length)throw new Error('SHARED_BALANCE_EXISTS');return {balanceId:input.balanceId,total:input.total,available:input.total};
 });
}
/** A relay in flight is never copied; one that lapsed or was refused is delivered again under a NEW delivery id (`-d<n>`), carrying the same business revision, so the branch still applies it once. */
async function deliver(actor:Actor,scope:{organizationId:string;venueId:string},base:string,type:string,payload:JsonObject){
 const sent=await withTenant(scope,sql=>sql`SELECT operation_id,status,expires_at FROM relay_command WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND starts_with(operation_id,${base+'-d'}) ORDER BY created_at DESC`);
 const last=sent[0];
 if(last&&(last.status==='accepted'||last.status==='unknown'||(last.status==='pending'&&Date.parse(last.expires_at as string)>Date.now())))return {status:String(last.status),operationId:String(last.operation_id)};
 return relayVenueCommand(actor,scope,{type,operationId:`${base}-d${sent.length+1}`,payload},{internal:true});
}
async function sendGrant(actor:Actor,organizationId:string,balanceId:string,venueId:string){
 const {pool,grant}=await withOrganization(organizationId,async sql=>({pool:(await sql`SELECT voucher_id,total FROM chain_shared_balance WHERE organization_id=${organizationId} AND balance_id=${balanceId}`)[0]!,grant:(await sql`SELECT granted,revision FROM chain_shared_grant WHERE organization_id=${organizationId} AND balance_id=${balanceId} AND venue_id=${venueId}`)[0]!}));
 // The command carries the CUMULATIVE grant and its revision, so re-sending it (a retry, a lost relay) never gives the branch a use twice.
 return deliver(actor,{organizationId,venueId},opBase('shared',balanceId,venueId,Number(grant.revision)),'Voucher.ReceiveEscrow',{voucherId:String(pool.voucher_id),total:Number(grant.granted),revision:Number(grant.revision),limit:Number(pool.total)});
}
/** Takes exactly `count` uses out of the pool for one branch — once per operationId, so a timed-out caller can retry and gets the same grant, never a second one. */
export async function reserveSharedBalance(actor:Actor,organizationId:string,input:{balanceId:string;venueId:string;count:number;operationId:string}){
 requireChain(actor,'chain.publish',organizationId,[input.venueId]);
 if(!Number.isSafeInteger(input.count)||input.count<1||!ID.test(input.operationId)||!ID.test(input.balanceId))throw new Error('INVALID_SHARED_BALANCE');
 const result=await withOrganization(organizationId,async sql=>{
  const [pool]=await sql`SELECT available FROM chain_shared_balance WHERE organization_id=${organizationId} AND balance_id=${input.balanceId} FOR UPDATE`;
  if(!pool)throw new Error('SHARED_BALANCE_NOT_FOUND');
  const [prior]=await sql`SELECT venue_id,count,revision FROM chain_shared_operation WHERE organization_id=${organizationId} AND balance_id=${input.balanceId} AND operation_id=${input.operationId}`;
  if(prior){if(prior.venue_id!==input.venueId||Number(prior.count)!==input.count)throw new Error('IDEMPOTENCY_CONFLICT');return {duplicate:true,revision:Number(prior.revision)};}
  if(Number(pool.available)<input.count)throw new Error('SHARED_BALANCE_EXHAUSTED');
  await sql`UPDATE chain_shared_balance SET available=available-${input.count} WHERE organization_id=${organizationId} AND balance_id=${input.balanceId}`;
  const [grant]=await sql`INSERT INTO chain_shared_grant(organization_id,balance_id,venue_id,granted,revision) VALUES(${organizationId},${input.balanceId},${input.venueId},${input.count},1) ON CONFLICT(organization_id,balance_id,venue_id) DO UPDATE SET granted=chain_shared_grant.granted+${input.count},revision=chain_shared_grant.revision+1 RETURNING revision`;
  await sql`INSERT INTO chain_shared_operation(organization_id,balance_id,operation_id,venue_id,count,revision) VALUES(${organizationId},${input.balanceId},${input.operationId},${input.venueId},${input.count},${grant!.revision})`;
  return {duplicate:false,revision:Number(grant!.revision)};
 });
 const relay=await sendGrant(actor,organizationId,input.balanceId,input.venueId); // the grant is durable in the cloud even if this relay is lost: a retry re-sends it
 return {...result,relay:relay.status};
}
/**
 * Reads what the branch has actually applied for a shared voucher and settles the books: spent uses are final, uses the branch returned go back to the pool (credited from the branch's own
 * cumulative `returned`, so doing this twice credits once), and with `release` the branch's unspent remainder is asked back. Uses granted but not yet confirmed by the branch stay reserved.
 */
export async function reconcileSharedBalance(actor:Actor,organizationId:string,input:{balanceId:string;venueId:string;release?:boolean}){
 requireChain(actor,'chain.publish',organizationId,[input.venueId]);
 const scope={organizationId,venueId:input.venueId};
 const [pool,grant]=await withOrganization(organizationId,async sql=>[(await sql`SELECT voucher_id FROM chain_shared_balance WHERE organization_id=${organizationId} AND balance_id=${input.balanceId}`)[0],(await sql`SELECT granted,returned,return_revision FROM chain_shared_grant WHERE organization_id=${organizationId} AND balance_id=${input.balanceId} AND venue_id=${input.venueId}`)[0]] as const);
 if(!pool)throw new Error('SHARED_BALANCE_NOT_FOUND');if(!grant)throw new Error('SHARED_GRANT_NOT_FOUND');
 const voucher=await withTenant(scope,async sql=>(await sql`SELECT state FROM sync_projection WHERE organization_id=${organizationId} AND venue_id=${input.venueId} AND aggregate_type='voucher' AND aggregate_id=${String(pool.voucher_id)}`)[0]?.state as JsonObject|undefined);
 const slot=((voucher?.escrow??{}) as Record<string,JsonObject>)[input.venueId],venueGranted=Number(slot?.granted??0),unspent=Number(slot?.count??0),venueReturned=Number(slot?.returned??0);
 const used=venueGranted-unspent-venueReturned;
 // credit exactly what the branch says it has returned and the cloud has not yet taken back
 await withOrganization(organizationId,async sql=>{
  const [g]=await sql`SELECT returned FROM chain_shared_grant WHERE organization_id=${organizationId} AND balance_id=${input.balanceId} AND venue_id=${input.venueId} FOR UPDATE`;
  const delta=venueReturned-Number(g!.returned);
  if(delta>0){await sql`UPDATE chain_shared_grant SET returned=returned+${delta} WHERE organization_id=${organizationId} AND balance_id=${input.balanceId} AND venue_id=${input.venueId}`;await sql`UPDATE chain_shared_balance SET available=available+${delta} WHERE organization_id=${organizationId} AND balance_id=${input.balanceId}`;}
 });
 let release:string|undefined;
 // a return is "in flight" while its relay can still be answered, or the branch accepted it and the projection has not caught up; a refused or lapsed one is re-asked with the CURRENT unspent count and the next revision
 const returned=Number(grant.return_revision),applied=Number(slot?.returnRevision??0);
 if(input.release&&unspent>0){
  const [last]=returned>0?await withTenant(scope,sql=>sql`SELECT status,expires_at FROM relay_command WHERE organization_id=${organizationId} AND venue_id=${input.venueId} AND starts_with(operation_id,${`${opBase('shared-return',input.balanceId,input.venueId,returned)}-d`}) ORDER BY created_at DESC LIMIT 1`):[];
  const inFlight=returned>applied&&last&&(last.status==='accepted'||last.status==='unknown'||(last.status==='pending'&&Date.parse(last.expires_at as string)>Date.now()));
  if(!inFlight){
   const next=await withOrganization(organizationId,async sql=>(await sql`UPDATE chain_shared_grant SET return_revision=return_revision+1,pending_return=${unspent} WHERE organization_id=${organizationId} AND balance_id=${input.balanceId} AND venue_id=${input.venueId} AND return_revision=${returned} RETURNING return_revision`)[0]?.return_revision as number|undefined);
   if(next)release=(await deliver(actor,scope,opBase('shared-return',input.balanceId,input.venueId,Number(next)),'Voucher.ReturnEscrow',{voucherId:String(pool.voucher_id),count:unspent,returnRevision:Number(next)})).status;
  }
 }
 const issued=Number(grant.granted);
 return {balanceId:input.balanceId,venueId:input.venueId,issued,confirmedByVenue:venueGranted,unconfirmed:issued-venueGranted,used,returned:venueReturned,outstanding:remainingEscrow(String(issued),String(used),String(venueReturned)),...(release?{release}:{}),appliedRevision:Number(slot?.revision??0)};
}
export async function readSharedBalance(actor:Actor,organizationId:string,balanceId:string){
 requireChain(actor,'chain.read',organizationId,actor.venueIds);
 return withOrganization(organizationId,async sql=>{
  const [pool]=await sql`SELECT balance_id,voucher_id,total,available FROM chain_shared_balance WHERE organization_id=${organizationId} AND balance_id=${balanceId}`;
  if(!pool)throw new Error('SHARED_BALANCE_NOT_FOUND');
  const grants=await sql`SELECT venue_id,granted,returned,revision FROM chain_shared_grant WHERE organization_id=${organizationId} AND balance_id=${balanceId} ORDER BY venue_id`;
  if(grants.length)requireChain(actor,'chain.read',organizationId,grants.map(g=>String(g.venue_id))); // the same rule as a rollout: every branch actually returned must be one the caller may read
  return {balanceId,voucherId:String(pool.voucher_id),total:Number(pool.total),available:Number(pool.available),grants:grants.map(g=>({venueId:String(g.venue_id),granted:Number(g.granted),returned:Number(g.returned),revision:Number(g.revision)}))};
 });
}
