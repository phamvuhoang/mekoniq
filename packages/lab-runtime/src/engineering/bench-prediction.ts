// R4-C §3 step 4 (V14): the prediction of a measured trial is the SAME bench the trial ran on the device (D42), run again on the current model. The trace is sampled on the clock of the trial: time 0 is
// the sample just before the first substep under the signal (a step's tick, a hold's anchor), the origin benchMetrics uses; samples before it carry negative times, so a log that starts a little early is covered.
// The assessor (assessCalibration) is unchanged and decides; this file only produces what it compares.
import type {CalibrationDataset,PredictionSeries} from './calibration';
import type {CalibrationSidecar} from './calibration-import';
import {BENCH_SUBSTEPS,benchAnchorTick} from '../v2/control/bench-signals';
import type {BenchSignal,ControlProfileV1,DriveModelV1,DriveTrace} from '../v2/control/drive-io';
import {hashJson} from '../v2/hash';

/** One bench run, headless: the traced axis' 500 Hz trace as read back. `physicsOverride` holds registered physics paths only (parameter-paths.ts); it is an input of offline tools, never a request field. */
export type HeadlessBench=(input:{axisId:string;signal:BenchSignal;driveModel:DriveModelV1;control:ControlProfileV1;physicsOverride?:Record<string,number>})=>Promise<DriveTrace>;
export interface PredictionModels {driveModel:DriveModelV1;control:ControlProfileV1;configDigest:string}
/** The channels a bench trace can answer, and the field of a trace sample each reads. `position` is the TRUE state (basis actual); `encoder` is the feedback the controller saw and is refused where it dropped out. */
export const PREDICTION_CHANNELS={command:'target',position:'actual',encoder:'feedback',torque:'torqueNm'} as const;
type Channel=keyof typeof PREDICTION_CHANNELS;
const isChannel=(c:string):c is Channel=>Object.hasOwn(PREDICTION_CHANNELS,c);
/** What a model's channel is in: a csp axis moves in rad, a csv axis in rad/s, torque in N*m. Never converted: the dataset must say the same. */
const unitOf=(channel:Channel,mode:'csp'|'csv')=>channel==='torque'?'N*m':mode==='csp'?'rad':'rad/s';
/** The identity of the MEASURED CONFIGURATION: the plant, the load and the axes the bench ran on. It deliberately leaves out the parameters under calibration (rotor inertia, damping, torque scale) and the control profile
 * (whose digest lists the drive model digests): a revision fitted for this configuration stays valid for it, and a changed plant, load or axis set makes the old calibration invalid (CONFIG_DIGEST_MISMATCH, R4-D49). */
export const calibrationConfigDigest=(parts:{plantModelDigest:string;load:string;axisIds:readonly string[]})=>hashJson({plantModelDigest:parts.plantModelDigest,load:parts.load,axisIds:[...parts.axisIds]});

export async function predictTrials(dataset:CalibrationDataset,sidecar:CalibrationSidecar,models:PredictionModels,bench:HeadlessBench,options:{physicsOverride?:Record<string,number>;trialIds?:ReadonlySet<string>}={}):Promise<PredictionSeries>{
 const channels=Object.keys(dataset.units);
 for(const c of channels)if(!isChannel(c))throw Error(`CHANNEL_UNKNOWN:${c}`);
 const anchor=benchAnchorTick(models.driveModel),trials:PredictionSeries['trials']=[];
 let units:Record<string,string>|null=null;
 for(const t of sidecar.trials){
  if(options.trialIds&&!options.trialIds.has(t.trialId))continue;
  const axis=models.driveModel.axes.find(a=>a.axisId===t.axisId);
  if(!axis)throw Error(`AXIS_UNKNOWN:${t.axisId}`);
  const mine=Object.fromEntries(channels.map(c=>[c,unitOf(c as Channel,axis.mode)]));
  if(units&&JSON.stringify(units)!==JSON.stringify(mine))throw Error('PREDICTION_UNITS_CONFLICT');
  units=mine;
  const trace=await bench({axisId:t.axisId,signal:t.signal,driveModel:models.driveModel,control:models.control,...options.physicsOverride?{physicsOverride:options.physicsOverride}:{}});
  const i0=BENCH_SUBSTEPS*(anchor+(t.signal.kind==='hold'?0:t.signal.atTick))-1,dtNs=Math.round(trace.dtS*1e9);
  const timesNs:number[]=[],values:Record<string,number[]>=Object.fromEntries(channels.map(c=>[c,[]]));
  trace.samples.forEach((s,i)=>{
   if(!s)throw Error('PREDICTION_TRACE_GAP');
   timesNs.push((i-i0)*dtNs);
   for(const c of channels){const v=s[PREDICTION_CHANNELS[c as Channel]];if(v===null)throw Error(`PREDICTION_CHANNEL_UNAVAILABLE:${c}`);values[c]!.push(v);}
  });
  trials.push({trialId:t.trialId,timesNs,channels:values});
 }
 return {configDigest:models.configDigest,clockDomain:sidecar.clockDomain,units:units??{},trials};
}
