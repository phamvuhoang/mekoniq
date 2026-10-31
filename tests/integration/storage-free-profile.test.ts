import {beforeAll,afterAll,expect,test} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {setupWave02} from '../support/wave02-db';
import {createAssetUpload,createAssetDownload} from '../../apps/cloud-web/src/server/modules/storage/signed-upload';
import {finalizeAsset} from '../../apps/cloud-web/src/server/modules/storage/finalize';
import {readManifest,ASSET_BUCKET} from '../../apps/cloud-web/src/server/modules/storage/manifest';
import {collectOrphanAssets} from '../../apps/cloud-web/src/server/modules/storage/garbage-collection';
import {usageState} from '../../apps/cloud-web/src/server/modules/usage/budget';
import {supabaseAdmin} from '../../apps/cloud-web/src/server/supabase/admin';
import {withTenant} from '../../apps/cloud-web/src/server/modules/identity/tenant-context';
import type {Actor} from '../../apps/cloud-web/src/server/modules/identity/rbac';
let db:Awaited<ReturnType<typeof setupWave02>>;const scope={organizationId:'asset-org-'+randomUUID(),venueId:'venue-a'};
const actor:Actor={id:'owner',organizationId:scope.organizationId,venueIds:[scope.venueId],permissions:['*'],role:'owner'};
const bytes=new Uint8Array([137,80,78,71,13,10,26,10]);const hash=createHash('sha256').update(bytes).digest('hex');
beforeAll(async()=>{db=await setupWave02();await db.admin`INSERT INTO venue(organization_id,id,name) VALUES(${scope.organizationId},${scope.venueId},'Assets venue')`;});afterAll(async()=>{if(db)await db.close();});
test('upload signing cannot escape actor scope',async()=>{
 await expect(createAssetUpload(actor,{...scope,venueId:'venue-b'},{kind:'menu_image',bytes:8,mime:'image/png',hash})).rejects.toThrow('SCOPE_DENIED');
 expect(usageState(null,100)).toBe('unknown');expect(usageState(70,100)).toBe('warning');expect(usageState(85,100)).toBe('critical');
});
test('interrupted direct upload remains missing then resumes, finalize is idempotent',async()=>{
 const upload=await createAssetUpload(actor,scope,{kind:'menu_image',bytes:8,mime:'image/png',hash});
 expect((await finalizeAsset(actor,scope,upload.id)).status).toBe('missing');
 const client=supabaseAdmin();const result=await client.storage.from(ASSET_BUCKET).uploadToSignedUrl(upload.path,upload.token,bytes,{contentType:'image/png'});expect(result.error).toBeNull();
 expect((await finalizeAsset(actor,scope,upload.id)).status).toBe('ready');expect((await finalizeAsset(actor,scope,upload.id)).duplicate).toBe(true);
 const download=await createAssetDownload(actor,scope,upload.id);expect((await fetch(download.signedUrl)).status).toBe(200);
 const otherScope=await withTenant({...scope,organizationId:'other-org'},sql=>sql`SELECT id FROM asset_manifest`);expect(otherScope).toHaveLength(0);
});
test('wrong hash is rejected and oversized or MIME-forged signing fails',async()=>{
 const upload=await createAssetUpload(actor,scope,{kind:'menu_image',bytes:8,mime:'image/png',hash:'0'.repeat(64)});
 const result=await supabaseAdmin().storage.from(ASSET_BUCKET).uploadToSignedUrl(upload.path,upload.token,bytes,{contentType:'image/png'});expect(result.error).toBeNull();
 await expect(finalizeAsset(actor,scope,upload.id)).rejects.toThrow('ASSET_CONTENT_MISMATCH');expect((await readManifest(scope,upload.id)).status).toBe('rejected');
 await expect(createAssetUpload(actor,scope,{kind:'menu_image',bytes:20971521,mime:'image/png',hash})).rejects.toThrow('INVALID_ASSET');
 await expect(createAssetUpload(actor,scope,{kind:'menu_image',bytes:8,mime:'text/html',hash})).rejects.toThrow('INVALID_ASSET');
});
test('expired upload cannot finalize and cleanup preserves referenced assets',async()=>{
 const upload=await createAssetUpload(actor,scope,{kind:'menu_image',bytes:8,mime:'image/png',hash});
 await db.admin`UPDATE asset_manifest SET expires_at=now()-interval '2 days',referenced=true WHERE id=${upload.id}`;
 await expect(finalizeAsset(actor,scope,upload.id)).rejects.toThrow('UPLOAD_EXPIRED');
 await collectOrphanAssets(scope);expect((await readManifest(scope,upload.id)).status).toBe('pending');
});
test('resigning an interrupted upload keeps a stable object and rejects changed content',async()=>{
 const uploadId='upload-'+randomUUID();const input={kind:'menu_image',bytes:8,mime:'image/png',hash,uploadId};
 const first=await createAssetUpload(actor,scope,input),second=await createAssetUpload(actor,scope,input);expect(second.id).toBe(first.id);expect(second.path).toBe(first.path);
 await expect(createAssetUpload(actor,scope,{...input,bytes:9})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
});
