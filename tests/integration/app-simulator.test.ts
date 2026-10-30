import {expect,test} from 'vitest';
import {createRestaurantLab} from '../support/restaurant-lab';
import {startSimulatedRobotRuntime} from '../../apps/tablet-android/src/robot-runtime';
import type {JsonObject} from '../../packages/contracts/src/index';
test('packaged app executor consumes durable fake missions and records actual arrivals',async()=>{
 const lab=await createRestaurantLab();let runtime:ReturnType<typeof startSimulatedRobotRuntime>|undefined;
 try{
  const robot=await lab.state<JsonObject>('robot','sim-1');await lab.seed('robot','sim-1',{...robot,ownerDeviceId:'coordinator'});
  runtime=startSimulatedRobotRuntime({store:await lab.getStore('coordinator'),scope:lab.scope,registry:lab.registry,nowMs:()=>lab.clock.nowMs,intervalMs:0});
  const mission=await lab.command('cashier','Mission.Create',{stops:[{action:'standby',targetId:'table-1'}]});
  expect(mission.status).toBe('accepted');
  await runtime.step();await lab.advance(1000);await runtime.step();
  const state=await lab.state<{status:string;stops:{status:string}[]}>('mission',String(mission.value.missionId));
  expect(state.stops[0].status).toBe('awaiting_action');
  expect(await lab.effectCount('robot.execute')).toBe(1);
  await runtime.close();runtime=undefined;
 }finally{await runtime?.close();await lab.close();}
});
