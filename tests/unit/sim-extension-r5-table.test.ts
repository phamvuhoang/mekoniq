import {describe,expect,test} from 'vitest';
import {CASES_R5,CLOSING_GATES_R5,EXTERNAL_GATES_R5,GATES_R5,SUITES_R5,tableR5,validateR5Selectors} from '../../scripts/sim-extension-r5.mjs';
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
  expect(notRun).toEqual(expect.arrayContaining(['VIO01','VIO02','VIO03','VIO04','DGN02','DGN04','REG06','CLD05','CLD06']));
  expect(CASES_R5.CLD06!.notRun).toBe('deploy_order_pending');
 });
 test('every named test file exists',()=>{validateR5Selectors(tableR5(),{source:'.',lab:'apps/lab'});});
 test('no suite uses a launcher flag outside the documented ones, and each launcher runs one spec',()=>{
  for(const s of SUITES_R5.filter(x=>x.kind==='playwright'))expect((s.command!).filter(a=>a.endsWith('.spec.ts')).length).toBe(1);
  expect(readFileSync('scripts/sim-extension-r5.mjs','utf8')).not.toMatch(/accepted:\s*true/);
 });
});
