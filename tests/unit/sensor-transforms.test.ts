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
