import type {DeviceProfileV1,SafetyClaim} from './contracts';
import type {SourceRef} from '../contracts';

export type EvidenceLevel='candidate'|'documented';
const CODES=['ORDER_CODE_MISSING','DATASHEET_MISSING','MANUAL_MISSING','ASSUMED_SOURCE','DESCRIPTION_FILE_MISSING','SAFETY_MANUAL_MISSING'] as const;

/** Every SourceRef of the profile in document order: pins, I/O points, interfaces, drive. */
export function profileSources(p:DeviceProfileV1):SourceRef[]{
 const out:SourceRef[]=[],visit=(v:unknown)=>{
  if(Array.isArray(v))v.forEach(visit);
  else if(v&&typeof v==='object'){const o=v as Record<string,unknown>;if(typeof o.kind==='string'&&typeof o.contentSha256==='string'&&typeof o.documentId==='string'&&'locator' in o)out.push(o as unknown as SourceRef);else Object.values(o).forEach(visit);}
 };
 visit([p.connectors,p.ioPoints,p.interfaces,p.drive]);
 return out;
}
const claims=(p:DeviceProfileV1):SafetyClaim[]=>[...p.ioPoints.flatMap(i=>i.safety?[i.safety]:[]),...(p.drive?.stop.torqueOff?[p.drive.stop.torqueOff]:[])];

/** Pure function of the document and its sources; there is no field to type a level into. A null firmware does not lower it (the bench checklist carries it). */
export function deviceEvidenceLevel(p:DeviceProfileV1):{level:EvidenceLevel;missing:string[]}{
 const has=(kind:string)=>p.documents.some(d=>d.kind===kind),declared=new Set(p.documents.map(d=>`${d.id}:${d.digest}`));
 const needsDescription=p.interfaces.some(i=>i.profile==='cia402')||p.ioPoints.some(i=>i.busExposure.kind==='cyclic');
 const missing=new Set<string>();
 if(!p.variant.orderCode)missing.add('ORDER_CODE_MISSING');
 if(!has('datasheet'))missing.add('DATASHEET_MISSING');
 if(!has('manual'))missing.add('MANUAL_MISSING');
 if(profileSources(p).some(s=>s.kind!=='manufacturer'||!declared.has(`${s.documentId}:${s.contentSha256}`)))missing.add('ASSUMED_SOURCE');
 if(needsDescription&&!has('description_file'))missing.add('DESCRIPTION_FILE_MISSING');
 if(claims(p).length&&!has('safety_manual'))missing.add('SAFETY_MANUAL_MISSING');
 const list=CODES.filter(c=>missing.has(c));
 return {level:list.length?'candidate':'documented',missing:list};
}

/** `certified` only when a certificate document of this profile names the profile's order code. Everything else is the manual's words. */
export function safetyClaimLevel(c:SafetyClaim,p:DeviceProfileV1):'manual_only'|'certified'{
 const cert=c.certificate;
 return cert&&p.variant.orderCode&&p.documents.some(d=>d.id===cert.documentId&&d.kind==='certificate')&&cert.models.includes(p.variant.orderCode)?'certified':'manual_only';
}
