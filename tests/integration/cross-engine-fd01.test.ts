import {expect,test} from 'vitest';
import {execFileSync} from 'node:child_process';
import * as identity from '../../scripts/repo-identity.mjs';
import {mkdtemp,readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createFixedStepScenarioRun} from '../../packages/lab-runtime/src/v2/navigation2d/runner';
import {irsimPlant} from '../../packages/lab-runtime/src/v2/navigation2d/plant';
import {webotsPlant} from '../../packages/lab-runtime/src/v2/simulation3d/webots';
import {mujocoMobilePlant} from '../../packages/lab-runtime/src/v2/simulation3d/mujoco-mobile';
import {withSemanticStudyController} from '../../packages/lab-runtime/src/v2/simulation3d/semantic-study-policy';
import {buildSemanticStudy,semanticEquivalence} from '../../packages/lab-runtime/src/v2/simulation3d/semantic-study';
import {defaultCatalog} from '../../packages/lab-runtime/src/v2/capabilities';
import {lockDigestOf} from '../../packages/lab-runtime/src/engineering/linkforge';
import {readNavigationEvidence} from '../../packages/lab-runtime/src/v2/navigation2d/evidence';
import {compileStudy,sha,artifact} from '../support/simulation-study';
import {OwnedProcesses} from '../support/owned-processes';
import type {SimulationRunInput,StudyArtifact} from '../../packages/lab-runtime/src/v2/simulation3d/simulation-input';
const root=resolve('.'),home=process.env.MEKONIQ_WEBOTS_HOME??'/Applications/Webots.app',exe=join(home,'Contents/MacOS/webots');
/** Native work is deliberately one serialized test. No skip, fallback, installation or hidden engine double. */
test('X01: actual IR-SIM, Webots and MuJoCo on fresh empty Serve geometry with deterministic confirmations',async()=>{
 const out=process.env.SIMULATION_STUDY_OUT??await mkdtemp(join(tmpdir(),'mekoniq-b08-x01-')),owned=new OwnedProcesses(),runs:SimulationRunInput[]=[];
 const sourceCommit=identity.sourceCommit(root)+(identity.sourceDirty(root)?'-dirty':'');
 await mkdir(out,{recursive:true});await writeFile(join(out,'recording.json'),JSON.stringify({accepted:false,sourceCommit,status:'started',engineRuns:[]},null,2),{flag:'wx'});
 console.log('X01_OUTPUT',out);
 for(const engine of ['irsim_2d','webots_3d','mujoco_3d']){
  const packageRoot=engine==='irsim_2d'?'navigation-2d':engine==='webots_3d'?'simulation-3d':'simulation-mujoco',venv=engine==='irsim_2d'?'.venv-irsim':engine==='webots_3d'?'.venv-webots':'.venv-mujoco',python=join(root,venv,'bin/python'),workerRoot=join(root,'robotics',packageRoot),directory=join(out,engine);
  await mkdir(directory);const c=await compileStudy('payload-empty-v1',engine);await mkdir(join(directory,'compiled'));
  for(const a of c.artifacts){await mkdir(join(directory,'compiled',a.ref.path,'..'),{recursive:true});await writeFile(join(directory,'compiled',a.ref.path),a.content);}
  try{
   if(engine==='webots_3d')expect(execFileSync(exe,['--version'],{encoding:'utf8',timeout:30000})).toContain('R2025a');
   const runtime={python,workerRoot,schemaDir:join(root,'packages/contracts/schemas'),lockDigest:await lockDigestOf(join(workerRoot,'requirements.lock')),maxActiveRuns:1,...engine==='mujoco_3d'?{engineVersion:'3.17.0'}:{},...engine==='webots_3d'?{webotsHome:home,executableSha256:sha(await readFile(exe)),basicTimeStepMs:20 as const}:{}};
   const plant=withSemanticStudyController(engine==='irsim_2d'?irsimPlant():engine==='webots_3d'?webotsPlant(runtime as never):mujocoMobilePlant(runtime as never));
   const catalog={...defaultCatalog,backends:defaultCatalog.backends.map(b=>b.id===engine?{...b,installed:true,compatible:true,reachable:true}:b)};
   const scenarioId=engine==='irsim_2d'?'IR-FD01':engine==='webots_3d'?'WB-FD01':'MJ-FD01';
   const run=owned.observeRun(await createFixedStepScenarioRun({project:c.locked.runtimeProjection.project,scenarioId,scenarioRevision:1,seed:7,mode:'simulation',access:'simulated',backendSetId:c.set,sourceCommit,engineering:c.locked},{directory:join(directory,'run'),catalog,enabledBackends:[engine],bundleFile:(d,p)=>c.service.bundleFile(d,p),plant,runtime}));
   owned.addDirectory(join(directory,'run'));let report;
   try{
    await run.start();let v=await run.snapshot(),step=0;
    while(['running','awaiting_confirmation'].includes(v.run.status)&&v.tick<12000){const before=v.tick;v=await run.action({actionId:`x01-${engine}-${++step}`,expectedRevision:v.run.runRevision,kind:'step',payload:{ticks:250}});if(v.tick===before&&v.run.status==='running')throw Error('X01_RUN_STALLED');}
    report=await run.report();await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    expect(report.outcome,engine).toMatchObject({status:'completed',served:'1'});expect(report.navigation2d!.controller).toEqual({id:'grid-diff-v1',version:'2+mujoco-sent-ramp-v1'});
    console.log('X01_ENGINE',engine,JSON.stringify({outcome:report.outcome,scene:c.scene.sceneDigest,model:c.scene.robots[0].model.modelDigest,controller:report.navigation2d!.controller}));
   }finally{await run.close();expect(owned.processes()).toEqual([]);}
   const manifest=JSON.parse(await readFile(join(directory,'run/evidence/manifest.json'),'utf8')),read=await readNavigationEvidence(join(directory,'run/evidence'),manifest,{scene:c.scene,runTick:report!.outcome.tick});expect(read.complete).toBe(true);expect(read.issues).toEqual([]);
   const artifacts:StudyArtifact[]=[...c.artifacts];
   for(const path of await readdir(join(directory,'run/evidence'))){if(!path.endsWith('.gz'))continue;const b=await readFile(join(directory,'run/evidence',path));artifacts.push({ref:{path:'evidence/'+path,bytes:b.length,sha256:sha(b)},encoding:'base64',content:b.toString('base64')});}
   runs.push({report:artifact('report.json',report!),artifacts});
  }finally{await c.close();}
 }
 const equivalence=semanticEquivalence(runs[0]!),input={equivalence,runs:runs.map(r=>({...r,commonProjection:equivalence.commonProjection})),invariantPolicy:{id:'fd01-source-causal-v1',revision:1}},study=buildSemanticStudy(input);
 await writeFile(join(out,'study-input.json'),JSON.stringify(input,null,2)+'\n',{flag:'wx'});await writeFile(join(out,'semantic-study.json'),JSON.stringify(study,null,2)+'\n',{flag:'wx'});
 expect(study.reasonCodes,JSON.stringify(study)).toEqual([]);expect(study.status).toBe('complete');expect(study.runs).toHaveLength(3);expect(study.unsupportedDimensions.filter(d=>d.engine==='irsim_2d')).toHaveLength(3);
 await writeFile(join(out,'recording-complete.json'),JSON.stringify({accepted:false,sourceCommit,status:study.status,engineRuns:study.runs.map(r=>({engine:r.engine,runId:r.runId,sceneDigest:r.sceneDigest,modelDigest:r.modelDigest}))},null,2)+'\n',{flag:'wx'});
},1_200_000);
