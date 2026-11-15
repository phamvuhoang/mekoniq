// Portable preparation boundary. This checks supplied records, never authenticates a host or executes a subject.
import Ajv from 'ajv';
import {canonicalize} from 'json-canonicalize';
import {constants} from 'node:fs';
import {lstat,realpath,open,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,dirname,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import schema from '../../../../contracts/schemas/native-handoff-v1.schema.json';
import type {NativeHandoffV1,HandoffRef} from '../../../../contracts/generated/native-handoff';
import {nativeInventoryIssues} from '../../../../../scripts/native-sim/native-inventory.mjs';
import {validateNativeDocuments} from './native-handoff-documents';
export type Issue={code:string;path:string;severity:'error'|'prerequisite'};
export type HandoffAssessment={prepared:boolean;nativeReady:boolean;issues:Issue[]};
const shape=new Ajv({strict:true,allErrors:true}).compile<NativeHandoffV1>(schema);
// Supported image records only: SHA-256 OCI image v1 / Docker image manifest v2, not indexes or artifacts.
// Layer bytes are not fetched/executed; descriptors and uncompressed rootfs identities are structurally bound.
type ImageDescriptor={mediaType:string;digest:string;size:number};
type ImageManifest={mediaType:string;schemaVersion:2;config:ImageDescriptor;layers:ImageDescriptor[]};
type ImageConfig={os:string;architecture:string;rootfs:{type:'layers';diff_ids:string[]};history?:{empty_layer?:boolean}[]};
const digestShape={type:'string',pattern:'^sha256:[a-f0-9]{64}$'},stringArray={type:'array',items:{type:'string'}};
const descriptorShape={type:'object',required:['mediaType','digest','size'],properties:{mediaType:{type:'string'},digest:digestShape,size:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER},urls:stringArray,annotations:{type:'object',additionalProperties:{type:'string'}}}};
const imageManifestShape=new Ajv({strict:true}).compile<ImageManifest>({type:'object',required:['schemaVersion','mediaType','config','layers'],properties:{schemaVersion:{const:2},mediaType:{enum:['application/vnd.oci.image.manifest.v1+json','application/vnd.docker.distribution.manifest.v2+json']},config:descriptorShape,layers:{type:'array',minItems:1,items:descriptorShape},annotations:{type:'object',additionalProperties:{type:'string'}}}});
const imageConfigShape=new Ajv({strict:true}).compile<ImageConfig>({type:'object',required:['os','architecture','rootfs'],properties:{os:{type:'string',minLength:1},architecture:{type:'string',minLength:1},variant:{type:'string'},'os.version':{type:'string'},'os.features':stringArray,created:{type:'string'},author:{type:'string'},rootfs:{type:'object',required:['type','diff_ids'],properties:{type:{const:'layers'},diff_ids:{type:'array',items:digestShape}}},config:{type:'object',properties:{User:{type:'string'},Env:stringArray,Entrypoint:{anyOf:[stringArray,{type:'null'}]},Cmd:{anyOf:[stringArray,{type:'null'}]},WorkingDir:{type:'string'},StopSignal:{type:'string'},ArgsEscaped:{type:'boolean'},Labels:{anyOf:[{type:'object',additionalProperties:{type:'string'}},{type:'null'}]},Volumes:{anyOf:[{type:'object',additionalProperties:{type:'object'}},{type:'null'}]},ExposedPorts:{type:'object',additionalProperties:{type:'object'}}}},history:{type:'array',items:{type:'object',properties:{created:{type:'string'},author:{type:'string'},created_by:{type:'string'},comment:{type:'string'},empty_layer:{type:'boolean'}}}}}});
function validImageRecords(manifest:unknown,config:unknown,configBytes:number){
 if(!imageManifestShape(manifest)||!imageConfigShape(config))return false;
 const oci=manifest.mediaType==='application/vnd.oci.image.manifest.v1+json',types=oci?['application/vnd.oci.image.layer.v1.tar','application/vnd.oci.image.layer.v1.tar+gzip','application/vnd.oci.image.layer.v1.tar+zstd','application/vnd.oci.image.layer.nondistributable.v1.tar','application/vnd.oci.image.layer.nondistributable.v1.tar+gzip','application/vnd.oci.image.layer.nondistributable.v1.tar+zstd']:['application/vnd.docker.image.rootfs.diff.tar.gzip','application/vnd.docker.image.rootfs.foreign.diff.tar.gzip'];
 return manifest.config.mediaType===(oci?'application/vnd.oci.image.config.v1+json':'application/vnd.docker.container.image.v1+json')&&manifest.config.size===configBytes&&manifest.layers.every((layer:{mediaType:string})=>types.includes(layer.mediaType))&&config.rootfs.diff_ids.length===manifest.layers.length&&(!config.history||config.history.filter((entry:{empty_layer?:boolean})=>!entry.empty_layer).length===manifest.layers.length);
}
const FILE_LIMIT=64*1024*1024,JSON_LIMIT=1024*1024,TOTAL_LIMIT=256*1024*1024,REF_LIMIT=768;
const hash=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const safePath=(p:string)=>/^[A-Za-z0-9_-][A-Za-z0-9_.-]*(\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$/.test(p)&&p.length<=240&&!p.split('/').some(x=>x==='.'||x==='..');
const secretPath=(p:string)=>p.split('/').some(x=>/^(\.env(?:\..*)?|id_(rsa|ed25519|ecdsa)|credentials(?:\..*)?)$|(?:private|secret|tunnel).*key|\.(?:key|pem|p12|pfx)$/i.test(x));
const secretContent=(b:Buffer)=>/-----BEGIN (?:[A-Z0-9 ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----/.test(b.toString('utf8'));
async function checkedRoot(root:string){const s=await lstat(root);if(!s.isDirectory()||s.isSymbolicLink())throw new Error('ROOT_NOT_DIRECTORY');return realpath(root);}
export async function readHandoffFile(root:string,path:string,limit=JSON_LIMIT):Promise<Buffer>{
 if(!safePath(path)||secretPath(path))throw new Error('REF_PATH_FORBIDDEN');
 const base=await checkedRoot(root);let full=base;
 for(const part of path.split('/')){full=join(full,part);const s=await lstat(full);if(s.isSymbolicLink())throw new Error('REF_SYMLINK');}
 const file=await open(full,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const before=await file.stat();if(!before.isFile())throw new Error('REF_NOT_REGULAR');if(before.size>limit)throw new Error('REF_TOO_LARGE');
  // Bounded read on the opened descriptor, including a byte to detect a concurrently growing file.
  const bytes=Buffer.alloc(before.size+1);let length=0;
  while(length<bytes.length){const r=await file.read(bytes,length,bytes.length-length,length);if(!r.bytesRead)break;length+=r.bytesRead;}
  const after=await file.stat(),pathStat=await lstat(full);
  if(length!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||pathStat.ino!==after.ino||pathStat.dev!==after.dev||await realpath(full)!==full)throw new Error('REF_CHANGED_DURING_READ');
  return bytes.subarray(0,length);
 }finally{await file.close();}
}
function json(bytes:Buffer){if(bytes.length>JSON_LIMIT)throw new Error('JSON_TOO_LARGE');return JSON.parse(bytes.toString('utf8'));}
export async function readNativeHandoff(root:string):Promise<unknown>{return json(await readHandoffFile(root,'manifest.json'));}
export async function validateNativeHandoff(root:string,value:unknown,inventory?:unknown):Promise<HandoffAssessment>{
 const issues:Issue[]=[],add=(code:string,path:string,severity:Issue['severity']='error')=>issues.push({code,path,severity});
 if(!shape(value))return {prepared:false,nativeReady:false,issues:(shape.errors??[]).map(e=>({code:'HANDOFF_SCHEMA_INVALID',path:e.instancePath,severity:'error'}))};
 const m=value,refs=Object.entries(m.refs).flatMap(([role,rs])=>rs.map(ref=>({role,ref}))),contents=new Map<string,Buffer>();
 if(refs.length>REF_LIMIT||refs.reduce((n,{ref})=>n+ref.bytes,0)>TOTAL_LIMIT)return {prepared:false,nativeReady:false,issues:[{code:'HANDOFF_TOO_LARGE',path:'/refs',severity:'error'}]};
 const paths=new Set<string>();
 for(const {role,ref}of refs){
  const path=`/refs/${role}/${ref.path}`;
  if(paths.has(ref.path.toLowerCase())||ref.path.toLowerCase()==='manifest.json'){add('REF_PATH_COLLISION',path);continue;}paths.add(ref.path.toLowerCase());
  if(ref.sourceCommit!==(role==='labLock'?m.subject.labCommit:m.subject.sourceCommit))add('REF_SUBJECT_MISMATCH',path);
  try{const bytes=await readHandoffFile(root,ref.path,ref.bytes);if(bytes.length!==ref.bytes)add('REF_SIZE_MISMATCH',path);if(hash(bytes)!==ref.sha256)add('REF_HASH_MISMATCH',path);if(secretContent(bytes))add('SECRET_CONTENT_FORBIDDEN',path);contents.set(ref.path,bytes);}
  catch(e){add(e instanceof Error?e.message:'REF_UNREADABLE',path);}
 }
 const parse=(role:keyof NativeHandoffV1['refs'])=>json(contents.get(m.refs[role]![0].path)!);
 if(!issues.some(i=>i.severity==='error'))try{
  const runtime=parse('runtimeManifest'),lab=parse('labLock'),profile=parse('profile'),subject=m.subject,closure=runtime.portableSimulationTools?.closure;
  for(const [label,receipt]of [['runtimeManifest',runtime],['labLock',lab]] as const){
   if(receipt.sourceCommit!==subject.sourceCommit||receipt.schemaHash!==subject.schemaHash||receipt.artifactSha256!==subject.runtimeArtifactSha256||receipt.dirty!==false)add('SUBJECT_RECEIPT_MISMATCH',`/refs/${label}`);
  }
  if(lab.portableToolsDigest!==subject.portableClosureHash||closure?.digest!==subject.portableClosureHash||closure?.version!==1||!Array.isArray(closure?.files)||hash(JSON.stringify(closure.files))!==subject.portableClosureHash)add('CLOSURE_IDENTITY_MISMATCH','/subject/portableClosureHash');
  if(Array.isArray(closure?.files)){
   const names=new Set<string>();
   for(const file of closure.files){
    if(!file||typeof file.path!=='string'||!safePath(file.path)||names.has(file.path)||!Number.isSafeInteger(file.bytes)||file.bytes<0||typeof file.sha256!=='string'||!/^[a-f0-9]{64}$/.test(file.sha256)){add('CLOSURE_ENTRY_INVALID','/refs/runtimeManifest');continue;}
    names.add(file.path);
    if(!refs.some(({role,ref})=>role!=='nativeMapping'&&(role==='schema'?'packages/contracts/schemas/'+ref.sourcePath:ref.sourcePath)===file.path&&ref.sha256===file.sha256&&ref.bytes===file.bytes))add('CLOSURE_FILE_MISSING',`/refs/${file.path}`);
   }
  }
  if(m.refs.runtime[0].sha256!==subject.runtimeArtifactSha256)add('RUNTIME_IDENTITY_MISMATCH','/refs/runtime');
  if(m.refs.model[0].sha256!==m.profile.modelSha256)add('MODEL_IDENTITY_MISMATCH','/refs/model');
  if(m.refs.profile[0].sha256!==subject.profileSha256)add('PROFILE_IDENTITY_MISMATCH','/subject/profileSha256');
  if((subject.executionKind==='mujoco_image')!==(m.profile.installation.kind==='oci')||m.profile.installation.kind==='native_apt'&&subject.image!==null)add('INSTALLATION_PROFILE_MISMATCH','/profile/installation');
  if(!isDeepStrictEqual(profile,m.profile))add('PROFILE_IDENTITY_MISMATCH','/refs/profile');
  const required=m.profile.requiredPackages.map(x=>x.name);if(new Set(required).size!==required.length||required.some(x=>m.profile.forbiddenPackages.includes(x)))add('PROFILE_PACKAGE_CONFLICT','/profile');
  const schemaHash=createHash('sha256'),schemaPaths=new Set<string>();
  for(const ref of [...m.refs.schema].sort((a,b)=>a.sourcePath<b.sourcePath?-1:1)){
   if(basename(ref.sourcePath)!==ref.sourcePath||schemaPaths.has(ref.sourcePath))add('SCHEMA_PATH_INVALID','/refs/schema');schemaPaths.add(ref.sourcePath);
   schemaHash.update(ref.sourcePath+'\n').update(contents.get(ref.path)!);
   const s=json(contents.get(ref.path)!);if(s===null||typeof s!=='object'||Array.isArray(s))add('SCHEMA_CONTENT_INVALID','/refs/schema');
  }
  if(schemaHash.digest('hex')!==subject.schemaHash)add('SCHEMA_IDENTITY_MISMATCH','/subject/schemaHash');
  const native=runtime.nativeTools;
  if(subject.nativeClosureHash!==null){
   if(native?.version!==1||native?.digest!==subject.nativeClosureHash||!Array.isArray(native?.files)||hash(JSON.stringify(native.files))!==subject.nativeClosureHash)add('NATIVE_CLOSURE_IDENTITY_MISMATCH','/subject/nativeClosureHash');
   else for(const file of native.files)if(!refs.some(({role,ref})=>role!=='nativeMapping'&&(role==='schema'?'packages/contracts/schemas/'+ref.sourcePath:ref.sourcePath)===file.path&&ref.sha256===file.sha256&&ref.bytes===file.bytes))add('NATIVE_CLOSURE_FILE_MISSING',`/refs/${file.path}`);
  }
  for(const ref of [...m.refs.engine,...m.refs.tool])if(![...closure?.files??[],...subject.nativeClosureHash!==null?native?.files??[]:[]].some((f:HandoffRef)=>f.path===ref.sourcePath&&f.sha256===ref.sha256&&f.bytes===ref.bytes))add('TOOL_IDENTITY_MISMATCH',`/refs/${ref.path}`);
 }catch{add('REF_METADATA_INVALID','/refs');}
 if(!issues.some(i=>i.severity==='error'))issues.push(...validateNativeDocuments(m,contents));
 issues.push(...nativeInventoryIssues(inventory,{profile:m.profile,subject:m.subject}));
 if(inventory&&typeof inventory==='object'){
  const provenance=(inventory as {provenance?:{evidencePath?:unknown;evidenceSha256?:unknown}}).provenance;
  try{
   if(typeof provenance?.evidencePath!=='string')throw new Error('missing');
   const bytes=await readHandoffFile(root,provenance.evidencePath),record=json(bytes),origin={...provenance};delete origin.evidencePath;delete origin.evidenceSha256;
   if(hash(bytes)!==provenance.evidenceSha256||record.schemaVersion!==1||record.inventorySha256!==hash(canonicalize({...inventory,provenance:origin})))throw new Error('mismatch');
   if(record.kind!==m.profile.installation.kind)throw new Error('provenance mode mismatch');
   if(m.profile.installation.kind==='oci'){
    const image=m.subject.image;if(!image)throw new Error('unbuilt');
    const imageBytes=await readHandoffFile(root,record.platformManifestPath),configBytes=await readHandoffFile(root,record.imageConfigPath),platformManifest=json(imageBytes),config=json(configBytes);
    if('sha256:'+hash(imageBytes)!==image.manifestDigest||'sha256:'+hash(configBytes)!==image.configDigest||!validImageRecords(platformManifest,config,configBytes.length)||platformManifest.config?.digest!==image.configDigest||config.os!=='linux'||config.architecture!==m.profile.architecture)throw new Error('platform identity mismatch');
   }else{
    if(!Array.isArray(record.sources)||record.sources.length!==m.profile.installation.sources.length)throw new Error('source evidence missing');
    let provenanceBytes=0;
    for(const source of m.profile.installation.sources){
     const matches=record.sources.filter((x:{id:string})=>x?.id===source.id);if(matches.length!==1)throw new Error('source provenance mismatch');
     const bytes=await readHandoffFile(root,matches[0].path,Math.min(FILE_LIMIT,TOTAL_LIMIT-provenanceBytes));provenanceBytes+=bytes.length;if(hash(bytes)!==source.sha256)throw new Error('source provenance mismatch');
    }
   }
  }
  catch{add('HOST_PROVENANCE_ARTIFACT_INVALID','/inventory/provenance','prerequisite');}
 }
 const prepared=!issues.some(i=>i.severity==='error');return {prepared,nativeReady:prepared&&issues.length===0,issues};
}
export async function exportNativeHandoff(input:string,out:string):Promise<HandoffAssessment>{
 const manifest=await readNativeHandoff(input),assessment=await validateNativeHandoff(input,manifest);
 if(!assessment.prepared)throw new Error('HANDOFF_NOT_PREPARED:'+JSON.stringify(assessment.issues));
 const m=manifest as NativeHandoffV1,target=resolve(out);
 // Exclusive directory creation: never merge into or replace an existing artifact. Failed exports remain for inspection.
 await checkedRoot(dirname(target));await mkdir(target,{mode:0o700});
 for(const refs of Object.values(m.refs))for(const ref of refs){
  const bytes=await readHandoffFile(input,ref.path,ref.bytes);
  if(bytes.length!==ref.bytes||hash(bytes)!==ref.sha256||secretContent(bytes))throw new Error('EXPORT_INPUT_CHANGED');
  await mkdir(dirname(join(target,ref.path)),{recursive:true,mode:0o700});await writeFile(join(target,ref.path),bytes,{flag:'wx',mode:0o600});
 }
 await writeFile(join(target,'manifest.json'),JSON.stringify(m,null,2)+'\n',{flag:'wx',mode:0o600});
 const result=await validateNativeHandoff(target,m);if(!result.prepared)throw new Error('EXPORT_VERIFICATION_FAILED');return result;
}
