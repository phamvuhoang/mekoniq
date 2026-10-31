import {afterAll,beforeAll,expect,test} from 'vitest';
import {createHash,generateKeyPairSync,randomUUID} from 'node:crypto';
import {setupWave02} from '../support/wave02-db';
import {createSupabaseActor} from '../support/supabase-auth';
import {createDeviceProvision} from '../../apps/cloud-web/src/server/modules/devices/provision';
import {rolePermissions,type Actor} from '../../apps/cloud-web/src/server/modules/identity/rbac';
import {createAssetUpload} from '../../apps/cloud-web/src/server/modules/storage/signed-upload';
import {finalizeAsset} from '../../apps/cloud-web/src/server/modules/storage/finalize';
import {collectOrphanAssets} from '../../apps/cloud-web/src/server/modules/storage/garbage-collection';
import {ASSET_BUCKET,readManifest} from '../../apps/cloud-web/src/server/modules/storage/manifest';
import {supabaseAdmin} from '../../apps/cloud-web/src/server/supabase/admin';
let db:Awaited<ReturnType<typeof setupWave02>>;
const scope={organizationId:'review-cloud-'+randomUUID(),venueId:'venue-a'};
const owner:Actor={id:'fixture-owner',organizationId:scope.organizationId,venueIds:[scope.venueId],role:'owner',permissions:['*']};
const manager:Actor={...owner,id:'fixture-manager',role:'manager',permissions:rolePermissions('manager')};
const bytes=new Uint8Array([137,80,78,71,13,10,26,10]),hash=createHash('sha256').update(bytes).digest('hex');
const input={kind:'menu_image',bytes:8,mime:'image/png',hash};
beforeAll(async()=>{
 db=await setupWave02();await db.admin`INSERT INTO venue(organization_id,id,name) VALUES(${scope.organizationId},${scope.venueId},'Review repair')`;
 const keys=generateKeyPairSync('ec',{namedCurve:'P-256'});process.env.DEVICE_GRANT_PRIVATE_KEY=JSON.stringify(keys.privateKey.export({format:'jwk'}));
 await db.admin`INSERT INTO device_enrollment(organization_id,venue_id,device_id,device_epoch,public_jwk,certificate_fingerprint,status) VALUES(${scope.organizationId},${scope.venueId},'review-device','review-epoch',${db.admin.json(keys.publicKey.export({format:'jwk'}) as Record<string,string>)},${'b'.repeat(64)},'active')`;
 await db.admin`INSERT INTO venue_ownership(organization_id,venue_id,resource_id,owner_device_id,owner_device_epoch,epoch,status) VALUES(${scope.organizationId},${scope.venueId},'coordinator','review-device','review-epoch',1,'active')`;
 await db.admin`INSERT INTO authority(organization_id,venue_id,coordinator_epoch,policy_revision) VALUES(${scope.organizationId},${scope.venueId},1,1)`;
});
afterAll(async()=>{if(db)await db.close();});
test('manager cannot mint an owner identity or wildcard permissions via actorId',async()=>{
 const subject=await createSupabaseActor(db.admin,scope,'owner');
 try{
  await expect(createDeviceProvision(manager,scope,'review-device',{actorId:subject.id})).rejects.toThrow('IDENTITY_DELEGATION_DENIED');
  await expect(createDeviceProvision(owner,scope,'review-device',{actorId:subject.id})).rejects.toThrow('IDENTITY_DELEGATION_DENIED');
 }finally{await subject.cleanup();}
});
test('cross-identity provisioning needs explicit delegation permission and cannot exceed caller scope',async()=>{
 const subject=await createSupabaseActor(db.admin,scope,'chef');
 try{
  const narrow={...manager,permissions:['device.enroll']};
  await expect(createDeviceProvision(narrow,scope,'review-device',{actorId:subject.id})).rejects.toThrow('IDENTITY_DELEGATION_DENIED');
  const partial={...manager,permissions:['device.enroll','identity.delegate','catalog.read']};
  const foreignVenuePrivilege={...manager,permissions:['*'],permissionsByVenue:{[scope.venueId]:partial.permissions}};
  await expect(createDeviceProvision(foreignVenuePrivilege,scope,'review-device',{actorId:subject.id})).rejects.toThrow('IDENTITY_DELEGATION_DENIED');
  await expect(createDeviceProvision(partial,scope,'review-device',{actorId:subject.id})).rejects.toThrow('IDENTITY_DELEGATION_DENIED');
 }finally{await subject.cleanup();}
});
test('owner self provisioning and explicit bounded staff delegation keep the real subject identity',async()=>{
 const subject=await createSupabaseActor(db.admin,scope,'chef');
 try{
  const self=await createDeviceProvision(owner,scope,'review-device');expect(self.offlineGrant.payload.actorRef).toBe(owner.id);
  const staff=await createDeviceProvision(manager,scope,'review-device',{actorId:subject.id});expect(staff.offlineGrant.payload.actorRef).toBe(subject.id);expect(staff.offlineGrant.payload.permissions).toEqual(rolePermissions('chef'));expect(staff.offlineGrant.payload.permissions.every(p=>manager.permissions.includes(p))).toBe(true);
 }finally{await subject.cleanup();}
});
test('orphan GC makes progress beyond twenty objects and never selects collected rows again',async()=>{
 const ids=Array.from({length:21},()=>randomUUID());
 for(const id of ids)await db.admin`INSERT INTO asset_manifest(organization_id,venue_id,id,kind,object_path,expected_bytes,mime,expected_hash,status,created_by,expires_at) VALUES(${scope.organizationId},${scope.venueId},${id},'menu_image',${scope.organizationId+'/'+scope.venueId+'/'+id},8,'image/png',${hash},'missing','review',now()-interval '2 days')`;
 expect((await collectOrphanAssets(scope)).removed).toBe(20);expect((await collectOrphanAssets(scope)).removed).toBe(1);expect((await collectOrphanAssets(scope)).removed).toBe(0);
 const rows=await db.admin`SELECT status FROM asset_manifest WHERE organization_id=${scope.organizationId} AND id=ANY(${ids})`;expect(rows.every(r=>r.status==='collected')).toBe(true);
 await expect(createAssetUpload(owner,scope,{...input,uploadId:ids[0]})).rejects.toThrow('ASSET_COLLECTED');
 await expect(finalizeAsset(owner,scope,ids[0]!)).rejects.toThrow('ASSET_COLLECTED');
});
test('early missing finalize retains quota while its original upload URL is still usable',async()=>{
 const upload=await createAssetUpload(owner,scope,input);
 const [{bytes:reserved}]=await db.admin`SELECT project_storage_reserved_bytes()::text AS bytes`;
 expect((await finalizeAsset(owner,scope,upload.id)).status).toBe('missing');
 let remaining=1000000000n-BigInt(reserved);
 while(remaining>0n){const fillerId=randomUUID(),chunk=remaining>20000000n?20000000n:remaining;await db.admin`INSERT INTO asset_manifest(organization_id,venue_id,id,kind,object_path,expected_bytes,mime,expected_hash,status,created_by,expires_at) VALUES(${scope.organizationId},${scope.venueId},${fillerId},'menu_image',${scope.organizationId+'/'+fillerId},${chunk.toString()},'image/png',${hash},'pending','budget-fixture',now()+interval '2 hours')`;remaining-=chunk;}
 try{
  await expect(createAssetUpload(owner,scope,input)).rejects.toThrow('STORAGE_QUOTA_EXCEEDED');
  const resumed=await createAssetUpload(owner,scope,{...input,uploadId:upload.id});expect(resumed.id).toBe(upload.id);
  expect((await supabaseAdmin().storage.from(ASSET_BUCKET).uploadToSignedUrl(upload.path,upload.token,bytes,{contentType:'image/png'})).error).toBeNull();expect((await finalizeAsset(owner,scope,upload.id)).status).toBe('ready');
  const [total]=await db.admin`SELECT project_storage_reserved_bytes()::text AS bytes`;expect(BigInt(total.bytes)).toBeLessThanOrEqual(1000000000n);
 }finally{await db.admin`DELETE FROM asset_manifest WHERE organization_id=${scope.organizationId} AND created_by='budget-fixture'`;}
});
test('expired reservation is retained until physical cleanup and renewed retry remains counted',async()=>{
 const upload=await createAssetUpload(owner,scope,input);await db.admin`UPDATE asset_manifest SET expires_at=now()-interval '1 minute' WHERE organization_id=${scope.organizationId} AND id=${upload.id}`;
 await expect(finalizeAsset(owner,scope,upload.id)).rejects.toThrow('UPLOAD_EXPIRED');
 const [before]=await db.admin`SELECT project_storage_reserved_bytes()::text AS bytes`;
 await createAssetUpload(owner,scope,{...input,uploadId:upload.id});const [after]=await db.admin`SELECT project_storage_reserved_bytes()::text AS bytes`;expect(after.bytes).toBe(before.bytes);expect((await readManifest(scope,upload.id)).status).toBe('pending');
});
