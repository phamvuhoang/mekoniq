import {expect,test} from 'vitest';
import {createPoseEstimator,type TruthSample} from '../../packages/lab-runtime/src/v2/perception/pose-estimator-sim';
const base={schemaVersion:1,id:'t',revision:1,digest:'0'.repeat(64),updateEveryTicks:10,latencyTicks:5,biasM:[0.007,0],sigmaM:[0,0],dropoutProbability:0,visibleRegionId:'nozzle-stand',maxAgeTicks:50};
const P=(o:object={})=>({...base,...o}) as never;
const truthAt=(tick:number):TruthSample=>({tick,positionM:[0.49+tick*1e-4,0,0.151],inRegion:true});
const run=(e:ReturnType<typeof createPoseEstimator>,to:number,at=truthAt)=>{const out=[];for(let t=0;t<=to;t++){const r=e.update(t,at);if(r)out.push(r);}return out;};

test('an estimate is the delayed truth plus the declared bias',()=>{
 const e=createPoseEstimator(P(),42,'cup-1');
 for(let t=0;t<20;t++)e.update(t,truthAt);
 const r=e.update(20,truthAt)!;
 expect(r.belief!.observedTick).toBe(15);expect(r.belief!.publishedTick).toBe(20);
 expect(r.belief!.positionM[0]).toBeCloseTo(0.49+15e-4+0.007,12);expect(r.errorM).toBeCloseTo(0.007,12);
 expect(r.truthAtObservedTick[0]).toBeCloseTo(0.49+15e-4,12);
 expect(e.update(21,truthAt)).toBeNull();
});
test('the height is the declared support height, never an estimate of z',()=>{
 const r=run(createPoseEstimator(P({sigmaM:[0.01,0.01]}),1,'cup-1'),30).at(-1)!;
 expect(r.belief!.positionM[2]).toBe(0.151);expect(r.belief!.sigmaM).toEqual([0.01,0.01,0]);
});
test('an object outside the view region gives a record without a belief',()=>{
 const r=run(createPoseEstimator(P(),1,'cup-1'),20,t=>({...truthAt(t),inRegion:false})).at(-1)!;
 expect(r).toMatchObject({belief:null,dropped:false,reason:'OUT_OF_VIEW',errorM:null});
});
test('a dropped update has no belief and still spends its three draws, so later estimates do not move',()=>{
 const noisy={sigmaM:[0.005,0.005]};
 const a=run(createPoseEstimator(P(noisy),7,'cup-1'),200),b=run(createPoseEstimator(P({...noisy,dropoutProbability:0.5}),7,'cup-1'),200);
 const dropped=b.filter(r=>r.dropped);
 expect(dropped.length).toBeGreaterThan(0);expect(dropped.length).toBeLessThan(b.length);
 for(const r of dropped)expect(r).toMatchObject({belief:null,reason:'DROPOUT'});
 for(const r of b.filter(r=>!r.dropped))expect(r.belief!.positionM).toEqual(a.find(x=>x.tick===r.tick)!.belief!.positionM);
});
test('the same seed and profile give the same sequence, another seed another one',()=>{
 const p=P({sigmaM:[0.005,0.005]}),x=run(createPoseEstimator(p,3,'cup-1'),100),y=run(createPoseEstimator(p,3,'cup-1'),100),z=run(createPoseEstimator(p,4,'cup-1'),100);
 expect(y).toEqual(x);expect(z).not.toEqual(x);
});
test('the noise follows the fixed Box-Muller rule of contracts section 6',()=>{
 const sigma=0.004,rs=run(createPoseEstimator(P({sigmaM:[sigma,sigma],biasM:[0,0],latencyTicks:0,updateEveryTicks:1}),9,'cup-1'),4000);
 const dx=rs.map(r=>r.belief!.positionM[0]-r.truthAtObservedTick[0]),mean=dx.reduce((a,b)=>a+b)/dx.length,sd=Math.sqrt(dx.reduce((a,b)=>a+(b-mean)**2,0)/dx.length);
 expect(Math.abs(mean)).toBeLessThan(sigma*0.1);expect(sd).toBeGreaterThan(sigma*0.9);expect(sd).toBeLessThan(sigma*1.1);
});
test('a ground-truth profile has zero error at every tick and says so',()=>{
 const rs=run(createPoseEstimator(P({biasM:[0,0],latencyTicks:0,updateEveryTicks:1}),5,'cup-1'),50);
 expect(rs.every(r=>r.errorM===0&&r.belief!.source==='ground_truth')).toBe(true);
 expect(run(createPoseEstimator(P(),5,'cup-1'),50).every(r=>r.belief===null||r.belief.source==='pose_estimator_sim')).toBe(true);
});
test('before the first observable tick there is nothing to publish',()=>{
 expect(createPoseEstimator(P(),1,'cup-1').update(0,t=>t<0?null:truthAt(t))).toBeNull();
});
