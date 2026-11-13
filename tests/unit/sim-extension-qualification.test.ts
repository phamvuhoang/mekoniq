// R1 qualification (sim-extension-qualification/1): the case/gate table of spec §6.3 and the fail-closed record check, on synthetic records. The live directory is
// checked by tests/acceptance/sim-extension.acceptance.test.ts. `tested` is never `accepted`; a skipped test is not_run; a record never carries an accepted gate.
import {expect,test} from 'vitest';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
// @ts-expect-error plain ESM script without types
import {CASES,GATES,SUITES,CASES_R11,GATES_R11,SUITES_R11,checkIrsimRecord,checkR1Record,checkQualification,qualify,qualifyR11} from '../../scripts/sim-extension-qualification.mjs';
// @ts-expect-error plain ESM script without types
import * as Q from '../../scripts/sim-extension-qualification.mjs';
// @ts-expect-error plain ESM script without types
import * as ir from '../../scripts/irsim-qualification.mjs';
type M=Record<string,any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const HEX='a'.repeat(64),HEX2='b'.repeat(64),COMMIT='c'.repeat(40),LABC='d'.repeat(40),pass={passed:3,failed:0,skipped:0,total:3};
const ALG=['ALG01','ALG02','ALG03','ALG05','PID01','PID02','PID03'];
const RUNS=['WB-FD01','WB-FD07','WB-FD01-cancel','WB-FD01-enginekill'];
const campaignSummary=(over:M={})=>({status:'completed',complete:true,evidenceComplete:false,provider:{id:'webots_3d',kind:'webots_engine'},campaignSha256:sha('{"c":1}'),sourceCommit:COMMIT,
 runs:RUNS.map((scenarioId,i)=>({id:`${String(i+1).padStart(3,'0')}-${scenarioId}`,scenarioId,result:'pass',reasons:[]})),...over});
const irsimRecord=(over:M={})=>({schemaVersion:1,documentType:'linkforge-irsim-qualification',accepted:false,identity:{before:{sourceCommit:COMMIT}},lab:{commit:LABC},gates:Object.fromEntries(['G-LF1','G-LF2','G-IR1','G-IR2','G-IR3','G-INT1'].map(g=>[g,{status:'tested',accepted:false}])),...over});
const mockManifest=(over:M={})=>({schema:'lab-v2-regression/1',identity:{start:{source:{commit:COMMIT},lab:{commit:LABC}},end:{source:{commit:COMMIT},lab:{commit:LABC}}},commands:[{id:'x',exitCode:0}],notRun:[],...over});
const results=(over:Record<string,string>={})=>({results:ALG.map(caseId=>({caseId,verdict:over[caseId]??'pass',reasons:[]})),oracleProfileDigest:HEX,lockDigest:HEX2});

const resultText=(kind:string,s:{passed:number;failed:number;skipped:number;total:number})=>kind==='pytest'?`<testsuite tests="${s.total}" failures="${s.failed}" errors="0" skipped="${s.skipped}"/>`:kind==='vitest'?JSON.stringify({numPassedTests:s.passed,numFailedTests:s.failed,numPendingTests:s.skipped,numTotalTests:s.total}):JSON.stringify({stats:{expected:s.passed,unexpected:s.failed,skipped:s.skipped}});
/** A complete, consistent R1 candidate directory in memory. */
function candidate(over:(m:M,files:Map<string,string>)=>void=()=>{}){
 const files=new Map<string,string>(),put=(p:string,t:string)=>{files.set(p,t);return {file:p,sha256:sha(t),bytes:Buffer.byteLength(t)};};
 const summary=campaignSummary();put('campaign/campaign.json','{"c":1}');const summaryRef=put('campaign/summary.json',JSON.stringify(summary));
 for(const r of summary.runs){put(`campaign/runs/${r.id}/run.json`,JSON.stringify({id:r.id,result:'pass',evidenceAsExpected:true,evidenceComplete:!r.scenarioId.endsWith('enginekill')}));put(`campaign/runs/${r.id}/report.json`,JSON.stringify({metrics:{navigation:{sensorPublications:{complete:!r.scenarioId.endsWith('enginekill')}}}}));}
 put('campaign/identity.json',JSON.stringify({stable:true}));
 const alg=put('algorithm-results.json',JSON.stringify(results())),irs=put('irsim-record.json',JSON.stringify(irsimRecord())),mock=put('mock-regression.json',JSON.stringify(mockManifest()));
 const suites=SUITES.map((s:{id:string;kind:string})=>{const result=put(`suites/${s.id}.json`,resultText(s.kind,pass));const log=put(`suites/${s.id}.log`,'ok');return {id:s.id,exitCode:0,command:'x',startedAt:'t',finishedAt:'t',log:log.file,logSha256:log.sha256,result:{...result,summary:pass}};});
 const before={sourceCommit:COMMIT,dirty:false,toolClosures:{portable:HEX,native:HEX2},node:'v24.22.2',os:'darwin',arch:'arm64',lockSha256:HEX,oracleProfileDigest:HEX,at:'t'};
 const q=qualify({campaign:summary,suites,lab:true,sourceCommit:COMMIT,algorithm:results(),irsim:irsimRecord(),mock:mockManifest()});
 const m:M={schemaVersion:1,documentType:'sim-extension-qualification',release:'r1',candidateId:'r1-candidate-01',accepted:false,acceptedBy:null,acceptedAt:null,note:'evidence input',
  identity:{before,after:structuredClone(before),identityStable:true},lab:{commit:'d'.repeat(40),dirty:false,pin:{sourceCommit:COMMIT,artifactSha256:HEX,portableToolsDigest:HEX,schemaHash:HEX}},
  campaign:{command:'node scripts/lab-irsim.mjs run …',exitCode:0,summary:{path:'campaign/summary.json',sha256:summaryRef.sha256,status:summary.status,complete:summary.complete,runs:summary.runs.length,provider:summary.provider}},
  algorithm:{file:alg.file,sha256:alg.sha256},irsimRecord:{file:irs.file,sha256:irs.sha256,candidate:'candidate-04'},mockRegression:{file:mock.file,sha256:mock.sha256},
  suites,commands:[{id:'licenses',exitCode:0},{id:'performance',exitCode:0}],cases:q.cases,gates:q.gates,notRun:q.notRun,artifacts:[...files.keys()].sort().map(p=>({file:p,sha256:sha(files.get(p)!),bytes:Buffer.byteLength(files.get(p)!)}))};
 over(m,files);
 return {m,read:(p:string)=>files.has(p)?Buffer.from(files.get(p)!):null};
}
const reasons=(c:ReturnType<typeof candidate>)=>checkQualification(c.m,c.read) as string[];
const allSuites=(skip:(id:string)=>boolean=()=>false)=>SUITES.map((s:{id:string})=>({id:s.id,exitCode:0,result:{summary:skip(s.id)?{passed:0,failed:0,skipped:4,total:4}:pass}}));
const base=(over:M={})=>({campaign:campaignSummary(),suites:allSuites(),lab:true,sourceCommit:COMMIT,algorithm:results(),irsim:irsimRecord(),mock:mockManifest(),...over});

test('mapping: every case of spec §6.3 and exactly its six gates; ALG04 is R3 and belongs to no R1 gate; WB04 carries the serialisation note; one spec per launcher',()=>{
 expect(Object.keys(GATES)).toEqual(['G-ALG1','G-ALG2','G-WB1','G-WB2','G-INT2','G-REG1']);
 expect(GATES).toEqual({'G-ALG1':['ALG01','ALG02','ALG03','ALG05'],'G-ALG2':['PID01','PID02','PID03'],'G-WB1':['WB01','WB02','WB08'],'G-WB2':['WB03','WB04','WB05','WB06','WB07'],'G-INT2':['INT11','INT12'],'G-REG1':['REG01']});
 for(const ids of Object.values(GATES) as string[][])for(const id of ids)expect(CASES[id],id).toBeTruthy();
 expect(CASES.ALG04.notRun).toMatch(/R3.*LinuxCNC/);expect(Object.values(GATES).flat()).not.toContain('ALG04');
 expect(CASES.WB04.note).toMatch(/__venue_movement__/);expect(CASES.WB04.note).toMatch(/no .*rig/i);
 for(const s of SUITES)expect(s.id&&s.repo&&(s.files?.length||s.command?.length),s.id).toBeTruthy();
 for(const s of SUITES.filter((x:{kind:string})=>x.kind==='playwright'))expect(s.command.filter((a:string)=>a.endsWith('.spec.ts'))).toHaveLength(1);
});

test('qualify: with everything green every R1 gate is tested and none accepted; ALG04 stays not_run with its reason',()=>{
 const q=qualify(base());
 for(const g of Object.keys(GATES))expect(q.gates[g]).toMatchObject({status:'tested',accepted:false});
 expect(q.cases.ALG04).toMatchObject({status:'not_run',reason:expect.stringMatching(/R3/)});
 expect(q.notRun.map((n:{id:string})=>n.id)).toEqual(['ALG04']);
 expect(q.cases.WB04).toMatchObject({status:'tested',note:CASES.WB04.note});
});

test('qualify: a suite with skipped tests is not_run (never pass); without Webots the engine gates and G-INT2 are not_run while the algorithm gates stay tested',()=>{
 const skipped=qualify(base({suites:allSuites(id=>id==='wb-mission')}));
 expect(skipped.cases.WB03.status).toBe('not_run');expect(skipped.cases.WB03.reason).toMatch(/suite wb-mission not_run \(4 skipped\)/);expect(skipped.gates['G-WB2'].status).toBe('not_run');
 const none=qualify(base({campaign:null,suites:allSuites(id=>/^(wb-|lab-e2e)/.test(id)),lab:false}));
 for(const g of ['G-WB1','G-WB2','G-INT2'])expect(none.gates[g].status,g).toBe('not_run');
 for(const g of ['G-ALG1','G-ALG2'])expect(none.gates[g].status,g).toBe('tested');
 expect(none.gates['G-REG1'].status).toBe('tested');
});

test('qualify: an algorithm verdict that is not pass, an IR-SIM record of another commit or with a gate not tested, or a red mock regression, keep the case out of tested',()=>{
 expect(qualify(base({algorithm:results({ALG03:'fail'})})).cases.ALG03.status).toBe('failed');
 expect(qualify(base({algorithm:results({PID02:'not_run'})})).gates['G-ALG2'].status).toBe('not_run');
 expect(qualify(base({algorithm:null})).gates['G-ALG1'].status).toBe('not_run');
 const other=qualify(base({irsim:irsimRecord({identity:{before:{sourceCommit:'e'.repeat(40)}}})}));expect(other.cases.REG01.status).toBe('not_run');expect(other.cases.REG01.reason).toMatch(/another commit/);
 const half=irsimRecord();half.gates['G-IR2'].status='not_run';expect(qualify(base({irsim:half})).cases.REG01.status).toBe('not_run');
 expect(qualify(base({mock:mockManifest({commands:[{id:'x',exitCode:1}]})})).cases.REG01.status).toBe('failed'); // a regression command that ran and exited non-zero is a failure, not a missing precondition
 expect(qualify(base({mock:mockManifest({commands:[]})})).cases.REG01.status).toBe('not_run');
 expect(qualify(base({mock:null})).cases.REG01.status).toBe('not_run');
});

test('checkIrsimRecord: the recorder refuses an IR-SIM record of another commit, an accepted or foreign document, and a record that is not complete',()=>{
 expect(checkIrsimRecord(irsimRecord(),COMMIT)).toEqual([]);
 expect(checkIrsimRecord(irsimRecord({identity:{before:{sourceCommit:'e'.repeat(40)}}}),COMMIT).join()).toMatch(/IRSIM_RECORD_COMMIT/);
 expect(checkIrsimRecord({...irsimRecord(),documentType:'x'},COMMIT).join()).toMatch(/IRSIM_RECORD_NOT_LINKFORGE/);
 expect(checkIrsimRecord(irsimRecord({accepted:true}),COMMIT).join()).toMatch(/IRSIM_RECORD_ACCEPTED/);
 const half=irsimRecord();half.gates['G-LF1'].status='not_run';expect(checkIrsimRecord(half,COMMIT).join()).toMatch(/IRSIM_GATE_NOT_TESTED:G-LF1/);
});

test('guard: a complete consistent candidate has no reasons; each single defect is named',()=>{
 expect(reasons(candidate())).toEqual([]);
 const one=(over:(m:M,files:Map<string,string>)=>void,re:RegExp)=>expect(reasons(candidate(over)).join(' | ')).toMatch(re);
 one(m=>{m.accepted=true;},/ACCEPTED_WITHOUT_REVIEWER/);
 one(m=>{m.documentType='linkforge-irsim-qualification';},/NOT_A_QUALIFICATION/);
 one(m=>{m.gates['G-IR1']={status:'tested',accepted:false,cases:[]};},/FOREIGN_GATE:G-IR1/);
 one(m=>{m.gates['G-WB2'].accepted=true;},/GATE_ACCEPTED:G-WB2/);
 one(m=>{m.cases.WB04.note='x';},/CASE_NOTE_MISSING:WB04/);
 one(m=>{delete m.cases.ALG04;},/CASE_MISSING:ALG04/);
 one(m=>{m.cases.ALG04={status:'tested',evidence:[]};},/CASE_STATUS_MISMATCH:ALG04/);
 one(m=>{m.campaign.summary.provider={kind:'irsim_worker'};},/PROVIDER_NOT_WEBOTS/);
 one(m=>{m.identity.before.dirty=true;},/SOURCE_DIRTY/);
 one(m=>{m.lab.pin.sourceCommit='e'.repeat(40);},/LAB_PIN_MISMATCH/);
 one((m,f)=>{f.delete('algorithm-results.json');},/ALGORITHM_RESULTS_MISSING|ARTIFACT_MISSING/);
 one((m,f)=>{f.set('algorithm-results.json',JSON.stringify(results({ALG01:'fail'})));},/ALGORITHM_RESULTS_CORRUPT|ARTIFACT_CORRUPT/);
 one(m=>{m.algorithm=undefined;},/ALGORITHM_RESULTS_MISSING/);
 one((m,f)=>{const bad=results({ALG01:'fail'});f.set('algorithm-results.json',JSON.stringify(bad));m.algorithm.sha256=sha(JSON.stringify(bad));m.artifacts.find((a:M)=>a.file==='algorithm-results.json').sha256=sha(JSON.stringify(bad));m.artifacts.find((a:M)=>a.file==='algorithm-results.json').bytes=Buffer.byteLength(JSON.stringify(bad));},/CASE_STATUS_MISMATCH:ALG01|GATE_STATUS_MISMATCH:G-ALG1/);
 one(m=>{m.identity.before.oracleProfileDigest=HEX2;m.identity.after.oracleProfileDigest=HEX2;},/ORACLE_PROFILE_MISMATCH/);
 one(m=>{m.irsimRecord=undefined;},/IRSIM_RECORD_MISSING/);
 one((m,f)=>{const o=irsimRecord({identity:{before:{sourceCommit:'e'.repeat(40)}}}),t=JSON.stringify(o);f.set('irsim-record.json',t);m.irsimRecord.sha256=sha(t);const a=m.artifacts.find((x:M)=>x.file==='irsim-record.json');a.sha256=sha(t);a.bytes=Buffer.byteLength(t);},/IRSIM_RECORD_COMMIT|CASE_STATUS_MISMATCH:REG01/);
 one(m=>{m.mockRegression=undefined;},/MOCK_REGRESSION_MISSING/);
 one(m=>{m.suites=m.suites.filter((s:{id:string})=>s.id!=='wb-fleet');},/SUITE_MISSING:wb-fleet/);
 one(m=>{m.suites.find((s:{id:string})=>s.id==='wb-fleet').result.summary={passed:3,failed:0,skipped:1,total:4};},/SUITE_SKIPPED:wb-fleet/);
 one(m=>{m.commands=[{id:'performance',exitCode:0}];},/COMMAND_MISSING:licenses/);
});

test('the default table of irsim-qualification.mjs is unchanged: the newest recorded LinkForge/IR-SIM candidate checks clean through the parameterised core and its statuses are reproduced',()=>{
 const dir=join('docs/implementation/evidence/linkforge-irsim'),cands=existsSync(dir)?readdirSync(dir).filter(d=>/^candidate-\d+$/.test(d)).sort():[];
 expect(cands.length).toBeGreaterThan(0);
 const d=join(dir,cands.at(-1)!),read=(p:string)=>existsSync(join(d,p))?readFileSync(join(d,p)):null,m=JSON.parse(readFileSync(join(d,'qualification.json'),'utf8')) as M;
 expect(ir.checkQualification(m,read)).toEqual([]);
 const summary=JSON.parse(readFileSync(join(d,m.campaign.summary.path),'utf8'));
 const q=ir.qualify({campaign:summary,suites:m.suites,lab:!!m.lab});
 expect(Object.fromEntries(Object.entries(q.gates).map(([k,v])=>[k,(v as M).status]))).toEqual(Object.fromEntries(Object.entries(m.gates).map(([k,v])=>[k,(v as M).status])));
 expect(Object.keys(ir.GATES)).toEqual(['G-LF1','G-LF2','G-IR1','G-IR2','G-IR3','G-INT1']);
});

test('REG01: a Lab regression that lists notRun is not a green regression (the Lab recorder itself exits 1 on it)',()=>{
 const q=qualify(base({mock:mockManifest({notRun:[{id:'BV01',reason:'skipped'}]})}));
 expect(q.cases.REG01.status).toBe('not_run');expect(q.gates['G-REG1'].status).not.toBe('tested');
});

test('suites: the manifest alone cannot make a suite green — the result file must exist and its own counts must equal the recorded summary',()=>{
 const missing=candidate(m=>{delete m.suites.find((s:{id:string})=>s.id==='wb-fleet').result;});
 expect(reasons(missing)).toContain('SUITE_RESULT_MISSING:wb-fleet');
 const forged=candidate((m,files)=>{const s=m.suites.find((x:{id:string})=>x.id==='wb-fleet'),t=resultText('vitest',{passed:2,failed:1,skipped:0,total:3});
  files.set(s.result.file,t);s.result.sha256=sha(t);m.artifacts.find((a:{file:string})=>a.file===s.result.file).sha256=sha(t);m.artifacts.find((a:{file:string})=>a.file===s.result.file).bytes=Buffer.byteLength(t);});
 expect(reasons(forged)).toContain('SUITE_SUMMARY_MISMATCH:wb-fleet'); // the manifest says failed:0, the file says failed:1
});

// ---- Release 1.1 (X08): the r1.1 table, REG02 and the guard on a record without a campaign ----
const r1Record=(over:M={})=>({schemaVersion:1,documentType:'sim-extension-qualification',release:'r1',accepted:false,identity:{before:{sourceCommit:COMMIT}},lab:{commit:LABC},
 irsimRecord:{file:'irsim-record.json',sha256:sha(JSON.stringify(irsimRecord()))},mockRegression:{file:'mock-regression.json',sha256:sha(JSON.stringify(mockManifest()))},
 gates:Object.fromEntries(Object.keys(GATES).map(g=>[g,{status:'tested',accepted:false,cases:[]}])),...over});
const allSuites11=(skip:(id:string)=>boolean=()=>false)=>SUITES_R11.map((s:{id:string})=>({id:s.id,exitCode:0,result:{summary:skip(s.id)?{passed:0,failed:0,skipped:2,total:2}:pass}}));
const base11=(over:M={})=>({suites:allSuites11(),lab:true,sourceCommit:COMMIT,r1:r1Record(),irsim:irsimRecord(),mock:mockManifest(),...over});

function candidate11(over:(m:M,files:Map<string,string>)=>void=()=>{}){
 const files=new Map<string,string>(),put=(p:string,t:string)=>{files.set(p,t);return {file:p,sha256:sha(t),bytes:Buffer.byteLength(t)};};
 const irs=put('irsim-record.json',JSON.stringify(irsimRecord())),mock=put('mock-regression.json',JSON.stringify(mockManifest())),r1=put('r1-record.json',JSON.stringify(r1Record({irsimRecord:{file:'irsim-record.json',sha256:irs.sha256},mockRegression:{file:'mock-regression.json',sha256:mock.sha256}})));
 const suites=SUITES_R11.map((s:{id:string;kind:string})=>{const result=put(`suites/${s.id}.json`,resultText(s.kind,pass));const log=put(`suites/${s.id}.log`,'ok');return {id:s.id,exitCode:0,command:'x',startedAt:'t',finishedAt:'t',log:log.file,logSha256:log.sha256,repo:'source',kind:s.kind,result:{file:result.file,sha256:result.sha256,summary:pass}};});
 const before={sourceCommit:COMMIT,dirty:false,toolClosures:{portable:HEX,native:HEX2},node:'v24.22.2',os:'darwin',arch:'arm64',lockSha256:HEX,oracleProfileDigest:HEX,at:'t'};
 const q=qualifyR11({suites,lab:true,sourceCommit:COMMIT,r1:JSON.parse(files.get('r1-record.json')!),irsim:irsimRecord(),mock:mockManifest()});
 const m:M={schemaVersion:1,documentType:'sim-extension-qualification',release:'r1.1',candidateId:'r11-candidate-01',accepted:false,acceptedBy:null,acceptedAt:null,note:'evidence input',
  identity:{before,after:structuredClone(before),identityStable:true},lab:{commit:'d'.repeat(40),dirty:false,pin:{sourceCommit:COMMIT,artifactSha256:HEX,portableToolsDigest:HEX,schemaHash:HEX}},campaign:null,
  r1Record:{file:r1.file,sha256:r1.sha256,candidate:'r1-candidate-03'},irsimRecord:{file:irs.file,sha256:irs.sha256,candidate:'candidate-06'},mockRegression:{file:mock.file,sha256:mock.sha256},
  suites,commands:[{id:'licenses',exitCode:0}],cases:q.cases,gates:q.gates,notRun:q.notRun,artifacts:[...files.keys()].sort().map(p=>({file:p,sha256:sha(files.get(p)!),bytes:Buffer.byteLength(files.get(p)!)}))};
 over(m,files);
 return {m,read:(p:string)=>files.has(p)?Buffer.from(files.get(p)!):null};
}

test('r1.1 mapping: every case of spec §6.3 and exactly its four gates; every case is on a gate and every gate case exists; one spec per launcher',()=>{
 expect(GATES_R11).toEqual({'G-WA1':['WA01','WA02','WA03'],'G-WA2':['WA04','WA05','WA06','WA07','WA08'],'G-INT3':['INT13','INT14'],'G-REG2':['REG02']});
 expect(Object.keys(CASES_R11).sort()).toEqual(Object.values(GATES_R11).flat().sort());
 for(const [id,c] of Object.entries(CASES_R11) as [string,{suites?:string[]}][])for(const s of c.suites??[])expect(SUITES_R11.some((x:{id:string})=>x.id===s),`${id}:${s}`).toBe(true);
 expect(CASES_R11.REG02).toMatchObject({r1Record:true,irsimRecord:true,mockRegression:true});
 for(const s of SUITES_R11.filter((x:{kind:string})=>x.kind==='playwright'))expect(s.command.filter((a:string)=>a.endsWith('.spec.ts'))).toHaveLength(1);
 expect(Object.keys(GATES).length).toBe(6); // the R1 table is untouched
});

test('r1.1 qualify: all green is tested and never accepted; a skipped suite is not_run; without the Lab INT13 is not_run',()=>{
 const q=qualifyR11(base11());
 for(const g of Object.keys(GATES_R11))expect(q.gates[g]).toMatchObject({status:'tested',accepted:false});
 expect(q.notRun).toEqual([]);
 const skipped=qualifyR11(base11({suites:allSuites11(id=>id==='arm-faults')}));
 expect(skipped.cases.WA06.status).toBe('not_run');expect(skipped.cases.WA06.reason).toMatch(/suite arm-faults not_run \(2 skipped\)/);expect(skipped.gates['G-WA2'].status).toBe('not_run');
 expect(skipped.cases.INT14.status).toBe('not_run'); // the flag-off and admission tests are in that suite too
 expect(qualifyR11(base11({lab:false})).cases.INT13.status).toBe('not_run');
 expect(qualifyR11(base11({suites:allSuites11().filter((s:{id:string})=>s.id!=='arm-worker')})).gates['G-WA1'].status).toBe('not_run');
});

test('r1.1 REG02: not_run when the R1 record is of another commit or missing, failed when an R1 gate is not tested, and the IR-SIM and mock records are held to the same commit',()=>{
 expect(qualifyR11(base11()).cases.REG02.status).toBe('tested');
 const other=qualifyR11(base11({r1:r1Record({identity:{before:{sourceCommit:'e'.repeat(40)}}})}));expect(other.cases.REG02.status).toBe('not_run');expect(other.cases.REG02.reason).toMatch(/R1 record is of another commit/);
 expect(qualifyR11(base11({r1:null})).cases.REG02.status).toBe('not_run');
 const half=r1Record();half.gates['G-WB2'].status='not_run';const failed=qualifyR11(base11({r1:half}));expect(failed.cases.REG02.status).toBe('failed');expect(failed.cases.REG02.reason).toMatch(/G-WB2/);
 expect(qualifyR11(base11({irsim:irsimRecord({identity:{before:{sourceCommit:'e'.repeat(40)}}})})).cases.REG02.status).toBe('not_run');
 expect(qualifyR11(base11({mock:mockManifest({commands:[{id:'x',exitCode:1}]})})).cases.REG02.status).toBe('failed');
 expect(qualifyR11(base11({mock:null})).cases.REG02.status).toBe('not_run');
 expect(qualifyR11(base11({r1:r1Record({release:'r1.1'})})).cases.REG02.status).toBe('not_run'); // an R1.1 record is not the R1 record
 expect(checkR1Record(r1Record(),COMMIT)).toEqual([]);
 expect(checkR1Record(r1Record({accepted:true}),COMMIT).join()).toMatch(/R1_RECORD_ACCEPTED/);
 expect(checkR1Record(half,COMMIT).join()).toMatch(/R1_GATE_NOT_TESTED:G-WB2/);
});

test('r1.1 guard: a complete record has no reasons; accepted:true, a missing result file, a campaign, another commit and a foreign R1 gate are each named; the R1 table still checks as R1',()=>{
 expect(checkQualification(candidate11().m,candidate11().read)).toEqual([]);
 const one=(over:(m:M,files:Map<string,string>)=>void,re:RegExp)=>{const c=candidate11(over);expect(checkQualification(c.m,c.read).join(' | ')).toMatch(re);};
 one(m=>{m.accepted=true;},/ACCEPTED_WITHOUT_REVIEWER/);
 one(m=>{m.gates['G-WA1'].accepted=true;},/GATE_ACCEPTED:G-WA1/);
 one(m=>{m.gates['G-WB1']={status:'tested',accepted:false,cases:[]};},/FOREIGN_GATE:G-WB1/);
 one(m=>{delete m.suites.find((s:{id:string})=>s.id==='arm-bv01').result;},/SUITE_RESULT_MISSING:arm-bv01/);
 one(m=>{m.suites=m.suites.filter((s:{id:string})=>s.id!=='arm-worker');},/SUITE_MISSING:arm-worker/);
 one(m=>{m.suites.find((s:{id:string})=>s.id==='arm-faults').result.summary={passed:1,failed:0,skipped:1,total:2};},/SUITE_SKIPPED:arm-faults/);
 one(m=>{m.campaign={summary:null};},/CAMPAIGN_NOT_EXPECTED/);
 one(m=>{m.r1Record=undefined;},/R1_RECORD_MISSING/);
 one((m,f)=>{const t=JSON.stringify(r1Record({identity:{before:{sourceCommit:'e'.repeat(40)}}}));f.set('r1-record.json',t);m.r1Record.sha256=sha(t);const a=m.artifacts.find((x:M)=>x.file==='r1-record.json');a.sha256=sha(t);a.bytes=Buffer.byteLength(t);},/R1_RECORD_COMMIT/);
 one((m,f)=>{const t=JSON.stringify(irsimRecord({note:'another record of the same commit'})),a=m.artifacts.find((x:M)=>x.file==='irsim-record.json');f.set('irsim-record.json',t);m.irsimRecord.sha256=sha(t);a.sha256=sha(t);a.bytes=Buffer.byteLength(t);},/IRSIM_RECORD_NOT_THE_R1_ONE/);
 one(m=>{m.lab.pin.sourceCommit='e'.repeat(40);},/LAB_PIN_MISMATCH/);
 one(m=>{m.cases.REG02.status='not_run';m.cases.REG02.reason='x';},/CASE_STATUS_MISMATCH:REG02/);
 const r1=candidate(),r1Reasons=checkQualification(r1.m,r1.read) as string[];expect(r1Reasons).toEqual([]);
});

// ---- Release R2a (Q01): the r2a table of spec 2026-11-12-realistic-arm-web-ui-design.md §6.4, REG03, G-CLOUD1, --blocked and the guard ----
const R2A=async()=>Q as M;
const LAB_ROOT='../lab',CASE_IDS_R2A=['MA01','MA02','MA03','MA04','MA05','MA06','MA07','MA08','RT01','RT02','RT03','RT04','RT05','CL01','UI01','UI02','UI03','UI04','UI05','INT15','INT16','REG03'];
const r11Record=(over:M={})=>({schemaVersion:1,documentType:'sim-extension-qualification',release:'r1.1',accepted:false,identity:{before:{sourceCommit:COMMIT}},lab:{commit:LABC},
 r1Record:{file:'r1-record.json',sha256:sha(JSON.stringify(r1Record()))},irsimRecord:{file:'irsim-record.json',sha256:sha(JSON.stringify(irsimRecord()))},mockRegression:{file:'mock-regression.json',sha256:sha(JSON.stringify(mockManifest()))},
 gates:Object.fromEntries(Object.keys(GATES_R11).map(g=>[g,{status:'tested',accepted:false,cases:[]}])),...over});
const SPIKE_PASS='- **Kết luận: ĐẠT cả chín tiêu chí trên máy này**',SPIKE_FAIL='- **Kết luận: TRƯỢT tiêu chí 4**';
const allSuites2a=(suites:{id:string}[],skip:(id:string)=>boolean=()=>false)=>suites.map(s=>({id:s.id,exitCode:0,result:{summary:skip(s.id)?{passed:0,failed:0,skipped:2,total:2}:pass}}));
const base2a=async(over:M={})=>{const q=await R2A();return {suites:allSuites2a(q.SUITES_R2A),lab:true,sourceCommit:COMMIT,r11:r11Record(),r1:r1Record(),irsim:irsimRecord(),mock:mockManifest(),...over};};

async function candidate2a(over:(m:M,files:Map<string,string>)=>void=()=>{},opts:{blocked?:{gates:string[];reason:string;spike:string}}={}){
 const q=await R2A(),table=q.tableR2a(opts.blocked?.gates??[]);
 const files=new Map<string,string>(),put=(p:string,t:string)=>{files.set(p,t);return {file:p,sha256:sha(t),bytes:Buffer.byteLength(t)};};
 const irs=put('irsim-record.json',JSON.stringify(irsimRecord())),mock=put('mock-regression.json',JSON.stringify(mockManifest())),r1=put('r1-record.json',JSON.stringify(r1Record()));
 const r11=put('r11-record.json',JSON.stringify(r11Record({r1Record:{file:'r1-record.json',sha256:r1.sha256},irsimRecord:{file:'irsim-record.json',sha256:irs.sha256},mockRegression:{file:'mock-regression.json',sha256:mock.sha256}})));
 const spike=opts.blocked?put('spike-note.md',opts.blocked.spike):null;
 const suites=table.suites.map((s:{id:string;kind:string;repo:string})=>{const result=put(`suites/${s.id}.json`,resultText(s.kind,pass));const log=put(`suites/${s.id}.log`,'ok');return {id:s.id,exitCode:0,command:'x',startedAt:'t',finishedAt:'t',log:log.file,logSha256:log.sha256,repo:s.repo,kind:s.kind,result:{file:result.file,sha256:result.sha256,summary:pass}};});
 const blocked=opts.blocked?{gates:opts.blocked.gates,reason:opts.blocked.reason,spikeNote:{file:spike!.file,sha256:spike!.sha256}}:null;
 const before={sourceCommit:COMMIT,dirty:false,toolClosures:{portable:HEX,native:HEX2},node:'v24.22.2',os:'darwin',arch:'arm64',lockSha256:HEX,oracleProfileDigest:HEX,at:'t'};
 const qq=q.qualifyR2a({suites,lab:true,sourceCommit:COMMIT,r11:JSON.parse(files.get('r11-record.json')!),r1:r1Record(),irsim:irsimRecord(),mock:mockManifest(),blocked});
 const m:M={schemaVersion:1,documentType:'sim-extension-qualification',release:'r2a',candidateId:'r2a-candidate-01',accepted:false,acceptedBy:null,acceptedAt:null,note:'evidence input',
  identity:{before,after:structuredClone(before),identityStable:true},lab:{commit:'d'.repeat(40),dirty:false,pin:{sourceCommit:COMMIT,artifactSha256:HEX,portableToolsDigest:HEX,schemaHash:HEX}},campaign:null,
  r11Record:{file:r11.file,sha256:r11.sha256,candidate:'r11-candidate-03'},r1Record:{file:r1.file,sha256:r1.sha256,candidate:'r1-candidate-06'},irsimRecord:{file:irs.file,sha256:irs.sha256,candidate:'candidate-08'},mockRegression:{file:mock.file,sha256:mock.sha256},
  ...blocked?{blocked}:{},
  suites,commands:[{id:'licenses',exitCode:0}],cases:qq.cases,gates:qq.gates,notRun:qq.notRun,artifacts:[...files.keys()].sort().map(p=>({file:p,sha256:sha(files.get(p)!),bytes:Buffer.byteLength(files.get(p)!)}))};
 over(m,files);
 return {m,read:(p:string)=>files.has(p)?Buffer.from(files.get(p)!):null};
}
const reseal=(m:M,f:Map<string,string>,file:string,t:string)=>{f.set(file,t);const a=m.artifacts.find((x:M)=>x.file===file);a.sha256=sha(t);a.bytes=Buffer.byteLength(t);return sha(t);};

test('r2a mapping: the brief\'s eight gates, every case of spec §6.4 on exactly one gate, every suite named exists as files, one spec per launcher run',async()=>{
 const q=await R2A();
 expect(q.GATES_R2A).toEqual({'G-MA1':['MA01','MA02','MA03'],'G-MA2':['MA04','MA05','MA06','MA07','MA08'],'G-RT1':['RT01','RT02','RT03','RT04'],'G-RT2':['RT05'],
  'G-UI1':['UI01','UI02','UI03','UI04'],'G-INT4':['UI05','INT15','INT16'],'G-REG3':['REG03'],'G-CLOUD1':['CL01']});
 expect(Object.keys(q.CASES_R2A).sort()).toEqual([...CASE_IDS_R2A].sort());
 expect(Object.values(q.GATES_R2A).flat().sort()).toEqual([...CASE_IDS_R2A].sort());
 expect(q.PART_A_GATES).toEqual(['G-MA1','G-MA2','G-RT2','G-INT4']);
 for(const [id,c] of Object.entries(q.CASES_R2A) as [string,{suites?:string[]}][])for(const s of c.suites??[])expect(q.SUITES_R2A.some((x:{id:string})=>x.id===s),`${id}:${s}`).toBe(true);
 for(const s of q.SUITES_R2A as {id:string;repo:string;files?:string[];command?:string[]}[]){
  const r=s.repo==='lab'?LAB_ROOT:'.';if(s.repo==='lab'&&!existsSync(LAB_ROOT))continue;
  for(const f of s.files??[])expect(existsSync(join(r,f)),`${s.id}: ${f}`).toBe(true);
  const specs=(s.command??[]).filter(a=>a.endsWith('.spec.ts'));if(s.command){expect(specs,s.id).toHaveLength(1);expect(existsSync(join(r,'tests/e2e',specs[0]!)),`${s.id}: ${specs[0]}`).toBe(true);}
 }
 // every suite serves at least one case: nothing is run that proves nothing
 for(const s of q.SUITES_R2A)expect((Object.values(q.CASES_R2A) as M[]).some(c=>(c.suites??[]).includes(s.id)),s.id).toBe(true);
 expect(q.CASES_R2A.MA06.note).toMatch(/lift check/);expect(q.CASES_R2A.MA06.note).toMatch(/never commanded open/);
 expect(q.CASES_R2A.REG03).toMatchObject({r11Record:true,r1Record:true,irsimRecord:true,mockRegression:true});
 expect(q.CASES_R2A.RT05.suites).toEqual(['rt-container']);
 expect(Object.keys(GATES).length).toBe(6);expect(Object.keys(GATES_R11).length).toBe(4); // the R1 and R1.1 tables are untouched
});

test('r2a qualify: all green is tested except G-CLOUD1, which is blocked_external without a CL01 result; a skipped suite is not_run; nothing is accepted',async()=>{
 const q=await R2A(),r=q.qualifyR2a(await base2a());
 for(const g of Object.keys(q.GATES_R2A).filter(g=>g!=='G-CLOUD1'))expect(r.gates[g],g).toMatchObject({status:'tested',accepted:false});
 expect(r.gates['G-CLOUD1']).toMatchObject({status:'blocked_external',accepted:false});
 expect(r.cases.CL01).toMatchObject({status:'not_run',reason:expect.stringMatching(/^blocked_external/)});
 expect(r.notRun.map((n:{id:string})=>n.id)).toEqual(['CL01']);
 const skipped=q.qualifyR2a(await base2a({suites:allSuites2a(q.SUITES_R2A,id=>id==='rt-container')}));
 expect(skipped.cases.RT05.status).toBe('not_run');expect(skipped.gates['G-RT2'].status).toBe('not_run');expect(skipped.gates['G-MA2'].status).toBe('tested');
 expect(q.qualifyR2a(await base2a({lab:false})).cases.INT15.status).toBe('not_run');
});

test('r2a REG03: not_run when the R1.1 record is of another commit or missing, failed when an R1.1 gate is not tested; the R1, IR-SIM and mock records are held to the same commit',async()=>{
 const q=await R2A(),reg=async(over:M)=>q.qualifyR2a(await base2a(over)).cases.REG03;
 expect((await reg({})).status).toBe('tested');
 const other=await reg({r11:r11Record({identity:{before:{sourceCommit:'e'.repeat(40)}}})});expect(other.status).toBe('not_run');expect(other.reason).toMatch(/R1\.1 record is of another commit/);
 expect((await reg({r11:null})).status).toBe('not_run');
 const half=r11Record();half.gates['G-WA2'].status='not_run';const failed=await reg({r11:half});expect(failed.status).toBe('failed');expect(failed.reason).toMatch(/G-WA2/);
 expect((await reg({r11:r11Record({release:'r1'})})).status).toBe('not_run');
 expect((await reg({r1:r1Record({identity:{before:{sourceCommit:'e'.repeat(40)}}})})).status).toBe('not_run');
 expect((await reg({irsim:irsimRecord({identity:{before:{sourceCommit:'e'.repeat(40)}}})})).status).toBe('not_run');
 expect((await reg({mock:mockManifest({identity:{start:{source:{commit:'e'.repeat(40)}}}})})).status).toBe('not_run');
 expect(q.checkR11Record(r11Record(),COMMIT)).toEqual([]);
 expect(q.checkR11Record(r11Record({accepted:true}),COMMIT).join()).toMatch(/R11_RECORD_ACCEPTED/);
 expect(q.checkR11Record(half,COMMIT).join()).toMatch(/R11_GATE_NOT_TESTED:G-WA2/);
 expect(q.checkR11Record(r11Record({identity:{before:{sourceCommit:'e'.repeat(40)}}}),COMMIT).join()).toMatch(/R11_RECORD_COMMIT/);
});

test('r2a CL01: no input makes G-CLOUD1 tested; it is always blocked_external with CL01 not_run (no deployment has been ordered)',async()=>{
 const q=await R2A();
 expect(q.CL01_CHECKS).toBeUndefined();
 for(const cl01 of [undefined,null,{schema:'cl01-result/1',sourceCommit:COMMIT,checks:{health:'pass',accessKeyPairing:'pass',mjBv01Completed:'pass',streamResumed:'pass'}}]){
  const r=q.qualifyR2a(await base2a({cl01}));
  expect(r.gates['G-CLOUD1'].status).toBe('blocked_external');expect(r.cases.CL01).toMatchObject({status:'not_run',reason:expect.stringMatching(/^blocked_external: no Cloud Run deployment has been ordered/)});
 }
});

test('r2a --blocked: only part A gates, only when the spike note concludes failure, always with a reason; the real spike note concludes success, so it is refused today',async()=>{
 const q=await R2A();
 expect(q.spikeConclusion(readFileSync('docs/research/2026-11-mujoco-arm-spike.md','utf8'))).toBe('pass');
 expect(q.spikeConclusion(SPIKE_FAIL)).toBe('fail');expect(q.spikeConclusion('no conclusion')).toBeNull();
 expect(q.checkBlocked({gates:['G-RT1'],reason:'x'},SPIKE_FAIL).join()).toMatch(/BLOCKED_NOT_PART_A:G-RT1/);
 expect(q.checkBlocked({gates:['G-MA1'],reason:'x'},SPIKE_PASS).join()).toMatch(/BLOCKED_SPIKE_NOT_FAILED/);
 expect(q.checkBlocked({gates:['G-MA1'],reason:''},SPIKE_FAIL).join()).toMatch(/BLOCKED_REASON_MISSING/);
 expect(q.checkBlocked({gates:[],reason:'x'},SPIKE_FAIL).join()).toMatch(/BLOCKED_NO_GATE/);
 expect(q.checkBlocked({gates:['G-MA1','G-MA2','G-RT2','G-INT4'],reason:'M00 criterion 4 failed'},SPIKE_FAIL)).toEqual([]);
 // a blocked gate is `blocked` with its reason, its cases not_run, and the suites that serve only blocked cases are not part of the table
 const t=q.tableR2a(['G-MA1']);expect(t.cases.MA01.notRun).toMatch(/^blocked: /);
 expect(t.suites.some((s:{id:string})=>s.id==='ma-rtb')).toBe(false);expect(t.suites.some((s:{id:string})=>s.id==='ma-bv01')).toBe(true);
 const r=q.qualifyR2a({...await base2a(),suites:allSuites2a(t.suites),blocked:{gates:['G-MA1'],reason:'M00 failed'}});
 expect(r.gates['G-MA1']).toMatchObject({status:'blocked',reason:'M00 failed',accepted:false});expect(r.cases.MA02.status).toBe('not_run');expect(r.gates['G-MA2'].status).toBe('tested');
});

test('r2a recorder refuses --blocked G-RT1 and --blocked G-MA1 (the spike concludes success) before it touches anything; --plan lists the suites without running them',()=>{
 const run=(...a:string[])=>spawnSync(process.execPath,['scripts/record-sim-extension.mjs','--release','r2a','--out','/nonexistent/r2a-x','--r11-record','/nonexistent/r11','--mock-regression','/nonexistent/reg',...a],{encoding:'utf8',timeout:60000});
 const rt=run('--blocked','G-RT1','--blocked-reason','x');expect(rt.status).toBe(2);expect(rt.stderr).toMatch(/BLOCKED_NOT_PART_A:G-RT1/);
 const ma=run('--blocked','G-MA1','--blocked-reason','x');expect(ma.status).toBe(2);expect(ma.stderr).toMatch(/BLOCKED_SPIKE_NOT_FAILED/);
 const nr=run('--blocked','G-MA1');expect(nr.status).toBe(2);expect(nr.stderr).toMatch(/BLOCKED_REASON_MISSING|MISSING_OPTION:--blocked-reason/);
 const r1=spawnSync(process.execPath,['scripts/record-sim-extension.mjs','--release','r1','--out','/nonexistent/x','--irsim-record','/n','--mock-regression','/n','--blocked','G-MA1','--blocked-reason','x'],{encoding:'utf8',timeout:60000});
 expect(r1.status).toBe(2);expect(r1.stderr).toMatch(/UNKNOWN_OPTION:--blocked/);
 const cl=run('--cl01-result','/nonexistent/cl01.json');expect(cl.status).toBe(2);expect(cl.stderr).toMatch(/UNKNOWN_OPTION:--cl01-result/);
 const plan=run('--plan');expect(plan.status,plan.stderr).toBe(0);
 expect(plan.stdout).toMatch(/rt-image/);expect(plan.stdout).toMatch(/removed when the recording ends/);
 for(const id of ['docker','python-env','screen'])expect(plan.stdout,id).toMatch(new RegExp(`^preflight\\t${id}`,'m'));expect(plan.stdout).toMatch(/lab-e2e-mujoco-coffee/);expect(plan.stdout).toMatch(/test-irsim-e2e\.mjs --provider mujoco mujoco-coffee\.spec\.ts/);
 expect(existsSync('/nonexistent/r2a-x')).toBe(false);
});

test('r2a guard: a complete record has no reasons and G-CLOUD1 blocked_external does not fail it; each defect is named',async()=>{
 const c=await candidate2a();expect(checkQualification(c.m,c.read)).toEqual([]);
 expect(c.m.gates['G-CLOUD1'].status).toBe('blocked_external');
 const one=async(over:(m:M,files:Map<string,string>)=>void,re:RegExp)=>{const x=await candidate2a(over);expect(checkQualification(x.m,x.read).join(' | ')).toMatch(re);};
 await one(m=>{m.accepted=true;m.acceptedBy='someone';m.acceptedAt='t';},/RECORD_ACCEPTED/); // a record is never accepted, even with a reviewer named in it
 await one(m=>{m.gates['G-UI1'].accepted=true;},/GATE_ACCEPTED:G-UI1/);
 await one(m=>{m.gates['G-CLOUD1'].status='tested';},/GATE_STATUS_MISMATCH:G-CLOUD1/);
 await one(m=>{m.gates['G-WA1']={status:'tested',accepted:false,cases:[]};},/FOREIGN_GATE:G-WA1/);
 await one(m=>{delete m.suites.find((s:{id:string})=>s.id==='ma-bv01').result;},/SUITE_RESULT_MISSING:ma-bv01/);
 await one(m=>{m.suites=m.suites.filter((s:{id:string})=>s.id!=='rt-container');},/SUITE_MISSING:rt-container/);
 await one(m=>{m.suites.find((s:{id:string})=>s.id==='lab-e2e-mujoco-coffee').result.summary={passed:0,failed:0,skipped:1,total:1};},/SUITE_SKIPPED:lab-e2e-mujoco-coffee/);
 await one(m=>{m.campaign={summary:null};},/CAMPAIGN_NOT_EXPECTED/);
 await one(m=>{m.r11Record=undefined;},/R11_RECORD_MISSING/);
 await one((m,f)=>{m.r11Record.sha256=reseal(m,f,'r11-record.json',JSON.stringify(r11Record({identity:{before:{sourceCommit:'e'.repeat(40)}}})));},/R11_RECORD_COMMIT/);
 await one((m,f)=>{m.r1Record.sha256=reseal(m,f,'r1-record.json',JSON.stringify(r1Record({note:'another R1 record of the same commit'})));},/R1_RECORD_NOT_THE_R11_ONE/);
 await one((m,f)=>{m.irsimRecord.sha256=reseal(m,f,'irsim-record.json',JSON.stringify(irsimRecord({note:'another'})));},/IRSIM_RECORD_NOT_THE_R11_ONE/);
 await one((m,f)=>{m.mockRegression.sha256=reseal(m,f,'mock-regression.json',JSON.stringify(mockManifest({note:'another'})));},/MOCK_REGRESSION_NOT_THE_R11_ONE/);
 await one(m=>{m.lab.pin.sourceCommit='e'.repeat(40);},/LAB_PIN_MISMATCH/);
 await one(m=>{m.cases.REG03.status='not_run';m.cases.REG03.reason='x';},/CASE_STATUS_MISMATCH:REG03/);
 await one(m=>{m.cases.MA06.note='x';},/CASE_NOTE_MISSING:MA06/);
});

test('r2a guard: a blocked record is valid only with the spike note copy concluding failure; G-CLOUD1 is only ever blocked_external',async()=>{
 const ok=await candidate2a(()=>{},{blocked:{gates:['G-MA1','G-MA2','G-RT2','G-INT4'],reason:'M00 criterion 4 failed',spike:SPIKE_FAIL}});
 expect(checkQualification(ok.m,ok.read)).toEqual([]);
 expect(ok.m.gates['G-MA2']).toMatchObject({status:'blocked',reason:'M00 criterion 4 failed'});expect(ok.m.suites.some((s:{id:string})=>s.id==='ma-bv01')).toBe(false);
 const passed=await candidate2a(()=>{},{blocked:{gates:['G-MA1'],reason:'x',spike:SPIKE_PASS}});expect(checkQualification(passed.m,passed.read).join()).toMatch(/BLOCKED_SPIKE_NOT_FAILED/);
 const rt=await candidate2a(()=>{},{blocked:{gates:['G-RT1'],reason:'x',spike:SPIKE_FAIL}});expect(checkQualification(rt.m,rt.read).join()).toMatch(/BLOCKED_NOT_PART_A:G-RT1/);
 // G-CLOUD1 has no path to tested: a record claiming it, or naming a CL01 result file, is refused
 const forged=await candidate2a(m=>{m.gates['G-CLOUD1'].status='tested';m.cases.CL01={status:'tested',evidence:['record:cl01']};m.notRun=m.notRun.filter((n:{id:string})=>n.id!=='CL01');});
 expect(checkQualification(forged.m,forged.read).join()).toMatch(/CLOUD_GATE_NOT_BLOCKED_EXTERNAL/);
 const named=await candidate2a((m,f)=>{f.set('cl01-result.json','{}');m.cl01={file:'cl01-result.json',sha256:sha('{}')};});
 expect(checkQualification(named.m,named.read).join()).toMatch(/CL01_RESULT_NOT_ACCEPTED/);
});

test('the recorded r1 and r1.1 candidates in the tree still check clean (newest of each)',()=>{
 const dir='docs/implementation/evidence/sim-extension',newest=(re:RegExp)=>readdirSync(dir).filter(d=>re.test(d)).sort((a,b)=>Number(a.split('-').pop())-Number(b.split('-').pop())).at(-1);
 for(const c of [newest(/^r1-candidate-\d+$/),newest(/^r11-candidate-\d+$/)]){
  expect(c).toBeTruthy();const d=join(dir,c!),read=(p:string)=>existsSync(join(d,p))?readFileSync(join(d,p)):null;
  expect(checkQualification(JSON.parse(readFileSync(join(d,'qualification.json'),'utf8')),read),c).toEqual([]);
 }
});

test('r2a binds every input to the Lab commit of the record: each input of another Lab commit is named; r1 and r1.1 checks are unchanged',async()=>{
 const q=await R2A(),OTHER='e'.repeat(40);
 expect(q.checkLabCommits({r11:r11Record(),r1:r1Record(),irsim:irsimRecord(),mock:mockManifest()},LABC)).toEqual([]);
 expect(q.checkLabCommits({r11:r11Record({lab:{commit:OTHER}})},LABC).join()).toMatch(/R11_RECORD_LAB_COMMIT/);
 expect(q.checkLabCommits({r1:r1Record({lab:{commit:OTHER}})},LABC).join()).toMatch(/R1_RECORD_LAB_COMMIT/);
 expect(q.checkLabCommits({irsim:irsimRecord({lab:null})},LABC).join()).toMatch(/IRSIM_RECORD_LAB_COMMIT/);
 const m0=mockManifest();m0.identity.end.lab.commit=OTHER;expect(q.checkLabCommits({mock:m0},LABC).join()).toMatch(/MOCK_REGRESSION_LAB_COMMIT/);
 const m1=mockManifest();m1.identity.start.lab.commit=OTHER;expect(q.checkLabCommits({mock:m1},LABC).join()).toMatch(/MOCK_REGRESSION_LAB_COMMIT/);
 // the guard: each input re-sealed with another Lab commit (and the R1.1 record naming the new bytes) is refused with its code
 const relab=async(file:string,make:()=>M,code:RegExp)=>{const c=await candidate2a((m,f)=>{
  const t=JSON.stringify(make()),h=reseal(m,f,file,t),key={'r1-record.json':'r1Record','irsim-record.json':'irsimRecord','mock-regression.json':'mockRegression'}[file];
  if(file==='r11-record.json')m.r11Record.sha256=h;else{m[key!].sha256=h;const r11=JSON.parse(f.get('r11-record.json')!);r11[key!].sha256=h;m.r11Record.sha256=reseal(m,f,'r11-record.json',JSON.stringify(r11));}});
  expect(checkQualification(c.m,c.read).join(' | ')).toMatch(code);};
 await relab('r11-record.json',()=>{const x=JSON.parse(JSON.stringify(r11Record()));return {...x,lab:{commit:OTHER}};},/R11_RECORD_LAB_COMMIT/);
 await relab('r1-record.json',()=>r1Record({lab:{commit:OTHER}}),/R1_RECORD_LAB_COMMIT/);
 await relab('irsim-record.json',()=>irsimRecord({lab:{commit:OTHER}}),/IRSIM_RECORD_LAB_COMMIT/);
 await relab('mock-regression.json',()=>{const x=mockManifest();x.identity.start.lab.commit=OTHER;x.identity.end.lab.commit=OTHER;return x;},/MOCK_REGRESSION_LAB_COMMIT/);
 const c=await candidate2a(m=>{m.lab.commit=OTHER;});expect(checkQualification(c.m,c.read).join(' | ')).toMatch(/R11_RECORD_LAB_COMMIT/);
});

test('r2a checkR11Record compares the gate names with the R1.1 table, not only their number',async()=>{
 const q=await R2A(),x=r11Record({gates:Object.fromEntries(['G-A','G-B','G-C','G-D'].map(g=>[g,{status:'tested',accepted:false}]))});
 expect(q.checkR11Record(x,COMMIT).join()).toMatch(/R11_RECORD_GATES/);
});

test('pre-flight: refuses early what would fail later, from injected probe results; nothing is refused when every probe is good',async()=>{
 const q=await R2A(),suites=q.SUITES_R2A,ok={docker:()=>true,exists:()=>true,screenLocked:()=>false,platform:'darwin'};
 const codes=(release:string,s:M[],probes:M)=>q.preflight({release,suites:s},{...ok,...probes}).filter((c:M)=>!c.ok).map((c:M)=>c.code);
 expect(codes('r2a',suites,{})).toEqual([]);
 expect(codes('r2a',suites,{docker:()=>false})).toEqual(['DOCKER_UNAVAILABLE']);
 expect(codes('r1.1',SUITES_R11,{docker:()=>false})).toEqual([]); // no container suite there
 expect(codes('r2a',suites,{exists:(p:string)=>!p.startsWith('.venv-mujoco')})).toEqual(['PYTHON_ENV_MISSING:.venv-mujoco']);
 expect(codes('r1',SUITES,{exists:(p:string)=>!p.startsWith('.venv-algorithm')})).toEqual(['PYTHON_ENV_MISSING:.venv-algorithm']);
 expect(codes('r2a',suites,{screenLocked:()=>true})).toEqual(['SCREEN_LOCKED']);
 expect(codes('r2a',suites,{screenLocked:()=>true,platform:'linux'})).toEqual([]);
 expect(codes('r2a',suites.filter((s:{id:string})=>!s.id.includes('webots')),{screenLocked:()=>true})).toEqual([]); // nothing starts the Webots application
 expect(codes('r1',SUITES,{screenLocked:()=>true})).toEqual(['SCREEN_LOCKED']); // the campaign starts Webots
 const locked=q.preflight({release:'r2a',suites},{...ok,screenLocked:()=>true}).find((c:M)=>c.code==='SCREEN_LOCKED');expect(locked.message).toMatch(/unlock the screen.*caffeinate -dims/);
 expect(q.screenLockedFromIoreg('<key>CGSSessionScreenIsLocked</key>\n\t\t<true/>')).toBe(true);
 expect(q.screenLockedFromIoreg('<key>CGSSessionOnConsoleKey</key><true/>')).toBe(false);
});
