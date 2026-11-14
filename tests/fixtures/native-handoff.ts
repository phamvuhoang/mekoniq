// Synthetic protocol/inventory fixtures around real pinned documents; never execution evidence.
import {mkdtemp,writeFile,mkdir,readFile,readdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {canonicalize} from 'json-canonicalize';
import {nativeDocumentBinding} from '../../packages/lab-runtime/src/v2/sil/native-handoff-documents';
import {createHash} from 'node:crypto';
export const digest=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
const worldRoot='robotics/simulation-mujoco/fixtures/coffee-delivery-cell-v1',pumaRoot='integrations/arm-controller/models/puma560-reference';
const cache=new Map<string,Buffer>();async function source(path:string){let b=cache.get(path);if(!b){b=await readFile(path);cache.set(path,b);}return b;}
export async function nativeHandoffFixture(mode:'oci'|'native_apt'|'ros_navigation'|'ros_xarm'='oci'){
 const root=await mkdtemp(join(tmpdir(),'native-handoff-test-')),sha='a'.repeat(64),commit='1'.repeat(40);
 const configBytes=JSON.stringify({os:'linux',architecture:'amd64'}),manifestBytes=JSON.stringify({schemaVersion:2,mediaType:'application/vnd.oci.image.manifest.v1+json',config:{digest:'sha256:'+digest(configBytes)}});
 const image={platform:'linux/amd64',manifestDigest:'sha256:'+digest(manifestBytes),configDigest:'sha256:'+digest(configBytes)};
 await writeFile(join(root,'image-config.json'),configBytes);await writeFile(join(root,'image-manifest.json'),manifestBytes);
 const subject={nativeClosureHash:mode==='native_apt'?sha:null as string|null,executionKind:mode==='oci'?'mujoco_image':mode==='native_apt'?'linuxcnc_native':'ros2_native',profileSha256:sha,id:'synthetic-'+mode,sourceCommit:commit,labCommit:'2'.repeat(40),schemaHash:sha,portableClosureHash:sha,runtimeArtifactSha256:digest('runtime'),image:mode==='oci'?image:null};
 const sourceBytes='synthetic signed apt Release';await writeFile(join(root,'apt-release.txt'),sourceBytes);
 const packageName=mode==='oci'?'mujoco':mode==='native_apt'?'linuxcnc':'ros-jazzy-ros-base';
 const installation=mode==='oci'?{kind:'oci'}:{kind:'native_apt',sources:[{id:'debian',kind:'apt_repository',uri:'https://deb.debian.org/debian',sha256:digest(sourceBytes)}],packageSources:[{name:packageName,sourceId:'debian'}]};
 const profile={documents:nativeDocumentBinding(mode==='oci'?'mujoco_cell_v1':mode==='native_apt'?'puma_controller_reference_v1':mode==='ros_xarm'?'xarm_ros_canonical_v1':'engineering_navigation_ros_canonical_v1'),installation,id:'synthetic-'+mode+'-amd64',modelId:mode==='native_apt'?'puma560-reference':mode==='ros_navigation'?'amr-1':'xarm6-g2-v1',modelSha256:sha,architecture:'amd64',os:{id:'debian',version:'12'},requiredPackages:[{name:packageName,version:mode==='oci'?'3.17.0':'2.9.3',sha256:sha}],forbiddenPackages:['ros-noetic'],clockDomains:['controller','source_monotonic']};
 const refs:Record<string,{path:string;sha256:string;bytes:number;sourcePath:string;sourceCommit:string}[]>={};
 const put=async(role:string,path:string,value:string|Buffer,sourcePath=path)=>{const bytes=Buffer.from(value);await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),bytes);const ref={path,sha256:digest(bytes),bytes:bytes.length,sourcePath,sourceCommit:commit};(refs[role]??=[]).push(ref);return ref;};
 for(const name of (await readdir('packages/contracts/schemas')).filter(n=>n.endsWith('.json')).sort())await put('schema','schemas/'+name,await source('packages/contracts/schemas/'+name),name);
 await put('runtime','runtime.mjs','runtime');
 if(mode==='oci'||mode==='ros_xarm'){
  const world=JSON.parse((await source(worldRoot+'/lab-world-scene.json')).toString());
  await put('world','inputs/world.json',await source(worldRoot+'/lab-world-scene.json'),worldRoot+'/lab-world-scene.json');
  for(const file of world.files){const src=file.path.startsWith('blobs/')?'robotics/simulation-mujoco/fixtures/xarm6-g2-v1/'+file.path:worldRoot+'/'+file.path;const role=file.path==='project.json'?'project':file.path==='arm-component.json'?'model':'tool';await put(role,role==='project'?'inputs/project.json':role==='model'?'inputs/model.json':'closure/'+src,await source(src),src);}
  await put('engine','tools/engine.lock',await source('robotics/simulation-mujoco/requirements.lock'),'robotics/simulation-mujoco/requirements.lock');
 }else if(mode==='ros_navigation'){
  const base='robotics/simulation-3d/fixtures/serve-3d-v1';for(const [role,name]of [['project','serve-3d-project.json'],['world','navigation-scene.json'],['model','physical-model-amr-1.json']])await put(role,'inputs/'+role+'.json',await source(base+'/'+name),base+'/'+name);
  await put('engine','tools/engine.lock',await source('robotics/simulation-3d/requirements.lock'),'robotics/simulation-3d/requirements.lock');
 }else{
  const scenario=JSON.parse((await source('tests/fixtures/digital-twin/sil/bv01.json')).toString());
  await put('project','inputs/project.json',JSON.stringify(scenario.project),'derived/puma-project.json');await put('world','inputs/world.json',JSON.stringify(scenario.project.world),'derived/puma-world.json');
  await put('model','inputs/model.json',await source(pumaRoot+'/modified-dh.json'),pumaRoot+'/modified-dh.json');
  for(const name of ['manifest.json','frames.json','reference-poses.json','origin/puma560_dh.hal'])await put('tool','closure/'+pumaRoot+'/'+name,await source(pumaRoot+'/'+name),pumaRoot+'/'+name);
  const cfg='integrations/arm-controller/configs/sim/puma560/profile.json';await put('engine','tools/engine.lock',await source(cfg),cfg);
 }
 await put('tool','tools/worker.py','print("protocol fixture")','robotics/worker.py');
 profile.modelSha256=refs.model[0].sha256;await put('profile','profile.json',JSON.stringify(profile));
 await put('runtimeManifest','runtime-manifest.json','{}');const lab=await put('labLock','lab-lock.json','{}');lab.sourceCommit=subject.labCommit;
 const manifest={schemaVersion:1,subject,checker:{sourceCommit:'3'.repeat(40),toolSha256:'c'.repeat(64)},refs,profile,frames:{world:mode==='native_apt'?'world':'map',robotBase:mode==='native_apt'?'arm_base':mode==='ros_navigation'?'chassis/base':'base',tool:mode==='ros_navigation'?null:'tcp',handedness:'right'},units:{length:'m',angle:'rad',mass:'kg',time:'s'},seeds:[7,42,99],casePolicy:{required:['nominal','worker_loss'],lostAck:'unknown_no_resend',authority:'source'},accepted:false,dynamics:'not_calibrated'};
 const inventory={installation,schemaVersion:1,profileId:profile.id,modelId:profile.modelId,modelSha256:profile.modelSha256,subject,os:{platform:'linux',id:'debian',version:'12',kernel:'6.1.0'},architecture:'amd64',cpu:{model:'synthetic-test-cpu',cores:4},image:mode==='oci'?image:null,provenance:{origin:'linux_native',hostOs:'linux',hostArchitecture:'amd64',virtualization:'bare_metal',emulation:'none',evidencePath:'inventory-provenance.txt',evidenceSha256:sha},software:[...profile.requiredPackages],clockDomains:[...profile.clockDomains]};
 async function reseal(){
  for(const rs of Object.values(refs))for(const r of rs){const b=await readFile(join(root,r.path));r.sha256=digest(b);r.bytes=b.length;}
  subject.schemaHash=digest(Buffer.concat(await Promise.all(refs.schema.sort((a,b)=>a.sourcePath<b.sourcePath?-1:1).flatMap(r=>[Promise.resolve(Buffer.from(r.sourcePath+'\n')),readFile(join(root,r.path))]))));
  const files=Object.entries(refs).filter(([role])=>['engine','tool'].includes(role)).flatMap(([,rs])=>rs.map(x=>({path:x.sourcePath,sha256:x.sha256,bytes:x.bytes}))).sort((a,b)=>a.path<b.path?-1:1);subject.portableClosureHash=digest(JSON.stringify(files));if(mode==='native_apt')subject.nativeClosureHash=subject.portableClosureHash;
  const runtimeManifest={sourceCommit:commit,schemaHash:subject.schemaHash,artifactSha256:subject.runtimeArtifactSha256,dirty:false,portableSimulationTools:{closure:{version:1,digest:subject.portableClosureHash,files}},...mode==='native_apt'?{nativeTools:{version:1,digest:subject.nativeClosureHash,files}}:{}};
  const labLock={sourceCommit:commit,schemaHash:subject.schemaHash,artifactSha256:subject.runtimeArtifactSha256,portableToolsDigest:subject.portableClosureHash,dirty:false};
  profile.modelSha256=refs.model[0].sha256;inventory.modelSha256=profile.modelSha256;
  for(const [role,value]of [['runtimeManifest',runtimeManifest],['labLock',labLock],['profile',profile]] as const){const r=refs[role][0],b=JSON.stringify(value);await writeFile(join(root,r.path),b);r.sha256=digest(b);r.bytes=Buffer.byteLength(b);}
  subject.profileSha256=refs.profile[0].sha256;
  const origin:Record<string,unknown>={...inventory.provenance};delete origin.evidencePath;delete origin.evidenceSha256;
  const evidence=JSON.stringify({schemaVersion:1,inventorySha256:digest(canonicalize({...inventory,provenance:origin})),kind:mode==='oci'?'oci':'native_apt',...mode==='oci'?{platformManifestPath:'image-manifest.json',imageConfigPath:'image-config.json'}:{sources:[{id:'debian',path:'apt-release.txt'}]}});inventory.provenance.evidenceSha256=digest(evidence);await writeFile(join(root,'inventory-provenance.txt'),evidence);await writeFile(join(root,'manifest.json'),JSON.stringify(manifest));
 }
 await reseal();return {root,manifest,inventory,put,reseal};
}
