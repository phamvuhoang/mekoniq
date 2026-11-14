// Record validation only. Neither declared provenance nor matching hashes authenticate a host.
import Ajv from 'ajv';
import schema from '../../packages/contracts/schemas/native-handoff-v1.schema.json' with {type:'json'};
import {cpus,platform,arch,release} from 'node:os';
import {readFile} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
const ajv=new Ajv({strict:true});ajv.addSchema(schema);
const validProfile=ajv.compile({$ref:'native-handoff-v1.schema.json#/definitions/HandoffProfile'}),validSubject=ajv.compile({$ref:'native-handoff-v1.schema.json#/definitions/HandoffSubject'});
export const isSha256=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const nonempty=v=>typeof v==='string'&&v.length>0;
export function nativeInventoryIssues(value,expected){
 const issues=[],add=(code,path)=>issues.push({code,path,severity:'prerequisite'}),p=expected?.profile,s=expected?.subject;
 if(!validProfile(p)||!validSubject(s)){add('LOCKED_PROFILE_REQUIRED','/profile');return issues;}
 const names=p.requiredPackages.map(x=>x.name);if(new Set(names).size!==names.length||names.some(x=>p.forbiddenPackages.includes(x)))add('PROFILE_PACKAGE_CONFLICT','/profile');
 for(const [i,lock]of p.requiredPackages.entries())if(!nonempty(lock?.name)||!nonempty(lock.version)||!isSha256(lock.sha256)||/[<>*~^]|latest|unresolved/i.test(lock.version))add('PACKAGE_LOCK_UNRESOLVED',`/profile/requiredPackages/${i}`);
 const installation=p.installation;
 if((s.executionKind==='mujoco_image')!==(installation.kind==='oci'))add('INSTALLATION_PROFILE_MISMATCH','/profile/installation');
 if(installation.kind==='native_apt'){
  const ids=installation.sources.map(x=>x.id),mapped=installation.packageSources.map(x=>x.name);
  if(new Set(ids).size!==ids.length||new Set(mapped).size!==mapped.length||mapped.length!==names.length||installation.packageSources.some(x=>!names.includes(x.name)||!ids.includes(x.sourceId)))add('SOURCE_PACKAGE_MAPPING_INVALID','/profile/installation');
  for(const source of installation.sources)if(!isSha256(source.sha256))add('SOURCE_LOCK_UNRESOLVED','/profile/installation/sources');
  if(s.image!==null)add('INSTALLATION_PROFILE_MISMATCH','/subject/image');
 }
 if(installation.kind==='oci'&&(!s.image||s.image.platform!==`linux/${p.architecture}`||!/^sha256:[a-f0-9]{64}$/.test(s.image.manifestDigest)||!/^sha256:[a-f0-9]{64}$/.test(s.image.configDigest)))add('SUBJECT_IMAGE_UNRESOLVED','/subject/image');
 if(value===undefined){add('HOST_INVENTORY_MISSING','/inventory');return issues;}
 if(!object(value)){add('HOST_INVENTORY_INVALID','/inventory');return issues;}
 const v=value;
 if(v.schemaVersion!==1||!object(v.cpu)||!nonempty(v.cpu.model)||!Number.isInteger(v.cpu.cores)||v.cpu.cores<1||!nonempty(v.os?.kernel))add('HOST_INVENTORY_INVALID','/inventory');
 if(v.architecture!==p.architecture)add('HOST_ARCH_MISMATCH','/inventory/architecture');
 if(v.os?.platform!=='linux'||v.os?.id!==p.os?.id||v.os?.version!==p.os?.version)add('HOST_OS_MISMATCH','/inventory/os');
 if(v.profileId!==p.id||v.modelId!==p.modelId||v.modelSha256!==p.modelSha256)add('HOST_PROFILE_MISMATCH','/inventory/profileId');
 if(!isDeepStrictEqual(v.subject,s))add('HOST_SUBJECT_MISMATCH','/inventory/subject');
 if(!isDeepStrictEqual(v.installation,installation))add('HOST_INSTALLATION_MISMATCH','/inventory/installation');
 if(!isDeepStrictEqual(v.image,s.image))add('HOST_IMAGE_MISMATCH','/inventory/image');
 const o=v.provenance;
 if(!object(o)||o.origin!=='linux_native'||o.hostOs!=='linux'||o.hostArchitecture!==p.architecture||!['bare_metal','vm','container'].includes(o.virtualization)||o.emulation!=='none'||!nonempty(o.evidencePath)||!isSha256(o.evidenceSha256))add('HOST_PROVENANCE_UNRESOLVED','/inventory/provenance');
 if(!Array.isArray(v.software)||v.software.some(x=>!object(x)||!nonempty(x.name)||!nonempty(x.version)||!isSha256(x.sha256))||new Set(v.software.map(x=>x.name)).size!==v.software.length)add('HOST_SOFTWARE_INVALID','/inventory/software');
 else{
  for(const lock of p.requiredPackages)if(!v.software.some(x=>x.name===lock.name&&x.version===lock.version&&x.sha256===lock.sha256))add('HOST_PACKAGE_MISMATCH',`/inventory/software/${lock.name}`);
  for(const name of p.forbiddenPackages)if(v.software.some(x=>x.name===name))add('HOST_FORBIDDEN_PACKAGE',`/inventory/software/${name}`);
 }
 if(!Array.isArray(v.clockDomains)||p.clockDomains.some(x=>!v.clockDomains.includes(x)))add('HOST_CLOCK_DOMAIN_MISSING','/inventory/clockDomains');
 return issues;
}
export async function collectNativeInventory(){
 // Only locally observable facts. OS/container detection alone cannot establish origin, image or emulation.
 let os={id:'unknown',version:'unknown'};
 if(platform()==='linux')try{const data=await readFile('/etc/os-release','utf8'),field=k=>data.match(new RegExp(`^${k}=["']?([^"'\\n]+)`, 'm'))?.[1]??'unknown';os={id:field('ID'),version:field('VERSION_ID')};}catch{/* unresolved */}
 return {schemaVersion:1,installation:null,profileId:null,modelId:null,modelSha256:null,subject:null,os:{platform:platform(),...os,kernel:release()},architecture:arch()==='x64'?'amd64':arch(),cpu:{model:cpus()[0]?.model??'unknown',cores:cpus().length},image:null,provenance:{origin:'unknown',hostOs:'unknown',hostArchitecture:'unknown',virtualization:'unknown',emulation:'unknown',evidencePath:null,evidenceSha256:null},software:[],clockDomains:[]};
}
