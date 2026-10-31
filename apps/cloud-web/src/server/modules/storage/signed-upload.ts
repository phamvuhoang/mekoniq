import {randomUUID} from 'node:crypto';
import {supabaseAdmin} from '../../supabase/admin';
import {requirePermission,type Actor} from '../identity/rbac';
import {withTenant,type TenantScope} from '../identity/tenant-context';
import {ASSET_BUCKET,ASSET_SIZE_LIMIT,readManifest} from './manifest';
export type UploadInput={kind:string;bytes:number;mime:string;hash:string;uploadId?:string};
const allowed:Record<string,string[]>={menu_image:['image/png','image/jpeg','image/webp'],map:['application/json','image/png'],receipt:['image/png','image/jpeg','application/pdf'],import:['text/csv','application/json']};
export async function createAssetUpload(actor:Actor,scope:TenantScope,input:UploadInput){
 requirePermission(actor,'assets.write',scope);
 if(!allowed[input.kind]?.includes(input.mime)||!Number.isSafeInteger(input.bytes)||input.bytes<1||input.bytes>ASSET_SIZE_LIMIT||!/^[a-f0-9]{64}$/.test(input.hash))throw new Error('INVALID_ASSET');
 if(input.uploadId!==undefined&&!/^[A-Za-z0-9_-]{1,128}$/.test(input.uploadId))throw new Error('INVALID_UPLOAD_ID');
 const id=input.uploadId??randomUUID();const objectPath=`${scope.organizationId}/${scope.venueId}/${id}`;
 const storedStatus=await withTenant(scope,async sql=>{
  // Serialize reservations project-wide; the aggregate function reveals no tenant identifiers.
  await sql`SELECT pg_advisory_xact_lock(hashtext('mekoniq-storage-budget'))`;
  const [existing]=await sql`SELECT kind,expected_bytes,mime,expected_hash,status FROM asset_manifest WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND id=${id} FOR UPDATE`;
  if(existing){if(existing.kind!==input.kind||Number(existing.expected_bytes)!==input.bytes||existing.mime!==input.mime||existing.expected_hash!==input.hash)throw new Error('IDEMPOTENCY_CONFLICT');if(existing.status==='collected')throw new Error('ASSET_COLLECTED');if(existing.status==='rejected')throw new Error('ASSET_REJECTED');if(existing.status!=='ready')await sql`UPDATE asset_manifest SET expires_at=${new Date(Date.now()+7200000)} WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND id=${id}`;return existing.status as string;}
  const [reserved]=await sql`SELECT project_storage_reserved_bytes()::text AS bytes`;
  if(BigInt(reserved.bytes)+BigInt(input.bytes)>1000000000n)throw new Error('STORAGE_QUOTA_EXCEEDED');
  await sql`INSERT INTO asset_manifest(organization_id,venue_id,id,kind,object_path,expected_bytes,mime,expected_hash,status,created_by,expires_at) VALUES(${scope.organizationId},${scope.venueId},${id},${input.kind},${objectPath},${input.bytes},${input.mime},${input.hash},'pending',${actor.id},${new Date(Date.now()+7200000)})`;
  await sql`INSERT INTO cloud_job(organization_id,venue_id,id,type,payload,due_at) VALUES(${scope.organizationId},${scope.venueId},${'asset-gc:'+id},'storage.gc','{}',${new Date(Date.now()+7200000+86400000)}) ON CONFLICT DO NOTHING`;
  return 'pending';
 });
 const {data,error}=await supabaseAdmin().storage.from(ASSET_BUCKET).createSignedUploadUrl(objectPath,{upsert:false});
 if(error||!data)throw new Error('STORAGE_UNAVAILABLE');
 // Supabase upload signing uses its documented two-hour lifetime; manifest retains interrupted state.
 return {id,status:storedStatus,path:objectPath,signedUrl:data.signedUrl,token:data.token,expiresIn:7200};
}
export async function createAssetDownload(actor:Actor,scope:TenantScope,id:string){
 requirePermission(actor,'assets.read',scope);const row=await readManifest(scope,id);if(row.status!=='ready')throw new Error('ASSET_NOT_READY');
 const {data,error}=await supabaseAdmin().storage.from(ASSET_BUCKET).createSignedUrl(row.object_path,60);
 if(error||!data)throw new Error('STORAGE_UNAVAILABLE');return {signedUrl:data.signedUrl,expiresIn:60};
}
