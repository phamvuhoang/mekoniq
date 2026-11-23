import {expect,test} from 'vitest';
import {createHash} from 'node:crypto';
import {createPoseEstimator,type TruthSample} from '../../packages/lab-runtime/src/v2/perception/pose-estimator-sim';
const base={schemaVersion:1,id:'t',revision:1,digest:'0'.repeat(64),updateEveryTicks:10,latencyTicks:5,biasM:[0.007,0],sigmaM:[0,0],dropoutProbability:0,visibleRegionId:'nozzle-stand',maxAgeTicks:50};
const P=(o:object={})=>({...base,...o}) as never;
const support=()=>({baseInMap:{position:[0,0,0],quaternionXyzw:[0,0,0,1]},support:{centerM:[0.49,0,0.05],sizeM:[0.1,0.1,0.1]},cupHeightM:0.1});
const estimator=(p:Parameters<typeof createPoseEstimator>[0],seed:number,id:string,geometry=support())=>createPoseEstimator(p,seed,id,geometry);
const truthAt=(tick:number):TruthSample=>({tick,positionM:[0.49+tick*1e-4,0,0.151],inRegion:true});
const run=(e:ReturnType<typeof createPoseEstimator>,to:number,at=truthAt)=>{const out=[];for(let t=0;t<=to;t++){const r=e.update(t,at);if(r)out.push(r);}return out;};

test('an estimate is the delayed truth plus the declared bias',()=>{
 const e=estimator(P(),42,'cup-1');
 for(let t=0;t<20;t++)e.update(t,truthAt);
 const r=e.update(20,truthAt)!;
 expect(r.belief!.observedTick).toBe(15);expect(r.belief!.publishedTick).toBe(20);
 expect(r.belief!.positionM[0]).toBeCloseTo(0.49+15e-4+0.007,12);expect(r.errorM).toBeCloseTo(0.007,12);
 expect(r.truthAtObservedTick[0]).toBeCloseTo(0.49+15e-4,12);
 expect(e.update(21,truthAt)).toBeNull();
});
test('the height is the declared support height, never an estimate of z',()=>{
 const r=run(estimator(P({sigmaM:[0.01,0.01]}),1,'cup-1'),30).at(-1)!;
 expect(r.belief!.positionM[2]).toBeCloseTo(0.15,12);expect(r.belief!.sigmaM).toEqual([0.01,0.01,0]);
});
test('an object outside the view region gives a record without a belief',()=>{
 const r=run(estimator(P(),1,'cup-1'),20,t=>({...truthAt(t),inRegion:false})).at(-1)!;
 expect(r).toMatchObject({belief:null,dropped:false,reason:'OUT_OF_VIEW',errorM:null});
});
test('a dropped update has no belief and still spends its three draws, so later estimates do not move',()=>{
 const noisy={sigmaM:[0.005,0.005]};
 const a=run(estimator(P(noisy),7,'cup-1'),200),b=run(estimator(P({...noisy,dropoutProbability:0.5}),7,'cup-1'),200);
 const dropped=b.filter(r=>r.dropped);
 expect(dropped.length).toBeGreaterThan(0);expect(dropped.length).toBeLessThan(b.length);
 for(const r of dropped)expect(r).toMatchObject({belief:null,reason:'DROPOUT'});
 for(const r of b.filter(r=>!r.dropped))expect(r.belief!.positionM).toEqual(a.find(x=>x.tick===r.tick)!.belief!.positionM);
});
test('the same seed and profile give the same sequence, another seed another one',()=>{
 const p=P({sigmaM:[0.005,0.005]}),x=run(estimator(p,3,'cup-1'),100),y=run(estimator(p,3,'cup-1'),100),z=run(estimator(p,4,'cup-1'),100);
 expect(y).toEqual(x);expect(z).not.toEqual(x);
});
test('x/y, dropout and out-of-view draws retain the pre-support-z baseline sequence',()=>{
 // Projection of the estimator at Source 79d233a8; z alone is intentionally excluded.
 const records=run(estimator(P({sigmaM:[0.005,0.005],dropoutProbability:0.5}),7,'cup-1'),500,t=>({...truthAt(t),inRegion:t%40!==5}));
 const rows=records.map(r=>({tick:r.tick,dropped:r.dropped,reason:r.reason??null,xy:r.belief?.positionM.slice(0,2)??null,observedTick:r.belief?.observedTick??null,publishedTick:r.belief?.publishedTick??null,errorM:r.errorM}));
 expect(rows).toHaveLength(50);expect(createHash('sha256').update(JSON.stringify(rows)).digest('hex')).toBe('26f26ed45b3f2432b58c4b37adc5fb4a6ca7f612621a9ccb17e381b696e36a8b');
});
test('the noise follows the fixed Box-Muller rule of contracts section 6',()=>{
 const sigma=0.004,rs=run(estimator(P({sigmaM:[sigma,sigma],biasM:[0,0],latencyTicks:0,updateEveryTicks:1}),9,'cup-1'),4000);
 const dx=rs.map(r=>r.belief!.positionM[0]-r.truthAtObservedTick[0]),mean=dx.reduce((a,b)=>a+b)/dx.length,sd=Math.sqrt(dx.reduce((a,b)=>a+(b-mean)**2,0)/dx.length);
 expect(Math.abs(mean)).toBeLessThan(sigma*0.1);expect(sd).toBeGreaterThan(sigma*0.9);expect(sd).toBeLessThan(sigma*1.1);
});
test('a ground-truth profile has zero error at every tick and says so',()=>{
 const rs=run(estimator(P({biasM:[0,0],latencyTicks:0,updateEveryTicks:1}),5,'cup-1'),50);
 expect(rs.every(r=>r.errorM===0&&r.belief!.source==='ground_truth')).toBe(true);
 expect(run(estimator(P(),5,'cup-1'),50).every(r=>r.belief===null||r.belief.source==='pose_estimator_sim')).toBe(true);
});
test('before the first observable tick there is nothing to publish',()=>{
 expect(estimator(P(),1,'cup-1').update(0,t=>t<0?null:truthAt(t))).toBeNull();
});

// R4-D24: changing unmeasured truth z must never change the declared upright support model.
test.each([false,true])('support geometry determines z for the noisy/ground-truth profile (groundTruth=%s)',groundTruth=>{
 const p=P({biasM:groundTruth?[0,0]:[0.007,0],sigmaM:[0,0],latencyTicks:0,updateEveryTicks:1});
 const a=estimator(p,42,'cup-1'),b=estimator(p,42,'cup-1');
 for(let tick=0;tick<5;tick++){
  const low=a.update(tick,t=>({...truthAt(t),positionM:[0.49,0,-0.3]}))!,high=b.update(tick,t=>({...truthAt(t),positionM:[0.49,0,2]}))!;
  expect(low.belief!.positionM).toEqual(high.belief!.positionM);expect(low.belief!.positionM[2]).toBeCloseTo(0.15,12);
  expect(low.truthAtObservedTick[2]).toBe(-0.3);expect(high.truthAtObservedTick[2]).toBe(2);
  expect(low.errorM).toBeCloseTo(groundTruth?0:0.007,12);expect(high.errorM).toBeCloseTo(groundTruth?0:0.007,12);
 }
});
test('support coordinates are map coordinates: translated/yawed arm and another cup height do not double-transform the support',()=>{
 const geometry={baseInMap:{position:[1,2,0.7],quaternionXyzw:[0,0,Math.SQRT1_2,Math.SQRT1_2]},support:{centerM:[1,2.49,0.8],sizeM:[0.1,0.1,0.2]},cupHeightM:0.16};
 const r=estimator(P({latencyTicks:0}),1,'cup-1',geometry).update(0,()=>({tick:0,positionM:[0.49,0,123],inRegion:true}))!;
 expect(r.belief!.positionM[2]).toBeCloseTo(0.28,12);expect(r.belief!.frameId).toBe('arm-base');
});
test.each(['missing','nan','overflow','zero-height','bad-size','tilted','upside-down','bad-quaternion'])('missing, nonfinite or unsupported upright support geometry refuses before estimation: %s',kind=>{
 const geometry=support();
 if(kind==='nan')geometry.support.centerM[2]=NaN;
 if(kind==='overflow'){geometry.support.centerM[2]=Number.MAX_VALUE;geometry.cupHeightM=Number.MAX_VALUE;}
 if(kind==='zero-height')geometry.cupHeightM=0;
 if(kind==='bad-size')geometry.support.sizeM[2]=-1;
 if(kind==='tilted')geometry.baseInMap.quaternionXyzw=[Math.sin(0.1),0,0,Math.cos(0.1)];
 if(kind==='upside-down')geometry.baseInMap.quaternionXyzw=[1,0,0,0];
 if(kind==='bad-quaternion')geometry.baseInMap.quaternionXyzw=[0,0,0,2];
 expect(()=>createPoseEstimator(P(),1,'cup-1',(kind==='missing'?undefined:geometry) as never)).toThrow();
});
