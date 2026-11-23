// Real full-cell nominal control for the registered program; REC06 disturbance qualification is a separate campaign.
import {existsSync} from 'node:fs';
import {cp,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {describe,expect,test} from 'vitest';
import {createScenarioRun} from '../../packages/lab-runtime/src/v2/scenario-runner';
import {mujocoWorldPorts} from '../../packages/lab-runtime/src/v2/simulation3d/mujoco-world-ports';
import {serviceAmrAsset} from '../../packages/lab-runtime/src/v2/assets';
import {defaultCatalog} from '../../packages/lab-runtime/src/v2/capabilities';
import {lockDigestOf} from '../../packages/lab-runtime/src/engineering/linkforge';
import {hashJson} from '../../packages/lab-runtime/src/v2/hash';
describe.skipIf(!existsSync(resolve('.venv-mujoco/bin/python')))('registered two-stage grasp (requires .venv-mujoco)',()=>{
 test.each([7,42,99])('nominal full cell seed%s serves two and binds its program (seed42 also checks cold readback)',async(seed)=>{
  const retained=process.env.LAB_GRASP_PROGRAM_EVIDENCE_DIR;
  if(retained)await mkdir(resolve(retained),{recursive:true});
  const temporary=retained?join(resolve(retained),`nominal-${seed}`):await mkdtemp(join(tmpdir(),'grasp-program-engine-'));if(retained)await mkdir(temporary);
  const directory=join(temporary,'run'),workerRoot=resolve('robotics/simulation-mujoco');
  const project=JSON.parse(await readFile(join(workerRoot,'fixtures/coffee-delivery-cell-v1/project.json'),'utf8'));
  const input={project,scenarioId:'MJ-CELL-BV01',scenarioRevision:1,seed,mode:'simulation' as const,access:'simulated' as const,backendSetId:'engineering-mujoco-cell-v1',sourceCommit:'a'.repeat(40),graspMode:'belief_estimated' as const,perceptionProfileId:'perception-nominal-v1',recoveryPolicyId:'pick-recovery-v1',graspProgramId:'cup-pick-two-stage-v1'};
  const factory=mujocoWorldPorts({python:resolve('.venv-mujoco/bin/python'),workerRoot,schemaDir:resolve('packages/contracts/schemas'),lockDigest:await lockDigestOf(join(workerRoot,'requirements.lock')),engineVersion:'3.17.0'});
  const providers={directory,catalog:{...defaultCatalog,backends:defaultCatalog.backends.map(b=>['mujoco_arm','mujoco_3d'].includes(b.id)?{...b,installed:true,compatible:true,reachable:true}:b)},assets:[serviceAmrAsset({id:'service-robot',revision:1,chassis:'service',trays:3,sensor:'lidar'})],enabledBackends:['mujoco_3d','mujoco_arm','mock_coffee'],worldPorts:factory};
  let run:Awaited<ReturnType<typeof createScenarioRun>>|undefined,passed=false,error:string|undefined;
  try{
   run=await createScenarioRun(input,providers);let view=await run.start(),n=0;
   const checkpoint=JSON.parse(await readFile(join(directory,'run.json'),'utf8'));
   expect(checkpoint.manifest.graspProgramId).toBe('cup-pick-two-stage-v1');
   const program=checkpoint.manifest.armProgram;
   expect(program.graspProgram).toMatchObject({id:'cup-pick-two-stage-v1',revision:1,calibration:'not_calibrated'});
   expect(program.programs.contact).toMatchObject({captureM:0.07,closedM:0,openM:0.0889});expect(program.programsDigest).toBe(hashJson(program.programs));
   expect(program.graspOffsets.pick.positionM[0]).toBeCloseTo(0.002,8);expect(program.graspOffsets.pickApproach.positionM[0]).toBeCloseTo(-0.098,8);
   expect(checkpoint.manifest.perception.program.digest).toBe(program.graspProgram.digest);
   while(view.tick<12000&&!['completed','needs_attention','cancelled'].includes(view.run.status))view=await run.action({actionId:`p-${++n}`,expectedRevision:view.run.runRevision,kind:'step',payload:{ticks:25}});
   const report=await run.report();if(retained)await writeFile(join(temporary,'report.json'),JSON.stringify(report),{flag:'wx'});
   expect(report.outcome).toMatchObject({status:'completed',served:'2'});expect(report.perceptionEvidence!.issues).toEqual([]);
   expect(report.worldSweep).toMatchObject({status:'pass',reasonCodes:[],scope:{prefixCovered:true},nativeContacts:{status:'pass',unexpected:0}});
   expect(report.perceptionEvidence!.attempts.map(a=>a.outcome)).toEqual(['lifted','lifted']);expect(report.perceptionEvidence!.graspProgramDigest).toBe(checkpoint.manifest.perception.program.executionDigest);
   await run.close();run=undefined;
   const path=join(directory,'belief-evidence/manifest.json'),belief=JSON.parse(await readFile(path,'utf8'));
   expect(belief.identity.graspProgramDigest).toBe(checkpoint.manifest.perception.program.executionDigest);
   if(seed===42){const copy=join(temporary,'cold-tamper');await cp(directory,copy,{recursive:true});belief.identity.graspProgramDigest='f'.repeat(64);await writeFile(join(copy,'belief-evidence/manifest.json'),JSON.stringify(belief));
    run=await createScenarioRun(input,{...providers,directory:copy});expect((await run.report()).perceptionEvidence!.issues).toContain('BELIEF_IDENTITY_MISMATCH');}
   passed=true;
  }catch(e){error=String(e);throw e;}finally{await run?.close();if(retained)await writeFile(join(temporary,'validation.json'),JSON.stringify({qualification:false,accepted:false,seed,passed,error},null,2)+'\n',{flag:'wx'});else await rm(temporary,{recursive:true,force:true});}
 },900_000);
});
