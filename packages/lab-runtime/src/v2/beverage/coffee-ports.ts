// The workflow consumes plant facts; it never creates controller telemetry or grip from completion ACKs.
import type {CellAdapter,CellReport} from '../../../../cell-adapters/src/contract';
import {MockCoffeeAdapter,MockCoffeePlant,type CoffeePlantState} from '../../../../cell-adapters/src/mock-coffee';
import {MockArmAdapter,MockArmPlant,type ArmPlantState,type ArmProgramSet,type ArmTracking} from '../../../../cell-adapters/src/mock-arm';
import type {ArmModelSI} from '../models/arm-kinematics';
import type {ArmCollisionEvidenceRecord} from '../arm/session';
import type {ArmSceneSnapshot} from '../models/arm-scene';
import type {CoffeeContext,CoffeeState} from '../scenarios/coffee';
import type {CorrelatedTransferEvidence,CupLedger,CupPhysicalState} from './cup-ledger';
/** D24: every report of a plant-backed arm says what the arm plant is, so no one reads it as real dynamics. `tracking` is the per-joint |actual - commanded| over the programs that ran. */
export interface WebotsArmPlantReport {engine:'webots_3d';control:'position_servo';grip:'event';dynamics:'assumed';calibration:'not_calibrated';tracking:{samples:number;peakRad:number[];rmsRad:number[]}}
/** R2a: the MuJoCo xArm 6 grips by contact; its masses and limits are the manufacturer's nominal values, every other parameter assumed. */
export type ArmPlantReport=WebotsArmPlantReport|{engine:'mujoco_3d';engineVersion:string;control:'position_actuator';grip:'contact';dynamics:'manufacturer_nominal+assumed';calibration:'not_calibrated';tracking:{samples:number;peakRad:number[];rmsRad:number[]}}
/** R2a: what a contact arm plant's cell was built from, for the report (SX-41): the fixture's solved waypoint table and its digest, the scene's allowed contacts, the assumed release
 * timeout, and statements a person reads with the numbers. */
export interface ArmCellEvidence {waypoints:{digest:string;table:{waypoint:string;q:number[];positionErrorM:number;orientationErrorRad:number;condition:number}[]};allowedContacts:{a:string;b:string}[];releaseTimeoutTicks:number;notes:string[];
 /** What the engine was given: the fixture's componentDigest, the digest of physics.json as used (after any override) and the sceneDigest of the cell scene the worker was bound to. */inputs?:{componentDigest:string;physicsDigest:string;sceneDigest:string}}
export interface CoffeePlantPorts {
 adapters:readonly CellAdapter[];
 advance():Promise<void>;
 recover():Promise<void>;
 snapshot():{coffee:CoffeePlantState;arm:ArmPlantState|null};
 drain():readonly CellReport[];
 transferEvidence(transferId:string):CorrelatedTransferEvidence|null;
 report():{cupLedger:readonly CupPhysicalState[];arm:ArmCollisionEvidenceRecord|null;/** Set by a plant-backed arm (R1.1): what plant it is and how closely it followed the commands. */armPlant?:ArmPlantReport;/** Set by a contact arm plant (R2a). */armCell?:ArmCellEvidence};
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
export function createMockCoffeePorts(st:CoffeeState,ctx:CoffeeContext,newBootId:()=>string,options:{tracking?:ArmTracking;programs?:ArmProgramSet;model?:ArmModelSI}={}):CoffeePlantPorts {
 st.trays??={};
 const parents=new Map<string,string>();
 const coffee=new MockCoffeePlant(st.plant,ctx.nowMs,newBootId),arm=new MockArmPlant(st.arm,ctx.nowMs,newBootId,
  {take:cupId=>{const c=st.plant.cups.find(x=>x.at==='nozzle'&&(cupId===undefined||x.cupId===cupId));if(!c||!coffee.takeCup(c.cupId))return null;parents.set(c.cupId,`arm:${st.armId}/tcp`);return c.cupId;},put:(cupId,rx)=>{st.trays[rx.robotId]=cupId;parents.set(cupId,`robot:${rx.robotId}/tray:${rx.slot}`);}},ctx.receiver,options.model,options.tracking,options.programs);
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
