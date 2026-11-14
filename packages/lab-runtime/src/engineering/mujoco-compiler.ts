// Server-owned measured Serve profile. Requests choose only the engineering profile; paths and physics parameters never come from the browser.
import {payloadExperiment} from '../v2/simulation3d/payload-experiments';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {NAVIGATION_SCHEMA_HASH,defaultNavigationPolicy,sealDocument,type LoadProfileV1,type RobotPhysicalModelV1} from '../v2/navigation2d/contracts';
import {MOBILE_STOP_POLICY,MOBILE_CONTROLLER_POLICY} from '../v2/simulation3d/mujoco-mobile';
import {hashJson} from '../v2/hash';
import {EngineeringInputError} from './assembly';
import type {CompilerPort} from './gateway';
import {compileNavigationScene,withSceneFiles,NAVIGATION_COMPILER_VERSION} from './navigation-compiler';
import {projectNavigationModel} from './navigation-model';
import {projectPhysicalModel} from './physical-model';
import {WORLD3D_DEFAULT} from './webots-compiler';

const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const json=(v:unknown)=>Buffer.from(JSON.stringify(v,null,2)+'\n');
const fail=(code:string,detail:string):never=>{throw new EngineeringInputError([{code,path:'/runtimeProject/entities',blocking:true,detail}]);};
/** Ignore input identity only: the locked profile applies to exactly the registered mechanics and sensors. */
const shape=(p:RobotPhysicalModelV1)=>{const {inputs:_i,modelDigest:_d,robotId:_r,...rest}=p;void _i;void _d;void _r;return hashJson(rest);};
export function createMujocoCompiler(o:{workerRoot:string}):CompilerPort{
 return {version:`lab-mujoco-compiler/1+${NAVIGATION_COMPILER_VERSION}`,runnable:()=>false,
  async compileResolved(input,outDir){
   const entities=input.project.runtimeProject.entities;
   if(entities.length!==1||entities[0]!.kind!=='amr')fail('MUJOCO_MOBILE_SCOPE_UNSUPPORTED','the measured mobile profile supports exactly one AMR and no other entities');
   const experiment=input.project.mujocoExperimentId?payloadExperiment(input.project.mujocoExperimentId):undefined,loadName=experiment?.load??'cup-center',physicsName=experiment?.physics??'drive-contact-profile';
   const fixture=join(o.workerRoot,'fixtures/serve-payload-v1');
   const physical=projectPhysicalModel(input,entities[0]!.id,NAVIGATION_SCHEMA_HASH),canonical=JSON.parse(await readFile(join(fixture,'physical-model-amr-1.json'),'utf8')) as RobotPhysicalModelV1;
   if(shape(physical)!==shape(canonical))fail('MUJOCO_MODEL_UNSUPPORTED','the measured drive/load profile requires the canonical Serve mechanics and noiseless sensor');
   const physicalPath=`physical-model/${physical.robotId}.json`,physicalBytes=json(physical);
   const load=sealDocument<LoadProfileV1>({...JSON.parse(await readFile(join(fixture,`${loadName}.json`),'utf8')),modelRef:{path:physicalPath,sha256:sha(physicalBytes)}},'digest');
   const loadBytes=json(load),physicsBytes=await readFile(join(fixture,`${physicsName}.json`)),physics=JSON.parse(physicsBytes.toString());
   const registered=JSON.parse(await readFile(join(fixture,'registered-physics.json'),'utf8'));
   if(sha(physicsBytes)!==registered[physicsName]?.sha256)fail('MUJOCO_PROFILE_UNSUPPORTED','the mobile profile must be the reviewed B02a measurement lock');
   const baseline=defaultNavigationPolicy(),parameters=experiment?{...baseline.parameters,maxLinearMps:experiment.maxLinearMps,maxAngularRadps:experiment.maxAngularRadps}:baseline.parameters;
   const policy=hashJson(parameters)===hashJson(baseline.parameters)?baseline:sealDocument({...baseline,id:`${input.project.mujocoExperimentId}-navigation-policy`,parameters,source:{kind:'assumed' as const,documentId:'payload-experiments-v1',revision:'1',locator:`registered ${input.project.mujocoExperimentId} speed caps; all other parameters retain baseline`,contentSha256:hashJson(parameters)}},'hash'),model=projectNavigationModel(physical,policy,{entitySpeedLimitMps:entities[0]!.speedLimitMps});
   const stopBytes=json(MOBILE_STOP_POLICY),controllerBytes=json(MOBILE_CONTROLLER_POLICY);
   const files=[{path:'mobile-controller-policy.json',bytes:controllerBytes},{path:'mobile-stop-policy.json',bytes:stopBytes},{path:physicalPath,bytes:physicalBytes},{path:`${loadName}.json`,bytes:loadBytes},{path:`${physicsName}.json`,bytes:physicsBytes},
    {path:'assumptions.json',bytes:await readFile(join(fixture,'assumptions.json'))},
    {path:'cell-layout.json',bytes:await readFile(join(o.workerRoot,'fixtures/xarm6-g2-v1/cell-layout.json'))},
    {path:'canonical-physical-model.json',bytes:await readFile(join(fixture,'physical-model-amr-1.json'))}];
   const scene=withSceneFiles(compileNavigationScene(input,[model],policy,NAVIGATION_SCHEMA_HASH,{world3d:{...WORLD3D_DEFAULT},engine:{id:'mujoco_3d',version:'3.17.0',timestepMs:2,substeps:10,
    controllerPolicyRef:{id:MOBILE_CONTROLLER_POLICY.id,revision:MOBILE_CONTROLLER_POLICY.revision,path:'mobile-controller-policy.json',sha256:sha(controllerBytes)},stopPolicyRef:{id:MOBILE_STOP_POLICY.id,revision:MOBILE_STOP_POLICY.revision,path:'mobile-stop-policy.json',sha256:sha(stopBytes)},physicsProfileRef:{id:physics.id,revision:physics.revision,path:`${physicsName}.json`,sha256:sha(physicsBytes)},loadProfileRef:{id:load.id,revision:load.revision,path:`${loadName}.json`,sha256:sha(loadBytes)}}}),files.map(f=>({path:f.path,sha256:sha(f.bytes),bytes:f.bytes.length})));
   const sceneBytes=json(scene),out=[...files,{path:'scene.json',bytes:sceneBytes},{path:'navigation-scene.json',bytes:sceneBytes},{path:'navigation-policy.json',bytes:json(policy)},{path:`navigation-model/${physical.robotId}.json`,bytes:json(model)}];
   for(const f of out){await mkdir(dirname(join(outDir,f.path)),{recursive:true});await writeFile(join(outDir,f.path),f.bytes);}
   return {sceneDigest:sha(sceneBytes),files:out.map(f=>({path:f.path,sha256:sha(f.bytes)})).sort((a,b)=>a.path<b.path?-1:1)};
  }};
}
