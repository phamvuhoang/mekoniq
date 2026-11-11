// R1 qualification (sim-extension-qualification/1): the case/gate table of spec §6.3 and the fail-closed record check, on synthetic records. The live directory is
// checked by tests/acceptance/sim-extension.acceptance.test.ts. `tested` is never `accepted`; a skipped test is not_run; a record never carries an accepted gate.
import {expect,test} from 'vitest';
import {createHash} from 'node:crypto';
import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
// @ts-expect-error plain ESM script without types
import {CASES,GATES,SUITES,CASES_R11,GATES_R11,SUITES_R11,checkIrsimRecord,checkR1Record,checkQualification,qualify,qualifyR11} from '../../scripts/sim-extension-qualification.mjs';
// @ts-expect-error plain ESM script without types
import * as ir from '../../scripts/irsim-qualification.mjs';
type M=Record<string,any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const HEX='a'.repeat(64),HEX2='b'.repeat(64),COMMIT='c'.repeat(40),pass={passed:3,failed:0,skipped:0,total:3};
const ALG=['ALG01','ALG02','ALG03','ALG05','PID01','PID02','PID03'];
const RUNS=['WB-FD01','WB-FD07','WB-FD01-cancel','WB-FD01-enginekill'];
const campaignSummary=(over:M={})=>({status:'completed',complete:true,evidenceComplete:false,provider:{id:'webots_3d',kind:'webots_engine'},campaignSha256:sha('{"c":1}'),sourceCommit:COMMIT,
 runs:RUNS.map((scenarioId,i)=>({id:`${String(i+1).padStart(3,'0')}-${scenarioId}`,scenarioId,result:'pass',reasons:[]})),...over});
const irsimRecord=(over:M={})=>({schemaVersion:1,documentType:'linkforge-irsim-qualification',accepted:false,identity:{before:{sourceCommit:COMMIT}},gates:Object.fromEntries(['G-LF1','G-LF2','G-IR1','G-IR2','G-IR3','G-INT1'].map(g=>[g,{status:'tested',accepted:false}])),...over});
const mockManifest=(over:M={})=>({schema:'lab-v2-regression/1',identity:{start:{source:{commit:COMMIT}}},commands:[{id:'x',exitCode:0}],notRun:[],...over});
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
const r1Record=(over:M={})=>({schemaVersion:1,documentType:'sim-extension-qualification',release:'r1',accepted:false,identity:{before:{sourceCommit:COMMIT}},
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
