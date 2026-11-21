/** Source-owned campaign presets. No arbitrary force vectors or body IDs on a request. */
export const WORLD_DISTURBANCE_PRESETS={
 'world-dock-drift-v1':{revision:1,frame:'map',forceMapN:[2000,0,0],durationSubsteps:10,trigger:'before_release'},
 'world-cup-fall-v1':{revision:1,frame:'map',forceMapN:[30,0,30],durationSubsteps:10,trigger:'transport'},
 // R4.4 (belief grasp only): one small push of cup-1 on the nozzle stand, once, after the first belief grasp of that cup has committed and before the gripper closes.
 'world-cup-nudge-v1':{revision:1,frame:'map',forceMapN:[14.4,0,0],durationSubsteps:10,trigger:'after_belief_commit'},
} as const;
export interface CellDisturbanceOption {presetId:keyof typeof WORLD_DISTURBANCE_PRESETS;cupId:string}
import type {Sim3DSnapshotV1,LabWorldSceneV1} from '../navigation2d/contracts';
import type {WorldEvidenceRecord} from '../../../../contracts/generated/navigation2d';
import {hashJson} from '../hash';
import {driveWireCommand} from '../control/drive-run';
/** Independent readback of native disturbance identity, fixed force and before/after positions. */
export function validateWorldDisturbance(snapshot:Sim3DSnapshotV1,command:WorldEvidenceRecord['command'],scene:LabWorldSceneV1,previous:Sim3DSnapshotV1|undefined,seen:ReadonlySet<string>):string|null{
 const intents=command?.worldPerturbations??[],receipts=snapshot.worldStep?.disturbances??[],fail=()=>{throw Error('WORLD_PERTURBATION_EVIDENCE_INVALID');};
 if(intents.length!==receipts.length||intents.length>1)fail();if(!intents.length)return null;
 const intent=intents[0]!,r=receipts[0]!,admitted=scene.disturbance;if(!admitted||!previous||seen.has(admitted.presetId))fail();
 const preset=WORLD_DISTURBANCE_PRESETS[intent.presetId],rid=scene.navigation.robots[0]!.robotId;
 const at=(s:Sim3DSnapshotV1,id:string)=>id===rid?s.physics?.base[0]?.poseMap.positionM:s.props?.find(p=>p.propId===id)?.position;
 if(!preset||intent.presetId!==admitted!.presetId||intent.revision!==admitted!.revision||intent.targetId!==admitted!.targetId||intent.targetTick!==snapshot.tick||!intent.eventId||r.eventId!==intent.eventId||r.presetId!==intent.presetId||r.revision!==intent.revision||r.targetId!==intent.targetId||r.targetTick!==snapshot.tick||r.runId!==snapshot.runId||r.bootId!==snapshot.bootId||r.sceneDigest!==snapshot.sceneDigest||r.requestId!==`world-${snapshot.tick+2}`||r.requestDigest!==hashJson((scene.engine?.driveModelRef&&command?driveWireCommand(command as never):command) as never)||r.frame!=='map'||r.durationSubsteps!==preset.durationSubsteps||hashJson(r.forceMapN)!==hashJson(preset.forceMapN)||hashJson(r.beforePositionM)!==hashJson(at(previous!,intent.targetId))||hashJson(r.afterPositionM)!==hashJson(at(snapshot,intent.targetId)))fail();
 return admitted!.presetId;
}

export type WorldExperimentId='world-nominal-v1'|keyof typeof WORLD_DISTURBANCE_PRESETS;
/** Fixed cup from the registered two-cup cell workload; no browser target, force, timing or same-run edit. */
export function worldExperiment(input:{worldExperimentId?:string;graspMode?:string;backendSetId:string;scenarioId:string;mode:string}):CellDisturbanceOption|undefined{
 const id=input.worldExperimentId;if(id===undefined)return undefined;if(input.backendSetId!=='engineering-mujoco-cell-v1'||input.scenarioId!=='MJ-CELL-BV01'||input.mode!=='simulation'||id!=='world-nominal-v1'&&!Object.hasOwn(WORLD_DISTURBANCE_PRESETS,id))throw Error('WORLD_EXPERIMENT_SCOPE_INVALID');if(id==='world-cup-nudge-v1'&&(input.graspMode===undefined||input.graspMode==='fixed_program'))throw Error('WORLD_EXPERIMENT_SCOPE_INVALID');return id==='world-nominal-v1'?undefined:{presetId:id as CellDisturbanceOption['presetId'],cupId:'cup-1'};
}
