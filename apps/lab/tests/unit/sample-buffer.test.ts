// D58: the live 3D view plays received samples by sim time through a fixed 150 ms delay; nothing is ever shown outside the samples it holds.
import {expect,test} from 'vitest';
import {SampleBuffer,lerpJoints,lerpPose} from '../../src/twin/sample-buffer';
const MS=1_000_000n;
const three=()=>{const b=new SampleBuffer<number[]>(lerpJoints);b.push(0n,0,[0]);b.push(100n*MS,100,[1]);b.push(200n*MS,200,[2]);return b;};

test('plays 150 ms behind the newest sample and interpolates between the two samples around that sim time',()=>{
 const b=three();
 expect(b.at(250)).toEqual([1]);// sim 100 ms
 expect(b.at(300)).toEqual([1.5]);
 for(let t=200;t<=1000;t+=7){const v=b.at(t)![0]!;expect(v).toBeGreaterThanOrEqual(0);expect(v).toBeLessThanOrEqual(2);}
 expect(b.at(1000)).toEqual([2]);// never past the newest
});
test('a hidden tab: the view is at the newest sample, then jumps to newest minus the delay instead of replaying the backlog',()=>{
 const b=three();
 expect(b.at(60_000)).toEqual([2]);
 b.push(60_100n*MS,60_100,[3]);
 const v=b.at(60_101)![0]!;
 // sim 59 951 ms lies in the 59.9 s hole between the old and the new sample: held at the old one, never interpolated across the hole
 expect(v).toBeGreaterThanOrEqual(2);expect(v).toBeLessThanOrEqual(3);expect(v).toBeCloseTo(2,6);
 expect(b.at(60_250)).toEqual([3]);
});
test('the shown sim time never runs backwards (a burst of samples does not rewind the view)',()=>{
 const b=new SampleBuffer<number[]>(lerpJoints);
 for(let i=0;i<=10;i++)b.push(BigInt(i*100)*MS,i*100,[i]);
 const before=b.at(1100)![0]!;
 for(let i=11;i<=20;i++)b.push(BigInt(i*100)*MS,1101,[i]);// ten samples in the same millisecond: the rate estimate saturates
 expect(b.at(1102)![0]!).toBeGreaterThanOrEqual(before);
});
test('one sample, no sample, the cap',()=>{
 const b=new SampleBuffer<number[]>(lerpJoints,150,2);
 expect(b.at(0)).toBeNull();
 b.push(5n*MS,10,[7]);expect(b.at(0)).toEqual([7]);expect(b.at(10_000)).toEqual([7]);
 b.push(105n*MS,110,[8]);b.push(205n*MS,210,[9]);// cap 2: [7] is dropped
 expect(b.at(-1e9)).toEqual([8]);
 b.clear();expect(b.at(300)).toBeNull();
});
test('lerpJoints interpolates every joint; arrays of different length give b',()=>{
 expect(lerpJoints([0,1,-2],[1,3,2],0.25)).toEqual([0.25,1.5,-1]);
 expect(lerpJoints([0,1],[1,2,3],0.5)).toEqual([1,2,3]);
});
test('lerpPose turns the yaw along the shorter arc',()=>{
 const p=lerpPose([0,0,3.0],[1,2,-3.0],0.5);
 expect(p[0]).toBe(0.5);expect(p[1]).toBe(1);expect(Math.abs(Math.abs(p[2]!)-Math.PI)).toBeLessThan(0.3);// through ±π, not through 0
});
