// The Webots arm world as a document (R1.1 D26): the arm-ref-3d-v1 fixture on the project's arm base pose, with the project's fixed obstacles in the arm base frame. AMR, cup and coffee machine are
// not in it: a moving AMR stays in the TS capsule check (ctx.armScene).
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {LabProjectV2} from '../contracts';
import {hashJson} from '../hash';
import {invertPose} from '../frames';
import {boxInArm} from '../models/arm-scene';
import {PUMA560_SI} from '../models/arm-kinematics';
import {MockArmPlant} from '../../../../cell-adapters/src/mock-arm';
import {sealDocument,validateArmScene3D,type ArmScene3DV1} from '../navigation2d/contracts';

export const ARM_FIXTURE_ID='arm-ref-3d-v1';
/** The floor friction of the arm world: an assumed input like every number of the fixture. */
export const ARM_WORLD3D={floorFriction:0.8,provenance:'assumed'} as const;
export type ArmSceneErrorCode='ARM_SCENE_UNAVAILABLE'|'ARM_MODEL_MISMATCH';
const fail=(code:ArmSceneErrorCode,detail:string)=>new Error(`${code}: ${detail}`);
/** The low 31 bits, exactly the worker's engine_seed: a WorldInfo.randomSeed is an SFInt32 and the worker refuses a create whose seed does not reduce to the scene's. */
export const engineSeedOf=(seed:number)=>seed&0x7fffffff;

export interface ArmFixture {id:string;revision:string;componentText:string}
/** The committed fixture directory; its manifest digest must be the hash of the component the worker will be given. */
export function readArmFixture(workerRoot:string):ArmFixture{
 const dir=join(workerRoot,'fixtures',ARM_FIXTURE_ID),componentText=readFileSync(join(dir,'component.json'),'utf8'),manifest=JSON.parse(readFileSync(join(dir,'manifest.json'),'utf8')) as {componentDigest:string};
 if(hashJson(JSON.parse(componentText))!==manifest.componentDigest)throw fail('ARM_MODEL_MISMATCH',`${ARM_FIXTURE_ID} component.json does not hash to its manifest`);
 return {id:ARM_FIXTURE_ID,revision:manifest.componentDigest,componentText};
}

/** `homeRad` is where the arm starts (the default is the mock's home pose; a resumed run starts where it was). Throws ARM_SCENE_UNAVAILABLE without an arm collision profile, ARM_MODEL_MISMATCH when the profile or fixture is for another model. */
export function buildArmScene3D(project:LabProjectV2,fixture:{id:string;revision:string},seed:number,options:{armId?:string;homeRad?:readonly number[]}={}):ArmScene3DV1{
 const profile=project.armCollisionProfile;
 if(!profile)throw fail('ARM_SCENE_UNAVAILABLE','the project has no armCollisionProfile (the arm base pose and fixture heights)');
 if(fixture.id!==ARM_FIXTURE_ID||profile.modelId!==PUMA560_SI.id||profile.modelRevision!==PUMA560_SI.revision)
  throw fail('ARM_MODEL_MISMATCH',`profile ${profile.modelId}@${profile.modelRevision.slice(0,8)}, fixture ${fixture.id}, table ${PUMA560_SI.id}@${PUMA560_SI.revision.slice(0,8)}`);
 const mapInArm=invertPose(profile.baseInMap),armId=options.armId??project.entities.find(e=>e.kind==='arm')?.id??'arm-1';
 const statics=[...project.world.obstacles].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).map(o=>boxInArm(`fixture:${o.id}`,[o.x,o.y,0],[o.x+o.width,o.y+o.height,profile.fixtureHeightM],mapInArm));
 const scene=sealDocument({schemaVersion:1,sceneDigest:'',arm:{armId,modelId:ARM_FIXTURE_ID,modelRevision:fixture.revision,baseInMap:{position:[...profile.baseInMap.position],quaternionXyzw:[...profile.baseInMap.quaternionXyzw]},
  homeRad:[...(options.homeRad??MockArmPlant.initial(armId).q)]},statics,world3d:{...ARM_WORLD3D},engine:{id:'webots_3d',basicTimeStepMs:20},engineSeed:engineSeedOf(seed)} as unknown as ArmScene3DV1,'sceneDigest');
 const checked=validateArmScene3D(scene);
 if(!checked.ok)throw new Error(`ARM_SCENE_INVALID: ${checked.issues.map(i=>`${i.path} ${i.code}`).join('; ')}`);
 return scene;
}
