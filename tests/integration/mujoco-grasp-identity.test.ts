// Short real-engine runs prove the expected identity of a cold read, including expected absence.
import {existsSync} from 'node:fs';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {describe,expect,test} from 'vitest';
import {createScenarioRun} from '../../packages/lab-runtime/src/v2/scenario-runner';
import {mujocoWorldPorts} from '../../packages/lab-runtime/src/v2/simulation3d/mujoco-world-ports';
import {serviceAmrAsset} from '../../packages/lab-runtime/src/v2/assets';
import {defaultCatalog} from '../../packages/lab-runtime/src/v2/capabilities';
import {lockDigestOf} from '../../packages/lab-runtime/src/engineering/linkforge';
describe.skipIf(!existsSync(resolve('.venv-mujoco/bin/python')))('grasp program readback identity (requires .venv-mujoco)',()=>{
 test.each([false,true])('cold programselected=%s refuses an unexpected identity or contradictory retained program',async(selected)=>{
  const temporary=await mkdtemp(join(tmpdir(),'grasp-identity-engine-')),directory=join(temporary,'run'),workerRoot=resolve('robotics/simulation-mujoco');
  const project=JSON.parse(await readFile(join(workerRoot,'fixtures/coffee-delivery-cell-v1/project.json'),'utf8'));
  const input={project,scenarioId:'MJ-CELL-BV01',scenarioRevision:1,seed:7,mode:'simulation' as const,access:'simulated' as const,backendSetId:'engineering-mujoco-cell-v1',sourceCommit:'a'.repeat(40),graspMode:'belief_estimated' as const,perceptionProfileId:'perception-nominal-v1',...selected?{graspProgramId:'cup-pick-two-stage-v1'}:{}};
  const factory=mujocoWorldPorts({python:resolve('.venv-mujoco/bin/python'),workerRoot,schemaDir:resolve('packages/contracts/schemas'),lockDigest:await lockDigestOf(join(workerRoot,'requirements.lock')),engineVersion:'3.17.0'});
  const providers={directory,catalog:{...defaultCatalog,backends:defaultCatalog.backends.map(b=>['mujoco_arm','mujoco_3d'].includes(b.id)?{...b,installed:true,compatible:true,reachable:true}:b)},assets:[serviceAmrAsset({id:'service-robot',revision:1,chassis:'service',trays:3,sensor:'lidar'})],enabledBackends:['mujoco_3d','mujoco_arm','mock_coffee'],worldPorts:factory};
  let run:Awaited<ReturnType<typeof createScenarioRun>>|undefined;
  try{
   run=await createScenarioRun(input,providers);await run.start();await run.close();run=undefined;
   const path=join(directory,'run.json'),beliefPath=join(directory,'belief-evidence/manifest.json'),cp=JSON.parse(await readFile(path,'utf8')),belief=JSON.parse(await readFile(beliefPath,'utf8'));
   if(!selected){belief.identity.graspProgramDigest='d'.repeat(64);await writeFile(beliefPath,JSON.stringify(belief));run=await createScenarioRun(input,providers);expect((await run.report()).perceptionEvidence!.issues).toContain('BELIEF_IDENTITY_MISMATCH');}
   else{
    expect(cp.manifest.perception.program.executionDigest).toEqual(expect.any(String));expect(belief.identity.graspProgramDigest).toBe(cp.manifest.perception.program.executionDigest);expect(belief.identity.graspProgramDigest).not.toBe(cp.manifest.perception.program.digest);
    run=await createScenarioRun(input,providers);expect((await run.report()).perceptionEvidence!.issues).toEqual([]);await run.close();run=undefined;
    for(const mutation of ['offset','contact','registration','reference']){
     const bad=structuredClone(cp);
     if(mutation==='offset')bad.manifest.armProgram.graspOffsets.pick.positionM[0]+=0.001;
     if(mutation==='contact')bad.manifest.armProgram.programs.contact.captureM=0.065;
     if(mutation==='registration')bad.manifest.armProgram.graspProgram.pickInsetM=0.021;
     if(mutation==='reference')bad.manifest.perception.program.executionDigest='e'.repeat(64);
     await writeFile(path,JSON.stringify(bad));run=await createScenarioRun(input,providers);expect((await run.report()).perceptionEvidence!.issues,mutation).toContain('GRASP_PROGRAM_IDENTITY_MISMATCH');await run.close();run=undefined;
    }
   }
  }finally{await run?.close();await rm(temporary,{recursive:true,force:true});}
 },120_000);
});
