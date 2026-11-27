import {describe,expect,test} from 'vitest';
import {CASES_R5,CLOSING_GATES_R5,EXTERNAL_GATES_R5,GATES_R5,SUITES_R5,tableR5,validateR5Selectors,checkR5Closing,checkR5Structure} from '../../scripts/sim-extension-r5.mjs';
// @ts-expect-error plain ESM script without types
import {checkQualification} from '../../scripts/sim-extension-qualification.mjs';
// @ts-expect-error plain ESM script without types
import {artifactDispositionsFromGroups} from '../../scripts/r5-readback.mjs';
import {readFileSync} from 'node:fs';

describe('R5 qualification table',()=>{
 test('48 cases, nine closing gates, two external gates that no case feeds',()=>{
  expect(Object.keys(CASES_R5)).toHaveLength(48);expect(CLOSING_GATES_R5).toHaveLength(9);expect(Object.keys(EXTERNAL_GATES_R5)).toEqual(['G-BENCH1','G-SAFE1']);
  expect(Object.keys(GATES_R5).some(g=>g in EXTERNAL_GATES_R5)).toBe(false);
 });
 test('every case is in exactly one gate and every gate case exists',()=>{
  const inGates=Object.values(GATES_R5).flat();expect(new Set(inGates).size).toBe(inGates.length);expect([...inGates].sort()).toEqual(Object.keys(CASES_R5).sort());
 });
 test('every case names a suite, an input or a reason; no suite is unused; no suite is missing',()=>{
  const used=new Set<string>();
  for(const [id,c] of Object.entries(CASES_R5)){const x=c as {suites?:string[];input?:string;notRun?:string};expect(!!(x.suites?.length||x.input||x.notRun),id).toBe(true);for(const s of x.suites??[]){expect(SUITES_R5.some(u=>u.id===s),`${id}:${s}`).toBe(true);used.add(s);}}
  expect(SUITES_R5.filter(s=>!used.has(s.id)).map(s=>s.id)).toEqual([]);
 });
 test('the cases R5 did not build are not_run with their reason, and nothing is claimed for the cut ones',()=>{
  const notRun=Object.entries(CASES_R5).filter(([,c])=>(c as {notRun?:string}).notRun).map(([id])=>id);
  expect(notRun).toEqual(expect.arrayContaining(['VIO01','VIO02','VIO03','VIO04','CLD06']));
  expect(CASES_R5.CLD06!.notRun).toBe('deploy_order_pending');
  // CLD05 reads the native x86-64 run from the container record: not_run with its reason while that run is absent, failed when a requested amd64 build failed
  expect(CASES_R5.CLD05).toEqual({input:'containerRecord'});
  const d=artifactDispositionsFromGroups({containerRecord:{CLD04:[],CLD05:['CLD05_NATIVE_MISSING:native_linux_x86_64_host_required']}});
  expect([d.CLD04.status,d.CLD05.status]).toEqual(['tested','not_run']);expect(d.CLD05.issues[0]).toMatch(/native_linux_x86_64_host_required/);
  expect(artifactDispositionsFromGroups({containerRecord:{CLD04:[],CLD05:['CLD05_FAILED:AMD64_BUILD_FAILED']}}).CLD05.status).toBe('failed');
 });
 test('every named test file exists',()=>{validateR5Selectors(tableR5(),{source:'.',lab:'apps/lab'});});
 test('no suite uses a launcher flag outside the documented ones, and each launcher runs one spec',()=>{
  for(const s of SUITES_R5.filter(x=>x.kind==='playwright'))expect((s.command!).filter(a=>a.endsWith('.spec.ts')).length).toBe(1);
  expect(readFileSync('scripts/sim-extension-r5.mjs','utf8')).not.toMatch(/accepted:\s*true/);
 });
});

/** A record shaped like the recorder's output: every case tested except the given not_run/failed ones, gates derived the recorder's way. */
const record=(notRun:Record<string,string>={},failed:string[]=[])=>{
 const cases=Object.fromEntries(Object.keys(CASES_R5).map(id=>[id,failed.includes(id)?{status:'failed',reason:'artifact failed: X'}:id in notRun?{status:'not_run',reason:notRun[id]}:{status:'tested'}]));
 const gates=Object.fromEntries(Object.entries(GATES_R5).map(([g,ids])=>[g,{accepted:false,cases:ids,status:(ids as string[]).every(id=>cases[id]!.status==='tested')?'tested':(ids as string[]).some(id=>cases[id]!.status==='failed')?'failed':'not_run'}]));
 return {release:'r5',accepted:false,cases,gates,externalGates:Object.fromEntries(Object.keys(EXTERNAL_GATES_R5).map(g=>[g,{status:'blocked_external',accepted:false}]))};
};
const VIO={VIO01:'vio_cut',VIO02:'vio_cut',VIO03:'vio_cut',VIO04:'vio_cut'},PENDING={...VIO,CLD06:'deploy_order_pending'};
describe('R5 closing decision (apart from reading a record)',()=>{
 test('"R5 không có I/O ảo" closes with eight gates tested, the VIO cases cut and CLD06 from a valid supplement',()=>{
  expect(checkR5Closing(record(PENDING),{cut:['G-VIO1'],cloudSupplementIssues:[]})).toEqual({closed:true,releaseName:'R5 không có I/O ảo',issues:[]});
 });
 test('without a valid CLD06 supplement G-CLOUD3 does not close, and the supplement issues are named',()=>{
  expect(checkR5Closing(record(PENDING),{cut:['G-VIO1']}).issues).toEqual(['CASE_NOT_TESTED:CLD06','GATE_NOT_TESTED:G-CLOUD3']);
  expect(checkR5Closing(record(PENDING),{cut:['G-VIO1'],cloudSupplementIssues:['CLOUD_DIGEST_MISMATCH']}).issues).toContain('CLD06_SUPPLEMENT:CLOUD_DIGEST_MISMATCH');
 });
 test('a VIO case not_run without the cut, any other not_run case, a failed case, a reason-less exception and an unknown cut are refused',()=>{
  expect(checkR5Closing(record(PENDING),{cloudSupplementIssues:[]}).issues).toEqual(expect.arrayContaining(['CASE_NOT_TESTED:VIO01','GATE_NOT_TESTED:G-VIO1']));
  expect(checkR5Closing(record({...PENDING,DGN02:'not_built'}),{cut:['G-VIO1'],cloudSupplementIssues:[]}).issues).toEqual(['CASE_NOT_TESTED:DGN02','GATE_NOT_TESTED:G-DGN1']);
  expect(checkR5Closing(record({...PENDING,CLD05:'CLD05_NATIVE_MISSING:x'}),{cut:['G-VIO1'],cloudSupplementIssues:[]}).issues).toEqual(['CASE_NOT_TESTED:CLD05','GATE_NOT_TESTED:G-CLOUD3']);
  expect(checkR5Closing(record(PENDING,['STP06']),{cut:['G-VIO1'],cloudSupplementIssues:[]}).issues).toEqual(['CASE_FAILED:STP06','GATE_NOT_TESTED:G-STP1']);
  expect(checkR5Closing(record({...PENDING,VIO02:' '}),{cut:['G-VIO1'],cloudSupplementIssues:[]}).issues).toEqual(['EXCEPTION_WITHOUT_REASON:VIO02']);
  expect(checkR5Closing(record(PENDING),{cut:['G-DGN1'],cloudSupplementIssues:[]})).toMatchObject({closed:false,issues:['CUT_NOT_ALLOWED:G-DGN1']});
  // G-CLOUD3 is cut only on the decided failure: a complete supplement whose only issue is the Mac comparison
  expect(checkR5Closing(record(PENDING),{cut:['G-VIO1','G-CLOUD3'],cloudSupplementIssues:['CLD06_TOLERANCE_EXCEEDED:peakDecelerationMps2']})).toEqual({closed:true,releaseName:'R5 không có I/O ảo, CLD06 chuyển sang R6',issues:[]});
  expect(checkR5Closing(record(PENDING),{cut:['G-VIO1','G-CLOUD3'],cloudSupplementIssues:['ENTRY_CONDITION_MISMATCH']}).closed).toBe(true);
  expect(checkR5Closing(record(PENDING),{cut:['G-VIO1','G-CLOUD3'],cloudSupplementIssues:['CLD06_EVIDENCE_MISSING:cloud:700:torque:amr-1/wheel-right']}).issues).toEqual(['CLD06_SUPPLEMENT:CLD06_EVIDENCE_MISSING:cloud:700:torque:amr-1/wheel-right']);
  expect(checkR5Closing(record(PENDING),{cut:['G-VIO1','G-CLOUD3'],cloudSupplementIssues:['CLD06_EXPECTED:cloud:torque']}).closed).toBe(false);
  expect(checkR5Closing(record(PENDING),{cut:['G-VIO1','G-CLOUD3']}).issues).toEqual(['CLD06_SUPPLEMENT_REQUIRED_FOR_CUT']);
  expect(checkR5Closing(record(PENDING),{cut:['G-VIO1','G-CLOUD3'],cloudSupplementIssues:[]}).issues).toEqual(['CUT_GATE_PASSED:G-CLOUD3']);
  expect(checkR5Closing(record({...PENDING,CLD05:'CLD05_NATIVE_MISSING:x'}),{cut:['G-VIO1','G-CLOUD3'],cloudSupplementIssues:['CLD06_TOLERANCE_EXCEEDED:stopTimeMs']}).issues).toEqual(['CASE_NOT_TESTED:CLD05']);
  const accepted={...record(PENDING),accepted:true};expect(checkR5Closing(accepted,{cut:['G-VIO1'],cloudSupplementIssues:[]}).issues).toEqual(['NOT_AN_R5_CANDIDATE']);
 });
 test('the full R5 (nothing cut) needs G-VIO1 tested too',()=>{
  expect(checkR5Closing(record({CLD06:'deploy_order_pending'}),{cloudSupplementIssues:[]})).toEqual({closed:true,releaseName:'R5',issues:[]});
 });
});
describe('R5 through the shared dispatcher',()=>{
 test('checkQualification routes r5 to the R5 table and never passes it without the artifact read-back',()=>{
  const m={release:'r5'};
  expect(checkQualification(m,()=>null)).toEqual([...checkR5Structure(m,()=>null),'R5_ARTIFACT_READBACK_REQUIRED']);
  expect(checkQualification(m,()=>null)).toContain('R5_ARTIFACT_READBACK_REQUIRED');
  expect(checkR5Structure(m,()=>null).length).toBeGreaterThan(0);
 });
});
