// V15 contracts at the edges: the identification plan (declared and hashed before the fit) and the calibration record (what the fit did). Shape, finite numbers, the registry and the digest; the fit itself is
// identification.ts. A record that fails a rule of "produces nothing" is an invalid DOCUMENT here, so no code path can write one that claims a revision it must not have.
import Ajv from 'ajv';
import componentSchema from '../../../contracts/schemas/engineering-component.schema.json';
import calibrationSchema from '../../../contracts/schemas/engineering-calibration.schema.json';
import planSchema from '../../../contracts/schemas/identification-plan-v1.schema.json';
import recordSchema from '../../../contracts/schemas/calibration-record-v1.schema.json';
import type {CalibrationRecordV1,IdentificationPlanV1} from '../../../contracts/generated/navigation2d';
import {checkReasons,driveDocumentDigest,nonFinite,shapeCodes,type Check} from '../v2/control/drive-io';
import {isIdentifiablePath} from './parameter-paths';
export type {CalibrationRecordV1,IdentificationPlanV1};
const ajv=new Ajv({allErrors:true,strict:true});
for(const [key,schema] of Object.entries({'engineering-component.schema.json':componentSchema,'engineering-calibration.schema.json':calibrationSchema,'identification-plan-v1.schema.json':planSchema,'calibration-record-v1.schema.json':recordSchema}))ajv.addSchema(schema,key);
const planShape=ajv.getSchema('identification-plan-v1.schema.json')!,recordShape=ajv.getSchema('calibration-record-v1.schema.json')!;
/** R4-D44: at most 12 parameters, so the Jacobian stays small enough to read and the engine runs stay bounded. */
export const IDENTIFICATION_MAX_PARAMETERS=12;

export function validateIdentificationPlan(value:unknown):Check{
 const codes=new Set<string>();
 if(nonFinite(value))codes.add('NON_FINITE_NUMBER');
 shapeCodes(planShape as never,value,codes);
 const p=value as IdentificationPlanV1;
 if(!p||typeof p!=='object'||!Array.isArray(p.parameters))return checkReasons(codes);
 if(p.parameters.length>IDENTIFICATION_MAX_PARAMETERS)codes.add('TOO_MANY_PARAMETERS');
 const paths=p.parameters.map(x=>x?.path);
 if(new Set(paths).size!==paths.length)codes.add('PARAMETER_DUPLICATE');
 for(const x of p.parameters){
  if(!x||typeof x!=='object')continue;
  if(typeof x.path==='string'&&!isIdentifiablePath(x.path))codes.add('PARAMETER_PATH_UNREGISTERED');
  if(typeof x.lower==='number'&&typeof x.upper==='number'&&!(x.lower<x.upper))codes.add('BOUNDS_INVALID');
  else if(typeof x.initial==='number'&&typeof x.lower==='number'&&typeof x.upper==='number'&&(x.initial<x.lower||x.initial>x.upper))codes.add('INITIAL_OUT_OF_BOUNDS');
 }
 const o=p.objective;
 if(o&&Array.isArray(o.channels)&&o.weights&&typeof o.weights==='object'){
  for(const c of o.channels)if(!(c in o.weights))codes.add('OBJECTIVE_WEIGHT_MISSING');
  for(const c of Object.keys(o.weights))if(!o.channels.includes(c))codes.add('OBJECTIVE_WEIGHT_UNDECLARED');
 }
 if(typeof p.digest==='string'&&!nonFinite(value)&&driveDocumentDigest(p)!==p.digest)codes.add('DIGEST_MISMATCH');
 return checkReasons(codes);
}
export function validateCalibrationRecord(value:unknown):Check{
 const codes=new Set<string>();
 if(nonFinite(value))codes.add('NON_FINITE_NUMBER');
 shapeCodes(recordShape as never,value,codes);
 const r=value as CalibrationRecordV1;
 if(r&&typeof r==='object'&&typeof r.digest==='string'&&!nonFinite(value)&&driveDocumentDigest(r)!==r.digest)codes.add('DIGEST_MISMATCH');
 return checkReasons(codes);
}
