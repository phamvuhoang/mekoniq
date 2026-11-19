// Neutral drive contract (R4-A §5): documents, refs and the controller/evidence split. Pure validation; the drive itself lives in the worker.
import Ajv from 'ajv';
import componentSchema from '../../../../contracts/schemas/engineering-component.schema.json';
import driveIoSchema from '../../../../contracts/schemas/drive-io-v1.schema.json';
import driveModelSchema from '../../../../contracts/schemas/drive-model-v1.schema.json';
import controlProfileSchema from '../../../../contracts/schemas/control-profile-v1.schema.json';
import controlEvidenceSchema from '../../../../contracts/schemas/control-evidence-v1.schema.json';
import type {AxisDriveModel,AxisEnvelope,ControlProfileV1,DriveAxisSnapshot,DriveCommandV1,DriveFeedbackV1,DriveModelV1,TuningEnvelopeV1} from '../../../../contracts/generated/navigation2d';
import {hashJson} from '../hash';
export type {AxisDriveModel,AxisEnvelope,ControlProfileV1,DriveAxisSnapshot,DriveCommandV1,DriveFeedbackV1,DriveModelV1,TuningEnvelopeV1};
export type {ControlMetric,DriveTrace,DriveMode,DriveState,DriveFault,DriveTickRecord,TuningResultV1,FaultReportV1,ControlOracleV1} from '../../../../contracts/generated/navigation2d';
export type Check={ok:boolean;reasonCodes:string[]};

const ajv=new Ajv({allErrors:true,strict:true});
for(const [key,schema] of Object.entries({'engineering-component.schema.json':componentSchema,'drive-io-v1.schema.json':driveIoSchema,'drive-model-v1.schema.json':driveModelSchema,'control-profile-v1.schema.json':controlProfileSchema,'control-evidence-v1.schema.json':controlEvidenceSchema}))ajv.addSchema(schema,key);
const modelShape=ajv.getSchema('drive-model-v1.schema.json')!,profileShape=ajv.getSchema('control-profile-v1.schema.json')!,envelopeShape=ajv.getSchema('control-profile-v1.schema.json#/definitions/TuningEnvelopeV1')!,refShape=ajv.getSchema('drive-io-v1.schema.json#/definitions/DriveDocumentRef')!;
export const validateControlEvidenceShape=ajv.getSchema('control-evidence-v1.schema.json')!;
export const validateDriveAxisSnapshotShape=ajv.getSchema('drive-io-v1.schema.json#/definitions/DriveAxisSnapshot')!;
export const validateDriveCommandShape=ajv.getSchema('drive-io-v1.schema.json#/definitions/DriveCommandV1')!;

/** SHA-256 of the RFC 8785 canonical JSON without the document's own `digest` field. */
export const driveDocumentDigest=(doc:object):string=>{const {digest:_,...rest}=doc as Record<string,unknown>;void _;return hashJson(rest);};
export const sealDriveDocument=<T extends object>(doc:T):T&{digest:string}=>({...doc,digest:driveDocumentDigest(doc)});

const nonFinite=(v:unknown):boolean=>typeof v==='number'?!Number.isFinite(v):Array.isArray(v)?v.some(nonFinite):v&&typeof v==='object'?Object.values(v).some(nonFinite):false;
function shapeCodes(validate:{(v:unknown):boolean;errors?:{keyword:string}[]|null},v:unknown,codes:Set<string>){
 if(validate(v))return;
 for(const e of validate.errors??[]){if(['if','oneOf','anyOf'].includes(e.keyword))continue;codes.add(e.keyword==='additionalProperties'?'UNKNOWN_FIELD':e.keyword==='required'?'FIELD_REQUIRED':'INVALID_FIELD');}
 if(!codes.size)codes.add('INVALID_FIELD');
}
const done=(codes:Set<string>):Check=>({ok:codes.size===0,reasonCodes:[...codes].sort()});
const duplicates=(ids:string[])=>new Set(ids).size!==ids.length;

/** A device model: shape, finite numbers, unique axis ids and a matching digest. */
export function validateDriveModel(value:unknown):Check{
 const codes=new Set<string>();
 if(nonFinite(value))codes.add('NON_FINITE_NUMBER');
 shapeCodes(modelShape as never,value,codes);
 const m=value as DriveModelV1;
 if(Array.isArray(m?.axes)&&duplicates(m.axes.map(a=>a?.axisId)))codes.add('DRIVE_AXIS_DUPLICATE');
 if(m&&typeof m==='object'&&typeof m.digest==='string'&&!nonFinite(value)&&driveDocumentDigest(m)!==m.digest)codes.add('DIGEST_MISMATCH');
 return done(codes);
}

/** A tuning envelope document: shape, finite bounds with min <= max, unique axes, digest. */
export function validateTuningEnvelope(value:unknown):Check{
 const codes=new Set<string>();
 if(nonFinite(value))codes.add('NON_FINITE_NUMBER');
 shapeCodes(envelopeShape as never,value,codes);
 const e=value as TuningEnvelopeV1;
 if(Array.isArray(e?.axes)){
  if(duplicates(e.axes.map(a=>a?.axisId)))codes.add('DRIVE_AXIS_DUPLICATE');
  for(const a of e.axes)for(const k of ['kp','ki','kd','integralLimit','slewLimit','accelerationLimit'] as const)if(a?.[k]&&a[k].min>a[k].max)codes.add('ENVELOPE_BOUND_INVALID');
 }
 if(e&&typeof e==='object'&&typeof e.digest==='string'&&!nonFinite(value)&&driveDocumentDigest(e)!==e.digest)codes.add('DIGEST_MISMATCH');
 return done(codes);
}

const inside=(x:number,b:{min:number;max:number})=>x>=b.min&&x<=b.max;
/** A control profile against the drive model it is declared for and the server's envelope. A non-finite or negative gain, a kd on a velocity axis, an unbounded integral and a gain outside the envelope are all refused. */
export function validateControlProfile(value:unknown,model:DriveModelV1,envelope:TuningEnvelopeV1):Check{
 const codes=new Set<string>();
 if(nonFinite(value))codes.add('NON_FINITE_NUMBER');
 shapeCodes(profileShape as never,value,codes);
 const p=value as ControlProfileV1;
 if(!p||typeof p!=='object'||!Array.isArray(p.axes))return done(codes);
 const ids=p.axes.map(a=>a?.axisId);
 if(duplicates(ids))codes.add('DRIVE_AXIS_DUPLICATE');
 const modelAxes=new Map(model.axes.map(a=>[a.axisId,a]));
 if(ids.length!==modelAxes.size||ids.some(id=>!modelAxes.has(id)))codes.add('AXIS_SET_MISMATCH');
 if(!(p.driveModelDigests??[]).includes(model.digest))codes.add('DRIVE_MODEL_DIGEST_MISMATCH');
 if(typeof p.digest==='string'&&!nonFinite(value)&&driveDocumentDigest(p)!==p.digest)codes.add('DIGEST_MISMATCH');
 const bounds=new Map(envelope.axes.map(a=>[a.axisId,a]));
 for(const a of p.axes){
  const m=modelAxes.get(a?.axisId),env=bounds.get(a?.axisId),l=a?.loop;
  if(!l)continue;
  if(m?.mode==='csv'&&l.kd!==0)codes.add('CSV_KD_NONZERO');
  if(l.ki>0&&l.integralLimit===null)codes.add('INTEGRAL_LIMIT_REQUIRED');
  if(!env){codes.add('ENVELOPE_AXIS_MISSING');continue;}
  const checks:[number|null,keyof AxisEnvelope][]=[[l.kp,'kp'],[l.ki,'ki'],[l.kd,'kd'],[l.integralLimit,'integralLimit'],[l.slewLimit,'slewLimit'],[a.accelerationLimit,'accelerationLimit']];
  for(const [x,k] of checks)if(typeof x==='number'&&Number.isFinite(x)&&!inside(x,env[k] as {min:number;max:number}))codes.add('GAIN_OUT_OF_ENVELOPE');
 }
 return done(codes);
}

/** `engine.driveModelRef` and `engine.controlProfileRef` come as a pair or not at all; each ref is a bundle path, never a URL or an escaping path. */
export function validateDriveRefs(scene:{engine:Record<string,unknown>}):Check{
 const e=scene.engine??{},m=e.driveModelRef,c=e.controlProfileRef;
 if((m===undefined)!==(c===undefined))return {ok:false,reasonCodes:['DRIVE_PROFILE_PAIR_REQUIRED']};
 if(m===undefined)return {ok:true,reasonCodes:[]};
 return refShape(m)&&refShape(c)?{ok:true,reasonCodes:[]}:{ok:false,reasonCodes:['DRIVE_REF_INVALID']};
}

/** The controller sees measured values only. The recorder keeps everything, including the true state. */
export function splitDriveSnapshot(drives:readonly DriveAxisSnapshot[]):{feedback:DriveFeedbackV1[];evidence:DriveAxisSnapshot[]}{
 return {feedback:drives.map(d=>({axisId:d.axisId,state:d.state,fault:d.fault,commandSeq:d.commandSeq,positionRad:d.positionRad,velocityRadS:d.velocityRadS,torqueNm:d.torqueNm,tick:d.tick})),evidence:drives.map(d=>({...d}))};
}
