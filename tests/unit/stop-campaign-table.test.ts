import {expect,test} from 'vitest';
import {STOP_CASES,STOP_TABLE,cruiseOf} from '../../packages/lab-runtime/src/v2/control/stop-campaign';
import {TRAY_EXPERIMENTS} from '../../packages/lab-runtime/src/v2/simulation3d/tray-experiments';
import {validateStopSchedule,STOP_FUNCTIONS} from '../../packages/lab-runtime/src/v2/control/stop-functions';
import {validateDriveFaultSchedule} from '../../packages/lab-runtime/src/v2/control/drive-faults';
import {decel,records} from '../support/stop-records';

test('the table has sixteen cases with unique ids: S1 x4, S2 x4, S3 x4, S4 x1, S5 x3',()=>{
 expect(STOP_CASES).toHaveLength(16);expect(new Set(STOP_CASES.map(c=>c.id)).size).toBe(16);
 const by=(g:string)=>STOP_CASES.filter(c=>c.group===g).length;
 expect([by('S1'),by('S2'),by('S3'),by('S4'),by('S5')]).toEqual([4,4,4,1,3]);
 for(const g of ['S1','S2','S3'])expect(STOP_CASES.filter(c=>c.group===g).map(c=>c.entry.function).sort()).toEqual(['emergency','emergency','normal','protective']);
});
test('every case runs MJ-TRAY01 on a registered stop variant with one valid, admitted stop request',()=>{
 expect(STOP_TABLE.scenarioId).toBe('MJ-TRAY01');
 for(const c of STOP_CASES){
  expect(Object.hasOwn(TRAY_EXPERIMENTS,c.experimentId),c.id).toBe(true);expect(c.experimentId).toMatch(/^tray-stop-/);
  expect(validateStopSchedule([c.entry],{axes:['amr-1/wheel-left','amr-1/wheel-right'],functions:STOP_FUNCTIONS,missionEndMs:null}).ok,c.id).toBe(true);
  expect(c.seed).toBe(7);
 }
});
test('S4 stops an emergency in the middle of a command loss on both wheels; admitted by the fault catalog',()=>{
 const s4=STOP_CASES.find(c=>c.group==='S4')!;
 expect(s4.entry.function).toBe('emergency');expect(s4.faults!.every(f=>f.faultId==='command-loss')).toBe(true);
 expect(validateDriveFaultSchedule(s4.faults!,{axes:['amr-1/wheel-left','amr-1/wheel-right'],lidars:[],campaign:false}).ok).toBe(true);
 const at=s4.entry.trigger.value;
 for(const f of s4.faults!){const from=(f.trigger as {value:number}).value;expect(from).toBeLessThan(at);expect(from+f.durationMs).toBeGreaterThan(at);}
});
test('the three S5 runs are the same run: identical but for the id, each naming the first as the one it repeats',()=>{
 const s5=STOP_CASES.filter(c=>c.group==='S5'),strip=(c:typeof s5[number])=>JSON.stringify({...c,id:0,repeatOf:0});
 expect(new Set(s5.map(strip)).size).toBe(1);expect(s5.slice(1).every(c=>c.repeatOf===s5[0]!.id)).toBe(true);expect(s5[0]!.repeatOf).toBeUndefined();
});
test('the stop fires at the cruise tick the survey read from a real run',()=>{
 const tick=Math.ceil(STOP_CASES[0]!.entry.trigger.value/20)+1;expect(tick).toBeGreaterThan(100);
});
test('cruise is the first tick from which the body holds 95 % of its peak speed for 25 ticks',()=>{
 const r=records({ticks:900,speed:t=>Math.min(0.5,t*0.01)}),c=cruiseOf(r)!;
 expect(c.speedMps).toBeCloseTo(0.5,1);expect(c.tick).toBeGreaterThanOrEqual(46);expect(c.tick).toBeLessThanOrEqual(52);
 expect(cruiseOf(records({ticks:50,speed:()=>0}))).toBeNull();void decel;
});
