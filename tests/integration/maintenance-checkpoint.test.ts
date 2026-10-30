import {expect,test} from 'vitest';
import {createContinuityLab} from '../support/continuity-lab';
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
  for(const deviceId of ['device-a','device-b','device-kds','device-guest'])await lab.seed('device-checkpoint',deviceId,{deviceEpoch:'epoch-1',status:'complete',pendingCount:0,receivedCursor:'0',appliedCursor:'0',coveredSequence:'0',expiresAtMs:lab.clock.nowMs+30000});
  expect((await lab.command('manager','Maintenance.Prepare',{missingDevices:[]})).status).toBe('accepted');
  expect((await lab.command('manager','Maintenance.Enter',{mode:'full_shutdown'})).status).toBe('accepted');
  const exported=await lab.command('manager','Continuity.Export',{});
  expect(exported.value.preserveOriginalIds).toBe(true);
 }finally{await lab.close();}
});
