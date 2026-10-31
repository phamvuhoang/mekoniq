import {expect,test} from 'vitest';
import {createRestaurantLab} from '../support/restaurant-lab';
import {createSimulator,completeSimulatedTravel} from '../support/restaurant-journey';
test('busy capable robot queues accepted work and starts it after previous stop without a dock detour',async()=>{
 const lab=await createRestaurantLab();try{
  const first=await lab.command('cashier','Mission.Create',{stops:[{action:'standby',targetId:'table-1'}]});
  expect(first.status).toBe('accepted');
  const second=await lab.command('cashier','Mission.Create',{stops:[{action:'standby',targetId:'table-2'}]});
  expect(second.status).toBe('accepted');
  expect((await lab.state<{status:string}>('mission',String(second.value.missionId))).status).toBe('queued');
  expect(await lab.count('RobotCommandIssued')).toBe(1);
  const sim=await createSimulator(lab);await completeSimulatedTravel(lab,sim,String(first.value.missionId));
  const before=await lab.state<{version:number;revision:number;currentStopId:string}>('mission',String(first.value.missionId));
  expect((await lab.command('cashier','Mission.ConfirmStop',{missionId:first.value.missionId!,expectedVersion:before.version,missionRevision:before.revision,stopId:before.currentStopId})).status).toBe('accepted');
  expect((await lab.state<{status:string}>('mission',String(second.value.missionId))).status).toBe('assigned');
  expect(await lab.count('RobotCommandIssued')).toBe(2);
  const robot=await lab.state<{missionId:string;availability:string}>('robot','sim-1');
  expect(robot).toMatchObject({missionId:second.value.missionId,availability:'busy'});
 }finally{await lab.close();}
});
test('queued cancellation leaves the active robot mission untouched',async()=>{
 const lab=await createRestaurantLab();try{
  const active=await lab.command('cashier','Mission.Create',{stops:[{action:'standby',targetId:'table-1'}]});
  const queued=await lab.command('cashier','Mission.Create',{stops:[{action:'standby',targetId:'table-2'}]});
  expect(queued.status).toBe('accepted');
  expect((await lab.command('cashier','Mission.Cancel',{missionId:queued.value.missionId!,expectedVersion:1})).status).toBe('accepted');
  expect((await lab.state<{status:string}>('mission',String(queued.value.missionId))).status).toBe('cancelled');
  expect((await lab.state<{missionId:string}>('robot','sim-1')).missionId).toBe(active.value.missionId);
  expect(await lab.count('RobotCommandIssued')).toBe(1);
 }finally{await lab.close();}
});
