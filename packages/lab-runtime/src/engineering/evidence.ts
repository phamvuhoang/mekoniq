import Ajv from 'ajv';
import schema from '../../../contracts/schemas/engineering-evidence.schema.json';
import type {EngineeringAssessment,EngineeringRunManifest} from '../../../contracts/generated/engineering';
import {hashJson} from '../v2/hash';
import {createPhysicsIngest,type PhysicsSample} from './physics-adapter';
export type {EngineeringAssessment,EngineeringRunManifest};

const ajv=new Ajv({allErrors:true,strict:true});
const validate=ajv.compile(schema);
const LEVELS=['unsupported','modeled','verified'] as const;
const CAPS=['geometry','rigidBody','actuator','sensor','grasp','process'] as const;
const unsupported=():EngineeringAssessment['capabilities']=>({geometry:'unsupported',rigidBody:'unsupported',actuator:'unsupported',sensor:'unsupported',grasp:'unsupported',process:'unsupported',calibration:'unsupported'});

/**
 * Judges recorded physics samples against the run manifest's pinned coverage and thresholds. Whether the run executed comes only from manifest.execution, never from files:
 * not_started is not_run; an executed run with missing, stale or foreign samples fails. Simulation evidence reaches `modeled`; `verified` needs a calibration reference for that capability.
 */
export function assessEngineeringEvidence(manifest:EngineeringRunManifest,samples:PhysicsSample[]):EngineeringAssessment {
  if (!validate(manifest)) throw new Error(`MANIFEST_INVALID: ${(validate.errors??[]).slice(0,3).map(e=>`${e.instancePath} ${e.message}`).join('; ')}`);
  const refs=(accepted:PhysicsSample[])=>({sampleCount:accepted.length,firstSimTimeNs:accepted[0]?.simTimeNs??null,lastSimTimeNs:accepted.at(-1)?.simTimeNs??null,samplesSha256:hashJson(accepted),artifacts:[...manifest.artifacts]});
  if (manifest.execution==='not_started') return {status:'not_run',reasons:['EXECUTION_NOT_STARTED'],capabilities:unsupported(),caseResults:[],artifactRefs:refs([])};
  if (manifest.execution==='aborted') return {status:'fail',reasons:['EXECUTION_ABORTED'],capabilities:unsupported(),caseResults:[],artifactRefs:refs([])};
  const reasons=new Set<string>(),accepted:PhysicsSample[]=[];
  // one ordered stream per run epoch: identity, duplicates, replays, gaps and clock regressions are all judged on the real sequence
  const ingest=createPhysicsIngest({runId:manifest.runId,bundleDigest:manifest.bundleDigest,epoch:manifest.expectedEpoch},{queueLimit:samples.length+1});
  for (const s of [...samples].sort((a,b)=>a.sequence-b.sequence)) {
    const result=ingest.ingest(s);
    if (result.accepted) accepted.push(s); else if (result.reason!=='STREAM_FAILED') reasons.add(result.reason!);
  }
  accepted.sort((a,b)=>(BigInt(a.simTimeNs)<BigInt(b.simTimeNs)?-1:BigInt(a.simTimeNs)>BigInt(b.simTimeNs)?1:a.sequence-b.sequence));
  const windowStart=accepted[0]?BigInt(accepted[0].simTimeNs):0n,windowEnd=accepted.length?BigInt(accepted.at(-1)!.simTimeNs):0n;
  const caseResults:EngineeringAssessment['caseResults']=[];
  for (const c of manifest.coverage) {
    const own=accepted.filter(s=>s.kind===c.kind&&s.entityId===c.entityId);
    let detail='';
    if (own.length<c.minSamples) detail=`${own.length} of ${c.minSamples} samples`;
    for (let i=1;!detail&&i<own.length;i++) if (BigInt(own[i]!.simTimeNs)-BigInt(own[i-1]!.simTimeNs)>BigInt(c.maxGapNs)) detail=`gap before sample ${own[i]!.sequence}`;
    // a stream that starts late or stops early relative to the run's own window is as incomplete as one with a hole
    if (!detail&&own.length&&(BigInt(own[0]!.simTimeNs)-windowStart>BigInt(c.maxGapNs)||windowEnd-BigInt(own.at(-1)!.simTimeNs)>BigInt(c.maxGapNs))) detail='does not span the run';
    if (detail) reasons.add('EVIDENCE_GAP');
    caseResults.push({id:c.id,status:detail?'fail':'pass',...detail?{detail}:{}});
  }
  for (const c of manifest.checks) {
    const values=accepted.filter(s=>s.kind===c.kind&&s.entityId===c.entityId&&c.value in s.values).map(s=>s.values[c.value]!);
    let status:'pass'|'fail'='pass',detail='';
    if (!values.length) {status='fail';detail='no samples carry this value';reasons.add(`UNAVAILABLE:${c.id}`);}
    else if (c.rule==='max'?Math.max(...values)>c.limit:Math.min(...values)<c.limit) {status='fail';detail=`${c.rule==='max'?Math.max(...values):Math.min(...values)} breaches ${c.limit}`;reasons.add(`CHECK_FAILED:${c.id}`);}
    caseResults.push({id:c.id,status,...detail?{detail}:{}});
  }
  if (!accepted.length) reasons.add('EVIDENCE_GAP');
  const capabilities=unsupported();
  if (!reasons.size) {
    for (const cap of CAPS) {
      const claimed=LEVELS.indexOf(manifest.claims[cap]);
      // simulation alone is `modeled`; `verified` only with a calibration reference for that capability
      const earned=claimed>=2&&manifest.calibrationRefs[cap]?2:Math.min(claimed,1);
      capabilities[cap]=LEVELS[earned]!;
    }
    capabilities.calibration=Object.keys(manifest.calibrationRefs).length?'verified':'unsupported';
  }
  return {status:reasons.size?'fail':'pass',reasons:[...reasons].sort(),capabilities,caseResults,artifactRefs:refs(accepted)};
}
