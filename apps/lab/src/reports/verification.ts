import Ajv from 'ajv';
import {validReportShape} from './report-shape';
import addFormats from 'ajv-formats';
import schema from './contracts/lab-run-verification.schema.json' with {type:'json'};
import armSchema from './contracts/lab-arm-collision-evidence.schema.json' with {type:'json'};
import transferSchema from './contracts/lab-transfer-evidence.schema.json' with {type:'json'};
import type {RunVerification} from './contracts/verification-types';
import {validateProjectV2} from '../project/schema';
import type {LabProjectV2} from '../shared/types';
import {hashJson} from '../twin/hash';
import type {RunReport} from '../scenarios/controls';
const ajv=new Ajv({strict:true,allErrors:true});addFormats(ajv);ajv.addSchema(armSchema,'lab-arm-collision-evidence.schema.json');ajv.addSchema(transferSchema,'lab-transfer-evidence.schema.json');
const shape=ajv.compile<RunVerification>(schema);
export const MAX_EVIDENCE_BYTES=64*1024*1024;
export const safeArtifactPath=(p:string)=>/^[A-Za-z0-9_-][A-Za-z0-9_./-]*$/.test(p)&&p.split('/').every(s=>s!==''&&s!=='.'&&s!=='..');
export function validVerification(value:unknown):value is RunVerification{
 if(!shape(value))return false;
 const v=value,paths=v.artifacts.map(a=>a.path),a=v.arm;
 if(paths.some(p=>!safeArtifactPath(p))||new Set(paths).size!==paths.length||v.artifacts.reduce((n,a)=>n+a.bytes,0)>MAX_EVIDENCE_BYTES)return false;
 if(v.execution==='not_run'&&(v.result!=='not_run'||!!v.arm&&v.arm.result!=='not_run')||v.result==='pass'&&(v.blockers.length||!v.aspects.length))return false;
 if(v.aspects.some(s=>!v.artifacts.some(a=>a.sha256===s.artifactSha256)))return false;
 if(a){
  if(a.trace&&(a.trace.samples<1||a.trace.toTick<a.trace.fromTick))return false;
  if(a.result==='pass'&&(!a.trace||!a.engine||!a.geometryRevision||!a.method||!a.coverage||a.coverage.intervals<1||a.coverage.evaluations<1||a.coverage.uncertain>0||a.colliding.length||a.reasonCodes.length))return false;
  if(v.result==='pass'&&a.result!=='pass')return false;
  if(a.trace){const map=v.armTickMap;if(!map||map.length!==a.trace.samples||map[0]?.sampleTick!==a.trace.fromTick||map.at(-1)?.sampleTick!==a.trace.toTick||map.some((m,i)=>i>0&&(m.sampleTick<=map[i-1]!.sampleTick||m.runTick<map[i-1]!.runTick)))return false;
   if(a.colliding.some(c=>c.interval.toTick<c.interval.fromTick||!map.some(m=>m.sampleTick===c.interval.fromTick)||!map.some(m=>m.sampleTick===c.interval.toTick)))return false;
  }
 }
 return true;
}
/** Imported files stay read-only. Hashes establish bundle integrity, never runtime readiness or release acceptance. */
export async function importControllerBundle(files:readonly File[]):Promise<{origin:'imported';report:RunReport;project:LabProjectV2}>{
 if(!files.length||files.length>10000||files.reduce((n,f)=>n+f.size,0)>MAX_EVIDENCE_BYTES)throw new Error('EVIDENCE_SIZE_LIMIT');
 const entries=new Map<string,File>();for(const f of files){const path=f.webkitRelativePath?f.webkitRelativePath.split('/').slice(1).join('/'):f.name;if(!safeArtifactPath(path)||entries.has(path))throw new Error('ARTIFACT_PATH_INVALID');entries.set(path,f);}
 const reportFile=entries.get('report.json');if(!reportFile)throw new Error('REPORT_MISSING');
 const value:unknown=JSON.parse(await reportFile.text());if(!value||typeof value!=='object')throw new Error('REPORT_INVALID');
 const r=value;
 if(!validReportShape(r)||!validVerification(r.verification))throw new Error('REPORT_INVALID');
 for(const a of r.verification.artifacts){const file=entries.get(a.path);if(!file||file.size!==a.bytes)throw new Error('ARTIFACT_SIZE_MISMATCH');const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());const hex=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');if(hex!==a.sha256)throw new Error('ARTIFACT_HASH_MISMATCH');}
 const projectFile=entries.get('project.json');if(!projectFile)throw new Error('PROJECT_MISSING');const project=validateProjectV2(JSON.parse(await projectFile.text()));if(hashJson(project)!==r.manifest.project?.hash)throw new Error('PROJECT_HASH_MISMATCH');if(hashJson(project.world)!==r.manifest.world.hash||project.world.id!==r.manifest.world.id||project.world.revision!==r.manifest.world.revision)throw new Error('WORLD_HASH_MISMATCH');const arm=r.verification.arm;if(arm&&(arm.worldRevision.id!==r.manifest.world.id||arm.worldRevision.revision!==r.manifest.world.revision||arm.worldRevision.hash!==r.manifest.world.hash))throw new Error('VERIFICATION_WORLD_MISMATCH');if(r.verification.transfers.some(t=>t.runId!==r.manifest!.runId))throw new Error('VERIFICATION_RUN_MISMATCH');
 return {origin:'imported',report:structuredClone(r as RunReport),project};
}
