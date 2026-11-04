import type {JsonObject} from '../../../../../../packages/contracts/generated/wire';
import {rolloutState} from '../../../../../../packages/domain/src/chain/overlay';
import {requirePermission,type Actor} from '../identity/rbac';
import {withOrganization,withTenant,type TenantScope} from '../identity/tenant-context';
/** The chain-wide rights are ordinary venue permissions checked in every venue the call touches: an actor without a venue's grant can neither change nor read that venue's rollout. */
export function requireChain(actor:Actor,permission:'chain.publish'|'chain.read',organizationId:string,venueIds:string[]){
 if(!venueIds.length||venueIds.length>200||new Set(venueIds).size!==venueIds.length)throw new Error('INVALID_VENUES');
 for(const venueId of venueIds)requirePermission(actor,permission,{organizationId,venueId});
}
/** What the venue itself has acknowledged: the catalog version it has applied (from its synced accepted facts), and the newest applied configuration revision. */
export async function venueEffective(scope:TenantScope){
 return withTenant(scope,async sql=>{
  const [catalog]=await sql`SELECT state FROM sync_projection WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND aggregate_type='catalog' AND aggregate_id='current'`;
  const [config]=await sql`SELECT max(revision) FILTER (WHERE status='applied') AS applied FROM configuration_revision WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId}`;
  const stations=await sql`SELECT aggregate_id FROM sync_projection WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND aggregate_type='station'`;
  return {catalogVersion:Number((catalog?.state as JsonObject|undefined)?.version??0),items:(((catalog?.state as JsonObject|undefined)?.items??[]) as JsonObject[]),configurationRevision:Number(config?.applied??0),stationIds:new Set(stations.map(s=>String(s.aggregate_id)))};
 });
}
export async function rolloutStatus(actor:Actor,organizationId:string,revision:number){
 const targets=await withOrganization(organizationId,sql=>sql`SELECT venue_id,kind,desired_version,operation_id,status,code,attempts FROM chain_rollout_target WHERE organization_id=${organizationId} AND revision=${revision} ORDER BY venue_id,kind`);
 const venues=[...new Set(targets.map(t=>String(t.venue_id)))];
 if(venues.length)requireChain(actor,'chain.read',organizationId,venues);
 const out=[];
 for(const t of targets){
  const scope={organizationId,venueId:String(t.venue_id)},effective=await venueEffective(scope);
  const desired=Number(t.desired_version),value=t.kind==='catalog'?effective.catalogVersion:effective.configurationRevision;
  let code:string|undefined=t.status==='rejected'?String(t.code??'REJECTED'):undefined;
  const refused=code!==undefined; // refused before any relay: the venue was never asked, whatever it runs now
  if(!code&&t.kind==='catalog'&&t.operation_id){
   const [relay]=await withTenant(scope,sql=>sql`SELECT status,venue_receipt FROM relay_command WHERE organization_id=${organizationId} AND venue_id=${scope.venueId} AND operation_id=${t.operation_id}`);
   if(relay?.status==='rejected'&&value<desired)code=String((relay.venue_receipt as JsonObject|null)?.code??'REJECTED');
  }
  out.push({venueId:scope.venueId,kind:String(t.kind),desired,effective:value,state:rolloutState(desired,value,refused||value<desired?code:undefined),...(code&&(refused||value<desired)?{code}:{}),attempts:Number(t.attempts)});
 }
 return {revision,targets:out};
}
