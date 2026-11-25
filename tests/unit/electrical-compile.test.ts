import {describe,expect,test} from 'vitest';
import {readFile} from 'node:fs/promises';
import {compileElectrical} from '../../packages/lab-runtime/src/engineering/electrical/compile';
import type {ElectricalDesignV1} from '../../packages/lab-runtime/src/engineering/electrical/contracts';
import {shippedContext} from '../support/electrical';

const OPTIONS=['serve-hw-a-v1','serve-hw-b-v1','serve-hw-c-v1'] as const;
const compile=async(option:typeof OPTIONS[number],tweak?:(d:ElectricalDesignV1)=>ElectricalDesignV1,project?:{id:string;revision:number;digest:string})=>{
 const {context,policy,safety,catalog}=await shippedContext(option,tweak);
 return compileElectrical({design:context.design,resolved:context.resolved,project:project??context.project,catalog,policy,safety,driveAxisIds:['amr-1/wheel-left','amr-1/wheel-right'],schemaHash:'7'.repeat(64)});
};
const codes=(r:Awaited<ReturnType<typeof compile>>)=>r.bundle!.checks.filter(c=>c.level==='blocking').map(c=>c.ruleId);

describe('the shipped options',()=>{
 test('compile twice to the same bytes and carry the three constants',async()=>{
  for(const o of OPTIONS){
   const a=await compile(o),b=await compile(o);
   expect(a.problems,o).toEqual([]);expect(JSON.stringify(a.bundle)).toBe(JSON.stringify(b.bundle));
   expect(a.bundle!.hardwareValidated).toBe(false);expect(a.bundle!.controlAuthority).toBe(false);expect(a.bundle!.inputs.compilerVersion).toBe('electrical-compiler/1');
  }
 });
 test('HW-A is blocked: the BLVD-KRD pins are not on the bus, and the reasons say so',async()=>{
  const r=await compile('serve-hw-a-v1');
  expect(r.bundle!.state).toBe('blocked');expect(codes(r)).toContain('IOA_SIGNAL_UNALLOCATED');
  const bumper=r.bundle!.allocation.unassigned.find(u=>u.signalId==='bumper-front')!;
  expect(bumper.reasons.map(x=>x.code)).toEqual(expect.arrayContaining(['NOT_BUS_EXPOSED','POINT_RESERVED']));
  expect(r.bundle!.driveModelDraft).toBeNull();
 });
 test('HW-C allocates every required controller signal to the I/O module',async()=>{
  const r=await compile('serve-hw-c-v1'),assigned=r.bundle!.allocation.assigned;
  expect(r.bundle!.allocation.unassigned.every(u=>['brake-release'].includes(u.signalId))).toBe(true);
  expect(assigned.every(a=>a.deviceId==='io-module')).toBe(true);
  expect(r.bundle!.allocation.assigned.map(a=>a.signalId)).not.toContain('estop-chain');
 });
 test('the inputs carry the identity of everything the bundle stands on',async()=>{
  const r=await compile('serve-hw-c-v1'),i=r.bundle!.inputs,{context}=await shippedContext('serve-hw-c-v1');
  expect(i.project.digest).toBe(context.project.digest);expect(i.design.digest).toBe(context.design.digest);expect(i.profiles.length).toBeGreaterThan(10);
  expect(i.profiles.every(p=>p.evidenceLevel==='candidate')).toBe(true);expect(i.safetyRequirementsDigest).not.toBeNull();
 });
 test('every assumed source the result stands on is listed once, and every device without a firmware pin is named',async()=>{
  const r=await compile('serve-hw-c-v1'),un=r.bundle!.checks.filter(c=>c.ruleId==='UNVERIFIED_ASSUMED_SOURCE');
  expect(new Set(un.map(c=>c.detail)).size).toBe(un.length);expect(un.length).toBeGreaterThan(10);
  expect(r.bundle!.checks.filter(c=>c.ruleId==='UNVERIFIED_FIRMWARE').map(c=>c.path)).toEqual(expect.arrayContaining(['/devices/drive-left','/devices/io-module','/devices/controller']));
 });
 test('a missing price is listed, never counted as zero',async()=>{
  const r=await compile('serve-hw-c-v1');
  expect(r.bundle!.checks.filter(c=>c.ruleId==='UNVERIFIED_PRICE').length).toBe(r.bundle!.bom.lines.length);
 });
});

describe('a design that is not for this project or catalog is refused, not blocked',()=>{
 test('another project',async()=>{const {context}=await shippedContext('serve-hw-c-v1'),r=await compile('serve-hw-c-v1',undefined,{...context.project,id:'other-project'});expect(r.bundle).toBeNull();expect(r.problems.map(p=>p.code)).toContain('ELECTRICAL_PROJECT_MISMATCH');});
 test('an unknown profile',async()=>{const r=await compile('serve-hw-c-v1',d=>({...d,devices:d.devices.map((x,i)=>i?x:{...x,profile:{...x.profile,id:'nope'}})}));expect(r.problems.map(p=>p.code)).toContain('DEVICE_PROFILE_UNAVAILABLE');});
 test('a wiring policy reference that is not the supplied policy',async()=>{const r=await compile('serve-hw-c-v1',d=>({...d,wiringPolicyRef:{...d.wiringPolicyRef,digest:'a'.repeat(64)}}));expect(r.problems.map(p=>p.code)).toContain('DOCUMENT_REF_MISMATCH');});
 test('a design that fails its schema',async()=>{const r=await compile('serve-hw-c-v1',d=>({...d,stray:1} as never));expect(r.bundle).toBeNull();expect(r.problems.length).toBeGreaterThan(0);});
});

describe('the compatible variant of HW-B with and without its I/O module',()=>{
 test('without the I/O module no controller signal has a point, so the bundle is blocked with the reason',async()=>{
  const r=await compile('serve-hw-b-v1',d=>({...d,devices:d.devices.filter(x=>x.id!=='io-module'),buses:d.buses.map(b=>({...b,members:b.members.filter(m=>m.deviceId!=='io-module')})),
   power:d.power.map(p=>({...p,feeds:p.feeds.filter(f=>f.to.deviceId!=='io-module')}))}));
  expect(r.bundle!.state).toBe('blocked');expect(codes(r)).toContain('IOA_SIGNAL_UNALLOCATED');expect(r.bundle!.driveModelDraft).toBeNull();
 });
});

describe('SAF02: no output claims a safety level',()=>{
 test('no bundle text names an integrity level, a performance level or compliance outside a verbatim manufacturer claim',async()=>{
  const re=/\b(SIL ?\d|PL ?[a-e]\b|compliant|certified safe|đạt an toàn|an toàn tuyệt đối)/i;
  for(const o of OPTIONS){
   const r=await compile(o);
   expect(JSON.stringify(r.bundle),o).not.toMatch(re);
  }
  expect(await readFile('robotics/catalog/electrical/serve-safety-requirements-v1.json','utf8')).not.toMatch(re);
 });
});
