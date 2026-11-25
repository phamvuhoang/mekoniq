// Stored wheel-bench evidence used by both WEB09 and CLD03.
import {isDeepStrictEqual} from 'node:util';
import Ajv from 'ajv';
import benchRequestSchema from '../packages/contracts/schemas/bench-request-v1.schema.json' with {type:'json'};
import controlEvidenceSchema from '../packages/contracts/schemas/control-evidence-v1.schema.json' with {type:'json'};
import controlProfileSchema from '../packages/contracts/schemas/control-profile-v1.schema.json' with {type:'json'};
import driveIoSchema from '../packages/contracts/schemas/drive-io-v1.schema.json' with {type:'json'};
import engineeringComponentSchema from '../packages/contracts/schemas/engineering-component.schema.json' with {type:'json'};
const TICK_MS=20;
export const WHEEL_AXES=['amr-1/wheel-left','amr-1/wheel-right'];
const BENCH_SAMPLES=5000,BENCH_SUBSTEPS=10,BENCH_STEP_S=0.002;
const ajv=new Ajv({discriminator:true})
 .addSchema(benchRequestSchema,'bench-request-v1.schema.json')
 .addSchema(controlEvidenceSchema,'control-evidence-v1.schema.json')
 .addSchema(controlProfileSchema,'control-profile-v1.schema.json')
 .addSchema(driveIoSchema,'drive-io-v1.schema.json')
 .addSchema(engineeringComponentSchema,'engineering-component.schema.json');
const validDriveTrace=ajv.getSchema('mekoniq.drive-io.v1#/definitions/DriveTrace');
const validTuningResult=ajv.getSchema('mekoniq.control-evidence.v1#/definitions/TuningResultV1');
function measuredAxis(axis,axisId){
 if(axis?.axisId!==axisId||axis.dtS!==BENCH_STEP_S||!Array.isArray(axis.samples)||axis.samples.length!==BENCH_SUBSTEPS+BENCH_SAMPLES)return false;
 // DriveTrace's cap is for the measured segment. The first world tick has its
 // own ten substeps, which the plot can show but the tuning report excludes.
 const initial=axis.samples.slice(0,BENCH_SUBSTEPS),measured=axis.samples.slice(BENCH_SUBSTEPS);
 return validDriveTrace({...axis,samples:initial})&&validDriveTrace({...axis,samples:measured})&&measured.every(sample=>sample!==null);
}
export function completedWheelBench(report){
 const {manifest,outcome,tuning,bench,coverage,faults}=report;
 if(!validTuningResult(tuning)||tuning.status!=='completed'||outcome?.status!=='completed'||outcome.served!=='0')return false;
 const tick=outcome.tick;
 if(tick!==BENCH_SAMPLES/BENCH_SUBSTEPS||manifest.clock?.tickMs!==TICK_MS||outcome.simTimeNs!==String(tick*TICK_MS*1_000_000))return false;
 // Each chunk covers at least one tick. Tick zero supplies the initial substeps.
 if(tuning.trace.samples!==tick*BENCH_SUBSTEPS||tuning.trace.chunks>tick+1)return false;
 const request=bench?.request,comparison=tuning.wheelMeasurement?.comparison;
 return benchEngine(report)&&tuning.runId===manifest.runId&&Array.isArray(bench?.traceIssues)&&bench.traceIssues.length===0&&Array.isArray(faults)&&faults.length===0&&coverage?.dynamics===true&&
  tuning.seed===manifest.seed&&request?.scenarioId===manifest.scenario.id&&request.axis==='wheels'&&
  isDeepStrictEqual(request.signal,tuning.signal)&&request.controlProfile?.digest===tuning.plant.controlProfileDigest&&(!comparison||comparison.tick===tick);
}
function benchEngine(report){
 const backends=report.manifest.backends,engine=report.tuning.engine;
 if(!Array.isArray(backends)||backends.length!==1)return false;
 const backend=backends[0];
 return backend?.id==='mujoco_3d'&&backend.model==='mujoco_drive_bench'&&backend.dynamics===true&&engine?.id===backend.id&&
  typeof engine.version==='string'&&engine.version.trim().length>0&&engine.version===backend.version;
}
export function measuredWheelTrace(trace,tuning){
 const axes=trace.traces;
 return trace.runId===tuning.runId&&Array.isArray(trace.issues)&&trace.issues.length===0&&trace.manifestSha256===tuning.trace.sha256&&
  tuning.axisIds.length===WHEEL_AXES.length&&WHEEL_AXES.every(axisId=>tuning.axisIds.includes(axisId))&&
  Array.isArray(axes)&&axes.length===WHEEL_AXES.length&&axes.every((axis,i)=>measuredAxis(axis,tuning.axisIds[i]));
}
