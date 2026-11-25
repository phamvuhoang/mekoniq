import {describe,expect,test} from 'vitest';
import {validateRunRequestV2} from '../../packages/lab-runtime/src/v2/contracts';

const REF={bundleDigest:'a'.repeat(64),projectDigest:'b'.repeat(64)};
const base={scenarioId:'MJ-TRAY01',scenarioRevision:1,seed:7,mode:'simulation',backendSetId:'engineering-mujoco-3d-v1',access:'simulated',runtimeIdentity:{sourceCommit:'x',schemaHash:'a'.repeat(64)},engineeringRef:REF};
const entry=(id:string,fn='emergency',value=2000)=>({id,function:fn,trigger:{kind:'elapsed_sim_ms',value}});
const issues=(r:ReturnType<typeof validateRunRequestV2>)=>r.ok?[]:r.issues.map(i=>i.code);

describe('stopSchedule in a run request',()=>{
 test('a request without one is valid exactly as before',()=>{expect(validateRunRequestV2(base).ok).toBe(true);});
 test('up to four well-formed entries on an engineering MuJoCo mobile run',()=>{
  expect(validateRunRequestV2({...base,stopSchedule:[entry('a'),entry('b','normal',3000)]}).ok).toBe(true);
  expect(validateRunRequestV2({...base,stopSchedule:[1,2,3,4].map(i=>entry('s'+i,'normal',i*1000))}).ok).toBe(true);
 });
 test.each([
  ['five entries',[1,2,3,4,5].map(i=>entry('s'+i))],
  ['an unknown function',[entry('a','hold')]],
  ['a trigger that is not simulated time',[{id:'a',function:'emergency',trigger:{kind:'phase',value:'grasp'}}]],
  ['a negative time',[entry('a','emergency',-5)]],
  ['a stray field',[{...entry('a'),axes:['amr-1/wheel-left']}]],
  ['a missing id',[{function:'emergency',trigger:{kind:'elapsed_sim_ms',value:1}}]],
 ])('rejects %s',(_n,stopSchedule)=>{expect(validateRunRequestV2({...base,stopSchedule}).ok).toBe(false);});
 test('rejects a stop request on a run that has no drive: another backend set, mock mode, no engineering bundle, or a bench',()=>{
  expect(issues(validateRunRequestV2({...base,backendSetId:'engineering-mujoco-cell-v1',stopSchedule:[entry('a')]}))).toContain('STOP_BACKEND_UNSUPPORTED');
  expect(validateRunRequestV2({...base,mode:'mock',backendSetId:'mock-default',access:'simulated',stopSchedule:[entry('a')]}).ok).toBe(false);
  expect(validateRunRequestV2({...base,engineeringRef:undefined,stopSchedule:[entry('a')]}).ok).toBe(false);
 });
});
