// R4-B §8.1: one pick-rig run. The rig is the registered shared-world cell on the derived pick-rig-v1 fixture (the cup is born off the nominal centre, within the rig policy), started like any cell run and
// stopped when the first cup's grasp has a final outcome. The artifacts of a run are its retained belief stream, the report and `rig-run.json` (the inputs with the real offset and what the stream says).
// Campaign-only: nothing here is reachable from a request.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createScenarioRun,type ScenarioRun} from '../scenario-runner';
import {serviceAmrAsset} from '../assets';
import {defaultCatalog} from '../capabilities';
import {mujocoWorldPorts} from '../simulation3d/mujoco-world-ports';
import type {MujocoRuntimeOptions} from '../simulation3d/mujoco';
import type {WorldFactoryInput,WorldPlantBindings} from '../simulation3d/world-ports';
import type {GraspAttempt} from '../../../../contracts/generated/navigation2d';
import {rigOffsetM} from './perception-study';
import {PICK_RIG_ENDPOINT_PROTOCOL,readPickRigEvidence,type RigReport,type RigEndpoint} from './pick-rig-evidence';
export {rigReportFacts} from './pick-rig-evidence';
export interface PickRigInput {seed:number;mode:'fixed_program'|'belief_ground_truth'|'belief_estimated';truthOffsetM:number;profileId:string|null;nudge:boolean;recoveryPolicyId:string|null;directory:string;sourceCommit?:string;maxTicks?:number;/** test only, see MujocoRuntimeOptions.rig */transientBias?:{vectorM:[number,number];attempts:number};/** test only, see MujocoRuntimeOptions.rig */gripHoldAttempts?:number}
export interface PickRigResult {runId:string;outcome:GraspAttempt['outcome']|'none';attempts:number;recovered:boolean;attention:boolean;ticks:number;unexpectedContacts:number;directory:string;endpoint:RigEndpoint;birth:Awaited<ReturnType<typeof readPickRigEvidence>>['birth']}
export interface RigRunRecord {schemaVersion:2;endpointProtocol:typeof PICK_RIG_ENDPOINT_PROTOCOL;accepted:false;calibration:'not_calibrated';input:Omit<PickRigInput,'directory'>;offsetM:[number,number];result:PickRigResult&{beliefErrorAtCommitM:number|null}}
const TERMINAL=['completed','needs_attention','cancelled'];
export async function runPickRig(input:PickRigInput,runtime:MujocoRuntimeOptions):Promise<PickRigResult&{beliefErrorAtCommitM:number|null}>{
 const maxTicks=input.maxTicks??12000;if(!Number.isSafeInteger(maxTicks)||maxTicks<1||maxTicks>12000)throw Error('RIG_MAX_TICKS_INVALID');
 const offsetM=rigOffsetM(input.seed,input.truthOffsetM),runDir=join(input.directory,'run');await mkdir(runDir,{recursive:true});
 const project=JSON.parse(await readFile(join(runtime.workerRoot,'fixtures/coffee-delivery-cell-v1/project.json'),'utf8'));
 const factory=mujocoWorldPorts({...runtime,rig:{offsetM,...input.transientBias?{transientBias:input.transientBias}:{},...input.gripHoldAttempts?{gripHoldAttempts:input.gripHoldAttempts}:{}},...input.nudge?{cellDisturbance:{presetId:'world-cup-nudge-v1' as const,cupId:'cup-1'}}:{}});
 let bindings!:WorldPlantBindings,factoryInput!:WorldFactoryInput;
 const catalog={...defaultCatalog,backends:defaultCatalog.backends.map(b=>['mujoco_arm','mujoco_3d'].includes(b.id)?{...b,installed:true,compatible:true,reachable:true}:b)};
 const manifest={project,scenarioId:'MJ-CELL-BV01',scenarioRevision:1,seed:input.seed,mode:'simulation' as const,access:'simulated' as const,backendSetId:'engineering-mujoco-cell-v1',sourceCommit:input.sourceCommit??'development:pick-rig',
  ...input.mode==='fixed_program'?{}:{graspMode:input.mode,...input.profileId?{perceptionProfileId:input.profileId}:{},...input.recoveryPolicyId?{recoveryPolicyId:input.recoveryPolicyId}:{}}};
 const providers={directory:runDir,catalog,assets:[serviceAmrAsset({id:'service-robot',revision:1,chassis:'service',trays:3,sensor:'lidar'})],enabledBackends:['mujoco_3d','mujoco_arm','mock_coffee'],worldPorts:async(i:WorldFactoryInput)=>{factoryInput=i;bindings=await factory(i);return bindings;}};
 let run:ScenarioRun|undefined,n=0;
 const act=async(kind:string,payload:object={})=>{const v=await run!.snapshot();return run!.action({actionId:`pick-rig-${++n}`,expectedRevision:v.run.runRevision,kind,payload});};
 let v:Awaited<ReturnType<ScenarioRun['snapshot']>>,report:RigReport;
 try{
  run=await createScenarioRun(manifest as never,providers as never);await run.start();v=await run.snapshot();
  let commandId:string|null=null;
  // One logical tick at a time: the shared program remains running during legal
  // retries. A completed/refused/unknown first pick ends every mode identically.
  while(v.tick<maxTicks&&!TERMINAL.includes(v.run.status)){
   v=await act('step',{ticks:1});const arm=bindings.coffee.snapshot().arm!;
   if(!commandId&&arm.programs.some(p=>p.program==='cup-pick')){
    const cup=(await factoryInput.context.source.read('cup','cup-1')).state,pending=cup.pendingTransfer as {commandId?:string;to?:{kind?:string}}|null;
    if(pending?.to?.kind==='arm'&&pending.commandId)commandId=pending.commandId;
    // Completion can stage place in this same tick; the confirmed movement still
    // retains the first pick's command identity.
    commandId??=((cup.movements??[]) as {to:{kind:string};evidence?:{commandId?:string}}[]).find(m=>m.to.kind==='arm')?.evidence?.commandId??null;
   }
   if(commandId&&arm.programs.some(p=>p.commandId===commandId&&p.program==='cup-pick'&&p.state!=='running'))break;
  }
  report={...await run.report(),pickRig:{endpointProtocol:PICK_RIG_ENDPOINT_PROTOCOL,maxTicks}};
 }finally{await run?.close();}
 await writeFile(join(input.directory,'report.json'),JSON.stringify(report));
 const rest:Omit<PickRigInput,'directory'>={...input};delete (rest as {directory?:string}).directory;
 rest.sourceCommit=report.manifest.sourceCommit;
 const result:PickRigResult&{beliefErrorAtCommitM:number|null}={runId:report.manifest.runId,...await readPickRigEvidence(input.directory,rest,report),directory:input.directory};
 await writeFile(join(input.directory,'rig-run.json'),JSON.stringify({schemaVersion:2,endpointProtocol:PICK_RIG_ENDPOINT_PROTOCOL,accepted:false,calibration:'not_calibrated',input:rest,offsetM,result} satisfies RigRunRecord,null,2)+'\n');
 // Retain the actual world, admitted fixture, props trace and signed Source journal.
 return result;
}
