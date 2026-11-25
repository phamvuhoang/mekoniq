import type {TwinPreset} from '../scenarios/catalog';
import type {TwinHealth} from '../scenarios/controls';
export const CELL_SET='engineering-mujoco-cell-v1';
export const CELL_SCENARIO='MJ-CELL-BV01';
export const NOMINAL_PERCEPTION_PROFILE='perception-nominal-v1';
export const TWO_STAGE='cup-pick-two-stage-v1',CUP_NUDGE='world-cup-nudge-v2';
export function compatibleProgram(health:TwinHealth|null|undefined,p:TwinPreset){
 const mode=health?.graspModes?.find(m=>m.id===p.graspMode);
 const cell=p.id==='mujoco-cell'&&p.scenarioId===CELL_SCENARIO&&p.scenarioRevision===1&&p.backendSetId===CELL_SET&&p.mode==='simulation'&&
  health?.scenarioIds?.includes(CELL_SCENARIO)&&health.scenarioRequirementsByBackendSet?.[CELL_SCENARIO]?.[CELL_SET]?.supported===true&&
  health.backendSets?.some(set=>set.id===CELL_SET&&set.mode===p.mode&&set.access==='simulated');
 return !!cell&&!!health?.capabilities?.includes('sim3d_belief_grasp_v1')&&!!mode&&['belief_ground_truth','belief_estimated'].includes(mode.id)&&!!mode.programIds?.includes(TWO_STAGE)&&!!mode.recoveryPolicyIds?.includes('pick-recovery-v1')&&(mode.id!=='belief_estimated'||!!mode.profileIds?.includes(NOMINAL_PERCEPTION_PROFILE));
}
export function compatibleExperiment(health:TwinHealth|null|undefined,p:TwinPreset,id:string){
 const e=health?.worldExperiments?.find(e=>e.id===id&&e.requiresNewRun);
 return !!health?.capabilities?.includes('sim3d_world_experiments_v1')&&!!e&&(id!==CUP_NUDGE||compatibleProgram(health,p)&&p.graspProgramId===TWO_STAGE&&e.graspProgramId===TWO_STAGE&&!!e.graspModes?.includes(p.graspMode!));
}
