import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {boundedEvidenceRead,evidenceInventory} from './r2b-readback.mjs';
import {checkR2bExecutedFiles} from './sim-extension-r2b.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex'),digest=/^[a-f0-9]{64}$/;
const file='tests/integration/lab-runtime-container-r4.test.ts';
const titles=[
 'CLD01: MJ-CELL-BV01 on drive-nominal-v1 completes and serves 2, a scheduled drive fault reports its receipts, the three-cup tray serves 3, and a wheel bench step completes and frees the slot, inside the image; read-only root, empty diff, not root, ports on 127.0.0.1 only',
 'CLD01 (R4.4): MJ-CELL-BV01 at belief_estimated with the nominal perception profile and the recovery policy completes and serves 2 inside the image, its report carries the perception evidence, and a belief mode on the arm-only scenario is refused'
];
export function checkArmContainer(root,entry,bytes,pin){
 const issues=checkR2bExecutedFiles({id:'cld01',files:[file]},bytes);
 try{
  const data=JSON.parse(bytes),tests=data.testResults[0].assertionResults;
  if(data.success!==true||data.numFailedTests!==0||data.numPendingTests!==0||(data.numTodoTests??0)!==0||
    data.numPassedTests!==tests.length||data.numTotalTests!==tests.length||titles.some(t=>tests.filter(a=>a.title===t&&a.status==='passed').length!==1))issues.push('CLD01_RESULT_NOT_GREEN');
  const log=boundedEvidenceRead(root,'inputs/container/cld01-test.log').toString(),receipts=[...log.matchAll(/^CLD01 identity (.+)$/gm)].map(m=>JSON.parse(m[1]));
  if(receipts.length!==2||!receipts.every(r=>r.host?.os==='Darwin'&&r.host.machine==='arm64'&&r.host.daemonPlatform==='linux/arm64'&&r.platform==='linux/arm64'&&r.platform===entry.platform&&
   r.image==='mekoniq-lab-runtime:r4-'+entry.sourceCommit.slice(0,8)&&r.image===entry.imageTag&&r.imageId===entry.imageId&&/^sha256:[a-f0-9]{64}$/.test(r.imageId)&&r.sourceCommit===entry.sourceCommit&&
   digest.test(r.schemaHash)&&digest.test(r.artifactSha256)&&(!pin||r.schemaHash===pin.schemaHash&&r.artifactSha256===pin.artifactSha256)))issues.push('CLD01_IMAGE_RUNTIME_MISMATCH');
 }catch{issues.push('CLD01_RESULT_INVALID');}
 return issues;
}

const nativeSteps=['install','export','build','guest','capture','pytest','receipt'];
const wireCases=['mobile-no-drive','mobile-cil','arm-no-drive'],legacy=['mobile','arm','world'];
const required=['host.txt','image.json','image-file-hashes.txt','runtime-manifest.json','qualification-exit.txt','pytest/full.xml','pytest/collection.json','baseline-trees.txt','baseline/legacy-digests.json',
 ...nativeSteps.flatMap(k=>[k+'.log',k+'-exit.txt']),...wireCases.map(k=>'baseline/'+k+'.ndjson'),...legacy.map(k=>'baseline/legacy-'+k+'.npz')];
const check=(ok,code)=>{if(!ok)throw Error('CLD02_'+code);};
// The checksum table is produced by sha256sum on the native host. Compare every row against an independently enumerated file.
export function readNativeContainer(dir,expectedSource,pin){
 const read=path=>boundedEvidenceRead(dir,path),sums=read('SHA256SUMS'),listed=new Map();
 for(const line of sums.toString().trimEnd().split('\n')){
  const m=/^([a-f0-9]{64}) {2}\.\/(.+)$/.exec(line);check(m&&!listed.has(m[2]),'CHECKSUM_TABLE');listed.set(m[2],m[1]);
 }
 const inventory=evidenceInventory(dirname(dir),basename(dir)).map(f=>({...f,file:f.file.slice(basename(dir).length+1)})).filter(f=>f.file!=='SHA256SUMS');
 check(inventory.length===listed.size&&inventory.every(f=>listed.get(f.file)===f.sha256)&&required.every(f=>listed.has(f))&&!listed.has('refusal.txt'),'CHECKSUM_INVENTORY');
 const host=read('host.txt').toString(),field=k=>{const matches=host.split('\n').filter(s=>s.startsWith(k+'='));return matches.length===1?matches[0].slice(k.length+1):null;};
 const sourceCommit=field('source'),platform=field('daemon');
 check(sourceCommit===expectedSource&&/^[a-f0-9]{40}$/.test(sourceCommit),'SOURCE');
 check(/^Linux [^\n]+\bx86_64\b[^\n]*$/m.test(host)&&['X64','local'].includes(field('runner_arch'))&&platform==='linux/amd64'&&/^unix:\/\/\/[^\s]+$/.test(field('docker_endpoint')??''),'HOST');
 check(field('worker')==='a93ae08d95e07e4d0e633cb01aaf848603a0fc51'&&field('corpus')==='edb11dd990958fbea5250d1d8e6b932b5a39bf5c','BASELINE_SOURCE');
 if(listed.has('run.txt')){const run=read('run.txt').toString();check(run.split('\n').includes('sha='+sourceCommit)&&run.split('\n').includes('arch=X64')&&run.split('\n').includes('url='+field('run')),'RUN_IDENTITY');}
 const image=JSON.parse(read('image.json')),runtime=JSON.parse(read('runtime-manifest.json'));
 check(image.revision===sourceCommit&&image.Os+'/'+image.Architecture===platform&&/^sha256:[a-f0-9]{64}$/.test(image.Id),'IMAGE');
 const lock=runtime.portableSimulationTools?.tools?.find(t=>t.id==='mujoco_worker')?.lock;
 check(runtime.sourceCommit===sourceCommit&&runtime.dirty===false&&runtime.entrypoint==='runtime.mjs'&&digest.test(runtime.artifactSha256)&&digest.test(runtime.schemaHash)&&
  (!pin||runtime.artifactSha256===pin.artifactSha256&&runtime.schemaHash===pin.schemaHash)&&lock?.path==='robotics/simulation-mujoco/requirements.lock'&&digest.test(lock.sha256),'RUNTIME');
 check(read('image-file-hashes.txt').toString().trimEnd()===runtime.artifactSha256+'  /app/runtime.mjs\n'+lock.sha256+'  /app/'+lock.path,'IMAGE_HASHES');
 const guest=read('guest.log').toString();
 check(/^Linux-[^\n]*\bx86_64\b[^\n]* 3\.11\./m.test(guest)&&guest.split('\n').includes('mujoco requirements.lock sha256 '+lock.sha256),'GUEST_IDENTITY');
 const baseline=JSON.parse(read('baseline/legacy-digests.json'));check(baseline.platform?.[0]==='Linux'&&baseline.platform[1]==='x86_64'&&legacy.every(k=>digest.test(baseline.digests?.[k])),'BASELINES');
 check(['qualification',...nativeSteps].every(k=>/^0\n?$/.test(read(k+'-exit.txt').toString())),'PROCESS_EXIT');
 const input=JSON.stringify({xml:read('pytest/full.xml').toString(),collection:JSON.parse(read('pytest/collection.json')),sourceCommit,imageId:image.Id});
 const junit=spawnSync('python3',['-B',fileURLToPath(new URL('./check-r4-cld02.py',import.meta.url)),'receipt','-'],{input,timeout:30000,encoding:'utf8'});
 check(junit.status===0,'PYTEST_RECEIPT');
 return {status:'tested',sourceCommit,platform,imageId:image.Id,result:{file:'cld02/SHA256SUMS',sha256:sha(sums)}};
}
