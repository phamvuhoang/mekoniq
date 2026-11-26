import {describe,expect,test} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {compileElectrical} from '../../packages/lab-runtime/src/engineering/electrical/compile';
import {buildHardwareCandidate,verifyHardwareCandidate} from '../../packages/lab-runtime/src/engineering/electrical/package';
import {ELECTRICAL_DOCUMENTS} from '../../packages/lab-runtime/src/engineering/electrical/documents';
import {sealElectrical,validateHardwareCandidate,type ElectricalBundleV1} from '../../packages/lab-runtime/src/engineering/electrical/contracts';
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

describe('the required set comes from the contract and the refs, not from the lists (DOC03)',()=>{
 const enc=new TextEncoder(),dec=new TextDecoder(),sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex'),json=(v:unknown)=>enc.encode(JSON.stringify(v,null,2)+'\n');
 const parse=(m:Map<string,Uint8Array>,p:string)=>JSON.parse(dec.decode(m.get(p)!));
 /** A forger who rewrites manifest.files and checksums.json so both lists agree with the files on disk. */
 const resync=(m:Map<string,Uint8Array>)=>{
  const man=parse(m,'manifest.json'),paths=[...m.keys()].filter(p=>p!=='manifest.json'&&p!=='checksums.json').sort();
  man.files=paths.map(p=>({path:p,sha256:sha(m.get(p)!),bytes:m.get(p)!.length}));m.set('manifest.json',json(man));
  m.set('checksums.json',json({algorithm:'sha256',files:Object.fromEntries([...paths,'manifest.json'].sort().map(p=>[p,sha(m.get(p)!)]))}));
 };
 const fresh=async()=>reader((await pack(await build())).files);
 test('the HW-C package with drive-model.derived.json removed from files, manifest and checksums fails',async()=>{
  const f=await fresh();f.m.delete('drive-model.derived.json');resync(f.m);
  expect(await verifyHardwareCandidate(f.read,f.list)).toContain('PACKAGE_COMPONENT_MISSING drive-model.derived.json');
 });
 test('each required component is required even when the two lists agree',async()=>{
  const f0=await fresh(),required=[...f0.m.keys()].filter(p=>p!=='manifest.json'&&p!=='checksums.json');
  expect(required.some(p=>p.startsWith('profiles/'))).toBe(true);expect(required).toContain('safety-requirements.json');
  for(const p of required){const f=await fresh();f.m.delete(p);resync(f.m);expect(await verifyHardwareCandidate(f.read,f.list)).toContain(`PACKAGE_COMPONENT_MISSING ${p}`);}
 });
 test('an extra file listed by both the manifest and the checksums is still unexpected',async()=>{
  const f=await fresh();f.m.set('notes.txt',enc.encode('x'));resync(f.m);
  expect(await verifyHardwareCandidate(f.read,f.list)).toEqual(['PACKAGE_COMPONENT_UNEXPECTED notes.txt']);
 });
 test('a file in the checksums that the manifest does not list is reported',async()=>{
  const f=await fresh(),man=parse(f.m,'manifest.json');man.files=man.files.filter((x:{path:string})=>x.path!=='drive-model.diff.md');f.m.set('manifest.json',json(man));
  const sums=parse(f.m,'checksums.json');sums.files['manifest.json']=sha(f.m.get('manifest.json')!);f.m.set('checksums.json',json(sums));
  expect(await verifyHardwareCandidate(f.read,f.list)).toContain('MANIFEST_DOES_NOT_LIST drive-model.diff.md');
 });
 test('a design whose revision differs from the one the bundle compiled is caught',async()=>{
  const f=await fresh(),d=parse(f.m,'electrical-design.json');d.revision+=1;f.m.set('electrical-design.json',json(d));resync(f.m);
  const p=await verifyHardwareCandidate(f.read,f.list);
  expect(p).toContain('DESIGN_DISAGREES_WITH_BUNDLE electrical-design.json');
 });
 test('a manifest naming another design revision is caught',async()=>{
  const f=await fresh(),man=parse(f.m,'manifest.json');man.bundle.designRevision+=1;f.m.set('manifest.json',json(man));resync(f.m);
  expect(await verifyHardwareCandidate(f.read,f.list)).toContain('MANIFEST_DISAGREES_WITH_BUNDLE designRevision');
 });
 test('a tampered profile is caught even with both lists resynced',async()=>{
  const f=await fresh(),path=[...f.m.keys()].find(p=>p.startsWith('profiles/'))!,pr=parse(f.m,path);pr.revision+=1;f.m.set(path,json(pr));resync(f.m);
  expect(await verifyHardwareCandidate(f.read,f.list)).toContain(`PROFILE_DISAGREES_WITH_BUNDLE ${path}`);
 });
 test('a drive model other than the bundle draft, a tampered document, a bundle edited without re-sealing and a re-sealed bundle naming another policy are caught',async()=>{
  const drive=await fresh(),dm=parse(drive.m,'drive-model.derived.json');dm.revision=(dm.revision??0)+1;drive.m.set('drive-model.derived.json',json(dm));resync(drive.m);
  expect(await verifyHardwareCandidate(drive.read,drive.list)).toContain('DRIVE_MODEL_DISAGREES_WITH_BUNDLE drive-model.derived.json');
  const doc=await fresh(),b=new Uint8Array(doc.m.get('documents/wire-list.csv')!);b[10]=b[10]!^1;doc.m.set('documents/wire-list.csv',b);resync(doc.m);
  expect(await verifyHardwareCandidate(doc.read,doc.list)).toContain('DOCUMENT_DISAGREES_WITH_BUNDLE documents/wire-list.csv');
  const bun=await fresh(),bb=parse(bun.m,'electrical-bundle.json');bb.inputs.wiringPolicyDigest='0'.repeat(64);bun.m.set('electrical-bundle.json',json(bb));resync(bun.m);
  expect(await verifyHardwareCandidate(bun.read,bun.list)).toContain('BUNDLE_DIGEST_MISMATCH electrical-bundle.json');
  const res=await fresh(),rb=parse(res.m,'electrical-bundle.json');rb.inputs.wiringPolicyDigest='0'.repeat(64);delete rb.digest;const sealed=sealElectrical(rb);res.m.set('electrical-bundle.json',json(sealed));
  const man=parse(res.m,'manifest.json');man.bundle.digest=sealed.digest;res.m.set('manifest.json',json(man));resync(res.m);
  const rp=await verifyHardwareCandidate(res.read,res.list);
  expect(rp).toContain('WIRING_POLICY_DISAGREES_WITH_BUNDLE wiring-policy.json');expect(rp).toContain('DOCUMENT_DISAGREES_WITH_BUNDLE documents/io-allocation.md');
 });
 test('the Lab static sample package verifies',async()=>{
  const root='apps/lab/public/samples/hardware-candidate',{readdir}=await import('node:fs/promises');
  const files=(await readdir(root,{recursive:true,withFileTypes:true})).filter(e=>e.isFile()).map(e=>`${e.parentPath}/${e.name}`.slice(root.length+1));
  expect(await verifyHardwareCandidate(async p=>files.includes(p)?new Uint8Array(await readFile(`${root}/${p}`)):null,async()=>files)).toEqual([]);
 });
});
void readFile;
