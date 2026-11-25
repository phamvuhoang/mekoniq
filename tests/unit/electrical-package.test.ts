import {describe,expect,test} from 'vitest';
import {readFile} from 'node:fs/promises';
import {compileElectrical} from '../../packages/lab-runtime/src/engineering/electrical/compile';
import {buildHardwareCandidate,verifyHardwareCandidate} from '../../packages/lab-runtime/src/engineering/electrical/package';
import {ELECTRICAL_DOCUMENTS} from '../../packages/lab-runtime/src/engineering/electrical/documents';
import {validateHardwareCandidate,type ElectricalBundleV1} from '../../packages/lab-runtime/src/engineering/electrical/contracts';
import {loadDriveBase} from '../../packages/lab-runtime/src/engineering/electrical/documents-store';
import {shippedContext} from '../support/electrical';

const build=async(option:'serve-hw-a-v1'|'serve-hw-b-v1'|'serve-hw-c-v1'='serve-hw-c-v1')=>{
 const {context,policy,safety,catalog}=await shippedContext(option),driveBase=await loadDriveBase('robotics/simulation-mujoco/fixtures/drive-v1');
 const r=compileElectrical({design:context.design,resolved:context.resolved,project:context.project,catalog,policy,safety,driveAxisIds:['amr-1/wheel-left','amr-1/wheel-right'],schemaHash:'7'.repeat(64),driveBase});
 return {bundle:r.bundle as ElectricalBundleV1,context,policy,safety};
};
const pack=async(o:Awaited<ReturnType<typeof build>>)=>buildHardwareCandidate({bundle:o.bundle,design:o.context.design,policy:o.policy,safety:o.safety,context:o.context,drive:{changes:[],confirmed:[],manufacturerGroups:0},evidenceRefs:[{runId:'run-b',reportDigest:'a'.repeat(64),kind:'stop-report'},{runId:'run-a',reportDigest:'b'.repeat(64),kind:'stop-report'}]});
const reader=(files:{path:string;bytes:Uint8Array}[])=>{const m=new Map(files.map(f=>[f.path,f.bytes]));return {read:async(p:string)=>m.get(p)??null,list:async()=>[...m.keys()],m};};

describe('the package',()=>{
 test('a blocked bundle gives no package',async()=>{const o=await build('serve-hw-a-v1');expect(()=>buildHardwareCandidate({bundle:o.bundle,design:o.context.design,policy:o.policy,safety:o.safety,context:o.context})).toThrow('ELECTRICAL_BUNDLE_BLOCKED');});
 test('the manifest holds the three constants and the schema refuses them changed',async()=>{
  const {manifest}=await pack(await build());
  expect([manifest.status,manifest.hardwareValidated,manifest.controlAuthority]).toEqual(['draft',false,false]);
  for(const bad of [{hardwareValidated:true},{controlAuthority:true},{status:'approved'}])expect(validateHardwareCandidate({...manifest,...bad}).ok).toBe(false);
 });
 test('the files are the design, the profiles used, the register, the bundle, the seven documents, the derived drive model, its diff and the checksums; no manufacturer document',async()=>{
  const {files}=await pack(await build()),paths=files.map(f=>f.path);
  expect(paths).toEqual(expect.arrayContaining(['electrical-design.json','wiring-policy.json','safety-requirements.json','electrical-bundle.json','drive-model.derived.json','drive-model.diff.md','manifest.json','checksums.json',...ELECTRICAL_DOCUMENTS.map(d=>`documents/${d}`)]));
  expect(paths.filter(p=>p.startsWith('profiles/')).length).toBeGreaterThan(10);
  expect(paths.some(p=>/\.pdf$/i.test(p)||/^documents\/[0-9a-f]{64}$/.test(p))).toBe(false);
  expect(files.every(f=>f.bytes.length<2*1024*1024)).toBe(true);
 });
 test('readiness: bench and safety are external; each group of unverified items is pending',async()=>{
  const {manifest,files}=await pack(await build());
  expect(manifest.readiness.filter(r=>r.status==='blocked_external').map(r=>r.id)).toEqual(['bench-devices','safety-assessment']);
  expect(manifest.readiness.filter(r=>r.status==='pending').every(r=>r.id.startsWith('unverified:'))).toBe(true);expect(manifest.readiness.some(r=>r.id==='unverified:UNVERIFIED_FIRMWARE')).toBe(true);
  expect(manifest.readiness.some(r=>r.status==='ready')).toBe(false);
  expect(new TextDecoder().decode(files.find(f=>f.path==='documents/bench-checklist.md')!.bytes)).toContain('UNVERIFIED_FIRMWARE');
 });
 test('two builds are byte-identical, and vendor documents appear by id, revision, url and digest only',async()=>{
  const o=await build(),a=await pack(o),b=await pack(o);
  expect(a.files.map(f=>[f.path,Buffer.from(f.bytes).toString('base64')])).toEqual(b.files.map(f=>[f.path,Buffer.from(f.bytes).toString('base64')]));
  expect(a.manifest.documents.every(d=>/^[0-9a-f]{64}$/.test(d.digest)&&typeof d.url==='string')).toBe(true);expect(a.manifest.documents.length).toBeGreaterThanOrEqual(3);
  expect(a.manifest.evidenceRefs.map(e=>e.runId)).toEqual(['run-a','run-b']);
 });
});

describe('verification reads the bytes, not the manifest',()=>{
 test('an intact package has no problem',async()=>{const f=reader((await pack(await build())).files);expect(await verifyHardwareCandidate(f.read,f.list)).toEqual([]);});
 test('one changed byte names its file',async()=>{
  const f=reader((await pack(await build())).files),b=new Uint8Array(f.m.get('documents/wire-list.csv')!);b[10]=b[10]!^1;f.m.set('documents/wire-list.csv',b);
  expect(await verifyHardwareCandidate(f.read,f.list)).toEqual(['CHECKSUM_MISMATCH documents/wire-list.csv']);
 });
 test('a missing file, an unexpected file and a manifest turned to validated are each reported',async()=>{
  const files=(await pack(await build())).files;
  const missing=reader(files);missing.m.delete('documents/pinout.csv');expect(await verifyHardwareCandidate(missing.read,missing.list)).toContain('FILE_MISSING documents/pinout.csv');
  const extra=reader(files);extra.m.set('notes.txt',new TextEncoder().encode('x'));expect(await verifyHardwareCandidate(extra.read,extra.list)).toEqual(['FILE_UNEXPECTED notes.txt']);
  const forged=reader(files),m=JSON.parse(new TextDecoder().decode(forged.m.get('manifest.json')!));m.hardwareValidated=true;forged.m.set('manifest.json',new TextEncoder().encode(JSON.stringify(m)));
  expect(await verifyHardwareCandidate(forged.read,forged.list)).toEqual(['MANIFEST_INVALID']);
 });
 test('a manifest and checksums that agree with each other but not with the files are caught file by file',async()=>{
  const f=reader((await pack(await build())).files);f.m.set('electrical-bundle.json',new TextEncoder().encode('{}'));
  expect((await verifyHardwareCandidate(f.read,f.list)).some(p=>p.startsWith('CHECKSUM_MISMATCH electrical-bundle.json'))).toBe(true);
 });
});
void readFile;
