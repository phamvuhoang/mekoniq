// Synthetic protocol fixtures only; never native execution evidence.
import {mkdtemp,writeFile,mkdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {canonicalize} from 'json-canonicalize';
import {createHash} from 'node:crypto';
export const digest=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
export async function nativeHandoffFixture(mode:'oci'|'native_apt'='oci'){
 const root=await mkdtemp(join(tmpdir(),'native-handoff-test-')),sha='a'.repeat(64),commit='1'.repeat(40);
 const configBytes=JSON.stringify({os:'linux',architecture:'amd64'}),manifestBytes=JSON.stringify({schemaVersion:2,mediaType:'application/vnd.oci.image.manifest.v1+json',config:{digest:'sha256:'+digest(configBytes)}});
 const image={platform:'linux/amd64',manifestDigest:'sha256:'+digest(manifestBytes),configDigest:'sha256:'+digest(configBytes)};
 await writeFile(join(root,'image-config.json'),configBytes);await writeFile(join(root,'image-manifest.json'),manifestBytes);
 const schemaBytes=JSON.stringify({$schema:'http://json-schema.org/draft-07/schema#',type:'object'});
 const subject={executionKind:mode==='oci'?'mujoco_image':'linuxcnc_native',profileSha256:'a'.repeat(64),id:'synthetic-r2b',sourceCommit:commit,labCommit:'2'.repeat(40),schemaHash:digest('test.schema.json\n'+schemaBytes),portableClosureHash:sha,runtimeArtifactSha256:digest('runtime'),image:mode==='oci'?image:null};
 const sourceBytes='synthetic signed apt Release';await writeFile(join(root,'apt-release.txt'),sourceBytes);
 const installation=mode==='oci'?{kind:'oci'}:{kind:'native_apt',sources:[{id:'debian',kind:'apt_repository',uri:'https://deb.debian.org/debian',sha256:digest(sourceBytes)}],packageSources:[{name:'linuxcnc',sourceId:'debian'}]};
 const profile={installation,id:'puma-linux-amd64',modelId:'puma',modelSha256:digest('model'),architecture:'amd64',os:{id:'debian',version:'12'},requiredPackages:[{name:'linuxcnc',version:'2.9.3',sha256:sha}],forbiddenPackages:['ros-noetic'],clockDomains:['controller','source_monotonic']};
 const refs:Record<string,{path:string;sha256:string;bytes:number;sourcePath:string;sourceCommit:string}[]>={};
 const put=async(role:string,path:string,bytes:string,sourcePath=path)=>{await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),bytes);const ref={path,sha256:digest(bytes),bytes:Buffer.byteLength(bytes),sourcePath,sourceCommit:commit};(refs[role]??=[]).push(ref);return ref;};
 await put('schema','schemas/test.schema.json',schemaBytes,'test.schema.json');
 await put('runtime','runtime.mjs','runtime');await put('project','inputs/project.json','project');await put('world','inputs/world.json','world');await put('model','inputs/model.json','model');
 await put('profile','profile.json',JSON.stringify(profile));subject.profileSha256=digest(JSON.stringify(profile));
 const engine=await put('engine','tools/engine.lock','engine==1','robotics/engine.lock'),tool=await put('tool','tools/worker.py','print("protocol fixture")','robotics/worker.py');
 const files=[engine,tool].map(x=>({path:x.sourcePath,sha256:x.sha256,bytes:x.bytes})).sort((a,b)=>a.path<b.path?-1:1);subject.portableClosureHash=digest(JSON.stringify(files));
 const runtimeManifest={sourceCommit:commit,schemaHash:subject.schemaHash,artifactSha256:subject.runtimeArtifactSha256,dirty:false,portableSimulationTools:{closure:{version:1,digest:subject.portableClosureHash,files}}};
 await put('runtimeManifest','runtime-manifest.json',JSON.stringify(runtimeManifest));
 const labRef=await put('labLock','lab-lock.json',JSON.stringify({sourceCommit:commit,schemaHash:subject.schemaHash,artifactSha256:subject.runtimeArtifactSha256,portableToolsDigest:subject.portableClosureHash,dirty:false}));labRef.sourceCommit=subject.labCommit;
 const manifest={schemaVersion:1,subject,checker:{sourceCommit:'3'.repeat(40),toolSha256:'c'.repeat(64)},refs,profile,frames:{world:'map',robotBase:'base_link',tool:'tcp',handedness:'right'},units:{length:'m',angle:'rad',mass:'kg',time:'s'},seeds:[17,29,43],casePolicy:{required:['nominal','worker_loss'],lostAck:'unknown_no_resend',authority:'source'},accepted:false,dynamics:'not_calibrated'};

 const inventory={installation,schemaVersion:1,profileId:profile.id,modelId:profile.modelId,modelSha256:profile.modelSha256,subject,os:{platform:'linux',id:'debian',version:'12',kernel:'6.1.0'},architecture:'amd64',cpu:{model:'synthetic-test-cpu',cores:4},image:mode==='oci'?image:null,provenance:{origin:'linux_native',hostOs:'linux',hostArchitecture:'amd64',virtualization:'bare_metal',emulation:'none',evidencePath:'inventory-provenance.txt',evidenceSha256:'a'.repeat(64)},software:[...profile.requiredPackages],clockDomains:[...profile.clockDomains]};
 const origin:Record<string,unknown>={...inventory.provenance};delete origin.evidencePath;delete origin.evidenceSha256;
 const evidence=JSON.stringify({schemaVersion:1,inventorySha256:digest(canonicalize({...inventory,provenance:origin})),kind:mode,...mode==='oci'?{platformManifestPath:'image-manifest.json',imageConfigPath:'image-config.json'}:{sources:[{id:'debian',path:'apt-release.txt'}]}});inventory.provenance.evidenceSha256=digest(evidence);await writeFile(join(root,'inventory-provenance.txt'),evidence);
 await writeFile(join(root,'manifest.json'),JSON.stringify(manifest));
 return {root,manifest,inventory,put};
}
