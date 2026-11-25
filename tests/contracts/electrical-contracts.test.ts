/* eslint-disable @typescript-eslint/no-explicit-any */
import {describe,expect,test} from 'vitest';
import {validateDeviceProfile,sealElectrical,type DeviceProfileV1} from '../../packages/lab-runtime/src/engineering/electrical/contracts';
import {driveProfile,manufacturer} from '../support/electrical';

const codes=(input:unknown)=>validateDeviceProfile(input).problems.map(p=>p.code);
const edit=(f:(p:any)=>void,base:DeviceProfileV1=driveProfile())=>{const p=structuredClone(base) as any;f(p);return p;};

describe('device profile',()=>{
 test('a fully cited profile validates',()=>{expect(validateDeviceProfile(driveProfile())).toEqual({ok:true,problems:[]});});
 test('the seal is stable and ignores its own field',()=>{const p=driveProfile();expect(sealElectrical({...p,digest:'x'}).digest).toBe(p.digest);});
 test.each([
  ['a missing component digest',(p:any)=>{delete p.component.digest;},'FIELD_REQUIRED'],
  ['a duplicate pointId',(p:any)=>{p.ioPoints[1].pointId='IN0';},'DUPLICATE_POINT_ID'],
  ['a pin that is on no connector',(p:any)=>{p.ioPoints[0].pin='CN9/1';},'IO_PIN_UNKNOWN'],
  ['a cyclic point without an object',(p:any)=>{p.ioPoints[0].busExposure.object=null;},'BUS_EXPOSURE_OBJECT_MISSING'],
  ['an output without a maximum current',(p:any)=>{p.ioPoints[2].electrical.maxCurrentA=null;},'OUTPUT_CURRENT_MISSING'],
  ['drive capability on a motor',(p:any)=>{p.kind='motor';},'DRIVE_ON_NON_DRIVE'],
  ['an empty mode list',(p:any)=>{p.drive.modes=[];},'INVALID_FIELD'],
  ['a pv-only drive without profile acceleration',(p:any)=>{p.drive.modes=['pv'];p.drive.profileAccelerationRadS2=null;},'PROFILE_ACCELERATION_MISSING'],
  ['a safety claim on a general purpose point',(p:any)=>{p.ioPoints[0].safety={function:'safe_input',claim:'x',documentId:'safety-manual',locator:'1',certificate:null};},'SAFETY_ON_GENERAL_PURPOSE'],
  ['a unit outside the allowed list',(p:any)=>{p.drive.ratedCurrentA.unit='mA';},'UNIT_NOT_ALLOWED'],
  ['an unknown field',(p:any)=>{p.extra=1;},'UNKNOWN_FIELD'],
  ['a typed evidenceLevel',(p:any)=>{p.evidenceLevel='documented';},'UNKNOWN_FIELD'],
  ['a typed status',(p:any)=>{p.drive.status='ok';},'UNKNOWN_FIELD'],
  ['a typed verified flag',(p:any)=>{p.ioPoints[0].verified=true;},'UNKNOWN_FIELD'],
  ['a safety claim naming an undeclared document',(p:any)=>{p.drive.stop.torqueOff.documentId='nope';},'SAFETY_DOCUMENT_UNKNOWN'],
  ['a torque-off point that does not exist',(p:any)=>{p.drive.stop.torqueOffPointIds=['NOPE'];},'DRIVE_POINT_UNKNOWN'],
 ])('rejects %s',(_n,f,code)=>{expect(codes(edit(f))).toContain(code);});
 test('too many connectors is a shape error',()=>{
  const c=driveProfile().connectors[0]!;
  expect(codes(edit(p=>{p.connectors=Array.from({length:17},(_,i)=>({...c,id:'C'+i}));}))).toContain('INVALID_FIELD');
 });
 test('a pin may carry a manufacturer source of its own',()=>{expect(manufacturer('manual','CN2').kind).toBe('manufacturer');});
});
