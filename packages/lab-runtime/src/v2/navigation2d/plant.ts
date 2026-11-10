// The plant port: everything the fixed-step runner needs to know about the engine behind a run, so the same runner drives IR-SIM (irsim_2d) and Webots (webots_3d).
// The runner owns the clock, the missions, the journal and the evidence; a plant only steps, senses and says who it is. One run, one plant, no fallback between them.
import type {IRSimResponseV1} from './contracts';
import {IRSIM_AMR} from './adapter';
import type {EvidenceProfile} from './evidence';
import {spawnIRSimWorker,WorkerLostError,type SpawnOptions,type WireRequest} from './worker-client';
export {WorkerLostError};
export type {SpawnOptions};

export const IRSIM_BACKEND=IRSIM_AMR.id;
/** Who the plant is and what a report may claim about it. */
export interface PlantIdentity {
 /** the backend manifest entry of the run (`id` is the provider written into the checkpoint and every twin sample) */
 amr:{readonly id:string;readonly version:string;readonly model:string;readonly dynamics:boolean};
 /** label of the in-memory telemetry recorder */telemetryLabel:string;
 /** first lines of the report's limitations (the scenario's and the scene's follow) */limitations:readonly string[];
 /** what the report may claim: `dynamics` is true only for a plant that simulates it */coverage:{dynamics:boolean};
 /** the capability the server must advertise before a set of this plant is selectable */capability:string;
 /** the evidence's engine identity and seed derivation; absent means IR-SIM */evidence?:EvidenceProfile;
}
export type PlantRequest=WireRequest;
export type PlantResponse=IRSimResponseV1;
export interface PlantWorker {
 request(r:PlantRequest):Promise<PlantResponse>;
 close(reason:string):Promise<void>;
 readonly state:'ready'|'failed'|'closed';readonly pid:number|undefined;readonly bootId:string|null;readonly stderrTail:string;
}
export interface PlantPort {
 identity:PlantIdentity;
 /** wire protocol of the worker, e.g. mekoniq-irsim/1 */protocol:string;
 spawn(o:SpawnOptions):Promise<PlantWorker>;
}
/** Operator-owned worker options (never from a request). `entry`/`deadlinesMs` exist for test doubles and fault tests; `maxActiveRuns` (default 2) caps live workers per host;
 * `evidence` lowers the durable evidence limits (default 100 MiB, 30,000 ticks) for limit tests. */
export interface IRSimRuntimeOptions {python:string;workerRoot:string;schemaDir:string;lockDigest:string;entry?:string[];deadlinesMs?:Record<string,number>;maxActiveRuns?:number;evidence?:{maxBytes?:number;maxTicks?:number;chunkTicks?:number}}

export const irsimPlant=():PlantPort=>({
 identity:{amr:IRSIM_AMR,telemetryLabel:'irsim_2d simulated plant (modeled, in memory)',capability:'irsim_navigation_v1',coverage:{dynamics:false},
  limitations:['irsim_2d simulated plant (IR-SIM 2.12.0, planar kinematics, collision_mode stop): no dynamics, contact physics or hardware behaviour.']},
 protocol:'mekoniq-irsim/1',
 spawn:o=>spawnIRSimWorker(o),
});
