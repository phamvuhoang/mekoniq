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
