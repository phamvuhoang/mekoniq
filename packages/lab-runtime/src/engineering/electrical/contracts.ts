import Ajv,{type ErrorObject} from 'ajv';
import addFormats from 'ajv-formats';
import componentSchema from '../../../../contracts/schemas/engineering-component.schema.json';
import deviceProfileSchema from '../../../../contracts/schemas/device-profile-v1.schema.json';
import {documentDigest,sealDocument} from '../../v2/navigation2d/contracts';
import {classifyField} from '../../v2/contracts';
import {ALLOWED_UNITS,type Checked,type Problem,type Scalar} from '../contracts';
import type {DeviceProfileV1} from '../../../../contracts/generated/engineering';
export type {DeviceProfileV1,IOPointV1,DriveCapabilityV1,SafetyClaim,DeviceDocument} from '../../../../contracts/generated/engineering';
export type {Checked,Problem};

const ajv=new Ajv({allErrors:true,strict:true,discriminator:true});addFormats(ajv);
for(const [key,schema] of Object.entries({'engineering-component.schema.json':componentSchema,'device-profile-v1.schema.json':deviceProfileSchema}))ajv.addSchema(schema,key);

export const problem=(code:string,path:string,detail:string):Problem=>({code,path,blocking:true,detail});
function schemaProblems(errors:ErrorObject[]|null|undefined):Problem[]{
 return (errors??[]).filter(e=>!['if','anyOf','oneOf'].includes(e.keyword)).map(e=>e.keyword==='additionalProperties'?problem(classifyField(String(e.params.additionalProperty)),e.instancePath,`Property "${String(e.params.additionalProperty)}" is not allowed`)
  :e.keyword==='required'?problem('FIELD_REQUIRED',e.instancePath,`Missing "${String(e.params.missingProperty)}"`):problem('INVALID_FIELD',e.instancePath,e.message??'invalid'));
}
/** Schema first; the semantic rules only run on a document of the right shape. */
export const check=<T>(key:string,extra?:(value:T)=>Problem[])=>(input:unknown):Checked=>{
 const validate=ajv.getSchema(key);if(!validate)throw new Error(`ELECTRICAL_SCHEMA_MISSING ${key}`);
 if(!validate(input))return {ok:false,problems:schemaProblems(validate.errors)};
 const problems=extra?.(input as T)??[];
 return {ok:problems.length===0,problems};
};
export const registerSchema=(key:string,schema:object)=>{if(!ajv.getSchema(key))ajv.addSchema(schema,key);};
/** Digest of the document without its own `digest` field (RFC 8785 canonical JSON). */
export const sealElectrical=<T extends object>(doc:T):T&{digest:string}=>sealDocument(doc,'digest') as T&{digest:string};
export const electricalDigest=(doc:object)=>documentDigest(doc,'digest');
export const dupes=(ids:string[],base:string,code='DUPLICATE_ID'):Problem[]=>{const seen=new Set<string>();return ids.flatMap((id,i)=>seen.has(id)?[problem(code,`${base}/${i}`,id)]:(seen.add(id),[]));};
/** Every Scalar-shaped node ({value,unit,source}) of a document, with its path. */
export function scalars(value:unknown,path=''):{path:string;scalar:Scalar}[]{
 if(Array.isArray(value))return value.flatMap((v,i)=>scalars(v,`${path}/${i}`));
 if(!value||typeof value!=='object')return [];
 const o=value as Record<string,unknown>,self=typeof o.unit==='string'&&typeof o.value==='number'&&'source' in o?[{path,scalar:o as unknown as Scalar}]:[];
 return [...self,...Object.entries(o).flatMap(([k,v])=>scalars(v,`${path}/${k}`))];
}
export const unitProblems=(doc:unknown,base=''):Problem[]=>scalars(doc,base).filter(s=>!(ALLOWED_UNITS as readonly string[]).includes(s.scalar.unit)).map(s=>problem('UNIT_NOT_ALLOWED',s.path+'/unit',`"${s.scalar.unit}" is not an allowed unit`));
const unitIs=(s:Scalar|null|undefined,unit:string,path:string):Problem[]=>s&&s.unit!==unit?[problem('UNIT_NOT_ALLOWED',path+'/unit',`expected ${unit}, got "${s.unit}"`)]:[];

function deviceProfileRules(p:DeviceProfileV1):Problem[]{
 const out:Problem[]=[...unitProblems(p),
  ...dupes(p.documents.map(d=>d.id),'/documents'),...dupes(p.connectors.map(c=>c.id),'/connectors'),...dupes(p.ioPoints.map(i=>i.pointId),'/ioPoints','DUPLICATE_POINT_ID'),...dupes(p.interfaces.map(i=>i.id),'/interfaces')];
 const pins=new Set(p.connectors.flatMap(c=>c.pins.map(x=>`${c.id}/${x.pin}`))),docs=new Set(p.documents.map(d=>d.id)),points=new Set(p.ioPoints.map(i=>i.pointId));
 p.connectors.forEach((c,i)=>out.push(...dupes(c.pins.map(x=>x.pin),`/connectors/${i}/pins`,'DUPLICATE_PIN')));
 const claim=(c:{documentId:string;certificate:{documentId:string}|null}|null,path:string)=>{
  if(!c)return;
  if(!docs.has(c.documentId))out.push(problem('SAFETY_DOCUMENT_UNKNOWN',path+'/documentId',c.documentId));
  if(c.certificate&&!docs.has(c.certificate.documentId))out.push(problem('SAFETY_DOCUMENT_UNKNOWN',path+'/certificate/documentId',c.certificate.documentId));
 };
 p.ioPoints.forEach((pt,i)=>{
  const base=`/ioPoints/${i}`;
  for(const [field,pin] of [['pin',pt.pin],['commonPin',pt.commonPin]] as const)if(pin!==null&&!pins.has(pin))out.push(problem('IO_PIN_UNKNOWN',`${base}/${field}`,`${pin} is not a pin of any connector`));
  if(pt.busExposure.kind==='cyclic'&&!pt.busExposure.object)out.push(problem('BUS_EXPOSURE_OBJECT_MISSING',`${base}/busExposure/object`,'a cyclic point must name its object'));
  if(pt.direction==='output'&&!pt.electrical.maxCurrentA)out.push(problem('OUTPUT_CURRENT_MISSING',`${base}/electrical/maxCurrentA`,'an output must state its maximum current'));
  out.push(...unitIs(pt.electrical.maxCurrentA,'A',`${base}/electrical/maxCurrentA`));
  if(pt.electrical.voltageRangeV[0]>pt.electrical.voltageRangeV[1])out.push(problem('VOLTAGE_RANGE_INVERTED',`${base}/electrical/voltageRangeV`,'low bound above high bound'));
  if(pt.safety&&pt.functions.includes('general_purpose'))out.push(problem('SAFETY_ON_GENERAL_PURPOSE',`${base}/safety`,'a general purpose point cannot carry a safety claim'));
  claim(pt.safety,`${base}/safety`);
 });
 if(p.drive){
  const d=p.drive;
  if(p.kind!=='servo_drive')out.push(problem('DRIVE_ON_NON_DRIVE','/drive',`kind ${p.kind} cannot carry drive capability`));
  if(d.modes.includes('pv')&&!d.modes.includes('csv')&&!d.profileAccelerationRadS2)out.push(problem('PROFILE_ACCELERATION_MISSING','/drive/profileAccelerationRadS2','a pv-only drive ramps by itself; its profile acceleration is required'));
  out.push(...unitIs(d.ratedCurrentA,'A','/drive/ratedCurrentA'),...unitIs(d.peakCurrentA,'A','/drive/peakCurrentA'),...unitIs(d.profileAccelerationRadS2,'rad/s^2','/drive/profileAccelerationRadS2'));
  claim(d.stop.torqueOff,'/drive/stop/torqueOff');
  for(const [field,ids] of [['torqueOffPointIds',d.stop.torqueOffPointIds],['monitorOutputPointId',d.stop.monitorOutputPointId?[d.stop.monitorOutputPointId]:[]],['brakeOutputPointId',d.stop.brakeOutputPointId?[d.stop.brakeOutputPointId]:[]]] as const)
   ids.forEach(id=>{if(!points.has(id))out.push(problem('DRIVE_POINT_UNKNOWN',`/drive/stop/${field}`,id));});
  out.push(...dupes(d.faultMap.map(f=>f.vendorCode),'/drive/faultMap','DUPLICATE_FAULT_CODE'));
 }
 p.interfaces.forEach((x,i)=>{if(x.descriptionDocumentId&&!docs.has(x.descriptionDocumentId))out.push(problem('DESCRIPTION_DOCUMENT_UNKNOWN',`/interfaces/${i}/descriptionDocumentId`,x.descriptionDocumentId));});
 return out;
}
export const validateDeviceProfile=check<DeviceProfileV1>('device-profile-v1.schema.json',deviceProfileRules);
