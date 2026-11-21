/** A closed experiment declaration is checked by reconstructing every derived document, not by masking subtrees. */
import {projectPhysicalModel} from '../../engineering/physical-model';
import {projectNavigationModel} from '../../engineering/navigation-model';
import {compileNavigationScene,withSceneFiles} from '../../engineering/navigation-compiler';
import {WORLD3D_DEFAULT} from '../../engineering/webots-compiler';
import {prepareEngineeringCompileInput} from '../../engineering/assembly';
import type {EngineeringProject,ResolvedAssembly} from '../../engineering/contracts';
import {sealDocument,type LoadProfileV1} from '../navigation2d/contracts';
import {hashJson} from '../hash';
import {MOBILE_CONTROLLER_POLICY,MOBILE_STOP_POLICY} from './mujoco-mobile';
import {experimentPolicy,mujocoExperiment} from './experiment-registry';
import {TRAY_EXPERIMENTS,isTrayExperiment} from './tray-experiments';
import {driveExperiment} from '../control/drive-experiments';
import {driveDocumentDigest} from '../control/drive-io';
import {verifiedSimulationInput} from './simulation-input';
const CANONICAL='830ba57f4f51272b533fd2c6a2c8743ba4857341af0e7af90f4525145b7249b9';
const LOAD_SHAPES={'empty':'43176b16326df374a96e5e35a7924172f78a040072aacc7383b053a2362b684c','cup-center':'8c8916aa043c53fc9758c4ee6595a6271a899d2207dd70a30f82127e05cc4299','cup-offset':'0b2bd1dddfa00c2d18450fb536553f1cdc91a8b507a293714689705d308d1187','cup-triple':'835bf41b11f6fa676cf2a8f4a16cb3d4f5626b3983d742e637b27c1376218e98','cup-triple-low-friction':'3887f7e338039aab2efc2935cadf941467e2649143cba70121efd54ffa3555c0'} as Record<string,string>;
const PHYSICS={'drive-contact-profile':'9a0940dcff41e56a21bf38bed4c4984d55200cfa736c6507ecced8e5df96a1d3','drive-contact-low-v1':'c9aec2a6a250e81f4c5c1d1372e88d7d90340b7e42f7526fe90a7ad3d1d4ad9c','drive-contact-high-v1':'9d1f7f3315cfe9df89ed8b8b15361b3fd09d66dedbe4ea5240a5c04b54ecbe8a','drive-contact-tray-low-v1':'fb6ab8e616f580c90211587f0cb2889ce1ff8dc93f637f3a8109e92ba1dd1597'} as Record<string,string>;
/** sha256 of fixtures/serve-tray-v1/tray-policy-v1.json: the thresholds a tray run is judged by are the reviewed ones. */
const TRAY_POLICY_SHA='bbcfaec1e1dc7a1d7e6e492bc0602136d0961c6ada069116a1d288675eafb0d7';
const equal=(a:unknown,b:unknown)=>{if(hashJson(a)!==hashJson(b))throw Error('UNDECLARED_INPUT_CHANGE');};
export function verifiedPhysicsInputs(v:ReturnType<typeof verifiedSimulationInput>){
 const {scene,get,refs,report}=v,project=v.project as unknown as EngineeringProject;
 if(scene.engine.id!=='mujoco_3d'||scene.engine.version!=='3.17.0')throw Error('PHYSICS_ENGINE_UNSUPPORTED');
 const experiment=mujocoExperiment(project.mujocoExperimentId??'payload-center-v1'),policy=experimentPolicy(project.mujocoExperimentId??'payload-center-v1');
 equal(scene.policy,policy);equal(get('navigation-policy.json'),policy);
 const resolved=get<ResolvedAssembly>('resolved-assembly.json'),input=prepareEngineeringCompileInput(project,resolved,get('recipes.json'));
 equal(input.projectDigest,scene.inputs.project.digest);equal(input.runtimeProjection.project,get('runtime-project.json'));equal(input.runtimeProjection.assets,get('assets.json'));
 const physical=projectPhysicalModel(input,scene.robots[0]!.robotId,scene.schemaHash),physicalPath=`physical-model/${physical.robotId}.json`;
 equal(physical,get(physicalPath));
 const {inputs:_inputs,modelDigest:_digest,...mechanics}=physical;void _inputs;void _digest;
 const canonical=get<typeof physical>('canonical-physical-model.json'),{inputs:_canonicalInputs,modelDigest:_canonicalDigest,...canonicalMechanics}=canonical;void _canonicalInputs;void _canonicalDigest;
 equal(mechanics,canonicalMechanics);if(refs.get('canonical-physical-model.json')?.sha256!==CANONICAL)throw Error('CANONICAL_MODEL_DIFFERS');
 const model=projectNavigationModel(physical,policy,{entitySpeedLimitMps:project.runtimeProject.entities[0]!.speedLimitMps});
 equal(model,scene.robots[0]!.model);equal(get(`navigation-model/${physical.robotId}.json`),model);
 const load=get<LoadProfileV1>(`${experiment.load}.json`),{digest,modelRef,...loadShape}=load;
 if(hashJson(loadShape)!==LOAD_SHAPES[experiment.load]||digest!==sealDocument(load,'digest').digest||modelRef.path!==physicalPath||modelRef.sha256!==refs.get(physicalPath)?.sha256)throw Error('LOAD_INPUT_DIFFERS');
 if(refs.get(`${experiment.physics}.json`)?.sha256!==PHYSICS[experiment.physics])throw Error('PHYSICS_PROFILE_DIFFERS');
 equal(get('mobile-controller-policy.json'),MOBILE_CONTROLLER_POLICY);equal(get('mobile-stop-policy.json'),MOBILE_STOP_POLICY);
 const ref=(path:string,id:string,revision:number)=>({id,revision,path,sha256:refs.get(path)!.sha256});
 const physics=get<{id:string;revision:number}>(`${experiment.physics}.json`);
 // a drive run (a CIL project, or a tray variant that implies one) adds exactly two documents and two refs, first in the file list as the compiler writes them
 const driveId=project.driveExperimentId??experiment.driveExperimentId,drive=driveId?driveDocs(driveId,experiment,physical.modelDigest,refs,get):undefined;
 const tray=experiment.family==='tray'&&isTrayExperiment(project.mujocoExperimentId)?trayDocs(project.mujocoExperimentId,refs,get):[];
 const expectedFiles=[...drive?.paths??[],'mobile-controller-policy.json','mobile-stop-policy.json',physicalPath,`${experiment.load}.json`,`${experiment.physics}.json`,'assumptions.json','cell-layout.json','canonical-physical-model.json',...tray].map(path=>{const r=refs.get(path);if(!r)throw Error('ARTIFACT_MISSING');return {...r};});
 const expected=withSceneFiles(compileNavigationScene(input,[model],policy,scene.schemaHash,{world3d:{...WORLD3D_DEFAULT},engine:{id:'mujoco_3d',version:'3.17.0',timestepMs:2,substeps:10,...drive?.refs,controllerPolicyRef:ref('mobile-controller-policy.json',MOBILE_CONTROLLER_POLICY.id,1),stopPolicyRef:ref('mobile-stop-policy.json',MOBILE_STOP_POLICY.id,1),loadProfileRef:ref(`${experiment.load}.json`,load.id,load.revision),physicsProfileRef:ref(`${experiment.physics}.json`,physics.id,physics.revision)}}),expectedFiles);
 equal(expected,scene);if(v.documents.has('scene.json'))equal(get('scene.json'),scene);
 const n=report.navigation2d!,e=n.engine;
 if(e.id!=='mujoco_3d'||e.engineVersion!==scene.engine.version)throw Error('ENGINE_IDENTITY_DIFFERS');
 equal(e.controllerPolicyRef,scene.engine.controllerPolicyRef);equal(e.stopPolicyRef,scene.engine.stopPolicyRef);equal(e.loadProfileRef,scene.engine.loadProfileRef);equal(e.physicsProfileRef,scene.engine.physicsProfileRef);
 equal(n.controller,MOBILE_CONTROLLER_POLICY.controller);
 const p=report.physicsEvidence;
 if(!p||!p.complete||p.issues.length||!p.manifest.coverage.complete||p.manifest.coverage.firstTick!==0||p.manifest.coverage.lastTick!==report.outcome.tick||p.manifest.gaps.length||p.manifest.terminalReason||p.manifest.identity.runId!==report.manifest.runId||p.manifest.identity.sceneDigest!==scene.sceneDigest||p.manifest.identity.loadProfileDigest!==scene.engine.loadProfileRef.sha256||p.manifest.identity.physicsProfileDigest!==scene.engine.physicsProfileRef.sha256)throw Error('PHYSICS_COVERAGE_INCOMPLETE');
 return {experiment,experimentId:project.mujocoExperimentId??'payload-center-v1',project,resolved,physical,model,policy,load,physics};
}
/** Concrete leaf changes, including mirrored file/scene references, remain reviewable in the result. */
export function changedLeaves(a:unknown,b:unknown,path=''):string[]{
 if(hashJson(a??null)===hashJson(b??null))return [];
 if(a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b))return [...new Set([...Object.keys(a),...Object.keys(b)])].sort().flatMap(k=>changedLeaves((a as Record<string,unknown>)[k],(b as Record<string,unknown>)[k],`${path}/${k}`));
 return [path];
}

/** The AMR drive documents of a registered drive experiment as the bundle holds them: the registry's file names, sealed, bound to this plant; a tray variant's base limit is the registered one. */
function driveDocs(id:string,experiment:ReturnType<typeof mujocoExperiment>,plantModelDigest:string,refs:Map<string,{sha256:string;bytes:number}>,get:<T=unknown>(p:string)=>T){
 const e=driveExperiment(id),ref=(path:string)=>{const r=refs.get(path);if(!r)throw Error('ARTIFACT_MISSING');return r;};
 const model=get<{id:string;revision:number;digest:string}>(e.mobileModel),control=get<{id:string;revision:number;digest:string;plantModelDigest:string;controllers:{controllerId:string;params:Record<string,number>}[]}>(e.mobileControl);
 const {digest:md,...mrest}=model,{digest:cd,...crest}=control;
 if(driveDocumentDigest(mrest)!==md||driveDocumentDigest(crest)!==cd)throw Error('DRIVE_DOCUMENT_DIGEST_DIFFERS');
 if(control.plantModelDigest!==plantModelDigest)throw Error('DRIVE_PLANT_MISMATCH');
 if(experiment.baseAccelerationMps2!==undefined&&control.controllers.find(c=>c.controllerId==='diff-drive-base-v1')?.params.maxAccelerationMps2!==experiment.baseAccelerationMps2)throw Error('UNDECLARED_INPUT_CHANGE');
 return {paths:[e.mobileModel,e.mobileControl],refs:{driveModelRef:{id:model.id,revision:model.revision,path:e.mobileModel,sha256:ref(e.mobileModel).sha256},controlProfileRef:{id:control.id,revision:control.revision,path:e.mobileControl,sha256:ref(e.mobileControl).sha256}}};
}
/** The two documents a tray variant adds: the one that names it (rebuilt from the registry) and the reviewed thresholds (by hash). */
function trayDocs(id:keyof typeof TRAY_EXPERIMENTS,refs:Map<string,{sha256:string;bytes:number}>,get:<T=unknown>(p:string)=>T){
 equal(get('tray-experiment.json'),{schemaVersion:1,documentType:'tray-experiment',id,revision:1,calibration:'not_calibrated',...TRAY_EXPERIMENTS[id]});
 if(refs.get('tray-policy-v1.json')?.sha256!==TRAY_POLICY_SHA)throw Error('TRAY_POLICY_DIFFERS');
 return ['tray-experiment.json','tray-policy-v1.json'];
}
