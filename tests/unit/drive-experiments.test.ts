import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {expect,test} from 'vitest';
import {DRIVE_EXPERIMENTS,driveExperiment,mobileDriveBundle,worldDriveBundle} from '../../packages/lab-runtime/src/v2/control/drive-experiments';
import {validateControlProfile,validateDriveModel,type TuningEnvelopeV1} from '../../packages/lab-runtime/src/v2/control/drive-io';

const root=resolve('robotics/simulation-mujoco');
test('the registry is closed: five ids, an unknown id is refused before anything is built',()=>{
 expect(Object.keys(DRIVE_EXPERIMENTS)).toEqual(['drive-ideal-v1','drive-nominal-v1','drive-torque-limited-v1','drive-latency-v1','drive-coarse-encoder-v1']);
 for(const bad of ['drive-nominal-v2','__proto__','constructor','','../drive-v1/serve-drive-nominal-v1','toString'])expect(()=>driveExperiment(bad),bad).toThrow('DRIVE_EXPERIMENT_UNREGISTERED');
 expect(Object.isFrozen(DRIVE_EXPERIMENTS)).toBe(true);
});
test('every id names fixture files that exist, validate, and are declared for each other',async()=>{
 const env=JSON.parse(await readFile(join(root,'fixtures/drive-v1/tuning-envelope-v1.json'),'utf8')) as TuningEnvelopeV1;
 for(const id of Object.keys(DRIVE_EXPERIMENTS)){
  const b=await mobileDriveBundle(root,id);
  expect(validateDriveModel(b.model).ok,id).toBe(true);expect(validateControlProfile(b.control,b.model,env).ok,id).toBe(true);
  for(const f of b.files)expect(createHash('sha256').update(f.bytes).digest('hex')).toBe(f.path===b.refs.driveModelRef.path?b.refs.driveModelRef.sha256:b.refs.controlProfileRef.sha256);
 }
});
test('the experiments differ from nominal only in the device: latency 100 ms, coarse encoder, wheel torque x 0.2, ideal has no effect',async()=>{
 const m=async(id:string)=>(await mobileDriveBundle(root,id)).model.axes[0]!;
 expect((await m('drive-latency-v1')).commandDelaySubsteps).toBe(50);
 expect((await m('drive-coarse-encoder-v1')).encoder.countsPerRev).toBe(256);
 expect((await m('drive-torque-limited-v1')).torque).toEqual({kind:'envelope_ref',scale:0.2});
 expect(await m('drive-ideal-v1')).toMatchObject({commandDelaySubsteps:0,watchdogTicks:null,encoder:{countsPerRev:null}});
 const arm=async(id:string)=>(await worldDriveBundle(root,id,'arm-1')).model.axes[1]!;
 expect((await arm('drive-latency-v1')).commandDelaySubsteps).toBe(50);expect((await arm('drive-coarse-encoder-v1')).encoder.countsPerRev).toBe(1024);
});
test('the world bundle is one sealed model and profile for nine axes, the arm renamed to the scene arm id',async()=>{
 const b=await worldDriveBundle(root,'drive-nominal-v1','arm-1'),env=JSON.parse(await readFile(join(root,'fixtures/drive-v1/tuning-envelope-v1.json'),'utf8')) as TuningEnvelopeV1;
 expect(b.model.axes.map(a=>a.axisId)).toEqual(['arm-1/J1','arm-1/J2','arm-1/J3','arm-1/J4','arm-1/J5','arm-1/J6','arm-1/gripper','amr-1/wheel-left','amr-1/wheel-right']);
 expect(validateDriveModel(b.model)).toEqual({ok:true,reasonCodes:[]});
 // the envelope names the xarm-1 axes: the profile of a world is validated against the same bounds once they are renamed
 const renamed={...env,axes:env.axes.map(a=>({...a,axisId:a.axisId.replace('xarm-1/','arm-1/')}))};
 expect(validateControlProfile(b.control,b.model,renamed)).toEqual({ok:true,reasonCodes:[]});
 const again=await worldDriveBundle(root,'drive-nominal-v1','arm-1');
 expect(again.files.map(f=>Buffer.from(f.bytes).toString())).toEqual(b.files.map(f=>Buffer.from(f.bytes).toString()));  // byte deterministic
});
test('a scratch directory holds nothing of the experiments (they are read from the fixture, never written)',async()=>{
 const d=await mkdtemp(join(tmpdir(),'drive-exp-'));try{await expect(mobileDriveBundle(d,'drive-nominal-v1')).rejects.toThrow();}finally{await rm(d,{recursive:true,force:true});}
});

import {validateRunRequestV2} from '../../packages/lab-runtime/src/v2/contracts';
import {validateEngineeringProject} from '../../packages/lab-runtime/src/engineering/contracts';
import {navigationFixture} from '../support/navigation2d';
const runRequest=(over:Record<string,unknown>)=>({driveExperimentId:'drive-nominal-v1',backendSetId:'engineering-mujoco-cell-v1',mode:'simulation',access:'simulated',scenarioId:'MJ-CELL-BV01',scenarioRevision:1,seed:7,
 engineeringRef:{bundleDigest:'a'.repeat(64),projectDigest:'b'.repeat(64)},runtimeIdentity:{sourceCommit:'test',schemaHash:'a'.repeat(64)},...over});
test('a drive experiment is selectable on the shared-world cell only: not on the arm-only MJ-BV01, a mock, another set or an unregistered id',()=>{
 const refused=(r:object)=>{const v=validateRunRequestV2(r as never);return v.ok?null:v.issues.map(i=>i.code+':'+i.path);};
 expect(refused(runRequest({}))).toBeNull();
 expect(refused(runRequest({scenarioId:'MJ-BV01',backendSetId:'engineering-mujoco-arm-v1'}))).toEqual(['DRIVE_EXPERIMENT_SCOPE_INVALID:/driveExperimentId']);
 expect(refused(runRequest({mode:'mock',backendSetId:'mock-default'}))).toEqual(['DRIVE_EXPERIMENT_SCOPE_INVALID:/driveExperimentId']);
 expect(refused(runRequest({backendSetId:'engineering-mujoco-3d-v1',scenarioId:'MJ-FD01'}))).toEqual(['DRIVE_EXPERIMENT_SCOPE_INVALID:/driveExperimentId']);  // the AMR run takes its experiment from the engineering project
 expect(refused(runRequest({driveExperimentId:'drive-nominal-v9'}))).not.toBeNull();
 expect(refused(runRequest({driveExperimentId:'__proto__'}))).not.toBeNull();
 for(const extra of [{gains:{kp:9}},{driveModel:'x.json'},{velocityLimitRadS:1}])expect(refused(runRequest(extra))).not.toBeNull();   // no gain, path or limit on a request
});

test('an engineering project names a drive experiment only with the mobile MuJoCo profile, and only a registered one',()=>{
 const base=navigationFixture('serve-3d').fixture.project;
 const problems=(p:object)=>{const v=validateEngineeringProject(p);return v.ok?[]:v.problems.map(x=>x.code);};
 expect(problems({...base,requestedProfile:'engineering-mujoco-3d-v1',driveExperimentId:'drive-nominal-v1'})).toEqual([]);
 expect(problems({...base,requestedProfile:'engineering-webots-3d-v1',driveExperimentId:'drive-nominal-v1'})).toContain('DRIVE_EXPERIMENT_PROFILE_REQUIRED');
 expect(problems({...base,requestedProfile:'engineering-mujoco-3d-v1',driveExperimentId:'drive-nominal-v9'}).length).toBeGreaterThan(0);
});
