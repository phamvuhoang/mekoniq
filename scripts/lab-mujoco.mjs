#!/usr/bin/env node
/* global AbortController */
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {tsImport} from 'tsx/esm/api';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const usage=()=>{console.error('usage: lab-mujoco.mjs run --campaign payload-v1|mj-cell-bv01-v1|cil-v1 --out DIR [--case REGISTERED_ID] | verify --input DIR');process.exit(2);};
const [command,...args]=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){const key=args[i],value=args[i+1];if(!['--campaign','--out','--input','--case'].includes(key)||!value||value.startsWith('--')||options[key])usage();options[key]=value;}
if(command==='run'?(!['payload-v1','mj-cell-bv01-v1','cil-v1'].includes(options['--campaign'])||!options['--out']||options['--input']):command!=='verify'||!options['--input']||options['--out']||options['--campaign']||options['--case'])usage();
try{
 const {runPayloadCampaign,verifyPayloadCampaign}=await tsImport('../packages/lab-runtime/src/v2/simulation3d/payload-campaign.ts',import.meta.url);
 const {runCellCampaign,verifyCellCampaign}=await tsImport('../packages/lab-runtime/src/v2/simulation3d/cell-campaign.ts',import.meta.url);
 const {runCilCampaign,verifyCilCampaign}=await tsImport('../packages/lab-runtime/src/v2/control/cil-campaign.ts',import.meta.url);
 const abort=new AbortController();for(const name of ['SIGINT','SIGTERM','SIGHUP'])process.once(name,()=>abort.abort());
 let verdict;
 if(command==='verify'){const {readFile}=await import('node:fs/promises');const doc=JSON.parse(await readFile(resolve(options['--input'],'campaign.json'),'utf8'));verdict=await(doc.campaign?.id==='cil-v1'?verifyCilCampaign:doc.campaign?.id==='mj-cell-bv01-v1'?verifyCellCampaign:verifyPayloadCampaign)(resolve(options['--input']));}
 else{
  const git=(...args)=>spawnSync('git',args,{cwd:root,encoding:'utf8'});
  const head=git('rev-parse','HEAD').stdout.trim(),dirty=git('status','--porcelain','--untracked-files=all').stdout.trim();
  const probe=spawnSync(resolve(root,'.venv-mujoco/bin/python'),['-c','import mujoco; assert mujoco.__version__ == "3.17.0"'],{cwd:root,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},timeout:15000});
  if(probe.status!==0){console.error('MUJOCO_PREREQUISITE_MISSING');process.exit(2);}
  if(options['--campaign']==='cil-v1'&&dirty){console.error('CIL_CLEAN_TREE_REQUIRED');process.exit(2);}   // the recording is bound to a commit: a dirty tree is a missing condition
  verdict=await (options['--campaign']==='cil-v1'?runCilCampaign:options['--campaign']==='mj-cell-bv01-v1'?runCellCampaign:runPayloadCampaign)({root,out:resolve(options['--out']),sourceCommit:head+(dirty?'-dirty':''),caseId:options['--case'],signal:abort.signal});
 }
 console.log(JSON.stringify(verdict,null,2));process.exitCode=verdict.completedCases===verdict.expectedRuns&&!verdict.issues.length&&!verdict.missingArtifacts.length&&(verdict.equivalence??[]).every(e=>e.bitIdentical)&&(verdict.faultCases??[]).every(c=>c.detected&&!c.falseServed)?0:1;
}catch(e){console.error(e.stack??String(e));process.exitCode=1;}
