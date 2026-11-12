// The MuJoCo arm provider (backend mujoco_arm, R2a): operator opt-in (MEKONIQ_LAB_MUJOCO=1), a hash-locked .venv-mujoco, a real worker describe at boot, and per-request readiness from
// the run's project (the cell scene) plus a real create smoke. MuJoCo runs inside the worker process: nothing here installs anything or falls back to another plant.
import type {IRSimRuntimeOptions} from '../navigation2d/plant';
import type {ArmObstacle} from '../models/arm-collision';
import type {XArmPhysics} from './arm-cell-scene';

/** One MuJoCo arm run per host: the run's world is one engine in one worker. */
export const MUJOCO_MAX_ACTIVE_RUNS=1,MUJOCO_SLOT='mujoco_arm';
export interface MujocoRuntimeOptions extends IRSimRuntimeOptions {engineVersion:string;maxActiveRuns?:number;
 /** Test/fault option: obstacles (arm base frame) that exist in the MuJoCo cell only; the TS capsule check never sees them. Never exposed through a request. */armExtraStatics?:readonly ArmObstacle[];
 /** Test/fault option: physics.json fields replaced for the worker (e.g. weaker gains). Never exposed through a request. */physicsOverride?:Partial<XArmPhysics>;
 /** Test/fault option: the pad friction of the cell scene (e.g. a slippery grip). Never exposed through a request. */padFrictionOverride?:number}
