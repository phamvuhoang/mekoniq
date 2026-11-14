#!/usr/bin/env node
// L01: orchestration, never provisioning. The subject image and observer checker are independent identities.
import {mkdir,writeFile,readFile,lstat,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual as same} from 'node:util';
import {platform,arch} from 'node:os';
import {tsImport} from 'tsx/esm/api';
import {checkedCheckerCommit} from '../native-handoff.mjs';
import {collectNativeInventory} from './native-inventory.mjs';
import {runProbeCommand} from './mujoco-probe-process.mjs';
import {probeFile,probeArtifacts,sha256,mujocoCases,assessCase,analyseWire,probePrerequisites,timingSummary} from './mujoco-probe-evidence.mjs';
import baseline from './r2a-arm-baseline.json' with {type:'json'};
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),json=v=>JSON.stringify(v,null,2)+'\n';
const OBSERVER=['mujoco-probe-container.mjs','mujoco-probe-engine.py','mujoco-probe-observer.mjs','mujoco-probe-process.mjs','mujoco-probe-evidence.mjs'];
const read=async(root,path,max)=>JSON.parse((await probeFile(root,path,max??1024*1024)).toString());
async function stageObserver(out,handoff,manifest){
 const dest=join(out,'observer');await mkdir(dest,{mode:0o700});
 for(const name of OBSERVER)await writeFile(join(dest,name),await probeFile(ROOT,'scripts/native-sim/'+name),{flag:'wx',mode:0o600});
 await writeFile(join(dest,'handoff.json'),json(manifest),{flag:'wx'});
 const doc=execFileSync('git',['show',baseline.m00.sourceCommit+':'+baseline.m00.sourcePath],{cwd:ROOT,timeout:10000,maxBuffer:1024*1024});
 if(sha256(doc)!==baseline.m00.documentSha256)throw Error('M00_DOCUMENT_CHANGED');await mkdir(join(dest,'m00'));await writeFile(join(dest,'m00-source.md'),doc);
 const blocks=[...doc.toString().matchAll(/```python\n([\s\S]*?)```/g)].map(m=>m[1]);
 for(const f of baseline.m00.files){const b=blocks.find(b=>sha256(b)===f.sha256);if(!b)throw Error('M00_RECIPE_CHANGED');await writeFile(join(dest,'m00',f.path),b,{flag:'wx'});}
 const bundle=join(dest,'bad-state-bundle');await mkdir(join(bundle,'blobs'),{recursive:true});await writeFile(join(bundle,'arm-cell-scene.json'),JSON.stringify(baseline.world));
 const base='robotics/simulation-mujoco/fixtures/xarm6-g2-v1/';
 for(const ref of Object.values(manifest.refs).flat())if(ref.sourcePath.startsWith(base)&&(ref.sourcePath.endsWith('/component.json')||ref.sourcePath.endsWith('/physics.json')||ref.sourcePath.includes('/blobs/'))){const b=await probeFile(handoff,ref.path);if(sha256(b)!==ref.sha256)throw Error('SUBJECT_CHANGED');await writeFile(join(bundle,ref.sourcePath.slice(base.length)),b,{flag:'wx'});}
 return dest;
}
export async function runMujocoProbe({handoff,out,checker,signal}){
 out=resolve(out);handoff=resolve(handoff);if(out===ROOT||out.startsWith(ROOT+'/'))throw Error('EVIDENCE_MUST_BE_OUTSIDE_SOURCE');
 await mkdir(out,{mode:0o700});
 const manifest={schemaVersion:1,kind:'mujoco-native-probe',profileId:'mujoco-linux-amd64',subject:null,checker,accepted:false,dynamics:'not_calibrated',qualification:'not_run',DEP_MJ_01:'not_run',startedAt:new Date().toISOString(),issues:[],host:null,inventory:null,engine:null,cases:mujocoCases().map(c=>({...c,status:'not_run'})),r2b:{status:'not_run',reason:'image_unbuilt; separate current subject adapter owned by B10 (R83)'},artifacts:[]};
 const save=()=>writeFile(join(out,'manifest.json'),json(manifest),{mode:0o600});await save();let executed=false;
 try{
  const {readNativeHandoff,validateNativeHandoff,exportNativeHandoff}=await tsImport('../../packages/lab-runtime/src/v2/sil/native-handoff.ts',import.meta.url);
  const subject=await readNativeHandoff(handoff);manifest.subject=subject.subject;
  const prepared=await validateNativeHandoff(handoff,subject);await writeFile(join(out,'preparation.json'),json(prepared));if(!prepared.prepared)throw Error('HANDOFF_NOT_PREPARED');
  await exportNativeHandoff(handoff,join(out,'handoff'));
  // This guard precedes ALL Docker commands. A Mac container is never native Linux evidence.
  const observed=await collectNativeInventory();manifest.host=observed;await writeFile(join(out,'host-observed.json'),json(observed));
  if(platform()!=='linux'||arch()!=='x64')throw Error('NATIVE_AMD64_HOST_UNASSIGNED');
  if(subject.profile.documents.kind!=='mujoco_r2a_arm_v1'||subject.profile.architecture!=='amd64')throw Error('R2A_PROFILE_REQUIRED');
  const inventory=await read(handoff,'inventory.json'),assignment=await read(handoff,'host-assignment.json');
  const machine=sha256(await readFile('/etc/machine-id'));
  if(assignment.schemaVersion!==1||assignment.assigned!==true||assignment.machineIdSha256!==machine||assignment.hostOs!=='linux'||assignment.hostArchitecture!=='amd64'||assignment.emulation!=='none'||!['bare_metal','vm'].includes(assignment.virtualization)||typeof assignment.assignedBy!=='string'||!assignment.assignedBy.trim())throw Error('HOST_ASSIGNMENT_REQUIRED');
  // Refuse nested containers and registered cross-ISA handlers; external provenance remains an operator attestation.
  if(await lstat('/.dockerenv').then(()=>true,()=>false)||await lstat('/run/.containerenv').then(()=>true,()=>false))throw Error('HOST_CONTAINER_NOT_ASSIGNED');
  for(const name of await readdir('/proc/sys/fs/binfmt_misc').catch(()=>[]))if(/qemu|rosetta/i.test(name)&&(await readFile('/proc/sys/fs/binfmt_misc/'+name,'utf8')).startsWith('enabled'))throw Error('HOST_EMULATION_ENABLED');
  observed.provenance={origin:'linux_native',hostOs:'linux',hostArchitecture:'amd64',emulation:'none',virtualization:assignment.virtualization,assignmentSha256:sha256(json(assignment))};manifest.host=observed;manifest.inventory=inventory;await writeFile(join(out,'host-observed.json'),json(observed));
  const admission=await validateNativeHandoff(handoff,subject,inventory);await writeFile(join(out,'admission.json'),json(admission));if(!admission.nativeReady)throw Error('HANDOFF_NOT_NATIVE_READY:'+admission.issues.map(i=>i.code).join(','));
  if(subject.subject.image.manifestDigest!==baseline.historicalRegistryDigest)throw Error('HISTORICAL_IMAGE_RESOLUTION_REQUIRED');
  // L00's exported refs exclude host provenance. Copy precisely the validated inventory/provenance records too.
  const provenance=await read(handoff,inventory.provenance.evidencePath);
  for(const p of ['inventory.json','host-assignment.json',inventory.provenance.evidencePath,provenance.platformManifestPath,provenance.imageConfigPath]){const b=await probeFile(handoff,p);await mkdir(dirname(join(out,'handoff',p)),{recursive:true});await writeFile(join(out,'handoff',p),b,{flag:'wx',mode:0o600});}
  const observer=await stageObserver(out,handoff,subject),owner=randomUUID();await mkdir(join(out,'commands'));await mkdir(join(out,'cases'));
  let seq=0;const command=async(args,timeoutMs=20000)=>{const d=join(out,'commands',String(++seq));await mkdir(d);const r=await runProbeCommand('docker',args,{out:d,timeoutMs,signal});if(r.status!=='completed')throw Error('DOCKER_COMMAND_FAILED:'+args[0]);return (await readFile(join(d,'stdout.log'),'utf8')).trim();};
  if(process.env.DOCKER_HOST||process.env.DOCKER_CONTEXT)throw Error('REMOTE_DOCKER_UNSUPPORTED');
  const context=JSON.parse(await command(['context','inspect']));if(context.length!==1||!context[0]?.Endpoints?.docker?.Host?.startsWith('unix://'))throw Error('LOCAL_DOCKER_REQUIRED');
  const info=JSON.parse(await command(['info','--format','{{json .}}']));if(info.OSType!=='linux'||!['x86_64','amd64'].includes(info.Architecture))throw Error('DAEMON_ARCH_MISMATCH');
  const image=JSON.parse(await command(['image','inspect',subject.subject.image.configDigest]))[0];
  if(image.Id!==subject.subject.image.configDigest||image.Os!=='linux'||image.Architecture!=='amd64'||image.Config?.Labels?.['org.opencontainers.image.revision']!==subject.subject.sourceCommit||!image.RepoDigests?.some(x=>x.endsWith('@'+subject.subject.image.manifestDigest)))throw Error('LOCAL_IMAGE_IDENTITY_MISMATCH');
  await writeFile(join(out,'image-inspect.json'),json({id:image.Id,os:image.Os,architecture:image.Architecture,repoDigests:image.RepoDigests,sourceCommit:image.Config.Labels['org.opencontainers.image.revision'],rootfs:image.RootFS}));
  const uid=process.getuid(),gid=process.getgid();if(uid===0)throw Error('NONROOT_PROBE_REQUIRED');
  const run=async(id,timeoutMs)=>{
   const d=join(out,'cases',id);await mkdir(d);const name='l01-'+owner+'-'+id;const args=['run','--pull','never','--name',name,'--label','mekoniq.l01.owner='+owner,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128','--memory','2g','--cpus','2','--user',`${uid}:${gid}`,'--tmpfs','/tmp:rw,nosuid,nodev,size=768m','--mount',`type=bind,src=${observer},dst=/probe,readonly`,'--mount',`type=bind,src=${d},dst=/evidence`,'--entrypoint','node',subject.subject.image.configDigest,'/probe/mujoco-probe-container.mjs',id,'/evidence'];
   let result;try{result=await runProbeCommand('docker',args,{out:d,timeoutMs,signal});}
   finally{
    // Only a container with this invocation's unguessable ownership label is ever stopped/removed.
    const cleanup=join(d,'cleanup');await mkdir(cleanup);const inspected=await runProbeCommand('docker',['inspect','--format','{{index .Config.Labels "mekoniq.l01.owner"}}',name],{out:cleanup,timeoutMs:10000});
    if(inspected.status==='completed'&&(await readFile(join(cleanup,'stdout.log'),'utf8')).trim()===owner){for(const [label,args]of [['stop',['stop','-t','20',name]],['remove',['rm','-f',name]]]){const p=join(cleanup,label);await mkdir(p);await runProbeCommand('docker',args,{out:p,timeoutMs:30000});}}
   }return result;
  };
  const pre=await run('inventory',120000);if(pre.status!=='completed')throw Error('IMAGE_INVENTORY_FAILED');
  const imageInventory=await read(out,'cases/inventory/result.json');manifest.engine=imageInventory.engine;
  if(!same(imageInventory.subject,subject.subject))throw Error('IMAGE_SUBJECT_MISMATCH');
  const failures=probePrerequisites(subject,inventory,observed,manifest.engine);
  if(imageInventory.architecture!=='x64'||imageInventory.node!=='v24.22.2'||!/^3\.11\./.test(manifest.engine.python)||!/^ID=debian$/m.test(imageInventory.osRelease)||!/^VERSION_ID="12"$/m.test(imageInventory.osRelease))failures.push('IMAGE_PLATFORM_TOOLCHAIN_MISMATCH');
  if(manifest.engine.packages.some(([name])=>subject.profile.forbiddenPackages.includes(name.toLowerCase())))failures.push('IMAGE_FORBIDDEN_PACKAGE');
  if(subject.profile.requiredPackages.length!==1)failures.push('UNMEASURED_PACKAGE_LOCK');const engineLib=manifest.engine.artifacts.find(f=>f.path.includes('libmujoco'));
  const lock=subject.profile.requiredPackages.find(p=>p.name==='mujoco');if(!lock||lock.version!=='3.17.0'||'sha256:'+lock.sha256!==engineLib?.digest)failures.push('ENGINE_ARTIFACT_LOCK_MISMATCH');
  if(failures.length)throw Error(failures.join(','));
  executed=true;
  for(const spec of manifest.cases){if(signal?.aborted)throw Error('PROBE_ABORTED');spec.status='incomplete';await save();const result=await run(spec.id,spec.kind==='long_run'?360000:180000);spec.status=result.status==='completed'?'passed':result.status==='incomplete'?'incomplete':'failed';if(spec.status==='passed'){const raw=await read(out,'cases/'+spec.id+'/result.json',64*1024*1024);const verdict=assessCase(spec,raw);spec.assertions=verdict;spec.performance={...raw.tickMs?{engineTick:timingSummary(raw.tickMs)}:{},...raw.ipcMs?{workerIpcWithObserver:timingSummary(raw.ipcMs)}:{},...raw.httpMs?{httpAction:timingSummary(raw.httpMs)}:{},maxRssKiB:raw.maxRssKiB??null,longRunDriftS:raw.driftS??null};if(!verdict.passed)spec.status='failed';}await save();}
  manifest.qualification=manifest.cases.every(c=>c.status==='passed')?'passed':manifest.cases.some(c=>c.status==='incomplete')?'incomplete':'failed';manifest.DEP_MJ_01=manifest.qualification;
 }catch(e){manifest.issues.push(e.message);if(executed){manifest.qualification='incomplete';manifest.DEP_MJ_01='incomplete';}}
 manifest.finishedAt=new Date().toISOString();try{manifest.artifacts=await probeArtifacts(out);}catch(e){manifest.issues.push('ARTIFACT_COLLECTION_FAILED:'+e.message);manifest.qualification=executed?'incomplete':'not_run';manifest.DEP_MJ_01=manifest.qualification;}await save();return manifest;
}
export async function verifyMujocoProbe(root){
 const issues=[],check=(ok,code)=>{if(!ok)issues.push(code);};let manifest;
 try{
  manifest=await read(root,'manifest.json');check(manifest.schemaVersion===1&&manifest.kind==='mujoco-native-probe'&&manifest.accepted===false&&manifest.dynamics==='not_calibrated','PROBE_MANIFEST');
  const actual=await probeArtifacts(root),refs=manifest.artifacts??[];check(actual.length===refs.length,'ARTIFACT_SET');
  for(const ref of refs){const a=actual.find(a=>a.path===ref.path);check(a&&same(a,ref),'ARTIFACT_HASH:'+ref.path);}check(new Set(refs.map(r=>r.path)).size===refs.length,'ARTIFACT_DUPLICATE');
  check(manifest.qualification==='passed'&&manifest.DEP_MJ_01==='passed','NATIVE_CAMPAIGN_NOT_PASSED');
  for(const name of OBSERVER)check(sha256(await probeFile(root,'observer/'+name))===sha256(await probeFile(ROOT,'scripts/native-sim/'+name)),'OBSERVER_PIN:'+name);
  for(const f of baseline.m00.files)check(sha256(await probeFile(root,'observer/m00/'+f.path))===f.sha256,'M00_RECIPE_PIN');
  check(sha256(await probeFile(root,'observer/m00-source.md'))===baseline.m00.documentSha256,'M00_SOURCE_PIN');
  check(same(await read(root,'host-observed.json'),manifest.host),'HOST_MEASUREMENT');
  const specs=mujocoCases();check(Array.isArray(manifest.cases)&&manifest.cases.length===specs.length,'CASE_MATRIX');
  const {validateNativeHandoff}=await tsImport('../../packages/lab-runtime/src/v2/sil/native-handoff.ts',import.meta.url),handoff=await read(root,'handoff/manifest.json'),inventory=await read(root,'handoff/inventory.json');
  const admitted=await validateNativeHandoff(join(root,'handoff'),handoff,inventory);check(admitted.nativeReady,'HANDOFF_NOT_NATIVE_READY');check(same(handoff.subject,manifest.subject),'SUBJECT_MISMATCH');
  for(const issue of probePrerequisites(handoff,inventory,manifest.host,manifest.engine))issues.push(issue);
  const image=await read(root,'image-inspect.json'),measured=await read(root,'cases/inventory/result.json');check(image.id===manifest.subject.image.configDigest&&image.os==='linux'&&image.architecture==='amd64'&&image.sourceCommit===manifest.subject.sourceCommit&&image.repoDigests.some(s=>s.endsWith('@'+manifest.subject.image.manifestDigest)),'IMAGE_MEASUREMENT');check(same(measured.engine,manifest.engine)&&same(measured.subject,manifest.subject),'ENGINE_MEASUREMENT');
  check(measured.architecture==='x64'&&measured.node==='v24.22.2'&&/^3\.11\./.test(measured.engine.python)&&/^ID=debian$/m.test(measured.osRelease)&&/^VERSION_ID="12"$/m.test(measured.osRelease),'IMAGE_PLATFORM_TOOLCHAIN');
  const lib=manifest.engine.artifacts.find(f=>f.path.includes('libmujoco')),lock=handoff.profile.requiredPackages.find(p=>p.name==='mujoco');check(lock&&'sha256:'+lock.sha256===lib?.digest,'ENGINE_ARTIFACT_LOCK_MISMATCH');
  for(const spec of specs){try{
   const entry=manifest.cases.find(c=>c.id===spec.id);check(entry&&spec.kind===entry.kind&&entry.scope===spec.scope&&entry.seed===spec.seed&&entry.status==='passed','CASE_STATUS:'+spec.id);
   const dir='cases/'+spec.id+'/',proc=await read(root,dir+'process.json'),raw=await read(root,dir+'result.json',64*1024*1024);check(proc.status==='completed'&&proc.exitCode===0&&proc.command==='docker'&&proc.args.includes(manifest.subject.image.configDigest)&&proc.args.includes('/probe/mujoco-probe-container.mjs'),'EXECUTION_RECEIPT:'+spec.id);
   for(const issue of assessCase(spec,raw).issues)issues.push(spec.id+':'+issue);
   const performance={...raw.tickMs?{engineTick:timingSummary(raw.tickMs)}:{},...raw.ipcMs?{workerIpcWithObserver:timingSummary(raw.ipcMs)}:{},...raw.httpMs?{httpAction:timingSummary(raw.httpMs)}:{},maxRssKiB:raw.maxRssKiB??null,longRunDriftS:raw.driftS??null};check(same(entry?.performance,performance),'PERFORMANCE_SUMMARY:'+spec.id);
   if(['business','worker_loss'].includes(spec.kind)){
    check((await read(root,dir+'wire.jsonl.seal')).complete===true,'WIRE_SEAL');
    const report=await read(root,dir+'report.json'),wire=await read(root,dir+'run-wire.json',64*1024*1024);check(same(report,raw.report)&&report.manifest.sourceCommit===manifest.subject.sourceCommit&&report.schemaHash===manifest.subject.schemaHash&&same(wire,raw.wire)&&analyseWire(wire).valid,'SUBJECT_READER:'+spec.id);
    const copies=await read(root,dir+'runtime-copies.json');check(copies.afterRuntimeClose===true&&copies.copies.some(c=>c.path.endsWith('/journal.db')),'SQLITE_VERIFIED_COPY');
    for(const r of copies.copies){const b=await probeFile(root,dir+r.path);check(b.length===r.bytes&&sha256(b)===r.sha256,'RUNTIME_COPY_HASH');}
    const traceRef=copies.copies.find(r=>r.path.endsWith('/'+report.arm.trace.path)),propsRef=copies.copies.find(r=>r.path.endsWith('/'+report.arm.props.path));check(traceRef?.sha256===report.arm.trace.sha256&&propsRef?.sha256===report.arm.props.sha256,'SUBJECT_TRACE_REFS');
    if(traceRef&&propsRef)check(same(await read(root,dir+traceRef.path,64*1024*1024),raw.trace)&&same(await read(root,dir+propsRef.path,64*1024*1024),raw.props),'SUBJECT_TRACE_BYTES');
    if(spec.kind==='worker_loss'){const a=analyseWire(wire);check(a.spawned.length===1&&a.spawned[0]===raw.injection.pid&&!wire.some(e=>e.event==='ack'&&e.atMs>raw.injection.atMs&&e.value.ok),'NO_POST_LOSS_ACK');}
   }else if(spec.kind==='bad_state'){
    for(const name of ['before-state.npz','injected-state.npz','after-state.npz','compiled.xml','requests.json','responses.json'])check(refs.some(r=>r.path===dir+'engine/'+name),'BAD_STATE_RAW:'+name);
    const responses=await read(root,dir+'engine/responses.json');check(same(responses.at(-2),raw.response)&&same(responses.at(-1),raw.postFault),'BAD_STATE_RESPONSE_BYTES');
   }else if(spec.kind==='m00')check(same(await read(root,dir+'engine/trace-'+spec.seed+'.json',64*1024*1024),raw.trace),'M00_RAW_TRACE');
  }catch(e){issues.push('CASE_UNREADABLE:'+spec.id+':'+e.message);}}
 }catch(e){issues.push('PROBE_UNREADABLE:'+e.message);}
 return {passed:issues.length===0,issues,subject:manifest?.subject??null,qualification:issues.length?'not_qualified':'passed',accepted:false,dynamics:'not_calibrated'};
}

export async function readMujocoProbeSupplement(root){
 const manifest=await read(root,'manifest.json'),artifacts=await probeArtifacts(root);
 if(manifest.schemaVersion!==1||manifest.kind!=='mujoco-native-probe'||manifest.accepted!==false||!same(artifacts,manifest.artifacts)||!['passed','failed','incomplete','not_run'].includes(manifest.qualification))throw Error('PROBE_SUPPLEMENT_INVALID');
 const verdict=await verifyMujocoProbe(root);
 if(manifest.qualification==='passed'&&!verdict.passed)throw Error('PROBE_SUPPLEMENT_INVALID:'+verdict.issues.join(','));
 if(!manifest.subject||!same(Object.fromEntries(Object.keys(baseline.subject).map(k=>[k,manifest.subject[k]])),baseline.subject))throw Error('PROBE_SUPPLEMENT_INVALID:SUBJECT');
 return {status:manifest.qualification,DEP_MJ_01:verdict.passed?'passed':manifest.qualification==='passed'?'not_run':manifest.qualification,subject:manifest.subject,checker:manifest.checker,manifestSha256:sha256(await probeFile(root,'manifest.json')),accepted:false,dynamics:'not_calibrated',issues:verdict.issues};
}
export async function copyMujocoProbeSupplement(input,out){
 const summary=await readMujocoProbeSupplement(input),manifest=await read(input,'manifest.json');await mkdir(out,{mode:0o700});
 for(const r of manifest.artifacts){const b=await probeFile(input,r.path);if(b.length!==r.bytes||sha256(b)!==r.sha256)throw Error('PROBE_CHANGED');await mkdir(dirname(join(out,r.path)),{recursive:true});await writeFile(join(out,r.path),b,{flag:'wx',mode:0o600});}
 const b=await probeFile(input,'manifest.json');if(sha256(b)!==summary.manifestSha256)throw Error('PROBE_CHANGED');await writeFile(join(out,'manifest.json'),b,{flag:'wx'});await readMujocoProbeSupplement(out);return summary;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const args=process.argv.slice(2),o={};for(let i=0;i<args.length;i+=2){if(!['--handoff','--out','--verify'].includes(args[i])||!args[i+1]||o[args[i]])throw Error('USAGE: mujoco-probe.mjs --handoff DIR --out NEW_DIR | --verify DIR');o[args[i]]=resolve(args[i+1]);}if(o['--verify']?Object.keys(o).length!==1:!o['--handoff']||!o['--out'])throw Error('MISSING_ARGUMENT');const sourceCommit=await checkedCheckerCommit(),checker={sourceCommit,toolSha256:sha256(await readFile(fileURLToPath(import.meta.url)))};const abort=new globalThis.AbortController();for(const s of ['SIGINT','SIGTERM','SIGHUP','SIGALRM'])process.once(s,()=>abort.abort());const result=o['--verify']?await verifyMujocoProbe(o['--verify']):await runMujocoProbe({handoff:o['--handoff'],out:o['--out'],checker,signal:AbortSignal.any([abort.signal,AbortSignal.timeout(1500000)])});if(await checkedCheckerCommit()!==sourceCommit)throw Error('CHECKER_CHANGED_DURING_PROBE');console.log(json(result));process.exitCode=o['--verify']?(result.passed?0:1):result.DEP_MJ_01==='passed'?0:2;}catch(e){console.error(json({error:e.message,accepted:false,qualification:'not_run'}));process.exitCode=1;}
}
