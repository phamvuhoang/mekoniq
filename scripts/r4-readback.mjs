// R4 directory-level artifact reader (plan V16). Nothing is taken from a status in qualification.json: every input is copied beside it, hashed, and re-verified by the verifier that wrote it (campaign verifiers) or by
// its own readback (R2b record, container record, web record). A missing input makes the cases that name it `not_run`; corruption, another tuple or `accepted:true` makes them `failed`.
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {checkR4Structure,tableR4,CASES_R4} from './sim-extension-r4.mjs';
import {boundedEvidenceRead,evidenceInventory,verifyR2bDirectory} from './r2b-readback.mjs';
import {tsImport} from 'tsx/esm/api';
const sha=b=>createHash('sha256').update(b).digest('hex');
const ENGINE='../packages/lab-runtime/src/v2/';
/** campaign inputs: manifest key -> copy dir, verifier module + export, the code that names it */
export const CAMPAIGNS={
 cilCampaign:{dir:'inputs/cil',code:'CIL_CAMPAIGN',module:'control/cil-campaign.ts',fn:'verifyCilCampaign',ids:['cil-v1','cil-v2']},
 benchCampaign:{dir:'inputs/bench',code:'BENCH_CAMPAIGN',module:'control/bench-campaign.ts',fn:'verifyBenchCampaign',ids:['bench-v1','bench-v2']},
 faultCampaign:{dir:'inputs/fault',code:'FAULT_CAMPAIGN',module:'control/fault-campaign.ts',fn:'verifyFaultCampaign',ids:['fault-v1']},
 trayCampaign:{dir:'inputs/tray',code:'TRAY_CAMPAIGN',module:'simulation3d/tray-campaign.ts',fn:'verifyTrayCampaign',ids:['tray-v1']},
 perceptionStudy:{dir:'inputs/study',code:'PERCEPTION_STUDY',module:'perception/perception-study.ts',fn:'verifyPerceptionStudy',ids:['perception-gap-v1']}
};
const absent=x=>/^[A-Z0-9_]+_MISSING(:|$)/.test(x)||x==='ARTIFACT_READBACK_PENDING'||x==='CALIBRATION_SELFTEST_MISSING'||/_INCOMPLETE$/.test(x);
export async function verifyOneCampaign(root,m,key,spec,source){
 const r=[],x=m.inputs?.[key],path=spec.dir+'/campaign.json';let b=null;try{b=boundedEvidenceRead(root,path);}catch{/* reported below */}
 if(!x||x.file!==path||!b){r.push(spec.code+'_MISSING');return r;}
 if(sha(b)!==x.sha256){r.push(spec.code+'_CORRUPT');return r;}
 let doc;try{doc=JSON.parse(b);}catch{r.push(spec.code+'_CORRUPT');return r;}
 if(doc.accepted!==false)r.push(spec.code+'_ACCEPTED');
 if(!spec.ids.includes(doc.campaign?.id))r.push(spec.code+'_ID_MISMATCH');
 if(doc.sourceCommit!==source)r.push(spec.code+'_TUPLE_MISMATCH');
 try{const mod=await tsImport(ENGINE+spec.module,import.meta.url),v=await mod[spec.fn](join(root,spec.dir)),done=v.completedCases??v.completedRuns;
  if(done!==v.expectedRuns||!v.expectedRuns||v.issues.length||v.missingArtifacts.length)r.push(...v.issues.map(i=>spec.code+':'+i),spec.code+'_INCOMPLETE');
 }catch(e){r.push(spec.code+'_READER:'+e.message);}
 return r;
}
/** a vitest result file of a recorded run: every test passed, none skipped */
function vitestGreen(bytes,minTests=1){try{const j=JSON.parse(bytes);return j.numFailedTests===0&&(j.numPendingTests+(j.numTodoTests??0))===0&&j.numPassedTests>=minTests&&j.success===true;}catch{return false;}}
export async function verifyContainerRecord(root,m,source){
 const x=m.inputs?.containerRecord,path='inputs/container/container.json';let b=null;try{b=boundedEvidenceRead(root,path);}catch{/* below */}
 if(!x||x.file!==path||!b)return {cld01:['CONTAINER_RECORD_MISSING'],cld02:['CONTAINER_RECORD_MISSING']};
 if(sha(b)!==x.sha256)return {cld01:['CONTAINER_RECORD_CORRUPT'],cld02:['CONTAINER_RECORD_CORRUPT']};
 let d;try{d=JSON.parse(b);}catch{return {cld01:['CONTAINER_RECORD_CORRUPT'],cld02:['CONTAINER_RECORD_CORRUPT']};}
 const out={cld01:[],cld02:[]};
 if(d.schemaVersion!==1||d.accepted!==false||d.sourceCommit!==source){out.cld01.push('CONTAINER_TUPLE_MISMATCH');out.cld02.push('CONTAINER_TUPLE_MISMATCH');return out;}
 const part=(k,code,check)=>{const e=d[k];if(!e||e.status==='not_run'){out[k]=[code+'_MISSING:'+(e?.reason??'not recorded')];return;}
  if(e.status!=='tested'){out[k].push(code+'_FAILED');return;}
  const f=e.result?.file;let rb=null;try{rb=boundedEvidenceRead(root,'inputs/container/'+f);}catch{/* below */}
  if(!rb||sha(rb)!==e.result?.sha256){out[k].push(code+'_RESULT_CORRUPT');return;}
  if(e.sourceCommit!==source)out[k].push(code+'_TUPLE_MISMATCH');
  out[k].push(...check(e,rb));};
 part('cld01','CLD01',(e,rb)=>{const i=[];if(e.platform!=='linux/arm64')i.push('CLD01_PLATFORM');if(!vitestGreen(rb,1))i.push('CLD01_RESULT_NOT_GREEN');if(!/^sha256:[0-9a-f]{64}$/.test(e.imageId??''))i.push('CLD01_IMAGE_ID');return i;});
 part('cld02','CLD02',(e,rb)=>{const i=[];if(e.platform!=='linux/amd64')i.push('CLD02_PLATFORM');if(!/^sha256:[0-9a-f]{64}$/.test(e.imageId??''))i.push('CLD02_IMAGE_ID');
  try{const j=JSON.parse(rb);if(!(j.tests>0)||j.failures!==0||j.errors!==0||j.skipped!==0)i.push('CLD02_RESULT_NOT_GREEN');}catch{i.push('CLD02_RESULT_NOT_GREEN');}return i;});
 return out;
}
/** WEB07 rows come from the suites' own artifacts (tests/support/web07.ts writes them while the real-run specs execute); WEB08/WEB10 from the replay samples copied beside the record; WEB09 has no measurement yet. */
export const WEB07_PANELS={control:'e2e-control',faults:'e2e-faults',tray:'e2e-tray',belief:'e2e-belief',calibration:'e2e-calibration'};
export const WEB10_SAMPLES=['drive-fault','belief-recovery'];
export async function verifyWebRecord(root,m){
 const read=p=>{try{return boundedEvidenceRead(root,p);}catch{return null;}},out={WEB07:[],WEB08:[],WEB09:['WEB09_MEASUREMENT_MISSING:frame p95 with a 5,000-sample plot and the belief layer is not measured by any recorder yet'],WEB10:[]};
 for(const [panel,suite] of Object.entries(WEB07_PANELS)){
  const b=read(`suites/${suite}/screens/web07-${panel}.json`);if(!b){out.WEB07.push('WEB07_ROWS_MISSING:'+panel);continue;}
  let d;try{d=JSON.parse(b);}catch{out.WEB07.push('WEB07_ROWS_CORRUPT:'+panel);continue;}
  const got=new Map((d.rows??[]).map(e=>[[e.lang,e.width].join('/'),e]));
  for(const l of ['vi','ja','en'])for(const w of [390,1024,1440]){const e=got.get(l+'/'+w);
   if(!e||e.panel!==panel)out.WEB07.push(`WEB07_CELL_UNMEASURED:${panel}/${l}/${w}`);else if(e.axeSeriousCritical!==0||e.reducedMotion!==true||e.horizontalScroll!==false)out.WEB07.push(`WEB07_CELL_FAILED:${panel}/${l}/${w}`);}
 }
 const cat=read('inputs/web/replays/catalog.json'),ref=m.inputs?.webSamples;
 if(!cat||!ref||ref.file!=='inputs/web/replays/catalog.json'){out.WEB08.push('WEB_RECORD_MISSING:replay samples');out.WEB10.push('WEB_RECORD_MISSING:replay samples');return out;}
 if(sha(cat)!==ref.sha256){out.WEB08.push('WEB_RECORD_CORRUPT');out.WEB10.push('WEB_RECORD_CORRUPT');return out;}
 let catalog;try{catalog=JSON.parse(cat);}catch{out.WEB08.push('WEB_RECORD_CORRUPT');out.WEB10.push('WEB_RECORD_CORRUPT');return out;}
 for(const id of WEB10_SAMPLES){
  const e=catalog.replays?.find(r=>r.id===id),mb=read(`inputs/web/replays/${id}/manifest.json`);
  if(!e||!mb){out.WEB10.push('WEB10_SAMPLE_MISSING:'+id);continue;}
  let man;try{man=JSON.parse(mb);}catch{out.WEB10.push('WEB10_SAMPLE_FAILED:'+id);continue;}
  if(sha(mb)!==e.manifestSha256||man.provenance?.calibration!=='not_calibrated'||man.provenance?.accepted!==false||man.runId!==e.recording)out.WEB10.push('WEB10_SAMPLE_FAILED:'+id);
  if(typeof e.provenance!=='string'||!/not_calibrated/.test(e.provenance)||!/accepted:false/.test(e.provenance))out.WEB10.push('WEB10_LABEL_MISSING:'+id);
 }
 // WEB08: a package of an R4 run opens offline (the e2e-replay suite denies every runtime transport and reads its fault section); the package must be in the record
 if(!WEB10_SAMPLES.slice(0,1).every(id=>read(`inputs/web/replays/${id}/manifest.json`)))out.WEB08.push('WEB_RECORD_MISSING:drive-fault package');
 return out;
}
export async function collectR4ArtifactDispositions(root,m){
 const read=p=>{try{return boundedEvidenceRead(root,p);}catch{return null;}},issues=[],source=m.identity?.before?.sourceCommit,lab=m.lab?.commit,groups={};
 for(const [key,spec] of Object.entries(CAMPAIGNS)){groups[key]=await verifyOneCampaign(root,m,key,spec,source);issues.push(...groups[key]);}
 // REG05: the R2b record (itself read back through the R2b reader) and the Lab mock regression, both of THIS tuple
 const reg=[],r2b=m.inputs?.r2bRecord;
 if(!r2b||!read('inputs/r2b/qualification.json'))reg.push('R2B_RECORD_MISSING');
 else if(sha(read('inputs/r2b/qualification.json'))!==r2b.sha256)reg.push('R2B_RECORD_CORRUPT');
 else{let q=null;try{q=JSON.parse(read('inputs/r2b/qualification.json'));}catch{reg.push('R2B_RECORD_CORRUPT');}
  if(q){if(q.release!=='r2b'||q.accepted!==false||q.identity?.before?.sourceCommit!==source||q.lab?.commit!==lab||JSON.stringify(q.lab?.pin)!==JSON.stringify(m.lab?.pin))reg.push('R2B_TUPLE_MISMATCH');
   for(const [g,s] of Object.entries(q.gates??{}))if(s.status!==(g==='G-HOST1'?'blocked_external':'tested'))reg.push('R2B_GATE_NOT_TESTED:'+g);
   try{reg.push(...(await verifyR2bDirectory(join(root,'inputs/r2b'))).map(x=>'R2B:'+x));}catch(e){reg.push('R2B_READER:'+e.message);}}}
 const mock=m.inputs?.mockRegression;
 if(!mock||!read('inputs/mock/manifest.json'))reg.push('MOCK_REGRESSION_MISSING');
 else if(sha(read('inputs/mock/manifest.json'))!==mock.sha256)reg.push('MOCK_REGRESSION_CORRUPT');
 else{try{const q=JSON.parse(read('inputs/mock/manifest.json'));if(q.schema!=='lab-v2-regression/1'||q.identity?.start?.source?.commit!==source||!(q.commands??[]).length||q.commands.some(c=>c.exitCode!==0))reg.push('MOCK_REGRESSION_NOT_GREEN');}catch{reg.push('MOCK_REGRESSION_CORRUPT');}}
 groups.r2bRecord=reg;issues.push(...reg);
 const cont=await verifyContainerRecord(root,m,source);groups.cld01=cont.cld01;groups.cld02=cont.cld02;issues.push(...cont.cld01,...cont.cld02);
 const web=await verifyWebRecord(root,m);Object.assign(groups,{WEB07:web.WEB07,WEB08:web.WEB08,WEB09:web.WEB09,WEB10:web.WEB10});for(const k of ['WEB07','WEB08','WEB09','WEB10'])issues.push(...web[k]);
 return {issues:[...new Set(issues)],artifactDispositions:artifactDispositionsFromGroups(groups)};
}
export function artifactDispositionsFromGroups(groups){
 const out={};for(const [id,c] of Object.entries(CASES_R4)){
  if(c.notRun){out[id]={status:'not_run',issues:[c.notRun.split(':')[0]==='blocked'?'blocked':c.notRun]};continue;}
  const g=c.optional?['CALIBRATION_SELFTEST_MISSING']:c.input==='containerRecord'?groups[id==='CLD01'?'cld01':'cld02']:/^WEB/.test(id)?groups[id]:c.input?groups[c.input]:[];
  const issues=g??['ARTIFACT_READBACK_PENDING'];
  out[id]={status:issues.length?(issues.every(absent)?'not_run':'failed'):'tested',issues};
 }return out;
}
export async function assessR4Directory(root,m){
 const read=p=>{try{return boundedEvidenceRead(root,p);}catch{return null;}},r=checkR4Structure(m,read);if(m.release!=='r4')r.push('NOT_R4');
 try{if(JSON.stringify(evidenceInventory(root))!==JSON.stringify(m.artifacts))r.push('ARTIFACT_INVENTORY_MISMATCH');}catch(e){r.push(e.message);}
 const d=await collectR4ArtifactDispositions(root,m);r.push(...d.issues.filter(x=>!absent(x)));if(JSON.stringify(m.artifactDispositions)!==JSON.stringify(d.artifactDispositions))r.push('ARTIFACT_DISPOSITION_MISMATCH');
 for(const [id,x] of Object.entries(m.cases??{}))if(x.accepted===true)r.push('CASE_ACCEPTED:'+id);
 return [...new Set(r)];
}
export async function verifyR4Directory(root){let m;try{m=JSON.parse(boundedEvidenceRead(root,'qualification.json'));}catch(e){return ['R4_RECORD_MISSING:'+e.message];}return assessR4Directory(root,m);}
export {tableR4};
