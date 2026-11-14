#!/usr/bin/env node
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {tsImport} from 'tsx/esm/api';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const usage=()=>{console.error('usage: lab-mujoco.mjs run --campaign payload-v1 --out DIR | verify --input DIR');process.exit(2);};
const [command,...args]=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){const key=args[i],value=args[i+1];if(!['--campaign','--out','--input'].includes(key)||!value||value.startsWith('--')||options[key])usage();options[key]=value;}
if(command==='run'?(options['--campaign']!=='payload-v1'||!options['--out']||options['--input']):command!=='verify'||!options['--input']||options['--out']||options['--campaign'])usage();
try{
 const {runPayloadCampaign,verifyPayloadCampaign}=await tsImport('../packages/lab-runtime/src/v2/simulation3d/payload-campaign.ts',import.meta.url);
 let verdict;
 if(command==='verify')verdict=await verifyPayloadCampaign(resolve(options['--input']));
 else{
  const git=(...args)=>spawnSync('git',args,{cwd:root,encoding:'utf8'});
  const head=git('rev-parse','HEAD').stdout.trim(),dirty=git('status','--porcelain','--untracked-files=all').stdout.trim();
  const probe=spawnSync(resolve(root,'.venv-mujoco/bin/python'),['-c','import mujoco; assert mujoco.__version__ == "3.17.0"'],{cwd:root,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},timeout:15000});
  if(probe.status!==0){console.error('MUJOCO_PREREQUISITE_MISSING');process.exit(2);}
  verdict=await runPayloadCampaign({root,out:resolve(options['--out']),sourceCommit:head+(dirty?'-dirty':'')});
 }
 console.log(JSON.stringify(verdict,null,2));process.exitCode=verdict.completedCases===verdict.expectedRuns&&!verdict.issues.length&&!verdict.missingArtifacts.length?0:1;
}catch(e){console.error(e.stack??String(e));process.exitCode=1;}
