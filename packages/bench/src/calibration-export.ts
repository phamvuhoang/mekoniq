// The calibration dataset of a `measure` part (spec B1 §7.5 step 1, KSW09; K07a): the KMS01 trials as the CSV files and the sidecar that scripts/import-calibration-log.mjs
// takes (CalibrationSidecar of packages/lab-runtime/src/engineering/calibration-import.ts). Values are only put in the kit's units (rad/s); nothing synthetic is ever `measured`.
import type {CalibrationSidecar} from '../../lab-runtime/src/engineering/calibration-import';
import {cycleClock,lagTrialsOf,trialRows,type CaseTrace} from './cases/index';
import type {BenchKitV1,BenchPolicy,BenchSessionV1} from './contracts';

const refused=(code:string,detail:string)=>Object.assign(new Error(`${code}: ${detail}`),{code});
/** One CSV per trial and axis, `time_ns,command,encoder`: every bus cycle of the trial from the sample just before its first tick (time 0), timed as KMS01 times it (cycleClock:
 * the rows' own tMonoNs on a real bus, refused CYCLE_CLOCK_MISMATCH when they do not tick at cycleMs; cycle x cycleMs on the simulated bus; domain `wall`), command = the DriveCommandV1 target of the cycle's tick, encoder = the drive's 606Ch in rad/s. Splits alternate tune,
 * validation in the trial order of the policy (both axes of one trial share its split). Measured data carries the session's attestation, synthetic data a `generator`.
 * `backend` is what the part recorded of the worker that ran (describe.backend), passed on its own so a kit argument alone cannot make data measured; `configDigest`
 * must be that kit's digest. */
export function exportCalibration(part:{results:{caseId:string;trace:CaseTrace}[];session:BenchSessionV1;kit:BenchKitV1;policy:BenchPolicy;backend:'sim'|'soem'},
 o:{sourceKind:'measured'|'synthetic';configDigest:string}):{sidecar:CalibrationSidecar;files:{name:string;csv:string}[]}{
 const {kit,policy:p,session}=part;
 if(o.configDigest!==kit.digest)throw refused('CONFIG_DIGEST_MISMATCH',`${o.configDigest} is not the digest of ${kit.id}`);
 // the label follows the bus that ran, never the caller: the simulated slave is a protocol_double
 if(o.sourceKind==='measured'&&(kit.bus.backend==='sim'||part.backend==='sim'))throw refused('SYNTHETIC_CANNOT_BE_MEASURED',`${kit.id}: the part ran on the simulated bus`);
 if(part.backend!==kit.bus.backend)throw refused('BACKEND_MISMATCH',`the part ran on ${part.backend}, the kit says ${kit.bus.backend}`);
 const trace=part.results.find(r=>r.caseId==='KMS01')?.trace,trials=trace&&lagTrialsOf(trace,kit,p);
 if(!trace||!trials)throw refused('NO_CALIBRATION_TRIALS','the part has no KMS01 trace whose axes enabled');
 const cpt=20/kit.bus.cycleMs,files:{name:string;csv:string}[]=[],out:CalibrationSidecar['trials']=[];
 for(const x of trials)for(const [i,a] of kit.axes.entries()){
  const rows=trialRows(trace,kit,x),u=a.units,ns=cycleClock(rows,kit);
  if(x.from+x.ticks>trace.ticks.length||rows.length!==x.ticks*cpt+1)throw refused('TRIAL_SHORT',x.trialId);
  if(!ns)throw refused('CYCLE_CLOCK_MISMATCH',`${x.trialId}: the cycle rows' tMonoNs do not tick at ${kit.bus.cycleMs} ms`);
  const lines=rows.map((r,j)=>{
   const v=r.axes[i]!.velocityRaw,tick=trace.ticks[x.from+Math.floor((j-1)/cpt)]!;   // row 0 is the last cycle of the tick before the trial
   if(v===null)throw refused('VELOCITY_NOT_MAPPED',a.axisId);
   return `${ns[j]!-ns[0]!},${tick.driveCommands[i]!.target},${v/u.velocityRawPerRadS.value*u.polarity}`;
  });
  const file=`${x.trialId}-${a.axisId.replaceAll('/','-')}.csv`;
  files.push({name:file,csv:['time_ns,command,encoder',...lines].join('\n')+'\n'});
  out.push({trialId:`${x.trialId}:${a.axisId}`,split:x.split,condition:x.condition,file,axisId:a.axisId,signal:x.signal});
 }
 const resolution=1/Math.min(...kit.axes.map(a=>a.units.velocityRawPerRadS.value));   // one raw count of 60FFh / 606Ch
 const origin=o.sourceKind==='synthetic'?{generator:`packages/bench calibration-export of KMS01 on ${kit.bus.backend==='sim'?'the simulated slave (protocol_double), not measured':`the ${kit.bus.backend} bus, declared synthetic`}`}
  :{attestation:{operator:session.operator,instrument:[kit.id,...session.instruments.map(x=>x.id)].join('/'),recordedAt:session.startedAt}};
 return {files,sidecar:{sourceKind:o.sourceKind,...origin,deviceId:kit.id,configDigest:o.configDigest,clockDomain:'wall',clockOffsetNs:0,
  units:{command:'rad/s',encoder:'rad/s'},uncertainty:{command:resolution,encoder:resolution},
  policy:{channels:{encoder:{absoluteTolerance:p.trackingToleranceRadS.absolute,relativeTolerance:p.trackingToleranceRadS.relative}},minTrialsPerCondition:p.validationTrialsPerCondition,
   maxClockGapNs:20_000_000,capabilities:{encoder:'actuator'}},   // a prediction may be sampled once per tick
  trials:out}};
}
