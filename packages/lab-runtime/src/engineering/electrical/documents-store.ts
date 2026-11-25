import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
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
