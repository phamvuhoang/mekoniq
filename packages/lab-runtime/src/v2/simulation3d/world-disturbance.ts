/** Source-owned campaign presets. No arbitrary force vectors or body IDs on a request. */
export const MEASURED_CUP_NUDGE='world-cup-nudge-v2' as const;
export const MEASURED_GRASP_PROGRAM='cup-pick-two-stage-v1' as const;
export const WORLD_DISTURBANCE_PRESETS={
 'world-dock-drift-v1':{revision:1,frame:'map',forceMapN:[2000,0,0],durationSubsteps:10,trigger:'before_release'},
 'world-cup-fall-v1':{revision:1,frame:'map',forceMapN:[30,0,30],durationSubsteps:10,trigger:'transport'},
 // R4.4 (belief grasp only): one small push of cup-1 on the nozzle stand, once, after the first belief grasp of that cup has committed and before the gripper closes.
 'world-cup-nudge-v1':{revision:1,frame:'map',forceMapN:[14.4,0,0],durationSubsteps:10,trigger:'after_belief_commit'},
 [MEASURED_CUP_NUDGE]:{revision:2,frame:'map',forceMapN:[4.025,0,0],torqueMapNm:[0,-0.05*4.025,0],durationSubsteps:10,segments:5,trigger:'after_belief_commit',programId:MEASURED_GRASP_PROGRAM,calibration:'not_calibrated'},
} as const;
export interface CellDisturbanceOption {presetId:keyof typeof WORLD_DISTURBANCE_PRESETS;cupId:string}
import type {Sim3DSnapshotV1,LabWorldSceneV1} from '../navigation2d/contracts';
import type {WorldEvidenceRecord} from '../../../../contracts/generated/navigation2d';
import {hashJson} from '../hash';
import {worldWireCommand,type WorldTickCommand} from './world-ports';
/** A receipt opens exactly one immediately following interval until the fifth segment. */
export function nextPulseSegment(previous:Sim3DSnapshotV1|undefined):number|undefined{
 const r=previous?.worldStep?.disturbances?.[0];
 if(r?.presetId!==MEASURED_CUP_NUDGE||r.segmentIndex===undefined||r.segmentIndex+1>=WORLD_DISTURBANCE_PRESETS[MEASURED_CUP_NUDGE].segments)return undefined;
 return r.segmentIndex+1;
}
export function assertPulseFinished(last:Sim3DSnapshotV1|undefined){if(nextPulseSegment(last)!==undefined)throw Error('WORLD_PERTURBATION_INCOMPLETE');}
/** Independent readback of native disturbance identity, fixed force and before/after positions. */
export function validateWorldDisturbance(snapshot:Sim3DSnapshotV1,command:WorldEvidenceRecord['command'],scene:LabWorldSceneV1,previous:Sim3DSnapshotV1|undefined,seen:ReadonlySet<string>):string|null{
 const intents=command?.worldPerturbations??[],receipts=snapshot.worldStep?.disturbances??[],fail=()=>{throw Error('WORLD_PERTURBATION_EVIDENCE_INVALID');};
 if(intents.length!==receipts.length||intents.length>1)fail();const next=nextPulseSegment(previous);if(!intents.length){if(next!==undefined)fail();return null;}
 const intent=intents[0]!,r=receipts[0]!,admitted=scene.disturbance;if(!admitted||!previous||(next===undefined&&seen.has(admitted.presetId)))fail();
 const preset=WORLD_DISTURBANCE_PRESETS[intent.presetId],rid=scene.navigation.robots[0]!.robotId;
 const at=(s:Sim3DSnapshotV1,id:string)=>id===rid?s.physics?.base[0]?.poseMap.positionM:s.props?.find(p=>p.propId===id)?.position;
 if(!preset||intent.presetId!==admitted!.presetId||intent.revision!==admitted!.revision||intent.targetId!==admitted!.targetId||intent.targetTick!==snapshot.tick||!intent.eventId||r.eventId!==intent.eventId||r.presetId!==intent.presetId||r.revision!==intent.revision||r.targetId!==intent.targetId||r.targetTick!==snapshot.tick||r.runId!==snapshot.runId||r.bootId!==snapshot.bootId||r.sceneDigest!==snapshot.sceneDigest||r.requestId!==`world-${snapshot.tick+2}`||r.requestDigest!==hashJson((command?worldWireCommand(command as WorldTickCommand,!!scene.engine?.driveModelRef):command) as never)||r.frame!=='map'||r.durationSubsteps!==preset.durationSubsteps||hashJson(r.forceMapN)!==hashJson(preset.forceMapN)||hashJson(r.beforePositionM)!==hashJson(at(previous!,intent.targetId))||hashJson(r.afterPositionM)!==hashJson(at(snapshot,intent.targetId)))fail();
 if(intent.presetId===MEASURED_CUP_NUDGE){
  const preset=WORLD_DISTURBANCE_PRESETS[MEASURED_CUP_NUDGE],prior=previous!.worldStep?.disturbances?.[0],prop=previous!.props?.find(p=>p.propId===intent.targetId);
  if(intent.revision!==preset.revision||intent.segmentIndex!==(next??0)||r.segmentIndex!==intent.segmentIndex||!r.torqueMapNm||hashJson(r.torqueMapNm)!==hashJson(preset.torqueMapNm)||
     admitted!.cupId!=='cup-1'||admitted!.trigger!==preset.trigger||!scene.propBindings.some(b=>b.cupId==='cup-1'&&b.propId===intent.targetId)||
     !prop||previous!.arms?.[0]?.gripper?.heldPropIds.length!==0||command?.propPlacements?.some(p=>p.propId===intent.targetId)||
     (next===undefined?prop.restingOn!=='nozzle-stand':!prior||prior.eventId!==intent.eventId||prior.targetId!==intent.targetId||prior.targetTick+1!==snapshot.tick))fail();
 }
 return admitted!.presetId;
}

export type WorldExperimentId='world-nominal-v1'|keyof typeof WORLD_DISTURBANCE_PRESETS;
/** Fixed cup from the registered two-cup cell workload; no browser target, force, timing or same-run edit. */
export function worldExperiment(input:{worldExperimentId?:string;graspMode?:string;graspProgramId?:string;backendSetId:string;scenarioId:string;mode:string}):CellDisturbanceOption|undefined{
 const id=input.worldExperimentId;if(id===undefined)return undefined;if(input.backendSetId!=='engineering-mujoco-cell-v1'||input.scenarioId!=='MJ-CELL-BV01'||input.mode!=='simulation'||id!=='world-nominal-v1'&&!Object.hasOwn(WORLD_DISTURBANCE_PRESETS,id))throw Error('WORLD_EXPERIMENT_SCOPE_INVALID');if(id===MEASURED_CUP_NUDGE&&!admitsMeasuredPulse(input))throw Error('WORLD_EXPERIMENT_SCOPE_INVALID');if(id==='world-cup-nudge-v1'&&(input.graspMode===undefined||input.graspMode==='fixed_program'))throw Error('WORLD_EXPERIMENT_SCOPE_INVALID');return id==='world-nominal-v1'?undefined:{presetId:id as CellDisturbanceOption['presetId'],cupId:'cup-1'};
}

export function admitsMeasuredPulse(input:{graspProgramId?:string;graspMode?:string}){return input.graspProgramId===MEASURED_GRASP_PROGRAM&&(input.graspMode==='belief_ground_truth'||input.graspMode==='belief_estimated');}
