import type {BomLine,DesignSummary,Issue,RobotDesign} from '../shared/types';
import fixture from '../../fixtures/catalog/service-illustrative.json' with {type:'json'};
import {calculateBom} from '../cost/bom';
import {estimateEnergy} from '../estimates/energy';

export interface ComponentConstraint {
  id:string;massKg:number;widthM:number;lengthM:number;heightM:number;
  voltageMin?:number;voltageMax?:number;supplyVolts?:number;
  connector?:string;requiredConnector?:string;maxPayloadKg?:number;
  sensorInputs?:number;requiredSensorInputs?:number;occluded?:boolean;
}
export const catalogProvenance=Object.freeze({id:fixture.id,revision:fixture.revision,provenance:'illustrative',notice:fixture.notice});
export function footprintForDesign(design:RobotDesign):{widthM:number;lengthM:number}|null {
  if (design.chassis!=='service') return null;
  const base=fixture.items.find(item=>item.id==='base')!;
  return {widthM:base.widthM,lengthM:base.lengthM};
}
export function capabilitiesFor(design:RobotDesign) {
  return {editableDrive:design.chassis==='service',editableBattery:design.chassis==='service',editableSensor:design.chassis==='service',editableTrays:true,payloadVerified:false,nativeSpeedControl:false,hardwareValidation:'not_run' as const};
}
export function validateDesign(design:RobotDesign,catalog?:readonly ComponentConstraint[]):Issue[] {
  const issues:Issue[]=[];
  const add=(code:string,field:string,message:string)=>issues.push({code,field,message});
  if (!Number.isInteger(design.trays)||design.trays<2||design.trays>4) add('TRAY_RANGE','trays','Choose 2–4 trays for this illustrative model.');
  if (!Number.isFinite(design.batteryAh)||design.batteryAh<10||design.batteryAh>40) add('BATTERY_RANGE','batteryAh','Battery input must be 10–40 Ah for this model.');
  if (!Number.isFinite(design.payloadKg)||design.payloadKg<0) add('PAYLOAD_RANGE','payloadKg','Payload intent must be finite and nonnegative.');
  if (!['service','valetudo'].includes(design.chassis)) add('UNKNOWN_CHASSIS','chassis','Unknown chassis profile.');
  if (!['lidar','depth'].includes(design.sensor)) add('UNKNOWN_SENSOR','sensor','Unknown sensor selection.');
  if (design.chassis==='valetudo'&&(design.batteryAh!==20||design.sensor!=='lidar')) add('VALETUDO_DRIVETRAIN_LOCKED','chassis','Valetudo battery and native sensor controls are locked; reference values do not describe a measured device.');
  for (const item of catalog??fixture.items) {
    const constraint=item as ComponentConstraint;
    if (![constraint.massKg,constraint.widthM,constraint.lengthM,constraint.heightM].every(v=>Number.isFinite(v)&&v>0)) add('MISSING_GEOMETRY',item.id,'Finite mass and dimensions are required before generating a footprint.');
    const {voltageMin,voltageMax,supplyVolts}=constraint;
    if (voltageMin!==undefined||voltageMax!==undefined||supplyVolts!==undefined) {
      if (![voltageMin,voltageMax,supplyVolts].every(v=>typeof v==='number'&&Number.isFinite(v))||voltageMin!>voltageMax!||supplyVolts!<voltageMin!||supplyVolts!>voltageMax!) add('VOLTAGE_MISMATCH',item.id,'Supply voltage does not fit the component voltage interval.');
    }
    if (constraint.requiredConnector&&constraint.connector!==constraint.requiredConnector) add('CONNECTOR_MISMATCH',item.id,'Required connector is unavailable.');
    if (constraint.maxPayloadKg!==undefined&&design.payloadKg>constraint.maxPayloadKg) add('PAYLOAD_EXCEEDED',item.id,'Payload intent exceeds the supplied component limit.');
    if (constraint.requiredSensorInputs!==undefined&&(constraint.sensorInputs??0)<constraint.requiredSensorInputs) add('SENSOR_INPUTS_MISSING',item.id,'Insufficient sensor inputs.');
    if (constraint.occluded) add('SENSOR_OCCLUDED',item.id,'Sensor visibility is obstructed.');
  }
  return issues;
}
export function summarizeDesign(design:RobotDesign):DesignSummary {
  const lines:BomLine[]=[];
  const item=(id:string)=>fixture.items.find(item=>item.id===id)!;
  const append=(id:string,sourceId=id,massKg=item(sourceId).massKg,priceMinor:string|null=item(sourceId).priceMinor)=>{
    const source=item(sourceId);
    lines.push({id,name:source.name,quantity:1,massKg,priceMinor,currency:'VND',provenance:'illustrative'});
  };
  if (design.chassis==='service') {
    append('base');append('drive');
    append('battery','battery',design.batteryAh*0.22,design.batteryAh===20 ? item('battery').priceMinor : null);
    append('power');append('compute');append(design.sensor);
  } else {
    lines.push({id:'base',name:'Valetudo reference body · unmeasured',quantity:1,massKg:0,priceMinor:null,currency:'VND',provenance:'illustrative'});
  }
  // Bound iteration even for an incomplete imported design.
  for (let i=1;i<=Math.min(4,Math.max(0,design.trays));i++) append(`tray-${i}`,'tray');
  append('tablet');
  const costs=calculateBom(lines,'VND');
  const energy=design.chassis==='service' ? estimateEnergy({volts:fixture.nominalVolts,ampHours:design.batteryAh,usable:fixture.usableFraction,derating:fixture.batteryDerating,watts:fixture.averageBatteryWatts}) : null;
  return {...costs,lines,massKg:design.chassis==='service' ? lines.reduce((sum,line)=>sum+line.quantity*line.massKg,0)+design.payloadKg : null,usableWh:energy?.usableWh??null,runtimeHours:energy?.runtimeHours??null,issues:validateDesign(design)};
}
