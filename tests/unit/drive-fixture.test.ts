import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,test} from 'vitest';
// @ts-expect-error fixture generator is an executable ESM script
import {generateDriveFixture} from '../../scripts/generate-drive-fixture.mjs';
import {driveDocumentDigest,validateControlProfile,validateDriveModel} from '../../packages/lab-runtime/src/v2/control/drive-io';
import type {ControlProfileV1,DriveModelV1,TuningEnvelopeV1} from '../../packages/lab-runtime/src/v2/control/drive-io';

const FX='robotics/simulation-mujoco/fixtures/';
const json=async<T,>(path:string)=>JSON.parse(await readFile(FX+path,'utf8')) as T;
test('generation is byte deterministic and the committed fixture is what the generator writes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'drive-fixture-'));
 try{
  await generateDriveFixture(join(dir,'a'));await generateDriveFixture(join(dir,'b'));
  const names=await readdir(join(dir,'a'));
  expect(names).toEqual(expect.arrayContaining(['manifest.json','README.md','serve-control-v1.json','xarm6-control-v1.json','tuning-envelope-v1.json','control-oracle-v1.json']));
  expect(names.filter(n=>n.includes('-drive-'))).toHaveLength(9);
  for(const n of names){const a=await readFile(join(dir,'a',n));expect(a.equals(await readFile(join(dir,'b',n))),n).toBe(true);expect(a.equals(await readFile(FX+'drive-v1/'+n)),n).toBe(true);}
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('the manifest hashes the bytes of every file it lists',async()=>{
 const m=await json<{files:{path:string;sha256:string;bytes:number}[]}>('drive-v1/manifest.json');
 for(const f of m.files){const b=await readFile(FX+'drive-v1/'+f.path);expect(createHash('sha256').update(b).digest('hex'),f.path).toBe(f.sha256);expect(b.length).toBe(f.bytes);}
});
test('every document is sealed by its own digest and says assumed / not_calibrated',async()=>{
 const names=(await readdir(FX+'drive-v1')).filter(n=>n.endsWith('.json')&&n!=='manifest.json');
 expect(names).toHaveLength(13);
 for(const n of names){
  const d=await json<{digest:string;calibration:string;sources?:Record<string,{kind:string}>;source?:{kind:string}}>('drive-v1/'+n);
  expect(driveDocumentDigest(d),n).toBe(d.digest);expect(d.calibration).toBe('not_calibrated');
  for(const s of [...Object.values(d.sources??{}),...(d.source?[d.source]:[])])expect(s.kind,n).toBe('assumed');
 }
});
test('the ideal drive carries no device effect and the profiles carry the R2b gains',async()=>{
 const ideal=await json<DriveModelV1>('drive-v1/serve-drive-ideal-v1.json'),armIdeal=await json<DriveModelV1>('drive-v1/xarm6-drive-ideal-v1.json');
 for(const a of [...ideal.axes,...armIdeal.axes])expect(a,a.axisId).toMatchObject({encoder:{countsPerRev:null},commandDelaySubsteps:0,feedbackDelaySubsteps:0,watchdogTicks:null,enableDelaySubsteps:0,followingError:null});
 const physics=await json<{velocityGainNmsPerRad:number;brakeTorqueNm:number}>('serve-payload-v1/drive-contact-profile.json');
 const serve=await json<ControlProfileV1>('drive-v1/serve-control-v1.json');
 for(const a of serve.axes)expect(a.loop).toEqual({kp:physics.velocityGainNmsPerRad,ki:0,kd:0,integralLimit:null,slewLimit:null});
 const armPhysics=await json<{actuators:{joint:string;kp:number;kv:number}[]}>('xarm6-g2-v1/physics.json'),arm=await json<ControlProfileV1>('drive-v1/xarm6-control-v1.json');
 for(const g of armPhysics.actuators)expect(arm.axes.find(a=>a.axisId===`xarm-1/${g.joint}`)!.loop).toEqual({kp:g.kp,ki:0,kd:g.kv,integralLimit:null,slewLimit:null});
 for(const a of [...serve.axes,...arm.axes])expect(a.accelerationLimit).toBeNull();
});
test('the experiments differ from nominal only where the spec says',async()=>{
 const nominal=await json<DriveModelV1>('drive-v1/serve-drive-nominal-v1.json');
 const diff=async(n:string)=>{const m=await json<DriveModelV1>(`drive-v1/serve-drive-${n}-v1.json`);return m.axes.map((a,i)=>Object.keys(a).filter(k=>JSON.stringify((a as never)[k])!==JSON.stringify((nominal.axes[i] as never)[k])).sort());};
 expect((await diff('torque-limited'))[0]).toEqual(['torque']);
 expect((await diff('latency'))[0]).toEqual(['commandDelaySubsteps']);
 expect((await diff('coarse-encoder'))[0]).toEqual(['encoder']);
 const lat=await json<DriveModelV1>('drive-v1/serve-drive-latency-v1.json');expect(lat.axes[0]!.commandDelaySubsteps).toBe(50);
 const tl=await json<DriveModelV1>('drive-v1/serve-drive-torque-limited-v1.json');expect(tl.axes[0]!.torque).toEqual({kind:'envelope_ref',scale:0.1});
 expect(nominal.axes[0]).toMatchObject({watchdogTicks:5,commandDelaySubsteps:1,feedbackDelaySubsteps:1,enableDelaySubsteps:25,encoder:{countsPerRev:4096}});
});
test('arm brake torque holds the gravity torque of the V01 spike with margin and stays inside the joint effort',async()=>{
 const m=await json<DriveModelV1>('drive-v1/xarm6-drive-nominal-v1.json');
 const gravity=[0,1.0376634833222989,15.93472168220259,0.1693687703501081,1.7380175163819618,0.021117444163507526];
 m.axes.slice(0,6).forEach((a,i)=>{expect(a.onDisable).toBe('brake');expect(a.brakeTorqueNm!).toBeGreaterThanOrEqual(3*gravity[i]!);expect(a.brakeTorqueNm!).toBeLessThanOrEqual((a.torque as {limitNm:number}).limitNm);});
 expect(m.axes[6]).toMatchObject({axisId:'xarm-1/gripper',onDisable:'brake'});
});
test('every fixture profile passes the validators it is meant for',async()=>{
 const env=await json<TuningEnvelopeV1>('drive-v1/tuning-envelope-v1.json');
 for(const n of ['ideal','nominal','torque-limited','latency','coarse-encoder']){const m=await json<DriveModelV1>(`drive-v1/serve-drive-${n}-v1.json`);expect(validateDriveModel(m).ok).toBe(true);expect(validateControlProfile(await json('drive-v1/serve-control-v1.json'),m,env).ok,n).toBe(true);}
});
