import {createHash} from 'node:crypto';
import {MOBILE_STOP_POLICY,MOBILE_CONTROLLER_POLICY} from '../../packages/lab-runtime/src/v2/simulation3d/mujoco-mobile';
import {sealDocument} from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import {afterEach,expect,test,vi} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {mujocoFromOptions,MUJOCO_SLOT} from '../../packages/lab-runtime/src/v2/simulation3d/mujoco';
import {holdSlot,releaseSlot,activeRunCount} from '../../packages/lab-runtime/src/v2/navigation2d/runner';
import {portableSimulationFromOptions} from '../../packages/lab-runtime/src/v2/navigation2d/readiness';
import * as client from '../../packages/lab-runtime/src/v2/simulation3d/worker-client';
const root=resolve('robotics/simulation-mujoco'),fixture=join(root,'fixtures/serve-payload-v1'),dirs:string[]=[];
const temp=async()=>{const d=await mkdtemp(join(tmpdir(),'mj-mobile-ready-'));dirs.push(d);return d;};
afterEach(async()=>{vi.restoreAllMocks();releaseSlot(MUJOCO_SLOT,'held-arm');releaseSlot('mujoco_3d','held-mobile');for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
async function setup(bundle=true,corrupt?:string){
 const directory=await temp(),scene=JSON.parse(await readFile(join(fixture,'navigation-scene.json'),'utf8'));
 const project=JSON.parse(await readFile(join(fixture,'serve-3d-project.json'),'utf8')).runtimeProject;
 const policy=Buffer.from(JSON.stringify(MOBILE_STOP_POLICY)),sha256=createHash('sha256').update(policy).digest('hex');
 scene.engine.stopPolicyRef={id:MOBILE_STOP_POLICY.id,revision:1,path:'mobile-stop-policy.json',sha256};scene.files.push({path:'mobile-stop-policy.json',sha256,bytes:policy.length});const controller=Buffer.from(JSON.stringify(MOBILE_CONTROLLER_POLICY)),controllerSha=createHash('sha256').update(controller).digest('hex');scene.engine.controllerPolicyRef={id:MOBILE_CONTROLLER_POLICY.id,revision:1,path:'mobile-controller-policy.json',sha256:controllerSha};scene.files.push({path:'mobile-controller-policy.json',sha256:controllerSha,bytes:controller.length});const sceneBytes=Buffer.from(JSON.stringify(sealDocument(scene,'sceneDigest')));
 const p=await mujocoFromOptions({enabled:true,python:resolve('.venv-mujoco/bin/python'),workerRoot:root,lockPath:join(root,'requirements.lock'),directory,...bundle?{bundleFile:async(_d:string,path:string)=>path===corrupt?Buffer.from('{}'):path==='navigation-scene.json'?sceneBytes:path==='mobile-stop-policy.json'?policy:path==='mobile-controller-policy.json'?controller:readFile(join(fixture,path))}:{}});
 const ctx={scenarioId:'MJ-FD01',backendSetId:'engineering-mujoco-3d-v1',project,engineering:{bundleDigest:'b'.repeat(64),projectDigest:scene.inputs.project.digest}};
 return {p,ctx,directory};
}
test('mobile requires engineering while legacy arm still enables with old options',async()=>{
 const {p}=await setup(false);expect(p.arm.capability.installed).toBe(true);expect(p.mobile.capability.installed).toBe(false);expect(p.mobile.capability.reason).toContain('ENGINEERING_REF_REQUIRED');
});
test('real describe and mobile create readiness; shared capacity blocks arm against mobile and mobile against arm',async()=>{
 const {p,ctx,directory}=await setup();expect(p.mobile.capability.installed).toBe(true);
 expect((await p.mobile.readinessChecks!(ctx,new AbortController().signal)).flatMap(r=>r.reasonCodes)).toEqual([]);
 holdSlot(MUJOCO_SLOT,'held-arm');expect((await p.mobile.readinessChecks!(ctx,new AbortController().signal)).flatMap(r=>r.reasonCodes)).toContain('MUJOCO_CAPACITY');releaseSlot(MUJOCO_SLOT,'held-arm');
 holdSlot('mujoco_3d','held-mobile');expect(activeRunCount(MUJOCO_SLOT)).toBe(1);
 const armProject=JSON.parse(await readFile(join(root,'fixtures/xarm6-g2-v1/coffee-cell-project.json'),'utf8'));
 expect((await p.arm.readinessChecks!({scenarioId:'MJ-BV01',backendSetId:'engineering-mujoco-arm-v1',project:armProject},new AbortController().signal)).flatMap(r=>r.reasonCodes)).toContain('MUJOCO_CAPACITY');
 const sim=await portableSimulationFromOptions({enabled:false,python:'python3',workerRoot:root,lockPath:join(root,'requirements.lock'),directory,mujoco:p});expect(sim.enabledBackends).toEqual(expect.arrayContaining(['mujoco_arm','mujoco_3d']));expect(sim.plants?.mujoco_3d).toBeDefined();
},30_000);
test('mobile and arm create probes share one gate, with no second worker while mobile create is blocked',async()=>{
 const {p,ctx}=await setup();const original=client.spawnMujocoWorker;
 let unblock!:()=>void,entered!:()=>void;const reached=new Promise<void>(r=>entered=r),block=new Promise<void>(r=>unblock=r);let spawns=0;
 vi.spyOn(client,'spawnMujocoWorker').mockImplementation(async o=>{spawns++;const w=await original(o),request=w.request.bind(w);return {...w,request:async r=>{if(r.op==='create'){entered();await block;}return request(r);}};});
 const first=p.mobile.readinessChecks!(ctx,new AbortController().signal);await reached;
 try{const project=JSON.parse(await readFile(join(root,'fixtures/xarm6-g2-v1/coffee-cell-project.json'),'utf8'));const rows=await p.arm.readinessChecks!({scenarioId:'MJ-BV01',backendSetId:'engineering-mujoco-arm-v1',project},new AbortController().signal);expect(rows.flatMap(r=>r.reasonCodes)).toContain('MUJOCO_CAPACITY');expect(spawns).toBe(1);}finally{unblock();await first;}
},30_000);

test('changed admitted profile bytes block readiness before spawning a world',async()=>{
 const {p,ctx}=await setup(true,'drive-contact-profile.json'),spawn=vi.spyOn(client,'spawnMujocoWorker');
 const rows=await p.mobile.readinessChecks!(ctx,new AbortController().signal);expect(rows.flatMap(r=>r.reasonCodes)).toContain('ENGINEERING_CLOSURE_MISSING:drive-contact-profile.json');expect(spawn).not.toHaveBeenCalled();
});
