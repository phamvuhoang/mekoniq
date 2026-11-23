#!/usr/bin/env node
// Record the V15 synthetic tool self-test on the pinned local MuJoCo environment.
import {execFileSync} from 'node:child_process';
import {lstat,mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve,sep} from 'node:path';
import {tsImport} from 'tsx/esm/api';
import {treeState,closureIdentity} from './lab-irsim.mjs';
import {readCalibrationDirectory} from './r4-calibration-readback.mjs';

const root=resolve(import.meta.dirname,'..');
async function record(args){
 const [option,directory,extra]=args;
 if(option!=='--out'||!directory||directory.startsWith('--')||extra!==undefined)throw Error('usage: record-calibration-selftest.mjs --out NEW-DIR');
 const requested=resolve(directory),out=join(await realpath(dirname(requested)),basename(requested));
 if(await lstat(out).then(()=>true,e=>{if(e.code!=='ENOENT')throw e;return false;}))throw Error('OUT_EXISTS');
 if(out===root||out.startsWith(root+sep))throw Error('OUTPUT_MUST_BE_OUTSIDE_SOURCE');
 const source=()=>{
  const {head,dirty}=treeState(root);
  if(dirty||!/^[a-f0-9]{40}$/.test(head))throw Error('SOURCE_DIRTY_OR_UNAVAILABLE');
  return {sourceCommit:head,dirty:false,node:process.version,toolClosures:closureIdentity(root)};
 };
 const beforeSource=source();
 const [selftest,{mujocoFromOptions},{createHeadlessBench}]=await Promise.all([
  tsImport('./r4-calibration-selftest.ts',import.meta.url),tsImport('../packages/lab-runtime/src/v2/simulation3d/mujoco.ts',import.meta.url),
  tsImport('../packages/lab-runtime/src/v2/control/bench-runner.ts',import.meta.url)
 ]);
 const workerRoot=join(root,selftest.SELFTEST_WORKER_ROOT),python=join(root,'.venv-mujoco/bin/python');
 const lockPath=join(workerRoot,'requirements.lock'),scratch=await mkdtemp(join(tmpdir(),'calibration-selftest-'));
 const runtimeIdentity=async()=>{
  const p=await mujocoFromOptions({enabled:true,python,workerRoot,lockPath,directory:scratch});
  if(!p.arm.runtime)throw Error('MUJOCO_PREREQUISITE_MISSING:'+p.arm.capability.reason);
  const [pythonVersion,platform,arch]=JSON.parse(execFileSync(python,['-I','-B','-c',
   'import json,platform,sys; print(json.dumps([platform.python_version(),sys.platform,platform.machine()]))'],{encoding:'utf8',timeout:30_000}));
  const {engineVersion,lockDigest}=p.arm.runtime;
  return {options:p.arm.runtime,runtime:{engine:'mujoco_arm',engineVersion,lockDigest,pythonVersion,platform,arch}};
 };
 try{
  const {options,runtime}=await runtimeIdentity(),before={...beforeSource,runtime};
  const base=await selftest.loadCalibrationSelftestBase(workerRoot),bench=createHeadlessBench(options,{seed:selftest.SELFTEST_PROTOCOL.seed,sourceCommit:before.sourceCommit});
  await selftest.writeCalibrationSelftest(out,base,bench,before,async()=>{
   const {runtime}=await runtimeIdentity();
   return {...source(),runtime};
  });
  const issues=await readCalibrationDirectory(out,before);
  console.log(JSON.stringify({out,sourceCommit:before.sourceCommit,accepted:false,issues}));
  return issues.length?1:0;
 }finally{await rm(scratch,{recursive:true,force:true});}
}

try{process.exitCode=await record(process.argv.slice(2));}catch(error){console.error(error.message);process.exitCode=2;}
