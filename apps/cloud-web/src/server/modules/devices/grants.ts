import {createPrivateKey,createPublicKey,sign,verify,type JsonWebKey} from 'node:crypto';
import {validateOfflineGrant} from '../../../../../../packages/contracts/src/validate';
import {canonicalBytes,assertJson} from '../../../../../../packages/contracts/src/canonical';
export type SignedGrant<T>={payload:T;signature:string};
import type {OfflineGrant} from '../../../../../../packages/contracts/generated/wire';
export type {OfflineGrant} from '../../../../../../packages/contracts/generated/wire';
export function signGrant<T>(payload:T,privateJwk:JsonWebKey):SignedGrant<T>{
 assertJson(payload);
 const privateKey=createPrivateKey({key:privateJwk,format:'jwk'});
 if(privateJwk.kty!=='EC'||privateJwk.crv!=='P-256')throw new Error('INVALID_SIGNING_KEY');
 return {payload,signature:sign('sha256',canonicalBytes(payload),{key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url')};
}
export function verifyGrant<T>(grant:SignedGrant<T>,publicJwk:JsonWebKey):boolean {
 try {
  assertJson(grant.payload);
  if(publicJwk.kty!=='EC'||publicJwk.crv!=='P-256'||typeof grant.signature!=='string')return false;
  const signature=Buffer.from(grant.signature,'base64url');if(signature.length!==64)return false;
  return verify('sha256',canonicalBytes(grant.payload),{key:createPublicKey({key:publicJwk,format:'jwk'}),dsaEncoding:'ieee-p1363'},signature);
 }catch{return false;}
}
export function grantMode(grant:SignedGrant<OfflineGrant>,publicJwk:JsonWebKey,device:{deviceId:string;deviceEpoch:string},nowMs:number) {
 try{validateOfflineGrant(grant);}catch{return 'capture-only';}
 if(!verifyGrant(grant,publicJwk)||grant.payload.deviceId!==device.deviceId||grant.payload.deviceEpoch!==device.deviceEpoch)return 'capture-only';
 const issued=Date.parse(grant.payload.issuedAt),expires=Date.parse(grant.payload.expiresAt);
 if(!Number.isFinite(issued)||!Number.isFinite(expires)||issued>nowMs+30000||expires<=nowMs)return 'capture-only';
 return 'privileged';
}
export function issueOfflineGrant(input:Omit<OfflineGrant,'schemaVersion'|'issuedAt'|'expiresAt'>,privateJwk:JsonWebKey,nowMs=Date.now(),durationMs=86400000) {
 if(durationMs<=0||durationMs>86400000)throw new Error('INVALID_GRANT_TTL');
 const payload:OfflineGrant={...input,schemaVersion:1,issuedAt:new Date(nowMs).toISOString(),expiresAt:new Date(nowMs+durationMs).toISOString()};
 const signed=signGrant(payload,privateJwk);validateOfflineGrant(signed);return signed;
}
export function configuredGrantSigner():JsonWebKey{
 const raw=process.env.DEVICE_GRANT_PRIVATE_KEY;if(!raw)throw new Error('GRANT_SIGNER_UNAVAILABLE');
 const key=JSON.parse(raw) as JsonWebKey;if(key.kty!=='EC'||key.crv!=='P-256'||!key.d)throw new Error('INVALID_SIGNING_KEY');return key;
}
