// O1/D3: one admission rule set per drive mode. The vectors are shared with the worker's pytest (test_drive_model.py), which feeds them through actuator_spec.
import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import {sealDriveDocument,validateControlProfile} from '../../packages/lab-runtime/src/v2/control/drive-io';
import type {ControlProfileV1,DriveModelV1,TuningEnvelopeV1} from '../../packages/lab-runtime/src/v2/control/drive-io';

const FX='robotics/simulation-mujoco/';
const read=<T,>(path:string):T=>JSON.parse(readFileSync(FX+path,'utf8')) as T;
const cases=read<{cases:{id:string;mode:'csp'|'csv';loop:ControlProfileV1['axes'][number]['loop'];accelerationLimit:number|null;reason?:string;admitted:boolean}[]}>('tests/data/control-profile-admission-v1.json').cases;
const arm=read<DriveModelV1>('fixtures/drive-v1/xarm6-drive-nominal-v1.json'),serve=read<DriveModelV1>('fixtures/drive-v1/serve-drive-nominal-v1.json'),armControl=read<ControlProfileV1>('fixtures/drive-v1/xarm6-control-v1.json');
const bound={min:0.001,max:1000};

test('the admission vectors reach the same verdict here as in actuator_spec',()=>{
 expect(cases.length).toBeGreaterThanOrEqual(20);
 for(const c of cases){
  const axis=(c.mode==='csp'?arm:serve).axes.find(a=>a.mode===c.mode)!,model=sealDriveDocument({...(c.mode==='csp'?arm:serve),axes:[axis]});
  const control=sealDriveDocument({...armControl,driveModelDigests:[model.digest],axes:[{axisId:axis.axisId,loop:c.loop,accelerationLimit:c.accelerationLimit}]});
  const envelope={axes:[{axisId:axis.axisId,kp:{min:0,max:1000},ki:{min:0,max:1000},kd:{min:0,max:1000},integralLimit:bound,slewLimit:bound,accelerationLimit:bound}]} as unknown as TuningEnvelopeV1;
  const r=validateControlProfile(control,model,envelope);
  expect(r.ok,`${c.id}: ${r.reasonCodes.join(',')}`).toBe(c.admitted);
  if(!c.admitted)expect(r.reasonCodes,c.id).toContain(c.reason);
 }
});
