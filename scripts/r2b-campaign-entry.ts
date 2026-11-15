import {execFileSync} from 'node:child_process';
/** Bundled into the subject image from the clean source tree. No ambient checkout imports. */
import {readFile,readdir,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runPayloadCampaign,verifyPayloadCampaign} from '../packages/lab-runtime/src/v2/simulation3d/payload-campaign';
import {runCellCampaign,verifyCellCampaign} from '../packages/lab-runtime/src/v2/simulation3d/cell-campaign';
const base=dirname(fileURLToPath(import.meta.url)),identity=JSON.parse(await readFile(join(base,'r2b-campaign-package.json'),'utf8')),sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
if(sha(await readFile(fileURLToPath(import.meta.url)))!==identity.bundleSha256)throw Error('CAMPAIGN_BUNDLE_HASH');
const listed=new Set<string>(identity.imageFiles.map((f:{path:string})=>f.path));async function walk(relative:string){for(const name of await readdir(join(base,relative))){const path=relative+'/'+name,st=await lstat(join(base,path));if(st.isSymbolicLink())throw Error('CAMPAIGN_IMAGE_SYMLINK');if(st.isDirectory())await walk(path);else if(!listed.has(path))throw Error('CAMPAIGN_IMAGE_EXTRA:'+path);}}await walk('robotics/simulation-mujoco');await walk('packages/contracts/schemas');
for(const ref of identity.imageFiles){if(sha(await readFile(join(base,ref.path)))!==ref.sha256)throw Error('CAMPAIGN_IMAGE_CLOSURE:'+ref.path);}
if(sha(await readFile(join(base,'r2b-engine-inventory.py')))!==identity.engineObserverSha256)throw Error('ENGINE_OBSERVER_HASH');
if(sha(await readFile(join(base,'runtime.mjs')))!==identity.runtimeArtifactSha256)throw Error('CAMPAIGN_RUNTIME_HASH');
const [command,...args]=process.argv.slice(2),options:Record<string,string>={};for(let i=0;i<args.length;i+=2){if(!['--campaign','--out','--input','--case'].includes(args[i]!)||!args[i+1]||options[args[i]!])throw Error('CAMPAIGN_ARGUMENT');options[args[i]!]=args[i+1]!;}
if(command==='identity'){if(args.length)throw Error('CAMPAIGN_ARGUMENT');const engine=JSON.parse(execFileSync('/opt/venv-mujoco/bin/python',['-I','-B',join(base,'r2b-engine-inventory.py')],{encoding:'utf8',timeout:30000}));console.log(JSON.stringify({package:identity,engine,node:process.version,architecture:process.arch}));}
else{
 const cell=options['--campaign']==='mj-cell-bv01-v1';if(!cell&&options['--campaign']!=='payload-v1')throw Error('CAMPAIGN_REQUIRED');
 const verdict=command==='run'&&options['--out']&&!options['--input']?await(cell?runCellCampaign:runPayloadCampaign)({root:base,out:options['--out'],sourceCommit:identity.sourceCommit,python:'/opt/venv-mujoco/bin/python',caseId:options['--case']}):command==='verify'&&options['--input']&&!options['--out']?await(cell?verifyCellCampaign:verifyPayloadCampaign)(options['--input']):null;
 if(!verdict)throw Error('CAMPAIGN_ARGUMENT');console.log(JSON.stringify(verdict));process.exitCode=verdict.completedCases===verdict.expectedRuns&&!verdict.issues.length&&!verdict.missingArtifacts.length?0:1;
}
