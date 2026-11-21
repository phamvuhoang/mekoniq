import {expect,test} from 'vitest';
import {TRAY_EXPERIMENTS,trayExperiment,trayKnobDifference,TRAY_ACCELERATION} from '../../packages/lab-runtime/src/v2/simulation3d/tray-experiments';
import {mujocoExperiment} from '../../packages/lab-runtime/src/v2/simulation3d/experiment-registry';
import {PAYLOAD_EXPERIMENTS} from '../../packages/lab-runtime/src/v2/simulation3d/payload-experiments';
import {DRIVE_EXPERIMENTS} from '../../packages/lab-runtime/src/v2/control/drive-experiments';

test('the registry is closed and has the five ids of R4-A 7.4',()=>{
 expect(Object.keys(TRAY_EXPERIMENTS).sort()).toEqual(['tray-accel-high-v1','tray-low-friction-v1','tray-nominal-v1','tray-person-crossing-v1','tray-torque-limited-v1']);
 expect(Object.isFrozen(TRAY_EXPERIMENTS)).toBe(true);
 for(const e of Object.values(TRAY_EXPERIMENTS))expect(Object.isFrozen(e)).toBe(true);
 expect(()=>trayExperiment('__proto__')).toThrow('MUJOCO_EXPERIMENT_UNREGISTERED');
 expect(()=>trayExperiment('payload-center-v1')).toThrow('MUJOCO_EXPERIMENT_UNREGISTERED');
});

test('every variant names a registered drive experiment; ids do not clash with the payload family',()=>{
 for(const [id,e] of Object.entries(TRAY_EXPERIMENTS)){expect(Object.hasOwn(DRIVE_EXPERIMENTS,e.driveExperimentId)).toBe(true);expect(Object.hasOwn(PAYLOAD_EXPERIMENTS,id)).toBe(false);}
});

test('a variant differs from the one it is compared with in exactly one knob',()=>{
 const expected={'tray-nominal-v1':null,'tray-low-friction-v1':['friction','tray-nominal-v1'],'tray-accel-high-v1':['acceleration','tray-low-friction-v1'],'tray-torque-limited-v1':['drive','tray-nominal-v1'],'tray-person-crossing-v1':['actor','tray-nominal-v1']} as const;
 for(const [id,e] of Object.entries(TRAY_EXPERIMENTS)){
  const want=expected[id as keyof typeof expected];
  if(!want){expect(e.comparedWith).toBeNull();continue;}
  expect(e.comparedWith).toBe(want[1]);
  expect(trayKnobDifference(id,e.comparedWith!)).toEqual([want[0]]);
 }
 expect(trayKnobDifference('tray-nominal-v1','tray-nominal-v1')).toEqual([]);
 expect(trayKnobDifference('tray-accel-high-v1','tray-nominal-v1').sort()).toEqual(['acceleration','friction']);
});

test('friction is one registered input: it moves the cup load and the tray contact together',()=>{
 expect(TRAY_EXPERIMENTS['tray-nominal-v1']).toMatchObject({load:'cup-triple',physics:'drive-contact-profile'});
 expect(TRAY_EXPERIMENTS['tray-low-friction-v1']).toMatchObject({load:'cup-triple-low-friction',physics:'drive-contact-tray-low-v1'});
});

test('acceleration is one registered input: the policy and the base controller limit move together, the base never below the policy',()=>{
 for(const a of Object.values(TRAY_ACCELERATION))expect(a.baseLimitMps2).toBeGreaterThanOrEqual(a.policyMps2);
 expect(TRAY_ACCELERATION.high.policyMps2).toBeGreaterThan(TRAY_ACCELERATION.nominal.policyMps2);
 expect(TRAY_ACCELERATION.nominal.policyMps2).toBe(0.5);
});

test('only the person variant has an actor, and only it is the compared-with of nothing else',()=>{
 expect(Object.entries(TRAY_EXPERIMENTS).filter(([,e])=>e.actor).map(([id])=>id)).toEqual(['tray-person-crossing-v1']);
});

test('the shared resolver gives both families the same shape and refuses unknown ids',()=>{
 expect(mujocoExperiment('payload-fast-v1')).toMatchObject({family:'payload',fixture:'serve-payload-v1',load:'cup-center',maxLinearMps:1});
 expect(mujocoExperiment('tray-accel-high-v1')).toMatchObject({family:'tray',fixture:'serve-tray-v1',load:'cup-triple-low-friction',maxAccelerationMps2:TRAY_ACCELERATION.high.policyMps2});
 expect(mujocoExperiment('payload-center-v1').maxAccelerationMps2).toBeUndefined();
 expect(()=>mujocoExperiment('nope')).toThrow('MUJOCO_EXPERIMENT_UNREGISTERED');
});

import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DRIVE_DOC_PINS,controlShape} from '../../packages/lab-runtime/src/v2/simulation3d/physics-inputs';
import {hashJson} from '../../packages/lab-runtime/src/v2/hash';
test('the pinned drive documents are the fixtures of drive-v1 (a drifted fixture fails here, not silently in a verifier)',async()=>{
 const dir='robotics/simulation-mujoco/fixtures/drive-v1/';
 for(const [id,e] of Object.entries(DRIVE_EXPERIMENTS)){
  const model=JSON.parse(await readFile(dir+e.mobileModel,'utf8')),control=JSON.parse(await readFile(dir+e.mobileControl,'utf8'));
  expect(DRIVE_DOC_PINS[id]).toEqual({model:model.digest,control:hashJson(controlShape(control))});
 }
 void createHash;
});

import {driveDocs} from '../../packages/lab-runtime/src/v2/simulation3d/physics-inputs';
import {mobileDriveBundle} from '../../packages/lab-runtime/src/v2/control/drive-experiments';
import {sealDriveDocument} from '../../packages/lab-runtime/src/v2/control/drive-io';
test('the verifier takes the registered drive documents only: self-sealed look-alikes are refused',async()=>{
 const plant='e'.repeat(64),b=await mobileDriveBundle('robotics/simulation-mujoco','drive-nominal-v1',plant,false,1);
 const docs=new Map<string,unknown>(b.files.map(f=>[f.path,JSON.parse(Buffer.from(f.bytes).toString())])),refs=new Map(b.files.map(f=>[f.path,{sha256:'a'.repeat(64),bytes:1}]));
 const get=(p:string)=>docs.get(p) as never,exp=mujocoExperiment('tray-nominal-v1');
 expect(()=>driveDocs('drive-nominal-v1',exp,plant,refs as never,get)).not.toThrow();
 // a model with another torque curve, re-sealed: consistent with itself, not the registered one
 const m=docs.get('serve-drive-nominal-v1.json') as {axes:Record<string,unknown>[]},tampered=sealDriveDocument({...(m as object),axes:m.axes.map((x,i)=>i===0?{...x,tamperedForTest:1}:x)} as never);
 docs.set('serve-drive-nominal-v1.json',tampered);
 expect(()=>driveDocs('drive-nominal-v1',exp,plant,refs as never,get)).toThrow('DRIVE_DOCUMENT_DIFFERS');
 // a control profile with another gain, re-sealed, likewise
 const b2=await mobileDriveBundle('robotics/simulation-mujoco','drive-nominal-v1',plant,false,1),docs2=new Map<string,unknown>(b2.files.map(f=>[f.path,JSON.parse(Buffer.from(f.bytes).toString())]));
 const c=docs2.get('serve-control-v2.json') as {axes:{loop:{kp:number}}[]};docs2.set('serve-control-v2.json',sealDriveDocument({...(c as object),axes:c.axes.map(a=>({...a,loop:{...a.loop,kp:99}}))} as never));
 expect(()=>driveDocs('drive-nominal-v1',exp,plant,refs as never,(p:string)=>docs2.get(p) as never)).toThrow('DRIVE_DOCUMENT_DIFFERS');
});
