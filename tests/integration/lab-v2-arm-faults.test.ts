import {afterEach,expect,test} from 'vitest';
import {act,cleanupRuns,openCoffee,stepUntil} from '../support/lab-v2';
afterEach(cleanupRuns);
async function armFaultKeepsCustody(faultId:'arm-following-error'|'arm-stop'|'arm-estop'|'arm-collision'){
 const run=await openCoffee('BV01',{seed:42});
 try{
  await run.start();await stepUntil(run,v=>v.coffee?.jobs.some(j=>j.status==='transferring')??false,5);
  await act(run,'step',{ticks:20});await act(run,'injectFault',{faultId});await act(run,'step',{ticks:5});
  const before=await run.report();expect(before.outcome.status).toBe('needs_attention');expect(before.outcome.served).toBe('0');
  expect(before.coffee!.armTrace.stop).toMatchObject({latched:true,reconcileRequired:true});
  expect(before.coffee!.armTrace.stop!.events.map(e=>e.stage)).toEqual(['requested','acknowledged','observed']);
  if(faultId==='arm-collision'){expect(before.coffee!.armTrace.collision!.last).toMatchObject({ok:false,reason:'COLLISION',pair:expect.arrayContaining([expect.stringMatching(/^injected-fixture-/)])});}
  await act(run,'injectFault',{faultId:'arm-reset'});await act(run,'step',{ticks:1000});
  const after=await run.report();expect(after.outcome.status).toBe('needs_attention');
  expect(after.coffee!.cellEffects).toEqual(before.coffee!.cellEffects);expect(after.coffee!.cups).toEqual(before.coffee!.cups);
  expect(after.coffee!.armTrace.samples).toEqual(before.coffee!.armTrace.samples);
  expect(after.coffee!.armTrace.stop).toMatchObject({latched:false,reconcileRequired:true});
 }finally{await run.close();}
}
test('ARM mock arm-following-error reaches source attention, preserves cup custody and cannot resume by reset',()=>armFaultKeepsCustody('arm-following-error'),60000);
test('ARM mock arm-stop reaches source attention, preserves cup custody and cannot resume by reset',()=>armFaultKeepsCustody('arm-stop'),60000);
test('ARM mock arm-estop reaches source attention, preserves cup custody and cannot resume by reset',()=>armFaultKeepsCustody('arm-estop'),60000);
test('ARM mock arm-collision reaches source attention, preserves cup custody and cannot resume by reset',()=>armFaultKeepsCustody('arm-collision'),60000);
