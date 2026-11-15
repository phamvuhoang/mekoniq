// Mandatory directory-level actual-artifact reader. Shared structural core remains unchanged for earlier releases.
import {readFileSync,lstatSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {checkR2bStructure,tableR2b} from './sim-extension-r2b.mjs';
import {checkQualification,GATES_R2A} from './sim-extension-qualification.mjs';
import {checkCaptureClock,assessCapture} from './browser-capture-clock.mjs';
import {tsImport} from 'tsx/esm/api';
const sha=b=>createHash('sha256').update(b).digest('hex');
export function boundedEvidenceRead(root,path){
 if(typeof path!=='string'||! /^[\w.-]+(?:\/[\w.-]+)*$/.test(path)||path.split('/').some(p=>p==='.'||p==='..'))throw Error('EVIDENCE_PATH');
 let current=root;if(lstatSync(current).isSymbolicLink())throw Error('EVIDENCE_SYMLINK');for(const part of path.split('/')){current=join(current,part);if(lstatSync(current).isSymbolicLink())throw Error('EVIDENCE_SYMLINK');}
 const s=lstatSync(current);if(!s.isFile()||s.size>256*1024*1024)throw Error('EVIDENCE_FILE_LIMIT');return readFileSync(current);
}
export function evidenceInventory(root,base='',budget={files:0,bytes:0}){
 const out=[];for(const name of readdirSync(join(root,base)).sort()){const file=base?base+'/'+name:name;if(!base&&file==='qualification.json')continue;const st=lstatSync(join(root,file));if(st.isSymbolicLink())throw Error('EVIDENCE_SYMLINK');if(st.isDirectory())out.push(...evidenceInventory(root,file,budget));else {const b=boundedEvidenceRead(root,file);budget.files++;budget.bytes+=b.length;if(budget.files>200000||budget.bytes>20*1024**3)throw Error('EVIDENCE_TOTAL_LIMIT');out.push({file,sha256:sha(b),bytes:b.length});}}return out;
}
export async function verifyR2bDirectory(root){let m;try{m=JSON.parse(boundedEvidenceRead(root,'qualification.json'));}catch(e){return ['R2B_RECORD_MISSING:'+e.message];}return assessR2bDirectory(root,m);}
// Recorder construction only. Public acceptance reads qualification.json itself through verifyR2bDirectory.
export async function assessR2bDirectory(root,m){
 const read=p=>{try{return boundedEvidenceRead(root,p);}catch{return null;}},r=checkR2bStructure(m,read);if(m.release!=='r2b')r.push('NOT_R2B');
 try{if(JSON.stringify(evidenceInventory(root))!==JSON.stringify(m.artifacts))r.push('ARTIFACT_INVENTORY_MISMATCH');}catch(e){r.push(e.message);}
 const derived=await collectR2bArtifactDispositions(root,m);r.push(...derived.issues);if(JSON.stringify(m.artifactDispositions)!==JSON.stringify(derived.artifactDispositions))r.push('ARTIFACT_DISPOSITION_MISMATCH');return [...new Set(r)];
}
export function artifactDispositionsFromGroups(scope,groups){
 const table=tableR2b(scope),out={};for(const id of Object.keys(table.cases)){
  if(id==='WEB06'){out[id]={status:'blocked_external',issues:['HTTPS_HOST_UNASSIGNED']};continue;}
  const group=id.startsWith('MJ')?'physics':id.startsWith('CELL')?'cell':id==='X01'?'semantic':id==='REG04'?'regression':id==='WEB05'?'container':'web',issues=groups[group]??['ARTIFACT_READBACK_PENDING'];
  // Missing inputs/cases are not execution failures. Corruption, identity changes and observed assertions remain failed.
  const absent=x=>/^(R2A_RECORD|PHYSICS_CAMPAIGN|CELL_CAMPAIGN|SEMANTIC_STUDY|WEB_CAPTURE|WEB05)_MISSING$/.test(x)||x==='ARTIFACT_READBACK_PENDING'||/ENOENT/.test(x)||/CAMPAIGN_INCOMPLETE$/.test(x);
  out[id]={status:issues.length?(issues.every(absent)?'not_run':'failed'):'tested',issues};
 }return out;
}
export async function collectR2bArtifactDispositions(root,m){
 const read=p=>{try{return boundedEvidenceRead(root,p);}catch{return null;}},r=[],source=m.identity?.before?.sourceCommit,lab=m.lab?.commit;
 const ref=(key,path,code)=>{const x=m[key],b=read(path);if(x?.file!==path||!b){r.push(code+'_MISSING');return null;}if(sha(b)!==x.sha256){r.push(code+'_CORRUPT');return null;}try{return JSON.parse(b);}catch{r.push(code+'_CORRUPT');return null;}};
 const groups={};let boundary=0;const collect=(name)=>{groups[name]=r.slice(boundary);boundary=r.length;};
 const old=ref('r2aRecord','inputs/r2a/qualification.json','R2A_RECORD');if(old){
  if(old.release!=='r2a'||old.accepted!==false||old.identity?.before?.sourceCommit!==source||old.lab?.commit!==lab||JSON.stringify(old.lab?.pin)!==JSON.stringify(m.lab?.pin))r.push('R2A_TUPLE_MISMATCH');
  r.push(...checkQualification(old,p=>read('inputs/r2a/'+p)).map(x=>'R2A:'+x));for(const g of Object.keys(GATES_R2A))if(old.gates?.[g]?.status!==(g==='G-CLOUD1'?'blocked_external':'tested'))r.push('R2A_GATE_NOT_TESTED:'+g);
 }
 collect('regression');
 const physics=ref('physicsCampaign','inputs/physics/campaign.json','PHYSICS_CAMPAIGN');if(physics){
  if(physics.sourceCommit!==source||physics.accepted!==false)r.push('PHYSICS_TUPLE_MISMATCH');
  try{const {verifyPayloadCampaign}=await tsImport('../packages/lab-runtime/src/v2/simulation3d/payload-campaign.ts',import.meta.url),v=await verifyPayloadCampaign(join(root,'inputs/physics'));if(v.completedCases!==v.expectedRuns||v.issues.length||v.missingArtifacts.length)r.push(...v.issues.map(x=>'PHYSICS:'+x),'PHYSICS_CAMPAIGN_INCOMPLETE');}catch(e){r.push('PHYSICS_READER:'+e.message);}
 }
 collect('physics');
 if(m.scope==='full'){
  const cell=ref('cellCampaign','inputs/cell/campaign.json','CELL_CAMPAIGN');if(cell){if(cell.sourceCommit!==source||cell.accepted!==false)r.push('CELL_TUPLE_MISMATCH');try{const {verifyCellCampaign}=await tsImport('../packages/lab-runtime/src/v2/simulation3d/cell-campaign.ts',import.meta.url),v=await verifyCellCampaign(join(root,'inputs/cell'));if(v.completedCases!==v.expectedRuns||v.issues.length||v.missingArtifacts.length)r.push(...v.issues.map(x=>'CELL:'+x),'CELL_CAMPAIGN_INCOMPLETE');}catch(e){r.push('CELL_READER:'+e.message);}}
  collect('cell');
  const study=ref('semanticStudy','inputs/semantic-study.json','SEMANTIC_STUDY');if(study)try{const {buildSemanticStudy}=await tsImport('../packages/lab-runtime/src/v2/simulation3d/semantic-study.ts',import.meta.url),v=buildSemanticStudy(study);if(v.status!=='complete'||v.accepted!==false)r.push('SEMANTIC_STUDY_INCOMPARABLE');for(const run of study.runs){const report=JSON.parse(run.report.content);if(report.manifest.sourceCommit!==source)r.push('SEMANTIC_SOURCE_MISMATCH');if(/unit|double|mock|synthetic|fake/i.test(String(report.navigation2d?.engine?.platform??'')+' '+String(report.navigation2d?.seed?.actorRng?.algorithm??'')+' '+report.manifest.backends.map(b=>b.model).join(' ')))r.push('SEMANTIC_SYNTHETIC_EXECUTION');}}catch(e){r.push('SEMANTIC_READER:'+e.message);}
  collect('semantic');
  const web=ref('webCapture','inputs/web/actual-cell-production.json','WEB_CAPTURE');if(web){
   if(web.version!==2||web.accepted!==false||web.sourceCommit!==source||web.runtimeArtifact!==m.lab?.pin?.artifactSha256||web.buildIdentity?.labHead!==lab||web.buildIdentity?.labStatus!=='')r.push('WEB_CAPTURE_TUPLE');
   r.push(...checkCaptureClock(web));const assessment=assessCapture(web);r.push(...assessment.issues);if(!assessment.meetsTargets)r.push('WEB_PERFORMANCE_TARGETS_NOT_MET');if(!web.sourceExecution?.startsWith('unchanged hash-verified exported runtime CLI'))r.push('WEB_EXPORTED_RUNTIME_REQUIRED');
   if(!Number.isFinite(web.capture?.elapsedMs)||!Number.isFinite(web.capture?.activeCellMs)||web.capture?.elapsedMs<180000||web.capture?.activeCellMs<180000||!web.capture?.renderEvents?.length||!web.workerRaw?.length||web.errors?.length)r.push('WEB_CAPTURE_INCOMPLETE');
   try{const dom=read('inputs/web/report-replay-fetched-cursor0-390-dom.json');if(!dom)r.push('WEB_390_DOM_MISSING');else{const d=JSON.parse(dom);if(d.topbarCount!==1||d.viewport?.width!==390||!d.runId||d.runtimeIdentity?.sourceCommit!==source||d.runtimeIdentity?.schemaHash!==m.lab?.pin?.schemaHash||d.flow!=='live-report-replay'||!read('inputs/web/report-replay-fetched-cursor0-390.png'))r.push('WEB_390_DOM_CORRELATION');}
   }catch{r.push('WEB_390_DOM_CORRUPT');}
   const browser=read('inputs/web/browser-result.json');try{const stats=JSON.parse(browser).stats;if(stats.expected<1||stats.unexpected!==0||stats.skipped!==0)r.push('WEB_BROWSER_NOT_TESTED');}catch{r.push('WEB_BROWSER_MISSING');}
  }
  collect('web');
  // Container lifecycle proof is independent of a Linux-native campaign. The raw persisted reports/replay accompany its suite receipt.
  const container=ref('containerRecord','inputs/container/web05.json','WEB05');if(container){if(container.accepted!==false||container.execution!=='actual_container'||container.sourceCommit!==source||container.schemaHash!==m.lab?.pin?.schemaHash||container.image?.sourceCommit!==source||!/^sha256:[a-f0-9]{64}$/.test(container.image?.id??''))r.push('WEB05_IDENTITY');for(const p of ['health.json','before-crash-report.json','after-crash-report.json','finished-report.json','committed-before.json','committed-after.json','replay-manifest.json','image-inspect.json'])if(!read('inputs/container/'+p))r.push('WEB05_ARTIFACT_MISSING:'+p);
   try{const j=p=>JSON.parse(read('inputs/container/'+p)),before=j('before-crash-report.json'),after=j('after-crash-report.json'),finished=j('finished-report.json'),replay=j('replay-manifest.json');if(before.outcome.tick!==100||after.outcome.tick!==100||finished.outcome.status!=='completed'||finished.outcome.served!=='2'||JSON.stringify(j('committed-before.json'))!==JSON.stringify(j('committed-after.json'))||replay.runId!==finished.manifest.runId||finished.manifest.sourceCommit!==source||replay.horizon?.tick!==finished.outcome.tick)r.push('WEB05_LIFECYCLE');const {openReplayPackage}=await tsImport('../packages/lab-runtime/src/v2/replay/reader.ts',import.meta.url);const replayReader=await openReplayPackage(read('inputs/container/replay/manifest.json'),async function*(asset){const b=read('inputs/container/replay/'+asset.path);if(!b)throw Error('WEB05_REPLAY_ASSET_MISSING');yield b;});replayReader.close();}catch{r.push('WEB05_RAW_INVALID');}}
  collect('container');
 }
 return {issues:[...new Set(r)],artifactDispositions:artifactDispositionsFromGroups(m.scope,groups)};
}
