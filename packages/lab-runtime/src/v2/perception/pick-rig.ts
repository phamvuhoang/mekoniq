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
/** What a run's report says about the pick, independent of any belief stream: the outcome of a fixed-program run (a served cup is lifted; an arm stop reason decides the rest: a dropped cup, any other stop is unknown; an ended run with no stop is a grip that did not form) and the unexpected native contacts the full-world sweep counted. The verifier uses the same function. */
export function rigReportFacts(report:{outcome:{status:string;served:string};coffee?:{armTrace?:{stop?:{reason?:string}}};worldSweep?:{nativeContacts?:{unexpected?:number}}}):{fixedOutcome:GraspAttempt['outcome'];unexpectedContacts:number}{
 const stop=report.coffee?.armTrace?.stop?.reason,unexpectedContacts=report.worldSweep?.nativeContacts?.unexpected??0;
 const fixedOutcome:GraspAttempt['outcome']=report.outcome.served!=='0'?'lifted':stop==='CUP_DROPPED'?'cup_dropped':stop?'unknown':TERMINAL.includes(report.outcome.status)?'grip_not_established':'unknown';
 return {fixedOutcome,unexpectedContacts};
}
/** The result of a rig run, recomputed from what the run itself kept (its report and its belief stream): the runner writes it and the study verifier recomputes it, so a changed record does not pass. */
export function rigDerived(mode:PickRigInput['mode'],evidence:{attempts:GraspAttempt[];recovery:unknown[]},report:Parameters<typeof rigReportFacts>[0]&{outcome:{tick:number}}){
 const mine=evidence.attempts.filter(a=>a.cupId==='cup-1'),last=mine.at(-1),facts=rigReportFacts(report),fixed=mode==='fixed_program';
 return {outcome:fixed?facts.fixedOutcome:last?.outcome??'none' as GraspAttempt['outcome']|'none',attempts:fixed?1:mine.length,recovered:evidence.recovery.length>0&&last?.outcome==='lifted',attention:report.outcome.status==='needs_attention',ticks:report.outcome.tick,unexpectedContacts:facts.unexpectedContacts,beliefErrorAtCommitM:mine[0]?.beliefErrorAtCommitM??null};
}
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
  // the first cup's grasp is decided once its last attempt has a final outcome. ponytail: fixed_program has no stream, so its outcome is read from the report (rigReportFacts).
  const cupDone=async()=>{
   if(input.mode==='fixed_program')return v.served!=='0';
   const hot=await bindings.coffee.perceptionReport?.(),last=[...new Map((hot?.attempts??[]).map(a=>[a.attemptId,a])).values()].filter(a=>a.cupId==='cup-1').at(-1);return !!last&&last.outcome!=='unknown'&&!(input.recoveryPolicyId&&last.outcome==='grip_not_established'); // with a recovery policy a missed grip is not final: the run goes on until the retry has an outcome or the run ends
  };
  while(v.tick<(input.maxTicks??12000)&&!TERMINAL.includes(v.run.status)){v=await act('step',{ticks:25});if(v.tick>=1200&&v.tick%50===0&&await cupDone())break;}
  report=await run.report();
 }finally{await run?.close();}
 const evidence=await buildPerceptionReport(join(runDir,'belief-evidence'),undefined,{runId:report.manifest.runId});
 const result:PickRigResult&{beliefErrorAtCommitM:number|null}={runId:report.manifest.runId,...rigDerived(input.mode,evidence,report as never),directory:input.directory};
 const rest:Omit<PickRigInput,'directory'>={...input};delete (rest as {directory?:string}).directory;
 await writeFile(join(input.directory,'rig-run.json'),JSON.stringify({schemaVersion:1,input:rest,offsetM,result} satisfies RigRunRecord,null,2)+'\n');
 await writeFile(join(input.directory,'report.json'),JSON.stringify(report));
 // the world streams of the run are large and not part of the study's evidence; the belief stream, the report and the run record are
 for(const name of ['mujoco-world','physics-evidence','world-evidence'])await rm(join(runDir,name),{recursive:true,force:true});
 return result;
}
