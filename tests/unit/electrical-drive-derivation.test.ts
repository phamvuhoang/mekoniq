import {describe,expect,test} from 'vitest';
import {readFile} from 'node:fs/promises';
import {deriveControlProfile,deriveDriveModel} from '../../packages/lab-runtime/src/engineering/electrical/drive-derivation';
import {groupMaturity} from '../../packages/lab-runtime/src/engineering/maturity';
import {sealElectrical,type DeviceProfileV1,type ElectricalDesignV1} from '../../packages/lab-runtime/src/engineering/electrical/contracts';
import type {ControlProfileV1,DriveModelV1} from '../../packages/lab-runtime/src/v2/control/drive-io';
import {validateDriveModel} from '../../packages/lab-runtime/src/v2/control/drive-io';
import {manufacturer,shippedContext,assumedSource} from '../support/electrical';

const D='robotics/simulation-mujoco/fixtures/drive-v1/';
const load=async<T>(n:string)=>JSON.parse(await readFile(D+n,'utf8')) as T;
const withDrive=(p:DeviceProfileV1,f:(d:NonNullable<DeviceProfileV1['drive']>)=>void)=>{const q=structuredClone(p);f(q.drive!);return sealElectrical({...q,digest:undefined}) as DeviceProfileV1;};
const swap=async(f:(d:NonNullable<DeviceProfileV1['drive']>)=>void,tweak?:(d:ElectricalDesignV1)=>ElectricalDesignV1)=>{
 const {context}=await shippedContext('serve-hw-c-v1',tweak),profiles=new Map(context.profiles);
 for(const id of ['drive-left','drive-right'])profiles.set(id,withDrive(context.profiles.get(id)!,f));
 return {...context,profiles};
};

describe('deriveDriveModel',()=>{
 test('documented encoder counts and a documented watchdog range change two fields and upgrade their groups only',async()=>{
  const base=await load<DriveModelV1>('serve-drive-nominal-v1.json'),before=JSON.stringify(base);
  const ctx=await swap(d=>{d.feedback.countsPerRev={value:2000,unit:'1',source:manufacturer('manual','enc')};d.watchdog={kind:'heartbeat',rangeMs:[200,5000],source:manufacturer('manual','wd')};});
  const r=deriveDriveModel(base,ctx);
  expect(JSON.stringify(base)).toBe(before);
  expect(r.changes.map(c=>`${c.axisId}:${c.field}:${c.from}->${c.to}`)).toEqual(['amr-1/wheel-left:encoder.countsPerRev:4096->2000','amr-1/wheel-left:watchdogTicks:5->10','amr-1/wheel-right:encoder.countsPerRev:4096->2000','amr-1/wheel-right:watchdogTicks:5->10']);
  expect(r.model.sources.encoder.kind).toBe('manufacturer');expect(r.model.sources.watchdog.kind).toBe('manufacturer');
  for(const g of ['torque','velocity','delays','disable','followingError'] as const)expect(r.model.sources[g]).toEqual(base.sources[g]);
  expect(r.model.revision).toBe(base.revision+1);expect(r.model.id).not.toBe(base.id);expect(validateDriveModel(r.model).ok).toBe(true);
 });
 test('a value equal to the documented one is confirmed: the number stays and its source improves',async()=>{
  const base=await load<DriveModelV1>('serve-drive-nominal-v1.json'),ctx=await swap(d=>{d.feedback.countsPerRev={value:4096,unit:'1',source:manufacturer('manual','enc')};});
  const r=deriveDriveModel(base,ctx);
  expect(r.changes).toEqual([]);expect(r.confirmed.map(c=>c.field)).toEqual(['encoder.countsPerRev','encoder.countsPerRev']);expect(r.model.sources.encoder.kind).toBe('manufacturer');
 });
 test('a group with a documented field on one axis only stays assumed',async()=>{
  const base=await load<DriveModelV1>('serve-drive-nominal-v1.json'),{context}=await shippedContext('serve-hw-c-v1'),profiles=new Map(context.profiles);
  profiles.set('drive-left',withDrive(context.profiles.get('drive-left')!,d=>{d.feedback.countsPerRev={value:2000,unit:'1',source:manufacturer('manual','enc')};}));
  profiles.set('drive-right',withDrive(context.profiles.get('drive-right')!,d=>{d.feedback.countsPerRev={value:2000,unit:'1',source:assumedSource};}));
  const r=deriveDriveModel(base,{...context,profiles});
  expect(r.model.sources.encoder.kind).toBe('assumed');expect(r.changes).toHaveLength(1);
 });
 test('maturity is assumed until every group has a manufacturer source',async()=>{
  const base=await load<DriveModelV1>('serve-drive-nominal-v1.json'),ctx=await swap(d=>{d.feedback.countsPerRev={value:2000,unit:'1',source:manufacturer('manual','enc')};d.watchdog={kind:'heartbeat',rangeMs:[200,5000],source:manufacturer('manual','wd')};});
  const r=deriveDriveModel(base,ctx);
  expect(groupMaturity(Object.values(r.model.sources),[],r.model.digest)).toBe('assumed');
  expect(Object.values(r.model.sources).filter(s=>s.kind==='manufacturer')).toHaveLength(2);
  expect(groupMaturity(Object.values(r.model.sources).map(s=>({...s,kind:'manufacturer' as const})),[],r.model.digest)).toBe('nominal');
 });
 test('the shipped BLVD-KRD documents none of these fields: the model is the base with a new revision',async()=>{
  const base=await load<DriveModelV1>('serve-drive-nominal-v1.json'),{context}=await shippedContext('serve-hw-c-v1'),r=deriveDriveModel(base,context);
  expect(r.changes).toEqual([]);expect(r.confirmed).toEqual([]);expect({...r.model,id:0,revision:0,digest:0}).toEqual({...base,id:0,revision:0,digest:0});
 });
 test('a pv-only drive with a control profile that has no acceleration limit is reported',async()=>{
  const base=await load<DriveModelV1>('serve-drive-nominal-v1.json'),control=await load<ControlProfileV1>('serve-control-v2.json'),{context}=await shippedContext('serve-hw-c-v1');
  expect(deriveDriveModel(base,context,control).checks.map(c=>c.ruleId)).toEqual(['ELD_MODE_UNSUPPORTED','ELD_MODE_UNSUPPORTED']);
  const derived=deriveControlProfile(control,context,[base.digest]);
  expect(derived.axes.every(a=>a.accelerationLimit!==null&&Math.abs(a.accelerationLimit-104.71975511965977)<1e-9)).toBe(true);expect(derived.revision).toBe(control.revision+1);
  expect(deriveDriveModel(base,context,derived).checks).toEqual([]);
 });
 test('a stop that ends in torque_off_brake needs a brake output in the profile',async()=>{
  const base=await load<DriveModelV1>('serve-drive-nominal-v1.json'),{context}=await shippedContext('serve-hw-c-v1',d=>({...d,stopFunctions:d.stopFunctions.map(f=>f.id==='emergency'?{...f,finalState:'torque_off_brake' as const}:f)}));
  expect(deriveDriveModel(base,context).checks.filter(c=>c.ruleId==='ELD_STOP_UNSUPPORTED').length).toBe(2);
 });
});
