import {expect,test} from 'vitest';
import {withinEnvelope} from '../../packages/lab-runtime/src/v2/control/tuning-envelope';
import type {AxisControl,AxisEnvelope} from '../../packages/lab-runtime/src/v2/control/drive-io';

const env:AxisEnvelope={axisId:'a/J1',kp:{min:0,max:100},ki:{min:0,max:10},kd:{min:0,max:5},integralLimit:{min:0.01,max:2},slewLimit:{min:0.1,max:4}};
const ok:AxisControl={axisId:'a/J1',loop:{kp:50,ki:5,kd:1,integralLimit:1,slewLimit:null},accelerationLimit:null};
const loop=(o:Partial<AxisControl['loop']>,c:Partial<AxisControl>={}):AxisControl=>({...ok,...c,loop:{...ok.loop,...o}});

test('a control inside the envelope passes; bounds are inclusive',()=>{
 expect(withinEnvelope(ok,env)).toEqual([]);
 expect(withinEnvelope(loop({kp:100,ki:10,kd:5,integralLimit:2,slewLimit:4}),env)).toEqual([]);
 expect(withinEnvelope(loop({kp:0,ki:0,kd:0,integralLimit:null}),env)).toEqual([]);
});
test('above the ceiling, below the floor, negative',()=>{
 for(const o of [{kp:100.5},{ki:10.1},{kd:5.1},{integralLimit:2.5},{slewLimit:5},{integralLimit:0.001},{slewLimit:0.05},{kp:-1},{kd:-0.001}])expect(withinEnvelope(loop(o),env),JSON.stringify(o)).toEqual(['GAIN_OUT_OF_ENVELOPE']);
 expect(withinEnvelope(loop({},{accelerationLimit:3}),{...env,accelerationLimit:{min:0.5,max:2}})).toEqual(['GAIN_OUT_OF_ENVELOPE']);
 expect(withinEnvelope(loop({kp:-1}),{...env,kp:{min:-5,max:100}})).toEqual(['GAIN_OUT_OF_ENVELOPE']);   // a negative gain never passes
});
test('NaN and infinity are caught, never compared',()=>{
 for(const v of [NaN,Infinity,-Infinity])for(const k of ['kp','ki','kd'] as const)expect(withinEnvelope(loop({[k]:v}),env),`${k} ${v}`).toEqual(['NON_FINITE_NUMBER']);
 expect(withinEnvelope(loop({slewLimit:NaN}),env)).toEqual(['NON_FINITE_NUMBER']);
 expect(withinEnvelope(loop({kp:NaN,ki:11}),env)).toEqual(['GAIN_OUT_OF_ENVELOPE','NON_FINITE_NUMBER']);
});
test('a field the axis envelope does not list is not accepted: null (0 for kd) only',()=>{
 const {kd:_k,slewLimit:_s,...csvEnv}=env;void _k;void _s;
 expect(withinEnvelope(loop({kd:0,slewLimit:null}),csvEnv)).toEqual([]);
 expect(withinEnvelope(loop({kd:0.1}),csvEnv)).toEqual(['GAIN_OUT_OF_ENVELOPE']);
 expect(withinEnvelope(loop({slewLimit:1}),csvEnv)).toEqual(['GAIN_OUT_OF_ENVELOPE']);
 expect(withinEnvelope(loop({},{accelerationLimit:1}),csvEnv)).toEqual(['GAIN_OUT_OF_ENVELOPE']);
});
test('an envelope for another axis is missing',()=>{expect(withinEnvelope({...ok,axisId:'a/J2'},env)).toEqual(['ENVELOPE_AXIS_MISSING']);});
