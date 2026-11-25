// CLD04 and CLD05 of R5.4 (docs/operations/r5-qualification.md). CLD04 builds the linux/arm64 image from the clean tree and runs tests/integration/r5-container.test.ts against it
// (the three options compile in the container and equal the host; an emergency stop on the real worker; read-only root, empty diff, not root). CLD05 builds linux/amd64 from the same
// commit; its Python tests on a native x86-64 host are a separate run (GitHub Actions on a pushed branch) and stay `not_run` here. CLD06 is never run by this script.
// node scripts/record-r5-container.mjs --out <fresh dir> [--skip-amd64-build]    writes container.json (accepted:false)
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceCommit,sourceDirty} from './repo-identity.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),sha=b=>createHash('sha256').update(b).digest('hex');
const args=process.argv.slice(2),o={};for(let i=0;i<args.length;i++){if(args[i]==='--skip-amd64-build'){o.skip=true;continue;}if(args[i]!=='--out'||!args[i+1]){console.error('INVALID_OPTION:'+args[i]);process.exit(2);}o.out=args[++i];}
if(!o.out){console.error('MISSING_OPTION:--out');process.exit(2);}
const out=resolve(o.out);if(existsSync(out)){console.error('OUT_EXISTS');process.exit(2);}
if(sourceDirty(root)){console.error('SOURCE_DIRTY');process.exit(2);}
const commit=sourceCommit(root),tag=`mekoniq-lab-runtime:r5-${commit.slice(0,8)}`;
mkdirSync(out,{recursive:true});
const run=(cmd,a,env={})=>{const r=spawnSync(cmd,a,{cwd:root,encoding:'utf8',env:{...process.env,...env},maxBuffer:64*1024*1024,timeout:3*3600*1000});return {code:r.status,out:(r.stdout??'')+(r.stderr??'')};};
const record={schemaVersion:1,accepted:false,sourceCommit:commit};
const build=run('sh',['deploy/lab-runtime/build.sh',tag,'--platform','linux/arm64']);writeFileSync(join(out,'cld04-build.log'),build.out);
if(build.code!==0)record.cld04={status:'failed',reason:'IMAGE_BUILD_FAILED',sourceCommit:commit};
else{
 const result=join(out,'cld04.json'),log=join(out,'cld04-test.json');
 const t=run(process.execPath,['node_modules/vitest/vitest.mjs','run','tests/integration/r5-container.test.ts','--reporter=json','--outputFile='+log],{LAB_CONTAINER_IMAGE:tag,LAB_CLD04_OUT:result});
 record.cld04=t.code===0&&existsSync(result)?{status:'tested',platform:'linux/arm64',imageTag:tag,sourceCommit:commit,evidence:{file:'cld04.json',sha256:sha(readFileSync(result))},testLog:{file:'cld04-test.json',sha256:sha(readFileSync(log))}}:{status:'failed',reason:'CONTAINER_TEST_FAILED',sourceCommit:commit};
 if(existsSync(result))record.options=JSON.parse(readFileSync(result,'utf8')).options;
}
let note='amd64 build skipped';
if(!o.skip){const b=run('sh',['deploy/lab-runtime/build.sh',`mekoniq-lab-runtime:r5-amd64-${commit.slice(0,8)}`,'--platform','linux/amd64']);writeFileSync(join(out,'cld05-amd64-build.log'),b.out);note=b.code===0?'amd64 image built (emulated; not run)':'amd64 image build FAILED';}
record.cld05={status:'not_run',reason:'native_linux_x86_64_host_required (Python tests of the tool roots on GitHub Actions after a pushed branch); '+note};
record.cld06={status:'not_run',reason:'deploy_order_pending'};
writeFileSync(join(out,'container.json'),JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify({out,cld04:record.cld04.status,cld05:record.cld05.status,cld06:record.cld06.status}));process.exit(record.cld04.status==='tested'?0:1);
