import type {ResolvedAssembly} from '../contracts';
import {problem,type DeviceProfileV1,type ElectricalDesignV1,type Problem,type SafetyRequirementsV1} from './contracts';

export interface DesignContext{design:ElectricalDesignV1;profiles:ReadonlyMap<string,DeviceProfileV1>;resolved:ResolvedAssembly;project:{id:string;revision:number;digest:string}}
/**
 * Steps 1 to 3 of the compile order (contracts §3): catalog and project admission. A problem here is a refusal, not a check result.
 * `deviceProfiles` is the catalog's map (keyed by digest); a device is matched by profile id and revision, then its digest must agree.
 */
export function admitElectricalDesign(design:ElectricalDesignV1,input:{resolved:ResolvedAssembly;project:{id:string;revision:number;digest:string};deviceProfiles:Record<string,DeviceProfileV1>;driveAxisIds:readonly string[]}):{problems:Problem[];context:DesignContext|null}{
 const out:Problem[]=[],profiles=new Map<string,DeviceProfileV1>(),all=Object.values(input.deviceProfiles);
 if(design.project.id!==input.project.id||design.project.revision!==input.project.revision)out.push(problem('ELECTRICAL_PROJECT_MISMATCH','/project',`design is for ${design.project.id}@${design.project.revision}, project is ${input.project.id}@${input.project.revision}`));
 const instanceComponent=new Map(input.resolved.bom.lines.flatMap(l=>l.instanceIds.map(i=>[i,l.componentDigest] as const))),placed=new Set(input.resolved.placements.map(p=>p.instanceId));
 design.devices.forEach((d,i)=>{
  const path=`/devices/${i}`,profile=all.find(p=>p.id===d.profile.id&&p.revision===d.profile.revision);
  if(!profile){out.push(problem('DEVICE_PROFILE_UNAVAILABLE',path+'/profile',`${d.profile.id}@${d.profile.revision}`));return;}
  if(profile.digest!==d.profile.digest){out.push(problem('DEVICE_PROFILE_DIGEST_MISMATCH',path+'/profile/digest',`design ${d.profile.digest}, catalog ${profile.digest}`));return;}
  profiles.set(d.id,profile);
  if(d.assemblyInstanceId===null)return;
  if(!placed.has(d.assemblyInstanceId))out.push(problem('ELECTRICAL_INSTANCE_UNKNOWN',path+'/assemblyInstanceId',d.assemblyInstanceId));
  else if(instanceComponent.get(d.assemblyInstanceId)!==profile.component.digest)out.push(problem('ELD_PROFILE_COMPONENT_MISMATCH',path+'/profile',`profile describes component ${profile.component.digest}, instance ${d.assemblyInstanceId} is ${String(instanceComponent.get(d.assemblyInstanceId))}`));
 });
 const mapped=new Set(design.axes.map(a=>a.axisId));
 input.driveAxisIds.forEach((a,i)=>{if(!mapped.has(a))out.push(problem('ELD_AXIS_UNMAPPED',`/axes/${i}`,`drive axis ${a} has no drive in the electrical design`));});
 return {problems:out,context:out.length?null:{design,profiles,resolved:input.resolved,project:input.project}};
}

/**
 * Pure function of the register. `documented` needs a safety manual or certificate and, for every device named, a torque-off claim or a safety device;
 * `bench_tested` is not reachable here: it exists only with a signed measurement record (lane L-BENCH).
 */
export function safetyEvidenceStatus(r:SafetyRequirementsV1['requirements'][number],profileOf:(deviceId:string)=>DeviceProfileV1|undefined=()=>undefined):'open'|'documented'{
 if(!r.documents.some(d=>d.kind==='safety_manual'||d.kind==='certificate'))return 'open';
 return r.deviceIds.every(id=>{const p=profileOf(id);return !!p&&(p.kind==='safety_device'||!!p.drive?.stop.torqueOff);})?'documented':'open';
}
