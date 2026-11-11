// The Webots 3D plant (backend webots_3d). Webots R2025a is a host install: its version and the sha256 of its executable are part of every run's identity, and nothing
// here installs or downloads it.
import type {IRSimRuntimeOptions,PlantPort} from '../navigation2d/plant';
import type {ArmObstacle} from '../models/arm-collision';
import {spawnSim3DWorker} from './worker-client';

export const WEBOTS_AMR={id:'webots_3d',version:'R2025a',model:'webots_diff_drive',dynamics:true} as const;
export interface WebotsRuntimeOptions extends IRSimRuntimeOptions {webotsHome:string;executableSha256:string;basicTimeStepMs:number;
 /** Test/fault option: an arm-ref-3d-v1 fixture directory (component.json + manifest.json) other than the committed one, e.g. a joint with a weak motor. Never exposed through a request. */armFixtureDir?:string;
 /** Test/fault option: obstacles (arm base frame) that exist in the Webots arm world only, as if a real object were in the way the project does not declare. The TS capsule check never sees them. Never exposed through a request. */armExtraStatics?:ArmObstacle[]}
export const webotsPlant=(runtime:WebotsRuntimeOptions):PlantPort=>({
 identity:{amr:WEBOTS_AMR,telemetryLabel:'webots_3d simulated plant (rigid-body physics, in memory)',capability:'sim3d_navigation_v1',coverage:{dynamics:true},
  limitations:['webots_3d simulated plant (Webots R2025a rigid-body physics, differential drive with passive casters).',
   'not_calibrated: every physical parameter (mass, inertia, friction, caster size, wheel torque limit, heights) is an assumed fixture value; the dynamics say nothing about the real robot.',
   'The engine runs one 20 ms step ahead of the source clock: a settling step with every wheel at rest precedes tick 0.'],
  // the engine seed is derived as for IR-SIM (engineSeedOf); WorldInfo.randomSeed is an SFInt32, so the engine gets (and the evidence records) its low 31 bits
  evidence:{seedAlgorithm:'webots-worldinfo-seed-v1',engineSeed:derived=>derived&0x7fffffff,limitation:'webots_3d plant (Webots R2025a rigid-body physics): not_calibrated, every physical parameter is assumed',
  engine:d=>({id:'webots_3d',engineVersion:d.version,executableSha256:runtime.executableSha256,basicTimeStepMs:runtime.basicTimeStepMs,pythonVersion:d.pythonVersion,platform:d.platform,lockDigest:d.lockDigest})}},
 protocol:'mekoniq-sim3d/1',
 spawn:o=>spawnSim3DWorker({...o,webotsHome:runtime.webotsHome}),
});
