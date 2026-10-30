import { expect, test } from 'vitest';
import { createRestaurantLab } from '../support/restaurant-lab';
import { createSimulator, completeSimulatedTravel, runRestaurantJourney } from '../support/restaurant-journey';
import type {JsonObject,RobotCommand} from '../../packages/contracts/src/index';
test('persisted simulated delivery completes by arrival then human load/handoff',async()=>{
 const lab=await createRestaurantLab();try {
  const result=await runRestaurantJourney(lab);
  expect(result.missionStatus).toBe('completed');expect(result.billStatus).toBe('closed');
  expect(await lab.count('DeliveryHandedOff')).toBe(1);expect(await lab.count('RobotCommandIssued')).toBe(2);
  expect((await lab.state<{served:string}>('fulfillment',result.lineId)).served).toBe('1');
 }finally{await lab.close();}
});
test('cancel loaded mission creates a return while preserving cargo and never records delivery',async()=>{
 const lab=await createRestaurantLab();try {
  await lab.seed('mission','m-1',{status:'executing',loaded:true,source:'kitchen',currentStopId:'table-stop',revision:2,robotId:'sim-1',stops:[{id:'table-stop',action:'handoff',targetId:'table-1',status:'awaiting_action',allocationIds:[]}],version:2});
  expect((await lab.command('cashier','Mission.Cancel',{missionId:'m-1',expectedVersion:2})).status).toBe('accepted');
  const m=await lab.state<{loaded:boolean;stops:JsonObject[]}>('mission','m-1');
  expect(m.loaded).toBe(true);expect(m.stops.some(x=>x.action==='return')).toBe(true);expect(await lab.count('DeliveryHandedOff')).toBe(0);
 }finally{await lab.close();}
});
test('scheduler rejects low battery and unbound targets; accepted navigation is not arrived',async()=>{
 const lab=await createRestaurantLab();try {
  const robot=await lab.state<JsonObject>('robot','sim-1');
  await lab.seed('robot','sim-1',{...robot,battery:1});
  expect((await lab.command('cashier','Mission.Create',{stops:[{action:'standby',targetId:'table-1'}]})).code).toBe('NO_CAPABLE_ROBOT');
  await lab.seed('robot','sim-1',{...robot,battery:100});
  expect((await lab.command('cashier','Mission.Create',{stops:[{action:'standby',targetId:'missing'}]})).code).toBe('NO_CAPABLE_ROBOT');
  const created=await lab.command('cashier','Mission.Create',{stops:[{action:'standby',targetId:'table-1'}]});
  const missionId=String(created.value.missionId),mission=await lab.state<{version:number;revision:number;currentStopId:string}>('mission',missionId);
  expect((await lab.command('cashier','Mission.ConfirmStop',{missionId,expectedVersion:mission.version,missionRevision:mission.revision,stopId:mission.currentStopId})).code).toBe('MISSION_STATE_CONFLICT');
  await completeSimulatedTravel(lab,await createSimulator(lab),missionId);
  const arrived=await lab.state<{version:number;revision:number;currentStopId:string}>('mission',missionId);
  expect((await lab.command('cashier','Mission.ConfirmStop',{missionId,expectedVersion:arrived.version,missionRevision:0,stopId:arrived.currentStopId})).code).toBe('STALE_STOP');
 }finally{await lab.close();}
});
test('simulator deduplicates native goals and reboot yields unknown instead of blind replay',async()=>{
 const lab=await createRestaurantLab();try {
  const created=await lab.command('cashier','Mission.Create',{stops:[{action:'standby',targetId:'table-1'}]});
  const stored=await lab.state<RobotCommand & {status:string;version:number}>('robot-command',String(created.value.commandId));
  const {status,version,...wire}=stored;void status;void version;
  const simulator=await createSimulator(lab);
  expect((await simulator.execute(wire)).accepted).toBe(true);expect((await simulator.execute(wire)).accepted).toBe(true);
  simulator.fault('reboot');expect((await simulator.reconcile(wire.commandId)).status).toBe('unknown');
  expect((await simulator.execute(wire)).unknown).toBe(true);
 }finally{await lab.close();}
});
test('cancelling after arrival returns loaded cargo and completes without a customer handoff',async()=>{
 const lab=await createRestaurantLab();try{
  await lab.command('cashier','Session.Open',{sessionId:'cancel-session',tableId:'table-1'});
  const order=await lab.command('cashier','Order.Place',{sessionId:'cancel-session',tableId:'table-1',menuVersion:1,items:[{itemId:'rice',quantity:'1'}]});
  const lineId=(order.value.lineIds as string[])[0]!;
  await lab.command('chef','Kitchen.Ready',{lineId,stationId:'kitchen',quantity:'1',expectedVersion:1});
  const allocation=await lab.command('cashier','Fulfillment.Allocate',{lineId,quantity:'1',expectedVersion:2});
  const created=await lab.command('cashier','Mission.Create',{allocationIds:[allocation.value.allocationId!]});
  const missionId=String(created.value.missionId),simulator=await createSimulator(lab);
  await completeSimulatedTravel(lab,simulator,missionId);
  let state=await lab.state<{version:number;revision:number;currentStopId:string;status:string}>('mission',missionId);
  expect((await lab.command('cashier','Mission.ConfirmStop',{missionId,expectedVersion:state.version,missionRevision:state.revision,stopId:state.currentStopId})).status).toBe('accepted');
  await completeSimulatedTravel(lab,simulator,missionId);
  state=await lab.state('mission',missionId);
  expect((await lab.command('cashier','Mission.Cancel',{missionId,expectedVersion:state.version})).status).toBe('accepted');
  state=await lab.state('mission',missionId);expect(state.status).toBe('executing');
  await completeSimulatedTravel(lab,simulator,missionId);
  state=await lab.state('mission',missionId);
  expect((await lab.command('cashier','Mission.ConfirmStop',{missionId,expectedVersion:state.version,missionRevision:state.revision,stopId:state.currentStopId})).status).toBe('accepted');
  expect((await lab.state<{status:string;loaded:boolean}>('mission',missionId))).toMatchObject({status:'cancelled',loaded:false});
  expect(await lab.count('DeliveryHandedOff')).toBe(0);expect(await lab.count('CargoReturned')).toBe(1);
  expect((await lab.state<{ready:string;allocated:string;returned:string}>('fulfillment',lineId))).toMatchObject({ready:'0',allocated:'0',returned:'1'});
 }finally{await lab.close();}
});
