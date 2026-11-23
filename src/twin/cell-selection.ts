import type {TwinPreset} from '../scenarios/catalog';
import type {TwinHealth} from '../scenarios/controls';
export const NOMINAL_PERCEPTION_PROFILE='perception-nominal-v1';
export const TWO_STAGE='cup-pick-two-stage-v1',CUP_NUDGE='world-cup-nudge-v2';
export function compatibleProgram(health:TwinHealth|null,p:TwinPreset){
 const mode=health?.graspModes?.find(m=>m.id===p.graspMode);
 return p.id==='mujoco-cell'&&!!health?.capabilities?.includes('sim3d_belief_grasp_v1')&&!!mode&&['belief_ground_truth','belief_estimated'].includes(mode.id)&&!!mode.programIds?.includes(TWO_STAGE)&&!!mode.recoveryPolicyIds?.includes('pick-recovery-v1')&&(mode.id!=='belief_estimated'||!!mode.profileIds?.includes(NOMINAL_PERCEPTION_PROFILE));
}
export function compatibleExperiment(health:TwinHealth|null,p:TwinPreset,id:string){
 const e=health?.worldExperiments?.find(e=>e.id===id&&e.requiresNewRun);
 return !!health?.capabilities?.includes('sim3d_world_experiments_v1')&&!!e&&(id!==CUP_NUDGE||compatibleProgram(health,p)&&p.graspProgramId===TWO_STAGE&&e.graspProgramId===TWO_STAGE&&!!e.graspModes?.includes(p.graspMode!));
}
