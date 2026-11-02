import {expect,test} from 'vitest';
import {createContinuityLab} from '../support/continuity-lab';
import {createRestaurantLab} from '../support/restaurant-lab';
import {actors} from '../support/actors';
test('full shutdown exposes unresolved cargo',async()=>{
 const lab=await createContinuityLab();try{
  await lab.seed('mission','m-1',{loaded:true,status:'executing'});
  expect((await lab.command('manager','Maintenance.Enter',{mode:'full_shutdown'})).code).toBe('UNRESOLVED_CARGO');
  expect(await lab.count('MaintenanceEntered')).toBe(0);
 }finally{await lab.close();}
});
test('planned shutdown requires checkpoints and blocks new shared work',async()=>{
 const lab=await createContinuityLab();try{
  expect((await lab.command('manager','Maintenance.Enter',{mode:'full_shutdown'})).code).toBe('CHECKPOINT_REQUIRED');
  for(const deviceId of new Set(Object.values(actors).map(a=>a.deviceId)))await lab.seed('device-checkpoint',deviceId,{deviceEpoch:'epoch-1',status:'complete',pendingCount:0,receivedCursor:'0',appliedCursor:'0',coveredSequence:'0',expiresAtMs:lab.clock.nowMs+30000});
  expect((await lab.command('manager','Maintenance.Prepare',{missingDevices:[]})).status).toBe('accepted');
  expect((await lab.command('manager','Maintenance.Enter',{mode:'full_shutdown'})).status).toBe('accepted');
  const exported=await lab.command('manager','Continuity.Export',{});
  expect(exported.value.preserveOriginalIds).toBe(true);
 }finally{await lab.close();}
});

test('full shutdown drains guest, guide, bus and additive amendment aliases before they create work',async()=>{
 const lab=await createRestaurantLab();try{
  expect((await lab.command('manager','Maintenance.Prepare',{mode:'full_shutdown'})).status).toBe('accepted');
  for(const type of ['Guest.PlaceOrder','Mission.Guide','Mission.Bus','Order.Amend']) {
   const result=await lab.command(type.startsWith('Guest.')?'guest':'manager',type,{items:[{itemId:'rice',quantity:'1'}]});
   expect(result.code,type).toBe('MAINTENANCE_DRAINING');
  }
  expect((await lab.command('manager','Order.Amend',{lineId:'missing',cancelQuantity:'1',reason:'cancel',expectedVersion:1})).code).not.toBe('MAINTENANCE_DRAINING');
  expect(await lab.count('RobotCommandIssued')).toBe(0);expect(await lab.count('KitchenTicketCreated')).toBe(0);
  await lab.seed('maintenance','current',{status:'prepared',mode:'cloud_only'});
  for(const type of ['Guest.PlaceOrder','Mission.Guide','Mission.Bus','Order.Amend','Robot.RequestStop'])expect((await lab.command(type.startsWith('Guest.')?'guest':'manager',type,{})).code).not.toBe('MAINTENANCE_DRAINING');
 }finally{await lab.close();}
});
