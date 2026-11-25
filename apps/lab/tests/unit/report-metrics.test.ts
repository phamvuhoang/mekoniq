import {expect,test} from 'vitest';
import {summarizeReport,openReplay} from '../../src/reports/metrics';
const at=(ms:number)=>new Date(Date.UTC(2026,10,1)+ms).toISOString();
function report(){return {schemaVersion:1,mode:'business_sim',sourceCommit:'a'.repeat(40),snapshot:{status:'completed',served:'1',elapsedMs:9000,events:[{type:'RobotCommandIssued',at:at(0)},{type:'RobotGoalCompleted',at:at(1000)},{type:'CargoLoaded',at:at(3000)},{type:'RobotCommandIssued',at:at(3000)},{type:'RobotGoalCompleted',at:at(5000)},{type:'DeliveryHandedOff',at:at(8000)},{type:'RobotCommandIssued',at:at(8000)},{type:'RobotGoalCompleted',at:at(9000)}]},effects:[{type:'robot.execute',attempts:1},{type:'robot.execute',attempts:1},{type:'robot.execute',attempts:1}]};}
test('separates observed travel from load and customer wait',()=>{
 const summary=summarizeReport(report());expect(summary).toMatchObject({elapsedMs:9000,travelMs:4000,humanWaitMs:5000,served:'1',executeAttempts:3,evidence:'business_sim',distanceM:null});
});
test('replay only exposes recorded events within a clamped cursor',()=>{const original=report();const view=openReplay(original);expect(view.seek(5000)).toHaveLength(5);expect(view.seek(-1)).toHaveLength(1);expect(view.seek(10000)).toHaveLength(8);expect(original.snapshot.events).toHaveLength(8);expect('action' in view).toBe(false);});
test('rejects malformed or non-business evidence instead of relabeling it',()=>{expect(()=>summarizeReport({...report(),mode:'hardware_test'})).toThrow('UNSUPPORTED_REPORT_MODE');expect(()=>summarizeReport({...report(),snapshot:{...report().snapshot,elapsedMs:-1}})).toThrow('INVALID_REPORT');});
