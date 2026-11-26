import {readFileSync} from 'node:fs';
import Ajv from 'ajv';
import {describe,expect,it} from 'vitest';
import driveIo from '../../packages/contracts/schemas/drive-io-v1.schema.json';
import component from '../../packages/contracts/schemas/engineering-component.schema.json';
import {BENCH_CEILINGS,sealBench,sessionAllowsTorque,validateBenchCycle,validateBenchKit,validateBenchPolicy,validateBenchRecord,validateBenchSession,validateBenchTick,validateBenchWire} from '../../packages/bench/src/contracts';
import type {BenchKitV1,BenchRecordV1,BenchSessionV1,BenchTickRecord} from '../../packages/bench/src/contracts';

const fixture=(name:string)=>JSON.parse(readFileSync(new URL(`../../robotics/bench/fixtures/${name}`,import.meta.url),'utf8')) as BenchKitV1;
const dc=fixture('kit-sim-v1.json'),ac=fixture('kit-sim-ac-v1.json');
/** A re-sealed copy of the DC kit with one change, so the digest is never the second finding. */
/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- the variants write deliberately invalid values */
type Loose=any;
const variant=(edit:(k:Loose)=>void,base:BenchKitV1=dc)=>{const k=structuredClone(base) as Loose;edit(k);const {digest:_,...rest}=k;void _;return sealBench<BenchKitV1>(rest);};
const codes=(doc:unknown)=>{const r=validateBenchKit(doc);return r.ok?[]:[...new Set(r.problems.map(p=>p.code))];};

describe('bench kit',()=>{
 it('kit-sim-v1.json is valid',()=>{const r=validateBenchKit(dc);expect(r.ok).toBe(true);});
 it('kit-sim-ac-v1.json is valid',()=>{expect(validateBenchKit(ac).ok).toBe(true);});
 it('ceilings are the hard-coded B1 values',()=>{expect(BENCH_CEILINGS).toEqual({maxSpeedRadS:30,maxTorquePermille:300});});
 it('two axes on one slavePosition',()=>{expect(codes(variant(k=>{k.axes[1].slavePosition=1;}))).toEqual(['KIT_SLAVE_POSITION_DUPLICATE']);});
 it('two axes with one axisId',()=>{expect(codes(variant(k=>{k.axes[1].axisId=k.axes[0].axisId;}))).toEqual(['KIT_AXIS_DUPLICATE']);});
 it('pdo.rx without the controlword',()=>{expect(codes(variant(k=>{k.axes[0].pdo.rx=['60FF:00'];}))).toEqual(['KIT_PDO_RX_INCOMPLETE']);});
 it('csv without the target velocity',()=>{expect(codes(variant(k=>{k.axes[0].pdo.rx=['6040:00'];}))).toEqual(['KIT_PDO_RX_INCOMPLETE']);});
 it('pdo.tx without the statusword',()=>{expect(codes(variant(k=>{k.axes[0].pdo.tx=['6064:00'];}))).toEqual(['KIT_PDO_TX_INCOMPLETE']);});
 it('pdo.tx without the position',()=>{expect(codes(variant(k=>{k.axes[0].pdo.tx=['6041:00'];}))).toEqual(['KIT_PDO_TX_INCOMPLETE']);});
 it('sdoWrites containing 0x1010',()=>{expect(codes(variant(k=>{k.axes[0].sdoWrites=[{object:'1010:01',value:1,bytes:4,why:'x',source:k.power.source}];}))).toEqual(['KIT_SDO_FORBIDDEN']);});
 it('sdoWrites containing a PDO mapping object',()=>{expect(codes(variant(k=>{k.axes[0].sdoWrites=[{object:'1600:01',value:1,bytes:4,why:'x',source:k.power.source}];}))).toEqual(['KIT_SDO_FORBIDDEN']);});
 it('maxSpeedRadS above the ceiling',()=>{expect(codes(variant(k=>{k.limits.maxSpeedRadS=31;}))).toEqual(['KIT_LIMIT_ABOVE_CEILING']);});
 it('maxTorquePermille above the ceiling',()=>{expect(codes(variant(k=>{k.limits.maxTorquePermille=301;}))).toEqual(['KIT_LIMIT_ABOVE_CEILING']);});
 it('cycleMs 3 is a schema error',()=>{const r=validateBenchKit(variant(k=>{k.bus.cycleMs=3;}));expect(r.ok).toBe(false);if(!r.ok)expect(r.problems.map(p=>[p.code,p.path])).toEqual([['SCHEMA_INVALID','/bus/cycleMs']]);});
 it('power.motor outside the two values is a schema error',()=>{const r=validateBenchKit(variant(k=>{k.power.motor='ac_low';}));expect(r.ok).toBe(false);if(!r.ok)expect(r.problems[0]).toMatchObject({code:'SCHEMA_INVALID',path:'/power/motor'});});
 it('a wrong digest is reported',()=>{expect(codes({...dc,digest:'0'.repeat(64)})).toEqual(['KIT_DIGEST_MISMATCH']);});
 it('simSlave with the soem backend is refused',()=>{expect(codes(variant(k=>{k.bus.backend='soem';k.bus.interface='eth0';}))).toEqual(['KIT_SIM_SLAVE_FORBIDDEN']);});
});

describe('bench session',()=>{
 const session:BenchSessionV1={schemaVersion:1,documentType:'bench-session',operator:'op',observer:null,location:'bench',startedAt:'2026-11-26T09:00:00Z',declarations:{estopCutsMotorPower:true,estopTestedToday:true,motorsClamped:true,shaftLoad:'bare',powerWiredBy:'An',mainsQualified:null,readManualSections:['3.2']},instruments:[]};
 const edit=(d:Partial<BenchSessionV1['declarations']>)=>({...session,declarations:{...session.declarations,...d}});
 const codesOf=(s:BenchSessionV1,k=dc)=>sessionAllowsTorque(s,k).map(p=>p.code);
 it('a complete session on a DC kit is allowed',()=>{expect(validateBenchSession(session).ok).toBe(true);expect(codesOf(session)).toEqual([]);});
 it('estopCutsMotorPower false',()=>{expect(codesOf(edit({estopCutsMotorPower:false}))).toEqual(['SESSION_ESTOP_REQUIRED']);});
 it('motorsClamped false',()=>{expect(codesOf(edit({motorsClamped:false}))).toEqual(['SESSION_CLAMP_REQUIRED']);});
 it('powerWiredBy empty',()=>{expect(codesOf(edit({powerWiredBy:''}))).toEqual(['SESSION_POWER_OWNER_REQUIRED']);});
 it('an AC kit needs mainsQualified true',()=>{expect(codesOf(session,ac)).toEqual(['SESSION_MAINS_QUALIFICATION_REQUIRED']);expect(codesOf(edit({mainsQualified:false}),ac)).toEqual(['SESSION_MAINS_QUALIFICATION_REQUIRED']);expect(codesOf(edit({mainsQualified:true}),ac)).toEqual([]);});
 it('a shaftLoad outside the two values is a schema error',()=>{expect(validateBenchSession(edit({shaftLoad:'free' as never})).ok).toBe(false);});
});

describe('bench policy',()=>{
 const policy=JSON.parse(readFileSync(new URL('../../robotics/bench/fixtures/policy-v1.json',import.meta.url),'utf8'));
 it('policy-v1.json is valid and sealed',()=>{expect(validateBenchPolicy(policy).ok).toBe(true);});
 it('carries the proposed values of spec 4',()=>{expect(policy).toMatchObject({tickLatenessMaxMs:5,trackingToleranceRadS:{relative:0.05,absolute:0.05},revolutionCheck:{revolutions:10,toleranceDeg:5},delaySplit:'even_command_first',lidarDistancesM:[0.5,1.5,3.0],lagLevels:[0.25,0.5,0.75],velocityUnitTolerance:0.02,badFrameFractionMax:0.01,source:{kind:'assumed',documentId:'bench-policy'}});});
 it('a missing key or an edited value is refused',()=>{const {settleMs:_,...rest}=policy;void _;expect(validateBenchPolicy(rest).ok).toBe(false);const r=validateBenchPolicy({...policy,settleMs:1});expect(r.ok).toBe(false);if(!r.ok)expect(r.problems[0].code).toBe('POLICY_DIGEST_MISMATCH');});
});

describe('bench tick and wire',()=>{
 const tick:BenchTickRecord={schemaVersion:1,tick:7,tMonoNs:28_000_000,latenessNs:120_000,armed:true,
  driveCommands:[{axisId:'amr-1/wheel-left',seq:3,mode:'csv',target:1,enable:true,quickStop:false,faultReset:false}],
  feedback:[{axisId:'amr-1/wheel-left',state:'enabled',fault:null,commandSeq:3,positionRad:0.1,velocityRadS:0.9,torqueNm:null,tick:7}],
  vendor:[{axisId:'amr-1/wheel-left',statusword:0x1237,errorCode:null}]};
 const ajv=new Ajv({allErrors:true,strict:true});ajv.addSchema(component,'engineering-component.schema.json');ajv.addSchema(driveIo,'drive-io-v1.schema.json');
 it('feedback[] items pass the schema the virtual drive uses',()=>{const f=ajv.getSchema('drive-io-v1.schema.json#/definitions/DriveFeedbackV1')!;for(const x of tick.feedback)expect(f(x)).toBe(true);expect(f({...tick.feedback[0],extra:1})).toBe(false);});
 it('a tick row is valid, and a bad feedback item inside it is not',()=>{expect(validateBenchTick(tick)).toEqual([]);expect(validateBenchTick({...tick,feedback:[{...tick.feedback[0],state:'running'}]}).length).toBeGreaterThan(0);});
 it('a cycle row is valid',()=>{expect(validateBenchCycle({cycle:1,tMonoNs:4_000_000,wkc:3,axes:[{axisId:'amr-1/wheel-left',controlword:15,statusword:0x1237,targetRaw:0,positionRaw:10,velocityRaw:null,torqueRaw:null}]})).toEqual([]);expect(validateBenchCycle({cycle:1}).length).toBeGreaterThan(0);});
 const req={protocol:'mekoniq-bench/1',requestId:'r1',sessionId:'s1',expectedTick:0};
 it('wire requests: ops are the table of spec 3, step carries DriveCommandV1',()=>{
  for(const op of ['describe','open','scan','configure','start','silence','imuConfigure','stop'])expect(validateBenchWire('request',{...req,op,payload:{}})).toEqual([]);
  expect(validateBenchWire('request',{...req,op:'step',payload:{commands:tick.driveCommands}})).toEqual([]);
  expect(validateBenchWire('request',{...req,op:'step',payload:{commands:[{axisId:'amr-1/wheel-left'}]}}).length).toBeGreaterThan(0);
  expect(validateBenchWire('request',{...req,op:'jog',payload:{}}).length).toBeGreaterThan(0);
  expect(validateBenchWire('request',{...req,protocol:'mekoniq-bench/2',op:'stop',payload:{}}).length).toBeGreaterThan(0);});
 it('wire responses: ok carries a result, a failure carries an error',()=>{
  expect(validateBenchWire('response',{requestId:'r1',ok:true,tick:1,result:{}})).toEqual([]);
  expect(validateBenchWire('response',{requestId:'r1',ok:false,tick:1,error:{code:'BENCH_READ_ONLY',detail:'x'}})).toEqual([]);
  expect(validateBenchWire('response',{requestId:'r1',ok:false,tick:1}).length).toBeGreaterThan(0);});
});

describe('bench record',()=>{
 const sha='a'.repeat(64),part={manifestSha256:sha,kitDigest:sha};
 const record:BenchRecordV1={schemaVersion:1,documentType:'bench-record',accepted:false,hardwareValidated:false,controlAuthority:false,candidateId:'c1',sourceCommit:'abc1234',
  host:{os:'Linux',kernel:'6.8',cpu:'x',nicDriver:'igb',nicMacSha256:sha,python:'3.11',pysoem:'1.1',node:'24',testLevel:'hardware'},worker:{protocol:'mekoniq-bench/1',version:'1',busBackend:'soem',lockSha256:sha},
  kit:{id:'k',revision:1,digest:sha},parts:{identity:part,conformance:null,measure:null,sensors:null,compare:null},policyDigest:sha,conditions:{shaftLoad:'bare',busMode:'csv',cycleMs:4,sync:'sm_sync'},
  devices:[],deviations:[],cases:{KID01:{status:'tested',reason:null,session:'identity',artifacts:[]}},gates:{'G-KID1':{status:'tested',accepted:false}},closures:[],measurements:[],externalGates:{'G-SAFE1':{status:'blocked_external',accepted:false}},artifacts:[]};
 const codesOf=(r:unknown)=>{const v=validateBenchRecord(r);return v.ok?[]:v.problems.map(p=>p.code);};
 it('a well-formed record is valid',()=>{expect(validateBenchRecord(record).ok).toBe(true);});
 it('accepted:true is refused',()=>{expect(codesOf({...record,accepted:true})).toEqual(['SCHEMA_INVALID']);});
 it('hardwareValidated:true is refused',()=>{expect(codesOf({...record,hardwareValidated:true})).toEqual(['SCHEMA_INVALID']);});
 it('controlAuthority:true is refused',()=>{expect(codesOf({...record,controlAuthority:true})).toEqual(['SCHEMA_INVALID']);});
 it('a gate with accepted:true is refused',()=>{expect(validateBenchRecord({...record,gates:{'G-KID1':{status:'tested',accepted:true}}}).ok).toBe(false);});
 it('a record from the simulated bus must be labelled protocol_double',()=>{
  const r=validateBenchRecord({...record,worker:{...record.worker,busBackend:'sim'}});
  expect(r.ok).toBe(false);if(!r.ok)expect(r.problems.map(p=>[p.code,p.path])).toEqual([['RECORD_SIM_NOT_DOUBLE','/host/testLevel']]);});
 it('a record from the real bus cannot be labelled protocol_double',()=>{
  const r=validateBenchRecord({...record,host:{...record.host,testLevel:'protocol_double'},gates:{'G-KID1':{status:'blocked_external',accepted:false}}});
  expect(r.ok).toBe(false);if(!r.ok)expect(r.problems.map(p=>[p.code,p.path])).toEqual([['RECORD_HARDWARE_MARKED_DOUBLE','/host/testLevel']]);});
 it('a protocol_double record cannot grant a hardware gate',()=>{
  const sim={...record,host:{...record.host,testLevel:'protocol_double' as const},worker:{...record.worker,busBackend:'sim' as const}};
  expect(codesOf(sim)).toEqual(['RECORD_DOUBLE_GRANTS_HARDWARE_GATE']);
  expect(validateBenchRecord({...sim,gates:{'G-KSW1':{status:'tested',accepted:false},'G-KID1':{status:'blocked_external',accepted:false}}}).ok).toBe(true);});
});
