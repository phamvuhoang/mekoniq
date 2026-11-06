// The workflow consumes plant facts; it never creates controller telemetry or grip from completion ACKs.
import type {CellAdapter,CellReport} from '../../../../cell-adapters/src/contract';
import {MockCoffeeAdapter,MockCoffeePlant,type CoffeePlantState} from '../../../../cell-adapters/src/mock-coffee';
import {MockArmAdapter,MockArmPlant,type ArmPlantState} from '../../../../cell-adapters/src/mock-arm';
import type {ArmCollisionEvidenceRecord} from '../arm/session';
import type {ArmSceneSnapshot} from '../models/arm-scene';
import type {CoffeeContext,CoffeeState} from '../scenarios/coffee';
import type {CorrelatedTransferEvidence,CupLedger,CupPhysicalState} from './cup-ledger';
export interface CoffeePlantPorts {
 adapters:readonly CellAdapter[];
 advance():Promise<void>;
 recover():Promise<void>;
 snapshot():{coffee:CoffeePlantState;arm:ArmPlantState|null};
 drain():readonly CellReport[];
 transferEvidence(transferId:string):CorrelatedTransferEvidence|null;
 report():{cupLedger:readonly CupPhysicalState[];arm:ArmCollisionEvidenceRecord|null};
 close():Promise<void>;
 /** Scripted cup input and fault controls. These never assert domain custody. */
 coffeePlant?:MockCoffeePlant;
 mockArm?:MockArmPlant;
 setArmScene?(scene:ArmSceneSnapshot):void;
 bindLedger?(ledger:CupLedger):void;
 custodyResolved?(cupId:string,parent:string):void|Promise<void>;
 acknowledgeCompletion?(commandId:string,observationId:string):void|Promise<void>;
}
/** Default uses precisely the old mock choreography and mutable checkpoint objects. */
export function createMockCoffeePorts(st:CoffeeState,ctx:CoffeeContext,newBootId:()=>string):CoffeePlantPorts {
 st.trays??={};
 const parents=new Map<string,string>();
 const coffee=new MockCoffeePlant(st.plant,ctx.nowMs,newBootId),arm=new MockArmPlant(st.arm,ctx.nowMs,newBootId,
  {take:()=>{const c=st.plant.cups.find(x=>x.at==='nozzle');if(!c||!coffee.takeCup(c.cupId))return null;parents.set(c.cupId,`arm:${st.armId}/tcp`);return c.cupId;},put:(cupId,rx)=>{st.trays[rx.robotId]=cupId;parents.set(cupId,`robot:${rx.robotId}/tray:${rx.slot}`);}},ctx.receiver);
 const adapters=[new MockCoffeeAdapter(coffee,ctx.runId),new MockArmAdapter(arm,ctx.runId,st.cellId)],reports:CellReport[]=[];
 const off=adapters.map(a=>a.observe(r=>reports.push(r)));
 return {adapters,coffeePlant:coffee,mockArm:arm,setArmScene:s=>arm.setCollisionScene(s),
  async advance(){coffee.advance();arm.advance();},
  async recover(){if(st.plant.commands.some(c=>c.state==='running'||c.state==='settling'))coffee.fault('coffee-reboot');if(st.arm.programs.some(p=>p.state==='running'))arm.fault('arm-reboot');},
  snapshot:()=>({coffee:st.plant,arm:st.arm}),drain:()=>reports.splice(0),transferEvidence:()=>null,
  custodyResolved:(cupId,parent)=>{parents.set(cupId,parent);},
  report:()=>({cupLedger:st.plant.cups.map(c=>{const parent=parents.get(c.cupId)??(c.at==='nozzle'?`cell:${st.cellId}/nozzle`:arm.state.holding===c.cupId?`arm:${st.armId}/tcp`:null);return {cupId:c.cupId,parent,status:parent===null?'unknown' as const:'known' as const,lastObservationId:`mock:${st.plant.tick}`};}),arm:null}),
  async close(){for(const unsubscribe of off)unsubscribe();}};
}
