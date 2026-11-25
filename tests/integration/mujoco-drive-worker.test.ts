// V03: the real worker process (NDJSON, pinned Python) with a drive model and a control profile in the bundle.
import {afterEach,expect,test} from 'vitest';
import {createHash} from 'node:crypto';
import {copyFile,mkdtemp,readdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {lockDigestOf} from '../../packages/lab-runtime/src/engineering/linkforge';
import {sealDocument,validateSim3DResponse} from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import {mujocoMobilePlant} from '../../packages/lab-runtime/src/v2/simulation3d/mujoco-mobile';

const dirs:string[]=[],root=resolve('robotics/simulation-mujoco'),python=resolve('.venv-mujoco/bin/python'),schemaDir=resolve('packages/contracts/schemas');
const temp=async()=>{const d=await mkdtemp(join(tmpdir(),'mj-drive-'));dirs.push(d);return d;};
afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
async function driveBundle(variant:string){
 const dir=await temp(),from=join(root,'fixtures/serve-payload-v1');
 for(const f of await readdir(from,{withFileTypes:true}))if(f.isFile())await copyFile(join(from,f.name),join(dir,f.name));
 const scene=JSON.parse(await readFile(join(dir,'navigation-scene.json'),'utf8')) as {engine:Record<string,unknown>;files:{path:string;sha256:string;bytes:number}[]};
 for(const [name,key] of [[`serve-drive-${variant}-v1.json`,'driveModelRef'],['serve-control-v1.json','controlProfileRef']] as const){
  const raw=await readFile(join(root,'fixtures/drive-v1',name)),doc=JSON.parse(raw.toString()) as {id:string};
  await writeFile(join(dir,name),raw);scene.engine[key]={id:doc.id,revision:1,path:name,sha256:sha(raw)};scene.files.push({path:name,sha256:sha(raw),bytes:raw.length});
 }
 scene.files.sort((a,b)=>a.path.localeCompare(b.path));
 const sealed=sealDocument(scene as never,'sceneDigest') as {sceneDigest:string};
 await writeFile(join(dir,'navigation-scene.json'),JSON.stringify(sealed));
 return {dir,digest:sealed.sceneDigest};
}
const wheels=(seq:number,target:number,over:object={})=>['left','right'].map(s=>({axisId:`amr-1/wheel-${s}`,seq,mode:'csv',target,enable:true,quickStop:false,faultReset:false,...over}));

test('the real worker runs a nominal drive: disabled at create, enabled after the sequence, refusals leave the tick alone, an ACK replay is byte-equal',async()=>{
 const {dir,digest}=await driveBundle('nominal');
 const runtime={python,workerRoot:root,schemaDir,lockDigest:await lockDigestOf(join(root,'requirements.lock')),engineVersion:'3.17.0'},plant=mujocoMobilePlant(runtime);
 const w=await plant.spawn({...runtime,runId:'drive-real',bundleRoot:dir,runDirectory:await temp(),sceneDigest:digest});
 let n=0;const ask=(op:string,payload:object,tick=0,id?:string)=>w.request({protocol:plant.protocol,requestId:id??`r-${++n}`,runId:'drive-real',expectedTick:tick,op,payload} as never);
 try{
  const d=await ask('describe',{});expect(d.ok).toBe(true);
  expect(['arm64','x86_64']).toContain((d as unknown as {result:{hostArch:string}}).result.hostArch);
  const c=await ask('create',{sceneRef:'navigation-scene.json',seed:7});expect(c.ok,JSON.stringify(c)).toBe(true);
  expect((c as unknown as {result:{drives:{state:string}[]}}).result.drives.map(x=>x.state)).toEqual(['disabled','disabled']);
  await ask('start',{});
  let last:unknown;
  for(let k=0;k<5;k++){last=await ask('step',{targetTick:k+1,velocities:[],actorUpdates:[],driveCommands:wheels(k+1,0.5)},k);expect((last as {ok:boolean}).ok).toBe(true);}
  expect(validateSim3DResponse(last).ok).toBe(true);
  const drives=(last as unknown as {result:{drives:{state:string;commandSeq:number;actualVelocityRadS:number}[]}}).result.drives;
  expect(drives.map(x=>x.state)).toEqual(['enabled','enabled']);expect(drives[0]!.commandSeq).toBe(5);expect(drives[0]!.actualVelocityRadS).toBeGreaterThan(0.1);
  const bad=await ask('step',{targetTick:6,velocities:[],actorUpdates:[]},5);
  expect(bad).toMatchObject({ok:false,error:{code:'DRIVE_COMMAND_REQUIRED'}});expect(w.state).toBe('ready');
  const backwards=await ask('step',{targetTick:6,velocities:[],actorUpdates:[],driveCommands:wheels(2,0.5)},5);
  expect(backwards).toMatchObject({ok:false,error:{code:'DRIVE_COMMAND_SEQ_INVALID'}});
  const payload={targetTick:6,velocities:[],actorUpdates:[],driveCommands:wheels(6,0.5)};
  const s=await ask('step',payload,5,'step-six');expect(s.ok).toBe(true);expect(await ask('step',payload,5,'step-six')).toEqual(s);
  expect((s as unknown as {tick:number}).tick).toBe(6);
 }finally{await w.close('test complete');}
},60_000);
