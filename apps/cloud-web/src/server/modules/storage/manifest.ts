import {withTenant,type TenantScope} from '../identity/tenant-context';
export const ASSET_BUCKET='mekoniq-private';export const ASSET_SIZE_LIMIT=20*1024*1024;
export type {AssetManifest} from '../../../../../../packages/contracts/generated/wire';
export async function readManifest(scope:TenantScope,id:string){return withTenant(scope,async sql=>{
 const [row]=await sql`SELECT * FROM asset_manifest WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND id=${id}`;
 if(!row)throw new Error('ASSET_NOT_FOUND');return row;
});}
