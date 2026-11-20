import {expect,test} from 'vitest';
import {suggestGains} from '../../packages/lab-runtime/src/v2/control/gain-suggest';
import {withinEnvelope} from '../../packages/lab-runtime/src/v2/control/tuning-envelope';
import type {AxisEnvelope} from '../../packages/lab-runtime/src/v2/control/drive-io';

const wide:AxisEnvelope={axisId:'a/J1',kp:{min:0,max:1000},ki:{min:0,max:1000},kd:{min:0,max:1000},integralLimit:{min:0.01,max:6},slewLimit:{min:0.1,max:10}};
const csvEnv:AxisEnvelope={axisId:'a/w',kp:{min:0,max:20},ki:{min:0,max:64},integralLimit:{min:0.01,max:6}};

test('csp: kp = J wn^2, kd = 2 zeta wn J, no integral, no slew (J 0.5, wn 20, zeta 1 -> 200 and 20)',()=>{
 expect(suggestGains({mode:'csp',inertiaKgM2:0.5,bandwidthRadS:20,damping:1},wide)).toEqual({loop:{kp:200,ki:0,kd:20,integralLimit:null,slewLimit:null},clamped:[]});
 const s=suggestGains({mode:'csp',inertiaKgM2:0.2,bandwidthRadS:10,damping:0.7},wide).loop;
 expect(s.kp).toBeCloseTo(20,12);expect(s.kd).toBeCloseTo(2.8,12);
});
test('csv: a PI loop, kp = 2 zeta wn J, ki = J wn^2, kd 0, integral limit at the envelope ceiling',()=>{
 const r=suggestGains({mode:'csv',inertiaKgM2:0.05,bandwidthRadS:10,damping:1},csvEnv);
 expect(r.loop.kp).toBeCloseTo(1,12);expect(r.loop.ki).toBeCloseTo(5,12);
 expect(r.loop).toMatchObject({kd:0,integralLimit:6,slewLimit:null});expect(r.clamped).toEqual([]);
});
test('a result past the envelope is clamped and the fields are listed',()=>{
 const r=suggestGains({mode:'csv',inertiaKgM2:1,bandwidthRadS:40,damping:1},csvEnv);   // kp 80, ki 1600
 expect(r.loop).toMatchObject({kp:20,ki:64,kd:0});expect(r.clamped).toEqual(['kp','ki']);
 const p=suggestGains({mode:'csp',inertiaKgM2:10,bandwidthRadS:40,damping:1},{...wide,kp:{min:0,max:100},kd:{min:0,max:50}});
 expect(p.loop).toMatchObject({kp:100,kd:50});expect(p.clamped).toEqual(['kp','kd']);
});
test('every suggestion is itself inside the envelope and keeps ki > 0 exactly when an integral limit exists',()=>{
 for(const mode of ['csp','csv'] as const)for(const j of [0.001,0.05,0.5,5])for(const w of [5,10,20,40])for(const z of [0.7,1]){
  for(const env of [wide,csvEnv]){
   const {loop}=suggestGains({mode,inertiaKgM2:j,bandwidthRadS:w,damping:z},env);
   expect(withinEnvelope({axisId:env.axisId,loop,accelerationLimit:null},env),`${mode} ${j} ${w} ${z}`).toEqual([]);
   expect(loop.ki>0).toBe(loop.integralLimit!==null);
  }
 }
});
test('a csp axis whose envelope forces ki above zero gets an integral limit; one that does not list kd gets 0 and the clamp is reported',()=>{
 const forced=suggestGains({mode:'csp',inertiaKgM2:0.5,bandwidthRadS:20,damping:1},{...wide,ki:{min:1,max:5}});
 expect(forced.loop).toMatchObject({ki:1,integralLimit:6});expect(forced.clamped).toEqual(['ki']);
 const {kd:_,...noKd}=wide;void _;
 expect(suggestGains({mode:'csp',inertiaKgM2:0.5,bandwidthRadS:20,damping:1},noKd)).toMatchObject({loop:{kd:0},clamped:['kd']});
});
test('inertia, bandwidth and damping must be finite and positive',()=>{
 for(const bad of [0,-1,NaN,Infinity])for(const k of ['inertiaKgM2','bandwidthRadS','damping'] as const)expect(()=>suggestGains({mode:'csp',inertiaKgM2:0.5,bandwidthRadS:20,damping:1,[k]:bad},wide),`${k} ${bad}`).toThrow('SUGGEST_INPUT_INVALID');
});
