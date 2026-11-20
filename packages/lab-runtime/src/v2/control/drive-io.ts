// Neutral drive contract (R4-A §5): documents, refs and the controller/evidence split. Pure validation; the drive itself lives in the worker.
import Ajv from 'ajv';
import componentSchema from '../../../../contracts/schemas/engineering-component.schema.json';
import driveIoSchema from '../../../../contracts/schemas/drive-io-v1.schema.json';
import driveModelSchema from '../../../../contracts/schemas/drive-model-v1.schema.json';
import controlProfileSchema from '../../../../contracts/schemas/control-profile-v1.schema.json';
import controlEvidenceSchema from '../../../../contracts/schemas/control-evidence-v1.schema.json';
import traceManifestSchema from '../../../../contracts/schemas/drive-trace-manifest-v1.schema.json';
import benchRequestSchema from '../../../../contracts/schemas/bench-request-v1.schema.json';
import type {AxisControl,AxisDriveModel,AxisEnvelope,BenchRequestV1,BenchSignal,ControlProfileV1,DriveAxisSnapshot,DriveCommandV1,DriveFeedbackV1,DriveModelV1,TuningEnvelopeV1} from '../../../../contracts/generated/navigation2d';
import {hashJson} from '../hash';
import {withinEnvelope} from './tuning-envelope';
export type {AxisControl,AxisDriveModel,AxisEnvelope,BenchRequestV1,BenchSignal,ControlProfileV1,DriveAxisSnapshot,DriveCommandV1,DriveFeedbackV1,DriveModelV1,TuningEnvelopeV1};
export type {ControlMetric,DriveTrace,DriveMode,DriveState,DriveFault,DriveTickRecord,TuningResultV1,FaultReportV1,ControlOracleV1} from '../../../../contracts/generated/navigation2d';
export type Check={ok:boolean;reasonCodes:string[]};

const ajv=new Ajv({allErrors:true,strict:true,discriminator:true});
for(const [key,schema] of Object.entries({'drive-trace-manifest-v1.schema.json':traceManifestSchema,'engineering-component.schema.json':componentSchema,'drive-io-v1.schema.json':driveIoSchema,'drive-model-v1.schema.json':driveModelSchema,'control-profile-v1.schema.json':controlProfileSchema,'control-evidence-v1.schema.json':controlEvidenceSchema,'bench-request-v1.schema.json':benchRequestSchema}))ajv.addSchema(schema,key);
const modelShape=ajv.getSchema('drive-model-v1.schema.json')!,profileShape=ajv.getSchema('control-profile-v1.schema.json')!,envelopeShape=ajv.getSchema('control-profile-v1.schema.json#/definitions/TuningEnvelopeV1')!,refShape=ajv.getSchema('drive-io-v1.schema.json#/definitions/DriveDocumentRef')!;
const benchRequestShape=ajv.getSchema('bench-request-v1.schema.json')!,benchSignalShape=ajv.getSchema('bench-request-v1.schema.json#/definitions/BenchSignal')!;
export const validateTraceTickShape=ajv.getSchema('drive-trace-manifest-v1.schema.json#/definitions/BenchTraceTick')!;
export const validateTraceIdentityShape=ajv.getSchema('drive-trace-manifest-v1.schema.json#/definitions/BenchTraceIdentity')!;
export const validateTraceManifestShape=ajv.getSchema('drive-trace-manifest-v1.schema.json')!;
export const validateControlEvidenceShape=ajv.getSchema('control-evidence-v1.schema.json')!;
export const validateDriveAxisSnapshotShape=ajv.getSchema('drive-io-v1.schema.json#/definitions/DriveAxisSnapshot')!;
export const validateDriveCommandShape=ajv.getSchema('drive-io-v1.schema.json#/definitions/DriveCommandV1')!;

/** SHA-256 of the RFC 8785 canonical JSON without the document's own `digest` field. */
export const driveDocumentDigest=(doc:object):string=>{const {digest:_,...rest}=doc as Record<string,unknown>;void _;return hashJson(rest);};
export const sealDriveDocument=<T extends object>(doc:T):T&{digest:string}=>({...doc,digest:driveDocumentDigest(doc)});

const nonFinite=(v:unknown):boolean=>typeof v==='number'?!Number.isFinite(v):Array.isArray(v)?v.some(nonFinite):v&&typeof v==='object'?Object.values(v).some(nonFinite):false;
function shapeCodes(validate:{(v:unknown):boolean;errors?:{keyword:string;instancePath:string;params?:{error?:string;tag?:string}}[]|null},v:unknown,codes:Set<string>){
 if(validate(v))return;
 // a bench signal's tick past the bench (atTick, a hold's ticks) has one code of its own, the one validateBenchSignal gives
 for(const e of validate.errors??[]){
  if(['if','oneOf','anyOf'].includes(e.keyword))continue;
  const tagged=e.instancePath==='/signal'?(v as {signal?:object})?.signal:v;
  const missingKind=e.keyword==='discriminator'&&e.params?.tag==='kind'&&tagged&&typeof tagged==='object'&&!Object.hasOwn(tagged,'kind');
  codes.add(e.keyword==='additionalProperties'?'UNKNOWN_FIELD':e.keyword==='required'||missingKind?'FIELD_REQUIRED':e.keyword==='maximum'&&/\/(atTick|ticks)$/.test(e.instancePath)?'TICK_OUT_OF_RANGE':'INVALID_FIELD');
 }
 if(!codes.size)codes.add('INVALID_FIELD');
}
export const checkReasons=(codes:Set<string>):Check=>({ok:codes.size===0,reasonCodes:[...codes].sort()});
const duplicates=(ids:string[])=>new Set(ids).size!==ids.length;

/** The shape of a bench request or of one bench signal: closed fields, finite numbers, registered axis, scenario and experiment ids. Cross-field rules are in bench-signals.ts. */
const shapeOnly=(validate:unknown,value:unknown):Check=>{const codes=new Set<string>();if(nonFinite(value))codes.add('NON_FINITE_NUMBER');shapeCodes(validate as never,value,codes);return checkReasons(codes);};
export const validateBenchRequestShape=(value:unknown):Check=>shapeOnly(benchRequestShape,value);
export const validateBenchSignalShape=(value:unknown):Check=>shapeOnly(benchSignalShape,value);
/** The bench scenarios and the axes a bench request can name, in the schema's order (the bench catalog of health lists them). */
export const BENCH_SCENARIO_IDS=benchRequestSchema.properties.scenarioId.enum as BenchRequestV1['scenarioId'][],BENCH_AXES=benchRequestSchema.properties.axis.enum as BenchRequestV1['axis'][];

/** A device model: shape, finite numbers, unique axis ids and a matching digest. */
export function validateDriveModel(value:unknown):Check{
 const codes=new Set<string>();
 if(nonFinite(value))codes.add('NON_FINITE_NUMBER');
 shapeCodes(modelShape as never,value,codes);
 const m=value as DriveModelV1;
 if(Array.isArray(m?.axes)&&duplicates(m.axes.map(a=>a?.axisId)))codes.add('DRIVE_AXIS_DUPLICATE');
 if(m&&typeof m==='object'&&typeof m.digest==='string'&&!nonFinite(value)&&driveDocumentDigest(m)!==m.digest)codes.add('DIGEST_MISMATCH');
 return checkReasons(codes);
}

/** A tuning envelope document: shape, finite bounds with min <= max, unique axes, digest. */
export function validateTuningEnvelope(value:unknown,axes:readonly Pick<AxisDriveModel,'axisId'|'mode'>[]):Check{
 const codes=new Set<string>();
 if(nonFinite(value))codes.add('NON_FINITE_NUMBER');
 shapeCodes(envelopeShape as never,value,codes);
 const e=value as TuningEnvelopeV1;
 if(Array.isArray(e?.axes)){
  if(duplicates(e.axes.map(a=>a?.axisId)))codes.add('DRIVE_AXIS_DUPLICATE');
  const modes=new Map(axes.map(a=>[a.axisId,a.mode]));
  for(const a of e.axes){
   if(!a)continue;
   for(const k of ['kp','ki','kd','integralLimit','slewLimit','accelerationLimit'] as const){
    const b=a[k];if(b&&(b.min<0||b.min>b.max||(['integralLimit','slewLimit','accelerationLimit'].includes(k)&&b.min<=0)))codes.add('ENVELOPE_BOUND_INVALID');
   }
   const mode=modes.get(a.axisId);
   if((mode==='csv'&&(a.slewLimit||a.kd&&(a.kd.min!==0||a.kd.max!==0)))||(mode==='csp'&&a.accelerationLimit))codes.add('ENVELOPE_BOUND_INVALID');
  }
 }
 if(e&&typeof e==='object'&&typeof e.digest==='string'&&!nonFinite(value)&&driveDocumentDigest(e)!==e.digest)codes.add('DIGEST_MISMATCH');
 return checkReasons(codes);
}

/** A control profile against the drive model it is declared for and the server's envelope. One rule table per drive mode, the same as the worker's `actuator_spec` (shared vectors in robotics/simulation-mujoco/tests/data):
 * csp takes any kd, a null or positive slew and no acceleration limit; csv takes kd = 0, no slew and a null or positive acceleration limit; an integral limit exists exactly when ki > 0 (and is then positive).
 * A field the axis' envelope does not list is not accepted (null, or 0 for kd). A non-finite or negative gain and a gain outside the envelope are refused as well. */
export function validateControlProfile(value:unknown,model:DriveModelV1,envelope:TuningEnvelopeV1):Check{
 const codes=new Set<string>();
 if(nonFinite(value))codes.add('NON_FINITE_NUMBER');
 shapeCodes(profileShape as never,value,codes);
 const p=value as ControlProfileV1;
 if(!p||typeof p!=='object'||!Array.isArray(p.axes))return checkReasons(codes);
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
  if(m?.mode==='csv'){if(l.kd!==0)codes.add('CSV_KD_NONZERO');if(l.slewLimit!==null)codes.add('CSV_SLEW_LIMIT');}
  if(m?.mode==='csp'&&a.accelerationLimit!==null)codes.add('CSP_ACCELERATION_LIMIT');
  if(l.ki>0&&!(typeof l.integralLimit==='number'&&l.integralLimit>0))codes.add('INTEGRAL_LIMIT_REQUIRED');
  if(l.ki===0&&l.integralLimit!==null)codes.add('INTEGRAL_LIMIT_WITHOUT_KI');
  if(!env){codes.add('ENVELOPE_AXIS_MISSING');continue;}
  for(const c of withinEnvelope(a,env))codes.add(c);
 }
 return checkReasons(codes);
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
