import Ajv from 'ajv';
import schema from '../../../contracts/schemas/engineering-calibration.schema.json';
import type {CalibrationDataset,CalibrationResult,PredictionSeries} from '../../../contracts/generated/engineering';
export type {CalibrationDataset,CalibrationResult,PredictionSeries};

const ajv=new Ajv({allErrors:true,strict:true});
ajv.addSchema(schema);
const validateDataset=ajv.getSchema(schema.$id)!,validatePrediction=ajv.getSchema(`${schema.$id}#/definitions/PredictionSeries`)!;
const empty=(status:CalibrationResult['status'],reasons:string[],invalidatedBy:string|null=null):CalibrationResult=>({status,reasons:[...new Set(reasons)],residuals:{},domain:{},calibratedCapabilities:[],invalidatedBy});

/**
 * Compares a model's prediction with an instrumented dataset on the validation split. Only `measured` data with predeclared tolerances can pass; units, clock domain and
 * model hash must already agree (nothing is converted or assumed); predictions are never interpolated across a gap larger than the policy allows.
 */
export function assessCalibration(dataset:CalibrationDataset|null,prediction:PredictionSeries):CalibrationResult {
  if (!dataset) return empty('not_run',['CALIBRATION_DATA_REQUIRED']);
  if (!validateDataset(dataset)) return empty('fail',['DATASET_SCHEMA_INVALID']);
  if (!validatePrediction(prediction)) return empty('fail',['PREDICTION_SCHEMA_INVALID']);
  const structural:string[]=[];
  let invalidatedBy:string|null=null;
  if (dataset.sourceKind!=='measured') structural.push('MEASURED_DATA_REQUIRED');
  if (dataset.configDigest!==prediction.configDigest) {structural.push('CONFIG_DIGEST_MISMATCH');invalidatedBy=prediction.configDigest;}
  if (dataset.clockMapping.domain!==prediction.clockDomain) structural.push('CLOCK_MISMATCH');
  for (const [channel,unit] of Object.entries(dataset.units)) if (prediction.units[channel]!==unit) structural.push('UNIT_MISMATCH');
  const ids=dataset.trials.map(t=>t.trialId);
  if (new Set(ids).size!==ids.length) structural.push('CALIBRATION_SPLIT_LEAKAGE');
  const tune=dataset.trials.filter(t=>t.split==='tune'),validation=dataset.trials.filter(t=>t.split==='validation');
  if (!validation.length) structural.push('NO_VALIDATION_SPLIT');
  else {
    const byCondition=new Map<string,number>();
    for (const t of validation) byCondition.set(t.condition,(byCondition.get(t.condition)??0)+1);
    if ([...byCondition.values()].some(n=>n<dataset.policy.minTrialsPerCondition)) structural.push('TRIALS_INSUFFICIENT');
  }
  for (const [channel,tol] of Object.entries(dataset.policy.channels)) if ((dataset.uncertainty[channel]??Infinity)>tol.absoluteTolerance) structural.push(`UNCERTAINTY_EXCEEDS_TOLERANCE:${channel}`);
  if (structural.length) return empty('fail',structural,invalidatedBy);

  const domain:CalibrationResult['domain']={};
  for (const channel of Object.keys(dataset.policy.channels)) {
    const values=tune.flatMap(t=>t.channels[channel]??[]);
    if (values.length) domain[channel]={min:Math.min(...values),max:Math.max(...values)};
  }
  const reasons:string[]=[],stats:Record<string,{n:number;sum:number;max:number;ok:boolean}>={};
  for (const t of validation) {
    const predicted=prediction.trials.find(p=>p.trialId===t.trialId);
    if (!predicted) {reasons.push(`PREDICTION_TRIAL_MISSING:${t.trialId}`);continue;}
    for (const [channel,tol] of Object.entries(dataset.policy.channels)) {
      const measured=t.channels[channel],series=predicted.channels[channel];
      if (!measured) continue;
      if (!series) {reasons.push(`CHANNEL_MISSING:${channel}`);continue;}
      const s=stats[channel]??={n:0,sum:0,max:0,ok:true};
      measured.forEach((m,i)=>{
        const at=t.timesNs[i]!+dataset.clockMapping.offsetNs,d=domain[channel];
        if (d&&(m<d.min||m>d.max)) reasons.push('OUT_OF_DOMAIN');
        const value=sampleAt(predicted.timesNs,series,at,dataset.policy.maxClockGapNs);
        if (value==='gap') {reasons.push('CLOCK_GAP_TOO_LARGE');s.ok=false;return;}
        const error=Math.abs(value-m);
        s.n+=1;s.sum+=error;s.max=Math.max(s.max,error);
        if (!(error<=Math.max(tol.absoluteTolerance,tol.relativeTolerance*Math.abs(m)))) s.ok=false;
      });
    }
  }
  const residuals:CalibrationResult['residuals']={};
  for (const [channel,s] of Object.entries(stats)) {
    residuals[channel]={samples:s.n,meanAbs:s.n?s.sum/s.n:0,maxAbs:s.max,withinTolerance:s.ok&&s.n>0};
    if (!residuals[channel]!.withinTolerance&&!reasons.includes('CLOCK_GAP_TOO_LARGE')) reasons.push(`RESIDUAL_EXCEEDS_TOLERANCE:${channel}`);
  }
  const unique=[...new Set(reasons)];
  const capabilities=unique.length?[]:[...new Set(Object.keys(stats).map(c=>dataset.policy.capabilities[c]).filter(Boolean) as string[])].sort();
  return {status:unique.length?'fail':'pass',reasons:unique,residuals,domain,calibratedCapabilities:capabilities,invalidatedBy:null};
}
/** Linear interpolation inside one predicted interval; refuses when the bracketing samples are further apart than the policy or the instant is outside the series. */
function sampleAt(times:readonly number[],values:readonly number[],at:number,maxGapNs:number):number|'gap' {
  for (let i=0;i<times.length;i++) {
    if (times[i]===at) return values[i]!;
    if (times[i]!>at) {
      if (i===0) return 'gap';
      const t0=times[i-1]!,t1=times[i]!;
      return t1-t0>maxGapNs?'gap':values[i-1]!+(values[i]!-values[i-1]!)*(at-t0)/(t1-t0);
    }
  }
  return 'gap';
}
