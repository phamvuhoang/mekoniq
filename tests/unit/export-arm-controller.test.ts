// A06: the controller artifact exporter produces a schema-valid, fully hashed, signed manifest from the package; without a key it is marked
// unsigned (and the installer refuses it); the Python verifier accepts the signed artifact under a policy with that key and refuses tamper.
import {execFileSync,spawnSync} from 'node:child_process';
import {generateKeyPairSync} from 'node:crypto';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {afterEach,expect,test} from 'vitest';
// @ts-expect-error plain ESM script without types
import {publicKeyBase64url} from '../../scripts/export-arm-controller.mjs';
const dirs:string[]=[];afterEach(()=>{for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});});
const schema=JSON.parse(readFileSync('integrations/arm-controller/packaging/release-manifest.schema.json','utf8'));
const ajv=new Ajv({allErrors:true,strict:true});addFormats(ajv);const validate=ajv.compile(schema);
const PY=resolve('.venv/bin/python'),py=existsSync(PY)?PY:'python3';
function exportArtifact(args:string[]){const out=mkdtempSync(join(tmpdir(),'arm-artifact-'));dirs.push(out);const log=execFileSync(process.execPath,['scripts/export-arm-controller.mjs',out,'--allow-dirty',...args],{encoding:'utf8'});return {out,summary:JSON.parse(log) as Record<string,unknown>};}

test('a signed export hashes every file, validates against the manifest schema and verifies under a policy with the key',()=>{
 const {privateKey,publicKey}=generateKeyPairSync('ed25519'),keyDir=mkdtempSync(join(tmpdir(),'arm-key-'));dirs.push(keyDir);
 writeFileSync(join(keyDir,'release.pem'),privateKey.export({type:'pkcs8',format:'pem'}));
 const {out,summary}=exportArtifact(['--signing-key',join(keyDir,'release.pem'),'--key-id','test-release-key']);
 const m=JSON.parse(readFileSync(join(out,'manifest.json'),'utf8'));
 expect(validate(m),JSON.stringify(validate.errors)).toBe(true);
 expect(summary).toMatchObject({signed:true,keyId:'test-release-key'});expect(typeof summary.dirty).toBe('boolean');expect(m.version).toMatch(/^0\.1\.0\+[0-9a-f]{7}(\.dirty)?$/);expect(m.dirty).toBe(summary.dirty);
 expect(m.files.map((f:{path:string})=>f.path)).toEqual(expect.arrayContaining(['bridge/arbiter.py','bridge/service.py','hmi/mekoniq_arm/mekoniq_arm.ui','configs/sim/puma560/profile.json','models/puma560-reference/manifest.json','programs/cup-pick.ngc','packaging/dependencies.lock.json','packaging/trust-policy.json','scripts/install-sim.sh','scripts/verify-signature.py','schemas/arm-command.schema.json','schemas/cell-command.schema.json']));
 expect(m.files.some((f:{path:string})=>/tests\/|__pycache__|\.pem$/.test(f.path))).toBe(false);
 expect(m.sbom.components.every((c:{licenseReviewed:boolean})=>c.licenseReviewed===false)).toBe(true);expect(m.hardwareEnabled).toBe(false);
 const policy={schemaVersion:1,policyRevision:1,keys:[{keyId:'test-release-key',algorithm:'Ed25519',publicKey:publicKeyBase64url(publicKey),validFrom:'2026-01-01T00:00:00Z',expiresAt:'2030-01-01T00:00:00Z',status:'active'}],allowDowngrade:false,allowDowngradeTo:[],offlineCacheValidityDays:90,cachedAt:new Date().toISOString()};
 writeFileSync(join(keyDir,'policy.json'),JSON.stringify(policy));
 const ok=spawnSync(py,[join(out,'scripts/verify-signature.py'),'--artifact',out,'--trust-policy',join(keyDir,'policy.json'),'--json'],{encoding:'utf8'});
 expect(ok.status,ok.stdout+ok.stderr).toBe(0);expect(JSON.parse(ok.stdout)).toMatchObject({ok:true,keyId:'test-release-key',filesChecked:m.files.length});
 const prefix=join(keyDir,'installed'),env={...process.env,MEKONIQ_PYTHON:py};
 const installed=spawnSync('bash',['integrations/arm-controller/scripts/install-sim.sh','--prefix',prefix,'--artifact',out,'--trust-policy',join(keyDir,'policy.json')],{encoding:'utf8',env});
 expect(installed.status,installed.stdout+installed.stderr).toBe(0);
 const imported=spawnSync(py,['-c','import bridge.arbiter; import bridge.service; print("SIGNED_IMPORT_OK")'],{cwd:join(prefix,'current'),encoding:'utf8',env});
 expect(imported.status,imported.stdout+imported.stderr).toBe(0);expect(imported.stdout.trim()).toBe('SIGNED_IMPORT_OK');
 const reverified=spawnSync('bash',['integrations/arm-controller/scripts/verify-install.sh','--prefix',prefix],{encoding:'utf8',env});
 expect(reverified.status,reverified.stdout+reverified.stderr).toBe(0);
 writeFileSync(join(out,'programs/cup-pick.ngc'),'G0 X0\nM2\n');
 const bad=spawnSync(py,[join(out,'scripts/verify-signature.py'),'--artifact',out,'--trust-policy',join(keyDir,'policy.json'),'--json'],{encoding:'utf8'});
 expect(bad.status).toBe(1);expect(JSON.parse(bad.stdout).reasons).toContain('FILE_HASH_MISMATCH:programs/cup-pick.ngc');
});

test('the exporter refuses to empty a directory that is not an empty dir or a previous artifact of its own',()=>{
 const dir=mkdtempSync(join(tmpdir(),'arm-not-artifact-'));dirs.push(dir);writeFileSync(join(dir,'precious.txt'),'keep me');
 expect(()=>execFileSync(process.execPath,['scripts/export-arm-controller.mjs',dir,'--allow-dirty','--allow-unsigned'],{encoding:'utf8',stdio:'pipe'})).toThrow(/OUTPUT_DIRECTORY_NOT_EMPTY/);
 expect(readFileSync(join(dir,'precious.txt'),'utf8')).toBe('keep me');
 const {out}=exportArtifact(['--allow-unsigned']);exportArtifact(['--allow-unsigned']);                                        // a previous export of ours may be replaced
 expect(existsSync(join(out,'manifest.json'))).toBe(true);
 const m=JSON.parse(readFileSync(join(out,'manifest.json'),'utf8'));expect(m.version).toMatch(/^\d+\.\d+\.\d+\+[0-9a-f]{7}/);expect(readFileSync('integrations/arm-controller/VERSION','utf8').trim()).toBe(m.version.split('+')[0]);
});

test('without a signing key the export is marked unsigned and the verifier refuses it',()=>{
 const {out,summary}=exportArtifact(['--allow-unsigned']);
 expect(summary).toMatchObject({signed:false,keyId:'unsigned'});expect(existsSync(join(out,'manifest.sig.json'))).toBe(false);
 const r=spawnSync(py,[join(out,'scripts/verify-signature.py'),'--artifact',out,'--trust-policy','integrations/arm-controller/packaging/trust-policy.json','--json'],{encoding:'utf8'});
 expect(r.status).toBe(3);
 expect(()=>execFileSync(process.execPath,['scripts/export-arm-controller.mjs',join(tmpdir(),'x'),'--allow-dirty'],{encoding:'utf8',stdio:'pipe'})).toThrow(/SIGNING_KEY_REQUIRED/);
});
