import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,test} from 'vitest';
import {applyDriveOverride,applyPhysicsOverride,isIdentifiablePath} from '../../packages/lab-runtime/src/engineering/parameter-paths';
import {validateDriveModel,type DriveModelV1} from '../../packages/lab-runtime/src/v2/control/drive-io';
import type {XArmPhysics} from '../../packages/lab-runtime/src/v2/simulation3d/arm-cell-scene';

const root=join(__dirname,'../../robotics/simulation-mujoco/fixtures');
const physics=JSON.parse(readFileSync(join(root,'xarm6-g2-v1/physics.json'),'utf8')) as XArmPhysics;
const wheels=JSON.parse(readFileSync(join(root,'drive-v1/serve-drive-nominal-v1.json'),'utf8')) as DriveModelV1;
const arm=JSON.parse(readFileSync(join(root,'drive-v1/xarm6-drive-nominal-v1.json'),'utf8')) as DriveModelV1;

describe('the registry of what an offline tool may change',()=>{
 test('only rotor inertia, the shared joint damping and friction, and an axis torque scale are registered',()=>{
  for(const ok of ['armatureKgM2[0]','armatureKgM2[5]','jointDynamics.damping','jointDynamics.frictionloss','driveModel.axes[3].torque.scale'])expect(isIdentifiablePath(ok),ok).toBe(true);
  for(const no of ['armatureKgM2[6]','armatureKgM2','jointDynamics.source','contact.condim','actuators[0].kp','gripper.forceN','driveModel.axes[0].torque.limitNm','driveModel.axes[0].velocityLimitRadS','__proto__.x',''])expect(isIdentifiablePath(no),no).toBe(false);
 });
 test('a physics override changes a copy and nothing else; the fixture object keeps its bytes',()=>{
  const before=JSON.stringify(physics),out=applyPhysicsOverride(physics,{'armatureKgM2[2]':0.13,'jointDynamics.damping':1.5});
  expect(out.armatureKgM2).toEqual([0.1,0.1,0.13,0.1,0.1,0.1]);expect(out.jointDynamics).toMatchObject({damping:1.5,frictionloss:1});
  expect({...out,armatureKgM2:0,jointDynamics:0}).toEqual({...physics,armatureKgM2:0,jointDynamics:0});expect(JSON.stringify(physics)).toBe(before);
 });
 test('an unregistered path or a value that is not finite and positive throws a named error and applies nothing',()=>{
  expect(()=>applyPhysicsOverride(physics,{'armatureKgM2[0]':0.2,'contact.condim':3})).toThrow('PHYSICS_PATH_UNREGISTERED:contact.condim');
  for(const v of [0,-1,NaN,Infinity])expect(()=>applyPhysicsOverride(physics,{'jointDynamics.damping':v})).toThrow('PHYSICS_VALUE_INVALID:jointDynamics.damping');
 });
 test('a drive override sets the scale of an envelope-referenced axis and seals a NEW document; an effort axis has no scale to fit',()=>{
  const out=applyDriveOverride(wheels,{'driveModel.axes[0].torque.scale':0.8});
  expect(out.axes[0]!.torque).toEqual({kind:'envelope_ref',scale:0.8});expect(out.digest).not.toBe(wheels.digest);expect(validateDriveModel(out).ok).toBe(true);expect(wheels.axes[0]!.torque).toMatchObject({scale:1});
  expect(()=>applyDriveOverride(arm,{'driveModel.axes[2].torque.scale':0.8})).toThrow('DRIVE_PATH_NOT_APPLICABLE');
  expect(()=>applyDriveOverride(wheels,{'driveModel.axes[9].torque.scale':0.8})).toThrow('DRIVE_AXIS_UNKNOWN');
  for(const v of [0,1.2,NaN])expect(()=>applyDriveOverride(wheels,{'driveModel.axes[0].torque.scale':v})).toThrow('DRIVE_VALUE_INVALID');
  expect(()=>applyDriveOverride(wheels,{'driveModel.axes[0].velocityLimitRadS':3})).toThrow('DRIVE_PATH_UNREGISTERED');
 });
});
