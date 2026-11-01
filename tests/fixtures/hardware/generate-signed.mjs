// TEST-ONLY. Generates a throwaway P-256 keypair per run, signs commissioning-complete.json (RFC 8785 canonical JSON, JOSE ES256) as a
// hardware_validated and a venue_approved sample, and writes ONLY the public keys. The private keys are never written anywhere.
// Run from source/: node tests/fixtures/hardware/generate-signed.mjs   (re-running replaces the keys and samples together)
import {readFileSync, writeFileSync} from 'node:fs';
import {webcrypto as c} from 'node:crypto';
import {canonicalBytes} from '../../../packages/contracts/src/canonical.ts';
const dir = new URL('.', import.meta.url), b64u = (b) => Buffer.from(b).toString('base64url');
const base = JSON.parse(readFileSync(new URL('commissioning-complete.json', dir), 'utf8'));
const gen = () => c.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
const pub = async (k, kid) => ({...(await c.subtle.exportKey('jwk', k.publicKey)), alg: 'ES256', use: 'sig', key_ops: ['verify'], kid});
const good = await gen(), wrong = await gen();
writeFileSync(new URL('commissioning-test.public.jwk.json', dir), JSON.stringify(await pub(good, 'TEST-ONLY-commissioning'), null, 2) + '\n');
writeFileSync(new URL('commissioning-wrong.public.jwk.json', dir), JSON.stringify(await pub(wrong, 'TEST-ONLY-wrong'), null, 2) + '\n');
async function sign(name, claim, venue) {
  const rec = {...base, venue_acceptance: venue, manifest: {...base.manifest, validation: claim}};
  const sig = await c.subtle.sign({name: 'ECDSA', hash: 'SHA-256'}, good.privateKey, canonicalBytes(rec));
  writeFileSync(new URL(name, dir), JSON.stringify({...rec, signature: {keyId: 'TEST-ONLY-commissioning', alg: 'ES256', value: b64u(sig)}}, null, 2) + '\n');
}
await sign('signed-hardware-validated.json', 'hardware_validated', null);
await sign('signed-venue-approved.json', 'venue_approved', {venue_id: 'TEST-ONLY-venue', accepted_by: 'TEST-ONLY', accepted_on: '2000-01-01'});
