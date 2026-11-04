import {expect,test} from 'vitest';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {profileEligible,profileProblems,profileIsEligible,loadEnabledProfiles,catalog,type IntegrationProfile} from '../../integrations/core/src/profile';
import {connectorProfiles} from '../../integrations/core/src/connector';
import {createProviderRig,loadFixture,fixtureHash,registerRigKind} from '../support/provider-rig';
const base:IntegrationProfile={id:'acme-pay',kind:'payment',label:'Acme Pay',mode:'sandbox',status:'draft',requiredInputs:[],evidence:{sandbox:null,production:null}};
const ev={ref:'docs/implementation/evidence/acme-sandbox.md',sha256:'a'.repeat(64),at:'2026-11-04'};
const full:IntegrationProfile={...base,mode:'production',status:'production_approved',adapter:'integrations/payments/src/acme.ts#AcmeAdapter',
 provider:{name:'Acme',docsUrl:'https://docs.acme.example/v3',apiVersion:'3.1'},webhook:{signatureScheme:'hmac-sha256',signedFields:['timestamp','body'],timestampToleranceSeconds:300,eventIdField:'id'},idempotency:{keyField:'orderRef'},credentialRefs:['ACME_API_KEY'],evidence:{sandbox:ev,production:ev}};
test('a placeholder sandbox connector is not production eligible',()=>{
 expect(profileEligible({mode:'simulation',schemaValidated:true,sandboxEvidence:null,productionEvidence:null})).toBe(false);
 expect(profileEligible({mode:'production',schemaValidated:true,sandboxEvidence:'s',productionEvidence:null})).toBe(false);
 expect(profileEligible({mode:'production',schemaValidated:false,sandboxEvidence:'s',productionEvidence:'p'})).toBe(false);
 expect(profileEligible({mode:'production',schemaValidated:true,sandboxEvidence:'s',productionEvidence:'p'})).toBe(true);
});
test('a complete production profile is accepted; every missing piece of documentation or evidence is reported, nothing is guessed',()=>{
 expect(profileProblems(full)).toEqual([]);expect(profileIsEligible(full)).toBe(true);
 const gaps=(over:object)=>profileProblems({...full,...over});
 expect(gaps({provider:undefined}).join()).toMatch(/provider/);
 expect(gaps({webhook:undefined}).join()).toMatch(/webhook/);
 expect(gaps({idempotency:undefined}).join()).toMatch(/idempotency/);
 expect(gaps({adapter:undefined}).join()).toMatch(/adapter/);
 expect(gaps({provider:{name:'Acme',docsUrl:'http://insecure',apiVersion:'1'}}).length).toBeGreaterThan(0);
 expect(gaps({evidence:{sandbox:ev,production:null}}).join()).toMatch(/production evidence/);
 expect(gaps({evidence:{sandbox:null,production:null}}).join()).toMatch(/sandbox/);
 expect(gaps({credentialRefs:['not a name with spaces or a secret value']}).length).toBeGreaterThan(0); // refs are names, never values
 expect(profileProblems({...full,surprise:1}).length).toBeGreaterThan(0);
 expect(profileProblems({...full,kind:'robot-protocol',webhook:undefined,idempotency:undefined}).join()).toMatch(/version/);
 expect(profileIsEligible({...full,evidence:{sandbox:ev,production:null}})).toBe(false);
});
test('an emulator can never be verified or approved: fake profiles cannot release',()=>{
 const sim={...full,mode:'simulation' as const};
 expect(profileProblems(sim).join()).toMatch(/simulation profile can never be verified/);expect(profileIsEligible(sim)).toBe(false);
 expect(loadEnabledProfiles([sim],'release')).toEqual([]);expect(loadEnabledProfiles([sim],'sandbox')).toEqual([]);
 const contract:IntegrationProfile={...base,id:'sim-pay',mode:'simulation',status:'contract_tested'};
 expect(loadEnabledProfiles([contract],'release')).toEqual([]); // nothing simulated runs in a release
 expect(loadEnabledProfiles([contract],'sandbox').map(p=>p.id)).toEqual(['sim-pay']);
 expect(loadEnabledProfiles([base],'sandbox')).toEqual([]); // a draft is never enabled
});
test('the shipped catalog is valid, has no production profile without evidence, and its draft profiles list what a person must still supply',()=>{
 for(const p of catalog)expect(profileProblems(p),p.id).toEqual([]);
 expect(new Set(catalog.map(p=>p.id)).size).toBe(catalog.length);
 expect(loadEnabledProfiles(catalog,'release')).toEqual([]); // nothing is production approved yet
 for(const p of catalog.filter(p=>p.status==='draft'))expect(p.requiredInputs.length,p.id).toBeGreaterThan(0);
 expect(catalog.filter(p=>p.mode==='production'||p.evidence.sandbox||p.evidence.production)).toEqual([]);
 expect(loadEnabledProfiles(catalog,'sandbox').every(p=>p.mode!=='production')).toBe(true);
});
test('the provider rig fails its prerequisite instead of skipping when no profile or simulator exists',async()=>{
 await expect(createProviderRig('einvoice')).rejects.toThrow('PREREQUISITE');
 registerRigKind('channel',async()=>({ping:()=>true}));
 await expect(createProviderRig('channel',{profileId:'no-such-profile'})).rejects.toThrow('PREREQUISITE');
 await expect(createProviderRig('channel',{profiles:[{...base,kind:'channel'}]})).rejects.toThrow('PREREQUISITE: no enabled "channel" profile'); // a draft does not count
 const rig=await createProviderRig('channel');
 try{expect(rig.emulated).toBe(true);expect(rig.profile.mode).toBe('simulation');expect(rig.callCount('x')).toBe(0);expect((rig as unknown as {ping:()=>boolean}).ping()).toBe(true);}finally{await rig.close();}
});
test('fixtures must carry redacted provenance and an intact hash',()=>{
 const dir=mkdtempSync(join(tmpdir(),'fx-')),body={event:'paid',amount:'100'};
 const write=(name:string,file:object)=>writeFileSync(join(dir,name+'.json'),JSON.stringify(file));
 write('ok',{provenance:{kind:'emulated',redacted:true,sha256:fixtureHash(body),source:'unit test'},body});
 expect(loadFixture('ok',dir)).toMatchObject({kind:'emulated',body});
 write('edited',{provenance:{kind:'recorded',redacted:true,sha256:fixtureHash(body),source:'trace 1'},body:{...body,amount:'1'}});
 expect(()=>loadFixture('edited',dir)).toThrow('FIXTURE_HASH_MISMATCH');
 write('bare',{body});expect(()=>loadFixture('bare',dir)).toThrow('FIXTURE_PROVENANCE_MISSING');
 write('raw',{provenance:{kind:'recorded',redacted:false,sha256:fixtureHash(body),source:'trace'},body});expect(()=>loadFixture('raw',dir)).toThrow('FIXTURE_PROVENANCE_MISSING');
});
test('the channel connector registry agrees with the catalog: only profiles the catalog enables may run',()=>{
 const runnable=new Set(loadEnabledProfiles(catalog,'sandbox').map(p=>p.id));
 for(const c of Object.values(connectorProfiles)){
  const entry=catalog.find(p=>p.id===c.id);expect(entry?.kind,c.id).toBe('channel');
  expect(c.enabled,c.id).toBe(runnable.has(c.id));expect(c.certified,c.id).toBe(false); // nothing is production-approved
 }
});
