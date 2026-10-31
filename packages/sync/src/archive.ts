import {canonicalBytes,hashPayload,parseJsonStrict} from '../../contracts/src/index';
import type {JsonObject,Scope} from '../../contracts/src/index';
import type {DurableStore} from './store';
const cap=20*1024*1024;
async function archiveKey(passphrase:string,salt:Uint8Array) {
 if(passphrase.length<12)throw new Error('EXPORT_PASSPHRASE_TOO_SHORT');
 const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(passphrase),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',salt:salt as BufferSource,iterations:310000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function encryptedExport(store:DurableStore,scope:Scope,passphrase:string):Promise<JsonObject> {
 const data=await store.exportData(scope),bytes=canonicalBytes(data);
 if(bytes.length>cap)throw new Error('EXPORT_SEGMENT_TOO_LARGE');
 const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
 const key=await archiveKey(passphrase,salt);
 const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,bytes as BufferSource));
 return {schemaVersion:1,algorithm:'PBKDF2-SHA256/AES-256-GCM',iterations:310000,salt:[...salt],iv:[...iv],ciphertext:[...cipher],plaintextHash:hashPayload(data),organizationId:scope.organizationId,venueId:scope.venueId};
}
export async function restoreEncrypted(store:DurableStore,scope:Scope,archive:JsonObject,passphrase:string) {
 if(archive.schemaVersion!==1||archive.algorithm!=='PBKDF2-SHA256/AES-256-GCM'||archive.iterations!==310000||archive.organizationId!==scope.organizationId||archive.venueId!==scope.venueId||!Array.isArray(archive.salt)||!Array.isArray(archive.iv)||!Array.isArray(archive.ciphertext)||archive.ciphertext.length>cap+16)throw new Error('INVALID_EXPORT');
 const salt=Uint8Array.from(archive.salt as number[]),iv=Uint8Array.from(archive.iv as number[]);
 if(salt.length!==16||iv.length!==12)throw new Error('INVALID_EXPORT');
 const key=await archiveKey(passphrase,salt);
 const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,Uint8Array.from(archive.ciphertext as number[]));
 const data=parseJsonStrict(new TextDecoder().decode(plain),cap) as JsonObject;
 if(hashPayload(data)!==archive.plaintextHash)throw new Error('EXPORT_HASH_MISMATCH');
 await store.restoreData(scope,data);
}
