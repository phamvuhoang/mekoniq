import type {ComponentRevision,EngineeringProject,Problem} from '../shared/engineering';
import type {DriveInput} from '../estimates/drive';
import type {EnergyInput} from '../estimates/energy';
import type {StabilityInput} from '../estimates/stability';
import type {EngineeringArchiveFiles} from '../project/engineering-archive';
import {componentDigest} from '../project/engineering-archive';

export interface EngineeringEstimateInputs {
  energy:EnergyInput|null;
  /** Everything the assembly can supply; acceleration, rolling resistance and slope are scenario choices the caller adds. */
  drive:Omit<DriveInput,'accelerationMps2'|'rollingResistance'|'slopeRadians'>|null;
  stability:StabilityInput|null;
  problems:Problem[];
}
type Scalar={value:number};
const miss=(code:string,path:string,detail:string):Problem=>({code,path,blocking:false,detail});
/**
 * Inputs for the existing calculators, taken only from the engineering design and its local closure. A value the design does not state stays absent and is reported;
 * service-preset numbers are never borrowed.
 */
export function engineeringEstimateInputs(project:EngineeringProject,content:EngineeringArchiveFiles):EngineeringEstimateInputs {
  const problems:Problem[]=[],byDigest=new Map<string,ComponentRevision>(content.manifest.components.map(c=>[componentDigest(c),c]));
  const parts=project.assembly.instances.map(i=>({instance:i,component:byDigest.get(i.componentDigest)}));
  for (const p of parts) if (!p.component) problems.push(miss('COMPONENT_MISSING',`/assembly/instances/${p.instance.id}`,'component revision is not in the local closure'));
  const known=parts.filter(p=>p.component);
  const amr=project.runtimeProject.entities.find(e=>e.kind==='amr');
  const bound=new Set(project.entityBindings.find(b=>b.entityId===amr?.id)?.instanceIds??[]);
  const mine=known.filter(p=>bound.has(p.instance.id));
  // drive: the AMR's drive model is the single source of wheel radius, ratio and efficiency
  let drive:EngineeringEstimateInputs['drive']=null;
  type Model={drive?:{wheelRadiusM:Scalar};transmission:{ratio:Scalar;efficiency:Scalar};torqueSpeedTable:{torque:Scalar}[]};
  const num=(s:unknown,positive=true)=>!!s&&typeof (s as Scalar).value==='number'&&Number.isFinite((s as Scalar).value)&&(!positive||(s as Scalar).value>0);
  const usable=(m:Model|null):m is Model=>!!m&&typeof m==='object'&&num(m.transmission?.ratio)&&num(m.transmission?.efficiency)&&m.transmission.efficiency.value<=1&&Array.isArray(m.torqueSpeedTable)&&m.torqueSpeedTable.length>0&&m.torqueSpeedTable.every(r=>num(r?.torque,false))&&(!m.drive||num(m.drive.wheelRadiusM));
  const modelOf=(c:ComponentRevision)=>c.models.filter(m=>m.kind==='actuator').flatMap(m=>{
    const bytes=content.files[`blobs/${m.digest}`];
    if (!bytes) {problems.push(miss('MODEL_BLOB_MISSING',`/components/${c.id}/models/${m.id}`,m.digest));return [];}
    let parsed:Model|null=null;
    try {parsed=JSON.parse(new TextDecoder().decode(bytes)) as Model;} catch {/* reported below */}
    if (!usable(parsed)) {problems.push(miss('MODEL_INVALID',`/components/${c.id}/models/${m.id}`,'the blob is not a usable actuator model'));return [];}
    return [parsed];
  });
  const driveModel=mine.flatMap(p=>modelOf(p.component!)).find(m=>m.drive);
  if (!amr) problems.push(miss('NO_AMR_ENTITY','/runtimeProject/entities','the project has no AMR'));
  else if (!driveModel) problems.push(miss('DRIVE_MODEL_UNAVAILABLE',`/entityBindings/${amr.id}`,'no drive model with explicit wheel radius is available'));
  else if (parts.some(p=>bound.has(p.instance.id)&&!p.component)) problems.push(miss('DRIVE_MASS_INCOMPLETE',`/entityBindings/${amr.id}`,'a bound component is missing, so the AMR mass is unknown'));
  else {
    const ratio=driveModel.transmission.ratio.value,eff=driveModel.transmission.efficiency.value,stall=Math.max(...driveModel.torqueSpeedTable.map(r=>r.torque.value));
    const massKg=mine.flatMap(p=>p.component!.links).reduce((n,l)=>n+l.massKg.value,0);
    drive={massKg,wheelRadiusM:driveModel.drive!.wheelRadiusM.value,drivenWheels:2,gearRatio:ratio,gearEfficiency:eff,peakMotorTorqueNm:stall/(ratio*eff)};
    // no continuous rating is stated by the model, so the calculator reports it as missing rather than assuming one
  }
  // energy: voltage comes from the battery's supplying power port; capacity and usable fraction only from a catalog rating that names that same port
  const supplier=mine.map(p=>p.component!).flatMap(c=>c.ports.filter(p=>p.kind==='power'&&p.direction==='out'&&p.voltageRangeV).map(port=>({component:c,port})))[0];
  const rating=supplier&&supplier.component.battery?.portId===supplier.port.id?supplier.component.battery:undefined;
  const energy:EnergyInput|null=supplier?{volts:(supplier.port.voltageRangeV![0]+supplier.port.voltageRangeV![1])/2,...rating?{ampHours:rating.capacityAh.value,usable:rating.usableFraction.value}:{}}:null;
  if(!rating)problems.push(miss('ENERGY_CAPACITY_UNAVAILABLE','/components','no battery rating (capacity in Ah and usable fraction) names the supplying power port; the runtime estimate stays unavailable'));
  problems.push(miss('STABILITY_UNAVAILABLE','/components','support points are catalog data, but world positions come from the compiled assembly; stability stays unavailable until a bundle supplies placements'));
  return {energy,drive,stability:null,problems};
}

export interface EstimateSummary {massKg:number|null;nominalUsableWh:number|null;missing:{code:string;detail:string}[]}
/**
 * What the design itself supports saying: AMR mass, and usable battery energy before any duty or derating (those are scenario choices). Anything the design
 * does not state is listed as missing, never filled from a preset.
 */
export function estimateSummary(project:EngineeringProject,content:EngineeringArchiveFiles):EstimateSummary {
  const r=engineeringEstimateInputs(project,content),e=r.energy;
  return {massKg:r.drive?.massKg??null,nominalUsableWh:e?.volts&&e.ampHours&&e.usable?e.volts*e.ampHours*e.usable:null,missing:r.problems.map(p=>({code:p.code,detail:p.detail}))};
}
