import {withTenant,type TenantScope} from '../identity/tenant-context';
import {supabaseAdmin} from '../../supabase/admin';
import {ASSET_BUCKET} from './manifest';
export async function collectOrphanAssets(scope:TenantScope,limit=20,signal?:AbortSignal){
 if(limit<1||limit>20)throw new Error('INVALID_GC_LIMIT');
 return withTenant(scope,async sql=>{
  const rows=await sql`SELECT id,object_path FROM asset_manifest WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND status IN('pending','missing','rejected') AND referenced=false AND expires_at<now()-interval '1 day' ORDER BY expires_at,id FOR UPDATE SKIP LOCKED LIMIT ${limit}`;
  let removed=0;
  for(const row of rows){
   // The row lock serializes renewal/reference changes with the bounded external delete.
   signal?.throwIfAborted();
   const {error}=await supabaseAdmin(signal??AbortSignal.timeout(10000)).storage.from(ASSET_BUCKET).remove([row.object_path]);if(error)continue;
   const changed=await sql`UPDATE asset_manifest SET status='missing' WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND id=${row.id} AND referenced=false AND status<>'ready' RETURNING id`;removed+=changed.length;
  }
  return {removed};
 });
}
