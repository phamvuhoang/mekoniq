// R5 hardware candidate package (spec R5-A 8): a folder for two people in two cities to talk about one configuration before anything is bought. A pure function of the compiled bundle, the design, the profiles it used
// and the register. Draft, not validated on hardware, no control authority: three constants the schema holds. No manufacturer document blob is copied (their licence is unreviewed); only id, revision, url and digest.
import {createHash} from 'node:crypto';
import {hashJson} from '../../v2/hash';
import type {DesignContext} from './design';
import type {DriveChange,DriveConfirmation} from './drive-derivation';
import {renderElectricalDocuments,ELECTRICAL_DOCUMENTS} from './documents';
import {electricalDigest,validateElectricalBundle,validateHardwareCandidate,type DeviceProfileV1,type ElectricalBundleV1,type ElectricalDesignV1,type HardwareCandidateV1,type SafetyRequirementsV1,type WiringPolicyV1} from './contracts';

const enc=new TextEncoder(),dec=new TextDecoder(),sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const json=(v:unknown)=>enc.encode(JSON.stringify(v,null,2)+'\n');
const cmp=(a:string,b:string)=>a<b?-1:a>b?1:0;
export const PACKAGE_FIXED_FILES=['manifest.json','checksums.json'] as const;
export interface EvidenceRef{runId:string;reportDigest:string;kind:'stop-report'|'io-fault-report'}

export function buildHardwareCandidate(input:{bundle:ElectricalBundleV1;design:ElectricalDesignV1;policy:WiringPolicyV1;safety:SafetyRequirementsV1|null;context:Pick<DesignContext,'profiles'>;
 drive?:{changes:readonly DriveChange[];confirmed:readonly DriveConfirmation[];manufacturerGroups:number};evidenceRefs?:readonly EvidenceRef[]}):{files:{path:string;bytes:Uint8Array}[];manifest:HardwareCandidateV1}{
 const {bundle,design}=input;
 if(bundle.state!=='compiled')throw new Error('ELECTRICAL_BUNDLE_BLOCKED');
 if(bundle.driveModelDraft===null)throw new Error('DRIVE_MODEL_DRAFT_MISSING');
 const files:{path:string;bytes:Uint8Array}[]=[{path:'electrical-design.json',bytes:json(design)},{path:'wiring-policy.json',bytes:json(input.policy)},{path:'electrical-bundle.json',bytes:json(bundle)}];
 if(input.safety)files.push({path:'safety-requirements.json',bytes:json(input.safety)});
 const used=[...new Map([...input.context.profiles.values()].map(p=>[p.id,p])).values()].sort((a,b)=>cmp(a.id,b.id));
 for(const p of used)files.push({path:`profiles/${p.id}.json`,bytes:json(p)});
 for(const d of renderElectricalDocuments(bundle,input.context.profiles))files.push({path:`documents/${d.path}`,bytes:d.bytes});
 files.push({path:'drive-model.derived.json',bytes:json(bundle.driveModelDraft)});
 const d=input.drive;
 files.push({path:'drive-model.diff.md',bytes:enc.encode(['# Drive model derived from the profiles','',`Manufacturer-sourced groups: ${d?.manufacturerGroups??0} of 7.`,'',
  '| Axis | Field | From | To | Source |','|---|---|---|---|---|',...(d?.changes??[]).map(c=>`| ${c.axisId} | ${c.field} | ${String(c.from)} | ${String(c.to)} | ${c.source.documentId} / ${c.source.locator} |`),
  ...(d?.changes.length?[]:['| (none) | | | | no field of the base model changed |']),'','Confirmed by a document (value unchanged, source improved):','',...(d?.confirmed.length?d.confirmed.map(c=>`- ${c.axisId} ${c.field}: ${c.source.documentId} / ${c.source.locator}`):['- none']),'',
  '_Generated from design data; it does not replace electrical measurement or a safety assessment._'].join('\n')+'\n')});
 files.sort((a,b)=>cmp(a.path,b.path));
 const unverified=new Map<string,number>();for(const c of bundle.checks)if(c.level==='unverified')unverified.set(c.ruleId,(unverified.get(c.ruleId)??0)+1);
 const manifest:HardwareCandidateV1={schemaVersion:1,documentType:'hardware-candidate',status:'draft',hardwareValidated:false,controlAuthority:false,
  bundle:{digest:bundle.digest,designId:design.id,designRevision:design.revision,projectDigest:bundle.inputs.project.digest,assemblyDigest:bundle.inputs.assemblyDigest},
  files:files.map(f=>({path:f.path,sha256:sha(f.bytes),bytes:f.bytes.length})),
  readiness:[{id:'bench-devices',status:'blocked_external',reason:'G-BENCH1: no device of this configuration has been measured on a bench'},{id:'safety-assessment',status:'blocked_external',reason:'G-SAFE1: risk assessment, design and testing of the safety functions are done by a qualified person and signed; nothing here replaces that'},
   ...[...unverified].sort((a,b)=>cmp(a[0],b[0])).map(([rule,n])=>({id:`unverified:${rule}`,status:'pending' as const,reason:`${n} item(s); see documents/bench-checklist.md`}))],
  evidenceRefs:[...input.evidenceRefs??[]].sort((a,b)=>cmp(a.runId,b.runId)),
  documents:used.flatMap(p=>p.documents.map(x=>({deviceProfile:p.id,id:x.id,revision:x.revision,url:x.url,digest:x.digest})))};
 const check=validateHardwareCandidate(manifest);if(!check.ok)throw new Error('HARDWARE_CANDIDATE_INVALID '+check.problems.map(p=>p.code).join(','));
 const manifestBytes=json(manifest),all=[...files,{path:'manifest.json',bytes:manifestBytes}].sort((a,b)=>cmp(a.path,b.path));
 const checksums=json({algorithm:'sha256',files:Object.fromEntries(all.map(f=>[f.path,sha(f.bytes)]))});
 return {files:[...all,{path:'checksums.json',bytes:checksums}].sort((a,b)=>cmp(a.path,b.path)),manifest};
}

/** Reads the package back from its bytes: nothing in the manifest is believed. The required set comes from the contract and the bundle's refs, not from the
 * two lists, and every component is tied to the bundle by digest. Returns the problems; an empty list is a pass. */
export async function verifyHardwareCandidate(read:(path:string)=>Promise<Uint8Array|null>,list:()=>Promise<string[]>):Promise<string[]>{
 const problems:string[]=[],manifestBytes=await read('manifest.json'),sumBytes=await read('checksums.json');
 if(!manifestBytes)return ['FILE_MISSING manifest.json'];
 let manifest:HardwareCandidateV1;
 try{manifest=JSON.parse(dec.decode(manifestBytes)) as HardwareCandidateV1;}catch{return ['MANIFEST_INVALID'];}
 if(!validateHardwareCandidate(manifest).ok)return ['MANIFEST_INVALID'];
 if(!sumBytes)return ['FILE_MISSING checksums.json'];
 let sums:{algorithm?:string;files?:Record<string,string>};
 try{sums=JSON.parse(dec.decode(sumBytes));}catch{return ['CHECKSUMS_INVALID'];}
 const want=new Map<string,string>(Object.entries(sums.files??{}));
 const declared=new Map(manifest.files.map(f=>[f.path,f]));
 const good=new Map<string,Uint8Array>();                                                  // files whose bytes match both lists
 for(const f of manifest.files)if(want.get(f.path)!==f.sha256)problems.push(`CHECKSUM_DISAGREES_WITH_MANIFEST ${f.path}`);
 for(const path of [...want.keys()].sort(cmp))if(path!=='manifest.json'&&!declared.has(path))problems.push(`MANIFEST_DOES_NOT_LIST ${path}`);
 for(const [path,digest] of [...want].sort((a,b)=>cmp(a[0],b[0]))){
  const bytes=await read(path);
  if(!bytes){problems.push(`FILE_MISSING ${path}`);continue;}
  const d=declared.get(path);
  if(sha(bytes)!==digest)problems.push(`CHECKSUM_MISMATCH ${path}`);else if(d&&d.bytes!==bytes.length)problems.push(`SIZE_MISMATCH ${path}`);else if(path==='manifest.json'||d?.sha256===digest)good.set(path,bytes);
 }
 if(!want.has('manifest.json'))problems.push('FILE_MISSING manifest.json in checksums');
 for(const path of (await list()).sort(cmp))if(path!=='checksums.json'&&!want.has(path))problems.push(`FILE_UNEXPECTED ${path}`);
 const doc=<T>(path:string):T|null=>{const b=good.get(path);if(!b)return null;try{return JSON.parse(dec.decode(b)) as T;}catch{problems.push(`JSON_INVALID ${path}`);return null;}};
 // the bundle and what it names
 let bundle=doc<ElectricalBundleV1>('electrical-bundle.json');
 if(bundle&&!validateElectricalBundle(bundle).ok){problems.push('BUNDLE_INVALID electrical-bundle.json');bundle=null;}
 else if(bundle&&electricalDigest(bundle)!==bundle.digest){problems.push('BUNDLE_DIGEST_MISMATCH electrical-bundle.json');bundle=null;}
 const design=doc<ElectricalDesignV1>('electrical-design.json');
 const required=new Set<string>(['electrical-design.json','wiring-policy.json','electrical-bundle.json','drive-model.derived.json','drive-model.diff.md',...ELECTRICAL_DOCUMENTS.map(f=>`documents/${f}`),
  ...(bundle?.inputs.profiles??[]).map(p=>`profiles/${p.id}.json`),...(design?.devices??[]).map(d=>`profiles/${d.profile.id}.json`),...(bundle?.inputs.safetyRequirementsDigest||design?.safetyRequirementsRef?['safety-requirements.json']:[])]);
 for(const path of [...required].sort(cmp))if(!want.has(path))problems.push(`PACKAGE_COMPONENT_MISSING ${path}`);
 for(const path of [...want.keys()].sort(cmp))if(path!=='manifest.json'&&!required.has(path))problems.push(`PACKAGE_COMPONENT_UNEXPECTED ${path}`);
 if(!bundle)return problems;
 if(bundle.state!=='compiled')problems.push('BUNDLE_NOT_COMPILED electrical-bundle.json');
 const m=manifest.bundle,i=bundle.inputs;
 for(const [field,ok] of [['digest',m.digest===bundle.digest],['designId',m.designId===i.design.id],['designRevision',m.designRevision===i.design.revision],['projectDigest',m.projectDigest===i.project.digest],['assemblyDigest',m.assemblyDigest===i.assemblyDigest]] as const)if(!ok)problems.push(`MANIFEST_DISAGREES_WITH_BUNDLE ${field}`);
 const sealed=(path:string,digest:string|null)=>{const d=doc<{digest?:string}>(path);return d!==null&&d.digest===digest&&electricalDigest(d)===digest;};
 const designOk=!!design&&sealed('electrical-design.json',i.design.digest)&&design.id===i.design.id&&design.revision===i.design.revision;
 if(design&&!designOk)problems.push('DESIGN_DISAGREES_WITH_BUNDLE electrical-design.json');
 if(good.has('wiring-policy.json')&&!sealed('wiring-policy.json',i.wiringPolicyDigest))problems.push('WIRING_POLICY_DISAGREES_WITH_BUNDLE wiring-policy.json');
 if(i.safetyRequirementsDigest&&good.has('safety-requirements.json')&&!sealed('safety-requirements.json',i.safetyRequirementsDigest))problems.push('SAFETY_REQUIREMENTS_DISAGREE_WITH_BUNDLE safety-requirements.json');
 const byId=new Map<string,DeviceProfileV1>();let profilesOk=true;
 for(const e of i.profiles){
  const path=`profiles/${e.id}.json`,p=doc<DeviceProfileV1>(path);
  if(!p){profilesOk=false;continue;}
  if(byId.has(e.id)||p.id!==e.id||p.revision!==e.revision||!sealed(path,e.digest)){problems.push(`PROFILE_DISAGREES_WITH_BUNDLE ${path}`);profilesOk=false;continue;}
  byId.set(e.id,p);
 }
 const drive=doc<unknown>('drive-model.derived.json');
 if(good.has('drive-model.derived.json')&&(bundle.driveModelDraft===null||drive===null||hashJson(drive)!==hashJson(bundle.driveModelDraft)))problems.push('DRIVE_MODEL_DISAGREES_WITH_BUNDLE drive-model.derived.json');
 // the documents and the vendor document list are functions of the bundle and the profiles: rebuild and compare
 if(designOk&&profilesOk&&bundle.state==='compiled'&&design.devices.every(d=>byId.has(d.profile.id))){
  for(const d of renderElectricalDocuments(bundle,new Map(design.devices.map(x=>[x.id,byId.get(x.profile.id)!])))){const b=good.get(`documents/${d.path}`);if(b&&Buffer.compare(Buffer.from(b),Buffer.from(d.bytes))!==0)problems.push(`DOCUMENT_DISAGREES_WITH_BUNDLE documents/${d.path}`);}
  const docs=[...byId.values()].sort((a,b)=>cmp(a.id,b.id)).flatMap(p=>p.documents.map(x=>({deviceProfile:p.id,id:x.id,revision:x.revision,url:x.url,digest:x.digest})));
  if(hashJson(docs)!==hashJson(manifest.documents))problems.push('MANIFEST_DISAGREES_WITH_BUNDLE documents');
 }
 return problems;
}
