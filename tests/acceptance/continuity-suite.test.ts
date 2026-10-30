import {expect,test,afterAll} from 'vitest';
import {createRestaurantLab} from '../support/restaurant-lab';
import {continuityScenarioIds,runContinuityScenario,assertContinuityGate,saveContinuityReport,type ScenarioReport} from './continuity-suite';
const reports:ScenarioReport[]=[];
const softwareOnly=process.env.MEKONIQ_CONTINUITY_SOFTWARE_ONLY==='1';
test('all 22 continuity cases have executable registered scenarios',()=>{
 expect(continuityScenarioIds().sort()).toEqual(Array.from({length:22},(_,index)=>'O'+String(index+1).padStart(2,'0')));
});
for(const id of continuityScenarioIds())test(`${id}: behavioral software continuity scenario`,async()=>{
 const lab=await createRestaurantLab();try{
  const report=await runContinuityScenario(id,lab);reports.push(report);
  expect(report.software,report.evidence.join('\n')).toBe('passed');
 }finally{await lab.close();}
},120000);
afterAll(async()=>{await saveContinuityReport(reports,softwareOnly);assertContinuityGate(reports,softwareOnly);});
