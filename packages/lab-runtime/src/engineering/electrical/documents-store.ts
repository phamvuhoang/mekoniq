import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {validateDriveModel,type ControlProfileV1,type DriveModelV1} from '../../v2/control/drive-io';
import {validateSafetyRequirements,validateTcoAssumptions,validateWiringPolicy,type SafetyRequirementsV1,type TcoAssumptionsV1,type WiringPolicyV1} from './contracts';

export interface ElectricalDocuments{policies:WiringPolicyV1[];registers:SafetyRequirementsV1[];tco:TcoAssumptionsV1[]}
/** Wiring policies and safety registers a design may name, read from `<catalog>/electrical/`. A file that fails its schema is not offered. A design never carries a path or URL: it names id, revision and digest. */
export async function loadElectricalDocuments(catalogRoot:string):Promise<ElectricalDocuments>{
 const dir=join(catalogRoot,'electrical'),out:ElectricalDocuments={policies:[],registers:[],tco:[]};
 for(const name of (await readdir(dir).catch(()=>[] as string[])).filter(n=>/^[A-Za-z0-9._-]+\.json$/.test(n)&&n!=='manifest.json').sort()){
  let doc:{documentType?:string};
  try{doc=JSON.parse(await readFile(join(dir,name),'utf8'));}catch{continue;}
  if(doc.documentType==='wiring-policy'&&validateWiringPolicy(doc).ok)out.policies.push(doc as WiringPolicyV1);
  else if(doc.documentType==='tco-assumptions'&&validateTcoAssumptions(doc).ok)out.tco.push(doc as TcoAssumptionsV1);
  else if(doc.documentType==='safety-requirements'&&validateSafetyRequirements(doc).ok)out.registers.push(doc as SafetyRequirementsV1);
 }
 return out;
}

/** The drive model and control profile of the plant a design is for, read from the drive fixture folder; null when either is missing or invalid, so a draft is never derived from a damaged base. */
export async function loadDriveBase(dir:string,names={model:'serve-drive-nominal-v1.json',control:'serve-control-v2.json'}):Promise<{model:DriveModelV1;control:ControlProfileV1}|null>{
 try{
  const model=JSON.parse(await readFile(join(dir,names.model),'utf8')) as DriveModelV1,control=JSON.parse(await readFile(join(dir,names.control),'utf8')) as ControlProfileV1;
  return validateDriveModel(model).ok&&control.documentType==='control-profile'?{model,control}:null;
 }catch{return null;}
}
