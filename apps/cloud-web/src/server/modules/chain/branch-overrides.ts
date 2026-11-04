import {overlayItems,validatedOverride,type BranchOverride} from '../../../../../../packages/domain/src/chain/overlay';
import type {JsonObject} from '../../../../../../packages/contracts/generated/wire';
import type {Actor} from '../identity/rbac';
import {withOrganization} from '../identity/tenant-context';
import {requireChain} from './rollout-state';
export async function latestChainRevision(organizationId:string,revision?:number){
 return withOrganization(organizationId,async sql=>{
  const [row]=revision===undefined?await sql`SELECT revision,snapshot,restores FROM chain_revision WHERE organization_id=${organizationId} ORDER BY revision DESC LIMIT 1`:await sql`SELECT revision,snapshot,restores FROM chain_revision WHERE organization_id=${organizationId} AND revision=${revision}`;
  return row?{revision:Number(row.revision),snapshot:row.snapshot as JsonObject,restores:row.restores===null?null:Number(row.restores)}:null;
 });
}
export async function readBranchOverride(organizationId:string,venueId:string){
 return withOrganization(organizationId,async sql=>{
  const [row]=await sql`SELECT revision,patch FROM chain_branch_override WHERE organization_id=${organizationId} AND venue_id=${venueId} ORDER BY revision DESC LIMIT 1`;
  return {revision:Number(row?.revision??0),patch:(row?.patch??{}) as BranchOverride};
 });
}
/** One versioned override document per branch (the whole current overlay): a second writer on the same revision gets VERSION_CONFLICT instead of silently replacing the first one's change. */
export async function setBranchOverride(actor:Actor,organizationId:string,venueId:string,input:{expectedRevision:number;patch:unknown}){
 requireChain(actor,'chain.publish',organizationId,[venueId]);
 const chain=await latestChainRevision(organizationId);if(!chain)throw new Error('CHAIN_REVISION_NOT_FOUND');
 const patch=validatedOverride(input.patch,new Set(((chain.snapshot.items??[]) as JsonObject[]).map(i=>String(i.id))));
 return withOrganization(organizationId,async sql=>{
  await sql`SELECT pg_advisory_xact_lock(hashtext(${JSON.stringify(['override',organizationId,venueId])}))`;
  const [cur]=await sql`SELECT max(revision) AS r FROM chain_branch_override WHERE organization_id=${organizationId} AND venue_id=${venueId}`;
  if(Number(cur?.r??0)!==input.expectedRevision)throw new Error('VERSION_CONFLICT');
  const revision=input.expectedRevision+1;
  await sql`INSERT INTO chain_branch_override(organization_id,venue_id,revision,patch,created_by) VALUES(${organizationId},${venueId},${revision},${sql.json(patch as JsonObject)},${actor.id})`;
  return {venueId,revision};
 });
}
export {overlayItems};
