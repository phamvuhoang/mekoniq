/** Portable refusal checks. Synthetic records and ephemeral TEST-ONLY keys never enter a live path. */
import {spawnSync} from 'node:child_process';
import {webcrypto} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect,test} from 'vitest';
import {canonicalBytes} from '../../packages/contracts/src/canonical';
import type {RobotManifest} from '../../packages/contracts/src/index';
import {assessTargetDossier} from '../../packages/lab-runtime/src/commissioning/target-dossier';
import {VendorSdkAdapter,type VendorSdk} from '../../packages/robot-adapters/src/vendor/sdk-adapter';
import {untestedCoverage,type VendorProfile} from '../../packages/robot-adapters/src/vendor/profile';
import {Vda5050Adapter,type Vda5050Transport} from '../../packages/robot-adapters/src/vda5050/adapter';
import {preparedDossierFixture,undecidedDossierFixture} from '../fixtures/physical-target-dossier';
const python=process.env.MEKONIQ_COMMISSIONING_PYTHON??(existsSync('.venv/bin/python')?resolve('.venv/bin/python'):'python3');
function commissioned(record:unknown,key:unknown=null) {
 const result=spawnSync(python,['-c',"import json,sys; from commissioning import validate_commissioning; x=json.load(sys.stdin); print(json.dumps(validate_commissioning(x['record'],target_payload_kg=20,commissioning_key=x['key']).as_json()))"],{input:JSON.stringify({record,key}),encoding:'utf8',timeout:15000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTEST_ADDOPTS:'-p no:cacheprovider',PYTHONPATH:'tests/hardware:robotics/agent'}});
 expect(result.status,result.stdout+result.stderr).toBe(0);return JSON.parse(result.stdout) as {status:string;manifest_accepted:boolean;reasons:string[]};
}
test('undecided cannot enter the authoritative chassis commissioner',()=>{
 const dossier=undecidedDossierFixture();expect(assessTargetDossier(dossier).readiness).toBe('incomplete');
 expect(commissioned(dossier)).toMatchObject({status:'integration_tested',manifest_accepted:false,reasons:['SCHEMA_INVALID']});
});
test.each(['vendor','firmware','sdk','serial'])('unknown %s cannot promote physical validation',field=>{
 const dossier=preparedDossierFixture();dossier.identity[field]=null;
 expect(assessTargetDossier(dossier).missing).toContain(`identity.${field}`);
 expect(commissioned(dossier)).toMatchObject({status:'integration_tested',manifest_accepted:false});
});
test.each(['calibration','observer','signature'])('missing %s never becomes physical qualification',field=>{
 const dossier=preparedDossierFixture();dossier.prerequisites[field]=null;
 expect(assessTargetDossier(dossier).readiness).toBe('incomplete');
 expect(commissioned(dossier)).toMatchObject({status:'integration_tested',manifest_accepted:false});
});
test('the L03 synthetic simulation model selector is not a physical serial',()=>{
 const dossier=preparedDossierFixture();dossier.identity.serial!.value='XI13050520BB00';
 expect(assessTargetDossier(dossier)).toMatchObject({readiness:'incomplete',missing:expect.arrayContaining(['identity.serial'])});
});
test('owner assertions cannot replace vendor or measured identity',()=>{
 const dossier=preparedDossierFixture();dossier.identity.firmware!.sourceKind='owner';
 expect(assessTargetDossier(dossier)).toMatchObject({structurallyValid:false,readiness:'incomplete'});
});
test('a valid ES256/JCS signature on simulated geometry cannot earn hardware_validated',async()=>{
 const record=JSON.parse(readFileSync('tests/fixtures/hardware/commissioning-complete.json','utf8'));
 record.geometry.illustrative=true;record.manifest.validation='hardware_validated';
 const keys=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const key={...await webcrypto.subtle.exportKey('jwk',keys.publicKey),kid:'TEST-ONLY-L05-ephemeral',alg:'ES256'};
 const signature=await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},keys.privateKey,canonicalBytes(record));
 record.signature={keyId:key.kid,alg:'ES256',value:Buffer.from(signature).toString('base64url')};
 const result=commissioned(record,key);
 expect(result).toMatchObject({status:'integration_tested',manifest_accepted:false});
 expect(result.reasons).toEqual(expect.arrayContaining(['GEOMETRY_ILLUSTRATIVE','CLAIM_EXCEEDS_EVIDENCE']));
 expect(result.reasons).not.toContain('MANIFEST_SIGNATURE_INVALID');
 // Unsigned, tampered and wrong-key behavior remains covered by the existing Python authority suite.
});
test.each(['xarm_ros2','custom_linuxcnc'] as const)('prepared %s documents cannot be passed as chassis evidence',branch=>{
 const dossier=preparedDossierFixture(branch);expect(assessTargetDossier(dossier).readiness).toBe('prepared');
 expect(commissioned(dossier)).toMatchObject({status:'integration_tested',manifest_accepted:false});
});
test.each(['hardware_validated','venue_approved'] as const)('prepared references cannot bypass existing %s adapter refusals',validation=>{
 const dossier=preparedDossierFixture();expect(assessTargetDossier(dossier).readiness).toBe('prepared');
 const manifest={id:'TEST-ONLY',adapter:'vendor-sdk',protocolVersion:'TEST-ONLY@1',firmware:'TEST-ONLY',capabilities:['delivery'],mapId:'test',mapRevision:'1',offlineExecution:false,maxLoadMinor:'1',trays:1,validation,targetKind:'vendor'} as RobotManifest;
 const profile:VendorProfile={id:'TEST-ONLY',sdkName:'TEST-ONLY',sdkVersion:'1',firmware:'TEST-ONLY',nativeCommandIdentity:'caller-supplied',licence:{redistributable:false,reviewRef:'TEST-ONLY'},coverage:untestedCoverage()};
 const sdk:VendorSdk={async navigate(){throw new Error('NO_PHYSICAL_IO');},onEvent(){throw new Error('NO_PHYSICAL_IO');}};
 const transport:Vda5050Transport={async publish(){throw new Error('NO_PHYSICAL_IO');},subscribe(){throw new Error('NO_PHYSICAL_IO');}};
 expect(()=>new VendorSdkAdapter(manifest,sdk,profile)).toThrow('VALIDATION_LEVEL_NOT_EARNED');
 expect(()=>new Vda5050Adapter({...manifest,adapter:'vda5050',protocolVersion:'2.0.0'},transport,{identity:{manufacturer:'TEST-ONLY',serialNumber:'TEST-ONLY'}})).toThrow('VALIDATION_LEVEL_NOT_EARNED');
});
test('active motion still refuses even explicit target, observer and test area',()=>{
 const result=spawnSync(python,['tests/hardware/commissioning.py','active-motion','--target','TEST-ONLY','--observer','TEST-ONLY','--test-area','TEST-ONLY'],{encoding:'utf8',timeout:15000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONPATH:'robotics/agent'}});
 expect(result.status,result.stdout+result.stderr).toBe(2);expect(result.stderr).toContain('VENDOR_INTERFACE_NOT_PROVIDED');
});
