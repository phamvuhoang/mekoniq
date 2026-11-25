// Server-owned measured Serve profile. Requests choose only the engineering profile; paths and physics parameters never come from the browser.
import {experimentPolicy,mujocoExperiment} from '../v2/simulation3d/experiment-registry';
import {TRAY_EXPERIMENTS,isTrayExperiment} from '../v2/simulation3d/tray-experiments';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {NAVIGATION_SCHEMA_HASH,defaultNavigationPolicy,sealDocument,type LoadProfileV1,type RobotPhysicalModelV1} from '../v2/navigation2d/contracts';
import {MOBILE_STOP_POLICY,MOBILE_CONTROLLER_POLICY} from '../v2/simulation3d/mujoco-mobile';
import {hashJson} from '../v2/hash';
import {mobileDriveBundle} from '../v2/control/drive-experiments';
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
   const experimentId=input.project.mujocoExperimentId,experiment=experimentId?mujocoExperiment(experimentId):undefined,loadName=experiment?.load??'cup-center',physicsName=experiment?.physics??'drive-contact-profile';
   const fixture=join(o.workerRoot,'fixtures',experiment?.fixture??'serve-payload-v1');
   // a tray variant implies its drive experiment; a project that names another one is refused, never silently overridden
   const driveId=input.project.driveExperimentId??experiment?.driveExperimentId;
   if(experiment?.driveExperimentId&&input.project.driveExperimentId&&input.project.driveExperimentId!==experiment.driveExperimentId)fail('MUJOCO_EXPERIMENT_DRIVE_CONFLICT',`${experimentId} runs on ${experiment.driveExperimentId}, the project names ${input.project.driveExperimentId}`);
   const physical=projectPhysicalModel(input,entities[0]!.id,NAVIGATION_SCHEMA_HASH),canonical=JSON.parse(await readFile(join(fixture,'physical-model-amr-1.json'),'utf8')) as RobotPhysicalModelV1;
   if(shape(physical)!==shape(canonical))fail('MUJOCO_MODEL_UNSUPPORTED','the measured drive/load profile requires the canonical Serve mechanics and noiseless sensor');
   const physicalPath=`physical-model/${physical.robotId}.json`,physicalBytes=json(physical);
   const load=sealDocument<LoadProfileV1>({...JSON.parse(await readFile(join(fixture,`${loadName}.json`),'utf8')),modelRef:{path:physicalPath,sha256:sha(physicalBytes)}},'digest');
   const loadBytes=json(load),physicsBytes=await readFile(join(fixture,`${physicsName}.json`)),physics=JSON.parse(physicsBytes.toString());
   const registered={...JSON.parse(await readFile(join(o.workerRoot,'fixtures/serve-payload-v1/registered-physics.json'),'utf8')),...experiment?.fixture==='serve-tray-v1'?JSON.parse(await readFile(join(fixture,'registered-physics.json'),'utf8')):{}};
   if(sha(physicsBytes)!==registered[physicsName]?.sha256)fail('MUJOCO_PROFILE_UNSUPPORTED','the mobile profile must be the reviewed B02a measurement lock');
   const baseline=defaultNavigationPolicy(),policy=experimentId?experimentPolicy(experimentId):baseline,model=projectNavigationModel(physical,policy,{entitySpeedLimitMps:entities[0]!.speedLimitMps});
   // a registered drive experiment adds exactly two documents and two refs; without the field the bundle is what it always was
   const drive=driveId?await mobileDriveBundle(o.workerRoot,driveId,physical.modelDigest,false,experiment?.baseAccelerationMps2):undefined;
   // a tray variant also carries the document that names it and the thresholds it is judged by (the run's runner reads the first to know whether a person crosses the route)
   const tray=experimentId&&isTrayExperiment(experimentId)?[{path:'tray-experiment.json',bytes:json({schemaVersion:1,documentType:'tray-experiment',id:experimentId,revision:1,calibration:'not_calibrated',...TRAY_EXPERIMENTS[experimentId]})},{path:'tray-policy-v1.json',bytes:await readFile(join(fixture,'tray-policy-v1.json'))}]:[];
   const stopBytes=json(MOBILE_STOP_POLICY),controllerBytes=json(MOBILE_CONTROLLER_POLICY);
   const files=[...drive?.files??[],{path:'mobile-controller-policy.json',bytes:controllerBytes},{path:'mobile-stop-policy.json',bytes:stopBytes},{path:physicalPath,bytes:physicalBytes},{path:`${loadName}.json`,bytes:loadBytes},{path:`${physicsName}.json`,bytes:physicsBytes},
    {path:'assumptions.json',bytes:await readFile(join(fixture,'assumptions.json'))},
    {path:'cell-layout.json',bytes:await readFile(join(o.workerRoot,'fixtures/xarm6-g2-v1/cell-layout.json'))},
    {path:'canonical-physical-model.json',bytes:await readFile(join(fixture,'physical-model-amr-1.json'))},...tray];
   const scene=withSceneFiles(compileNavigationScene(input,[model],policy,NAVIGATION_SCHEMA_HASH,{world3d:{...WORLD3D_DEFAULT},engine:{id:'mujoco_3d',version:'3.17.0',timestepMs:2,substeps:10,...drive?.refs,
    controllerPolicyRef:{id:MOBILE_CONTROLLER_POLICY.id,revision:MOBILE_CONTROLLER_POLICY.revision,path:'mobile-controller-policy.json',sha256:sha(controllerBytes)},stopPolicyRef:{id:MOBILE_STOP_POLICY.id,revision:MOBILE_STOP_POLICY.revision,path:'mobile-stop-policy.json',sha256:sha(stopBytes)},physicsProfileRef:{id:physics.id,revision:physics.revision,path:`${physicsName}.json`,sha256:sha(physicsBytes)},loadProfileRef:{id:load.id,revision:load.revision,path:`${loadName}.json`,sha256:sha(loadBytes)}}}),files.map(f=>({path:f.path,sha256:sha(f.bytes),bytes:f.bytes.length})));
   const sceneBytes=json(scene),out=[...files,{path:'scene.json',bytes:sceneBytes},{path:'navigation-scene.json',bytes:sceneBytes},{path:'navigation-policy.json',bytes:json(policy)},{path:`navigation-model/${physical.robotId}.json`,bytes:json(model)}];
   for(const f of out){await mkdir(dirname(join(outDir,f.path)),{recursive:true});await writeFile(join(outDir,f.path),f.bytes);}
   return {sceneDigest:sha(sceneBytes),files:out.map(f=>({path:f.path,sha256:sha(f.bytes)})).sort((a,b)=>a.path<b.path?-1:1)};
  }};
}
