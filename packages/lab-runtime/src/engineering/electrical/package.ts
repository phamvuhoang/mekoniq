// R5 hardware candidate package (spec R5-A 8): a folder for two people in two cities to talk about one configuration before anything is bought. A pure function of the compiled bundle, the design, the profiles it used
// and the register. Draft, not validated on hardware, no control authority: three constants the schema holds. No manufacturer document blob is copied (their licence is unreviewed); only id, revision, url and digest.
import {createHash} from 'node:crypto';
import {hashJson} from '../../v2/hash';
import type {DesignContext} from './design';
import type {DriveChange,DriveConfirmation} from './drive-derivation';
import {renderElectricalDocuments,ELECTRICAL_DOCUMENTS} from './documents';
import {validateHardwareCandidate,type ElectricalBundleV1,type ElectricalDesignV1,type HardwareCandidateV1,type SafetyRequirementsV1,type WiringPolicyV1} from './contracts';

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

/** Reads the package back from its bytes: nothing in the manifest is believed. Returns the problems; an empty list is a pass. */
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
 for(const f of manifest.files)if(want.get(f.path)!==f.sha256)problems.push(`CHECKSUM_DISAGREES_WITH_MANIFEST ${f.path}`);
 for(const [path,digest] of [...want].sort((a,b)=>cmp(a[0],b[0]))){
  const bytes=await read(path);
  if(!bytes){problems.push(`FILE_MISSING ${path}`);continue;}
  if(sha(bytes)!==digest)problems.push(`CHECKSUM_MISMATCH ${path}`);
  const d=declared.get(path);if(d&&d.bytes!==bytes.length)problems.push(`SIZE_MISMATCH ${path}`);
 }
 if(!want.has('manifest.json'))problems.push('FILE_MISSING manifest.json in checksums');
 for(const path of (await list()).sort(cmp))if(path!=='checksums.json'&&!want.has(path))problems.push(`FILE_UNEXPECTED ${path}`);
 for(const f of ELECTRICAL_DOCUMENTS)if(!want.has(`documents/${f}`))problems.push(`FILE_MISSING documents/${f}`);
 void hashJson;
 return problems;
}
