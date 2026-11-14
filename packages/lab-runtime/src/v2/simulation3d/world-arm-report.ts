/** Transient report reconstruction from one trusted Source horizon and captured world stream. */
import type {ArmPlantState,ArmPropSample} from '../../../../cell-adapters/src/mock-arm';
import type {ArmReportMaterialization,WorldReportSource} from '../beverage/coffee-ports';
import {materializeWorldPrefix,type WorldPrefixCapture,type WorldAdmission} from './world-evidence';
import {evaluateWorldSweep,unavailableWorldSweep} from './world-sweep';
import {worldDocument} from './world-control';
import type {XArmPhysics} from './arm-cell-scene';
import {join} from 'node:path';
import {readBoundedPhysicsFile} from './physics-evidence';
import {prepareWorldAdmission,captureWorldPrefixDisk} from './world-evidence';
import {validateWorldScene} from './world-scene';
import {READ_LIMITS,EVIDENCE_LIMITS} from '../navigation2d/evidence';
import {trackingStats} from './arm-ports';
import type {ArmCellEvidence,CoffeePlantPorts} from '../beverage/coffee-ports';
import type {ArmProgramRecord} from '../report';
import type {LoadProfileV1} from '../navigation2d/contracts';
export async function materializeWorldArmReport(capture:WorldPrefixCapture,admission:WorldAdmission,critical:ArmPlantState,source:WorldReportSource,replay?:import('../beverage/coffee-ports').WorldReplaySink):Promise<ArmReportMaterialization>{
 const state=structuredClone(critical),h=capture.requestedTick,prefix=await materializeWorldPrefix(capture,admission),issues=[...prefix.issues];let covered=prefix.covered;
 if(covered)try{
  if(!state.tracking)throw Error('WORLD_TRACKING_STATE_MISSING');const aid=admission.scene.armCell.arm.armId,physics=worldDocument<XArmPhysics>(admission.files,admission.scene.models.armPhysics.path),trace:NonNullable<ArmPlantState['tracking']>['trace']=[],props:ArmPropSample[]=[];
  for(const row of prefix.records){const s=row.snapshot,a=s.arms![0]!,c=row.command,target=c?.jointTargets?.find(t=>t.armId===aid),gripper=c?.gripperTargets?.find(t=>t.armId===aid);if(s.tick>0&&(!target||!gripper))throw Error('WORLD_ARM_COMMAND_MISSING');
   trace.push({tick:s.tick,actualRad:[...a.positionsRad],commandedRad:[...(target?.positionsRad??admission.scene.armCell.arm.homeRad)],gripperCommandM:gripper?.openingM??physics.gripper.openingMaxM});
   props.push({tick:s.tick,props:s.props!.map(p=>({propId:p.propId,positionM:[...p.position] as [number,number,number],quaternionXyzw:[...p.quaternionXyzw] as [number,number,number,number],restingOn:p.restingOn,held:a.gripper!.heldPropIds.includes(p.propId)}))});
  }
  state.tracking.trace=trace;state.tracking.props=props;
 }catch(e){covered=false;issues.push((e as Error).message);}
 const authority={runId:capture.authority.runId,bootId:capture.authority.bootId,sceneDigest:capture.authority.sceneDigest,lastCommittedTick:h,businessEpochMs:source.businessEpochMs};
 const worldSweep=covered?evaluateWorldSweep(prefix.records,admission,source.journal,authority,true):unavailableWorldSweep(h,issues);worldSweep.complete=worldSweep.complete&&prefix.publication.streamFinalized;
 worldSweep.scope={kind:'source_committed_prefix',publicCommittedTick:h,prefixCovered:covered,streamFinalized:prefix.publication.streamFinalized,identity:{runId:authority.runId,bootId:authority.bootId,sceneDigest:authority.sceneDigest,admissionDigest:admission.digest},publication:prefix.publication};
 if(replay){if(!covered)throw Error('REPLAY_WORLD_PREFIX_UNAVAILABLE');await replay({records:structuredClone(prefix.records),admission:{...admission,files:new Map([...admission.files].map(([p,b])=>[p,new Uint8Array(b)])),scene:structuredClone(admission.scene),physics:structuredClone(admission.physics),modelCounts:{...admission.modelCounts}}});}
 const samples=state.tracking?.trace??[];return {state,worldSweep,worldTrace:{method:'world-committed-trace-v1',scope:covered?'all_world_ticks':'retained_cache_only',publicCommittedTick:h,prefixCovered:covered,streamFinalized:prefix.publication.streamFinalized,trackingStatisticsScope:'active_program_ticks',trackingSamples:critical.tracking?.samples??0,firstTick:samples[0]?.tick??null,lastTick:samples.at(-1)?.tick??null,samples:samples.length,reasonCodes:issues,publication:prefix.publication,...critical.historyRetention?{hotHistoryPolicy:{mode:critical.historyRetention.mode,limit:critical.historyRetention.limit}}:{}}};
}

/** An unavailable archive remains inspectable, with no replacement fixture or engine. */
export function unavailableWorldArmReport(critical:ArmPlantState,identity:{runId:string;bootId:string;sceneDigest:string},publicCommittedTick:number,reasonCodes:string[]):ArmReportMaterialization{
 const state=structuredClone(critical),samples=state.tracking?.trace??[],worldSweep=unavailableWorldSweep(publicCommittedTick,reasonCodes);worldSweep.scope={kind:'source_committed_prefix',publicCommittedTick,prefixCovered:false,streamFinalized:false,identity:{...identity,admissionDigest:null}};
 return {state,worldSweep,worldTrace:{method:'world-committed-trace-v1',scope:'retained_cache_only',publicCommittedTick,prefixCovered:false,streamFinalized:false,trackingStatisticsScope:'active_program_ticks',trackingSamples:state.tracking?.samples??0,firstTick:samples[0]?.tick??null,lastTick:samples.at(-1)?.tick??null,samples:samples.length,reasonCodes:[...reasonCodes],...state.historyRetention?{hotHistoryPolicy:{mode:state.historyRetention.mode,limit:state.historyRetention.limit}}:{}}};
}
export async function readRetainedWorldAdmission(directory:string,sceneDigest:string){
 const bundle=join(directory,'mujoco-world','bundle'),raw=await readBoundedPhysicsFile(bundle,'lab-world-scene.json',READ_LIMITS.manifestBytes),scene:unknown=JSON.parse(raw.toString());validateWorldScene(scene);if(scene.sceneDigest!==sceneDigest)throw Error('WORLD_RETAINED_SCENE_MISMATCH');
 const files=new Map<string,Uint8Array>();let bytes=raw.length;for(const ref of scene.files){bytes+=ref.bytes;if(bytes>EVIDENCE_LIMITS.maxBytes)throw Error('WORLD_RETAINED_BUNDLE_READ_LIMIT');files.set(ref.path,await readBoundedPhysicsFile(bundle,ref.path,ref.bytes));}return prepareWorldAdmission(scene,files);
}
/** Read-only reopen consumes its retained admitted bundle, never the installed latest fixture. */
export async function retainedWorldArmReports(o:{directory:string;runId:string;bootId:string;sceneDigest:string;engineVersion:string;program:ArmProgramRecord;state():ArmPlantState;publicTick():number}):Promise<{report():Pick<ReturnType<CoffeePlantPorts['report']>,'armPlant'|'armCell'>;armReportState:NonNullable<CoffeePlantPorts['armReportState']>}>{
 let admission:WorldAdmission|undefined,unavailable='WORLD_RETAINED_BUNDLE_UNAVAILABLE',cell:ArmCellEvidence|undefined;
 try{admission=await readRetainedWorldAdmission(o.directory,o.sceneDigest);if(admission.scene.models.armPhysics.sha256!==o.program.physicsDigest)throw Error('WORLD_RETAINED_PROGRAM_MISMATCH');
  const s=admission.scene,doc=worldDocument<{digest:string;table:ArmCellEvidence['waypoints']['table']}>(admission.files,s.programsRef.path),load=worldDocument<LoadProfileV1>(admission.files,s.models.emptyLoad.path),support=load.supports.find(p=>p.supportId===s.supportMap.mobileSupportId)!;
  cell={waypoints:{digest:doc.digest,table:doc.table},allowedContactPolicy:'phase_region_v1',allowedContacts:s.allowedContactRules.map(r=>({a:r.a,b:r.b,phase:r.phase,regionId:r.regionId,sweepPair:[r.a==='held_prop'?'held-cup':r.a,r.regionId==='nozzle-stand'?'support/nozzle-stand':`${s.navigation.robots[0]!.robotId}/${support.parentBodyId}/c0`]})),releaseTimeoutTicks:o.program.programs.contact!.releaseTimeoutTicks,notes:['Read-only retained shared-world observations; no physical world recovery or replacement fixture.','Tracking statistics cover active program ticks; reconstructed traces separately include every committed world tick.','Modeled shared-engine observations, not_calibrated; no hardware sensor independence or physical stopping proof.'],inputs:{componentDigest:s.models.armComponent.sha256,physicsDigest:s.models.armPhysics.sha256,sceneDigest:s.sceneDigest}};
 }catch(e){admission=undefined;unavailable=(e as NodeJS.ErrnoException).code==='ENOENT'?'WORLD_RETAINED_BUNDLE_UNAVAILABLE':(e as Error).message;}
 return {report(){const t=o.state().tracking;return {...t?{armPlant:{engine:'mujoco_3d' as const,engineVersion:o.engineVersion,control:'position_actuator' as const,grip:'contact' as const,dynamics:'manufacturer_nominal+assumed' as const,calibration:'not_calibrated' as const,tracking:trackingStats(t)}}:{},...cell?{armCell:structuredClone(cell)}:{}};},
  async armReportState(publicCommittedTick,source){if(publicCommittedTick!==o.publicTick()||o.state().tick!==publicCommittedTick)throw Error('WORLD_REPORT_HORIZON_INVALID');const critical=structuredClone(o.state()),capturedSource=structuredClone(source),identity={runId:o.runId,bootId:o.bootId,sceneDigest:o.sceneDigest},a=admission;
   if(!a)return {materialize:async()=>unavailableWorldArmReport(critical,identity,publicCommittedTick,[unavailable])};
   const capture=await captureWorldPrefixDisk(join(o.directory,'world-evidence'),a,{...identity,admissionDigest:a.digest,publicCommittedTick});return {materialize:replay=>materializeWorldArmReport(capture,a,critical,capturedSource,replay)};
  }};
}
