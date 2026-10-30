import {p256} from '@noble/curves/nist.js';
export type PublicEcJwk={kty?:string;crv?:string;x?:string;y?:string;alg?:string;use?:string;key_ops?:string[]};
function decodeBase64Url(value:string,length:number):Uint8Array {
 if(!/^[A-Za-z0-9_-]+$/.test(value))throw new Error('INVALID_BASE64URL');
 const standard=value.replace(/-/g,'+').replace(/_/g,'/');
 const binary=globalThis.atob(standard+'='.repeat((4-standard.length%4)%4));
 const canonical=globalThis.btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 if(canonical!==value)throw new Error('NON_CANONICAL_BASE64URL');
 const bytes=Uint8Array.from(binary,character=>character.charCodeAt(0));
 if(bytes.length!==length)throw new Error('INVALID_LENGTH');
 return bytes;
}
/** JOSE ES256 raw r||s signature. No private key operation or Node API is used. */
export function verifyEs256(bytes:Uint8Array,signature:string,jwk:PublicEcJwk):boolean {
 try {
  if(jwk.kty!=='EC'||jwk.crv!=='P-256'||(jwk.alg&&jwk.alg!=='ES256')||(jwk.use&&jwk.use!=='sig')||(jwk.key_ops&&!jwk.key_ops.includes('verify')))return false;
  if(typeof jwk.x!=='string'||typeof jwk.y!=='string'||typeof signature!=='string'||signature.length!==86)return false;
  const publicKey=new Uint8Array(65);publicKey[0]=4;publicKey.set(decodeBase64Url(jwk.x,32),1);publicKey.set(decodeBase64Url(jwk.y,32),33);
  // JOSE permits high-S signatures emitted by Android/Java/OpenSSL.
  return p256.verify(decodeBase64Url(signature,64),bytes,publicKey,{prehash:true,lowS:false,format:'compact'});
 }catch{return false;}
}
