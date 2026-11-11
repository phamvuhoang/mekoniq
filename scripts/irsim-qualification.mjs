// linkforge-irsim-qualification/1 (C03): the one mapping from the verification cases (specs/2026-11-08-linkforge-irsim/verification.md §3) to the evidence that
// tests them, shared by scripts/record-irsim.mjs (which writes qualification.json) and tests/acceptance/linkforge-irsim.acceptance.test.ts (which refuses it).
// `tested` means the named campaign cases passed and the named suites ran green on the recorded candidate; it is never `accepted` (a reviewer sets that).
// The core (`qualify`, `checkQualification`) takes its table (documentType, cases, gates, suites, campaign provider kind and optional extra inputs); the default is this file's
// LinkForge + IR-SIM table, and scripts/sim-extension-qualification.mjs passes its own.
import {createHash} from 'node:crypto';
import {existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
const sha=(b)=>createHash('sha256').update(b).digest('hex');
const V=(files)=>({repo:'source',kind:'vitest',files});
/** The suites record-irsim runs. `files` is passed to vitest / pytest; `python` names the pinned interpreter (relative to source); `command` is a Lab script. */
export const SUITES=[
 {id:'lf',...V(['tests/integration/linkforge-validation.test.ts','tests/security/linkforge-artifacts.test.ts','tests/unit/physical-model.test.ts','tests/unit/engineering-multi-drive.test.ts','tests/contracts/navigation2d-contracts.test.ts'])},
 {id:'lf-py',repo:'source',kind:'pytest',python:'.venv-linkforge/bin/python',files:['robotics/model-validation/tests']},
 {id:'cmp',...V(['tests/unit/navigation2d-compiler.test.ts','tests/integration/navigation2d-bundle.test.ts','tests/unit/navigation2d-fixtures.test.ts','tests/unit/navigation2d-geometry.test.ts'])},
 {id:'cmp-py',repo:'source',kind:'pytest',python:'.venv-irsim/bin/python',pythonPath:['robotics/navigation-2d','robotics/simulation'],files:['robotics/navigation-2d/tests']},
 {id:'parity-py',repo:'source',kind:'pytest',python:'.venv-irsim/bin/python',pythonPath:['robotics/navigation-2d','robotics/simulation'],files:['robotics/simulation/tests/test_description_parity.py']},
 {id:'ir',...V(['tests/integration/irsim-worker.test.ts','tests/integration/irsim-navigation.test.ts','tests/integration/irsim-mission.test.ts','tests/integration/irsim-recovery.test.ts','tests/integration/irsim-faults.test.ts','tests/integration/irsim-fleet.test.ts','tests/integration/irsim-readiness.test.ts','tests/security/irsim-authority.test.ts','tests/unit/navigation2d-controller.test.ts','tests/unit/navigation2d-oracle.test.ts'])},
 {id:'evi',...V(['tests/integration/irsim-evidence.test.ts','tests/integration/irsim-evidence-terminal.test.ts','tests/security/irsim-replay.test.ts','tests/unit/navigation2d-metrics.test.ts'])},
 {id:'int',...V(['tests/unit/irsim-cli.test.ts','tests/integration/portable-tool-closure.test.ts','tests/integration/lab-runtime-artifact.test.ts','tests/unit/portable-simulation-bootstrap.test.ts','tests/unit/irsim-qualification.test.ts'])},
 // INT03 proper: twenty-five sequential runs and two worlds at once (concurrency 2, child count back to baseline) on the real worker
 {id:'batch',...V(['tests/integration/irsim-batch.test.ts'])},
 {id:'lab-unit',repo:'lab',kind:'vitest',files:['tests/unit/model-validation.test.ts','tests/unit/irsim-controls.test.ts','tests/unit/lidar-overlay.test.ts','tests/unit/navigation2d-report.test.ts','tests/unit/readiness.test.ts','tests/integration/irsim-launcher.test.ts','tests/integration/runtime-artifact.test.ts','tests/integration/source-report-import.test.ts']},
 // one spec per launcher: the launcher's pairing code is one-use, so a second spec behind the same launcher can never pair
 {id:'lab-e2e-journey',repo:'lab',kind:'playwright',command:['scripts/test-irsim-e2e.mjs','irsim-journey.spec.ts']},
 {id:'lab-e2e-fleet',repo:'lab',kind:'playwright',command:['scripts/test-irsim-e2e.mjs','irsim-fleet.spec.ts']},
];
const LF={suites:['lf','lf-py']},CMP={suites:['cmp','cmp-py','parity-py']},IR=(c,extra={})=>({campaign:c,suites:['ir'],...extra});
export const CASES={
 LF01:LF,LF02:LF,LF03:LF,LF04:LF,LF05:LF,LF06:LF,
 CMP01:CMP,CMP02:CMP,CMP03:CMP,CMP04:CMP,CMP05:CMP,
 IR01:IR(['IR-FD01']),IR02:IR(['IR-FD03']),IR03:IR(['IR-FD04','IR-FD04-blocked']),
 IR04:IR(['IR-FD07','IR-RIG-ZONE'],{note:'zone contention is proven by the campaign-only rig IR-RIG-ZONE; source-driven IR-FD07 missions are serialized by the venue-movement reservation (both robots move, one at a time)'}),
 IR05:IR(['IR-FD01-cancel']),IR06:IR(['IR-RAW-PAIR-CONTACT']),
 // IR07 per spec §3: "independent swept oracle OR command guard detects" — the swept oracle (navigation2d-oracle.test.ts, source swept_oracle) is in suite ir;
 // the plant cannot produce the trigger, so no engine discrete collision is claimed (reviewer reading, 2026-11-09; the C02 not_run reading under-claimed)
 IR07:{suites:['ir'],note:'swept_oracle only: the independent swept check finds a thin wall crossed between two ticks; the real plant caps |v| at 0.5 m/s (1 cm per 20 ms tick against a 0.6 m footprint) so tunnelling cannot be produced there and no engine discrete collision is claimed'},
 IR08:IR(['IR-FD01'],{suites:['ir','cmp-py']}),IR09:IR(['IR-FD01'],{suites:['ir','cmp-py']}),IR10:IR(['IR-FD01-workerkill']),
 SEN01:{suites:['cmp-py','ir']},SEN02:{suites:['cmp-py','ir']},
 EVI01:{suites:['evi']},EVI02:{suites:['evi']},EVI03:{suites:['evi']},
 INT01:{lab:true,suites:['lab-e2e-journey','lab-e2e-fleet']},INT02:{suites:['int','lab-unit']},INT03:{campaign:'*',suites:['int','batch']},INT04:{lab:true,suites:['lab-e2e-journey','lab-e2e-fleet']},
};
export const GATES={'G-LF1':['LF01'],'G-LF2':['LF02','LF03','LF04','LF05','LF06'],'G-IR1':['IR01'],'G-IR2':['IR04'],'G-IR3':['IR02','IR03','IR05','IR06','IR07','IR08','IR09','IR10'],'G-INT1':['INT01','INT02','INT03','INT04']};
export const GATE_IDS=Object.keys(GATES);
/** The default table: what record-irsim writes and tests/acceptance/linkforge-irsim reads. Another record type passes its own to qualify/checkQualification. */
export const TABLE={documentType:'linkforge-irsim-qualification',cases:CASES,gates:GATES,suites:SUITES,providerKind:'irsim_worker',providerReason:'PROVIDER_NOT_IRSIM'};
/** Counts from a suite's own result file (vitest/playwright JSON, pytest JUnit XML): the guard re-derives them instead of trusting the manifest. */
export const summarizeResult=(kind,text)=>{
 if(kind==='pytest'){const n=(k)=>Number(new RegExp(`\\b${k}="(\\d+)"`).exec(text)?.[1]??0);return {passed:n('tests')-n('failures')-n('errors')-n('skipped'),failed:n('failures')+n('errors'),skipped:n('skipped'),total:n('tests')};}
 const j=JSON.parse(text);
 return kind==='vitest'?{passed:j.numPassedTests,failed:j.numFailedTests,skipped:j.numPendingTests+(j.numTodoTests??0),total:j.numTotalTests}:{passed:j.stats.expected,failed:j.stats.unexpected,skipped:j.stats.skipped,total:j.stats.expected+j.stats.unexpected+j.stats.skipped};};
/** Green = exit 0, no failure, no skipped test (a skipIf that fired is not_run, never pass), at least one test ran. */
const summaryOf=(s)=>s.result?.summary??s.summary??{};
const skippedOf=(s)=>Number(summaryOf(s).skipped??0);
const suiteState=(s)=>!s?'not_run':s.exitCode!==0||summaryOf(s).failed>0||summaryOf(s).unexpected>0?'failed':skippedOf(s)>0?'not_run':(summaryOf(s).passed??summaryOf(s).expected??0)>0?'tested':'not_run';
/** Case and gate statuses from a campaign summary (or null), the suite records and whether the Lab was recorded. failed > not_run > tested. */
export function qualify(input,table=TABLE){
 const {campaign,suites,lab}=input,byId=new Map((suites??[]).map(s=>[s.id,s])),cases={},notRun=[];
 for(const [id,c] of Object.entries(table.cases)){
  const evidence=[],why=[];let status='tested';
  const worse=(s,reason)=>{if(s==='failed'||status!=='failed')status=s;why.push(reason);};
  if(c.notRun){cases[id]={status:'not_run',evidence,reason:c.notRun};notRun.push({id,reason:c.notRun});continue;}
  if(c.lab&&!lab)worse('not_run','Lab not recorded');
  for(const sid of c.suites??[]){const s=byId.get(sid),st=suiteState(s);if(st==='tested')evidence.push(`suite:${sid}`);else worse(st,`suite ${sid} ${st}${s&&skippedOf(s)>0?` (${skippedOf(s)} skipped)`:''}`);}
  // inputs only some tables use (R1): the algorithm checker's verdicts, the IR-SIM record of the same commit, the Lab's mock regression
  for(const id of c.algorithm??[]){const r=(input.algorithm?.results??[]).find(x=>x.caseId===id);if(!r)worse('not_run',`algorithm case ${id} absent`);else if(r.verdict==='pass')evidence.push(`algorithm:${id}`);else worse(r.verdict==='fail'?'failed':'not_run',`algorithm case ${id} ${r.verdict}`);}
  if(c.irsimRecord){const x=input.irsim,bad=x?Object.entries(x.gates??{}).filter(([,g])=>g.status!=='tested').map(([k])=>k):[];
   if(!x)worse('not_run','no linkforge-irsim record');else if(x.identity?.before?.sourceCommit!==input.sourceCommit)worse('not_run','the linkforge-irsim record is of another commit');else if(bad.length||!Object.keys(x.gates??{}).length)worse('not_run',`linkforge-irsim gates not tested: ${bad.join(',')||'none recorded'}`);else evidence.push('record:linkforge-irsim');}
  if(c.mockRegression){const x=input.mock;
   if(!x)worse('not_run','no mock regression recorded');else if(x.identity?.start?.source?.commit!==input.sourceCommit)worse('not_run','the mock regression is of another commit');else if(!(x.commands??[]).length)worse('not_run','no mock regression command ran');else if((x.commands??[]).some(k=>k.exitCode!==0))worse('failed',`a mock regression command exited non-zero: ${x.commands.filter(k=>k.exitCode!==0).map(k=>k.id).join(',')}`);else if((x.notRun??[]).length)worse('not_run',`the mock regression has not_run items: ${x.notRun.map(n=>n.id).join(',')}`);else evidence.push('record:mock-regression');}
  // R1.1 (REG02): the R1 record of the same commit, every gate of it tested (a gate that is not tested there is a failure of the regression, not a missing input)
  if(c.r1Record){const x=input.r1,bad=x?Object.entries(x.gates??{}).filter(([,g])=>g.status!=='tested').map(([k])=>k):[];
   if(!x||x.documentType!=='sim-extension-qualification'||x.release!=='r1')worse('not_run','no R1 record');else if(x.identity?.before?.sourceCommit!==input.sourceCommit)worse('not_run','the R1 record is of another commit');else if(bad.length||!Object.keys(x.gates??{}).length)worse('failed',`R1 gates not tested: ${bad.join(',')||'none recorded'}`);else evidence.push('record:r1');}
  if(c.campaign){
   if(!campaign)worse('not_run','campaign not recorded');
   else if(c.campaign==='*'){if(campaign.complete&&campaign.runs.every(r=>r.result==='pass'))evidence.push('campaign:*');else worse(campaign.runs.some(r=>r.result==='fail')?'failed':'not_run','campaign not complete');}
   else for(const sc of c.campaign){const runs=campaign.runs.filter(r=>r.scenarioId===sc);
    if(!runs.length)worse('not_run',`campaign case ${sc} absent`);else if(runs.every(r=>r.result==='pass'))evidence.push(`campaign:${sc}`);else worse(runs.some(r=>r.result==='fail')?'failed':'not_run',`campaign case ${sc} ${runs.map(r=>r.result).join(',')}`);}
  }
  cases[id]={status,evidence,...c.note?{note:c.note}:{},...status==='tested'?{}:{reason:why.join('; ')}};
  if(status!=='tested')notRun.push({id,reason:cases[id].reason});
 }

 const gates=Object.fromEntries(Object.entries(table.gates).map(([g,ids])=>[g,{status:ids.every(id=>cases[id].status==='tested')?'tested':'not_run',accepted:false,cases:ids}]));
 return {cases,gates,notRun};
}
const HEX=/^[0-9a-f]{64}$/,COMMIT=/^[0-9a-f]{40}$/;
/**
 * Fail-closed check of a written qualification.json against the files beside it (`read(relativePath)` -> Buffer|null). Returns every reason it is not a
 * reviewable, honest candidate record; [] only for a complete, consistent, irsim_2d record whose statuses are exactly what the evidence supports.
 */
export function checkQualification(m,read,table=TABLE){
 const r=[],json=(p)=>{const b=read(p);if(!b)return null;try{return JSON.parse(b.toString('utf8'));}catch{return undefined;}};
 if(!m||m.schemaVersion!==1||m.documentType!==table.documentType)return ['NOT_A_QUALIFICATION'];
 if(m.accepted!==false&&!(m.accepted===true&&typeof m.acceptedBy==='string'&&m.acceptedBy&&typeof m.acceptedAt==='string'))r.push('ACCEPTED_WITHOUT_REVIEWER');
 const b=m.identity?.before,a=m.identity?.after;
 if(!b||!COMMIT.test(b.sourceCommit??'')||!HEX.test(b.toolClosures?.portable??'')||!HEX.test(b.toolClosures?.native??''))r.push('IDENTITY_MISSING');
 if(b?.dirty!==false)r.push('SOURCE_DIRTY');
 if(m.identity?.identityStable!==true||!a||a.sourceCommit!==b?.sourceCommit||a.dirty!==false||a.toolClosures?.portable!==b?.toolClosures?.portable||a.toolClosures?.native!==b?.toolClosures?.native)r.push('IDENTITY_UNSTABLE');
 if(m.lab){
  if(m.lab.dirty!==false)r.push('LAB_DIRTY');
  if(m.lab.pin?.sourceCommit!==b?.sourceCommit)r.push('LAB_PIN_MISMATCH');
  if(m.lab.pin?.portableToolsDigest!==b?.toolClosures?.portable)r.push('LAB_PORTABLE_DIGEST_MISMATCH');
 }
 const gateIds=Object.keys(table.gates);
 for(const g of Object.keys(m.gates??{}))if(!gateIds.includes(g))r.push(`FOREIGN_GATE:${g}`);
 // the campaign: its summary as written, its campaign.json, identity.json and every run's own record
 const noCampaign=table.campaign===false; // R1.1 records no campaign: its Webots evidence is the suites that drive the real engine
 const s=noCampaign?null:m.campaign?.summary,summaryBytes=s?.path?read(s.path):null,summary=summaryBytes?json(s.path):null;
 if(noCampaign){if(m.campaign)r.push('CAMPAIGN_NOT_EXPECTED');}
 else{
 if(!summary||sha(summaryBytes)!==s.sha256||summary.status!==s.status||summary.complete!==s.complete||summary.runs?.length!==s.runs||summary.provider?.kind!==s.provider?.kind)r.push('SUMMARY_CORRUPT');
 if(s?.provider?.kind!==table.providerKind||summary&&summary.provider?.kind!==table.providerKind)r.push(table.providerReason);}
 if(summary){
  if(summary.status!=='completed'||summary.complete!==true)r.push('CAMPAIGN_INCOMPLETE');
  const dir=s.path.replace(/[^/]*$/,''),campaignBytes=read(`${dir}campaign.json`);
  if(!campaignBytes||sha(campaignBytes)!==summary.campaignSha256)r.push('CAMPAIGN_CORRUPT');
  if(json(`${dir}identity.json`)?.stable!==true)r.push('CLOSURE_CHANGED');
  for(const run of summary.runs??[]){
   const rec=json(`${dir}runs/${run.id}/run.json`);
   if(!rec){r.push(`RUN_RECORD_MISSING:${run.id}`);continue;}
   if(run.result!=='pass'||rec.result!=='pass')r.push(`RUN_NOT_PASS:${run.id}`);
   if(rec.evidenceAsExpected!==true)r.push(`EVIDENCE_NOT_AS_EXPECTED:${run.id}`);
   const report=json(`${dir}runs/${run.id}/report.json`);
   if(report&&rec.evidenceComplete!==false&&report.metrics?.navigation?.sensorPublications?.complete!==true)r.push(`SENSOR_COVERAGE_LOST:${run.id}`);
  }
 }
 // every suite of the table must be in the record: a record that left suites out is not a consistent all-not_run pass, it is incomplete
 for(const s of table.suites)if(!(m.suites??[]).some(su=>su.id===s.id))r.push(`SUITE_MISSING:${s.id}`);
 if(!(m.commands??[]).some(c=>c.id==='licenses'))r.push('COMMAND_MISSING:licenses');
 for(const su of m.suites??[]){
  const st=suiteState(su);if(st==='failed')r.push(`SUITE_FAILED:${su.id}`);else if(skippedOf(su)>0)r.push(`SUITE_SKIPPED:${su.id}`);else if(st==='not_run')r.push(`SUITE_EMPTY:${su.id}`);
  if(!su.result){r.push(`SUITE_RESULT_MISSING:${su.id}`);continue;}
  const bytes=read(su.result.file);if(!bytes||sha(bytes)!==su.result.sha256){r.push(`SUITE_RESULT_CORRUPT:${su.id}`);continue;}
  // the counts come from the file, not from the manifest (kind from the table, not from a claim)
  try{if(JSON.stringify(summarizeResult(table.suites.find(t=>t.id===su.id)?.kind,bytes.toString('utf8')))!==JSON.stringify(su.result.summary))r.push(`SUITE_SUMMARY_MISMATCH:${su.id}`);}catch{r.push(`SUITE_SUMMARY_MISMATCH:${su.id}`);}
 }
 for(const c of m.commands??[])if(c.exitCode!==0)r.push(`COMMAND_FAILED:${c.id}`);
 for(const art of m.artifacts??[]){const bytes=read(art.file);if(!bytes)r.push(`ARTIFACT_MISSING:${art.file}`);else if(sha(bytes)!==art.sha256||bytes.length!==art.bytes)r.push(`ARTIFACT_CORRUPT:${art.file}`);}
 // statuses must be exactly what the recorded evidence supports
 const extra=table.inputs?.(m,read)??{input:{},reasons:[]};r.push(...extra.reasons);
 const q=qualify({campaign:summary&&summary.status==='completed'?summary:null,suites:m.suites??[],lab:!!m.lab,sourceCommit:b?.sourceCommit,...extra.input},table);
 for(const id of Object.keys(table.cases)){
  const c=m.cases?.[id];if(!c){r.push(`CASE_MISSING:${id}`);continue;}
  if(c.status!==q.cases[id].status)r.push(`CASE_STATUS_MISMATCH:${id}`);
  if(c.status!=='tested'&&!(typeof c.reason==='string'&&c.reason))r.push(`CASE_NOT_RUN_WITHOUT_REASON:${id}`);
  if(table.cases[id].note&&c.note!==table.cases[id].note)r.push(`CASE_NOTE_MISSING:${id}`);// a case tested with a declared limitation must carry it verbatim
 }
 for(const g of gateIds){const x=m.gates?.[g];if(!x)r.push(`GATE_MISSING:${g}`);else{if(x.status!==q.gates[g].status)r.push(`GATE_STATUS_MISMATCH:${g}`);if(x.accepted!==false)r.push(`GATE_ACCEPTED:${g}`);}}
 return r;
}

/** Bytecode under the given tool roots (relative paths, sorted): every `__pycache__` directory (not descended) and every loose `.pyc`/`.pyo`. The Lab's
 * IR-SIM launcher fails closed on any of these inside the pinned closure, so a recording checks before it spends ten minutes finding out. */
export const bytecodeUnder=(root,paths)=>{
 const found=[],walk=(rel)=>{for(const e of readdirSync(join(root,rel),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
  const r=`${rel}/${e.name}`;if(e.name==='__pycache__'||/\.py[co]$/.test(e.name))found.push(r);else if(e.isDirectory()&&!e.isSymbolicLink())walk(r);}};
 for(const p of paths)if(existsSync(join(root,p)))walk(p);
 return found.sort();
};
