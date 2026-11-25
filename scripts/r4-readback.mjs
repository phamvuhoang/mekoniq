// R4 directory-level artifact reader (plan V16). Nothing is taken from a status in qualification.json: every input is copied beside it, hashed, and re-verified by the verifier that wrote it (campaign verifiers) or by
// its own readback (R2b record, container record, web record). A missing input makes the cases that name it `not_run`; corruption, another tuple or `accepted:true` makes them `failed`.
import {isDeepStrictEqual as equal} from 'node:util';
import currentCil from '../robotics/simulation-mujoco/campaigns/cil-v2.json' with {type:'json'};
import currentBench from '../robotics/simulation-mujoco/campaigns/bench-v2.json' with {type:'json'};
import {lstatSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {checkR4Structure,tableR4,CASES_R4,GATES_R4} from './sim-extension-r4.mjs';
import {boundedEvidenceRead,evidenceInventory,verifyR2bDirectory} from './r2b-readback.mjs';
import {checkArmContainer,readNativeContainer} from './r4-container-readback.mjs';
import {readCalibrationInput} from './r4-calibration-readback.mjs';
import {verifyWeb07Record} from './r4-web07-readback.mjs';
import {verifyWeb09Record} from './r4-web09-readback.mjs';
export {WEB07_PANELS} from './r4-web07-readback.mjs';
import {verifyReplayRecord} from './r4-replay-readback.mjs';
export {WEB10_SAMPLES} from './r4-replay-readback.mjs';
import {tsImport} from 'tsx/esm/api';
const sha=b=>createHash('sha256').update(b).digest('hex');
const ENGINE='../packages/lab-runtime/src/v2/';
/** campaign inputs: manifest key -> copy dir, verifier module + export, the code that names it */
export const CAMPAIGNS={
 recoveryCampaign:{dir:'inputs/recovery',code:'RECOVERY_CAMPAIGN',module:'simulation3d/cell-campaign.ts',fn:'verifyRecoveryCampaign',ids:['mj-cell-recovery-v2']},
 cilCampaign:{dir:'inputs/cil',code:'CIL_CAMPAIGN',module:'control/cil-campaign.ts',fn:'verifyCilCampaign',ids:['cil-v1','cil-v2']},
 benchCampaign:{dir:'inputs/bench',code:'BENCH_CAMPAIGN',module:'control/bench-campaign.ts',fn:'verifyBenchCampaign',ids:['bench-v1','bench-v2']},
 faultCampaign:{dir:'inputs/fault',code:'FAULT_CAMPAIGN',module:'control/fault-campaign.ts',fn:'verifyFaultCampaign',ids:['fault-v1']},
 trayCampaign:{dir:'inputs/tray',code:'TRAY_CAMPAIGN',module:'simulation3d/tray-campaign.ts',fn:'verifyTrayCampaign',ids:['tray-v1']},
 perceptionStudy:{dir:'inputs/study',code:'PERCEPTION_STUDY',module:'perception/perception-study.ts',fn:'verifyPerceptionStudy',ids:['perception-gap-v1']}
};
const absent=x=>/^[A-Z0-9_]+_MISSING(:|$)/.test(x)||x==='ARTIFACT_READBACK_PENDING'||/_INCOMPLETE$/.test(x);
export async function verifyOneCampaign(root,m,key,spec,source){
 const r=[],x=m.inputs?.[key],path=spec.dir+'/campaign.json';let b=null;try{b=boundedEvidenceRead(root,path);}catch{/* reported below */}
 if(key==='recoveryCampaign'&&(!x||x.file!==path||!b)){
  let supplied=Object.hasOwn(m.inputs??{},key);
  try{supplied||=!!lstatSync(join(root,spec.dir),{throwIfNoEntry:false});}catch{supplied=true;}
  return [spec.code+(supplied?'_CORRUPT':'_MISSING')];
 }
 if(!x||x.file!==path||!b){r.push(spec.code+'_MISSING');return r;}
 if(sha(b)!==x.sha256){r.push(spec.code+'_CORRUPT');return r;}
 let doc;try{doc=JSON.parse(b);}catch{r.push(spec.code+'_CORRUPT');return r;}
 if(!doc||typeof doc!=='object'||Array.isArray(doc))return [spec.code+'_CORRUPT'];
 if(doc.accepted!==false)r.push(spec.code+'_ACCEPTED');
 if(!spec.ids.includes(doc.campaign?.id))r.push(spec.code+'_ID_MISMATCH');
 if(doc.sourceCommit!==source)r.push(spec.code+'_TUPLE_MISMATCH');
 try{const mod=await tsImport(ENGINE+spec.module,import.meta.url),v=await mod[spec.fn](join(root,spec.dir)),done=v.completedCases??v.completedRuns;
  if(done!==v.expectedRuns||!v.expectedRuns||v.issues.length||v.missingArtifacts.length)r.push(...v.issues.map(i=>spec.code+':'+i),spec.code+'_INCOMPLETE');
 }catch(e){r.push(spec.code+'_READER:'+e.message);}
 return r;
}
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
 part('cld01','CLD01',(e,rb)=>e.result.file==='cld01.json'?checkArmContainer(root,e,rb,m.lab?.pin):['CLD01_RESULT_PATH']);
 part('cld02','CLD02',e=>{
  if(e.result.file!=='cld02/SHA256SUMS')return ['CLD02_NATIVE_DIRECTORY_REQUIRED'];
  try{const native=readNativeContainer(join(root,'inputs/container/cld02'),source,m.lab?.pin);return ['imageId','sourceCommit','platform'].every(k=>native[k]===e[k])?[]:['CLD02_TUPLE_MISMATCH'];}
  catch(err){return ['CLD02_NATIVE_INVALID:'+err.message];}
 });
 return out;
}
/** WEB07 rows come from the suites' own artifacts (tests/support/web07.ts writes them while the real-run specs execute); WEB08/WEB10 from the replay samples copied beside the record; WEB09 comes from the e2e-perf suite's frame timing (raw intervals). */
export async function verifyWebRecord(root,m,opts={}){
 const read=p=>{try{return boundedEvidenceRead(root,p);}catch{return null;}},out={WEB07:[],WEB08:[],WEB09:[],WEB10:[]};
 out.WEB09=await verifyWeb09Record(read,m,opts.web09);
 out.WEB07=verifyWeb07Record(read,m);
 Object.assign(out,await verifyReplayRecord(read,m));
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
 else{try{
  const q=JSON.parse(read('inputs/mock/manifest.json')),ident=q.identity;
  const matches=point=>[ ['source',source],['lab',lab] ].every(([k,commit])=>point?.[k]?.commit===commit&&
   /^[a-f0-9]{64}$/.test(point[k].codeHash??'')&&point[k].dirtyCodePaths?.length===0);
  if(q.schema!=='lab-v2-regression/1'||!matches(ident?.start)||!matches(ident?.end)||
   ['source','lab'].some(k=>ident?.start?.[k]?.codeHash!==ident?.end?.[k]?.codeHash)||
   !Array.isArray(q.notRun)||q.notRun.length||!Array.isArray(q.commands)||!q.commands.some(c=>c.id==='lab-mock-e2e')||q.commands.some(c=>c.exitCode!==0))reg.push('MOCK_REGRESSION_NOT_GREEN');
  const base='inputs/r2b/inputs/r2a/',nested=JSON.parse(read(base+'qualification.json'))?.mockRegression,bytes=read(base+'mock-regression.json');
  if(mock.file!=='inputs/mock/manifest.json'||nested?.file!=='mock-regression.json'||nested.labCommit!==lab||nested.sha256!==mock.sha256||
   !bytes||sha(bytes)!==mock.sha256)reg.push('MOCK_REGRESSION_CHAIN_MISMATCH');
 }catch{reg.push('MOCK_REGRESSION_CORRUPT');}}
 groups.r2bRecord=reg;issues.push(...reg);
 groups.calibrationSelftest=await readCalibrationInput(root,m);issues.push(...groups.calibrationSelftest);
 const cont=await verifyContainerRecord(root,m,source);groups.cld01=cont.cld01;groups.cld02=cont.cld02;issues.push(...cont.cld01,...cont.cld02);
 const web=await verifyWebRecord(root,m);Object.assign(groups,{WEB07:web.WEB07,WEB08:web.WEB08,WEB09:web.WEB09,WEB10:web.WEB10});for(const k of ['WEB07','WEB08','WEB09','WEB10'])issues.push(...web[k]);
 return {issues:[...new Set(issues)],artifactDispositions:artifactDispositionsFromGroups(groups)};
}
export function artifactDispositionsFromGroups(groups){
 const out={};for(const [id,c] of Object.entries(CASES_R4)){
  if(c.notRun){out[id]={status:'not_run',issues:[c.notRun.split(':')[0]==='blocked'?'blocked':c.notRun]};continue;}
  const g=c.optional?groups[c.optional]??['CALIBRATION_SELFTEST_MISSING']:c.input==='containerRecord'?groups[id==='CLD01'?'cld01':'cld02']:/^WEB/.test(id)?groups[id]:c.input?groups[c.input]:[];
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

// Additional requirements of this local closeout execution. Generic readers continue
// to report accurate incomplete or historical evidence on their own terms.
export function closeoutProfileIssues(root,m,source,lab){
 const issues=[],pending='artifact not_run: deploy_order_pending';
 if(m.release!=='r4'||m.accepted!==false||m.acceptedBy!==null||m.acceptedAt!==null)issues.push('CLOSEOUT_ACCEPTANCE');
 if(![source,lab].every(x=>/^[a-f0-9]{40}$/.test(x))||m.identity?.identityStable!==true||
  m.identity?.before?.sourceCommit!==source||m.identity?.after?.sourceCommit!==source||m.lab?.pin?.sourceCommit!==source||m.lab?.commit!==lab)issues.push('CLOSEOUT_TUPLE');
 for(const id of Object.keys(CASES_R4))if(m.cases?.[id]?.status!==(id==='CLD03'?'not_run':'tested'))issues.push('CLOSEOUT_CASE:'+id);
 for(const id of Object.keys(GATES_R4))if(m.gates?.[id]?.status!==(id==='G-CLOUD2'?'not_run':'tested')||m.gates[id].accepted!==false)issues.push('CLOSEOUT_GATE:'+id);
 if(m.cases?.CLD03?.reason!==pending||!equal(m.notRun,[{id:'CLD03',reason:pending}]))issues.push('CLOSEOUT_EXCEPTION');
 for(const [key,registry] of [['cilCampaign',currentCil],['benchCampaign',currentBench]]){
  try{
   const ref=m.inputs[key],path=CAMPAIGNS[key].dir+'/campaign.json',bytes=boundedEvidenceRead(root,path),d=JSON.parse(bytes);
   if(ref.file!==path||ref.sha256!==sha(bytes)||d.sourceCommit!==source||d.accepted!==false||!equal(d.campaign,registry))throw Error();
  }catch{issues.push('CLOSEOUT_POPULATION:'+key);}
 }
 return issues;
}
export async function verifyR4Closeout(root,source,lab){
 const m=JSON.parse(boundedEvidenceRead(root,'qualification.json'));
 return [...await assessR4Directory(root,m),...closeoutProfileIssues(root,m,source,lab)];
}
if(import.meta.main){
 const [root,source,lab]=process.argv.slice(2),issues=await verifyR4Closeout(root,source,lab);
 console.log(JSON.stringify({source,lab,accepted:false,issues}));process.exitCode=issues.length?1:0;
}
