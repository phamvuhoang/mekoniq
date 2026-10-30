import {createHash} from 'node:crypto';
import {supabaseAdmin} from '../../supabase/admin';
import {requirePermission,type Actor} from '../identity/rbac';
import {withTenant,type TenantScope} from '../identity/tenant-context';
import {ASSET_BUCKET,readManifest} from './manifest';
export async function finalizeAsset(actor:Actor,scope:TenantScope,id:string){
 requirePermission(actor,'assets.write',scope);const row=await readManifest(scope,id);
 if(row.status==='ready')return {id,status:'ready',hash:row.expected_hash,bytes:Number(row.expected_bytes),duplicate:true};
 if(row.status==='rejected')throw new Error('ASSET_REJECTED');
 if(Date.parse(row.expires_at)<=Date.now())throw new Error('UPLOAD_EXPIRED');
 const admin=supabaseAdmin();const {data:signed,error}=await admin.storage.from(ASSET_BUCKET).createSignedUrl(row.object_path,60);
 if(error||!signed){await withTenant(scope,sql=>sql`UPDATE asset_manifest SET status='missing' WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND id=${id} AND status<>'ready'`);return {id,status:'missing'};}
 const response=await fetch(signed.signedUrl,{signal:AbortSignal.timeout(10000)});
 if(!response.ok||!response.body){await withTenant(scope,sql=>sql`UPDATE asset_manifest SET status='missing' WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND id=${id} AND status<>'ready'`);return {id,status:'missing'};}
 const hash=createHash('sha256');let bytes=0;const reader=response.body.getReader();
 try{while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.length;if(bytes>Number(row.expected_bytes)){await reader.cancel();break;}hash.update(chunk.value);}}finally{reader.releaseLock();}
 const actualMime=response.headers.get('content-type')?.split(';')[0];
 const valid=bytes===Number(row.expected_bytes)&&hash.digest('hex')===row.expected_hash&&actualMime===row.mime;
 const status=valid?'ready':'rejected';
 await withTenant(scope,sql=>sql`UPDATE asset_manifest SET status=${status},verified_at=now() WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND id=${id} AND status IN('pending','missing') AND expires_at>now()`);
 if(!valid)throw new Error('ASSET_CONTENT_MISMATCH');
 return {id,status,hash:row.expected_hash,bytes:Number(row.expected_bytes),duplicate:false};
}
