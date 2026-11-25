import {afterEach,expect,test} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createMujocoCompiler} from '../../packages/lab-runtime/src/engineering/mujoco-compiler';
import {createEngineeringService} from '../../packages/lab-runtime/src/engineering/gateway';
import {validateEngineeringProject} from '../../packages/lab-runtime/src/engineering/contracts';
import {TRAY_EXPERIMENTS,TRAY_ACCELERATION} from '../../packages/lab-runtime/src/v2/simulation3d/tray-experiments';
import {navigationFixture} from '../support/navigation2d';
import {testCompiler,writeFixtureCatalog} from '../support/engineering';
const dirs:string[]=[];
const temp=async()=>{const p=await mkdtemp(join(tmpdir(),'tray-test-'));dirs.push(p);return p;};
afterEach(async()=>{for(const p of dirs.splice(0))await rm(p,{recursive:true,force:true});});
async function compile(id:string,extra:object={}){
 const f=navigationFixture('serve-3d').fixture;f.project={...f.project,requestedProfile:'engineering-mujoco-3d-v1',mujocoExperimentId:id,...extra} as typeof f.project;
 const catalogRoot=await temp();await writeFixtureCatalog(catalogRoot,f);
 const service=createEngineeringService({directory:await temp(),catalogRoot,compiler:testCompiler,compilers:{'engineering-mujoco-3d-v1':createMujocoCompiler({workerRoot:resolve('robotics/simulation-mujoco')})}});
 const receipt=await service.compileEngineeringProject(f.project,'owner');
 const read=async(p:string)=>JSON.parse(Buffer.from(await service.bundleFile(receipt.bundleDigest!,p)).toString());
 return {receipt,read,scene:receipt.state==='compiled'?await read('navigation-scene.json'):null};
}

test('the schema admits the five tray ids and nothing near them',()=>{
 const base=navigationFixture('serve-3d').fixture.project;
 for(const id of Object.keys(TRAY_EXPERIMENTS))expect(validateEngineeringProject({...base,requestedProfile:'engineering-mujoco-3d-v1',mujocoExperimentId:id}).ok,id).toBe(true);
 expect(validateEngineeringProject({...base,requestedProfile:'engineering-mujoco-3d-v1',mujocoExperimentId:'tray-nominal-v2'}).ok).toBe(false);
});

for(const [id,e] of Object.entries(TRAY_EXPERIMENTS)){
 test(`${id} compiles to its registered load, contact profile, policy and drive documents`,async()=>{
  const {receipt,scene,read}=await compile(id);
  expect(receipt.state,JSON.stringify(receipt.problems)).toBe('compiled');
  expect(scene.engine.loadProfileRef.id).toBe(e.load);expect(scene.engine.physicsProfileRef.path).toBe(`${e.physics}.json`);
  const load=await read(`${e.load}.json`);expect(load.props.map((p:{propId:string})=>p.propId)).toEqual(['cup-1','cup-2','cup-3']);
  const a=TRAY_ACCELERATION[e.accelerationPolicy];
  expect(scene.policy.parameters.maxAccelerationMps2).toBe(a.policyMps2);
  const driveModel=scene.engine.driveModelRef.path as string;expect(driveModel).toContain(e.driveExperimentId==='drive-torque-limited-v1'?'torque-limited':e.driveExperimentId.startsWith('drive-hw-c-')?e.driveExperimentId.replace(/^drive-/,'').replace(/-v1$/,''):'nominal');
  const control=await read(scene.engine.controlProfileRef.path);
  expect(control.controllers.find((c:{controllerId:string})=>c.controllerId==='diff-drive-base-v1').params.maxAccelerationMps2).toBe(a.baseLimitMps2);
  expect(a.baseLimitMps2).toBeGreaterThanOrEqual(scene.policy.parameters.maxAccelerationMps2);
  const exp=await read('tray-experiment.json');expect(exp).toMatchObject({documentType:'tray-experiment',id,actor:e.actor,comparedWith:e.comparedWith});
  expect((await read('tray-policy-v1.json')).id).toBe('tray-policy-v1');
  for(const path of ['tray-experiment.json','tray-policy-v1.json'])expect(scene.files.some((f:{path:string})=>f.path===path),path).toBe(true);
 });
}

test('the nominal bundle keeps the drive control profile of drive-nominal-v1 but for the plant seal; only the high variant changes the base limit',async()=>{
 const nominal=await compile('tray-nominal-v1'),high=await compile('tray-accel-high-v1');
 const cn=await nominal.read(nominal.scene.engine.controlProfileRef.path),ch=await high.read(high.scene.engine.controlProfileRef.path);
 expect(cn.controllers.find((c:{controllerId:string})=>c.controllerId==='diff-drive-base-v1').params.maxAccelerationMps2).toBe(1);
 expect(ch.controllers.find((c:{controllerId:string})=>c.controllerId==='diff-drive-base-v1').params.maxAccelerationMps2).toBe(3);
 expect(ch.digest).not.toBe(cn.digest);
});

test('a project that names a drive experiment different from the tray variant is refused, an equal one is accepted',async()=>{
 const same=await compile('tray-torque-limited-v1',{driveExperimentId:'drive-torque-limited-v1'});expect(same.receipt.state).toBe('compiled');
 const clash=await compile('tray-torque-limited-v1',{driveExperimentId:'drive-nominal-v1'});expect(clash.receipt.state).not.toBe('compiled');
 expect(JSON.stringify(clash.receipt.problems)).toContain('MUJOCO_EXPERIMENT_DRIVE_CONFLICT');
});

test('a variant differs from the one it is compared with only in the registered inputs',async()=>{
 const a=await compile('tray-nominal-v1'),d=await compile('tray-person-crossing-v1');
 // the load document is bound to the physical model, whose bytes name the project, so the bytes of a derived document differ; what the variant selects does not
 expect({...d.scene.engine.loadProfileRef,sha256:0}).toEqual({...a.scene.engine.loadProfileRef,sha256:0});expect(d.scene.engine.driveModelRef).toEqual(a.scene.engine.driveModelRef);expect(d.scene.policy).toEqual(a.scene.policy);expect(d.scene.engine.physicsProfileRef).toEqual(a.scene.engine.physicsProfileRef);
 expect(d.scene.sceneDigest).not.toBe(a.scene.sceneDigest);
});
