#!/usr/bin/env node
// Throwaway review check (not repo code): wall time per tick of MJ-CELL-BV01 without and with the nominal virtual drive,
// in 500-tick blocks, to see the added cost and whether it grows with the tick count.
//   node drive-cost-ab.mjs [ticks=4000]
import {createRequire} from 'node:module';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {performance} from 'node:perf_hooks';
const root='/Users/hoangpham/source/prv/robot/source';
const require=createRequire(join(root,'package.json'));
const {tsImport}=await import(require.resolve('tsx/esm/api'));
const imp=p=>tsImport(join(root,p),import.meta.url);
const [{createScenarioRun},{defaultCatalog},{mujocoWorldPorts},{lockDigestOf},{amrAsset}]=await Promise.all([
 imp('packages/lab-runtime/src/v2/scenario-runner.ts'),imp('packages/lab-runtime/src/v2/capabilities.ts'),imp('packages/lab-runtime/src/v2/simulation3d/mujoco-world-ports.ts'),imp('packages/lab-runtime/src/engineering/linkforge.ts'),imp('tests/support/lab-v2.ts')]);
const cellRoot=resolve(root,'robotics/simulation-mujoco'),TICKS=Number(process.argv[2]??4000),BLOCK=500;
const project=JSON.parse(await readFile(join(cellRoot,'fixtures/coffee-delivery-cell-v1/project.json'),'utf8'));
const catalog={...defaultCatalog,backends:defaultCatalog.backends.map(b=>['mujoco_arm','mujoco_3d'].includes(b.id)?{...b,installed:true,compatible:true,reachable:true}:b)};
async function measure(name,drive){
 const directory=await mkdtemp(join(tmpdir(),'mekoniq-drivecost-'));let run;
 try{
  const factory=mujocoWorldPorts({python:resolve(root,'.venv-mujoco/bin/python'),workerRoot:cellRoot,schemaDir:resolve(root,'packages/contracts/schemas'),lockDigest:await lockDigestOf(join(cellRoot,'requirements.lock')),engineVersion:'3.17.0'});
  const manifest={project,scenarioId:'MJ-CELL-BV01',scenarioRevision:1,seed:1,mode:'simulation',access:'simulated',backendSetId:'engineering-mujoco-cell-v1',sourceCommit:'development:drive-cost-ab',...drive?{driveExperimentId:drive}:{}};
  run=await createScenarioRun(manifest,{directory,catalog,assets:[amrAsset],enabledBackends:['mujoco_3d','mujoco_arm','mock_coffee'],worldPorts:factory});
  let n=0,view=await run.snapshot();view=await run.action({actionId:`p-${++n}`,expectedRevision:view.run.runRevision,kind:'start',payload:{}});
  const blocks=[];let t0=performance.now(),mark=0;
  while(view.tick<TICKS&&!['completed','needs_attention','cancelled','failed'].includes(view.run.status)){
   view=await run.action({actionId:`p-${++n}`,expectedRevision:view.run.runRevision,kind:'step',payload:{ticks:25}});
   if(view.tick-mark>=BLOCK){const t=performance.now();blocks.push(+((t-t0)/(view.tick-mark)).toFixed(2));t0=t;mark=view.tick;}
  }
  console.log(JSON.stringify({name,status:view.run.status,ticks:view.tick,msPerTickByBlock:blocks,mean:+(blocks.reduce((a,b)=>a+b,0)/Math.max(1,blocks.length)).toFixed(2)}));
 }catch(e){console.log(JSON.stringify({name,error:String(e?.message??e)}));}
 finally{await run?.close().catch(()=>{});await rm(directory,{recursive:true,force:true});}
}
await measure('legacy');await measure('drive-nominal-v1','drive-nominal-v1');await measure('legacy-2');await measure('drive-nominal-v1-2','drive-nominal-v1');
process.exit(0);
