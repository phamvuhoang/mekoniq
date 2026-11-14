// Navigation evidence (navigation-run-evidence-v1) for the providers this Lab renders. The document is validated against the synced source
// schema; anything unknown is unsupported, and "complete" needs every signal to agree (server completeness, end record, gaps, listing, sensor publications).
// Imported folders are a trust boundary: every listed chunk that is present must match its size and SHA-256 (else refused); one that is absent makes the
// imported copy incomplete. The Lab never reads chunk contents to upgrade a verdict.
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import componentSchema from '../shared/engineering-schemas/engineering-component.schema.json' with {type:'json'};
import physicalSchema from '../shared/engineering-schemas/robot-physical-model-v1.schema.json' with {type:'json'};
import evidenceSchema from '../shared/engineering-schemas/navigation-run-evidence-v1.schema.json' with {type:'json'};
import type {NavigationRunEvidenceV1,NavigationSceneV1} from '../shared/navigation2d';
import type {RunReport} from '../scenarios/controls';
import type {LabProjectV2} from '../shared/types';
import {validReportShape} from './report-shape';
import {MAX_EVIDENCE_BYTES,safeArtifactPath} from './verification';
import {validateProjectV2} from '../project/schema';
import {hashJson} from '../twin/hash';
import {worldHash} from '../twin/model';
const ajv=new Ajv({strict:false,allErrors:true});addFormats(ajv);
ajv.addSchema(componentSchema,'engineering-component.schema.json');ajv.addSchema(physicalSchema,'robot-physical-model-v1.schema.json');
const validEvidence=ajv.compile<NavigationRunEvidenceV1>(evidenceSchema);
export interface NavigationEvidenceView {supported:boolean;provider:string|null;complete:boolean;reasons:string[]}
const STREAMS=['trajectory','sensors','control','collisions'] as const;
/** The evidence document, or null when absent or not a navigation-run-evidence-v1 the Lab knows (closed schema, a provider this Lab knows, safe chunk names). */
/** The engines whose evidence the Lab renders; an unknown id is unsupported, never shown under another name. */
export const NAVIGATION_PROVIDERS=['irsim_2d','webots_3d'] as const;
/** Version field for each synced source engine branch; knowing its version does not admit a provider for rendering. */
export const engineVersionOf=(e:NavigationRunEvidenceV1['engine'])=>{
 switch(e.id){case 'irsim_2d':return e.version;case 'webots_3d':case 'mujoco_3d':return e.engineVersion;}
};
export function navigationEvidence(report:RunReport):NavigationRunEvidenceV1|null{
 const n=report.navigation2d;
 return validEvidence(n)&&(NAVIGATION_PROVIDERS as readonly string[]).includes(n.engine.id)&&STREAMS.every(s=>n.artifacts[s].every(a=>safeArtifactPath(a.path)&&!a.path.includes('/')))?n:null;
}
/** The compiled scene a report may draw: only the one its own evidence names (sceneDigest). A live run whose report carries no evidence yet keeps the scene of the bundle
 * it was created from; anything else is unavailable with the reason — never another run's geometry. */
export function boundNavigationScene(report:RunReport|null,scene:NavigationSceneV1|null,live:boolean):{scene:NavigationSceneV1|null;reason:string|null}{
 const pending=live&&report?.navigation2d===undefined,want=report&&!pending?navigationEvidence(report)?.sceneDigest??null:null;
 if(!pending&&!want)return {scene:null,reason:'NAVIGATION_SCENE_UNBOUND'};
 if(!scene)return {scene:null,reason:'NAVIGATION_SCENE_UNAVAILABLE'};
 return pending||scene.sceneDigest===want?{scene,reason:null}:{scene:null,reason:'NAVIGATION_SCENE_MISMATCH'};
}
const contiguous=(chunks:{firstTick:number;lastTick:number}[],from:number,to:number)=>{let next=from;for(const c of [...chunks].sort((a,b)=>a.firstTick-b.firstTick)){if(c.firstTick!==next||c.lastTick<c.firstTick)return false;next=c.lastTick+1;}return next===to+1;};
const sorted=(xs:readonly string[])=>JSON.stringify([...xs].sort());
/** Every field the report envelope and its evidence both state (as the source runner writes them) must agree: else the evidence is not this run's. */
function identityMismatches(r:RunReport,n:NavigationRunEvidenceV1):string[]{
 const m=r.manifest,models=m.models??[],plant=models.filter(x=>x.id===n.engine.id&&x.provenance==='simulated_plant'),robots=models.filter(x=>x.id.startsWith('navigation-model:'));
 const policy=(m.profiles??[]).filter(p=>p.id===n.policyRef.id),epoch=(m.clock as {businessEpochMs?:unknown}).businessEpochMs;
 const tick=r.outcome.tick,ns=(()=>{try{return BigInt(r.outcome.simTimeNs);}catch{return null;}})();
 const sensorRobots=new Set(n.seed.sensorSeeds.map(s=>`navigation-model:${s.robotId}`));
 return Object.entries({
  runId:m.runId!==n.runId,
  provider:!m.backends.some(b=>b.id===n.engine.id&&b.version===engineVersionOf(n.engine)),
  seed:m.seed!==n.seed.runSeed,
  tickMs:m.clock.tickMs!==n.clock.tickMs,
  sourceCommit:n.identity?.sourceCommit!==undefined&&n.identity.sourceCommit!==m.sourceCommit,
  businessEpochMs:epoch!==undefined&&epoch!==n.clock.businessEpochMs,
  sceneDigest:plant.length!==1||plant[0]!.hash!==n.sceneDigest,
  modelDigests:sorted(robots.map(x=>x.hash))!==sorted(n.modelDigests)||[...sensorRobots].some(id=>!robots.some(x=>x.id===id)),
  policy:policy.length!==1||policy[0]!.hash!==n.policyRef.hash||policy[0]!.revision!==n.policyRef.revision,
  // the run's outcome is the moment the evidence describes: its tick is the recording's horizon (a run tick off the last durable tick is EVIDENCE_PENDING/AHEAD)
  outcomeTick:tick!==n.clock.tickHorizon,
  simTimeNs:ns===null||ns!==BigInt(tick)*BigInt(n.clock.tickMs)*1_000_000n,
 }).filter(([,bad])=>bad).map(([f])=>f);
}
export function navigationEvidenceView(report:RunReport):NavigationEvidenceView{
 if(report.navigation2d===undefined)return {supported:false,provider:null,complete:false,reasons:['NAVIGATION_EVIDENCE_ABSENT']};
 const n=navigationEvidence(report);
 if(!n)return {supported:false,provider:null,complete:false,reasons:['NAVIGATION_EVIDENCE_SCHEMA_UNKNOWN']};
 const reasons:string[]=identityMismatches(report,n).map(f=>`IDENTITY_MISMATCH:${f}`),h=n.clock.tickHorizon;
 if(!n.completeness)reasons.push('COMPLETENESS_UNKNOWN');
 else if(n.completeness.status!=='complete')reasons.push(...n.completeness.reasons.length?n.completeness.reasons:['EVIDENCE_INCOMPLETE']);
 else if(n.completeness.reasons.length)reasons.push('COMPLETENESS_CONTRADICTORY',...n.completeness.reasons);
 // the recorder's end record, as source evidence.ts reads it: an early terminal, a last durable tick off the horizon, and a run tick the chunks have not reached (or passed)
 const end=n.recording;
 if(!end)reasons.push('EVIDENCE_END_UNKNOWN');
 else{
  if(end.terminal!==null)reasons.push(`EVIDENCE_TERMINAL:${end.terminal}`);
  if(end.lastTick!==h)reasons.push('EVIDENCE_END_MISMATCH');
  const run=end.runTick??null,last=end.lastTick??-1;
  if(run!==null&&run>last)reasons.push('EVIDENCE_PENDING');
  if(run!==null&&last>run)reasons.push(`EVIDENCE_AHEAD_OF_CHECKPOINT:${run+1}-${last}`);
 }
 for(const g of [...n.recordingGaps,...n.recording?.gaps??[]])reasons.push(`RECORDING_GAP:${g.reason}`);
 if(!contiguous(n.artifacts.trajectory,0,h))reasons.push('TRAJECTORY_LISTING_GAP');
 if(h>0&&!contiguous(n.artifacts.control,0,h-1))reasons.push('CONTROL_LISTING_GAP');
 const pubs=report.metrics.navigation?.sensorPublications;
 if(!pubs)reasons.push('SENSOR_PUBLICATIONS_UNKNOWN');else if(!pubs.complete||pubs.recorded!==pubs.expected)reasons.push('SENSOR_PUBLICATIONS_INCOMPLETE');
 else if(pubs.expected>0&&!n.artifacts.sensors.length)reasons.push('SENSOR_LISTING_EMPTY');
 return {supported:true,provider:n.engine.id,complete:reasons.length===0,reasons:[...new Set(reasons)]};
}
/** Expected/actual per assertion as the evidence states it; an unknown document has none (never a pass). While the evidence view is not complete a 'pass' rests on
 * a recording that is not established, so it reads 'unverified' with the view's reasons; any other result (fail, inconclusive, not_run) is kept as stated. */
export function navigationRows(report:RunReport):{id:string;result:string;detail:string;reasons:string[]}[]{
 const n=navigationEvidence(report);if(!n)return [];
 const v=navigationEvidenceView(report);
 return n.assertions.map(a=>a.result==='pass'&&!v.complete?{id:a.id,result:'unverified',detail:a.detail,reasons:v.reasons}:{id:a.id,result:a.result,detail:a.detail,reasons:[]});
}
const hex=async(f:File)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await f.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');
/** Read-only import of an IR-SIM evidence folder: report.json, project.json and the chunk files its navigation2d listing names (flat, by name). */
export async function importNavigationEvidence(files:readonly File[]):Promise<{origin:'imported';report:RunReport;project:LabProjectV2}>{
 if(!files.length||files.length>10000||files.reduce((n,f)=>n+f.size,0)>MAX_EVIDENCE_BYTES)throw new Error('EVIDENCE_SIZE_LIMIT');
 const entries=new Map<string,File>();
 for(const f of files){const path=f.webkitRelativePath?f.webkitRelativePath.split('/').slice(1).join('/'):f.name;if(!safeArtifactPath(path)||entries.has(path))throw new Error('ARTIFACT_PATH_INVALID');entries.set(path,f);}
 const reportFile=entries.get('report.json');if(!reportFile)throw new Error('REPORT_MISSING');
 const value:unknown=JSON.parse(await reportFile.text());
 if(!validReportShape(value))throw new Error('REPORT_INVALID');
 const report=structuredClone(value as RunReport),n=navigationEvidence(report);
 if(!n)throw new Error('NAVIGATION_EVIDENCE_SCHEMA_UNKNOWN');
 const missing:string[]=[];
 for(const s of STREAMS)for(const a of n.artifacts[s]){
  const file=entries.get(a.path)??entries.get(`evidence/${a.path}`);
  if(!file){missing.push(a.path);continue;}
  if(file.size!==a.bytes||await hex(file)!==a.sha256)throw new Error('ARTIFACT_HASH_MISMATCH');
 }
 const projectFile=entries.get('project.json');if(!projectFile)throw new Error('PROJECT_MISSING');
 const project=validateProjectV2(JSON.parse(await projectFile.text()));
 if(hashJson(project)!==report.manifest.project.hash)throw new Error('PROJECT_HASH_MISMATCH');
 // source (navigation2d runner) writes worldHash: the world without its revision counter, so the revision is compared on its own
 const w=report.manifest.world;
 if(worldHash(project.world)!==w.hash||project.world.id!==w.id||project.world.revision!==w.revision)throw new Error('WORLD_HASH_MISMATCH');
 // a downgrade only: chunks this folder does not carry make the imported copy incomplete, with the names
 if(missing.length)n.completeness={status:'incomplete',reasons:[...n.completeness?.reasons??[],...missing.map(p=>`EVIDENCE_CHUNK_MISSING:${p}`)].slice(0,50)};
 return {origin:'imported',report,project};
}
