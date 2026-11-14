/** X01's closed MuJoCo input scope. Names alone never establish the empty-load/baseline experiment. */
import {hashJson} from '../hash';
import {documentDigest,validateNavigationDocument,type LoadProfileV1,type RobotPhysicalModelV1} from '../navigation2d/contracts';
import {validateLoadProfile} from './load-profile';
import type {verifiedSimulationInput} from './simulation-input';
const BASELINE_PHYSICS_SHA256='9a0940dcff41e56a21bf38bed4c4984d55200cfa736c6507ecced8e5df96a1d3';
// Entire registered empty document except its resealed digest and current compiled-model byte binding.
const EMPTY_SHAPE_SHA256='43176b16326df374a96e5e35a7924172f78a040072aacc7383b053a2362b684c';
export function verifySemanticMujocoProfiles(v:ReturnType<typeof verifiedSimulationInput>):void{
 const {scene,get,refs,report}=v,e=scene.engine;if(e.id!=='mujoco_3d')return;
 const bound=(ref:{id:string;revision:number;path:string;sha256:string},path:string,id:string)=>ref.id===id&&ref.revision===1&&ref.path===path&&ref.sha256===refs.get(path)?.sha256&&scene.files.some(f=>f.path===path&&f.sha256===ref.sha256&&f.bytes===refs.get(path)?.bytes);
 if(!bound(e.physicsProfileRef,'drive-contact-profile.json','serve-drive-contact-v1'))throw Error('SEMANTIC_PHYSICS_BASELINE_REQUIRED');
 const physics=get<{id:string;revision:number;digest:string}>(e.physicsProfileRef.path);
 if(physics.digest!==documentDigest(physics,'digest'))throw Error('SEMANTIC_PHYSICS_DIGEST_MISMATCH');
 if(physics.id!==e.physicsProfileRef.id||physics.revision!==1||e.physicsProfileRef.sha256!==BASELINE_PHYSICS_SHA256)throw Error('SEMANTIC_PHYSICS_BASELINE_REQUIRED');
 if(!bound(e.loadProfileRef,'empty.json','empty'))throw Error('SEMANTIC_EMPTY_LOAD_REQUIRED');
 const load=get<LoadProfileV1>(e.loadProfileRef.path);
 if(!validateLoadProfile(load).ok)throw Error('SEMANTIC_EMPTY_LOAD_INVALID');
 if(load.props.length)throw Error('SEMANTIC_EMPTY_LOAD_POPULATION_NOT_EMPTY');
 const {digest:_digest,modelRef,...empty}=load;void _digest;
 if(hashJson(empty)!==EMPTY_SHAPE_SHA256)throw Error('SEMANTIC_EMPTY_LOAD_BASELINE_REQUIRED');
 const robot=scene.robots[0]!,path=`physical-model/${robot.robotId}.json`,model=get<RobotPhysicalModelV1>(path),file=refs.get(path);
 if(!file||modelRef.path!==path||modelRef.sha256!==file.sha256||!scene.files.some(f=>f.path===path&&f.sha256===file.sha256&&f.bytes===file.bytes)||!validateNavigationDocument(model).ok||model.robotId!==robot.robotId||model.modelDigest!==robot.model.physicalModelDigest||hashJson(model.inputs)!==hashJson(scene.inputs))throw Error('SEMANTIC_LOAD_MODEL_BINDING_MISMATCH');
 const n=report.navigation2d!.engine;
 if(n.id!=='mujoco_3d'||hashJson(n.loadProfileRef)!==hashJson(e.loadProfileRef)||hashJson(n.physicsProfileRef)!==hashJson(e.physicsProfileRef))throw Error('SEMANTIC_PHYSICS_REPORT_BINDING_MISMATCH');
 const p=report.physicsEvidence?.manifest.identity;
 if(p&&(p.sceneDigest!==scene.sceneDigest||p.loadProfileDigest!==e.loadProfileRef.sha256||p.physicsProfileDigest!==e.physicsProfileRef.sha256))throw Error('SEMANTIC_PHYSICS_REPORT_BINDING_MISMATCH');
}
