#!/usr/bin/env node
// One-off CI-job retry for the completed 2026-11-07 R2 recording. No services or Git state are changed.
// Node 24: node /tmp/recover-physical-recording.mjs --check  (read-only preflight)
//          node /tmp/recover-physical-recording.mjs          (fresh R3, integration then quiet UI benchmark)
import {spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync,existsSync,lstatSync,mkdirSync,readFileSync,statSync,utimesSync,writeFileSync} from 'node:fs';
import {dirname,isAbsolute,relative,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import os from 'node:os';

const WORKSPACE='/Users/hoangpham/source/prv/robot',LAB=resolve(WORKSPACE,'lab'),SOURCE=resolve(WORKSPACE,'source');
const PARENT=resolve(LAB,'docs/implementation/evidence/physical-robot-lab/release-2026-11-07-r2');
const OUT=resolve(LAB,'docs/implementation/evidence/physical-robot-lab/release-2026-11-07-r3');
const EXPECTED={source:'899a83769726aa6840c40a32fb0e89d17a137cb7',lab:'582f9f46eb4a6fed40e3df97ce50c580c5ea850d'};
const JOBS=[
 {id:'source-integration',repo:'source',kind:'vitest',file:'source-integration.json',log:'source-integration.log',extraEnv:{LAB_V2_CLEAN_EXPORT:'1'},args:out=>['node_modules/vitest/vitest.mjs','run','tests/integration','--reporter=json',`--outputFile=${out}/source-integration.json`]},
 {id:'lab-ui-performance',repo:'lab',kind:'measurement',file:'lab-ui-performance.json',log:'lab-ui-performance.log',extraEnv:{},args:out=>['scripts/measure-twin-ui.mjs','--duration-ms','60000','--output',`${out}/lab-ui-performance.json`]},
];
const JOB_IDS=JOBS.map(j=>j.id),FAILED_FILES=new Set(JOBS.flatMap(j=>[j.log,j.file]));
const SELF=fileURLToPath(import.meta.url),PARENT_MANIFEST=resolve(PARENT,'manifest.json');
const {captureRegressionIdentity,assertRecordedRegressionIdentity,assertStableRecording}=await import(pathToFileURL(resolve(SOURCE,'tests/support/regression-identity.ts')).href);
const {checkedRuntime}=await import(pathToFileURL(resolve(LAB,'scripts/runtime-artifact.mjs')).href);
const {scrubEvidence}=await import(pathToFileURL(resolve(LAB,'scripts/recorder-scrub.mjs')).href);
const shaBytes=bytes=>createHash('sha256').update(bytes).digest('hex');
const shaFile=file=>shaBytes(readFileSync(file));
const scrub=(text,kind)=>scrubEvidence(text,{workspace:WORKSPACE,home:os.homedir(),node:process.execPath},kind);
const fail=message=>{throw new Error(message);};
const requireValue=(condition,message)=>{if(!condition)fail(message);};
const same=(actual,want,message)=>requireValue(isDeepStrictEqual(actual,want),message);
const shown=file=>relative(WORKSPACE,file).split(sep).join('/');
function inside(root,file){
 requireValue(typeof file==='string'&&file.length>0&&!isAbsolute(file),'INVALID_EVIDENCE_REFERENCE');
 const target=resolve(root,file),rel=relative(root,target);
 requireValue(rel&&!rel.startsWith(`..${sep}`)&&rel!=='..'&&!isAbsolute(rel),'EVIDENCE_REFERENCE_ESCAPES_ROOT');
 // Refuse both leaf and parent-directory symlinks rather than copying evidence from outside the root.
 let checked=root;
 requireValue(!lstatSync(root).isSymbolicLink(),'EVIDENCE_ROOT_IS_SYMLINK');
 for(const piece of rel.split(sep)){checked=resolve(checked,piece);requireValue(!lstatSync(checked).isSymbolicLink(),'EVIDENCE_REFERENCE_IS_SYMLINK');}
 requireValue(lstatSync(target).isFile(),'EVIDENCE_REFERENCE_NOT_FILE');
 return target;
}
function references(record){
 const refs=new Map();
 const add=(file,hash)=>{
  requireValue(typeof hash==='string'&&/^[a-f0-9]{64}$/.test(hash),'INVALID_STORED_HASH');
  if(refs.has(file))requireValue(refs.get(file)===hash,`CONFLICTING_HASH:${file}`);
  refs.set(file,hash);
 };
 for(const c of record.commands)add(c.log,c.logSha256);
 for(const r of record.runs)add(r.file,r.sha256);
 for(const a of record.artifacts)add(a.file,a.sha256);
 return refs;
}
function verifyHashes(root,refs){
 for(const [file,hash] of refs)requireValue(shaFile(inside(root,file))===hash,`EVIDENCE_HASH_MISMATCH:${file}`);
}
function vitestSummary(value){
 for(const key of ['numPassedTests','numFailedTests','numPendingTests','numTotalTests'])requireValue(Number.isInteger(value[key])&&value[key]>=0,`INVALID_VITEST_FIELD:${key}`);
 return {passed:value.numPassedTests,failed:value.numFailedTests,skipped:value.numPendingTests+(value.numTodoTests??0),total:value.numTotalTests};
}
function summaryHasFailure(run){
 if(run.kind==='vitest')return run.summary?.failed!==0;
 if(run.kind==='playwright')return run.summary?.unexpected!==0;
 if(run.kind==='junit')return run.summary?.failures!==0||run.summary?.errors!==0;
 if(run.kind==='measurement')return run.summary?.minimumDurationMet!==true||run.summary.profiles?.some(p=>p.meetsTarget!==true);
 return false;
}
function summarize(job,text){
 const json=JSON.parse(text);
 if(job.kind==='vitest')return {summary:vitestSummary(json),reportsFailure:json.success===false||json.numFailedTests>0};
 const summary={durationMs:json.durationMs,minimumDurationMet:json.minimumDurationMet,profiles:json.results.map(p=>({id:p.id,p95Ms:p.frameIntervals.p95Ms,paintP95Ms:p.workspacePaint.p95Ms,meetsTarget:p.meetsTarget}))};
 return {summary,reportsFailure:summaryHasFailure({kind:'measurement',summary})};
}
function commandText(job,out){
 return scrub(`${Object.entries(job.extraEnv).map(([k,v])=>`${k}=${v}`).join(' ')} ${process.execPath} ${job.args(out).join(' ')}`.trim());
}
async function checkIdentity(parent){
 assertRecordedRegressionIdentity(parent,SOURCE,LAB);
 const current=captureRegressionIdentity(SOURCE,LAB);
 for(const repo of ['source','lab'])requireValue(current[repo].commit===EXPECTED[repo],`${repo.toUpperCase()}_HEAD_NOT_EXACT_R2`);
 same(current,parent.identity.start,'CURRENT_IDENTITY_NOT_EXACT_R2_START');
 same(current,parent.identity.end,'CURRENT_IDENTITY_NOT_EXACT_R2_END');
 for(const checkpoint of parent.identity.checkpoints)same(checkpoint.identity,current,`R2_CHECKPOINT_IDENTITY_DIFFERS:${checkpoint.id}`);
 const {lock}=await checkedRuntime(LAB);
 requireValue(lock.sourceCommit===EXPECTED.source,'INSTALLED_PIN_SOURCE_MISMATCH');
 const recordedPin=JSON.parse(execFileSync('git',['-C',LAB,'show',`${EXPECTED.lab}:config/source-runtime.lock.json`],{encoding:'utf8'}));
 same(lock,recordedPin,'INSTALLED_PIN_NOT_RECORDED_PIN');
 return {identity:current,pin:lock};
}
async function preflight(){
 requireValue(process.versions.node.split('.')[0]==='24','NODE_24_REQUIRED');
 requireValue(!existsSync(OUT),'R3_OUTPUT_ALREADY_EXISTS');
 requireValue(existsSync(PARENT_MANIFEST),'R2_NOT_FINISHED_MANIFEST_MISSING');
 const manifestStat=statSync(PARENT_MANIFEST),bytes=readFileSync(PARENT_MANIFEST),parent=JSON.parse(bytes);
 requireValue(parent.schema==='lab-v2-regression/1'&&parent.suite==='physical-robot-lab','WRONG_PARENT_SCHEMA_OR_SUITE');
 requireValue(parent.recorder==='lab/scripts/record-regression.mjs --ci --suite physical-robot-lab','R2_NOT_EXPECTED_CI_RECORDING');
 requireValue(parent.host?.node===process.version,'NODE_VERSION_DIFFERS_FROM_R2');
 requireValue(Array.isArray(parent.commands)&&Array.isArray(parent.runs)&&Array.isArray(parent.artifacts),'INCOMPLETE_PARENT_MANIFEST');
 same(parent.notRun,[],'UNEXPECTED_R2_NOT_RUN');
 requireValue(new Set(parent.commands.map(c=>c.id)).size===parent.commands.length,'DUPLICATE_PARENT_COMMAND');
 requireValue(new Set(parent.runs.map(r=>r.id)).size===parent.runs.length,'DUPLICATE_PARENT_RUN');
 const failures=parent.commands.filter(c=>c.exitCode!==0);
 same(failures.map(c=>c.id).sort(),[...JOB_IDS].sort(),'UNEXPECTED_FAILED_COMMAND_SCOPE');
 const originals=JOBS.map(job=>{
  const command=failures.find(c=>c.id===job.id);
  requireValue(command.repo===job.repo&&command.log===job.log,'UNEXPECTED_FAILED_COMMAND_RECORD');
  const runs=parent.runs.filter(r=>r.id.startsWith(`${job.id}:`));
  requireValue(runs.length===1&&runs[0].id===`${job.id}:${job.file}`,'UNEXPECTED_FAILED_RESULT_SCOPE');
  const run=runs[0];
  requireValue(run.file===job.file&&run.repo===job.repo&&run.kind===job.kind&&run.exitCode===command.exitCode,'INVALID_FAILED_RESULT_RECORD');
  const expected=commandText(job,PARENT);
  requireValue(command.command===expected&&run.command===expected,'R2_COMMAND_NOT_EXPECTED_JOB');
  return {job,command,run};
 });
 for(const run of parent.runs)if(!originals.some(o=>o.run===run))requireValue(run.exitCode===0&&!summaryHasFailure(run),`UNEXPECTED_FAILED_RUN:${run.id}`);
 const refs=references(parent);verifyHashes(PARENT,refs);
 const oldResult=JSON.parse(readFileSync(inside(PARENT,'source-integration.json'),'utf8'));
 const expectedFailure={passed:858,failed:11,skipped:125,total:994};
 same(vitestSummary(oldResult),expectedFailure,'R2_FAILURE_NOT_REVIEWED_INCIDENT');
 same(originals[0].run.summary,expectedFailure,'R2_FAILED_SUMMARY_MISMATCH');
 const oldMeasurement=summarize(JOBS[1],readFileSync(inside(PARENT,'lab-ui-performance.json'),'utf8'));
 same(originals[1].run.summary,oldMeasurement.summary,'R2_BENCHMARK_SUMMARY_MISMATCH');
 requireValue(oldMeasurement.reportsFailure,'R2_BENCHMARK_NOT_FAILED');
 requireValue(oldResult.testResults.some(suite=>suite.assertionResults?.some(test=>test.status==='failed'&&test.failureMessages?.some(message=>message.includes('CONNECT_TIMEOUT 127.0.0.1:57422')))),'R2_FAILURE_MISSING_EXTERNAL_DB_OBSERVATION');
 const verified=await checkIdentity(parent);
 requireValue(shaFile(PARENT_MANIFEST)===shaBytes(bytes),'PARENT_MANIFEST_CHANGED_DURING_PREFLIGHT');
 return {parent,refs,originals,parentHash:shaBytes(bytes),manifestStat,...verified};
}
function copyVerified(source,destination,expectedHash,times=statSync(source)){
 requireValue(shaFile(source)===expectedHash,`SOURCE_CHANGED_BEFORE_COPY:${shown(source)}`);
 mkdirSync(dirname(destination),{recursive:true});copyFileSync(source,destination);
 requireValue(shaFile(destination)===expectedHash,`COPY_HASH_MISMATCH:${shown(destination)}`);
 utimesSync(destination,times.atime,times.mtime);
 return {file:relative(OUT,destination).split(sep).join('/'),sha256:expectedHash,source:shown(source),originalMtime:times.mtime.toISOString()};
}
async function recover(prepared){
 const {parent,refs,originals,parentHash,manifestStat,identity,pin}=prepared;
 const scriptHash=shaFile(SELF),copyRows=[];
 // Make the fresh root only after every parent reference, code identity and installed pin was checked.
 mkdirSync(OUT);
 for(const [file,hash] of refs){
  const historical=FAILED_FILES.has(file);
  copyRows.push(copyVerified(inside(PARENT,file),resolve(OUT,historical?`recovery/r2/${file}`:file),hash));
 }
 const parentCopy=copyVerified(PARENT_MANIFEST,resolve(OUT,'recovery/r2/manifest.json'),parentHash,manifestStat);
 const scriptCopy=copyVerified(SELF,resolve(OUT,'recovery/recover-physical-recording.mjs'),scriptHash);
 verifyHashes(PARENT,refs);
 requireValue(shaFile(PARENT_MANIFEST)===parentHash,'PARENT_MANIFEST_CHANGED_BEFORE_RETRY');
 await checkIdentity(parent);
 const record=structuredClone(parent),validationErrors=[],retryAttempts=[];
 // Run only the two reviewed failed jobs, sequentially. The benchmark starts after integration has exited.
 for(const {job,command:originalCommand,run:originalRun} of originals){
  await checkIdentity(parent);
  const before=captureRegressionIdentity(SOURCE,LAB);same(before,identity,'IDENTITY_CHANGED_BEFORE_RETRY');
  const beforeCheckpoint={id:`${job.id}:before`,identity:before,recordedAt:new Date().toISOString()};
  const startedAt=new Date().toISOString();
  console.log(JSON.stringify({retryStarted:job.id,startedAt}));
  const result=spawnSync(process.execPath,job.args(OUT),{cwd:job.repo==='source'?SOURCE:LAB,env:{...process.env,LAB_V2_REQUIRE_LAB_FIXTURES:'1',...job.extraEnv},encoding:'utf8',maxBuffer:1<<28});
  const finishedAt=new Date().toISOString();
  writeFileSync(resolve(OUT,job.log),scrub((result.stdout??'')+(result.stderr??'')+(result.error?`\n${result.error.message}\n`:'')));
  const after=captureRegressionIdentity(SOURCE,LAB);assertStableRecording(before,after);same(after,identity,'IDENTITY_CHANGED_AFTER_RETRY');
  await checkIdentity(parent);
  const afterCheckpoint={id:`${job.id}:after`,identity:after,recordedAt:new Date().toISOString()};
  const command=commandText(job,OUT);
  const replacementCommand={...originalCommand,command,startedAt,finishedAt,exitCode:result.status,log:job.log,logSha256:shaFile(resolve(OUT,job.log))};
  record.commands=record.commands.map(c=>c.id===job.id?replacementCommand:c);
  const runPosition=record.runs.findIndex(r=>r.id===originalRun.id);
  if(existsSync(resolve(OUT,job.file))){
   const text=scrub(readFileSync(resolve(OUT,job.file),'utf8'),job.kind);writeFileSync(resolve(OUT,job.file),text);
   let summary=null;
   try{const parsed=summarize(job,text);summary=parsed.summary;if(parsed.reportsFailure)validationErrors.push(`${job.id}:RETRY_RESULT_REPORTS_FAILURE`);}
   catch(error){validationErrors.push(`${job.id}:RETRY_RESULT_INVALID:${scrub(String(error.message))}`);}
   record.runs[runPosition]={...originalRun,command,startedAt,finishedAt,exitCode:result.status,file:job.file,sha256:shaFile(resolve(OUT,job.file)),summary};
  }else{
   validationErrors.push(`${job.id}:RETRY_RESULT_MISSING`);record.runs.splice(runPosition,1);
   record.notRun.push({id:`${job.id}:${job.file}`,reason:`retry result file not produced (exit ${result.status})`});
  }
  record.identity.end=after;
  record.identity.checkpoints=record.identity.checkpoints.map(c=>c.id===beforeCheckpoint.id?beforeCheckpoint:c.id===afterCheckpoint.id?afterCheckpoint:c);
  retryAttempts.push({id:job.id,startedAt,finishedAt,exitCode:result.status,signal:result.signal??null,environmentOverrides:{LAB_V2_REQUIRE_LAB_FIXTURES:'1',...job.extraEnv},node:process.version,inheritsCallerEnvironment:true});
  console.log(JSON.stringify({retryFinished:job.id,finishedAt,exitCode:result.status}));
 }
 const inheritedArtifacts=record.artifacts.map(a=>({...a}));
 const historicalCopies=copyRows.filter(c=>c.file.startsWith('recovery/r2/'));
 record.artifacts=[...inheritedArtifacts,...[...historicalCopies,parentCopy,scriptCopy].map(c=>({file:c.file,sha256:c.sha256,role:c===scriptCopy?'recovery-script':'parent-failed-recording'}))];
 const failedCommands=record.commands.filter(c=>c.exitCode!==0).map(c=>c.id);
 const status=failedCommands.length||record.notRun.length||validationErrors.length?'fail':'pass';
 record.recovery={
  schema:'lab-regression-selective-retry/1',status,createdAt:new Date().toISOString(),
  reason:'R2 source-integration hit external OrbStack/PostgreSQL connectivity failures; lab-ui-performance exceeded its desktop paint target while OrbStack was stopping/restarting. Root recovered the service. Only these two failed jobs were retried, integration first and benchmark second.',
  note:'R3 is a derived recording with selective CI-job retries. Reused checks are R2 observations with original timestamps, not fresh R3 executions. The original failures are retained.',
  sourceManifest:{file:relative(OUT,PARENT_MANIFEST).split(sep).join('/'),sha256:parentHash,retainedCopy:parentCopy.file},
  script:{file:SELF,sha256:scriptHash,retainedCopy:scriptCopy.file},
  exactIdentity:identity,installedPin:pin,
  originalFailedCommands:originals.map(o=>o.command),originalResultReferences:originals.map(o=>o.run),
  originalCheckpoints:parent.identity.checkpoints.filter(c=>JOB_IDS.some(id=>c.id===`${id}:before`||c.id===`${id}:after`)),
  retainedFailureArtifacts:historicalCopies,
  reusedCommandIds:parent.commands.filter(c=>!JOB_IDS.includes(c.id)).map(c=>c.id),retriedCommandIds:JOB_IDS,
  reusedCommands:parent.commands.filter(c=>!JOB_IDS.includes(c.id)).map(c=>({id:c.id,startedAt:c.startedAt,finishedAt:c.finishedAt,log:c.log,logSha256:c.logSha256,resultReferences:parent.runs.filter(r=>r.id.startsWith(`${c.id}:`)).map(r=>({file:r.file,sha256:r.sha256})),
   validity:'Reused R2 observations: exact Source/Lab HEADs, clean code hashes, installed pin and every stored hash were verified. These commands were not rerun in R3.'})),
  copiedFiles:copyRows.filter(c=>!c.file.startsWith('recovery/r2/')),
  retryAttempts,failedCommands,validationErrors,
  timestampPolicy:'Reused command/result timestamps and copied file bytes/mtimes retain R2 values. Only the two retried jobs have new execution timestamps. Parent failure records remain retained and hashed.',
 };
 // All retained observations and their copied files must still agree before the derived manifest becomes available.
 verifyHashes(OUT,references(record));verifyHashes(PARENT,refs);
 requireValue(shaFile(PARENT_MANIFEST)===parentHash,'PARENT_MANIFEST_CHANGED_AFTER_RETRY');
 requireValue(shaFile(SELF)===scriptHash,'RECOVERY_SCRIPT_CHANGED_DURING_RETRY');
 const finalIdentity=captureRegressionIdentity(SOURCE,LAB);same(finalIdentity,identity,'IDENTITY_CHANGED_BEFORE_FINAL_MANIFEST');
 writeFileSync(resolve(OUT,'manifest.json'),JSON.stringify(record,null,1)+'\n');
 console.log(JSON.stringify({out:shown(OUT),status,retried:JOB_IDS,reused:record.recovery.reusedCommands.length,failedCommands,validationErrors,parentManifestSha256:parentHash,scriptSha256:scriptHash}));
 return status==='pass'?0:1;
}

try{
 const args=process.argv.slice(2);requireValue(args.length===0||args.length===1&&args[0]==='--check','ONLY_OPTION_IS_--check');
 const prepared=await preflight();
 if(args[0]==='--check')console.log(JSON.stringify({status:'preflight-pass',parent:shown(PARENT_MANIFEST),parentManifestSha256:prepared.parentHash,verifiedFiles:prepared.refs.size,identity:prepared.identity,pin:prepared.pin,output:shown(OUT),execution:'not started'}));
 else process.exitCode=await recover(prepared);
}catch(error){console.error(scrub(`RECOVERY_STOPPED: ${error.stack??error.message??error}`));process.exitCode=1;}
