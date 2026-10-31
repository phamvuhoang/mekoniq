import type { Lab } from './lab';
import type { CommandResult, JsonObject, RobotCommand } from '../../packages/contracts/src/index';
import { SimulatorAdapter } from '../../packages/robot-adapters/src/simulator';
import {dispatchRobotEffects,robotEventCommand} from '../../packages/robot-adapters/src/dispatch';
import type { RobotEvent, RobotManifest } from '../../packages/robot-adapters/src/contract';
const accepted=(result:CommandResult):CommandResult=>{
 if(result.status!=='accepted') throw new Error(`JOURNEY_COMMAND_REJECTED:${result.code}`);
 return result;
};
/** Dispatch a persisted fake-executor command; all observations return through the production router. */
export async function completeSimulatedTravel(lab:Lab,simulator:SimulatorAdapter,missionId:string):Promise<void> {
 const mission=await lab.state<{commandId:string}>('mission',missionId);
 const command=await lab.state<RobotCommand & {status:string;version:number}>('robot-command',mission.commandId);
 const {status:_status,version:_version,...wire}=command;
 void _status;void _version;
 const events:RobotEvent[]=[];const unsubscribe=simulator.observe(event=>events.push(event));
 try {
  void wire;
  await dispatchRobotEffects(await lab.getStore('coordinator'),lab.scope,simulator,lab.clock.nowMs);
  simulator.advance(1000);
  for(const event of events) accepted(await lab.command('owner','Robot.Observe',robotEventCommand(event),event.id));
 }finally{unsubscribe();}
}
export async function createSimulator(lab:Lab):Promise<SimulatorAdapter> {
 const robot=await lab.state<JsonObject>('robot','sim-1');
 const manifest:RobotManifest={id:'sim-1',adapter:'simulator',protocolVersion:'1',firmware:'deterministic-fixture-1',capabilities:robot.capabilities as string[],mapId:String(robot.mapId),mapRevision:String(robot.mapRevision),offlineExecution:true,maxLoadMinor:String(robot.maxLoadMinor),trays:Number(robot.trays),validation:'simulated'};
 return new SimulatorAdapter(manifest,lab.clock.nowMs);
}
export async function runRestaurantJourney(lab:Lab) {
 accepted(await lab.command('cashier','Session.Open',{sessionId:'session-journey',tableId:'table-1'},'journey-session'));
 const placed=accepted(await lab.command('cashier','Order.Place',{sessionId:'session-journey',tableId:'table-1',menuVersion:1,items:[{itemId:'rice',quantity:'1'}]},'journey-order'));
 const lineId=(placed.value.lineIds as string[])[0]!;
 accepted(await lab.command('chef','Kitchen.Ready',{lineId,quantity:'1',stationId:'kitchen',expectedVersion:1},'journey-ready'));
 const allocation=accepted(await lab.command('cashier','Fulfillment.Allocate',{lineId,quantity:'1',expectedVersion:2,method:'robot'},'journey-allocate'));
 const mission=accepted(await lab.command('cashier','Mission.Create',{allocationIds:[allocation.value.allocationId!],robotId:'sim-1'},'journey-mission'));
 const missionId=String(mission.value.missionId),simulator=await createSimulator(lab);
 for(let stop=0;stop<2;stop++) {
  await completeSimulatedTravel(lab,simulator,missionId);
  const state=await lab.state<{version:number;revision:number;currentStopId:string}>('mission',missionId);
  accepted(await lab.command('cashier','Mission.ConfirmStop',{missionId,expectedVersion:state.version,missionRevision:state.revision,stopId:state.currentStopId},`journey-stop-${stop}`));
 }
 accepted(await lab.command('cashier','Shift.Open',{shiftId:'shift-journey',currency:'VND',openingMinor:'0'},'journey-shift'));
 const bill=accepted(await lab.command('cashier','Bill.Prepare',{sessionId:'session-journey'},'journey-bill'));
 const billId=String(bill.value.billId);
 accepted(await lab.command('cashier','Payment.RecordCash',{billId,expectedVersion:1,amountMinor:'50000',currency:'VND',shiftId:'shift-journey'},'journey-cash'));
 accepted(await lab.command('cashier','Bill.Close',{billId,expectedVersion:2},'journey-close'));
 const finalMission=await lab.state<{status:string}>('mission',missionId),finalBill=await lab.state<{status:string}>('bill',billId);
 return {billId,missionId,lineId,orderId:String(placed.value.orderId),billStatus:finalBill.status,missionStatus:finalMission.status};
}
