// R4-B §8.1: one pick-rig run. The rig is the registered shared-world cell on the derived pick-rig-v1 fixture (the cup is born off the nominal centre, within the rig policy), started like any cell run and
// stopped when the first cup's grasp has a final outcome. The artifacts of a run are its retained belief stream, the report and `rig-run.json` (the inputs with the real offset and what the stream says).
// Campaign-only: nothing here is reachable from a request.
import {mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createScenarioRun,type ScenarioRun} from '../scenario-runner';
import {serviceAmrAsset} from '../assets';
import {defaultCatalog} from '../capabilities';
import {mujocoWorldPorts} from '../simulation3d/mujoco-world-ports';
import type {MujocoRuntimeOptions} from '../simulation3d/mujoco';
import type {WorldFactoryInput,WorldPlantBindings} from '../simulation3d/world-ports';
import type {GraspAttempt} from '../../../../contracts/generated/navigation2d';
import {rigOffsetM} from './perception-study';
import {buildPerceptionReport} from './perception-report';
export interface PickRigInput {seed:number;mode:'fixed_program'|'belief_ground_truth'|'belief_estimated';truthOffsetM:number;profileId:string|null;nudge:boolean;recoveryPolicyId:string|null;directory:string;sourceCommit?:string;maxTicks?:number;/** test only, see MujocoRuntimeOptions.rig */transientBias?:{vectorM:[number,number];attempts:number};/** test only, see MujocoRuntimeOptions.rig */gripHoldAttempts?:number}
export interface PickRigResult {runId:string;outcome:GraspAttempt['outcome']|'none';attempts:number;recovered:boolean;attention:boolean;ticks:number;unexpectedContacts:number;directory:string}
export interface RigRunRecord {schemaVersion:1;input:Omit<PickRigInput,'directory'>;offsetM:[number,number];result:PickRigResult&{beliefErrorAtCommitM:number|null}}
const TERMINAL=['completed','needs_attention','cancelled'];
export async function runPickRig(input:PickRigInput,runtime:MujocoRuntimeOptions):Promise<PickRigResult&{beliefErrorAtCommitM:number|null}>{
 const offsetM=rigOffsetM(input.seed,input.truthOffsetM),runDir=join(input.directory,'run');await mkdir(runDir,{recursive:true});
 const project=JSON.parse(await readFile(join(runtime.workerRoot,'fixtures/coffee-delivery-cell-v1/project.json'),'utf8'));
 const factory=mujocoWorldPorts({...runtime,rig:{offsetM,...input.transientBias?{transientBias:input.transientBias}:{},...input.gripHoldAttempts?{gripHoldAttempts:input.gripHoldAttempts}:{}},...input.nudge?{cellDisturbance:{presetId:'world-cup-nudge-v1' as const,cupId:'cup-1'}}:{}});
 let bindings!:WorldPlantBindings;
 const catalog={...defaultCatalog,backends:defaultCatalog.backends.map(b=>['mujoco_arm','mujoco_3d'].includes(b.id)?{...b,installed:true,compatible:true,reachable:true}:b)};
 const manifest={project,scenarioId:'MJ-CELL-BV01',scenarioRevision:1,seed:input.seed,mode:'simulation' as const,access:'simulated' as const,backendSetId:'engineering-mujoco-cell-v1',sourceCommit:input.sourceCommit??'development:pick-rig',
  ...input.mode==='fixed_program'?{}:{graspMode:input.mode,...input.profileId?{perceptionProfileId:input.profileId}:{},...input.recoveryPolicyId?{recoveryPolicyId:input.recoveryPolicyId}:{}}};
 const providers={directory:runDir,catalog,assets:[serviceAmrAsset({id:'service-robot',revision:1,chassis:'service',trays:3,sensor:'lidar'})],enabledBackends:['mujoco_3d','mujoco_arm','mock_coffee'],worldPorts:async(i:WorldFactoryInput)=>{bindings=await factory(i);return bindings;}};
 let run:ScenarioRun|undefined,n=0;
 const act=async(kind:string,payload:object={})=>{const v=await run!.snapshot();return run!.action({actionId:`pick-rig-${++n}`,expectedRevision:v.run.runRevision,kind,payload});};
 let v:Awaited<ReturnType<ScenarioRun['snapshot']>>,report:Awaited<ReturnType<ScenarioRun['report']>>;
 try{
  run=await createScenarioRun(manifest as never,providers as never);await run.start();v=await run.snapshot();
  // the first cup's grasp is decided once its last attempt has a final outcome. ponytail: fixed_program has no stream, so a served cup is `lifted` and a run that ended without one is `grip_not_established` (it cannot tell a refused cause apart); the study's fixed points compare this proportion only.
  const cupDone=async()=>{
   if(input.mode==='fixed_program')return v.served!=='0';
   const hot=await bindings.coffee.perceptionReport?.(),last=[...new Map((hot?.attempts??[]).map(a=>[a.attemptId,a])).values()].filter(a=>a.cupId==='cup-1').at(-1);return !!last&&last.outcome!=='unknown'&&!(input.recoveryPolicyId&&last.outcome==='grip_not_established'); // with a recovery policy a missed grip is not final: the run goes on until the retry has an outcome or the run ends
  };
  while(v.tick<(input.maxTicks??12000)&&!TERMINAL.includes(v.run.status)){v=await act('step',{ticks:25});if(v.tick>=1200&&v.tick%50===0&&await cupDone())break;}
  report=await run.report();
 }finally{await run?.close();}
 const evidence=await buildPerceptionReport(join(runDir,'belief-evidence'));
 const mine=evidence.attempts.filter(a=>a.cupId==='cup-1'),last=mine.at(-1);
 const result:PickRigResult&{beliefErrorAtCommitM:number|null}={runId:report.manifest.runId,outcome:input.mode==='fixed_program'?(v.served!=='0'?'lifted':TERMINAL.includes(v.run.status)?'grip_not_established':'unknown'):last?.outcome??'none',attempts:input.mode==='fixed_program'?1:mine.length,
  recovered:evidence.recovery.length>0&&last?.outcome==='lifted',attention:v.run.status==='needs_attention',ticks:v.tick,unexpectedContacts:0,directory:input.directory,beliefErrorAtCommitM:mine[0]?.beliefErrorAtCommitM??null};
 const rest:Omit<PickRigInput,'directory'>={...input};delete (rest as {directory?:string}).directory;
 await writeFile(join(input.directory,'rig-run.json'),JSON.stringify({schemaVersion:1,input:rest,offsetM,result} satisfies RigRunRecord,null,2)+'\n');
 await writeFile(join(input.directory,'report.json'),JSON.stringify(report));
 // the world streams of the run are large and not part of the study's evidence; the belief stream, the report and the run record are
 for(const name of ['mujoco-world','physics-evidence','world-evidence'])await rm(join(runDir,name),{recursive:true,force:true});
 return result;
}
