// CLD01 / CLD02 producer for release r4 (plan V16): `node scripts/record-r4-container.mjs --out DIR [--cld02-result FILE --cld02-image sha256:...]`.
// CLD01: builds the linux/arm64 image from this clean commit and runs tests/integration/lab-runtime-container-r4.test.ts against it (it refuses an image of another commit itself). It never pushes or deploys.
// CLD02 needs the Python tests of the tool root to pass in a linux/amd64 image on a native x86-64 host (scripts/r4-cld02.sh); the Runtime image carries no tests, and emulation is not the proof, so without --cld02-result it is
// recorded not_run with that reason. An amd64 build that succeeded is noted, it does not turn the case into a pass.
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,existsSync,copyFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),sha=b=>createHash('sha256').update(b).digest('hex');
const args=process.argv.slice(2),o={};for(let i=0;i<args.length;i+=2){if(!['--out','--cld02-result','--cld02-image','--skip-amd64-build'].includes(args[i])||!args[i+1]){console.error('INVALID_OPTION:'+args[i]);process.exit(2);}o[args[i].slice(2)]=args[i+1];}
if(!o.out){console.error('MISSING_OPTION:--out');process.exit(2);}
const out=resolve(o.out);if(existsSync(out)){console.error('OUT_EXISTS');process.exit(2);}
const git=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8'}).trim();
if(git('status','--porcelain','--untracked-files=all')){console.error('SOURCE_DIRTY');process.exit(2);}
const commit=git('rev-parse','HEAD'),tag=`mekoniq-lab-runtime:r4-${commit.slice(0,8)}`;mkdirSync(out,{recursive:true});
const run=(cmd,a,env={})=>{const r=spawnSync(cmd,a,{cwd:root,encoding:'utf8',env:{...process.env,...env},maxBuffer:64*1024*1024,timeout:3*3600*1000});return {code:r.status,out:(r.stdout??'')+(r.stderr??'')};};
const record={schemaVersion:1,accepted:false,sourceCommit:commit};
const build=run('sh',['deploy/lab-runtime/build.sh',tag,'--platform','linux/arm64']);writeFileSync(join(out,'cld01-build.log'),build.out);
if(build.code!==0)record.cld01={status:'failed',reason:'IMAGE_BUILD_FAILED',sourceCommit:commit};
else{
 const result=join(out,'cld01.json'),t=run(process.execPath,['node_modules/vitest/vitest.mjs','run','tests/integration/lab-runtime-container-r4.test.ts','--reporter=default','--reporter=json','--outputFile='+result],{LAB_CONTAINER_IMAGE:tag});writeFileSync(join(out,'cld01-test.log'),t.out);
 const imageId=JSON.parse(run('docker',['image','inspect',tag]).out)[0].Id;
 record.cld01=t.code===0&&existsSync(result)?{status:'tested',platform:'linux/arm64',imageTag:tag,imageId,sourceCommit:commit,result:{file:'cld01.json',sha256:sha(readFileSync(result))}}:{status:'failed',reason:'CONTAINER_TEST_FAILED',sourceCommit:commit};
}
if(o['cld02-result']){copyFileSync(resolve(o['cld02-result']),join(out,'cld02.json'));record.cld02={status:'tested',platform:'linux/amd64',imageId:o['cld02-image'],sourceCommit:commit,result:{file:'cld02.json',sha256:sha(readFileSync(join(out,'cld02.json')))}};}
else{
 let note='amd64 build skipped';
 if(!o['skip-amd64-build']){const b=run('sh',['deploy/lab-runtime/build.sh',`mekoniq-lab-runtime:r4-amd64-${commit.slice(0,8)}`,'--platform','linux/amd64']);writeFileSync(join(out,'cld02-amd64-build.log'),b.out);note=b.code===0?'the linux/amd64 image built from this commit (under emulation); this is not the Python-test proof':'the linux/amd64 image build failed: see cld02-amd64-build.log';}
 record.cld02={status:'not_run',reason:'native_linux_x86_64_host_required (scripts/r4-cld02.sh); '+note};
}
writeFileSync(join(out,'container.json'),JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify({out,cld01:record.cld01.status,cld02:record.cld02.status}));process.exit(record.cld01.status==='tested'?0:1);
