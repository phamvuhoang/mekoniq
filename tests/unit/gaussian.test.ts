import {expect,test} from 'vitest';
import {actorStream,gaussianPair} from '../../packages/lab-runtime/src/v2/random';
test('gaussianPair is reproducible from the seed and spends exactly two uniforms',()=>{
 const a=actorStream(7,'lidar:amr-1'),b=actorStream(7,'lidar:amr-1'),c=actorStream(7,'lidar:amr-1');
 expect(gaussianPair(a)).toEqual(gaussianPair(b));
 c.next();c.next();
 expect(a.next()).toBe(c.next());   // the third uniform after a pair is the same as after two plain draws
});
test('gaussianPair has mean 0 and standard deviation 1 within sampling error over 10,000 pairs',()=>{
 const s=actorStream(1,'g'),xs:number[]=[];
 for(let i=0;i<10_000;i++)xs.push(...gaussianPair(s));
 const mean=xs.reduce((p,x)=>p+x,0)/xs.length,sd=Math.sqrt(xs.reduce((p,x)=>p+(x-mean)**2,0)/xs.length);
 expect(Math.abs(mean)).toBeLessThan(0.03);expect(Math.abs(sd-1)).toBeLessThan(0.03);
 expect(xs.every(Number.isFinite)).toBe(true);
});
test('u1 is taken in (0,1] so a draw of exactly 0 cannot reach log(0)',()=>{
 const zero={next:()=>0,int:()=>0};
 const [x,y]=gaussianPair(zero);expect(Number.isFinite(x)&&Number.isFinite(y)).toBe(true);
});
