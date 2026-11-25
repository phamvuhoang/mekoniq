import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fullRoster,pytestArtifact,pytestIdentity} from '../support/r4-pytest-receipt';
import {afterEach,beforeEach,expect,test} from 'vitest';
// @ts-expect-error plain ESM script
import {verifyContainerRecord} from '../../scripts/r4-readback.mjs';

const {source,imageId,invocation}=pytestIdentity;
const artifactSha256='b'.repeat(64),schemaHash='d'.repeat(64),lock='c'.repeat(64);
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const cases=['mobile-no-drive','mobile-cil','arm-no-drive'];
const comparisons=[...cases.map(s=>['test_worker_protocol_regression','test_worker_responses_match_the_pre_fix_wire_bytes['+s+']']),['test_drive_engine','test_the_legacy_path_gives_the_three_recorded_digests']];
let root:string;
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'cld02-import-'));});
afterEach(()=>rmSync(root,{recursive:true,force:true}));
function receipt(){
 const files:Record<string,string>={
  'host.txt':`source=${source}\nworker=a93ae08d95e07e4d0e633cb01aaf848603a0fc51\ncorpus=edb11dd990958fbea5250d1d8e6b932b5a39bf5c\nrunner_arch=local\nLinux ci 6.8.0 x86_64 GNU/Linux\ndocker_endpoint=unix:///run/docker.sock\ndaemon=linux/amd64\n`,
  'image.json':JSON.stringify({Id:imageId,revision:source,Os:'linux',Architecture:'amd64'}),
  'runtime-manifest.json':JSON.stringify({sourceCommit:source,dirty:false,artifactSha256,schemaHash,entrypoint:'runtime.mjs',portableSimulationTools:{tools:[{id:'mujoco_worker',lock:{path:'robotics/simulation-mujoco/requirements.lock',sha256:lock}}]}}),
  'image-file-hashes.txt':`${artifactSha256}  /app/runtime.mjs\n${lock}  /app/robotics/simulation-mujoco/requirements.lock\n`,
  ...pytestArtifact(fullRoster),
  'baseline-trees.txt':'archived trees\n','qualification-exit.txt':'0\n','baseline/legacy-digests.json':JSON.stringify({platform:['Linux','x86_64','3.11.9','3.3.7','2.2.6'],digests:Object.fromEntries(['mobile','arm','world'].map(s=>[s,lock]))}),
 };
 for(const s of ['install','export','build','guest','capture','pytest','receipt']){files[s+'-exit.txt']='0\n';files[s+'.log']='';}
 files['guest.log']='Linux-6.8.0-x86_64-with-glibc2.36 3.11.9 /opt/venv-mujoco/bin/python\nmujoco requirements.lock sha256 '+lock+'\n';
 for(const s of cases)files['baseline/'+s+'.ndjson']='{}\n';
 for(const s of ['mobile','arm','world'])files['baseline/legacy-'+s+'.npz']='sample';
 return files;
}
async function check(files:Record<string,string>,corrupt=false){
 const put=(p:string,s:string)=>{const f=join(root,'inputs/container',p);mkdirSync(dirname(f),{recursive:true});writeFileSync(f,s);};
 const sums=Object.entries(files).map(([p,b])=>sha(b)+'  ./'+p).join('\n')+'\n';
 for(const [p,b] of Object.entries(files))put('cld02/'+p,b);if(corrupt)put('cld02/pytest.log','changed after sealing');
 put('cld02/SHA256SUMS',sums);
 const record=JSON.stringify({schemaVersion:1,accepted:false,sourceCommit:source,cld02:{status:'tested',platform:'linux/amd64',sourceCommit:source,imageId,result:{file:'cld02/SHA256SUMS',sha256:sha(sums)}}});
 put('container.json',record);
 return (await verifyContainerRecord(root,{lab:{pin:{artifactSha256,schemaHash}},inputs:{containerRecord:{file:'inputs/container/container.json',sha256:sha(record)}}},source)).cld02;
}
test('native host, image, runtime, required pytest comparisons, exit receipts and checksum inventory agree',async()=>{
 expect(await check(receipt())).toEqual([]);
});
test.each(['commit','host','image','runtime','worker','failed','skipped','exit','checksum','class','missing log','foreign guest','guest lock','totals'])('rejects native evidence with mismatched %s',async change=>{
 const f=receipt();
 if(change==='commit')f['host.txt']=f['host.txt']!.replace(source,'e'.repeat(40));
 if(change==='host')f['host.txt']=f['host.txt']!.replace('Linux ci','Darwin ci');
 if(change==='image')f['image.json']=f['image.json']!.replace('amd64','arm64');
 if(change==='foreign guest')f['guest.log']=f['guest.log']!.replace('x86_64','aarch64');
 if(change==='guest lock')f['guest.log']=f['guest.log']!.replace(lock,'e'.repeat(64));
 if(change==='totals')f['pytest/full.xml']=f['pytest/full.xml']!.replace('failures="0"','failures="1"');
 if(change==='runtime')f['image-file-hashes.txt']=f['image-file-hashes.txt']!.replace(artifactSha256,lock);
 if(change==='worker')f['pytest/full.xml']=f['pytest/full.xml']!.replace('mobile-cil','unrelated');
 if(change==='class')f['pytest/full.xml']=f['pytest/full.xml']!.replaceAll('test_worker_protocol_regression','test_other');
 if(change==='failed'||change==='skipped')f['pytest/full.xml']=f['pytest/full.xml']!.replace(/(<testcase [^>]+)\/>/,'$1><'+(change==='failed'?'failure':'skipped')+'/></testcase>');
 if(change==='exit')f['pytest-exit.txt']='1\n';if(change==='missing log')delete f['build.log'];
 expect(await check(f,change==='checksum')).not.toEqual([]);
});

test.each(['four only','paired truncation','one parametrization missing','duplicate case','other invocation','other image','other source','other collection','nested failed case'])('refuses digest-consistent %s full-suite evidence',async change=>{
 const f=receipt(),four=comparisons.map(([file,name])=>'tests/'+file+'.py::'+name);
 if(change==='four only')Object.assign(f,pytestArtifact(four,fullRoster));
 if(change==='paired truncation')Object.assign(f,pytestArtifact(four));
 if(change==='one parametrization missing'){
  const index=fullRoster.findIndex(x=>x.includes('[')&&x.includes('test_bench.py'));
  Object.assign(f,pytestArtifact(fullRoster.filter((_,i)=>i!==index)));
 }
 if(change==='duplicate case')Object.assign(f,pytestArtifact([...fullRoster,fullRoster[0]!]));
 if(change==='nested failed case')f['pytest/full.xml']=f['pytest/full.xml']!.replace('</testsuite>','<testsuite><testcase name="extra"><failure/></testcase></testsuite></testsuite>');
 if(change==='other invocation')f['pytest/full.xml']=f['pytest/full.xml']!.replace(invocation,'f'.repeat(32));
 if(change==='other image')f['pytest/collection.json']=f['pytest/collection.json']!.replace(imageId,'sha256:'+'f'.repeat(64));
 if(change==='other source')f['pytest/collection.json']=f['pytest/collection.json']!.replace(source,'f'.repeat(40));
 if(change==='other collection')Object.assign(f,pytestArtifact(fullRoster,four));
 expect(await check(f)).not.toEqual([]);
});
