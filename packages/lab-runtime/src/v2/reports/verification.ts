import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {open,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import verificationSchema from '../../../../contracts/schemas/lab-run-verification.schema.json';
import armSchema from '../../../../contracts/schemas/lab-arm-collision-evidence.schema.json';
import transferSchema from '../../../../contracts/schemas/lab-transfer-evidence.schema.json';
import type {RunVerification} from '../../../../contracts/generated/lab-v2';
export type {RunVerification};
export const MAX_BUNDLE_BYTES=64*1024*1024;
const ajv=new Ajv({strict:true,allErrors:true});addFormats(ajv);
ajv.addSchema(armSchema,'lab-arm-collision-evidence.schema.json');ajv.addSchema(transferSchema,'lab-transfer-evidence.schema.json');
const check=ajv.compile<RunVerification>(verificationSchema);
export function safeArtifactPath(path:string):boolean{return /^[A-Za-z0-9_-][A-Za-z0-9_./-]*$/.test(path)&&path.split('/').every(p=>p!==''&&p!=='.'&&p!=='..');}
export function validateVerification(value:unknown):{ok:true;value:RunVerification}|{ok:false;reasonCodes:string[]}{
 if(!check(value))return {ok:false,reasonCodes:['VERIFICATION_SCHEMA_INVALID']};
 const reasons:string[]=[],v=value,paths=new Set<string>();let total=0;
 for(const a of v.artifacts){if(!safeArtifactPath(a.path))reasons.push('ARTIFACT_PATH_INVALID');if(paths.has(a.path))reasons.push('ARTIFACT_PATH_DUPLICATE');paths.add(a.path);total+=a.bytes;}
 if(total>MAX_BUNDLE_BYTES)reasons.push('ARTIFACT_BYTES_LIMIT');
 if(v.execution==='not_run'&&(v.result!=='not_run'||!!v.arm&&v.arm.result!=='not_run'))reasons.push('VERIFICATION_NOT_EXECUTED');
 if(v.result==='pass'&&(v.execution!=='ran'||v.blockers.length||!v.aspects.length))reasons.push('VERIFICATION_COVERAGE_MISSING');
 for(const aspect of v.aspects)if(!v.artifacts.some(a=>a.sha256===aspect.artifactSha256))reasons.push('ASPECT_ARTIFACT_MISSING');
 const arm=v.arm;
 if(arm){
  if(arm.trace&&(arm.trace.toTick<arm.trace.fromTick||arm.trace.samples<1))reasons.push('ARM_TRACE_INVALID');
  if(arm.result==='pass'&&(!arm.trace||!arm.engine||!arm.geometryRevision||!arm.method||!arm.coverage||arm.coverage.intervals<1||arm.coverage.evaluations<1||arm.coverage.uncertain>0||arm.colliding.length||arm.reasonCodes.length))reasons.push('ARM_COVERAGE_MISSING');
  if(v.result==='pass'&&arm.result!=='pass')reasons.push('ARM_VERDICT_MISMATCH');
  if(arm.trace){
   const map=v.armTickMap;
   if(!map||map.length!==arm.trace.samples||map[0]?.sampleTick!==arm.trace.fromTick||map.at(-1)?.sampleTick!==arm.trace.toTick||map.some((m,i)=>i>0&&(m.sampleTick<=map[i-1]!.sampleTick||m.runTick<map[i-1]!.runTick)))reasons.push('ARM_TICK_MAPPING_INVALID');
   for(const c of arm.colliding)if(c.interval.toTick<c.interval.fromTick||!map?.some(m=>m.sampleTick===c.interval.fromTick)||!map.some(m=>m.sampleTick===c.interval.toTick))reasons.push('ARM_COLLISION_INTERVAL_INVALID');
  }
 }
 return reasons.length?{ok:false,reasonCodes:[...new Set(reasons)]}:{ok:true,value:v};
}
/** Verify local bundle contents before import. No URL fetches, archive extraction, or authority changes. */
export async function verifyBundleArtifacts(directory:string,value:unknown):Promise<void>{
 const validated=validateVerification(value);if(!validated.ok)throw new Error(validated.reasonCodes.join(','));
 const root=await realpath(directory);let total=0;
 for(const artifact of validated.value.artifacts){
  const path=join(root,artifact.path),actual=await realpath(path);
  if(actual!==resolve(path)||!actual.startsWith(root+'/'))throw new Error('ARTIFACT_PATH_ESCAPE');
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const stat=await file.stat();if(!stat.isFile()||stat.size!==artifact.bytes||(total+=stat.size)>MAX_BUNDLE_BYTES)throw new Error('ARTIFACT_SIZE_MISMATCH');
   const bytes=await file.readFile();if(bytes.length!==artifact.bytes||createHash('sha256').update(bytes).digest('hex')!==artifact.sha256)throw new Error('ARTIFACT_HASH_MISMATCH');
  }finally{await file.close();}
 }
}
/** Bind checker evidence to this report's run/world before publishing it through the existing authenticated report route. */
export function withVerification(report:import('../report').RunReport,verification:RunVerification):import('../report').RunReport{
 const checked=validateVerification(verification);if(!checked.ok)throw new Error(checked.reasonCodes.join(','));
 if(verification.transfers.some(t=>t.runId!==report.manifest.runId))throw new Error('VERIFICATION_RUN_MISMATCH');
 if(verification.arm&&JSON.stringify(verification.arm.worldRevision)!==JSON.stringify(report.manifest.world)){
  const a=verification.arm.worldRevision,w=report.manifest.world;if(a.id!==w.id||a.revision!==w.revision||a.hash!==w.hash)throw new Error('VERIFICATION_WORLD_MISMATCH');
 }
 return {...structuredClone(report),verification:structuredClone(verification)};
}
export function armVerificationEvidence(report:import('../report').RunReport,schemaHash:string):import('../contracts').LabEvidenceV2{
 const v=report.verification,valid=validateVerification(v),a=valid.ok&&valid.value.execution==='ran'?valid.value.arm:null;
 return {schemaVersion:2,id:`ARM03:${report.manifest.runId}:controller`,requirementIds:['ARM-04','SIM-05','UX-19'],scenarioId:report.manifest.scenario.id,runId:report.manifest.runId,
  inputsManifest:{projectHash:report.manifest.project.hash,sourceCommit:report.manifest.sourceCommit,schemaHash,seed:report.manifest.seed,mode:report.manifest.mode,access:report.manifest.access,backends:report.manifest.backends.map(b=>b.id)},
  result:a?.result??'not_run',assertions:[{id:'ARM03',passed:a?.result==='pass',detail:a?`${a.engine??'none'}; intervals=${a.coverage?.intervals??0}; ${a.reasonCodes.join(',')}`:'CONTROLLER_EVIDENCE_MISSING'}],artifacts:valid.ok?valid.value.artifacts.map(x=>({name:x.path,sha256:x.sha256})):[],actualFidelity:'modeled',signer:{id:'lab-runtime',trust:'local_unsigned'}};
}
