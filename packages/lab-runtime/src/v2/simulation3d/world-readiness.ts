/** Shared-world readiness has its own scene/project policy; legacy arm/mobile probes stay unchanged. */
import {mkdir,mkdtemp,readFile,rm,statfs,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {dirname,join} from 'node:path';
import type {NativeReadinessChecks,ReadinessCheck} from '../readiness';
import {validateProjectV2} from '../contracts';
import {hashJson} from '../hash';
import {lockDigestOf} from '../../engineering/linkforge';
import {activeRunCount,holdsSlot,holdSlot,releaseSlot} from '../navigation2d/runner';
import {closeOnAbort,exclusiveSmoke} from '../navigation2d/readiness';
import {MUJOCO_SLOT,type MujocoRuntimeOptions} from './mujoco';
import {readWorldFixture,validateWorldObservation} from './world-scene';
import {prepareWorldAdmission} from './world-evidence';
import {verifiedWorldRun} from './mujoco-world-ports';
import {spawnMujocoWorker} from './worker-client';
import type {Sim3DSnapshotV1} from '../navigation2d/contracts';
export function worldReadiness(runtime:MujocoRuntimeOptions,options:{lockPath:string;probeDir:string;directory:string;gate:{busy:boolean}}):NativeReadinessChecks{
 const successes=new Map<string,number>();
 return async(context,signal)=>{
  const row=(id:string,reasonCodes:string[],evidenceRef:string|null=null):ReadinessCheck=>({id,status:reasonCodes.length?'blocked':'ready',reasonCodes,evidenceRef});
  const profile:string[]=[],model:string[]=[],fixture:string[]=[],runner:string[]=[],clock:string[]=[];let world:Awaited<ReturnType<typeof readWorldFixture>>|undefined,key='';
  if(await lockDigestOf(options.lockPath).catch(()=>null)!==runtime.lockDigest)profile.push('WORLD_LOCK_CHANGED');if(!existsSync(runtime.python))profile.push('WORLD_PYTHON_UNAVAILABLE');if(runtime.engineVersion!=='3.17.0'||runtime.physicsOverride||runtime.padFrictionOverride!==undefined||runtime.armExtraStatics||runtime.cellDisturbance)profile.push('WORLD_PROFILE_UNSUPPORTED');
  if(context.backendSetId!=='engineering-mujoco-cell-v1'||context.scenarioId!=='MJ-CELL-BV01')fixture.push('WORLD_SCENARIO_UNSUPPORTED');
  const project=validateProjectV2(context.project);if(!project.ok)fixture.push('PROJECT_INVALID');
  try{world=await readWorldFixture(runtime.workerRoot,'coffee-delivery-cell-v1');prepareWorldAdmission(world.scene,world.files);if(world.scene.controlContextVersion!==1||world.scene.controllerPolicy?.id!=='grid-diff-world-v4')model.push('WORLD_CONTROL_POLICY_INVALID');if(project.ok&&hashJson(project.value)!==world.scene.inputs.projectDigest)fixture.push('WORLD_PROJECT_MISMATCH');
   const files=['__init__.py','__main__.py','compile.py','compile_mobile.py','compile_world.py','drive.py','engine.py','mobile_engine.py','protocol.py','session.py','snapshot.py','world_engine.py'];const code=await Promise.all(files.map(async name=>({name,hash:createHash('sha256').update(await readFile(join(runtime.workerRoot,'mujoco_worker',name))).digest('hex')})));
   key=hashJson({scene:world.scene.sceneDigest,lock:runtime.lockDigest,code,engine:runtime.engineVersion,python:runtime.python});
  }catch{model.push('WORLD_FIXTURE_INVALID');}
  if(world&&(world.scene.navigation.clock.tickMs!==20||world.scene.numericalPolicy.timestepMs!==2||world.scene.numericalPolicy.substeps!==10||world.scene.numericalPolicy.primingSubsteps!==10))clock.push('WORLD_CLOCK_INVALID');
  if((await statfs(options.directory).then(s=>s.bavail*s.bsize,()=>0))<200*1024*1024)runner.push('DISK_SPACE_LOW');
  if(activeRunCount(MUJOCO_SLOT,context.runId)>0)runner.push('WORLD_CAPACITY');if(options.gate.busy)runner.push('WORLD_SMOKE_BUSY');
  if(context.runId&&(!holdsSlot(MUJOCO_SLOT,context.runId)||!world||!verifiedWorldRun(context.runId,world.scene.sceneDigest)))runner.push('WORLD_RUN_NOT_VERIFIED');
  signal.throwIfAborted();
  if(world&&!profile.length&&!model.length&&!fixture.length&&!clock.length&&!runner.length&&!context.runId&&(successes.get(key)??0)<=Date.now()){
   const admitted=world;const failed=await exclusiveSmoke(options.gate,async()=>{
    if(activeRunCount(MUJOCO_SLOT)>0)return ['WORLD_CAPACITY'];const id='mujoco-world-readiness-smoke';holdSlot(MUJOCO_SLOT,id);let worker:Awaited<ReturnType<typeof spawnMujocoWorker>>|undefined,scratch:string|undefined,detach:(()=>void)|undefined;
    try{await mkdir(options.probeDir,{recursive:true});scratch=await mkdtemp(join(options.probeDir,'world-smoke-'));const bundle=join(scratch,'bundle');await mkdir(bundle);
     for(const [name,bytes] of admitted.files){const path=join(bundle,name);await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes,{mode:0o600});}await writeFile(join(bundle,'lab-world-scene.json'),JSON.stringify(admitted.scene),{mode:0o600});
     signal.throwIfAborted();worker=await spawnMujocoWorker({...runtime,runId:id,bundleRoot:bundle,runDirectory:join(scratch,'run'),sceneDigest:admitted.scene.sceneDigest});detach=closeOnAbort(signal,()=>worker!.close('world readiness aborted'));
     const r=await worker.request({protocol:'mekoniq-sim3d/1',requestId:'world-smoke-create',runId:id,expectedTick:0,op:'create',payload:{sceneRef:'lab-world-scene.json',seed:admitted.scene.armCell.engineSeed}});if(!r.ok)return [`WORLD_SMOKE_FAILED:${r.error.code}`];
     const s=r.result as Sim3DSnapshotV1;validateWorldObservation(s,admitted.scene,[]);const a=prepareWorldAdmission(admitted.scene,admitted.files);if(s.worldStep!.nbody!==a.modelCounts.nbody||s.worldStep!.ngeom!==a.modelCounts.ngeom||s.props!.length||s.physics!.loads.length||s.arms![0]!.gripper!.heldPropIds.length)return ['WORLD_SMOKE_MODEL_MISMATCH'];return [];
    }catch{return ['WORLD_SMOKE_FAILED'];}finally{detach?.();try{await worker?.close('world smoke complete');}finally{releaseSlot(MUJOCO_SLOT,id);if(scratch)await rm(scratch,{recursive:true,force:true});}}
   });signal.throwIfAborted();if(failed===null)runner.push('WORLD_SMOKE_BUSY');else if(failed.length)runner.push(...failed);else{successes.clear();successes.set(key,Date.now()+60000);}
  }
  return [row('profile',profile,`mujoco-world:3.17.0/lock:${runtime.lockDigest}`),row('model',model,world?`world-scene:${world.scene.sceneDigest}`:null),row('fixture',fixture,world?`world-fixture:${world.scene.id}`:null),row('clock',clock,'source_fixed_step:20ms/10x2ms/one-prime'),row('runner',runner,world?`mujoco-world-smoke:${world.scene.sceneDigest}`:null)];
 };
}
