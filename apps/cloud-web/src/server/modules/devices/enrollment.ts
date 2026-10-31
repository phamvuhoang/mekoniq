import {createHash,randomBytes,randomUUID,type JsonWebKey} from 'node:crypto';
import {requirePermission,type Actor,rolePermissions} from '../identity/rbac';
import {withTenant,type TenantScope} from '../identity/tenant-context';
import {verifyGrant,type SignedGrant} from './grants';
import type {JsonValue} from '../../../../../../packages/contracts/generated/wire';
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export async function createEnrollmentNonce(actor:Actor,scope:TenantScope,nowMs=Date.now()) {
 requirePermission(actor,'device.enroll',scope);const nonce=randomBytes(32).toString('base64url');
 await withTenant(scope,sql=>sql`INSERT INTO enrollment_nonce(organization_id,venue_id,nonce_hash,issuer_id,expires_at) VALUES(${scope.organizationId},${scope.venueId},${digest(nonce)},${actor.id},${new Date(nowMs+300000)})`);
 return {nonce,expiresAt:new Date(nowMs+300000).toISOString()};
}
export type EnrollmentPayload={organizationId:string;venueId:string;nonce:string;deviceId:string;deviceEpoch?:string;certificateFingerprint?:string;publicJwk:JsonWebKey};
export async function enrollDevice(actor:Actor,proof:SignedGrant<EnrollmentPayload>,nowMs=Date.now()) {
 const p=proof.payload;const scope={organizationId:p.organizationId,venueId:p.venueId};requirePermission(actor,'device.enroll',scope);
 if(typeof p.deviceId!=='string'||!/^[A-Za-z0-9_.:-]{1,128}$/.test(p.deviceId)||!verifyGrant(proof as unknown as SignedGrant<JsonValue>,p.publicJwk))throw new Error('INVALID_DEVICE_PROOF');
 if(p.certificateFingerprint!==undefined&&!/^[a-f0-9]{64}$/.test(p.certificateFingerprint))throw new Error('INVALID_CERTIFICATE_FINGERPRINT');
 if('d' in p.publicJwk)throw new Error('PRIVATE_KEY_REJECTED');
 return withTenant(scope,async sql=>{
  await sql`SELECT pg_advisory_xact_lock(hashtext(${JSON.stringify([scope.organizationId,scope.venueId,p.deviceId])}))`;
  const nonces=await sql`SELECT * FROM enrollment_nonce WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND nonce_hash=${digest(p.nonce)} FOR UPDATE`;
  if(nonces.length!==1||nonces[0].issuer_id!==actor.id||nonces[0].used_at||Date.parse(nonces[0].expires_at)<=nowMs)throw new Error('ENROLLMENT_NONCE_INVALID');
  await sql`UPDATE enrollment_nonce SET used_at=${new Date(nowMs)} WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND nonce_hash=${digest(p.nonce)}`;
  if(p.deviceEpoch!==undefined&&!/^[A-Za-z0-9_-]{1,128}$/.test(p.deviceEpoch))throw new Error('INVALID_DEVICE_EPOCH');
  const deviceEpoch=p.deviceEpoch??randomUUID();
  const reused=await sql`SELECT device_epoch FROM device_enrollment WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND device_id=${p.deviceId} AND device_epoch=${deviceEpoch}`;if(reused.length)throw new Error('DEVICE_EPOCH_REUSED');
  await sql`UPDATE device_enrollment SET status='revoked' WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND device_id=${p.deviceId} AND status='active'`;
  await sql`INSERT INTO device_enrollment(organization_id,venue_id,device_id,device_epoch,public_jwk,certificate_fingerprint,status) VALUES(${scope.organizationId},${scope.venueId},${p.deviceId},${deviceEpoch},${sql.json(p.publicJwk as Record<string,string>)},${p.certificateFingerprint??null},'active')`;
  return {deviceId:p.deviceId,deviceEpoch,organizationId:scope.organizationId,venueId:scope.venueId};
 });
}
export type DeviceProofPayload={organizationId:string;venueId:string;deviceId:string;deviceEpoch:string;method:string;path:string;bodyHash:string;nonce:string;issuedAt:string};
export async function authenticateDevice(request:Request,bodyHash:string,nowMs=Date.now()):Promise<Actor|null> {
 try{
  const raw=request.headers.get('x-mekoniq-device-proof');if(!raw||raw.length>16384)return null;
  const proof=JSON.parse(Buffer.from(raw,'base64url').toString()) as SignedGrant<DeviceProofPayload>;
  const p=proof.payload;const issued=Date.parse(p.issuedAt);
  if(!Number.isFinite(issued)||Math.abs(issued-nowMs)>30000||p.method!==request.method||p.path!==new URL(request.url).pathname||p.bodyHash!==bodyHash||typeof p.nonce!=='string'||p.nonce.length>128)return null;
  return await withTenant(p,async sql=>{
   const [row]=await sql`SELECT public_jwk,status FROM device_enrollment WHERE organization_id=${p.organizationId} AND venue_id=${p.venueId} AND device_id=${p.deviceId} AND device_epoch=${p.deviceEpoch}`;
   if(!row||!verifyGrant(proof as unknown as SignedGrant<JsonValue>,row.public_jwk))return null;
   await sql`DELETE FROM device_request_nonce WHERE organization_id=${p.organizationId} AND venue_id=${p.venueId} AND device_id=${p.deviceId} AND expires_at<now()`;
   const claimed=await sql`INSERT INTO device_request_nonce(organization_id,venue_id,device_id,nonce,expires_at) VALUES(${p.organizationId},${p.venueId},${p.deviceId},${p.nonce},${new Date(nowMs+60000)}) ON CONFLICT DO NOTHING RETURNING nonce`;
   if(claimed.length!==1)return null;
   return {id:p.deviceId,deviceId:p.deviceId,deviceEpoch:p.deviceEpoch,organizationId:p.organizationId,venueIds:[p.venueId],role:'device',permissions:row.status==='active'?['sync.read','sync.write','relay.read','relay.receipt','configuration.apply',...rolePermissions('device')]:['sync.write']};
  });
 }catch{return null;}
}
