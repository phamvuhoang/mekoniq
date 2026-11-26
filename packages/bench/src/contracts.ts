// Bench-agent contracts (K02): hand-written types that mirror robotics/bench/schemas/*.json, plus the Ajv validators and the semantic admission rules.
import {readFileSync} from 'node:fs';
import Ajv,{type ErrorObject} from 'ajv';
import componentSchema from '../../contracts/schemas/engineering-component.schema.json';
import driveIoSchema from '../../contracts/schemas/drive-io-v1.schema.json';
import {hashJson} from '../../lab-runtime/src/v2/hash';
import type {DriveCommandV1,DriveFeedbackV1} from '../../lab-runtime/src/v2/control/drive-io';

export type SourceRef={kind:'manufacturer'|'measured'|'derived'|'assumed';documentId:string;revision:string;locator:string;contentSha256:string;uncertaintyAbs?:number};
export type Scalar={value:number;unit:string;source:SourceRef};
type DocRef={id:string;revision:number;digest:string};
export interface BenchKitV1{
 schemaVersion:1;documentType:'bench-kit';id:string;revision:number;digest:string;electricalDesign:DocRef|null;
 power:{motor:'dc_low_voltage'|'ac_mains';nominalV:number;logicSeparate:boolean;source:SourceRef};
 bus:{backend:'sim'|'soem';interface:string|null;cycleMs:1|2|4;sync:'dc_sync0'|'sm_sync'|'free_run';mode:'csv'|'pv'};
 simSlave?:{defaultRxPdo:string[];requiresDc:boolean;[knob:string]:unknown};
 axes:{axisId:string;slavePosition:number;profile:DocRef;expect:{vendorId:string;productCode:string;revision:string|null};pdo:{rx:string[];tx:string[]};
  units:{positionCountsPerRev:Scalar;velocityRawPerRadS:Scalar;ratedTorqueNm:Scalar|null;polarity:1|-1;gearRatio:number};
  sdoWrites:{object:string;value:number;bytes:1|2|4;why:string;source:SourceRef}[];
  faultMap?:Record<string,NonNullable<DriveFeedbackV1['fault']>|'OTHER'>}[];   // 603Fh '0x7500' -> neutral fault; OTHER and unmapped codes become EXTERNAL_TRIP
 limits:{maxSpeedRadS:number;maxAccelRadS2:number;maxTorquePermille:number;source:SourceRef};
 channel:{interpolation:'hold'|'linear';watchdogTicks:number;quickStopRestRadS?:number;quickStopHoldMs?:number;wkcErrorCyclesToLoss?:number};   // worker defaults 0.05, 2000, 5
 sensors:{lidar:{driver:'ld19';port:string;baud:number;profile:DocRef}|null;imu:{driver:'wit';port:string;baud:number;rateHz:number;algorithm:'6axis'|'9axis';profile:DocRef}|null};
}
export interface BenchSessionV1{
 schemaVersion:1;documentType:'bench-session';operator:string;observer:string|null;location:string;startedAt:string;
 declarations:{estopCutsMotorPower:boolean;estopTestedToday:boolean;motorsClamped:boolean;shaftLoad:'bare'|'marker_disc';powerWiredBy:string;mainsQualified:boolean|null;readManualSections:string[]};
 instruments:{id:string;kind:'tape'|'marker'|'multimeter'|'other';note:string}[];
}
export interface BenchPolicy{
 schemaVersion:1;documentType:'bench-policy';digest:string;source:SourceRef;
 tickLatenessMaxMs:number;enableTimeoutTicks:number;trackingToleranceRadS:{relative:number;absolute:number};settleMs:number;revolutionCheck:{revolutions:number;toleranceDeg:number};
 velocityUnitTolerance:number;creepSpeedRadS:number;restSpeedRadS:number;lagLevels:number[];lagTrials:number;silenceMs:number;soakMinutes:number;wkcErrorCyclesToLoss:number;
 delaySplit:'even_command_first';validationTrialsPerCondition:number;lidarDistancesM:number[];badFrameFractionMax:number;shadowStaleAfterMs:number;
}
export interface BenchTickRecord{schemaVersion:1;tick:number;tMonoNs:number;latenessNs:number;armed:boolean;driveCommands:DriveCommandV1[];feedback:DriveFeedbackV1[];vendor:{axisId:string;statusword:number;errorCode:number|null}[]}
export interface BenchCycleRow{cycle:number;tMonoNs:number;wkc:number;axes:{axisId:string;controlword:number;statusword:number;targetRaw:number;positionRaw:number;velocityRaw:number|null;torqueRaw:number|null}[]}
export interface HostIdentity{os:string;kernel:string;cpu:string;nicDriver:string;nicMacSha256:string;python:string;pysoem:string;node:string;testLevel:'protocol_double'|'hardware'}
export interface WorkerIdentity{protocol:'mekoniq-bench/1';version:string;busBackend:'sim'|'soem';lockSha256:string}
export interface Measurement{id:string;value:number;unit:string;uncertaintyAbs:number;caseId:string;n:number}
export interface BenchRecordV1{
 schemaVersion:1;documentType:'bench-record';accepted:false;hardwareValidated:false;controlAuthority:false;
 candidateId:string;sourceCommit:string;host:HostIdentity;worker:WorkerIdentity;kit:DocRef;
 parts:Record<'identity'|'conformance'|'measure'|'sensors'|'compare',{manifestSha256:string;kitDigest:string}|null>;
 policyDigest:string;conditions:{shaftLoad:'bare'|'marker_disc';busMode:'csv'|'pv';cycleMs:number;sync:string};
 devices:{deviceId:string;profileId:string;vendorId:string;productCode:string;revision:string;serial:string;firmware:string|null}[];
 deviations:{id:string;text:string}[];
 cases:Record<string,{status:'tested'|'failed'|'not_run'|'unsupported_by_device';reason:string|null;session:string|null;artifacts:string[]}>;
 gates:Record<string,{status:'tested'|'failed'|'not_run'|'blocked_external';accepted:false}>;
 closures:{ruleId:string;path:string;result:'confirmed'|'contradicted'|'not_measured';caseId:string|null;observed:string|null}[];
 measurements:Measurement[];externalGates:{'G-SAFE1':{status:'blocked_external';accepted:false}};
 artifacts:{path:string;sha256:string;bytes:number}[];
}

/** Hard-coded B1 ceilings; a kit may ask for less, never more. */
export const BENCH_CEILINGS={maxSpeedRadS:30,maxTorquePermille:300} as const;
export type Problem={code:string;path:string;detail:string};

const problem=(code:string,path:string,detail:string):Problem=>({code,path,detail});
const load=(f:string):object=>JSON.parse(readFileSync(new URL(`../../../robotics/bench/schemas/${f}`,import.meta.url),'utf8')) as object;
const ajv=new Ajv({allErrors:true,strict:true});
ajv.addSchema(componentSchema,'engineering-component.schema.json');ajv.addSchema(driveIoSchema,'drive-io-v1.schema.json');
for(const f of ['kit','session','policy','tick','wire','record'])ajv.addSchema(load(`bench-${f}-v1.schema.json`));

/** SHA-256 of the RFC 8785 canonical JSON without the document's own `digest`. */
export const sealBench=<T extends {digest:string}>(doc:Omit<T,'digest'>):T=>({...doc,digest:hashJson(doc)} as unknown as T);
const digestOk=(doc:{digest:string}):boolean=>{const {digest:_,...rest}=doc;void _;return hashJson(rest)===doc.digest;};

const schemaProblems=(errors:ErrorObject[]|null|undefined):Problem[]=>(errors??[]).filter(e=>!['if','anyOf'].includes(e.keyword)).map(e=>{
 const extra=e.keyword==='required'?`/${String(e.params.missingProperty)}`:e.keyword==='additionalProperties'?`/${String(e.params.additionalProperty)}`:'';
 return problem('SCHEMA_INVALID',e.instancePath+extra,e.message??'invalid');
});
/** Schema first; the semantic rules only run on a document of the right shape. */
const check=<T>(ref:string,doc:unknown,rules:(d:T)=>Problem[]=()=>[]):Problem[]=>{
 const v=ajv.getSchema(`mekoniq.bench-${ref}`)!;
 return v(doc)?rules(doc as T):schemaProblems(v.errors);
};

const idx=(object:string)=>parseInt(object.slice(0,4),16);
/** 0x1010 (store parameters), every PDO mapping or assignment object (the worker maps PDOs itself), and every object that commands motion or state
 * (controlword, mode, targets, offsets, digital outputs). The same list is `MOTION` in robotics/bench/bench_worker/session.py (BENCH_SDO_NOT_LISTED); keep them equal. */
const SDO_MOTION=[0x1010,0x6040,0x6060,0x60ff,0x6071,0x607a,0x60b1,0x60b2,0x60fe];
const sdoForbidden=(object:string)=>{const n=idx(object);return SDO_MOTION.includes(n)||(n>=0x1600&&n<=0x17ff)||(n>=0x1a00&&n<=0x1bff)||n===0x1c12||n===0x1c13;};
const lacks=(list:string[],need:string[])=>need.filter(o=>!list.some(x=>x.toUpperCase()===o));

function kitRules(k:BenchKitV1):Problem[]{
 const out:Problem[]=[];
 if(!digestOk(k))out.push(problem('KIT_DIGEST_MISMATCH','/digest','stored digest does not match the document'));
 if(k.simSlave&&k.bus.backend!=='sim')out.push(problem('KIT_SIM_SLAVE_FORBIDDEN','/simSlave','simSlave is only legal when bus.backend is "sim"'));
 const ids=new Set<string>(),pos=new Set<number>(),rx=['6040:00','60FF:00']; // controlword + target velocity (60FFh serves both csv and pv)
 k.axes.forEach((a,i)=>{
  const base=`/axes/${i}`;
  if(ids.has(a.axisId))out.push(problem('KIT_AXIS_DUPLICATE',`${base}/axisId`,a.axisId));ids.add(a.axisId);
  if(pos.has(a.slavePosition))out.push(problem('KIT_SLAVE_POSITION_DUPLICATE',`${base}/slavePosition`,String(a.slavePosition)));pos.add(a.slavePosition);
  const noRx=lacks(a.pdo.rx,rx),noTx=lacks(a.pdo.tx,['6041:00','6064:00']);
  if(noRx.length)out.push(problem('KIT_PDO_RX_INCOMPLETE',`${base}/pdo/rx`,`missing ${noRx.join(', ')}`));
  if(noTx.length)out.push(problem('KIT_PDO_TX_INCOMPLETE',`${base}/pdo/tx`,`missing ${noTx.join(', ')}`));
  a.sdoWrites.forEach((w,j)=>{if(sdoForbidden(w.object))out.push(problem('KIT_SDO_FORBIDDEN',`${base}/sdoWrites/${j}/object`,w.object));});
 });
 for(const key of Object.keys(BENCH_CEILINGS) as (keyof typeof BENCH_CEILINGS)[])if(k.limits[key]>BENCH_CEILINGS[key])out.push(problem('KIT_LIMIT_ABOVE_CEILING',`/limits/${key}`,`${k.limits[key]} > ${BENCH_CEILINGS[key]}`));
 return out;
}
const SOFTWARE_GATES=['G-KSW1','G-KREG1'];
/** The label is derived from the bus backend, so it cannot be chosen: only the simulated bus is `protocol_double`, and a `protocol_double` record never grants a hardware gate. */
const recordRules=(r:BenchRecordV1):Problem[]=>{
 const sim=r.worker.busBackend==='sim',double=r.host.testLevel==='protocol_double',out:Problem[]=[];
 if(sim&&!double)out.push(problem('RECORD_SIM_NOT_DOUBLE','/host/testLevel','a record from the simulated bus must be labelled protocol_double'));
 if(!sim&&double)out.push(problem('RECORD_HARDWARE_MARKED_DOUBLE','/host/testLevel','a record from the real bus cannot be labelled protocol_double'));
 if(double)for(const [id,g] of Object.entries(r.gates))if(!SOFTWARE_GATES.includes(id)&&g.status!=='blocked_external')out.push(problem('RECORD_DOUBLE_GRANTS_HARDWARE_GATE',`/gates/${id}/status`,'a protocol_double record can only leave a hardware gate blocked_external'));
 return out;
};

export const validateBenchKit=(doc:unknown):{ok:true;kit:BenchKitV1}|{ok:false;problems:Problem[]}=>{const p=check<BenchKitV1>('kit.v1',doc,kitRules);return p.length?{ok:false,problems:p}:{ok:true,kit:doc as BenchKitV1};};
export const validateBenchSession=(doc:unknown):{ok:true;session:BenchSessionV1}|{ok:false;problems:Problem[]}=>{const p=check('session.v1',doc);return p.length?{ok:false,problems:p}:{ok:true,session:doc as BenchSessionV1};};
export const validateBenchPolicy=(doc:unknown):{ok:true;policy:BenchPolicy}|{ok:false;problems:Problem[]}=>{
 const p=check<BenchPolicy>('policy.v1',doc,d=>digestOk(d)?[]:[problem('POLICY_DIGEST_MISMATCH','/digest','stored digest does not match the document')]);
 return p.length?{ok:false,problems:p}:{ok:true,policy:doc as BenchPolicy};
};
export const validateBenchRecord=(doc:unknown):{ok:true;record:BenchRecordV1}|{ok:false;problems:Problem[]}=>{const p=check<BenchRecordV1>('record.v1',doc,recordRules);return p.length?{ok:false,problems:p}:{ok:true,record:doc as BenchRecordV1};};
export const validateBenchTick=(doc:unknown):Problem[]=>check('tick.v1',doc);
export const validateBenchCycle=(doc:unknown):Problem[]=>check('tick.v1#/definitions/BenchCycleRow',doc);
export const validateBenchWire=(kind:'request'|'response',doc:unknown):Problem[]=>check(`wire.v1#/definitions/${kind==='request'?'BenchRequest':'BenchResponse'}`,doc);

/** Empty means the declared session may start torque cases on this kit. The declarations are the operator's word; software cannot check them. */
export function sessionAllowsTorque(s:BenchSessionV1,kit:BenchKitV1):Problem[]{
 const d=s.declarations,out:Problem[]=[];
 if(d.estopCutsMotorPower!==true)out.push(problem('SESSION_ESTOP_REQUIRED','/declarations/estopCutsMotorPower','the e-stop must cut motor power'));
 if(d.motorsClamped!==true)out.push(problem('SESSION_CLAMP_REQUIRED','/declarations/motorsClamped','motors must be clamped'));
 if(!d.powerWiredBy.trim())out.push(problem('SESSION_POWER_OWNER_REQUIRED','/declarations/powerWiredBy','name who wired the motor power'));
 if(d.shaftLoad!=='bare'&&d.shaftLoad!=='marker_disc')out.push(problem('SESSION_SHAFT_LOAD_INVALID','/declarations/shaftLoad',String(d.shaftLoad))); // fail closed even if the caller skipped validateBenchSession
 if(kit.power.motor==='ac_mains'&&d.mainsQualified!==true)out.push(problem('SESSION_MAINS_QUALIFICATION_REQUIRED','/declarations/mainsQualified','an ac_mains kit needs a qualified person'));
 return out;
}
