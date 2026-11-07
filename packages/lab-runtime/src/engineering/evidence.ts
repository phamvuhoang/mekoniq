import Ajv from 'ajv';
import schema from '../../../contracts/schemas/engineering-evidence.schema.json';
import type {CalibrationResult,EngineeringAssessment,EngineeringRunManifest} from '../../../contracts/generated/engineering';
import {hashJson} from '../v2/hash';
import {createPhysicsIngest,type PhysicsSample} from './physics-adapter';
export type {EngineeringAssessment,EngineeringRunManifest};
/** A calibration outcome the run may cite. `digest` must be the hash of exactly this (configDigest, result) pair; it is never taken on trust. */
export interface CalibrationEvidence {configDigest:string;result:CalibrationResult;digest:string}
export const calibrationDigest=(configDigest:string,result:CalibrationResult):string=>hashJson({configDigest,result});

const ajv=new Ajv({allErrors:true,strict:true});
const validate=ajv.compile(schema);
const LEVELS=['unsupported','modeled','verified'] as const;
const CAPS=['geometry','rigidBody','actuator','sensor','grasp','process'] as const;
const unsupported=():EngineeringAssessment['capabilities']=>({geometry:'unsupported',rigidBody:'unsupported',actuator:'unsupported',sensor:'unsupported',grasp:'unsupported',process:'unsupported',calibration:'unsupported'});

/**
 * Judges recorded physics samples against the run manifest's pinned coverage and thresholds. Whether the run executed comes only from manifest.execution, never from files:
 * not_started is not_run; an executed run with missing, stale or foreign samples fails. Simulation evidence reaches `modeled`; `verified` needs a calibration reference for that capability.
 */
export function assessEngineeringEvidence(manifest:EngineeringRunManifest,samples:PhysicsSample[],calibrations:readonly CalibrationEvidence[]=[]):EngineeringAssessment {
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
  // the run's extent is what the manifest locked before the run, never what happened to arrive: a missing tail must show up as a failure
  const windowStart=BigInt(manifest.window.startSimTimeNs),windowEnd=BigInt(manifest.window.endSimTimeNs);
  if ((accepted.at(-1)?.sequence??-1)!==manifest.lastSequence) reasons.add('EVIDENCE_TRUNCATED');
  const caseResults:EngineeringAssessment['caseResults']=[];
  // everything the run produced, by value name, from every entity: independent of which thresholds the manifest happens to check
  // range and count per value name, in one pass: the domain check needs the extremes, never a copy of every sample
  const observed=new Map<string,{min:number;max:number;n:number}>();
  for (const s of accepted) for (const [name,value] of Object.entries(s.values)) {
    const o=observed.get(name);
    if (o) {if (value<o.min) o.min=value;if (value>o.max) o.max=value;o.n+=1;} else observed.set(name,{min:value,max:value,n:1});
  }
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
  // verified needs a real record: it hashes to the cited digest, passed, belongs to this exact configuration, is not invalidated, covers the capability and the observed range
  const verifiedBy=(cap:typeof CAPS[number])=>{
    const ref=manifest.calibrationRefs[cap],r=ref?calibrations.find(c=>c.digest===ref):undefined;
    if (!r||calibrationDigest(r.configDigest,r.result)!==ref||r.configDigest!==manifest.configDigest) return false;
    const {result}=r;
    if (result.status!=='pass'||result.invalidatedBy!==null||!result.calibratedCapabilities.includes(cap)) return false;
    const domain=Object.entries(result.domain);
    // a calibration with no stated range, or a channel the run never produced, proves nothing about this run
    return domain.length>0&&domain.every(([channel,range])=>{const seen=observed.get(channel);return !!seen&&seen.n>0&&seen.min>=range.min&&seen.max<=range.max;});
  };
  if (!reasons.size) {
    for (const cap of CAPS) {
      const claimed=LEVELS.indexOf(manifest.claims[cap]);
      // simulation alone is `modeled`; `verified` only with a calibration reference for that capability
      const earned=claimed>=2&&verifiedBy(cap)?2:Math.min(claimed,1);
      capabilities[cap]=LEVELS[earned]!;
    }
    capabilities.calibration=CAPS.some(c=>capabilities[c]==='verified')?'verified':'unsupported';
  }
  return {status:reasons.size?'fail':'pass',reasons:[...reasons].sort(),capabilities,caseResults,artifactRefs:refs(accepted)};
}
