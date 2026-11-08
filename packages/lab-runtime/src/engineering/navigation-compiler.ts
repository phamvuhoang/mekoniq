import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,unlink,writeFile} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {promisify} from 'node:util';
import {composePose} from '../v2/frames';
import {NAVIGATION_SCHEMA_HASH,defaultNavigationPolicy,sealDocument,validateNavigationDocument} from '../v2/navigation2d/contracts';
import type {ArtifactRef,NavigationModel2DV1,NavigationPolicyV1,NavigationSceneV1} from '../v2/navigation2d/contracts';
import {hashJson} from '../v2/hash';
import {EngineeringInputError,linkWorldPoses} from './assembly';
import type {EngineeringCompileInput,Problem} from './contracts';
import {framePose} from './inertia';
import type {CompilerPort} from './gateway';
import {projectNavigationModel,yawOf} from './navigation-model';
import {projectPhysicalModel} from './physical-model';

const run=promisify(execFile);

export const NAVIGATION_COMPILER_VERSION='navigation-compiler/1';
type P=[number,number];
const WALL_M=0.1; // boundary walls are 0.1 m thick inside the world rectangle, like the native compiler's
const rect=(x:number,y:number,w:number,h:number):P[]=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
const place=(footprint:P[],x:number,y:number,yaw:number):P[]=>footprint.map(([a,b])=>[x+a*Math.cos(yaw)-b*Math.sin(yaw),y+a*Math.sin(yaw)+b*Math.cos(yaw)]);
/** Separating-axis test for two convex polygons: true when they overlap by more than numerical noise. */
function overlaps(a:P[],b:P[]):boolean{
 for(const poly of [a,b])for(let i=0;i<poly.length;i++){
  const p=poly[i]!,q=poly[(i+1)%poly.length]!,nx=q[1]-p[1],ny=p[0]-q[0];
  const range=(s:P[])=>{const d=s.map(([x,y])=>x*nx+y*ny);return [Math.min(...d),Math.max(...d)];};
  const [a0,a1]=range(a),[b0,b1]=range(b),scale=Math.hypot(nx,ny);
  if(Math.min(a1,b1)-Math.max(a0,b0)<=1e-9*scale)return false;
 }
 return true;
}
const grow=(r:P[],m:number):P[]=>{const xs=r.map(p=>p[0]),ys=r.map(p=>p[1]),x0=Math.min(...xs)-m,x1=Math.max(...xs)+m,y0=Math.min(...ys)-m,y1=Math.max(...ys)+m;return rect(x0,y0,x1-x0,y1-y0);};

/** Immutable NavigationSceneV1 (without worker files yet) for every robot in `models`. Fails closed: targets and starts that collide or leave the world are refused, never moved. */
export function compileNavigationScene(input:EngineeringCompileInput,models:readonly NavigationModel2DV1[],policy:NavigationPolicyV1,schemaHash:string=NAVIGATION_SCHEMA_HASH):NavigationSceneV1{
 const problems:Problem[]=[],add=(code:string,path:string,detail:string)=>{problems.push({code,path,blocking:true,detail});};
 const w=input.project.runtimeProject.world,sorted=[...models].sort((a,b)=>a.robotId<b.robotId?-1:1);
 const inputs={project:{id:input.project.id,revision:input.project.revision,digest:input.projectDigest},assemblyDigest:input.resolved.assemblyDigest,world:{id:w.id,revision:w.revision,hash:hashJson(w)}};
 for(const m of sorted)if(hashJson(m.inputs)!==hashJson(inputs))add('INPUT_IDENTITY_MISMATCH',`/robots/${m.robotId}`,'the model was projected from different inputs than this compile input');
 if(problems.length)throw new EngineeringInputError(problems);

 const walls=[['boundary-west',rect(0,0,WALL_M,w.height)],['boundary-east',rect(w.width-WALL_M,0,WALL_M,w.height)],['boundary-south',rect(0,0,w.width,WALL_M)],['boundary-north',rect(0,w.height-WALL_M,w.width,WALL_M)]] as [string,P[]][];
 const obstacles=w.obstacles.map(o=>({id:o.id,verticesM:rect(o.x,o.y,o.width,o.height)})).sort((a,b)=>a.id<b.id?-1:1);
 const solids=[...walls.map(([,v])=>v),...obstacles.map(o=>o.verticesM)];
 const margin=policy.parameters.safetyMarginM,poses=linkWorldPoses(input.resolved);
 const admit=(m:NavigationModel2DV1,x:number,y:number,yaw:number,code:string,path:string,what:string)=>{
  const body=place(m.footprint.verticesM as P[],x,y,yaw);
  if(body.some(([a,b])=>a<0||b<0||a>w.width||b>w.height))add(code==='INITIAL_POSE_INVALID'?code:'TARGET_OUT_OF_WORLD',path,`${what} puts ${m.robotId}'s footprint outside the ${w.width} x ${w.height} m world`);
  else if(solids.some(s=>overlaps(body,grow(s,margin))))add(code,path,`${what} puts ${m.robotId}'s footprint (plus ${margin} m margin) in collision`);
 };

 const robots=sorted.map(m=>{
  const base=poses.get(m.baseFrameId),place0=input.resolved.placements.find(p=>m.baseFrameId.startsWith(p.instanceId+'/'));
  if(!base||!place0){add('INITIAL_POSE_INVALID',`/robots/${m.robotId}`,'the base link has no resolved placement');return null;}
  const drive=composePose(base,framePose(m.driveFrameInBase));
  const tilt=qrotateZ(drive.quaternionXyzw);
  if(tilt>1e-6)add('NON_PLANAR_DRIVE',`/robots/${m.robotId}`,'the drive frame is not upright in the map frame');
  const [x,y]=drive.position as [number,number],yaw=yawOf(drive.quaternionXyzw);
  admit(m,x,y,yaw,'INITIAL_POSE_INVALID',`/robots/${m.robotId}/initialPose`,'the initial pose');
  const targetBindings=[...w.points].sort((a,b)=>a.id<b.id?-1:1).flatMap(pt=>{
   const handoff=w.handoffPoints?.find(h=>h.id===`${pt.id}.handoff`);
   // a table or kitchen point is a semantic target, not a place to stand: without a handoff there is no feasible target
   if(!handoff&&(pt.kind==='table'||pt.kind==='kitchen')){add('TARGET_IN_COLLISION',`/world/points/${pt.id}`,`${pt.kind} point ${pt.id} has no handoff (${pt.id}.handoff); the robot never drives to the centre of a ${pt.kind}`);return [];}
   const t={pointId:pt.id,x:handoff?.position[0]??pt.x,y:handoff?.position[1]??pt.y,yaw:handoff?.yawRad??0};
   admit(m,t.x,t.y,t.yaw,'TARGET_IN_COLLISION',`/world/points/${pt.id}`,`target ${pt.id}`);
   return [t];
  });
  return {robotId:m.robotId,model:m,initialPoseMap:[x,y,yaw] as [number,number,number],targetBindings};
 });
 const bodies=robots.flatMap(r=>r?[{id:r.robotId,m:r.model,pose:r.initialPoseMap}]:[]);
 for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++){
  const a=bodies[i]!,b=bodies[j]!;
  if(overlaps(place(a.m.footprint.verticesM as P[],...a.pose as [number,number,number]),place(b.m.footprint.verticesM as P[],...b.pose as [number,number,number])))add('INITIAL_POSE_INVALID','/robots',`${a.id} and ${b.id} start overlapping`);
 }
 if(problems.length)throw new EngineeringInputError(problems);

 const scene=sealDocument<NavigationSceneV1>({
  schemaVersion:1,documentType:'navigation-scene',sceneDigest:'',inputs,compilerVersion:NAVIGATION_COMPILER_VERSION,schemaHash,
  robots:robots as NavigationSceneV1['robots'],
  world:{id:w.id,revision:w.revision,hash:inputs.world.hash,widthM:w.width,heightM:w.height,obstacles,boundaries:walls.map(([id,verticesM])=>({id,verticesM})).sort((a,b)=>a.id<b.id?-1:1)},
  actors:[],zones:[],clock:{tickMs:20},engine:{id:'irsim_2d',version:'2.12.0',collisionMode:'stop'},policy,files:[],
  limitations:['known static map plus simulated LiDAR: not SLAM or localisation','obstacles extend over all heights: PLANAR_OCCLUSION_NO_HEIGHT_FILTER','collision_mode stop: a contact stops the plant, it is not a contact-dynamics result','table and kitchen points are semantic targets; robots stand at their handoff'],
 },'sceneDigest');
 const checked=validateNavigationDocument(scene);
 if(!checked.ok)throw new EngineeringInputError(checked.issues.slice(0,20).map(i=>({code:i.code,path:i.path,blocking:true,detail:i.message})));
 return scene;
}
/** Tilt of the +z axis away from vertical for a quaternion [x,y,z,w]. */
const qrotateZ=(q:readonly number[])=>Math.hypot(2*(q[0]!*q[2]!+q[3]!*q[1]!),2*(q[1]!*q[2]!-q[3]!*q[0]!));

/** The YAML and name map are derived from the scene, so they are added afterwards and the scene digest then covers them. */
export function withSceneFiles(scene:NavigationSceneV1,files:ArtifactRef[]):NavigationSceneV1{
 return sealDocument<NavigationSceneV1>({...scene,files:[...files].sort((a,b)=>a.path<b.path?-1:1)},'sceneDigest');
}

// ---- portable compiler (engineering-irsim-2d-v1) ----
export interface NavigationCompilerOptions{
 /** Interpreter of the IR-SIM venv (operator option, never from a request). */
 python:string;
 /** robotics/navigation-2d */
 workerRoot:string;
 /** robotics/simulation: the pure description helpers (URDF, CompiledScene); no ROS or native process is started from there. */
 descriptionHelperRoot:string;
 schemaHash?:string;
 timeoutMs?:number;
}
const sha256=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
const jsonBytes=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v,null,2)+'\n');

/** CompilerPort for the portable profile: projections and scene in TypeScript, URDF/CompiledScene/IR-SIM YAML in Python through the shared pure helpers. Never invokes the native compiler. */
export function createNavigationCompiler(o:NavigationCompilerOptions):CompilerPort{
 const schemaHash=o.schemaHash??NAVIGATION_SCHEMA_HASH,policy=defaultNavigationPolicy();
 return {
  version:`lab-navigation-compiler/1+${NAVIGATION_COMPILER_VERSION}`,
  async compileResolved(input,outDir){
   const entities=input.project.runtimeProject.entities;
   const unsupported=entities.filter(e=>e.kind!=='amr');
   if(unsupported.length)throw new EngineeringInputError(unsupported.map(e=>({code:'ENTITY_KIND_UNSUPPORTED',path:`/runtimeProject/entities/${e.id}`,blocking:true,detail:`${e.kind} is not simulated by the 2D profile`})));
   const ids=entities.map(e=>e.id).sort(),physical=ids.map(id=>projectPhysicalModel(input,id,schemaHash));
   const models=physical.map(p=>projectNavigationModel(p,policy,{entitySpeedLimitMps:entities.find(e=>e.id===p.robotId)?.speedLimitMps}));
   const scene=compileNavigationScene(input,models,policy,schemaHash);
   const request=join(dirname(outDir),`${basename(outDir)}.request.json`);
   await writeFile(request,JSON.stringify({compileInput:input,scene}),{mode:0o600});
   let listed:{path:string;sha256:string;bytes:number}[];
   try{
    const root=resolve(o.workerRoot),env={PATH:'/usr/bin:/bin',PYTHONPATH:[root,resolve(o.descriptionHelperRoot)].join(':'),PYTHONDONTWRITEBYTECODE:'1',PYTHONNOUSERSITE:'1',LANG:'C.UTF-8'} as unknown as NodeJS.ProcessEnv;
    const {stdout}=await run(o.python,['-m','irsim_worker.compile','--input',request,'--out',outDir],{cwd:root,env,timeout:o.timeoutMs??55_000,maxBuffer:8*1024*1024}).catch((e:{stderr?:string;message:string})=>{throw new Error((e.stderr||e.message).trim().slice(-600));});
    listed=(JSON.parse(stdout) as {files:typeof listed}).files;
   }finally{await unlink(request).catch(()=>{});}
   const worldFiles=listed.filter(f=>f.path.startsWith('irsim/'));
   const final=withSceneFiles(scene,worldFiles.map(f=>({path:f.path,sha256:f.sha256,bytes:f.bytes})));
   const extra:Record<string,unknown>={'navigation-scene.json':final,'navigation-policy.json':policy};
   physical.forEach(p=>{extra[`physical-model/${p.robotId}.json`]=p;});
   models.forEach(m=>{extra[`navigation-model/${m.robotId}.json`]=m;});
   const files=listed.map(f=>({path:f.path,sha256:f.sha256}));
   for(const [path,value] of Object.entries(extra)){
    const bytes=jsonBytes(value);
    await mkdir(dirname(join(outDir,path)),{recursive:true});await writeFile(join(outDir,path),bytes);files.push({path,sha256:sha256(bytes)});
   }
   const sceneJson=listed.find(f=>f.path==='scene.json');
   if(!sceneJson)throw new Error('PORTABLE_COMPILER_OUTPUT_INCOMPLETE scene.json');
   return {sceneDigest:sceneJson.sha256,files:files.sort((a,b)=>a.path<b.path?-1:1)};
  },
  runnable:()=>false, // native execution is a separate fact; IR-SIM readiness decides whether this bundle runs on the 2D provider
 };
}
