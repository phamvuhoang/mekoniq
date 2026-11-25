import {expect,test} from 'vitest';
import {readFileSync} from 'node:fs';
import {createMobileStopMonitor,MOBILE_STOP_POLICY} from '../../packages/lab-runtime/src/v2/simulation3d/mujoco-mobile';
import {poseUnstable} from '../../packages/lab-runtime/src/v2/navigation2d/runner';
import {MUJOCO_WIRE,SIM3D_WIRE} from '../../packages/lab-runtime/src/v2/simulation3d/worker-client';
import {createIRSimNavigationAdapter} from '../../packages/lab-runtime/src/v2/navigation2d/adapter';
import {createNavigationController} from '../../packages/lab-runtime/src/v2/navigation2d/controller';
const scene=JSON.parse(readFileSync('robotics/simulation-mujoco/fixtures/serve-payload-v1/navigation-scene.json','utf8'));
const load=JSON.parse(readFileSync('robotics/simulation-mujoco/fixtures/serve-payload-v1/cup-center.json','utf8'));
const p=load.props[0],z=p.attachment.initialPoseInSupport.positionM[2];
const snap=(tick:number,drop=0,roll=0,height=0.09)=>({tick,simTimeNs:String(tick*20_000_000),robots:[{robotId:'amr-1',pose3d:{z:height,roll,pitch:0}}],physics:{tick,simTimeNs:String(tick*20_000_000),loads:[{propId:p.propId,supportId:p.attachment.supportId,poseInSupport:{positionM:[0,0,z-drop],quaternionXyzw:[0,0,0,1]}}]}});
const monitor=()=>createMobileStopMonitor(scene,load,MOBILE_STOP_POLICY);
test('mobile tilt policy has explicit boundary and leaves legacy Webots cutoff unchanged',()=>{
 const m=monitor();expect(m(snap(0) as never)).toBeNull();expect(m(snap(1,0,Math.PI/4) as never)).toBeNull();expect(m(snap(2,0,Math.PI/4+1e-9) as never)).toEqual({code:'BASE_TIPPED',robotId:'amr-1'});
 expect(poseUnstable({z:0.09,roll:0.36,pitch:0},0.09,0.09)).toBe(true);
});
test('load fall requires five consecutive observed logical ticks at the inclusive 10cm boundary; recovery resets count',()=>{
 const m=monitor();m(snap(0) as never);for(let t=1;t<5;t++)expect(m(snap(t,0.1) as never)).toBeNull();expect(m(snap(5,0.1) as never)?.code).toBe('LOAD_FELL');
 const r=monitor();r(snap(0) as never);for(let t=1;t<5;t++)r(snap(t,0.1) as never);expect(r(snap(5,0.09999) as never)).toBeNull();for(let t=6;t<10;t++)expect(r(snap(t,0.1) as never)).toBeNull();expect(r(snap(10,0.1) as never)?.code).toBe('LOAD_FELL');
});
test('missing physics, changed support, missing prop and clock gaps are faults, never evidence of a fall',()=>{
 for(const mutate of [(s:ReturnType<typeof snap>)=>{delete (s as {physics?:unknown}).physics;},(s:ReturnType<typeof snap>)=>{s.physics.loads[0]!.supportId='different';},(s:ReturnType<typeof snap>)=>{s.physics.loads=[];},(s:ReturnType<typeof snap>)=>{s.physics.tick=99;}]){const m=monitor();m(snap(0) as never);const s=snap(1,0.2);mutate(s);expect(m(s as never)?.code).toBe('PHYSICS_OBSERVATION_INVALID');}
 const m=monitor();m(snap(0) as never);expect(m(snap(2,0.2) as never)?.code).toBe('PHYSICS_OBSERVATION_INVALID');
});
test('nonfinite pose and numerical/world escape are PLANT_UNSTABLE',()=>{
 for(const height of [NaN,-0.001,0.451]){const m=monitor();m(snap(0) as never);expect(m(snap(1,0,0,height) as never)?.code).toBe('PLANT_UNSTABLE');}
});
test('post-advancement mobile capacity errors are fatal on MuJoCo wire without changing Webots wire',()=>{
 expect(MUJOCO_WIRE.fatalCodes).toContain('CONTACT_CAPACITY_EXCEEDED');expect(MUJOCO_WIRE.fatalCodes).toContain('PLANT_UNSTABLE');expect(SIM3D_WIRE.fatalCodes).not.toContain('CONTACT_CAPACITY_EXCEEDED');
});
test('explicit adapter identity reaches descriptor while default callers keep IR-SIM identity',async()=>{
 const opts={robotId:'amr-1',scene,controller:createNavigationController(scene),now:()=>0};
 const a=createIRSimNavigationAdapter({...opts,identity:{id:'mujoco_3d',version:'3.17.0',model:'mujoco_serve_diff_drive'}});
 expect((await a.describe()).firmware).toBe('mujoco_3d@3.17.0');expect((await createIRSimNavigationAdapter(opts).describe()).firmware).toBe('irsim_2d@2.12.0');
});

test('mobile sent-command ramp overcomes stiction while legacy measured ramp and observed arrival checks stay unchanged',()=>{
 const s=structuredClone(scene);s.robots[0].model.sensors=[];
 const mobile=createNavigationController(s,{ramp:'previous-sent-command-v1'}),legacy=createNavigationController(s);
 const observation=(tick:number,velocity=0)=>({tick,robots:[{robotId:'amr-1',poseDriveMap:[2,1.5,0],bodyVelocity:[0,velocity],scans:[],collisionIds:[]}]}) as never;
 for(const c of [mobile,legacy])c.setGoal({robotId:'amr-1',commandId:'turn',target:[2,1.5,1]});
 const commands=[0,1,2].map(t=>mobile.advance(observation(t),{}).velocities[0]!.omegaRadps);
 expect(commands).toEqual([0.03,0.06,0.09]);expect([0,1,2].map(t=>legacy.advance(observation(t),{}).velocities[0]!.omegaRadps)).toEqual([0.03,0.03,0.03]);
 mobile.cancel('amr-1','turn');expect(mobile.advance(observation(3),{}).velocities[0]!.omegaRadps).toBeCloseTo(0.06);
 mobile.setGoal({robotId:'amr-1',commandId:'next',target:[2,1.5,1]});expect(mobile.advance(observation(4),{}).velocities[0]!.omegaRadps).toBeCloseTo(0.09);
 mobile.setGoal({robotId:'amr-1',commandId:'at-pose',target:[2,1.5,0]});
 for(let t=5;t<12;t++)expect(mobile.advance(observation(t,0.4),{}).decisions.some(d=>d.status==='arrived')).toBe(false);
 // A terminal output resets the next command origin without claiming the measured robot was already stopped.
 let arrived=false;for(let t=12;t<12+s.policy.parameters.arrivalHoldTicks;t++){const out=mobile.advance(observation(t),{});if(out.decisions.some(d=>d.status==='arrived')){arrived=true;expect(out.velocities[0]!.omegaRadps).toBe(0);}}
 expect(arrived).toBe(true);mobile.setGoal({robotId:'amr-1',commandId:'after-arrival',target:[2,1.5,1]});expect(mobile.advance(observation(30),{}).velocities[0]!.omegaRadps).toBe(0.03);
});

test('an exhausted route corrects a stopped out-of-window pose without extending the physical no-progress deadline',()=>{
 const s=structuredClone(scene);s.robots[0].model.sensors=[];s.policy.parameters.noProgressTicks=8;
 const observation=(tick:number,x:number,v=0)=>({tick,robots:[{robotId:'amr-1',poseDriveMap:[x,1.5,0],bodyVelocity:[v,0],scans:[],collisionIds:[]}]}) as never;
 const init=()=>{const c=createNavigationController(s,{exhaustedRouteRevision:1});c.setGoal({robotId:'amr-1',commandId:'park',target:[2,1.5,0]});c.advance(observation(0,2),{});return c;};
 const c=init();
 expect(c.advance(observation(1,1.8),{}).velocities[0]?.vMps).toBeGreaterThan(0);
 let stopped;for(let t=2;t<=8;t++){const d=c.advance(observation(t,1.8),{}).decisions[0];if(d?.status==='blocked')stopped={...d,t};}
 expect(stopped).toMatchObject({t:8,status:'blocked',reason:'NO_PROGRESS'});
 expect(init().advance(observation(1,1.99),{}).velocities[0]?.vMps).toBe(0);
 expect(init().advance(observation(1,1.8,.01),{},false).velocities[0]?.vMps).toBe(0);
 const cancelled=init();cancelled.cancel('amr-1','park');expect(cancelled.advance(observation(1,1.8),{}).decisions[0]?.status).toBe('cancelled');
});

test.each([true,false])('revision two preserves the physical no-progress deadline when a replacement route is denied and then granted (exhausted %s)',exhausted=>{
 const s=structuredClone(scene);s.robots[0].model.sensors=[];s.policy.parameters.noProgressTicks=8;s.policy.parameters.replanEveryTicks=1;
 s.zones=[{id:'bay',polygonM:[[1.7,1.2],[2.2,1.2],[2.2,1.8],[1.7,1.8]]}];
 const c=createNavigationController(s,{exhaustedRouteRevision:1});
 const snap=(tick:number,x:number)=>({tick,robots:[{robotId:'amr-1',poseDriveMap:[x,1.5,0],bodyVelocity:[0,0],scans:[],collisionIds:[]}]}) as never;
 c.setGoal({robotId:'amr-1',commandId:'park',target:[2,1.5,0]});c.advance(snap(0,exhausted?2:1.8),{bay:'amr-1'});
 const denied=c.advance(snap(1,1.8),{bay:null});expect(denied.decisions[0]?.status).toBe('executing');expect(denied.velocities[0]?.vMps).toBe(0);
 const granted=c.advance(snap(2,1.8),{bay:'amr-1'});expect(granted.velocities[0]?.vMps).toBeGreaterThan(0);
 let blocked;for(let t=3;t<=8;t++){const d=c.advance(snap(t,1.8),{bay:'amr-1'}).decisions[0];if(d?.status==='blocked')blocked={...d,t};}
 expect(blocked).toMatchObject({t:8,reason:'NO_PROGRESS'});
});
