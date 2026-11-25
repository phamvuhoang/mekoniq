import {describe,expect,test} from 'vitest';
import {compileElectrical} from '../../packages/lab-runtime/src/engineering/electrical/compile';
import type {ElectricalDesignV1,WiringPolicyV1} from '../../packages/lab-runtime/src/engineering/electrical/contracts';
import {sealElectrical} from '../../packages/lab-runtime/src/engineering/electrical/contracts';
import {shippedContext} from '../support/electrical';

type Opt='serve-hw-a-v1'|'serve-hw-b-v1'|'serve-hw-c-v1';
const run=async(option:Opt,tweak?:(d:ElectricalDesignV1)=>ElectricalDesignV1,policyTweak?:(p:WiringPolicyV1)=>WiringPolicyV1,noSafety=false)=>{
 const {context,policy,safety,catalog}=await shippedContext(option,tweak,policyTweak);
 const r=compileElectrical({design:context.design,resolved:context.resolved,project:context.project,catalog,policy,safety:noSafety?null:safety,driveAxisIds:['amr-1/wheel-left','amr-1/wheel-right'],schemaHash:'7'.repeat(64)});
 return r;
};
const rule=(r:Awaited<ReturnType<typeof run>>,id:string)=>(r.bundle?.checks??[]).filter(c=>c.ruleId===id);
const feed=(d:ElectricalDesignV1,id:string,f:(x:ElectricalDesignV1['power'][number]['feeds'][number])=>ElectricalDesignV1['power'][number]['feeds'][number]):ElectricalDesignV1=>({...d,power:d.power.map(p=>({...p,feeds:p.feeds.map(x=>x.id===id?f(x):x)}))});
const policyWith=(f:(p:WiringPolicyV1)=>Partial<WiringPolicyV1>)=>(p:WiringPolicyV1)=>sealElectrical({...p,...f(p),digest:undefined}) as WiringPolicyV1;

describe('ELD_VOLTAGE_MISMATCH',()=>{
 test('positive: a 48 V rail on 24 V loads',async()=>{expect(rule(await run('serve-hw-c-v1',d=>({...d,power:d.power.map(p=>({...p,nominalV:48}))})),'ELD_VOLTAGE_MISMATCH').length).toBeGreaterThan(3);});
 test('negative: the shipped 24 V rail',async()=>{expect(rule(await run('serve-hw-c-v1'),'ELD_VOLTAGE_MISMATCH')).toEqual([]);});
});
describe('ELD_POWER_BUDGET_EXCEEDED',()=>{
 test('positive: loads behind a 5 A fuse that add up to more',async()=>{
  const r=await run('serve-hw-c-v1',d=>({...d,power:d.power.map(p=>({...p,feeds:[...p.feeds,...[1,2,3].map(i=>({...p.feeds.find(f=>f.id==='f-controller')!,id:'f-extra-'+i}))]}))}));
  expect(rule(r,'ELD_POWER_BUDGET_EXCEEDED').map(c=>c.path)).toContain('/devices/fuse-logic');
 });
 test('negative',async()=>{expect(rule(await run('serve-hw-c-v1'),'ELD_POWER_BUDGET_EXCEEDED')).toEqual([]);});
});
describe('protection',()=>{
 test('a branch without a protection device is blocking',async()=>{expect(rule(await run('serve-hw-c-v1',d=>feed(d,'f-controller',f=>({...f,protectionDeviceId:null}))),'ELD_PROTECTION_MISSING')).toHaveLength(1);});
 test('a 20 A fuse where the policy has no wire above 10 A is oversized',async()=>{
  const r=await run('serve-hw-b-v1',undefined,policyWith(p=>({ampacity:p.ampacity.filter(x=>x.maxCurrentA.value<=10)})));
  expect(rule(r,'ELD_PROTECTION_OVERSIZED').map(c=>c.path)).toEqual(['/power/0/feeds/0']);
 });
 test('negative: a fuse the policy can carry',async()=>{expect(rule(await run('serve-hw-b-v1'),'ELD_PROTECTION_OVERSIZED')).toEqual([]);});
});
describe('wire',()=>{
 test('a table that tops out below the load is ELD_WIRE_UNDERSIZED',async()=>{
  const r=await run('serve-hw-c-v1',undefined,policyWith(p=>({ampacity:p.ampacity.slice(0,1)})));
  expect(rule(r,'ELD_WIRE_UNDERSIZED').length).toBeGreaterThan(0);
 });
 test('negative',async()=>{expect(rule(await run('serve-hw-c-v1'),'ELD_WIRE_UNDERSIZED')).toEqual([]);});
 test('a long branch is reported with the numbers that decided it',async()=>{
  const r=await run('serve-hw-c-v1',d=>feed(d,'f-drive-left',f=>({...f,lengthM:{...f.lengthM!,value:20}})));
  const c=rule(r,'ELD_VOLTAGE_DROP_EXCEEDED')[0]!;
  expect(c.level).toBe('blocking');expect(c.detail).toContain('f-drive-left');expect(c.detail).toMatch(/\d+(\.\d)? V of 24 V/);expect(c.detail).toContain('3 %');
 });
 test('an unknown length is UNVERIFIED_LENGTH and no drop is computed',async()=>{
  const r=await run('serve-hw-c-v1',d=>feed(d,'f-drive-left',f=>({...f,lengthM:null})));
  expect(rule(r,'UNVERIFIED_LENGTH')).toHaveLength(1);expect(rule(r,'ELD_VOLTAGE_DROP_EXCEEDED')).toEqual([]);
 });
 test('the assumed policy marks the result unverified but not blocked',async()=>{
  const r=await run('serve-hw-c-v1');
  expect(r.bundle!.state).toBe('compiled');expect(rule(r,'UNVERIFIED_ASSUMED_SOURCE').some(c=>c.sources[0]!.documentId==='r5-assumptions')).toBe(true);
 });
});
describe('axes and stop',()=>{
 test('an axis on a device with no drive capability',async()=>{expect(rule(await run('serve-hw-c-v1',d=>({...d,axes:d.axes.map((a,i)=>i?a:{...a,driveDeviceId:'motor-left'})})),'ELD_MODE_UNSUPPORTED')).toHaveLength(1);});
 test('a channel the drive does not have',async()=>{expect(rule(await run('serve-hw-c-v1',d=>({...d,axes:d.axes.map((a,i)=>i?a:{...a,channel:3})})),'ELD_AXIS_UNMAPPED')).toHaveLength(1);});
 test('negative: pv drives take a velocity-controlled wheel',async()=>{expect(rule(await run('serve-hw-c-v1'),'ELD_MODE_UNSUPPORTED')).toEqual([]);});
 test('a torque-off stop on a drive without torque-off and without a requirement',async()=>{
  const r=await run('serve-hw-b-v1',d=>({...d,stopFunctions:d.stopFunctions.map(f=>f.id==='emergency'?{...f,requirementId:null}:f)}));
  expect(rule(r,'ELD_STOP_UNSUPPORTED')).toHaveLength(2);
 });
 test('negative: the contactor requirement carries it',async()=>{expect(rule(await run('serve-hw-b-v1'),'ELD_STOP_UNSUPPORTED')).toEqual([]);});
});
describe('safety references',()=>{
 test('a safety signal that no requirement names',async()=>{
  const r=await run('serve-hw-c-v1',d=>({...d,safetyRequirementsRef:null}),undefined,true);
  expect(rule(r,'SAF_REQUIREMENT_UNREFERENCED').map(c=>c.path)).toEqual(['/signals/estop-chain','/signals/sto-left','/signals/sto-right']);
 });
 test('a stop function that names a requirement that is not in the register',async()=>{
  const r=await run('serve-hw-c-v1',d=>({...d,stopFunctions:d.stopFunctions.map(f=>f.id==='emergency'?{...f,requirementId:'req-nope'}:f)}));
  expect(rule(r,'SAF_REQUIREMENT_UNKNOWN')).toHaveLength(1);
 });
 test('negative: the shipped register names all three',async()=>{expect(rule(await run('serve-hw-c-v1'),'SAF_REQUIREMENT_UNREFERENCED')).toEqual([]);});
});
describe('unverified',()=>{
 test('an assigned point on a profile with no pinned description file is UNVERIFIED_BUS_EXPOSURE, one per point',async()=>{
  const r=await run('serve-hw-c-v1');
  expect(rule(r,'UNVERIFIED_BUS_EXPOSURE').length).toBe(r.bundle!.allocation.assigned.length);
 });
});
