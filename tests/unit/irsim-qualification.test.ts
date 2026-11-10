// C03: the qualification manifest (linkforge-irsim-qualification/1) that record-irsim writes and the acceptance guard reads share one module. These tests pin
// the case/gate mapping of verification.md §3 and the guard's fail-closed checks on synthetic manifests; the live directory is checked by tests/acceptance.
import {expect,test} from 'vitest';
import {createHash} from 'node:crypto';
// @ts-expect-error plain ESM script without types
import {CASES,GATES,SUITES,bytecodeUnder,checkQualification,qualify} from '../../scripts/irsim-qualification.mjs';
type Manifest=Record<string,any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const HEX='a'.repeat(64),HEX2='b'.repeat(64),COMMIT='c'.repeat(40);
const pass={passed:3,failed:0,skipped:0,total:3};
const allSuites=()=>SUITES.map((s:{id:string})=>({id:s.id,exitCode:0,summary:pass}));
const campaignSummary=(over:Manifest={})=>({status:'completed',complete:true,evidenceComplete:false,provider:{kind:'irsim_worker'},campaignSha256:sha('{"c":1}'),sourceCommit:COMMIT,
 runs:['IR-FD01','IR-FD03','IR-FD04','IR-FD04-blocked','IR-FD07','IR-RIG-ZONE','IR-FD01-cancel','IR-FD01-workerkill','IR-RAW-PAIR-CONTACT'].map((scenarioId,i)=>({id:`${String(i+1).padStart(3,'0')}-${scenarioId}`,scenarioId,result:'pass',repeat:1})),...over});

test('mapping: every verification case of the plan has evidence or an explicit not_run, every gate names only cases, and no legacy gate id is present',()=>{
 const ids=['LF01','LF02','LF03','LF04','LF05','LF06','CMP01','CMP02','CMP03','CMP04','CMP05','IR01','IR02','IR03','IR04','IR05','IR06','IR07','IR08','IR09','IR10','SEN01','SEN02','EVI01','EVI02','EVI03','INT01','INT02','INT03','INT04'];
 expect(Object.keys(CASES).sort()).toEqual([...ids].sort());
 expect(Object.keys(GATES).sort()).toEqual(['G-INT1','G-IR1','G-IR2','G-IR3','G-LF1','G-LF2']);
 for(const [gate,cases] of Object.entries(GATES) as [string,string[]][])for(const c of cases)expect(CASES[c],`${gate}:${c}`).toBeTruthy();
 // IR07: the spec accepts the independent swept oracle; the plant's 0.5 m/s cap cannot produce the trigger, so the case is the oracle test in suite ir with that note
 expect(CASES.IR07.notRun).toBeUndefined();expect(CASES.IR07.suites).toEqual(['ir']);expect(CASES.IR07.note).toMatch(/swept.*0\.5 m\/s|0\.5 m\/s.*swept/);
 for(const s of SUITES)expect(s.id&&s.repo&&(s.files?.length||s.command?.length),s.id).toBeTruthy();
});

test('qualify: a case is tested only when every campaign case it names passed and every suite it names ran green; one missing suite or failed run makes it (and its gate) not_run, never pass',()=>{
 const q=qualify({campaign:campaignSummary(),suites:allSuites(),lab:true});
 expect(q.cases.IR01).toMatchObject({status:'tested',evidence:expect.arrayContaining(['campaign:IR-FD01','suite:ir'])});
 expect(q.cases.IR04).toMatchObject({status:'tested',note:expect.stringMatching(/rig|serialized/)});
 expect(q.cases.IR07).toMatchObject({status:'tested',evidence:['suite:ir'],note:expect.stringMatching(/swept/)});
 expect(q.gates['G-IR3']).toMatchObject({status:'tested',accepted:false,cases:expect.arrayContaining(['IR07'])});
 expect(q.gates['G-IR1']).toEqual({status:'tested',accepted:false,cases:['IR01']});
 expect(q.gates['G-INT1'].status).toBe('tested');
 const noLab=qualify({campaign:campaignSummary(),suites:allSuites().filter((s:{id:string})=>!s.id.startsWith('lab')),lab:false});
 expect(noLab.cases.INT01.status).toBe('not_run');expect(noLab.gates['G-INT1'].status).toBe('not_run');
 const failed=qualify({campaign:campaignSummary({complete:false,runs:campaignSummary().runs.map(r=>r.scenarioId==='IR-FD03'?{...r,result:'fail'}:r)}),suites:allSuites(),lab:true});
 expect(failed.cases.IR02.status).toBe('failed');expect(failed.cases.IR01.status).toBe('tested');expect(failed.gates['G-IR3'].status).toBe('not_run');
 const broken=qualify({campaign:campaignSummary(),suites:allSuites().map((s:{id:string})=>s.id==='lf'?{...s,exitCode:1,summary:{...pass,failed:1}}:s),lab:true});
 expect(broken.cases.LF01.status).toBe('failed');expect(broken.gates['G-LF1'].status).toBe('not_run');
 expect(qualify({campaign:null,suites:[],lab:false}).cases.IR01).toMatchObject({status:'not_run'});
});

const resultText=(kind:string,s:{passed:number;failed:number;skipped:number;total:number})=>kind==='pytest'?`<testsuite tests="${s.total}" failures="${s.failed}" errors="0" skipped="${s.skipped}"/>`:kind==='vitest'?JSON.stringify({numPassedTests:s.passed,numFailedTests:s.failed,numPendingTests:s.skipped,numTotalTests:s.total}):JSON.stringify({stats:{expected:s.passed,unexpected:s.failed,skipped:s.skipped}});
/** A complete, consistent candidate directory in memory: `files` maps relative paths to text. */
function candidate(over:(m:Manifest,files:Map<string,string>)=>void=()=>{}){
 const files=new Map<string,string>(),put=(p:string,t:string)=>{files.set(p,t);return {file:p,sha256:sha(t),bytes:Buffer.byteLength(t)};};
 const summary=campaignSummary(),summaryText=JSON.stringify(summary);
 put('campaign/campaign.json','{"c":1}');const summaryRef=put('campaign/summary.json',summaryText);
 for(const r of summary.runs){put(`campaign/runs/${r.id}/run.json`,JSON.stringify({id:r.id,result:'pass',evidenceAsExpected:true,evidenceComplete:r.scenarioId!=='IR-FD01-workerkill'}));
  if(r.scenarioId!=='IR-RAW-PAIR-CONTACT')put(`campaign/runs/${r.id}/report.json`,JSON.stringify({metrics:{navigation:{sensorPublications:{complete:r.scenarioId!=='IR-FD01-workerkill'}}}}));}
 put('campaign/identity.json',JSON.stringify({stable:true}));
 const suites=SUITES.map((s:{id:string;kind:string})=>{const result=put(`suites/${s.id}.json`,resultText(s.kind,pass));const log=put(`suites/${s.id}.log`,'ok');return {id:s.id,exitCode:0,command:'x',startedAt:'t',finishedAt:'t',log:log.file,logSha256:log.sha256,result:{...result,summary:pass}};});
 const before={sourceCommit:COMMIT,dirty:false,toolClosures:{portable:HEX,native:HEX2},node:'v24.22.2',os:'darwin',arch:'arm64',lockSha256:HEX,at:'t'};
 const q=qualify({campaign:summary,suites,lab:true});
 const m:Manifest={schemaVersion:1,documentType:'linkforge-irsim-qualification',candidateId:'candidate-01',accepted:false,acceptedBy:null,acceptedAt:null,note:'evidence input',
  identity:{before,after:structuredClone(before),identityStable:true},lab:{commit:'d'.repeat(40),dirty:false,pin:{sourceCommit:COMMIT,artifactSha256:HEX,portableToolsDigest:HEX,schemaHash:HEX}},
  campaign:{command:'node scripts/lab-irsim.mjs run …',exitCode:0,summary:{path:'campaign/summary.json',sha256:summaryRef.sha256,status:summary.status,complete:summary.complete,runs:summary.runs.length,provider:summary.provider}},
  suites,commands:[{id:'licenses',exitCode:0},{id:'performance',exitCode:0}],cases:q.cases,gates:q.gates,notRun:q.notRun,artifacts:[...files.keys()].sort().map(p=>({file:p,sha256:sha(files.get(p)!),bytes:Buffer.byteLength(files.get(p)!)}))};
 over(m,files);
 return {m,read:(p:string)=>files.has(p)?Buffer.from(files.get(p)!):null};
}
const reasons=(c:ReturnType<typeof candidate>)=>checkQualification(c.m,c.read) as string[];

test('guard: a complete consistent candidate has no reasons; each single defect is named',()=>{
 expect(reasons(candidate())).toEqual([]);
 const one=(over:(m:Manifest,files:Map<string,string>)=>void,re:RegExp)=>{const r=reasons(candidate(over));expect(r.join(' | ')).toMatch(re);};
 one(m=>{m.campaign.summary.provider={kind:'protocol_double'};},/PROVIDER_NOT_IRSIM/);
 one((m,f)=>{f.set('campaign/summary.json',JSON.stringify({...campaignSummary(),provider:{kind:'protocol_double'}}));},/SUMMARY_CORRUPT|PROVIDER_NOT_IRSIM/);
 one(m=>{m.identity.before.dirty=true;},/SOURCE_DIRTY/);
 one(m=>{m.identity.identityStable=false;},/IDENTITY_UNSTABLE/);
 one(m=>{m.identity.after.toolClosures.portable=HEX2;},/IDENTITY_UNSTABLE|CLOSURE_CHANGED/);
 one(m=>{m.lab.pin.sourceCommit='e'.repeat(40);},/LAB_PIN_MISMATCH/);
 one(m=>{m.lab.pin.portableToolsDigest=HEX2;},/LAB_PORTABLE_DIGEST_MISMATCH/);
 one(m=>{m.lab.dirty=true;},/LAB_DIRTY/);
 one(m=>{m.accepted=true;},/ACCEPTED_WITHOUT_REVIEWER/);
 one(m=>{m.gates['R-MOCK']={status:'tested',accepted:true,cases:[]};},/FOREIGN_GATE:R-MOCK/);
 one(m=>{m.gates['G-IR3'].status='not_run';},/GATE_STATUS_MISMATCH:G-IR3/);
 one(m=>{m.cases.IR07.status='not_run';m.cases.IR07.reason='x';},/CASE_STATUS_MISMATCH:IR07/);
 one(m=>{delete m.cases.IR07.note;},/CASE_NOTE_MISSING:IR07/);
 one(m=>{delete m.cases.EVI02;},/CASE_MISSING:EVI02/);
 one((m,f)=>{f.set('campaign/runs/002-IR-FD03/run.json',JSON.stringify({id:'002-IR-FD03',result:'not_run',evidenceAsExpected:false}));},/RUN_NOT_PASS:002-IR-FD03/);
 one((m,f)=>{f.set('campaign/runs/001-IR-FD01/run.json',JSON.stringify({id:'001-IR-FD01',result:'pass',evidenceAsExpected:false,evidenceComplete:false}));},/EVIDENCE_NOT_AS_EXPECTED:001-IR-FD01/);
 one((m,f)=>{f.set('campaign/runs/001-IR-FD01/report.json',JSON.stringify({metrics:{navigation:{sensorPublications:{complete:false}}}}));},/SENSOR_COVERAGE_LOST:001-IR-FD01/);
 one((m,f)=>{f.delete('campaign/runs/003-IR-FD04/run.json');},/RUN_RECORD_MISSING:003-IR-FD04|ARTIFACT_MISSING/);
 one((m,f)=>{f.set('suites/lf.log','tampered');},/ARTIFACT_CORRUPT:suites\/lf\.log/);
 one(m=>{m.suites.find((s:Manifest)=>s.id==='evi').result.summary={passed:0,failed:0,skipped:4,total:4};},/SUITE_EMPTY:evi|CASE_STATUS_MISMATCH/);
 one(m=>{m.suites.find((s:Manifest)=>s.id==='ir').exitCode=1;},/SUITE_FAILED:ir|CASE_STATUS_MISMATCH/);
 one(m=>{m.campaign.summary.complete=false;},/CAMPAIGN_INCOMPLETE|SUMMARY_CORRUPT/);
 one(m=>{m.commands=[{id:'licenses',exitCode:1}];},/COMMAND_FAILED:licenses/);
 // a record that simply left suites or the license check out must not read as a consistent (all not_run) pass
 one(m=>{m.suites=m.suites.filter((s:{id:string})=>s.id!=='int');},/SUITE_MISSING:int/);
 one(m=>{m.commands=[{id:'performance',exitCode:0}];},/COMMAND_MISSING:licenses/);
 one(m=>{m.suites.find((s:{id:string})=>s.id==='evi').result.summary={passed:3,failed:0,skipped:2,total:5};},/SUITE_SKIPPED:evi/);
 one((m,f)=>{f.set('campaign/identity.json',JSON.stringify({stable:false}));},/CLOSURE_CHANGED/);
 one((m,f)=>{f.set('campaign/campaign.json','{"c":2}');},/CAMPAIGN_CORRUPT|ARTIFACT_CORRUPT/);
});

test('bytecodeUnder lists __pycache__ directories and loose .pyc/.pyo under the given roots, and nothing else',async()=>{
    const {mkdtempSync,mkdirSync,writeFileSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const root=mkdtempSync(join(tmpdir(),'bytecode-'));
  mkdirSync(join(root,'tool/pkg/__pycache__'),{recursive:true});writeFileSync(join(root,'tool/pkg/__pycache__/a.cpython-313.pyc'),'');
  writeFileSync(join(root,'tool/pkg/a.py'),'');writeFileSync(join(root,'tool/loose.pyo'),'');mkdirSync(join(root,'other/__pycache__'),{recursive:true});
  expect(bytecodeUnder(root,['tool','missing'])).toEqual(['tool/loose.pyo','tool/pkg/__pycache__']);
});

test('every Playwright suite runs exactly one spec behind its own launcher (the pairing code is one-use)',()=>{
 for(const s of SUITES.filter((x:{kind:string})=>x.kind==='playwright'))expect((s as {command:string[]}).command.filter(a=>a.endsWith('.spec.ts'))).toHaveLength(1);
 expect(CASES.INT01.suites).toEqual(expect.arrayContaining(['lab-e2e-journey','lab-e2e-fleet']));
});

test('qualify: a suite with skipped tests is not_run for its cases (skipped is never pass), and INT03 needs the batch suite that runs two worlds at once',()=>{
 const batch=SUITES.find((s:{id:string})=>s.id==='batch') as {files:string[]}|undefined;
 expect(batch?.files).toEqual(['tests/integration/irsim-batch.test.ts']);
 expect(CASES.INT03.suites).toEqual(expect.arrayContaining(['int','batch']));
 const suites=SUITES.map((s:{id:string})=>({id:s.id,exitCode:0,result:{summary:s.id==='evi'?{passed:3,failed:0,skipped:2,total:5}:{passed:1,failed:0,skipped:0,total:1}}}));
 const q=qualify({campaign:campaignSummary(),suites,lab:true});
 expect(q.cases.EVI01.status).toBe('not_run');expect(q.cases.EVI01.reason).toMatch(/suite evi not_run \(2 skipped\)/);
 expect(q.cases.INT03.status).toBe('tested');
});
