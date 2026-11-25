import type {AxisDriveModel,ControlProfileV1,DriveModelV1} from '../../v2/control/drive-io';
import {sealDriveDocument} from '../../v2/control/drive-io';
import type {SourceRef} from '../contracts';
import type {DesignContext} from './design';
import type {CheckResult} from './contracts';

export interface DriveChange{axisId:string;field:string;from:unknown;to:unknown;source:SourceRef}
export interface DriveConfirmation{axisId:string;field:string;source:SourceRef}
const TICK_MS=20;
const chk=(ruleId:string,level:CheckResult['level'],path:string,detail:string,sources:SourceRef[]=[]):CheckResult=>({ruleId,level,path,detail,sources});
/** Fields of each maturity group that a device profile can supply; a group becomes `manufacturer` only when every field named here came from a manufacturer document on every axis. */
const GROUP_FIELDS={encoder:['encoder.countsPerRev'],watchdog:['watchdogTicks']} as const;

/**
 * A new revision of a drive model from the device profiles of a design: a field changes only when the profile has a manufacturer source for it.
 * `confirmed` lists fields whose value already equals the documented one (the number stays, its source improves). `base` is never modified.
 * The model stays `not_calibrated`; the delay, torque and following-error groups have no source in a profile and keep the base's.
 */
export function deriveDriveModel(base:DriveModelV1,context:DesignContext,control:ControlProfileV1|null=null):{model:DriveModelV1;changes:DriveChange[];confirmed:DriveConfirmation[];checks:CheckResult[]}{
 const {design,profiles}=context,changes:DriveChange[]=[],confirmed:DriveConfirmation[]=[],checks:CheckResult[]=[];
 const axes:AxisDriveModel[]=base.axes.map(a=>structuredClone(a));
 const touched=new Map<string,Map<string,SourceRef>>();           // group field -> axis -> source
 const note=(field:string,axisId:string,source:SourceRef)=>{const m=touched.get(field)??new Map<string,SourceRef>();m.set(axisId,source);touched.set(field,m);};
 for(const a of axes){
  const map=design.axes.find(x=>x.axisId===a.axisId),drive=map&&profiles.get(map.driveDeviceId)?.drive;
  if(!drive)continue;
  const counts=drive.feedback.countsPerRev;
  if(counts&&counts.source.kind==='manufacturer'){
   if(a.encoder.countsPerRev!==counts.value){changes.push({axisId:a.axisId,field:'encoder.countsPerRev',from:a.encoder.countsPerRev,to:counts.value,source:counts.source});a.encoder.countsPerRev=counts.value;}
   else confirmed.push({axisId:a.axisId,field:'encoder.countsPerRev',source:counts.source});
   note('encoder.countsPerRev',a.axisId,counts.source);
  }
  const wd=drive.watchdog;
  if(wd.source.kind==='manufacturer'&&wd.rangeMs&&a.watchdogTicks!==null){
   const lo=Math.max(1,Math.ceil(wd.rangeMs[0]/TICK_MS)),hi=Math.max(lo,Math.floor(wd.rangeMs[1]/TICK_MS)),clamped=Math.min(hi,Math.max(lo,a.watchdogTicks));
   if(clamped!==a.watchdogTicks){changes.push({axisId:a.axisId,field:'watchdogTicks',from:a.watchdogTicks,to:clamped,source:wd.source});a.watchdogTicks=clamped;note('watchdogTicks',a.axisId,wd.source);}
  }
  // velocity-controlled wheels on a drive that only ramps by itself need the acceleration the ramp will use
  if(!drive.modes.includes('csv')&&drive.modes.includes('pv')){
   const cp=control?.axes.find(x=>x.axisId===a.axisId);
   if(control&&cp&&cp.accelerationLimit===null)checks.push(chk('ELD_MODE_UNSUPPORTED','blocking',`/axes/${a.axisId}`,`pv needs an acceleration limit: ${a.axisId} has none in the control profile`,[drive.watchdog.source]));
  }
  const stops=design.stopFunctions.filter(f=>f.axes.includes(a.axisId)&&f.finalState==='torque_off_brake');
  if(stops.length&&drive.stop.brakeOutputPointId===null)checks.push(chk('ELD_STOP_UNSUPPORTED','blocking',`/axes/${a.axisId}`,`${stops[0]!.id} ends in torque_off_brake but the profile of ${map!.driveDeviceId} has no brake output`));
 }
 const sources={...base.sources};
 for(const [group,fields] of Object.entries(GROUP_FIELDS)){
  const all=fields.map(f=>touched.get(f)),ok=all.every(m=>m&&axes.every(a=>m.has(a.axisId)));
  if(ok)sources[group as keyof typeof sources]=[...all[0]!.values()][0]!;
 }
 const model=sealDriveDocument({...base,id:`${base.id}-${design.option.id}`.slice(0,200),revision:base.revision+1,axes,sources}) as DriveModelV1;
 return {model,changes,confirmed,checks};
}

/** A control profile for the same plant with the acceleration limit a pv-only drive will ramp with, taken from the profile's documented value; other fields stay. */
export function deriveControlProfile(base:ControlProfileV1,context:DesignContext,driveModelDigests:readonly string[]):ControlProfileV1{
 const axes=base.axes.map(a=>{
  const d=context.design.axes.find(x=>x.axisId===a.axisId),drive=d&&context.profiles.get(d.driveDeviceId)?.drive;
  return {...a,accelerationLimit:!drive||drive.modes.includes('csv')?a.accelerationLimit:drive.profileAccelerationRadS2?.value??a.accelerationLimit};
 });
 return sealDriveDocument({...base,id:`${base.id}-${context.design.option.id}`.slice(0,200),revision:base.revision+1,axes,driveModelDigests:[...driveModelDigests]}) as ControlProfileV1;
}
