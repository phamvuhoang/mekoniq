/* eslint-disable @typescript-eslint/no-explicit-any -- synthetic evidence documents, mutated at the evidence boundary */
// CLD04/CLD05 read back offline: a synthetic native x86-64 directory (the shape scripts/r5-cld05.sh writes) and a container record, checked by the same reader the R5 record uses.
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {afterAll,beforeAll,expect,test} from 'vitest';
// @ts-expect-error plain ESM script
import {readR5Native,verifyContainerInput,hostCldBundles,CLD_PROJECT,CLD_STOP_ENTRY} from '../../scripts/r5-readback.mjs';

const sha=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const source='a'.repeat(40),imageId='sha256:'+'1'.repeat(64),armId='sha256:'+'2'.repeat(64),invocation='0123456789abcdef0123456789abcdef',schemaHash='d'.repeat(64),artifactSha256='b'.repeat(64),lock='c'.repeat(64);
const url='https://github.com/owner/repo/actions/runs/123/attempts/1';
const roster=readFileSync('scripts/native-sim/r5-cld05-pytest-roster.txt','utf8').trimEnd().split('\n');
const ARM64_ONLY=['test_worker_responses_match_the_pre_fix_wire_bytes','test_the_legacy_path_gives_the_three_recorded_digests'];
let host:any;const dirs:string[]=[];const temp=(p:string)=>{const d=mkdtempSync(join(tmpdir(),p));dirs.push(d);return d;};
beforeAll(async()=>{host=await hostCldBundles();},120_000);
afterAll(()=>{for(const d of dirs)rmSync(d,{recursive:true,force:true});});
const evidence=(platform:string,id:string)=>({schemaVersion:2,image:'tag',imageId:id,platform,host:{platform:'linux',arch:'x64'},sourceCommit:source,schemaHash,project:{...structuredClone(CLD_PROJECT),digest:host.projectDigest},
 options:Object.fromEntries(Object.entries(host.options).map(([k,v]:[string,any])=>[k,{...v,projectDigest:host.projectDigest,assemblyDigest:'e'.repeat(64)}])),
 stop:{entry:CLD_STOP_ENTRY,function:'emergency',scheduledTick:412,tick:412,status:'needs_attention',served:'0',outcomeTick:412,attention:[{reason:'EMERGENCY_STOP',tick:412}]},diff:[],diffEmpty:true,uid:'1000'});
function nativeFiles(){
 const esc=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 const skipped=roster.filter(id=>ARM64_ONLY.some(n=>id.includes('::'+n)));
 const rows=roster.map(id=>{const [file,name]=id.split('::');return `<testcase classname="${file!.replaceAll('/','.').replace(/\.py$/,'')}" name="${esc(name!)}">${skipped.includes(id)?'<skipped message="arm64 only"/>':''}</testcase>`;}).join('');
 const props=Object.entries({cld02Source:source,cld02Image:imageId,cld02Invocation:invocation}).map(([n,v])=>`<property name="${n}" value="${v}"/>`).join('');
 const files:Record<string,string>={
  'run.txt':`sha=${source}\nrunner=GitHub Actions 2\narch=X64\nurl=${url}\n`,
  'host.txt':`source=${source}\nhead=${source}\nrunner=GitHub Actions 2\nrunner_arch=X64\nrun=${url}\nLinux fv-az 6.8.0-1017-azure #20-Ubuntu SMP x86_64 GNU/Linux\ndocker_endpoint=unix:///var/run/docker.sock\ndaemon=linux/amd64\n`,
  'image.json':JSON.stringify({Id:imageId,Os:'linux',Architecture:'amd64',revision:source}),
  'runtime-manifest.json':JSON.stringify({sourceCommit:source,dirty:false,artifactSha256,schemaHash,portableSimulationTools:{tools:[{id:'mujoco_worker',lock:{path:'robotics/simulation-mujoco/requirements.lock',sha256:lock}}]}}),
  'qualification-exit.txt':'0\n','guest.log':'Linux-6.8.0-x86_64-with-glibc2.36 3.11.9 /opt/venv-mujoco/bin/python\nmujoco requirements.lock sha256 '+lock+'\n',
  'pytest/collection.json':JSON.stringify({schemaVersion:1,sourceCommit:source,imageId,invocationId:invocation,nodeIds:roster}),
  'pytest/full.xml':`<testsuites><testsuite tests="${roster.length}" errors="0" failures="0" skipped="${skipped.length}"><properties>${props}</properties>${rows}</testsuite></testsuites>`,
  'container/cld05.json':JSON.stringify(evidence('linux/amd64',imageId)),
  'container/test.json':JSON.stringify({success:true,numFailedTests:0,numPendingTests:0,numPassedTests:1,testResults:[{name:'/home/runner/work/mekoniq/mekoniq/tests/integration/r5-container.test.ts',assertionResults:[{status:'passed'}]}]}),
 };
 for(const s of ['install','export','build','guest','pytest','container','receipt']){files[s+'-exit.txt']='0\n';files[s+'.log']??='';}
 return files;
}
function write(dir:string,files:Record<string,string>){
 for(const [p,b] of Object.entries(files)){mkdirSync(dirname(join(dir,p)),{recursive:true});writeFileSync(join(dir,p),b);}
 writeFileSync(join(dir,'SHA256SUMS'),Object.keys(files).sort().map(p=>`${sha(files[p]!)}  ./${p}`).join('\n')+'\n');
}
const native=(mutate?:(f:Record<string,string>)=>void)=>{const dir=temp('r5-native-'),f=nativeFiles();mutate?.(f);write(join(dir,'cld05'),f);return join(dir,'cld05');};

test('a complete native run reads back with its tuple, image digest, workflow run and test counts',()=>{
 const r=readR5Native(native(),source,{artifactSha256,schemaHash});
 expect(r).toMatchObject({status:'tested',platform:'linux/amd64',sourceCommit:source,imageId,workflowRun:url,tests:{pytest:{tests:roster.length,passed:roster.length-4,skipped:expect.any(Array)},container:{passed:1}}});
 expect(r.tests.pytest.skipped).toHaveLength(4);
});
test.each([
 ['another source','host.txt',(f:any)=>{f['host.txt']=f['host.txt'].replace('source='+source,'source='+'e'.repeat(40));}],
 ['a Lab pin commit as HEAD','host.txt',(f:any)=>{f['host.txt']=f['host.txt'].replace('head='+source,'head='+'e'.repeat(40));}],
 ['an arm64 host','host.txt',(f:any)=>{f['host.txt']=f['host.txt'].replace('runner_arch=X64','runner_arch=ARM64');}],
 ['a local run (no workflow URL)','host.txt',(f:any)=>{f['host.txt']=f['host.txt'].replace('run='+url,'run=local');}],
 ['a run.txt of another run','run.txt',(f:any)=>{f['run.txt']=f['run.txt'].replace('/runs/123/','/runs/124/');}],
 ['an arm64 image','image.json',(f:any)=>{f['image.json']=JSON.stringify({Id:imageId,Os:'linux',Architecture:'arm64',revision:source});}],
 ['a failed step','pytest-exit.txt',(f:any)=>{f['pytest-exit.txt']='1\n';}],
 ['a failed pytest case','pytest/full.xml',(f:any)=>{f['pytest/full.xml']=f['pytest/full.xml'].replace('</testcase>','<failure message="x"/></testcase>');}],
 ['a skip outside the arm64-only comparisons','pytest/full.xml',(f:any)=>{f['pytest/full.xml']=f['pytest/full.xml'].replace(/(<testcase classname="tests\.test_bench"[^>]*>)/,'$1<skipped/>').replace(/skipped="4"/,'skipped="5"');}],
 ['a shortened roster','pytest/collection.json',(f:any)=>{const c=JSON.parse(f['pytest/collection.json']);c.nodeIds.pop();f['pytest/collection.json']=JSON.stringify(c);}],
 ['a failed container test','container/test.json',(f:any)=>{f['container/test.json']=JSON.stringify({success:false,numFailedTests:1,numPendingTests:0,numPassedTests:0,testResults:[]});}],
 ['a refusal','refusal.txt',(f:any)=>{f['refusal.txt']='NATIVE_ARCH_REQUIRED';}],
] as const)('refuses %s',(_,__,mutate)=>{expect(()=>readR5Native(native(mutate),source,{artifactSha256,schemaHash})).toThrow(/^CLD05_/);});
test('a file changed after the checksums were written is refused',()=>{const dir=native();writeFileSync(join(dir,'image.json'),'{}');expect(()=>readR5Native(dir,source)).toThrow('CLD05_CHECKSUM_INVENTORY');});

async function containerCase(cld05:'native'|'missing'|'failed',mutate04?:(e:any)=>void,mutate05?:(f:Record<string,string>)=>void){
 const root=temp('r5-container-'),dir=join(root,'inputs/container');mkdirSync(dir,{recursive:true});
 const e04=evidence('linux/arm64',armId);mutate04?.(e04);const b04=JSON.stringify(e04);writeFileSync(join(dir,'cld04.json'),b04);
 const record:any={schemaVersion:2,accepted:false,sourceCommit:source,cld04:{status:'tested',platform:'linux/arm64',imageTag:'t',imageId:armId,sourceCommit:source,evidence:{file:'cld04.json',sha256:sha(b04)}},cld06:{status:'not_run',reason:'deploy_order_pending'}};
 if(cld05==='native'){const f=nativeFiles();mutate05?.(f);write(join(dir,'cld05'),f);const n=readR5Native(join(dir,'cld05'),source);delete n.evidence;record.cld05=n;}
 else record.cld05=cld05==='missing'?{status:'not_run',reason:'native_linux_x86_64_host_required'}:{status:'failed',reason:'AMD64_BUILD_FAILED'};
 const b=JSON.stringify(record);writeFileSync(join(dir,'container.json'),b);
 const m={inputs:{containerRecord:{file:'inputs/container/container.json',sha256:sha(b)}},lab:{pin:{schemaHash,artifactSha256}}};
 return verifyContainerInput(root,m,source);
}
test('CLD04 and CLD05 pass on the host\'s full digests; each case keeps its own issues',async()=>{
 expect(await containerCase('native')).toEqual({CLD04:[],CLD05:[]});
 expect(await containerCase('missing')).toEqual({CLD04:[],CLD05:['CLD05_NATIVE_MISSING:native_linux_x86_64_host_required']});
 expect(await containerCase('failed')).toEqual({CLD04:[],CLD05:['CLD05_FAILED:AMD64_BUILD_FAILED']});
},120_000);
test('a digest that differs from the host, another project, a stop off its scheduled tick and a root UID are refused',async()=>{
 expect((await containerCase('missing',e=>{e.options['serve-hw-c-v1'].digest='f'.repeat(64);})).CLD04).toEqual(['CLD04_DIGEST_MISMATCH:serve-hw-c-v1']);
 expect((await containerCase('missing',e=>{e.project.overrides.mujocoExperimentId='tray-stop-brake-v1';})).CLD04).toContain('CLD04_PROJECT_MISMATCH');
 expect((await containerCase('missing',e=>{e.stop.tick=413;})).CLD04).toEqual(['CLD04_STOP']);
 expect((await containerCase('missing',e=>{e.uid='0';})).CLD04).toEqual(['CLD04_ISOLATION']);
 expect((await containerCase('native',undefined,f=>{const e=JSON.parse(f['container/cld05.json']!);e.options['serve-hw-b-v1'].digest='f'.repeat(64);f['container/cld05.json']=JSON.stringify(e);})).CLD05).toEqual(['CLD05_DIGEST_MISMATCH:serve-hw-b-v1']);
},120_000);
