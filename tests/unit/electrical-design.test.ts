/* eslint-disable @typescript-eslint/no-explicit-any */
import {describe,expect,test} from 'vitest';
import type {ResolvedAssembly} from '../../packages/lab-runtime/src/engineering/contracts';
import {validateElectricalDesign,validateWiringPolicy,validateSafetyRequirements} from '../../packages/lab-runtime/src/engineering/electrical/contracts';
import {admitElectricalDesign,safetyEvidenceStatus} from '../../packages/lab-runtime/src/engineering/electrical/design';
import {design,driveProfile,safetyRequirements,signal,wiringPolicy,DOC_DIGEST} from '../support/electrical';

const codes=(r:{problems:{code:string}[]})=>r.problems.map(p=>p.code);
const edit=<T>(base:T,f:(x:any)=>void):T=>{const x=structuredClone(base);f(x);return x;};

describe('electrical design shape',()=>{
 test('the builder output validates',()=>{expect(validateElectricalDesign(design())).toEqual({ok:true,problems:[]});});
 test('a safety-chain signal can never carry a pinned allocation',()=>{
  const d=design({signals:[signal({id:'estop-chain',consumer:'safety_chain',maxLatencyMs:null,pinned:{deviceId:'drive-left',pointId:'IN2'}})]});
  expect(codes(validateElectricalDesign(d))).toContain('SAF_SIGNAL_ON_ORDINARY_IO');
 });
 test.each([
  ['a duplicate device id',(d:any)=>{d.devices[1].id='drive-left';},'DUPLICATE_ID'],
  ['a duplicate axis',(d:any)=>{d.axes.push({...d.axes[0]});},'DUPLICATE_AXIS'],
  ['a controller signal without a latency',(d:any)=>{d.signals[0].maxLatencyMs=null;},'SIGNAL_LATENCY_REQUIRED'],
  ['two stop functions with one id',(d:any)=>{const f={id:'normal',trigger:{kind:'operator'},axes:['amr-1/wheel-left'],finalState:'hold',requirementId:null};d.stopFunctions=[f,{...f}];},'DUPLICATE_ID'],
  ['a missing wiring policy reference',(d:any)=>{delete d.wiringPolicyRef;},'FIELD_REQUIRED'],
  ['a stop trigger that names no signal',(d:any)=>{d.stopFunctions=[{id:'protective',trigger:{kind:'signal',signalId:'nope'},axes:['amr-1/wheel-left'],finalState:'disabled',requirementId:null}];},'STOP_TRIGGER_UNKNOWN'],
  ['a signal on an unknown device',(d:any)=>{d.signals[0].field.deviceId='ghost';},'ELECTRICAL_DEVICE_UNKNOWN'],
  ['an unknown field',(d:any)=>{d.extra=true;},'UNKNOWN_FIELD'],
 ])('rejects %s',(_n,f,code)=>{expect(codes(validateElectricalDesign(edit(design(),f)))).toContain(code);});
 test('the size limits are shape errors',()=>{
  const dev=design().devices[0]!;
  expect(codes(validateElectricalDesign(edit(design(),(d:any)=>{d.devices=Array.from({length:65},(_,i)=>({...dev,id:'d'+i}));})))).toContain('INVALID_FIELD');
  expect(codes(validateElectricalDesign(edit(design(),(d:any)=>{d.signals=Array.from({length:129},(_,i)=>({...d.signals[0],id:'s'+i}));})))).toContain('INVALID_FIELD');
 });
});

describe('wiring policy and safety register',()=>{
 test('valid policy',()=>{expect(validateWiringPolicy(wiringPolicy()).ok).toBe(true);});
 test('a cross-section table that does not ascend is rejected',()=>{expect(codes(validateWiringPolicy(wiringPolicy({ampacity:[{csaMm2:1,maxCurrentA:{value:10,unit:'A',source:wiringPolicy().sources.ampacity}},{csaMm2:0.5,maxCurrentA:{value:12,unit:'A',source:wiringPolicy().sources.ampacity}}]})))).toContain('WIRING_TABLE_NOT_ASCENDING');});
 test.each([0,0.21,-1])('a voltage drop fraction of %s is out of range',v=>{expect(codes(validateWiringPolicy(wiringPolicy({maxVoltageDropFraction:{value:v,unit:'1',source:wiringPolicy().sources.drop}})))).toContain('VOLTAGE_DROP_RANGE');});
 test('a requirement cannot declare its own status',()=>{
  const r=edit(safetyRequirements([{id:'r1',function:'emergency stop',trigger:'button',stopCategory:0,deviceIds:[],signalIds:[],documents:[],notes:''}]),(x:any)=>{x.requirements[0].status='documented';});
  expect(codes(validateSafetyRequirements(r))).toContain('UNKNOWN_FIELD');
 });
 test('evidence status is documented only with a safety document and a torque-off claim on every named device',()=>{
  const p=driveProfile(),req=(documents:any[],deviceIds=['drive-left']):any=>({id:'r1',function:'f',trigger:'t',stopCategory:0 as const,deviceIds,signalIds:[],documents,notes:''});
  const doc={id:'sm',kind:'safety_manual' as const,title:'x',revision:'1',url:'u',digest:DOC_DIGEST.safety,license:'unreviewed'};
  const of=(id:string)=>id==='drive-left'?p:undefined;
  expect(safetyEvidenceStatus(req([]),of)).toBe('open');
  expect(safetyEvidenceStatus(req([doc]),of)).toBe('documented');
  expect(safetyEvidenceStatus(req([doc],['drive-left','ghost']),of)).toBe('open');
  expect(safetyEvidenceStatus(req([doc]),()=>({...p,drive:{...p.drive!,stop:{...p.drive!.stop,torqueOff:null}}}))).toBe('open');
 });
});

describe('admission',()=>{
 const profile=driveProfile(),resolved=(componentDigest=profile.component.digest)=>({placements:[{instanceId:'inst-1'}],bom:{lines:[{instanceIds:['inst-1'],componentDigest}]}}) as unknown as ResolvedAssembly;
 const input=(o:Partial<Parameters<typeof admitElectricalDesign>[1]>={})=>({resolved:resolved(),project:{id:'project-test',revision:1,digest:'p'.repeat(64)},deviceProfiles:{[profile.digest]:profile},driveAxisIds:['amr-1/wheel-left'],...o});
 test('a consistent design is admitted with a profile for every device',()=>{
  const r=admitElectricalDesign(design(),input());expect(r.problems).toEqual([]);expect([...r.context!.profiles.keys()]).toEqual(['drive-left','bumper-front-sw']);
 });
 test('a design for another project or revision is refused',()=>{
  expect(codes(admitElectricalDesign(design({project:{id:'other',revision:1}}),input()))).toContain('ELECTRICAL_PROJECT_MISMATCH');
  expect(codes(admitElectricalDesign(design({project:{id:'project-test',revision:2}}),input()))).toContain('ELECTRICAL_PROJECT_MISMATCH');
 });
 test('an unknown profile and a profile with another digest are different refusals',()=>{
  expect(codes(admitElectricalDesign(design(),input({deviceProfiles:{}})))).toContain('DEVICE_PROFILE_UNAVAILABLE');
  const changed={...profile,digest:'e'.repeat(64)};
  expect(codes(admitElectricalDesign(design(),input({deviceProfiles:{[changed.digest]:changed}})))).toContain('DEVICE_PROFILE_DIGEST_MISMATCH');
 });
 test('an instance that is not in the assembly, or is another component, is refused',()=>{
  const withInstance=(id:string)=>design({devices:[{...design().devices[0]!,assemblyInstanceId:id},design().devices[1]!]});
  expect(codes(admitElectricalDesign(withInstance('ghost'),input()))).toContain('ELECTRICAL_INSTANCE_UNKNOWN');
  expect(codes(admitElectricalDesign(withInstance('inst-1'),input({resolved:resolved('d'.repeat(64))})))).toContain('ELD_PROFILE_COMPONENT_MISMATCH');
  expect(admitElectricalDesign(withInstance('inst-1'),input()).problems).toEqual([]);
 });
 test('a drive axis of the project with no drive in the design is ELD_AXIS_UNMAPPED',()=>{
  expect(codes(admitElectricalDesign(design(),input({driveAxisIds:['amr-1/wheel-left','amr-1/wheel-right']})))).toEqual(['ELD_AXIS_UNMAPPED']);
 });
});
