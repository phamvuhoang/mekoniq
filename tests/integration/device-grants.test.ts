import {beforeAll,afterAll,expect,test} from 'vitest';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {setupWave02} from '../support/wave02-db';
import {acquireInitialOwnership,validateOwnership} from '../../apps/cloud-web/src/server/modules/devices/ownership';
import {createEnrollmentNonce,enrollDevice} from '../../apps/cloud-web/src/server/modules/devices/enrollment';
import {signGrant,issueOfflineGrant,grantMode} from '../../apps/cloud-web/src/server/modules/devices/grants';
import type {Actor} from '../../apps/cloud-web/src/server/modules/identity/rbac';
let db:Awaited<ReturnType<typeof setupWave02>>;
const scope={organizationId:'grant-org-'+randomUUID(),venueId:'venue-a'};
const actor:Actor={id:'manager-a',...scope,venueIds:[scope.venueId],permissions:['*'],role:'owner'};
beforeAll(async()=>{db=await setupWave02();await db.admin`INSERT INTO venue(organization_id,id,name) VALUES(${scope.organizationId},${scope.venueId},'Grant venue')`;});
afterAll(async()=>{if(db)await db.close();});
test('elapsed time never assigns a second owner',async()=>{
 const key=generateKeyPairSync('ec',{namedCurve:'P-256'}).publicKey.export({format:'jwk'});
 await db.admin`INSERT INTO device_enrollment(organization_id,venue_id,device_id,device_epoch,public_jwk,status) VALUES(${scope.organizationId},${scope.venueId},'device-a','initial-epoch',${db.admin.json(key as Record<string,string>)},'active')`;
 await db.admin`INSERT INTO device_enrollment(organization_id,venue_id,device_id,device_epoch,public_jwk,status) VALUES(${scope.organizationId},${scope.venueId},'device-b','initial-epoch-b',${db.admin.json(key as Record<string,string>)},'active')`;
 await acquireInitialOwnership(scope,'coordinator','device-a');
 await expect(acquireInitialOwnership(scope,'coordinator','device-b')).rejects.toThrow('HANDOFF_REQUIRED');
});
test('enrollment proof binds key, venue and one-use nonce',async()=>{
 const keys=generateKeyPairSync('ec',{namedCurve:'P-256'});const privateJwk=keys.privateKey.export({format:'jwk'});const publicJwk=keys.publicKey.export({format:'jwk'});
 const {nonce}=await createEnrollmentNonce(actor,scope);const proof=signGrant({...scope,nonce,deviceId:'device-a',publicJwk},privateJwk);
 const enrolled=await enrollDevice(actor,proof);expect(enrolled.deviceEpoch).toBeTruthy();
 expect(await validateOwnership(scope,'coordinator','device-a',1,enrolled.deviceEpoch)).toBe(false);
 await expect(enrollDevice(actor,proof)).rejects.toThrow('ENROLLMENT_NONCE_INVALID');
 const {nonce:other}=await createEnrollmentNonce(actor,scope);const changed=signGrant({...scope,nonce:other,deviceId:'device-b',publicJwk},privateJwk);changed.payload.deviceId='device-forged';
 await expect(enrollDevice(actor,changed)).rejects.toThrow('INVALID_DEVICE_PROOF');
});
test('grant expiry and wrong device switch to capture-only without erasing data',()=>{
 const keys=generateKeyPairSync('ec',{namedCurve:'P-256'});const privateJwk=keys.privateKey.export({format:'jwk'});const publicJwk=keys.publicKey.export({format:'jwk'});
 const grant=issueOfflineGrant({...scope,actorRef:'staff',deviceId:'device-a',deviceEpoch:'epoch-a',permissions:['payment.cash'],coordinatorEpoch:1,nonce:'n'},privateJwk,1000,2000);
 expect(grantMode(grant,publicJwk,{deviceId:'device-a',deviceEpoch:'epoch-a'},2000)).toBe('privileged');
 expect(grantMode(grant,publicJwk,{deviceId:'device-a',deviceEpoch:'epoch-a'},3000)).toBe('capture-only');
 expect(grantMode(grant,publicJwk,{deviceId:'device-b',deviceEpoch:'epoch-a'},2000)).toBe('capture-only');
});
import {createDeviceProvision} from '../../apps/cloud-web/src/server/modules/devices/provision';
import {verifyGrant} from '../../apps/cloud-web/src/server/modules/devices/grants';
test('native epoch and certificate persist; signed authority uses the actual owner key',async()=>{
 const deviceKeys=generateKeyPairSync('ec',{namedCurve:'P-256'}),issuer=generateKeyPairSync('ec',{namedCurve:'P-256'});
 const privateJwk=deviceKeys.privateKey.export({format:'jwk'}),publicJwk=deviceKeys.publicKey.export({format:'jwk'});
 const {nonce}=await createEnrollmentNonce(actor,scope);const deviceEpoch='native-epoch-'+randomUUID();
 const proof=signGrant({...scope,nonce,deviceId:'device-native',deviceEpoch,certificateFingerprint:'b'.repeat(64),publicJwk},privateJwk);
 expect((await enrollDevice(actor,proof)).deviceEpoch).toBe(deviceEpoch);
 await db.admin`UPDATE venue_ownership SET owner_device_id='device-native',owner_device_epoch=${deviceEpoch} WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND resource_id='coordinator'`;
 await db.admin`INSERT INTO authority(organization_id,venue_id,coordinator_epoch,policy_revision) VALUES(${scope.organizationId},${scope.venueId},1,1) ON CONFLICT DO NOTHING`;
 process.env.DEVICE_GRANT_PRIVATE_KEY=JSON.stringify(issuer.privateKey.export({format:'jwk'}));
 const provision=await createDeviceProvision(actor,scope,'device-native');
 expect(provision.authority.grant.ownerDeviceEpoch).toBe(deviceEpoch);expect(provision.authority.grant.publicJwk).toEqual(publicJwk);
 expect(provision.pairingGrant.grant.certificateFingerprint).toBe('b'.repeat(64));expect(verifyGrant({payload:provision.authority.grant,signature:provision.authority.signature},issuer.publicKey.export({format:'jwk'}))).toBe(true);
});
import {createSupabaseActor} from '../support/supabase-auth';
test('staff provisioning derives chef station scope from the persisted membership',async()=>{
 const chef=await createSupabaseActor(db.admin,scope,'chef');
 try{
  await db.admin`UPDATE venue_membership SET station_ids=ARRAY['kitchen'] WHERE user_id=${chef.id}::uuid`;
  await db.admin`INSERT INTO sync_projection(organization_id,venue_id,aggregate_type,aggregate_id,version,state,entry_id) VALUES(${scope.organizationId},${scope.venueId},'station','kitchen',1,'{"name":"Bếp"}','provision-kitchen')`;
  await db.admin`INSERT INTO sync_projection(organization_id,venue_id,aggregate_type,aggregate_id,version,state,entry_id) VALUES(${scope.organizationId},${scope.venueId},'station','bar',1,'{"name":"Bar"}','provision-bar')`;
  const bundle=await createDeviceProvision(actor,scope,'device-native',{actorId:chef.id});
  expect(bundle.offlineGrant.payload.actorRef).toBe(chef.id);expect(bundle.offlineGrant.payload.stationIds).toEqual(['kitchen']);expect(bundle.pairingGrant.grant.stationIds).toEqual(['kitchen']);
  expect(bundle.offlineGrant.payload.permissions).not.toContain('payment.cash');
 }finally{await chef.cleanup();}
});
