import {expect,test} from 'vitest';
import {mkdtemp,readFile,rm,readdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {mujocoWorldPorts} from '../../packages/lab-runtime/src/v2/simulation3d/mujoco-world-ports';
import {stepWorldOnce} from '../../packages/lab-runtime/src/v2/simulation3d/world-step';
import {prepareWorldAdmission,readWorldEvidence} from '../../packages/lab-runtime/src/v2/simulation3d/world-evidence';
import {readWorldFixture} from '../../packages/lab-runtime/src/v2/simulation3d/world-scene';
import {MockArmPlant} from '../../packages/cell-adapters/src/mock-arm';
import {MockCoffeePlant} from '../../packages/cell-adapters/src/mock-coffee';
import {holdSlot,releaseSlot,activeRunCount} from '../../packages/lab-runtime/src/v2/navigation2d/runner';
import {lockDigestOf} from '../../packages/lab-runtime/src/engineering/linkforge';
import type {WorldFactoryInput} from '../../packages/lab-runtime/src/v2/simulation3d/world-ports';
const root=resolve('robotics/simulation-mujoco');
export async function worldInput(directory:string):Promise<WorldFactoryInput>{return {directory,runId:'b05-source-rig',manifest:{project:JSON.parse(await readFile(join(root,'fixtures/coffee-delivery-world-v1/project.json'),'utf8')),scenarioId:'B05-RIG',scenarioRevision:1,seed:7,mode:'simulation',access:'simulated',backendSetId:'internal-world-rig',sourceCommit:'development'},state:{stationId:'coffee-pickup',cellId:'cell-1',armId:'arm-1',registered:false,sessions:{},workload:[{cupId:'cup-1'},{cupId:'cup-2'}],plant:MockCoffeePlant.initial('cell-1'),arm:MockArmPlant.initial('arm-1'),trays:{}} as WorldFactoryInput['state'],context:{runId:'b05-source-rig',nowMs:()=>Date.parse('2026-11-01T00:00:00Z'),tick:()=>0,receiver:()=>({robotId:'amr-1',slot:1})} as WorldFactoryInput['context'],newBootId:()=> 'source-boot'};}
export const runtime=async()=>({python:resolve('.venv-mujoco/bin/python'),workerRoot:root,schemaDir:resolve('packages/contracts/schemas'),lockDigest:await lockDigestOf(join(root,'requirements.lock')),engineVersion:'3.17.0'});
test('real world factory owns one shared slot, commits actual arm/AMR/empty-prop observations and bounded evidence',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'b05-world-factory-')),input=await worldInput(directory),factory=mujocoWorldPorts(await runtime());
 holdSlot('mujoco_arm','legacy-arm');try{await expect(factory(input)).rejects.toThrow('MUJOCO_CAPACITY');}finally{releaseSlot('mujoco_arm','legacy-arm');}
 const b=await factory(input);try{
  expect(activeRunCount('mujoco_3d')).toBe(1);await expect(factory({...input,runId:'second'})).rejects.toThrow('MUJOCO_CAPACITY');
  expect(b.snapshot().props).toEqual([]);await b.evidence.append(b.snapshot());
  for(let tick=0;tick<12;tick++){const before=b.snapshot();const s=await stepWorldOnce(b.world,tick,s=>b.evidence.append(s));expect(s.tick).toBe(tick+1);expect(s.bootId).toBe(before.bootId);expect(s.arms).toHaveLength(1);expect(s.physics!.loads).toEqual([]);await b.coffee.advance();}
  b.coffee.coffeePlant!.placeCup('cup-1','paper');
  const before=structuredClone(input.state.arm),command=b.world.prepareTick(13);expect(input.state.arm).toEqual(before);expect(command.worldInteractions).toHaveLength(1);const born=await b.world.step(command);await expect(b.world.commit(born)).rejects.toThrow('WORLD_COMMIT_INVALID');await b.evidence.append(born);await b.world.commit(born);expect(b.snapshot().props?.[0]?.propId).toBe('cup-1');
  input.state.trays['amr-1']='cup-1';await stepWorldOnce(b.world,13,s=>b.evidence.append(s));expect(b.snapshot().props).toHaveLength(1);
  await b.coffee.custodyResolved!('cup-1','table:table-1');await stepWorldOnce(b.world,14,s=>b.evidence.append(s));expect(b.snapshot().props).toEqual([]);
  await b.evidence.finish();const f=await readWorldFixture(root),read=await readWorldEvidence(join(directory,'world-evidence'),prepareWorldAdmission(f.scene,f.files));expect(read.issues).toEqual([]);expect(read.records).toHaveLength(16);
  const sizes=await Promise.all((await readdir(join(directory,'world-evidence'))).map(async p=>(await stat(join(directory,'world-evidence',p))).size));expect(sizes.reduce((a,b)=>a+b,0)).toBeLessThan(100*1024*1024);
 }finally{await b.coffee.close();await b.world.close();expect(activeRunCount('mujoco_3d')).toBe(0);await rm(directory,{recursive:true,force:true});}
},120000);

test('world slot remains owned until real close completes, including concurrent close calls',async()=>{
 const client=await import('../../packages/lab-runtime/src/v2/simulation3d/worker-client'),{vi}=await import('vitest');
 const original=client.spawnMujocoWorker;let gateClose=false;let entered!:()=>void,release!:()=>void;const atClose=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
 const spy=vi.spyOn(client,'spawnMujocoWorker').mockImplementation(async o=>{const w=await original(o);return {...w,close:async reason=>{if(gateClose){entered();await gate;}await w.close(reason);}};});
 const directory=await mkdtemp(join(tmpdir(),'b05-world-close-'));let b:Awaited<ReturnType<ReturnType<typeof mujocoWorldPorts>>>|undefined;
 try{const input=await worldInput(directory),factory=mujocoWorldPorts(await runtime());b=await factory(input);gateClose=true;await expect(factory(input)).rejects.toThrow('MUJOCO_CAPACITY');const closing=b.world.close();await atClose;const again=b.world.close();await expect(factory({...input,runId:'new'})).rejects.toThrow('MUJOCO_CAPACITY');release();await Promise.all([closing,again]);expect(activeRunCount('mujoco_arm')).toBe(0);
 }finally{release?.();await b?.world.close();spy.mockRestore();await rm(directory,{recursive:true,force:true});}
},120000);

const OFFSETS:[number,number][]=[[0,0],[.005,.005],[.005,-.005],[-.005,.005],[-.005,-.005],[.005,0],[-.005,0],[0,.005],[0,-.005],[.0025,-.0035]];
test.each(OFFSETS.map((offset,i)=>({offset,trial:i+1})))('production handoff trial $trial through one real worker and complete recorder',async({offset,trial})=>{
 const {mkdir,writeFile}=await import('node:fs/promises'),{dirname}=await import('node:path'),{spawnMujocoWorker}=await import('../../packages/lab-runtime/src/v2/simulation3d/worker-client'),{openWorldRecorder}=await import('../../packages/lab-runtime/src/v2/simulation3d/world-evidence'),{runWorldRig}=await import('../support/world-rig');
 const directory=process.env.B05_WORLD_RIG_OUT?join(process.env.B05_WORLD_RIG_OUT,`trial-${trial}`):await mkdtemp(join(tmpdir(),'b05-worker-rig-'));await mkdir(directory,{recursive:true});const f=await readWorldFixture(root),bundle=join(directory,'bundle');await mkdir(bundle,{recursive:true});for(const [name,b] of f.files){await mkdir(dirname(join(bundle,name)),{recursive:true});await writeFile(join(bundle,name),b);}await writeFile(join(bundle,'lab-world-scene.json'),JSON.stringify(f.scene));
 const runId=`rig:worker:${trial}`,rt=await runtime(),w=await spawnMujocoWorker({...rt,runId,bundleRoot:bundle,runDirectory:join(directory,'worker'),sceneDigest:f.scene.sceneDigest});let tick=0,n=0;
 const ask=async(op:string,payload:unknown)=>{const r=await w.request({protocol:'mekoniq-sim3d/1',requestId:`rig-${++n}`,runId,expectedTick:tick,op,payload} as Parameters<typeof w.request>[0]);if(!r.ok)throw Error(JSON.stringify(r.error));return r.result as import('../../packages/lab-runtime/src/v2/navigation2d/contracts').Sim3DSnapshotV1;};
 try{const initial=await ask('create',{sceneRef:'lab-world-scene.json',seed:7});await ask('start',{});const admission=prepareWorldAdmission(f.scene,f.files),rec=await openWorldRecorder({directory:join(directory,'evidence'),admission,runId:initial.runId,bootId:initial.bootId});await rec.append(initial,null);let largest=Buffer.byteLength(JSON.stringify(initial)),sum=largest;
  const programs=JSON.parse(Buffer.from(f.files.get('programs.json')!).toString()).programs;
  const result=await runWorldRig(programs.waypoints,initial,async command=>{const s=await ask('step',command);try{await rec.append(s,command);}catch(e){await writeFile(join(directory,'rejected-ack.json'),JSON.stringify(s,null,2));throw e;}tick=s.tick;const bytes=Buffer.byteLength(JSON.stringify(s));largest=Math.max(largest,bytes);sum+=bytes;return s;},offset);await rec.finish();const read=await readWorldEvidence(join(directory,'evidence'),admission);const size=(await Promise.all((await readdir(join(directory,'evidence'))).map(async p=>(await stat(join(directory,'evidence',p))).size))).reduce((a,b)=>a+b,0);
  const native=await ask('getState',{});await writeFile(join(directory,'native-readback.json'),JSON.stringify(native.model,null,2));const policySha256=process.env.B05_WORLD_RIG_POLICY?(await import('node:crypto')).createHash('sha256').update(await readFile(process.env.B05_WORLD_RIG_POLICY)).digest('hex'):null;
  await writeFile(join(directory,'summary.json'),JSON.stringify({...result,policySha256,runId,bootId:initial.bootId,sceneDigest:f.scene.sceneDigest,admissionDigest:admission.digest,workerRequests:n,snapshotBytes:{largest,total:sum},recorderStoredBytes:size,readComplete:read.complete,readIssues:read.issues,records:read.records.length},null,2));
  expect(result.passed).toBe(true);expect(read.issues).toEqual([]);expect(size).toBeLessThan(100*1024*1024);expect(largest).toBeLessThan(256*1024);expect(read.records).toHaveLength(tick+1);
 }finally{await w.close('rig completed');if(!process.env.B05_WORLD_RIG_OUT)await rm(directory,{recursive:true,force:true});}
},850000);
