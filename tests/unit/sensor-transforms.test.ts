import {expect,test} from 'vitest';
import {lidarNoise} from '../../packages/lab-runtime/src/v2/control/sensor-transforms';
import {actorStream} from '../../packages/lab-runtime/src/v2/random';
const scan=()=>({rangesM:[1,2,null,3.5,0.4],states:['hit','hit','no_return','hit','hit'],rangeMinM:0.3,rangeMaxM:4});
test('zero sigma and zero dropout return the scan unchanged and still spend three numbers per ray',()=>{
 const s=scan(),a=actorStream(3,'lidar'),b=actorStream(3,'lidar');
 const out=lidarNoise(s,{sigmaM:0,dropoutFraction:0},a);
 expect(out).toEqual(scan());expect(out).not.toBe(s);
 for(let i=0;i<3*5;i++)b.next();
 expect(a.next()).toBe(b.next());
});
test('dropout turns a hit into a no_return with a null range; the others are not shifted by it',()=>{
 const full=lidarNoise(scan(),{sigmaM:0.02,dropoutFraction:1},actorStream(9,'x'));
 expect(full.states).toEqual(['no_return','no_return','no_return','no_return','no_return']);expect(full.rangesM.every(r=>r===null)).toBe(true);
 // the noise of ray k is the same with and without dropout elsewhere: the draw rule is fixed
 const lo=lidarNoise(scan(),{sigmaM:0.02,dropoutFraction:0},actorStream(9,'x')),hi=lidarNoise(scan(),{sigmaM:0.02,dropoutFraction:0.3},actorStream(9,'x'));
 hi.rangesM.forEach((r,i)=>{if(r!==null)expect(r).toBe(lo.rangesM[i]);});
});
test('noise is reproducible, finite, clamped to the sensor range, and leaves non-hit rays alone',()=>{
 const a=lidarNoise(scan(),{sigmaM:0.1,dropoutFraction:0},actorStream(5,'n')),b=lidarNoise(scan(),{sigmaM:0.1,dropoutFraction:0},actorStream(5,'n'));
 expect(a).toEqual(b);expect(a.rangesM[2]).toBeNull();expect(a.states[2]).toBe('no_return');
 for(const [i,r] of a.rangesM.entries())if(a.states[i]==='hit'){expect(r!).toBeGreaterThanOrEqual(0.3);expect(r!).toBeLessThanOrEqual(4);}
 expect(a.rangesM[0]).not.toBe(1);
});

import {replayLidarNoise} from '../../packages/lab-runtime/src/v2/control/sensor-transforms';
import {faultStartTick} from '../../packages/lab-runtime/src/v2/control/drive-faults';
const pub=(tick:number,base:number)=>({tick,scan:{sensorId:'lidar-2d',rangesM:[base,base+1,null,base+2],states:['hit','hit','no_return','hit'],rangeMinM:0.1,rangeMaxM:8}});
const lid=(id:string,at:number,durationMs:number,sigmaM:number,dropoutFraction=0)=>({id,faultId:'lidar-noise',targetId:'amr-1/lidar-2d',trigger:{kind:'elapsed_sim_ms' as const,value:at},durationMs,params:{sigmaM,dropoutFraction}});
test('replaying lidar-noise perturbs each fresh publication once, at the decision tick, with one stream across windows',()=>{
 const a=lid('a',100,200,0.05),b=lid('b',600,100,0.05),s=faultStartTick(100);   // a: ticks 6..15 (end 16), b opens at 31
 const pubs=[pub(2,1),pub(8,2),pub(12,3),pub(30,4),pub(33,5)];
 const out=replayLidarNoise({seed:9,robotId:'amr-1',schedule:[a,b],publications:pubs,lastTick:40});
 expect(s).toBe(6);
 // at decision tick 6 the newest publication is tick 2 (carried forward), drawn once; tick 8 and 12 are fresh draws; nothing inside the gap; b draws on the tick-30 publication at its first tick (31) and the tick-33 one later
 expect(out.map(x=>[x.tick,x.entryId,x.scanTick])).toEqual([[6,'a',2],[9,'a',8],[13,'a',12],[31,'b',30],[34,'b',33]]);
 // the same stream, drawn by hand, gives the same first perturbation
 const hand=lidarNoise(pubs[0]!.scan,{sigmaM:0.05,dropoutFraction:0},actorStream(9,'lidar-noise:amr-1/lidar-2d'));
 expect(out[0]!.rangesM).toEqual(hand.rangesM);expect(out[0]!.states).toEqual(hand.states);
 // continuity: the draws of b follow those of a on the same target's stream
 const stream=actorStream(9,'lidar-noise:amr-1/lidar-2d');for(const p of pubs.slice(0,3))lidarNoise(p.scan,{sigmaM:0.05,dropoutFraction:0},stream);
 expect(out[3]!.rangesM).toEqual(lidarNoise(pubs[3]!.scan,{sigmaM:0.05,dropoutFraction:0},stream).rangesM);
 expect(replayLidarNoise({seed:9,robotId:'amr-1',schedule:[a,b],publications:pubs,lastTick:40})).toEqual(out);
 expect(replayLidarNoise({seed:10,robotId:'amr-1',schedule:[a,b],publications:pubs,lastTick:40})).not.toEqual(out);
 expect(replayLidarNoise({seed:9,robotId:'amr-1',schedule:[],publications:pubs,lastTick:40})).toEqual([]);
});
