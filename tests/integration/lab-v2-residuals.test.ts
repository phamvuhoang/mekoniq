import {expect,test} from 'vitest';
import {alignObservations,computeResiduals,validateDatasets,assessDrift,type AlignmentProfile,type SeriesSample} from '../../packages/lab-runtime/src/v2/residuals';
// Synthetic fixtures only (F06): a prediction series and an "observed" series with a known offset. H02 brings real shadow data.
const MS=1000000n;
const profile:AlignmentProfile=Object.freeze({id:'amr-shadow-profile',revision:3,frameId:'map',clockOffsetNs:String(5n*MS),maxSkewNs:String(10n*MS),maxGapNs:String(200n*MS),
 calibration:Object.freeze({id:'cal-2026-11',revision:1,datasetIds:Object.freeze(['cal-run-1','cal-run-2'])}),driftThreshold:Object.freeze({translation:0.02,orientation:0.05,cycle:1})}) as AlignmentProfile;
const at=(ms:bigint)=>String(ms*MS);
const pose=(t:bigint,v:number[],over:Partial<SeriesSample>={}):SeriesSample=>({entityId:'amr-1',quantity:'translation',unit:'m',frameId:'map',timeNs:at(t),quality:'valid',value:v,...over});
const yaw=(a:number)=>[0,0,Math.sin(a/2),Math.cos(a/2)];
// predicted: x = t (m per s) every 100 ms; observed: +3 cm x, +4 cm y (0.05 m), stamped 5 ms later on the observer clock (the profile's offset)
const predicted=Array.from({length:11},(_,i)=>pose(BigInt(i*100),[i/10,0,0]));
const observed=Array.from({length:11},(_,i)=>pose(BigInt(i*100)+5n,[i/10+0.03,0.04,0]));

test('known translation offset gives 0.05 m residual with full coverage and zero skew after clock alignment',()=>{
 const a=alignObservations(predicted,observed,profile);
 expect(a.available).toBe(true);
 const r=computeResiduals(a);
 if(!r.available)throw new Error(r.reason);
 const t=r.quantities.find(q=>q.quantity==='translation')!;
 expect(t.unit).toBe('m');expect(t.count).toBe(11);expect(t.rms).toBeCloseTo(0.05,12);expect(t.maxAbs).toBeCloseTo(0.05,12);
 expect(r.coverage).toEqual({observed:11,aligned:11,ratio:1});expect(r.maxSkewNs).toBe('0');
});

test('orientation residual is the quaternion geodesic angle in rad; cycle in s; volume m3 and mass kg are signed differences',()=>{
 const p=[pose(0n,yaw(0.2),{quantity:'orientation',unit:'quaternion_xyzw'}),{entityId:'coffee-1',quantity:'cycle',unit:'s',frameId:null,timeNs:at(0n),quality:'valid',value:[30],key:'job-1/brew'},
  {entityId:'coffee-1',quantity:'volume',unit:'m3',frameId:null,timeNs:at(0n),quality:'valid',value:[0.00003],key:'job-1/brew'},{entityId:'coffee-1',quantity:'mass',unit:'kg',frameId:null,timeNs:at(0n),quality:'valid',value:[0.12],key:'job-1/ice'}] as SeriesSample[];
 // observed cycle completes 1.5 s later than predicted: matched by key, not by timestamp
 const o=[pose(5n,yaw(0.3),{quantity:'orientation',unit:'quaternion_xyzw'}),{...p[1]!,timeNs:at(1505n),value:[31.5]},{...p[2]!,timeNs:at(1505n),value:[0.000028]},{...p[3]!,timeNs:at(905n),value:[0.125]}] as SeriesSample[];
 const r=computeResiduals(alignObservations(p,o,profile));
 if(!r.available)throw new Error(r.reason);
 const q=Object.fromEntries(r.quantities.map(x=>[x.quantity,x]));
 expect(q.orientation).toMatchObject({unit:'rad',count:1});expect(q.orientation!.rms).toBeCloseTo(0.1,12);
 expect(q.cycle).toMatchObject({unit:'s',count:1});expect(q.cycle!.mean).toBeCloseTo(1.5,12);
 expect(q.volume).toMatchObject({unit:'m3',count:1});expect(q.volume!.mean).toBeCloseTo(-0.000002,15);
 expect(q.mass).toMatchObject({unit:'kg',count:1});expect(q.mass!.mean).toBeCloseTo(0.005,12);
});

test('interpolates only inside the profile gap; a larger prediction gap is excluded, never bridged',()=>{
 const sparse=[pose(0n,[0,0,0]),pose(100n,[1,0,0]),pose(1100n,[2,0,0])];
 const obs=[pose(55n,[0.5,0,0]),pose(605n,[1.5,0,0])]; // aligned to 50 ms (inside a 100 ms gap) and 600 ms (inside a 1 s gap)
 const a=alignObservations(sparse,obs,profile);
 if(!a.available)throw new Error(a.reason);
 expect(a.pairs).toHaveLength(1);expect(a.pairs[0]!.predicted).toEqual([0.5,0,0]);expect(a.pairs[0]!.skewNs).toBe(String(50n*MS));
 expect(a.excluded).toEqual([{entityId:'amr-1',quantity:'translation',timeNs:at(605n),reason:'GAP_EXCEEDS_PROFILE'}]);
 expect(a.coverage).toEqual({observed:2,aligned:1,ratio:0.5});
});

test('missing timestamps, stale/unknown quality, missing or foreign frames and duplicates are excluded and counted',()=>{
 const obs=[...observed.slice(0,4),pose(0n,[9,9,9],{timeNs:null}),pose(405n,[9,9,9],{quality:'stale'}),pose(505n,[9,9,9],{quality:'unknown'}),pose(605n,[9,9,9],{frameId:null}),pose(705n,[9,9,9],{frameId:'odom'}),{...observed[1]!}];
 const r=computeResiduals(alignObservations(predicted,obs,profile));
 if(!r.available)throw new Error(r.reason);
 expect(r.coverage).toEqual({observed:10,aligned:4,ratio:0.4});
 expect(r.excluded).toEqual({TIMESTAMP_MISSING:1,QUALITY_NOT_VALID:2,FRAME_MISSING:1,FRAME_MISMATCH:1,DUPLICATE:1});
 expect(r.quantities[0]!.rms).toBeCloseTo(0.05,12);
});

test('out-of-order input gives the same alignment as ordered input',()=>{
 const shuffle=<T,>(xs:T[])=>xs.map((x,i)=>[x,(i*7)%xs.length] as const).sort((a,b)=>a[1]-b[1]).map(x=>x[0]);
 expect(computeResiduals(alignObservations(shuffle(predicted),shuffle(observed),profile))).toEqual(computeResiduals(alignObservations(predicted,observed,profile)));
});

test('unit errors are refused, not converted silently; all-invalid input is unavailable, never a zero residual',()=>{
 const mm=observed.map(s=>({...s,unit:'mm',value:s.value.map(v=>v*1000)}));
 const a=alignObservations(predicted,mm,profile);
 if(!a.available)throw new Error(a.reason);
 expect(a.excluded.every(e=>e.reason==='UNIT_MISMATCH')).toBe(true);
 expect(computeResiduals(a)).toEqual({available:false,reason:'NO_VALID_SAMPLES'});
 const badQuat=[pose(5n,[0,0,1,1],{quantity:'orientation',unit:'quaternion_xyzw'})];
 expect(alignObservations([pose(0n,yaw(0),{quantity:'orientation',unit:'quaternion_xyzw'})],badQuat,profile)).toMatchObject({available:true,excluded:[{reason:'VALUE_INVALID'}]});
 expect(alignObservations(predicted,[pose(5n,[1,2])],profile)).toMatchObject({excluded:[{reason:'VALUE_INVALID'}]}); // wrong arity
 expect(alignObservations(predicted.map(s=>({...s,unit:'deg'})),observed,profile)).toMatchObject({excluded:expect.arrayContaining([{entityId:'amr-1',quantity:'translation',timeNs:at(5n),reason:'UNIT_MISMATCH'}])});
 expect(alignObservations(predicted.map(s=>({...s,entityId:'other'})),observed,profile)).toMatchObject({excluded:expect.arrayContaining([{entityId:'amr-1',quantity:'translation',timeNs:at(5n),reason:'NO_PREDICTION'}])});
});

test('without calibration or timestamp alignment the residual is unavailable (not 0)',()=>{
 for(const [p,reason] of [[null,'ALIGNMENT_MISSING'],[{...profile,clockOffsetNs:null},'ALIGNMENT_MISSING'],[{...profile,calibration:null},'CALIBRATION_MISSING']] as const){
  const a=alignObservations(predicted,observed,p as AlignmentProfile|null);
  expect(a).toEqual({available:false,reason});
  expect(computeResiduals(a)).toEqual({available:false,reason});
 }
});

test('calibration dataset ids must not overlap held-out validation ids',()=>{
 expect(validateDatasets(['cal-run-1','cal-run-2'],['val-run-1'])).toEqual({ok:true,reasonCodes:[],overlap:[]});
 expect(validateDatasets(['cal-run-1','cal-run-2'],['val-run-1','cal-run-2'])).toEqual({ok:false,reasonCodes:['DATASET_OVERLAP'],overlap:['cal-run-2']});
 expect(validateDatasets([],['val-run-1'])).toEqual({ok:false,reasonCodes:['CALIBRATION_SET_EMPTY'],overlap:[]});
 expect(validateDatasets(['cal-run-1'],[])).toEqual({ok:false,reasonCodes:['VALIDATION_SET_EMPTY'],overlap:[]});
});

test('drift beyond the profile threshold only recommends and invalidates evidence; it never writes controller parameters',()=>{
 const before=JSON.stringify(profile);
 const r=computeResiduals(alignObservations(predicted,observed,profile));
 const d=assessDrift(r,profile,['ev-fd01-shadow-1']);
 expect(d.status).toBe('drift');
 expect(d.exceeded).toEqual([{quantity:'translation',unit:'m',rms:expect.closeTo(0.05,12),threshold:0.02}]);
 expect(d.recommendation).toMatch(/recalibrat/i);expect(d.invalidatedEvidence).toEqual(['ev-fd01-shadow-1']);
 expect(d.controllerWrites).toEqual([]);expect(JSON.stringify(profile)).toBe(before);
 const close=computeResiduals(alignObservations(predicted,predicted.map(s=>({...s,timeNs:String(BigInt(s.timeNs!)+5n*MS)})),profile));
 expect(assessDrift(close,profile,['ev-1'])).toMatchObject({status:'within',exceeded:[],recommendation:null,invalidatedEvidence:[]});
 expect(assessDrift({available:false,reason:'CALIBRATION_MISSING'},profile,['ev-1'])).toMatchObject({status:'unavailable',invalidatedEvidence:[]});
});
