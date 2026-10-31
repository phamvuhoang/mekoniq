import {expect,test} from 'vitest';
import {generateKeyPairSync,sign} from 'node:crypto';
import {verifyEs256} from '../../packages/contracts/src/signing';
import {canonicalBytes} from '../../packages/contracts/src/canonical';
test('portable verifier accepts standard Node ES256 raw signatures and rejects tampering',()=>{
 const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'P-256'});
 const jwk=publicKey.export({format:'jwk'}),bytes=canonicalBytes({grantId:'grant-1',minor:'9007199254740993'});
 for(let i=0;i<10;i++) {
  const signature=sign('sha256',bytes,{key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
  expect(verifyEs256(bytes,signature,jwk)).toBe(true);
  expect(verifyEs256(canonicalBytes({grantId:'grant-1',minor:'1'}),signature,jwk)).toBe(false);
  expect(verifyEs256(bytes,signature.slice(1),jwk)).toBe(false);
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const nonCanonical=signature.slice(0,-1)+alphabet[alphabet.indexOf(signature.at(-1)!)+1];
  expect(verifyEs256(bytes,nonCanonical,jwk)).toBe(false);
  expect(verifyEs256(bytes,signature,{...jwk,crv:'P-384'})).toBe(false);
 }
});
