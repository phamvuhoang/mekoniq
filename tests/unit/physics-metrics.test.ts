import {expect,test} from 'vitest';
import {integrateNormalImpulse,loadDisplacementM,physicsMetrics} from '../../packages/lab-runtime/src/v2/simulation3d/physics-metrics';
import {admission,load,tick} from '../support/physics';
test('integrates all substeps and refuses invalid or overflowing force',()=>{
 expect(integrateNormalImpulse([0,10,20,0],.002)).toBeCloseTo(.06,12);
 for(const force of [NaN,-1,Infinity])expect(()=>integrateNormalImpulse([force],.002)).toThrow('CONTACT_FORCE_INVALID');
 expect(()=>integrateNormalImpulse([1],0)).toThrow();expect(()=>integrateNormalImpulse([1e308,1e308],1)).toThrow();
});
test('slip uses fixed support coordinates despite rotating world poses',()=>{
 const a=load(),b=load();b.poseMap={positionM:[4,5,0],quaternionXyzw:[0,0,1,0]};
 expect(loadDisplacementM([a,b])).toMatchObject({available:true,value:0});b.poseInSupport!.positionM=[.03,.04,0];
 expect(loadDisplacementM([a,b])).toMatchObject({available:true,value:.05});
});
test('missing samples, prop identity or support changes cannot become zero displacement',()=>{
 for(const samples of [[],[load(),{...load(),supportId:'other'}],[load(),{...load(),propId:'other'}],[{...load(),poseInSupport:null}]])expect(loadDisplacementM(samples).available).toBe(false);
});
test('metrics transform base into actual drive frame and wrap yaw',()=>{
 const a=tick();a.odometry[0]!.poseDriveMap[2]=2*Math.PI;
 const m=physicsMetrics({complete:true,records:[a],gaps:[],issues:[]},admission);
 expect(m.wheelPositionResidualM).toMatchObject({available:true,value:0});expect(m.wheelYawResidualRad.value).toBeCloseTo(0,12);
 expect(m.stopDistanceM).toMatchObject({available:false,value:null});
});
test('incomplete coverage never produces available physics metrics',()=>{
 const m=physicsMetrics({complete:false,records:[tick()],gaps:[],issues:['missing contact samples']},admission);
 expect(Object.values(m).every(x=>!x.available)).toBe(true);
});
test('stop distance uses verified stop target, actual velocity hold, and the full actual path',()=>{
 const records=Array.from({length:5},(_,n)=>{const t=tick(n);t.base[0]!.poseMap.positionM[0]=n*.1;return t;}),read={complete:true,records,gaps:[],issues:[]};
 const navigation={complete:true,trajectory:records.map((r,n)=>({tick:n,simTimeNs:r.simTimeNs,robots:[{robotId:'robot',poseDriveMap:[n*.1,0,0] as [number,number,number],bodyVelocity:[n<3?.2:0,0] as [number,number],collisionIds:[]}]})),control:Array.from({length:4},(_,n)=>({tick:n,targetTick:n+1,singleStep:false,velocities:[{robotId:'robot',vMps:0,omegaRadps:0}],actorUpdates:[]})),policy:{stoppedLinearMps:.01,stoppedAngularRadps:.02,arrivalHoldTicks:2}};
 expect(physicsMetrics(read,admission,navigation).stopDistanceM).toMatchObject({available:true,value:.4});
 navigation.trajectory[4]!.robots[0]!.bodyVelocity=[.1,0];expect(physicsMetrics(read,admission,navigation).stopDistanceM).toMatchObject({available:false,reason:'STOP_NOT_OBSERVED'});
 navigation.complete=false;expect(physicsMetrics(read,admission,navigation).stopDistanceM.available).toBe(false);
});
test('logical interval impulse excludes tick-zero priming while preserving its raw contacts',()=>{
 const a=tick(),b=tick(1);a.contacts[0]!.normalImpulseNs=10;
 const metrics=physicsMetrics({complete:true,records:[a,b],gaps:[],issues:[]},admission);
 expect(metrics.contactImpulseNs).toMatchObject({available:true,value:.2});expect(a.contacts[0]!.normalImpulseNs).toBe(10);
 expect(physicsMetrics({complete:true,records:[a],gaps:[],issues:[]},admission).contactImpulseNs).toMatchObject({available:false,reason:'LOGICAL_INTERVAL_MISSING'});
});
test('tilt duration counts positive-tick intervals from actual chassis orientation',()=>{
 const records=[tick(),tick(1)];for(const r of records){r.base[0]!.poseMap.quaternionXyzw=[Math.SQRT1_2,0,0,Math.SQRT1_2];r.base[0]!.rollRad=Math.PI/2;}
 const m=physicsMetrics({complete:true,records,gaps:[],issues:[]},{...admission,maxAbsRollPitchRad:Math.PI/4});
 expect(m.maxTiltRad.value).toBeCloseTo(Math.PI/2,12);expect(m.tiltExceededDurationS).toMatchObject({available:true,value:.02});
});
