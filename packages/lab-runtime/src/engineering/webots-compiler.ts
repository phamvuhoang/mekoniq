// Portable compiler for the Webots 3D profile (engineering-webots-3d-v1): projections, scene and bundle files in TypeScript only. The bundle holds the navigation scene
// (engine webots_3d, with world3d), the physical model of every robot (the Python world compiler reads them from the scene's file list) and scene.json, the scene's own bytes.
// Nothing here starts Webots or any process; whether a bundle runs is the Webots provider's readiness.
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {NAVIGATION_SCHEMA_HASH,defaultNavigationPolicy} from '../v2/navigation2d/contracts';
import type {World3DV1} from '../v2/navigation2d/contracts';
import {EngineeringInputError} from './assembly';
import type {CompilerPort} from './gateway';
import {NAVIGATION_COMPILER_VERSION,compileNavigationScene,withSceneFiles} from './navigation-compiler';
import {projectNavigationModel} from './navigation-model';
import {projectPhysicalModel} from './physical-model';

/** Heights and frictions the 2D scene does not carry; server-owned, all assumed (the lidar plane at 0.21 m stays below the 0.75 m table top). */
export const WORLD3D_DEFAULT:World3DV1=Object.freeze({obstacleHeightM:0.75,wallHeightM:1.2,floorFriction:0.8,casterFriction:0.02,provenance:'assumed'});
export const WEBOTS_SCENE_ENGINE={id:'webots_3d',version:'R2025a',basicTimeStepMs:20} as const;
const sha256=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const jsonBytes=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v,null,2)+'\n');

export function createWebotsCompiler(o:{schemaHash?:string}={}):CompilerPort{
 const schemaHash=o.schemaHash??NAVIGATION_SCHEMA_HASH,policy=defaultNavigationPolicy();
 return {
  version:`lab-webots-compiler/1+${NAVIGATION_COMPILER_VERSION}`,
  async compileResolved(input,outDir){
   const entities=input.project.runtimeProject.entities,unsupported=entities.filter(e=>e.kind!=='amr');
   if(unsupported.length)throw new EngineeringInputError(unsupported.map(e=>({code:'ENTITY_KIND_UNSUPPORTED',path:`/runtimeProject/entities/${e.id}`,blocking:true,detail:`${e.kind} is not simulated by the Webots 3D profile`})));
   const ids=entities.map(e=>e.id).sort(),physical=ids.map(id=>projectPhysicalModel(input,id,schemaHash));
   const models=physical.map(p=>projectNavigationModel(p,policy,{entitySpeedLimitMps:entities.find(e=>e.id===p.robotId)?.speedLimitMps}));
   const scene=compileNavigationScene(input,models,policy,schemaHash,{engine:{...WEBOTS_SCENE_ENGINE},world3d:{...WORLD3D_DEFAULT}});
   const physicalBytes=physical.map(p=>({path:`physical-model/${p.robotId}.json`,bytes:jsonBytes(p)}));
   const final=withSceneFiles(scene,physicalBytes.map(f=>({path:f.path,sha256:sha256(f.bytes),bytes:f.bytes.length})));
   const sceneBytes=jsonBytes(final),out:{path:string;bytes:Uint8Array}[]=[{path:'scene.json',bytes:sceneBytes},{path:'navigation-scene.json',bytes:sceneBytes},{path:'navigation-policy.json',bytes:jsonBytes(policy)},...physicalBytes,
    ...models.map(m=>({path:`navigation-model/${m.robotId}.json`,bytes:jsonBytes(m)}))];
   for(const f of out){await mkdir(dirname(join(outDir,f.path)),{recursive:true});await writeFile(join(outDir,f.path),f.bytes);}
   return {sceneDigest:sha256(sceneBytes),files:out.map(f=>({path:f.path,sha256:sha256(f.bytes)})).sort((a,b)=>a.path<b.path?-1:1)};
  },
  runnable:()=>false, // native execution is a separate fact; the Webots provider's readiness decides whether this bundle runs
 };
}
