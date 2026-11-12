// mekoniq-sim3d/1 client: the shared spawnWorker (one request in flight, per-op ACK deadlines, bootId/tick monotonicity, group kill, loss => unknown) with the Webots worker's
// wire. The worker starts and owns the Webots process tree; the group kill here ends every one of them.
import {resolve} from 'node:path';
import {validateSim3DRequest,validateSim3DResponse} from '../navigation2d/contracts';
import {spawnWorker,type IRSimWorkerClient,type SpawnOptions,type WireSpec} from '../navigation2d/worker-client';

/** Errors that end a run: the worker answers once and exits. */
export const SIM3D_FATAL_CODES=['INVALID_JSON','INVALID_REQUEST','REQUEST_TOO_LARGE','PROTOCOL_MISMATCH','WORKER_FAILED','CLOCK_DRIFT','SENSOR_INCONSISTENT','PLANT_UNSTABLE','ENGINE_LOST','ENGINE_TIMEOUT',
 'WEBOTS_START_FAILED','WEBOTS_NOT_INSTALLED','WEBOTS_VERSION_MISMATCH','WEBOTS_PORT_IN_USE'] as const;
// create starts Webots: the worker allows it START_TIMEOUT_S (60) + CHILD_TIMEOUT_S (30) and answers WEBOTS_START_FAILED itself, and describe runs `webots --version` (30 s) and hashes the executable, so the client waits longer than each (a kill on a shorter deadline cannot clean /tmp/webots)
export const SIM3D_WIRE:WireSpec={protocol:'mekoniq-sim3d/1',module:'webots_worker',deadlinesMs:{create:100_000,describe:45_000},
 extraArgs:o=>{if(!o.webotsHome)throw new Error('WEBOTS_HOME_REQUIRED');return ['--webots-home',resolve(o.webotsHome)];},
 env:{HOME:process.env.HOME??'/',TMPDIR:process.env.TMPDIR??'/tmp'}, // Webots keeps its caches and preferences under HOME; nothing else of the environment is passed on
 validateRequest:validateSim3DRequest,validateResponse:validateSim3DResponse as WireSpec['validateResponse'],fatalCodes:SIM3D_FATAL_CODES};
// MEKONIQ_WEBOTS_WATCH=1 (dev): a real run's Webots stays visible and rendered; readiness describe/smoke workers ('webots-…' run ids) stay headless
export const spawnSim3DWorker=(o:SpawnOptions&{webotsHome:string}):Promise<IRSimWorkerClient>=>spawnWorker(o,process.env.MEKONIQ_WEBOTS_WATCH==='1'&&!o.runId.startsWith('webots-')?{...SIM3D_WIRE,env:{...SIM3D_WIRE.env,MEKONIQ_WEBOTS_WATCH:'1'}}:SIM3D_WIRE);
