#!/usr/bin/env node
/* global AbortController */
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {tsImport} from 'tsx/esm/api';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const usage=()=>{console.error('usage: lab-mujoco.mjs run --campaign payload-v1|mj-cell-bv01-v1|mj-cell-recovery-v2|cil-v2|bench-v2|fault-v1|tray-v1|perception-gap-v1 --out DIR [--case REGISTERED_ID] | verify --input DIR | bench --axis wheels|J1..J6|gripper --signal JSON --profile FILE --out DIR [--experiment DRIVE_EXPERIMENT_ID] [--seed N]');process.exit(2);};
const [command,...args]=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){const key=args[i],value=args[i+1];if(!['--campaign','--out','--input','--case','--axis','--signal','--profile','--experiment','--seed'].includes(key)||!value||value.startsWith('--')||options[key])usage();options[key]=value;}
const benchOnly=['--axis','--signal','--profile','--experiment','--seed'].some(k=>options[k]);
if(command==='bench'?(!options['--axis']||!options['--signal']||!options['--profile']||!options['--out']||options['--campaign']||options['--input']||options['--case']||options['--seed']&&!(/^\d{1,10}$/.test(options['--seed'])&&Number(options['--seed'])<=0xffffffff)):benchOnly||(command==='run'?(!['payload-v1','mj-cell-bv01-v1','mj-cell-recovery-v2','cil-v2','bench-v2','fault-v1','tray-v1','perception-gap-v1'].includes(options['--campaign'])||!options['--out']||options['--input']):command!=='verify'||!options['--input']||options['--out']||options['--campaign']||options['--case']))usage();
const git=(...args)=>spawnSync('git',args,{cwd:root,encoding:'utf8'});
const mujocoPresent=()=>spawnSync(resolve(root,'.venv-mujoco/bin/python'),['-c','import mujoco; assert mujoco.__version__ == "3.17.0"'],{cwd:root,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},timeout:15000}).status===0;
if(command==='bench'){
 // one single-axis bench (R4.2) in this process: exit 0 completed, 1 drive_fault, unstable or an incident, 2 a missing condition or a request the plant does not admit (it never ran)
 const {mkdtemp,readFile,readdir,rm,writeFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const out=resolve(options['--out']),missing=(code)=>{console.error(code);process.exit(2);};
 if(!mujocoPresent())missing('MUJOCO_PREREQUISITE_MISSING');
 if((await readdir(out).catch(()=>[])).length)missing('BENCH_OUT_NOT_EMPTY');
 let signal,controlProfile;try{signal=JSON.parse(options['--signal']);}catch{missing('BENCH_SIGNAL_NOT_JSON');}
 try{controlProfile=JSON.parse(await readFile(resolve(options['--profile']),'utf8'));}catch{missing('BENCH_PROFILE_UNREADABLE');}
 const axis=options['--axis'],scenarioId=axis==='wheels'?'MJ-BENCH-WHEEL':'MJ-BENCH-ARM',seed=Number(options['--seed']??7);
 const bench={schemaVersion:1,scenarioId,axis,signal,driveExperimentId:options['--experiment']??'drive-nominal-v1',controlProfile};
 const head=git('rev-parse','HEAD').stdout.trim(),dirty=git('status','--porcelain','--untracked-files=all').stdout.trim();
 const {mujocoFromOptions}=await tsImport('../packages/lab-runtime/src/v2/simulation3d/mujoco.ts',import.meta.url),{createBenchRun}=await tsImport('../packages/lab-runtime/src/v2/control/bench-runner.ts',import.meta.url);
 const workerRoot=resolve(root,'robotics/simulation-mujoco'),probe=await mkdtemp(join(tmpdir(),'lab-mujoco-bench-'));
 try{
  const p=await mujocoFromOptions({enabled:true,python:resolve(root,'.venv-mujoco/bin/python'),workerRoot,lockPath:join(workerRoot,'requirements.lock'),directory:probe,bundleFile:async()=>{throw Error('NO_BUNDLE');}});
  if(!p.arm.runtime)throw Object.assign(Error(`MUJOCO_PREREQUISITE_MISSING: ${p.arm.capability.reason}`),{missing:true});
  let run;
  try{run=await createBenchRun({project:undefined,scenarioId,scenarioRevision:1,seed,mode:'simulation',access:'simulated',backendSetId:'engineering-mujoco-bench-v1',sourceCommit:head+(dirty?'-dirty':''),bench},{directory:out,enabledBackends:['mujoco_3d','mujoco_arm'],runtime:p.arm.runtime});}
  catch(e){if(/^(INVALID_BENCH_REQUEST|BENCH_SCOPE_INVALID)/.test(e.message))e.missing=true;throw e;}
  try{
   let v=await run.start();
   while(v.run.status==='running')v=await run.action({actionId:`step-${v.run.runRevision}`,expectedRevision:v.run.runRevision,kind:'step',payload:{ticks:500}});
   const report=await run.report();await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
   console.log(JSON.stringify({runStatus:v.run.status,attention:v.attention,report:join(out,'report.json'),trace:join(out,'trace'),tuning:report.tuning},null,2));
   process.exitCode=report.tuning?.status==='completed'?0:1;
  }finally{await run.close();}
 }catch(e){console.error(e.missing?e.message:e.stack??String(e));process.exitCode=e.missing?2:1;}
 finally{await rm(probe,{recursive:true,force:true});}
}else try{
 const {runPayloadCampaign,verifyPayloadCampaign}=await tsImport('../packages/lab-runtime/src/v2/simulation3d/payload-campaign.ts',import.meta.url);
 const {readCellJson,runCellCampaign,verifyCellCampaign,verifyRecoveryCampaign}=await tsImport('../packages/lab-runtime/src/v2/simulation3d/cell-campaign.ts',import.meta.url);
 const {runCilCampaign,verifyCilCampaign}=await tsImport('../packages/lab-runtime/src/v2/control/cil-campaign.ts',import.meta.url);
 const {runBenchCampaign,verifyBenchCampaign}=await tsImport('../packages/lab-runtime/src/v2/control/bench-campaign.ts',import.meta.url);
 const {runFaultCampaign,verifyFaultCampaign}=await tsImport('../packages/lab-runtime/src/v2/control/fault-campaign.ts',import.meta.url);
 const {runTrayCampaign,verifyTrayCampaign}=await tsImport('../packages/lab-runtime/src/v2/simulation3d/tray-campaign.ts',import.meta.url);
 const {runPerceptionStudy,verifyPerceptionStudy}=await tsImport('../packages/lab-runtime/src/v2/perception/perception-study.ts',import.meta.url);
 const abort=new AbortController();for(const name of ['SIGINT','SIGTERM','SIGHUP'])process.once(name,()=>abort.abort());
 let verdict;
 if(command==='verify'){const doc=await readCellJson(resolve(options['--input']),'campaign.json');verdict=await(doc.campaign?.id==='mj-cell-recovery-v2'?verifyRecoveryCampaign:doc.campaign?.id==='perception-gap-v1'?verifyPerceptionStudy:doc.campaign?.id==='tray-v1'?verifyTrayCampaign:doc.campaign?.id==='fault-v1'?verifyFaultCampaign:['bench-v1','bench-v2'].includes(doc.campaign?.id)?verifyBenchCampaign:['cil-v1','cil-v2'].includes(doc.campaign?.id)?verifyCilCampaign:doc.campaign?.id==='mj-cell-bv01-v1'?verifyCellCampaign:verifyPayloadCampaign)(resolve(options['--input']));}
 else{
  const head=git('rev-parse','HEAD').stdout.trim(),dirty=git('status','--porcelain','--untracked-files=all').stdout.trim();
  if(!mujocoPresent()){console.error('MUJOCO_PREREQUISITE_MISSING');process.exit(2);}
  if(['mj-cell-recovery-v2','cil-v2','bench-v2','fault-v1','tray-v1','perception-gap-v1'].includes(options['--campaign'])&&dirty){console.error(options['--campaign']==='mj-cell-recovery-v2'?'RECOVERY_CLEAN_TREE_REQUIRED':options['--campaign']==='cil-v2'?'CIL_CLEAN_TREE_REQUIRED':options['--campaign']==='fault-v1'?'FAULT_CLEAN_TREE_REQUIRED':options['--campaign']==='tray-v1'?'TRAY_CLEAN_TREE_REQUIRED':options['--campaign']==='perception-gap-v1'?'STUDY_CLEAN_TREE_REQUIRED':'BENCH_CLEAN_TREE_REQUIRED');process.exit(2);}   // the recording is bound to a commit: a dirty tree is a missing condition
  verdict=await (options['--campaign']==='perception-gap-v1'?runPerceptionStudy:options['--campaign']==='tray-v1'?runTrayCampaign:options['--campaign']==='fault-v1'?runFaultCampaign:options['--campaign']==='bench-v2'?runBenchCampaign:options['--campaign']==='cil-v2'?runCilCampaign:['mj-cell-bv01-v1','mj-cell-recovery-v2'].includes(options['--campaign'])?runCellCampaign:runPayloadCampaign)({root,...options['--campaign']==='mj-cell-recovery-v2'?{campaignId:'mj-cell-recovery-v2'}:{},out:resolve(options['--out']),sourceCommit:head+(dirty?'-dirty':''),caseId:options['--case'],pointId:options['--case'],signal:abort.signal});
 }
 console.log(JSON.stringify(verdict,null,2));process.exitCode=(verdict.completedCases??verdict.completedRuns)===verdict.expectedRuns&&!verdict.issues.length&&!verdict.missingArtifacts.length&&(verdict.equivalence??[]).every(e=>e.bitIdentical)&&(verdict.faultCases??[]).every(c=>c.detected&&!c.falseServed)?0:1;
}catch(e){console.error(e.stack??String(e));process.exitCode=1;}
