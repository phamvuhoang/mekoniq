import {describe,expect,test} from 'vitest';
import {fitBoundedLeastSquares} from '../../packages/lab-runtime/src/engineering/least-squares';

// every residual here is a closed form: the answer is known before the fit runs
const problem=(o:Partial<Parameters<typeof fitBoundedLeastSquares>[1]>={})=>({initial:[1,1],lower:[-10,-10],upper:[10,10],maxIterations:50,tolerance:1e-12,relativeStep:1e-6,...o});
const linear=(A:number[][],b:number[])=>async(x:readonly number[])=>A.map((row,i)=>row.reduce((s,a,j)=>s+a*x[j]!,0)-b[i]!);
const A=[[1,0],[0,2],[1,1],[2,-1],[0.5,3]],truth=[3,-2],b=A.map(r=>r[0]!*truth[0]!+r[1]!*truth[1]!);

describe('fitBoundedLeastSquares',()=>{
 test('a linear problem with a closed-form answer converges to it within 1e-6, with the objective at zero',async()=>{
  const r=await fitBoundedLeastSquares(linear(A,b),problem());
  expect(r.converged).toBe(true);expect(r.x[0]).toBeCloseTo(3,6);expect(r.x[1]).toBeCloseTo(-2,6);
  expect(r.atBound).toEqual([false,false]);expect(r.objectiveFinal).toBeLessThan(1e-12);expect(r.objectiveInitial).toBeGreaterThan(1);
  expect(r.jacobianCondition).toBeLessThan(1e3);expect(r.standardError.every(e=>e!==null&&e>=0)).toBe(true);
 });
 test('a fit that is deterministic gives the same bits twice',async()=>{
  const a=await fitBoundedLeastSquares(linear(A,b.map((v,i)=>v+(i%2?1e-3:-1e-3))),problem()),c=await fitBoundedLeastSquares(linear(A,b.map((v,i)=>v+(i%2?1e-3:-1e-3))),problem());
  expect(c).toEqual(a);
 });
 test('a noisy overdetermined fit lands on the least-squares answer and reports a finite standard error',async()=>{
  const noise=[0.01,-0.02,0.015,-0.005,0.01],y=b.map((v,i)=>v+noise[i]!),r=await fitBoundedLeastSquares(linear(A,y),problem());
  // normal equations for the exact reference
  const ata=[[0,0],[0,0]],atb=[0,0];A.forEach((row,i)=>{for(let j=0;j<2;j++){atb[j]+=row[j]!*y[i]!;for(let k=0;k<2;k++)ata[j]![k]+=row[j]!*row[k]!;}});
  const det=ata[0]![0]!*ata[1]![1]!-ata[0]![1]!*ata[1]![0]!,ref=[(atb[0]!*ata[1]![1]!-ata[0]![1]!*atb[1]!)/det,(ata[0]![0]!*atb[1]!-ata[1]![0]!*atb[0]!)/det];
  expect(r.x[0]).toBeCloseTo(ref[0]!,6);expect(r.x[1]).toBeCloseTo(ref[1]!,6);expect(r.standardError[0]).toBeGreaterThan(0);expect(r.standardError[0]).toBeLessThan(0.1);
 });
 test('an unconstrained answer outside the bounds ends ON the bound and says so',async()=>{
  const r=await fitBoundedLeastSquares(linear(A,b),problem({upper:[2,10]}));
  expect(r.x[0]).toBeCloseTo(2,9);expect(r.atBound).toEqual([true,false]);expect(r.converged).toBe(true);expect(r.objectiveFinal).toBeGreaterThan(1e-3);
  const lo=await fitBoundedLeastSquares(linear(A,b),problem({lower:[-10,-1]}));expect(lo.x[1]).toBeCloseTo(-1,9);expect(lo.atBound).toEqual([false,true]);
 });
 test('a residual that is NaN, infinite or changes its length is RESIDUAL_INVALID',async()=>{
  await expect(fitBoundedLeastSquares(async()=>[NaN],problem())).rejects.toThrow('RESIDUAL_INVALID');
  await expect(fitBoundedLeastSquares(async()=>[Infinity,0],problem())).rejects.toThrow('RESIDUAL_INVALID');
  await expect(fitBoundedLeastSquares(async()=>[],problem())).rejects.toThrow('RESIDUAL_INVALID');
  let n=0;await expect(fitBoundedLeastSquares(async x=>(n++<3?[x[0]!,x[1]!]:[x[0]!]),problem())).rejects.toThrow('RESIDUAL_INVALID');
  // a NaN that appears only after the start (a step into an unstable plant) is caught too
  let calls=0;await expect(fitBoundedLeastSquares(async x=>(++calls>4?[NaN]:[x[0]!-3]),problem({initial:[1],lower:[-10],upper:[10]}))).rejects.toThrow('RESIDUAL_INVALID');
 });
 test('running out of iterations is converged:false, with the best point so far',async()=>{
  // rosenbrock-like curvature the damped step cannot finish in two iterations
  const r=await fitBoundedLeastSquares(async x=>[10*(x[1]!-x[0]!*x[0]!),1-x[0]!],problem({initial:[-1.2,1],maxIterations:2}));
  expect(r.converged).toBe(false);expect(r.iterations).toBe(2);expect(r.objectiveFinal).toBeLessThanOrEqual(r.objectiveInitial);
 });
 test('a point that no step improves while the gradient is not zero is NOT claimed converged (found on the wheel torque scale: a fit that stood still at its start and said converged)',async()=>{
  const spike=async(x:readonly number[])=>[x[0]===1?1:2];   // every move from the start raises the residual; the forward difference sees a steep slope
  const r=await fitBoundedLeastSquares(spike,problem({initial:[1],lower:[-10],upper:[10]}));
  expect(r.converged).toBe(false);expect(r.x).toEqual([1]);expect(r.objectiveFinal).toBe(r.objectiveInitial);
  // a real minimum that no step can improve (zero gradient) is converged
  const flat=await fitBoundedLeastSquares(async x=>[x[0]!-1],problem({initial:[1],lower:[-10],upper:[10]}));expect(flat.converged).toBe(true);
 });
 test('two parameters that only ever appear as a sum cannot be told apart: a huge condition number and no standard error',async()=>{
  const r=await fitBoundedLeastSquares(async x=>[x[0]!+x[1]!-3,2*(x[0]!+x[1]!)-6,0.5*(x[0]!+x[1]!)-1.5],problem());
  expect(r.jacobianCondition).toBeGreaterThan(1e8);expect(r.standardError).toEqual([null,null]);expect(r.x[0]!+r.x[1]!).toBeCloseTo(3,6);
 });
 test('R01: a NONLINEAR response that depends on the sum of two parameters is not separable at the settings the self-test uses (relative step 1e-2): the condition is unbounded, not an artefact of two different finite-difference steps',async()=>{
  const sumOnly=async(x:readonly number[])=>{const s=x[0]!+x[1]!;return [0,0.2,0.4,0.6,0.8,1].map(t=>0.1*(1-Math.exp(-t/(0.02*s/1.1)))-0.1*(1-Math.exp(-t/(0.02*1.63/1.1))));};
  for(const relativeStep of [1e-2,1e-3,1e-4]){
   const r=await fitBoundedLeastSquares(sumOnly,problem({initial:[0.1,1],lower:[0.02,0.2],upper:[0.5,4],relativeStep,tolerance:1e-6,maxIterations:15}));
   expect(r.jacobianCondition,`step ${relativeStep}`).toBe(Infinity);expect(r.standardError).toEqual([null,null]);
  }
  // a separable nonlinear problem keeps a small, step-independent condition number and its error bars
  const separable=async(x:readonly number[])=>[0,0.2,0.4,0.6,0.8,1].flatMap(t=>[0.1*(1-Math.exp(-t/(0.02*x[0]!/0.1)))-0.1*(1-Math.exp(-t/0.026)),0.1/(1+0.1*(x[1]!-1))-0.1/(1+0.1*0.5)]);
  const ok=await fitBoundedLeastSquares(separable,problem({initial:[0.1,1],lower:[0.02,0.2],upper:[0.5,4],relativeStep:1e-2,tolerance:1e-6,maxIterations:30}));
  expect(ok.jacobianCondition).toBeLessThan(100);expect(ok.standardError.every(e=>e!==null)).toBe(true);
 });
 test('R08: a valid interval narrower than the finite-difference step is fitted inside it, never PROBLEM_INVALID',async()=>{
  const r=await fitBoundedLeastSquares(async x=>[x[0]!-1.000002],problem({initial:[1],lower:[0.99999],upper:[1.00001],relativeStep:1e-4,tolerance:1e-9}));
  expect(r.x[0]).toBeCloseTo(1.000002,9);expect(r.atBound).toEqual([false]);expect(r.converged).toBe(true);
  // a start on the upper bound steps backwards, by what the interval allows
  const edge=await fitBoundedLeastSquares(async x=>[x[0]!-1.000005],problem({initial:[1.00001],lower:[0.99999],upper:[1.00001],relativeStep:1e-4,tolerance:1e-9}));
  expect(edge.x[0]).toBeCloseTo(1.000005,9);
 });
 test('the Jacobian is conditioned in units of the bounds: a parameter 1e6 times larger than another is not "ill-conditioned" for that',async()=>{
  const r=await fitBoundedLeastSquares(async x=>[(x[0]!-2e6)/1e6,(x[1]!-3e-3)/1e-3,0.1*x[0]!/1e6+0.1*x[1]!/1e-3-0.5],problem({initial:[1e6,1e-3],lower:[0,0],upper:[1e7,1e-2]}));
  expect(r.jacobianCondition).toBeLessThan(1e3);
 });
 test('more than 12 parameters, a bad bound and a bad start are refused before any evaluation',async()=>{
  let calls=0;const f=async()=>{calls++;return [0];};
  const n=13,mk=(v:number)=>Array<number>(n).fill(v);
  await expect(fitBoundedLeastSquares(f,problem({initial:mk(1),lower:mk(0),upper:mk(2)}))).rejects.toThrow('PROBLEM_INVALID');
  await expect(fitBoundedLeastSquares(f,problem({lower:[1,0],upper:[1,2]}))).rejects.toThrow('PROBLEM_INVALID');
  await expect(fitBoundedLeastSquares(f,problem({initial:[5,1],upper:[2,2]}))).rejects.toThrow('PROBLEM_INVALID');
  await expect(fitBoundedLeastSquares(f,problem({maxIterations:0}))).rejects.toThrow('PROBLEM_INVALID');
  await expect(fitBoundedLeastSquares(f,problem({relativeStep:0}))).rejects.toThrow('PROBLEM_INVALID');
  expect(calls).toBe(0);
 });
});
