import {readLocalOciLayout,localImageAssociationIssues} from './local-oci.mjs';
import {evidenceInventory} from '../r2b-readback.mjs';
// R83/R90 current native orchestration. No image pull/build, host provisioning, or ambient source mount.
import {mkdir,readFile,writeFile,cp,lstat,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {platform,arch} from 'node:os';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual as same} from 'node:util';
import {tsImport} from 'tsx/esm/api';
import {runR2bCaseCommand} from './r2b-process.mjs';
import {runProbeCommand} from './mujoco-probe-process.mjs';
import {probeFile,sha256} from './mujoco-probe-evidence.mjs';
import {currentR2bSubjectIssues,currentEngineIssues,currentPackageBindingIssues} from './r2b-subject.mjs';
import payload from '../../robotics/simulation-mujoco/campaigns/payload-v1.json' with {type:'json'};
import cell from '../../robotics/simulation-mujoco/campaigns/mj-cell-bv01-v1.json' with {type:'json'};
const probeArtifacts=async root=>evidenceInventory(root).filter(f=>f.file!=='manifest.json').map(f=>({path:f.file,bytes:f.bytes,sha256:f.sha256}));
const json=v=>JSON.stringify(v,null,2)+'\n',read=async(root,p)=>JSON.parse(await probeFile(root,p,64*1024*1024));
export const R2B_NATIVE_CASES=[...payload.cases.map(c=>({campaign:'payload-v1',id:c.id,seed:c.seed})),...cell.nominalSeeds.map(seed=>({campaign:'mj-cell-bv01-v1',id:'nominal-'+seed,seed})),...cell.faults.map(c=>({campaign:'mj-cell-bv01-v1',id:c.id,seed:c.seed}))];
async function admitted(handoff){const {readNativeHandoff,validateNativeHandoff}=await tsImport('../../packages/lab-runtime/src/v2/sil/native-handoff.ts',import.meta.url),m=await readNativeHandoff(handoff),inventory=await read(handoff,'inventory.json'),v=await validateNativeHandoff(handoff,m,inventory);if(!v.nativeReady)throw Error('CURRENT_HANDOFF_NOT_NATIVE_READY:'+v.issues.map(i=>i.code).join(','));return m;}
async function admittedConfig(handoff){const inventory=await read(handoff,'inventory.json'),provenance=await read(handoff,inventory.provenance.evidencePath);return read(handoff,provenance.imageConfigPath);}
async function localAssociation(handoff,subject,inspected){
 const oci=await readLocalOciLayout(join(handoff,'local-image/layout')),record=await read(handoff,'local-image/local-image-association.json');
 const expected={...oci,manifest:undefined,config:undefined,sourceCommit:subject.sourceCommit,accepted:false};if(!same(JSON.parse(JSON.stringify(expected)),record)||oci.manifestDigest!==subject.image.manifestDigest||oci.configDigest!==subject.image.configDigest)throw Error('CURRENT_LOCAL_OCI_ASSOCIATION');
 const problems=localImageAssociationIssues(oci,inspected);if(problems.length)throw Error(problems.join(','));return {kind:oci.kind,registryObservation:false,manifestDigest:oci.manifestDigest,configDigest:oci.configDigest};
}
async function retainLocalLayout(handoff,out){
 const oci=await readLocalOciLayout(join(handoff,'local-image/layout'));
 for(const path of ['local-image/local-image-association.json','local-image/layout/oci-layout','local-image/layout/index.json',...oci.blobs.map(b=>'local-image/layout/blobs/sha256/'+b.digest.slice(7))]){const b=await probeFile(handoff,path,256*1024*1024);await mkdir(resolve(out,path,'..'),{recursive:true});await writeFile(join(out,path),b,{flag:'wx',mode:0o600});}
}
export async function runR2bNative({handoff,out,checker,signal}){
 handoff=resolve(handoff);out=resolve(out);await mkdir(out,{mode:0o700});const m={version:1,kind:'r2b-native-payload-cell',accepted:false,calibration:'not_calibrated',checker,subject:null,qualification:'not_run',cases:R2B_NATIVE_CASES.map(c=>({...c,status:'not_run'})),issues:[],artifacts:[]};
 const save=()=>writeFile(join(out,'manifest.json'),json(m));await save();let launched=false;
 try{
  // Host admission precedes any Docker invocation, including info/context inspection.
  if(platform()!=='linux'||arch()!=='x64')throw Error('CURRENT_NATIVE_HOST_UNASSIGNED');
  const subject=await admitted(handoff),bytes=await probeFile(handoff,'r2b-campaign-package.json',4*1024*1024);const pkg=JSON.parse(bytes),issues=currentR2bSubjectIssues(subject,pkg);if(issues.length)throw Error(issues.join(','));m.subject=subject.subject;
  const assignment=await read(handoff,'host-assignment.json');if(assignment.assigned!==true||assignment.machineIdSha256!==sha256(await readFile('/etc/machine-id'))||assignment.hostOs!=='linux'||assignment.hostArchitecture!=='amd64'||assignment.emulation!=='none'||!['bare_metal','vm'].includes(assignment.virtualization)||!assignment.assignedBy)throw Error('CURRENT_HOST_ASSIGNMENT_REQUIRED');
  if(await lstat('/.dockerenv').then(()=>true,()=>false)||await lstat('/run/.containerenv').then(()=>true,()=>false))throw Error('CURRENT_NESTED_HOST_REFUSED');
  for(const n of await readdir('/proc/sys/fs/binfmt_misc').catch(()=>[]))if(/qemu|rosetta/i.test(n)&&(await readFile('/proc/sys/fs/binfmt_misc/'+n,'utf8')).startsWith('enabled'))throw Error('CURRENT_EMULATION_REFUSED');
  const {exportNativeHandoff}=await tsImport('../../packages/lab-runtime/src/v2/sil/native-handoff.ts',import.meta.url);await exportNativeHandoff(handoff,join(out,'handoff'));const inventory=await read(handoff,'inventory.json'),provenance=await read(handoff,inventory.provenance.evidencePath);for(const path of ['inventory.json','host-assignment.json','r2b-campaign-package.json',inventory.provenance.evidencePath,provenance.platformManifestPath,provenance.imageConfigPath]){const b=await probeFile(handoff,path,4*1024*1024);await mkdir(resolve(out,'handoff',path,'..'),{recursive:true});await writeFile(join(out,'handoff',path),b,{flag:'wx',mode:0o600});}await admitted(join(out,'handoff'));await retainLocalLayout(handoff,join(out,'handoff'));await writeFile(join(out,'package.json'),bytes,{flag:'wx'});await writeFile(join(out,'host-observed.json'),json({platform:platform(),arch:arch(),machineIdSha256:assignment.machineIdSha256,assignment,emulation:'none'}));
  if(process.env.DOCKER_HOST||process.env.DOCKER_CONTEXT)throw Error('REMOTE_DOCKER_UNSUPPORTED');let commandIndex=0;await mkdir(join(out,'commands'));const command=async args=>{const d=join(out,'commands',String(++commandIndex));await mkdir(d);const p=await runProbeCommand('docker',args,{out:d,timeoutMs:30000,signal});if(p.status!=='completed')throw Error('CURRENT_DOCKER_COMMAND_FAILED');return JSON.parse(await readFile(join(d,'stdout.log'),'utf8'));};
  const context=await command(['context','inspect']);if(context.length!==1||!context[0].Endpoints.docker.Host.startsWith('unix://'))throw Error('LOCAL_DOCKER_REQUIRED');
  const info=await command(['info','--format','{{json .}}']);if(info.OSType!=='linux'||!['x86_64','amd64'].includes(info.Architecture))throw Error('DAEMON_ARCH_MISMATCH');
  const inspected=(await command(['image','inspect',m.subject.image.configDigest]))[0];if(inspected.Id!==m.subject.image.configDigest||inspected.Os!=='linux'||inspected.Architecture!=='amd64'||inspected.Config?.Labels?.['org.opencontainers.image.revision']!==m.subject.sourceCommit)throw Error('CURRENT_IMAGE_MISMATCH');const labelIssues=currentPackageBindingIssues(bytes,await admittedConfig(handoff),inspected);if(labelIssues.length)throw Error(labelIssues.join(','));m.imageAssociation=await localAssociation(handoff,m.subject,inspected);await writeFile(join(out,'image-inspect.json'),json(inspected));
  const uid=process.getuid(),gid=process.getgid();if(uid===0)throw Error('NONROOT_CURRENT_PROBE_REQUIRED');const owner=randomUUID();await mkdir(join(out,'cases'));await mkdir(join(out,'campaigns'));let measured;
  for(const [i,spec]of [{campaign:'identity',id:'inventory'},...R2B_NATIVE_CASES].entries()){
   signal?.throwIfAborted();const d=join(out,'cases',`${i}-${spec.id}`);await mkdir(d);const name=`r2b-${owner}-${i}`,args=['run','--pull','never','--name',name,'--label','mekoniq.r2b.owner='+owner,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128','--memory','4g','--cpus','2','--user',`${uid}:${gid}`,'--tmpfs','/tmp:rw,nosuid,nodev,size=1g','--mount',`type=bind,src=${d},dst=/evidence`,'--entrypoint','node',m.subject.image.configDigest,'/app/r2b-campaign.mjs',...i===0?['identity']:['run','--campaign',spec.campaign,'--case',spec.id,'--out','/evidence/output']];let receipt;
   try{launched=true;receipt=await runR2bCaseCommand('docker',args,{out:d,timeoutMs:i===0?120000:6100000,signal});}
   finally{const cleanup=join(d,'cleanup');await mkdir(cleanup);const probe=await runProbeCommand('docker',['inspect','--format','{{index .Config.Labels "mekoniq.r2b.owner"}}',name],{out:cleanup,timeoutMs:10000});if(probe.status==='completed'&&(await readFile(join(cleanup,'stdout.log'),'utf8')).trim()===owner){const p=join(cleanup,'remove');await mkdir(p);await runProbeCommand('docker',['rm','-f',name],{out:p,timeoutMs:30000});}}
   if(receipt.status!=='completed')throw Error('CURRENT_CASE_INCOMPLETE:'+spec.id);
   if(i===0){measured=JSON.parse(await readFile(join(d,'stdout.log'),'utf8'));if(!same(measured.package,pkg))throw Error('IMAGE_CAMPAIGN_PACKAGE_MISMATCH');const engineProblems=currentEngineIssues(subject,measured);if(engineProblems.length)throw Error(engineProblems.join(','));continue;}
   const aggregate=join(out,'campaigns',spec.campaign);await mkdir(aggregate,{recursive:true});const output=join(d,'output');await cp(join(output,spec.id),join(aggregate,spec.id),{recursive:true,errorOnExist:true,force:false});if(!await lstat(join(aggregate,'campaign.json')).then(()=>true,()=>false))await cp(join(output,'campaign.json'),join(aggregate,'campaign.json'));m.cases[i-1]={...spec,status:'executed',process:`cases/${i}-${spec.id}/process.json`};await save();
  }
  m.qualification='recorded';
 }catch(e){m.issues.push(e.message);m.qualification=launched?'incomplete':'not_run';}
 m.artifacts=await probeArtifacts(out);await save();if(m.qualification==='recorded'){const v=await verifyR2bNative(out,checker);m.qualification=v.passed?'passed':'failed';m.issues=v.issues;await save();}return m;
}
export async function verifyR2bNative(root,checker){
 const issues=[];try{
  const m=await read(root,'manifest.json'),check=(ok,code)=>{if(!ok)issues.push(code);};check(m.kind==='r2b-native-payload-cell'&&m.accepted===false&&m.calibration==='not_calibrated','CURRENT_MANIFEST');check(same(m.checker,checker),'CURRENT_CHECKER_PIN');check(same(await probeArtifacts(root),m.artifacts),'CURRENT_ARTIFACT_INVENTORY');check(['recorded','passed'].includes(m.qualification),'CURRENT_CAMPAIGN_NOT_EXECUTED');
  const subject=await admitted(join(root,'handoff')),pkg=await read(root,'package.json');issues.push(...currentR2bSubjectIssues(subject,pkg));check(same(m.subject,subject.subject),'CURRENT_SUBJECT_TUPLE');check(same(await read(join(root,'handoff'),'r2b-campaign-package.json'),pkg),'CURRENT_PACKAGE_COMPANION');
  const host=await read(root,'host-observed.json');check(host.platform==='linux'&&host.arch==='x64'&&host.emulation==='none'&&host.assignment?.machineIdSha256===host.machineIdSha256&&host.assignment?.assigned===true,'CURRENT_HOST');
  const image=await read(root,'image-inspect.json');issues.push(...currentPackageBindingIssues(await probeFile(root,'package.json'),await admittedConfig(join(root,'handoff')),image));check(image.Id===m.subject.image.configDigest&&image.Architecture==='amd64'&&image.Os==='linux'&&image.Config?.Labels?.['org.opencontainers.image.revision']===m.subject.sourceCommit,'CURRENT_IMAGE');check(same(m.imageAssociation,await localAssociation(join(root,'handoff'),m.subject,image)),'CURRENT_LOCAL_IMAGE_ASSOCIATION');const measured=await read(root,'cases/0-inventory/stdout.log');check(same(measured.package,pkg),'CURRENT_IMAGE_PACKAGE');issues.push(...currentEngineIssues(subject,measured));
  check(m.cases.length===R2B_NATIVE_CASES.length,'CURRENT_CASE_TABLE');for(const [i,s]of R2B_NATIVE_CASES.entries()){const c=m.cases[i];check(same({campaign:c?.campaign,id:c?.id,seed:c?.seed},s)&&c.status==='executed','CURRENT_CASE:'+s.id);const p=await read(root,`cases/${i+1}-${s.id}/process.json`);check(p.status==='completed'&&p.exitCode===0&&p.command==='docker'&&p.args.includes(m.subject.image.configDigest)&&p.args.includes('/app/r2b-campaign.mjs')&&p.args.includes(s.id)&&p.args.includes(s.campaign)&&!p.args.some(a=>a.includes('dst=/app')),'CURRENT_EXECUTION:'+s.id);}
  const {verifyPayloadCampaign}=await tsImport('../../packages/lab-runtime/src/v2/simulation3d/payload-campaign.ts',import.meta.url),{verifyCellCampaign}=await tsImport('../../packages/lab-runtime/src/v2/simulation3d/cell-campaign.ts',import.meta.url);for(const [name,verify]of [['payload-v1',verifyPayloadCampaign],['mj-cell-bv01-v1',verifyCellCampaign]]){const c=await read(root,'campaigns/'+name+'/campaign.json');check(c.sourceCommit===m.subject.sourceCommit,'CURRENT_CAMPAIGN_SOURCE');const v=await verify(join(root,'campaigns',name));check(v.completedCases===v.expectedRuns&&!v.issues.length&&!v.missingArtifacts.length,'CURRENT_CAMPAIGN:'+name);issues.push(...v.issues);}
 }catch(e){issues.push('CURRENT_UNREADABLE:'+e.message);}return {passed:issues.length===0,accepted:false,issues};
}
