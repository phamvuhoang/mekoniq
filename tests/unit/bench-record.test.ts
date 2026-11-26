// K05 (KSW06): a bench record from the simulated slave, written in parts, assembled, read back fail-closed. Every verdict in the record is recomputed from the
// stored traces; editing a status, a chunk or the file set is caught. Temp directories live under os.tmpdir() (run with TMPDIR outside any repository).
import {appendFileSync,cpSync,mkdtempSync,readdirSync,readFileSync,rmSync,symlinkSync,truncateSync,unlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll,afterEach,beforeAll,describe,expect,it} from 'vitest';
import {sealBench,type BenchKitV1,type BenchPolicy,type BenchRecordV1,type BenchSessionV1} from '../../packages/bench/src/contracts';
import {fakeClock} from '../../packages/bench/src/clock';
import {spawnBenchWorker,type BenchWorker} from '../../packages/bench/src/worker';
import {runCase,startBenchSession} from '../../packages/bench/src/session';
import {benchCase,trackingCase,verdictOf,type BenchCase,type CaseTrace,type CaseVerdict} from '../../packages/bench/src/cases/index';
import {readTrace,writeManifest} from '../../packages/bench/src/evidence';
import {READ_LIMITS} from '../../packages/lab-runtime/src/v2/navigation2d/evidence';
import {assembleBenchRecord,BENCH_DEVIATIONS,sessionExtra,verifyBenchRecord,writeBenchPart,type PartKind} from '../../packages/bench/src/record';
import {closuresFor} from '../../packages/bench/src/closures';
import {benchEvidence} from '../../packages/bench/src/bench-evidence';
import {deviceEvidenceLevel} from '../../packages/lab-runtime/src/engineering/electrical/profiles';
import type {DeviceProfileV1} from '../../packages/lab-runtime/src/engineering/electrical/contracts';
import {CASES_BENCH,CUTTABLE_BENCH,EXTERNAL_GATES_BENCH,GATES_BENCH,gateStatus} from '../../scripts/bench-qualification.mjs';

const PY=process.env.BENCH_PYTHON??'python3';
const dir=mkdtempSync(join(tmpdir(),'bench-record-'));
const fixture=<T>(f:string)=>JSON.parse(readFileSync(new URL(`../../robotics/${f}`,import.meta.url),'utf8')) as T;
const KIT=fixture<BenchKitV1>('bench/fixtures/kit-sim-v1.json'),POLICY=fixture<BenchPolicy>('bench/fixtures/policy-v1.json');
const PROFILE=fixture<DeviceProfileV1>('catalog/devices/blvd-krd-v1.json');
const SESSION:BenchSessionV1={schemaVersion:1,documentType:'bench-session',operator:'op',observer:null,location:'bench',startedAt:'2026-11-26T09:00:00Z',
 declarations:{estopCutsMotorPower:true,estopTestedToday:true,motorsClamped:true,shaftLoad:'bare',powerWiredBy:'An',mainsQualified:null,readManualSections:['3.2']},instruments:[]};
const SIM={velocityScale:0.8};   // 20 % low tracking: KCF02 passes, KCF03 fails on trackingToleranceRadS
const reseal=<T extends {digest:string}>(doc:T,edit:(d:T)=>void):T=>{const {digest:_,...k}=structuredClone(doc);void _;edit(k as T);return sealBench<T>(k as Omit<T,'digest'>);};
const kitOf=(sim:Record<string,unknown>)=>reseal(KIT,k=>Object.assign(k.simSlave!,sim));
let n=0;
const workers:BenchWorker[]=[];
const fresh=(name:string)=>join(dir,`${name}-${++n}`);
afterEach(async()=>{await Promise.all(workers.splice(0).map(w=>w.close()));});
afterAll(()=>rmSync(dir,{recursive:true,force:true}));

/** One session on a fresh worker: describe, scan, the cases in order; the part is written with what scan and describe returned. */
async function part(kind:PartKind,cases:BenchCase[],kit=kitOf(SIM)){
 const kitPath=join(dir,`kit-${++n}.json`);writeFileSync(kitPath,JSON.stringify(kit));
 const w=await spawnBenchWorker({role:'bus',python:PY,kitPath,bus:'sim',readOnly:false,sessionId:'r',deadlinesMs:{step:5000}});workers.push(w);
 const describe=(await w.request('describe',{},0)).result!,{scan}=await startBenchSession(w,[...new Set(cases.flatMap(c=>c.reads??[]))]);
 const ctx={worker:w,kit,policy:POLICY,clock:fakeClock(),arming:{arm:async()=>true},passed:new Set<string>(),abort:new AbortController().signal};
 const results=[];
 for(const c of cases)results.push({caseId:c.id,...await runCase(c,ctx)});
 const d=fresh(kind);await writeBenchPart(d,kind,{session:SESSION,kit,policy:POLICY,results,extra:sessionExtra(describe,scan)});
 return {d,results,describe,scan};
}
const STEP2=trackingCase([{kind:'step',amplitude:2,atTick:0}]);
let identity:Awaited<ReturnType<typeof part>>,conformance:Awaited<ReturnType<typeof part>>,out:string,record:BenchRecordV1;
beforeAll(async()=>{
 identity=await part('identity',[]);conformance=await part('conformance',[benchCase('KCF02')!,STEP2]);
 out=fresh('record');record=await assembleBenchRecord({identity:identity.d,conformance:conformance.d},out,{candidateId:'t-1',sourceCommit:'abc1234'});
},120_000);
/** A copy of the assembled record to tamper with. */
const copy=()=>{const d=fresh('tamper');cpSync(out,d,{recursive:true});return d;};
const chunk=(d:string,caseId:string)=>readdirSync(join(d,'conformance/cases',caseId)).find(f=>f.startsWith('ticks-'))!;

describe('a record from the simulated slave',()=>{
 it('reads back clean; accepted:false, G-SAFE1 and every hardware gate blocked_external, protocol_double with its bus mode',async()=>{
  expect(conformance.results.map(r=>[r.caseId,r.verdict.status])).toEqual([['KCF02','tested'],['KCF03','failed']]);
  expect(await verifyBenchRecord(out)).toEqual({ok:true,issues:[]});
  expect(record).toMatchObject({accepted:false,hardwareValidated:false,controlAuthority:false,externalGates:{'G-SAFE1':{status:'blocked_external',accepted:false}}});
  expect(record.gates['G-KID1']).toEqual({status:'blocked_external',accepted:false});expect(record.gates['G-KCF1']!.status).toBe('blocked_external');
  expect(record.host.testLevel).toBe('protocol_double');expect(record.worker.busBackend).toBe('sim');expect(record.conditions.busMode).toBe('csv');
  expect(record.host).toMatchObject({nicDriver:null,nicMacSha256:null,pysoem:null});
  expect(record.cases.KCF02).toMatchObject({status:'tested',session:'conformance'});expect(record.cases.KCF03).toMatchObject({status:'failed'});
  expect(record.cases.KID01).toMatchObject({status:'not_run',session:null,artifacts:[]});
  expect(record.devices.map(d=>d.serial)).toEqual(['SIM-0001','SIM-0002']);
  expect(record.measurements.map(m=>m.id)).toEqual(['enableDelayMs']);
  expect(JSON.parse(readFileSync(join(out,'identity/identity.json'),'utf8')).slaves.map((s:{axisId:string})=>s.axisId)).toEqual(KIT.axes.map(a=>a.axisId));
 });
 it('a stored trace round-trips: evaluate on the reloaded trace gives the live verdict',async()=>{
  for(const r of conformance.results){
   const t=await readTrace(join(out,'conformance/cases',r.caseId));
   expect(t).toEqual(JSON.parse(JSON.stringify(r.trace)));   // exact up to JSON itself (-0 is stored as 0)
   expect(benchCase(r.caseId)!.evaluate(t,kitOf(SIM),POLICY)).toEqual(r.verdict);
  }
 });
 it('benchEvidence never goes above the R5 level on a protocol_double record',()=>{
  const r5=deviceEvidenceLevel(PROFILE).level;
  expect(benchEvidence(PROFILE,record,'SIM-0001',{recordSha256:'a'.repeat(64)},'a'.repeat(64))).toBe(r5);
 });
});

describe('fail-closed readback',()=>{
 it('one byte changed in a ticks chunk: CHECKSUM_MISMATCH at that path',async()=>{
  const d=copy(),f=chunk(d,'KCF02'),p=join(d,'conformance/cases/KCF02',f),b=readFileSync(p);b[b.length>>1]^=0xff;writeFileSync(p,b);
  expect((await verifyBenchRecord(d)).issues).toContainEqual({code:'CHECKSUM_MISMATCH',path:`conformance/cases/KCF02/${f}`});
 });
 it('a chunk deleted: FILE_MISSING for it and VERDICT_NOT_REPRODUCED for its case',async()=>{
  const d=copy(),f=chunk(d,'KCF02');unlinkSync(join(d,'conformance/cases/KCF02',f));
  const r=await verifyBenchRecord(d);
  expect(r.ok).toBe(false);expect(r.issues).toContainEqual({code:'FILE_MISSING',path:`conformance/cases/KCF02/${f}`});expect(r.issues).toContainEqual({code:'VERDICT_NOT_REPRODUCED',path:'/cases/KCF02'});
 });
 it('a file added: FILE_UNEXPECTED',async()=>{
  const d=copy();writeFileSync(join(d,'notes.txt'),'x');
  expect((await verifyBenchRecord(d)).issues).toEqual([{code:'FILE_UNEXPECTED',path:'notes.txt'}]);
 });
 it('KCF03 edited to tested and the manifest recomputed: VERDICT_NOT_REPRODUCED (the verdict comes from the trace, not the JSON)',async()=>{
  const d=copy(),p=join(d,'bench-record.json'),r=JSON.parse(readFileSync(p,'utf8')) as BenchRecordV1;
  r.cases.KCF03={...r.cases.KCF03!,status:'tested',reason:null};writeFileSync(p,JSON.stringify(r));await writeManifest(d);
  expect(await verifyBenchRecord(d)).toEqual({ok:false,issues:[{code:'VERDICT_NOT_REPRODUCED',path:'/cases/KCF03'}]});
 });
 it('a measurement or a gate edited, the manifest recomputed: GATE_TABLE_MISMATCH',async()=>{
  for(const edit of [(r:BenchRecordV1)=>{r.measurements[0]!.value=1;},(r:BenchRecordV1)=>{r.gates['G-KSW1']={status:'tested',accepted:false};},(r:BenchRecordV1)=>{delete r.gates['G-KSN1'];}]){
   const d=copy(),p=join(d,'bench-record.json'),r=JSON.parse(readFileSync(p,'utf8')) as BenchRecordV1;edit(r);writeFileSync(p,JSON.stringify(r));await writeManifest(d);
   expect((await verifyBenchRecord(d)).issues.map(i=>i.code)).toEqual(['GATE_TABLE_MISMATCH']);
  }
 });
 it('the record says hardware, or a part was dropped: refused',async()=>{
  const d=copy(),p=join(d,'bench-record.json'),r=JSON.parse(readFileSync(p,'utf8')) as BenchRecordV1;
  r.host.testLevel='hardware';r.worker.busBackend='soem';writeFileSync(p,JSON.stringify(r));await writeManifest(d);
  expect((await verifyBenchRecord(d)).issues.map(i=>i.code)).toContain('RECORD_SCHEMA_INVALID');
  const e=copy();rmSync(join(e,'conformance'),{recursive:true});await writeManifest(e);
  const codes=(await verifyBenchRecord(e)).issues.map(i=>i.code);
  expect(codes).toContain('PART_MANIFEST_MISMATCH');expect(codes).toContain('VERDICT_NOT_REPRODUCED');
 });
 it('a part whose own manifest no longer matches its files: PART_MANIFEST_MISMATCH',async()=>{
  const d=copy();appendFileSync(join(d,'conformance/session.json'),' ');await writeManifest(d);
  expect((await verifyBenchRecord(d)).issues).toContainEqual({code:'PART_MANIFEST_MISMATCH',path:'conformance/session.json'});
 });
 it('deviations are the fixed list of spec B1 §5.4 in every record; edited or emptied: GATE_TABLE_MISMATCH',async()=>{
  expect(record.deviations).toEqual(BENCH_DEVIATIONS);expect(BENCH_DEVIATIONS.map(x=>x.id)).toHaveLength(5);
  for(const edit of [(r:BenchRecordV1)=>{r.deviations=[];},(r:BenchRecordV1)=>{r.deviations[0]!.text='the bench is the same as the virtual drive';}]){
   const d=copy(),p=join(d,'bench-record.json'),r=JSON.parse(readFileSync(p,'utf8')) as BenchRecordV1;edit(r);writeFileSync(p,JSON.stringify(r));await writeManifest(d);
   expect((await verifyBenchRecord(d)).issues).toEqual([{code:'GATE_TABLE_MISMATCH',path:'/deviations'}]);
  }
 });
});

describe('a hostile record directory: verify returns issues, never throws, never follows a link',()=>{
 /** verify must resolve, not reject */
 const issuesOf=async(d:string)=>{const r=await verifyBenchRecord(d);expect(r.ok).toBe(false);return r.issues;};
 it('a symlink to a file outside the record: FILE_UNEXPECTED',async()=>{
  const d=copy();symlinkSync('/etc/hosts',join(d,'conformance/hosts'));
  expect(await issuesOf(d)).toContainEqual({code:'FILE_UNEXPECTED',path:'conformance/hosts'});
 });
 it('a symlink to a directory: FILE_UNEXPECTED, not descended into',async()=>{
  const d=copy();symlinkSync('/etc',join(d,'etc'));
  expect(await issuesOf(d)).toEqual([{code:'FILE_UNEXPECTED',path:'etc'}]);
 });
 it('a part directory replaced by a symlink to a copy of itself: FILE_UNEXPECTED, the part is not read',async()=>{
  const d=copy(),twin=fresh('twin');cpSync(join(d,'conformance'),twin,{recursive:true});rmSync(join(d,'conformance'),{recursive:true});symlinkSync(twin,join(d,'conformance'));
  const issues=await issuesOf(d);
  expect(issues).toContainEqual({code:'FILE_UNEXPECTED',path:'conformance'});expect(issues).toContainEqual({code:'VERDICT_NOT_REPRODUCED',path:'/cases/KCF02'});
 });
 it('a malformed part manifest: RECORD_SCHEMA_INVALID',async()=>{
  const d=copy();writeFileSync(join(d,'conformance/manifest.json'),'{"files":');await writeManifest(d);
  expect(await issuesOf(d)).toContainEqual({code:'RECORD_SCHEMA_INVALID',path:'conformance/manifest.json'});
 });
 it('files:[null] in the record manifest: RECORD_SCHEMA_INVALID',async()=>{
  const d=copy();writeFileSync(join(d,'manifest.json'),JSON.stringify({hashAlgorithm:'sha256',files:[null]}));
  expect(await issuesOf(d)).toEqual([{code:'RECORD_SCHEMA_INVALID',path:'manifest.json'}]);
 });
 it('slaves:[null] in identity.json: RECORD_SCHEMA_INVALID',async()=>{
  const d=copy(),p=join(d,'identity/identity.json'),x=JSON.parse(readFileSync(p,'utf8'));x.slaves=[null];writeFileSync(p,JSON.stringify(x));await writeManifest(d);
  expect(await issuesOf(d)).toContainEqual({code:'RECORD_SCHEMA_INVALID',path:'identity/identity.json'});
 });
 it('a listed file larger than the per-file limit: SIZE_MISMATCH without reading it (sparse file)',async()=>{
  const d=copy(),bytes=READ_LIMITS.chunkBytes+1;writeFileSync(join(d,'big.bin'),'');truncateSync(join(d,'big.bin'),bytes);
  const m=JSON.parse(readFileSync(join(d,'manifest.json'),'utf8'));m.files.push({path:'big.bin',sha256:'0'.repeat(64),bytes});writeFileSync(join(d,'manifest.json'),JSON.stringify(m));
  expect(await issuesOf(d)).toContainEqual({code:'SIZE_MISMATCH',path:'big.bin'});
 });
});

describe('a case in several parts (a measurement session re-runs KCF02)',()=>{
 /** A measure part holding only KCF02 with a runner verdict (an abort), on the same kit, policy and serials as the conformance part. */
 async function abortedKcf02(){
  const d=fresh('measure'),kit=kitOf(SIM),trace:CaseTrace={ticks:[],cycles:[],prompts:[],meta:{runner:{status:'failed',reason:'OPERATOR_ABORT'}}};
  await writeBenchPart(d,'measure',{session:SESSION,kit,policy:POLICY,results:[{caseId:'KCF02',trace,verdict:verdictOf(benchCase('KCF02')!,trace,kit,POLICY)}],extra:sessionExtra(conformance.describe,conformance.scan)});
  return d;
 }
 it('tested in conformance, failed in measure: the record says failed with every occurrence in artifacts; edited to tested: VERDICT_NOT_REPRODUCED',async()=>{
  const d=fresh('record'),r=await assembleBenchRecord({identity:identity.d,conformance:conformance.d,measure:await abortedKcf02()},d,{candidateId:'t-2',sourceCommit:'abc1234'});
  expect(r.cases.KCF02).toMatchObject({status:'failed',reason:'OPERATOR_ABORT',session:'measure'});
  expect(r.cases.KCF02!.artifacts.some(a=>a.startsWith('conformance/cases/KCF02/'))).toBe(true);expect(r.cases.KCF02!.artifacts.some(a=>a.startsWith('measure/cases/KCF02/'))).toBe(true);
  expect(await verifyBenchRecord(d)).toEqual({ok:true,issues:[]});
  const p=join(d,'bench-record.json'),x=JSON.parse(readFileSync(p,'utf8')) as BenchRecordV1;
  x.cases.KCF02={...x.cases.KCF02!,status:'tested',reason:null};writeFileSync(p,JSON.stringify(x));await writeManifest(d);
  expect(await verifyBenchRecord(d)).toEqual({ok:false,issues:[{code:'VERDICT_NOT_REPRODUCED',path:'/cases/KCF02'}]});
 },60_000);
 it('tested in both parts: tested',async()=>{
  const measure=await part('measure',[benchCase('KCF02')!]),d=fresh('record');
  const r=await assembleBenchRecord({identity:identity.d,conformance:conformance.d,measure:measure.d},d,{candidateId:'t-3',sourceCommit:'abc1234'});
  expect(r.cases.KCF02).toMatchObject({status:'tested',reason:null});expect(r.cases.KCF02!.artifacts.filter(a=>a.includes('/cases/KCF02/')).length).toBeGreaterThan(2);
  expect(await verifyBenchRecord(d)).toEqual({ok:true,issues:[]});
 },60_000);
});

describe('assembly refuses parts that do not belong together',()=>{
 const extra=()=>sessionExtra(identity.describe,identity.scan);
 const refused=async(kind:PartKind,data:Parameters<typeof writeBenchPart>[2])=>{
  const d=fresh(kind);await writeBenchPart(d,kind,data);
  return assembleBenchRecord({identity:identity.d,[kind]:d},fresh('out'),{candidateId:'x',sourceCommit:'abc1234'});
 };
 it('another kit digest: KIT_DIGEST_MISMATCH',async()=>{
  await expect(refused('conformance',{session:SESSION,kit:kitOf({}),policy:POLICY,results:[],extra:extra()})).rejects.toMatchObject({code:'KIT_DIGEST_MISMATCH'});
 });
 it('another serial set: SERIAL_SET_MISMATCH',async()=>{
  const x=extra();(x.slaves as {serial:string}[])[0]!.serial='SIM-0009';
  await expect(refused('conformance',{session:SESSION,kit:kitOf(SIM),policy:POLICY,results:[],extra:x})).rejects.toMatchObject({code:'SERIAL_SET_MISMATCH'});
 });
 it('another policy: POLICY_DIGEST_MISMATCH',async()=>{
  await expect(refused('conformance',{session:SESSION,kit:kitOf(SIM),policy:reseal(POLICY,p=>{p.settleMs=400;}),results:[],extra:extra()})).rejects.toMatchObject({code:'POLICY_DIGEST_MISMATCH'});
 });
 it('a torque part without the declarations: SESSION_DECLARATION_MISSING',async()=>{
  const s={...SESSION,declarations:{...SESSION.declarations,motorsClamped:false}};
  await expect(refused('conformance',{session:s,kit:kitOf(SIM),policy:POLICY,results:[],extra:extra()})).rejects.toMatchObject({code:'SESSION_DECLARATION_MISSING'});
 });
});

describe('benchEvidence and closures',()=>{
 const sha='b'.repeat(64),r5=deviceEvidenceLevel(PROFILE).level;
 const real=(o:Partial<BenchRecordV1>={}):BenchRecordV1=>({...record,host:{...record.host,testLevel:'hardware'},worker:{...record.worker,busBackend:'soem'},devices:record.devices.map(d=>({...d,profileId:PROFILE.id})),
  gates:{...record.gates,'G-KID1':{status:'tested',accepted:false}},closures:[],...o});
 it('no record: the R5 level; KID of that serial tested: bench_measured; a matching acceptance: bench_verified',()=>{
  expect(benchEvidence(PROFILE,null,null,null,null)).toBe(r5);
  expect(benchEvidence(PROFILE,real(),'SIM-0001',null,sha)).toBe('bench_measured');
  expect(benchEvidence(PROFILE,real(),'SIM-0001',{recordSha256:sha},sha)).toBe('bench_verified');
  expect(benchEvidence(PROFILE,real(),'SIM-0001',{recordSha256:'c'.repeat(64)},sha)).toBe('bench_measured');
 });
 it('another serial, a KID gate not tested or a contradicted closure: never above the R5 level',()=>{
  expect(benchEvidence(PROFILE,real(),'SN-OTHER',{recordSha256:sha},sha)).toBe(r5);
  expect(benchEvidence(PROFILE,real({gates:{...record.gates,'G-KID1':{status:'not_run',accepted:false}}}),'SIM-0001',null,sha)).toBe(r5);
  expect(benchEvidence(PROFILE,real({closures:[{ruleId:'UNVERIFIED_FIRMWARE',path:'/devices/x',result:'contradicted',caseId:'KID02',observed:'2.0'}]}),'SIM-0001',{recordSha256:sha},sha)).toBe(r5);
 });
 it('closuresFor: UNVERIFIED_FIRMWARE closed by KID02; not_run is not_measured; a rule without a case is not_measured with caseId null',()=>{
  const check={ruleId:'UNVERIFIED_FIRMWARE',path:'/devices/drive-left',detail:'firmware not verified'};
  const v=(status:CaseVerdict['status'],observed?:Record<string,string>):CaseVerdict=>({status,reason:status==='not_run'?'x':null,measurements:[],...observed?{observed}:{}});
  expect(closuresFor([check],new Map([['KID02',v('tested',{'/devices/drive-left':'V1.07'})]]),KIT)).toEqual([{ruleId:'UNVERIFIED_FIRMWARE',path:'/devices/drive-left',result:'confirmed',caseId:'KID02',observed:'V1.07'}]);
  expect(closuresFor([check],new Map([['KID02',v('failed',{'/devices/drive-left':'V0.9'})]]),KIT)[0]).toMatchObject({result:'contradicted',observed:'V0.9'});
  expect(closuresFor([check],new Map([['KID02',v('not_run')]]),KIT)[0]).toMatchObject({result:'not_measured',caseId:'KID02',observed:null});
  expect(closuresFor([{ruleId:'UNVERIFIED_BUS_EXPOSURE',path:'/devices/x',detail:''}],new Map(),KIT)[0]).toMatchObject({result:'not_measured',caseId:'KID03'});
  expect(closuresFor([{ruleId:'MISSING_FUSE',path:'/nets/x',detail:''}],new Map([['KID02',v('tested')]]),KIT)).toEqual([{ruleId:'MISSING_FUSE',path:'/nets/x',result:'not_measured',caseId:null,observed:null}]);
 });
});

describe('the bench case and gate table (contracts §6)',()=>{
 const range=(p:string,a:number,b:number)=>Array.from({length:b-a+1},(_,i)=>`${p}${String(a+i).padStart(2,'0')}`);
 it('gates and cases are the table of §6.4',()=>{
  const gates={'G-KSW1':range('KSW',1,10),'G-KID1':range('KID',1,7),'G-KCF1':['KCF01','KCF02','KCF03','KCF04','KCF05','KCF06','KCF07a','KCF07b','KCF08','KCF09','KCF10'],
   'G-KMS1':range('KMS',1,6),'G-KCL1':range('KCL',1,5),'G-KSN1':range('KSN',1,7),'G-KTW1':range('KTW',1,5),'G-KREG1':range('KRG',1,3)};
  expect(Object.fromEntries(Object.entries(GATES_BENCH).map(([g,c])=>[g,[...c].sort()]))).toEqual(Object.fromEntries(Object.entries(gates).map(([g,c])=>[g,[...c].sort()])));
  expect(Object.keys(CASES_BENCH).sort()).toEqual([...Object.values(gates).flat(),...range('KTW',6,9)].sort());
  expect([...CUTTABLE_BENCH].sort()).toEqual(['KCF09','KID06','KMS03','KMS06']);expect(Object.keys(EXTERNAL_GATES_BENCH)).toEqual(['G-SAFE1']);
 });
 it('gateStatus: a cuttable case not_run with a reason keeps the gate tested; any failure fails it; protocol_double blocks hardware gates',()=>{
  const all=(ids:string[],status='tested')=>Object.fromEntries(ids.map(id=>[id,{status,reason:null}]));
  const kid=all(GATES_BENCH['G-KID1']!);
  expect(gateStatus('G-KID1',kid,{testLevel:'hardware'})).toBe('tested');
  expect(gateStatus('G-KID1',{...kid,KID06:{status:'not_run',reason:'no input wired'}},{testLevel:'hardware'})).toBe('tested');
  expect(gateStatus('G-KID1',{...kid,KID06:{status:'not_run',reason:null}},{testLevel:'hardware'})).toBe('not_run');
  expect(gateStatus('G-KID1',{...kid,KID05:{status:'not_run',reason:'x'}},{testLevel:'hardware'})).toBe('not_run');
  expect(gateStatus('G-KID1',{...kid,KID02:{status:'failed',reason:'x'}},{testLevel:'hardware'})).toBe('failed');
  expect(gateStatus('G-KID1',kid,{testLevel:'protocol_double'})).toBe('blocked_external');
  expect(gateStatus('G-KSW1',all(GATES_BENCH['G-KSW1']!),{testLevel:'protocol_double'})).toBe('tested');
 });
});
