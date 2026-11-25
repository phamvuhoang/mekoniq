import type {DeviceProfileV1,SafetyClaim} from './contracts';
import type {SourceRef,Problem} from '../contracts';
import type {DescriptionSummary} from '../catalog';
import {problem} from './contracts';

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

const MODE_CODE:Record<string,string>={pp:'pp',pv:'pv',pt:'pt',csp:'csp',csv:'csv',cst:'cst'};
/** '60FDh:00' and '60FD:00' name the same object; sub-index defaults to 0. */
const objectKey=(o:string)=>{const m=/^(?:0x)?([0-9A-Fa-f]{4})h?(?::([0-9A-Fa-f]{1,2}))?$/.exec(o);return m?{index:m[1]!.toUpperCase(),subindex:m[2]?parseInt(m[2],16):0}:null;};
/** The profile is hand-written; the pinned description file is the manufacturer's own dictionary. Contradictions are caught here, agreement proves nothing about pins. */
export function crossCheckDescription(p:DeviceProfileV1,s:DescriptionSummary):Problem[]{
 const out:Problem[]=[],find=(index:string,subindex:number)=>s.objects.find(o=>o.index===index&&o.subindex===subindex);
 p.ioPoints.forEach((pt,i)=>{
  if(!pt.busExposure.object)return;
  const k=objectKey(pt.busExposure.object),o=k&&find(k.index,k.subindex),at=`/ioPoints/${i}/busExposure`;
  if(!o)out.push(problem('OBJECT_UNKNOWN',at+'/object',pt.busExposure.object));
  else if(pt.busExposure.kind==='cyclic'&&!o.pdoMappable)out.push(problem('BUS_EXPOSURE_CONTRADICTS_DESCRIPTION',at,`${pt.busExposure.object} cannot be mapped to a PDO in the description file`));
 });
 if(p.drive&&s.supportedModes.length)for(const m of p.drive.modes)if(!s.supportedModes.includes(MODE_CODE[m]!))out.push(problem('MODE_CONTRADICTS_DESCRIPTION','/drive/modes',`${m} is not in the supported-modes mask of the description file`));
 return out;
}
