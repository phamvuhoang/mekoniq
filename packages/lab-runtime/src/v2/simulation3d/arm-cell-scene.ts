// The MuJoCo arm cell as a document (R2a): the xarm6-g2-v1 fixture (read only after every file matched its manifest) placed on the project's arm base pose. Supports and grasp frames are the
// fixture's cell layout carried from the arm base frame into the map frame; statics are the project's fixed obstacles in the arm base frame (as R1.1); cups are the run's. Pure apart from reading files.
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import type {LabProjectV2} from '../contracts';
import {hashJson} from '../hash';
import {composePose} from '../frames';
import {declareArmScene,fixtureStatics} from '../models/arm-scene';
import type {ArmObstacle} from '../models/arm-collision';
import {XARM6_SI} from '../models/arm-kinematics';
import type {ArmProgramSet} from '../../../../cell-adapters/src/mock-arm';
import {sealDocument,validateArmCellScene,type ArmCellSceneV1} from '../navigation2d/contracts';
import {engineSeedOf} from './arm-scene';

export const XARM_FIXTURE_ID='xarm6-g2-v1';
type V3=[number,number,number];type Q=[number,number,number,number];
export interface CellPose {position:V3;quaternionXyzw:Q}
export interface CellBox {centerM:V3;sizeM:V3}
/** cell-layout.json: the stand under the nozzle, the tray, the cup and the grasp frames, all in the arm base frame (assumed values of spike M00). */
export interface CellLayout {schemaVersion:1;provenance:'assumed';frame:'arm_base';nozzleStand:CellBox;tray:CellBox;
 cup:{componentId:string;radiusM:number;heightM:number;emptyMassKg:number;drinkMassKg:number};grasp:{pick:CellPose;place:CellPose;approachM:number;liftM:number}}
/** physics.json: gains, gripper drive, pads, palm, contact and motion limits of the MuJoCo plant (assumed, not calibrated). */
export interface XArmPhysics {schemaVersion:1;provenance:'assumed';substitute:boolean;not_calibrated:boolean;note:string;actuators:{joint:string;kp:number;kv:number}[];armatureKgM2:number[];
 capsuleRadiusM:number[];capsuleSegmentsM:number[][][];contact:{condim:number;impratio:number;padFriction:number[];propFriction:number[];solimp:number[];solref:number[]};
 gripper:{armatureKgM2:number;closedRad:number;commandRateRadPerTick:number;driveJoint:string;forceN:number;forceRangeNm:number;kp:number;kv:number;mimic:{joint:string;multiplier:number}[];mimicSolref:number[];openingMaxM:number};
 jointDynamics:{damping:number;frictionloss:number;source:Record<string,string>};maxAccelerationRadS2:number[];pads:{link:string;centerM:V3;sizeM:V3}[];palm:{link:string;centerM:V3;sizeM:V3};speedFraction:number}
/** A row of the programs.json IK table: the waypoint's joints and how well they reach its TCP pose. */
export interface WaypointRow {waypoint:string;q:number[];positionErrorM:number;orientationErrorRad:number;condition:number}
export interface XArmFixture {id:string;revision:string;componentText:string;physics:XArmPhysics;layout:CellLayout;programs:ArmProgramSet;waypoints:{table:WaypointRow[];digest:string};blobDir:string}
/** Assumed: the cup–stand/tray friction the spike's supports had in effect (MuJoCo's default sliding friction 1.0, docs/research/2026-11-mujoco-arm-spike.md "Ma sát cốc"); physics.json carries none. */
export const XARM_SUPPORT_FRICTION=1;
/** How far (xy, m) the tray in the map frame may sit from the project's coffee pickup point. */
export const ARM_CELL_LAYOUT_TOL_M=0.05;
export type ArmCellErrorCode='ARM_SCENE_UNAVAILABLE'|'ARM_MODEL_MISMATCH'|'ARM_CELL_LAYOUT_MISMATCH';
const fail=(code:ArmCellErrorCode,detail:string)=>new Error(`${code}: ${detail}`);
const sha256=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const read=(path:string)=>{try{return readFileSync(path);}catch{throw fail('ARM_MODEL_MISMATCH',`${XARM_FIXTURE_ID}: ${path} is missing`);}};

/** The bytes of one mesh blob of the fixture, only when they hash to the name they are listed under. */
export function readXArmBlob(blobDir:string,name:string):Buffer{
 const sha=/^([0-9a-f]{64})\.stl$/.exec(name)?.[1],bytes=sha?read(join(blobDir,name)):undefined;
 if(!sha||!bytes||sha256(bytes)!==sha)throw fail('ARM_MODEL_MISMATCH',`${XARM_FIXTURE_ID}: blob ${name} does not hash to its name`);
 return bytes;
}
/** The committed fixture under `<workerRoot>/fixtures/xarm6-g2-v1`. Every file the manifest lists and every blob must hash to the manifest (and the blob directory hold nothing else), else ARM_MODEL_MISMATCH. */
export function readXArmFixture(workerRoot:string):XArmFixture{
 const dir=join(workerRoot,'fixtures',XARM_FIXTURE_ID),blobDir=join(dir,'blobs');
 const manifest=JSON.parse(read(join(dir,'manifest.json')).toString('utf8')) as {id:string;modelRevision:string;componentDigest:string;files:{path:string;sha256:string}[];blobs:{sha256:string}[]};
 if(manifest.id!==XARM_FIXTURE_ID)throw fail('ARM_MODEL_MISMATCH',`the manifest is for ${String(manifest.id)}`);
 const text=new Map<string,string>();
 for(const f of manifest.files){
  if(!/^[A-Za-z0-9._-]+$/.test(f.path))throw fail('ARM_MODEL_MISMATCH',`${XARM_FIXTURE_ID}: manifest path ${f.path}`);
  const b=read(join(dir,f.path));if(sha256(b)!==f.sha256)throw fail('ARM_MODEL_MISMATCH',`${XARM_FIXTURE_ID}: ${f.path} does not hash to its manifest`);text.set(f.path,b.toString('utf8'));
 }
 const listed=manifest.blobs.map(b=>`${b.sha256}.stl`).sort(),present=readdirSync(blobDir).sort();
 if(JSON.stringify(listed)!==JSON.stringify(present))throw fail('ARM_MODEL_MISMATCH',`${XARM_FIXTURE_ID}: the blob directory is not the manifest's blob list`);
 for(const name of listed)readXArmBlob(blobDir,name);
 const file=(p:string)=>text.get(p)??(()=>{throw fail('ARM_MODEL_MISMATCH',`${XARM_FIXTURE_ID}: ${p} is not in its manifest`);})();
 const componentText=file('component.json');
 if(hashJson(JSON.parse(componentText))!==manifest.componentDigest)throw fail('ARM_MODEL_MISMATCH',`${XARM_FIXTURE_ID}: component.json does not hash to componentDigest`);
 const programs=JSON.parse(file('programs.json')) as {programs:ArmProgramSet;table:WaypointRow[];digest:string};
 return {id:XARM_FIXTURE_ID,revision:manifest.modelRevision,componentText,physics:JSON.parse(file('physics.json')) as XArmPhysics,layout:JSON.parse(file('cell-layout.json')) as CellLayout,
  programs:programs.programs,waypoints:{table:programs.table,digest:programs.digest},blobDir};
}

/** The scene one MuJoCo run is built from. `homeRad` (default the fixture's `home`) is where the arm starts; `extraStatics` (arm base frame) and `padFriction` are fault options of the runtime.
 * Throws ARM_SCENE_UNAVAILABLE without an arm collision profile, ARM_MODEL_MISMATCH when the profile or fixture is not the xArm 6, ARM_CELL_LAYOUT_MISMATCH when the tray does not land on the coffee pickup point. */
export function buildArmCellScene(project:LabProjectV2,fixture:Pick<XArmFixture,'id'|'revision'|'physics'|'layout'|'programs'>,seed:number,
 options:{armId:string;propIds:readonly string[];homeRad?:readonly number[];extraStatics?:readonly ArmObstacle[];padFriction?:number}):ArmCellSceneV1{
 const profile=project.armCollisionProfile;
 if(!profile)throw fail('ARM_SCENE_UNAVAILABLE','the project has no armCollisionProfile (the arm base pose and fixture heights)');
 if(fixture.id!==XARM_FIXTURE_ID||fixture.revision!==XARM6_SI.revision||profile.modelId!==XARM6_SI.id||profile.modelRevision!==XARM6_SI.revision)
  throw fail('ARM_MODEL_MISMATCH',`profile ${profile.modelId}@${profile.modelRevision.slice(0,8)}, fixture ${fixture.id}@${fixture.revision.slice(0,8)}, table ${XARM6_SI.id}@${XARM6_SI.revision.slice(0,8)}`);
 const {layout,physics}=fixture,base=profile.baseInMap,pose=(p:CellPose)=>{const m=composePose(base,p);return {position:[...m.position],quaternionXyzw:[...m.quaternionXyzw]};};
 const at=(v:V3)=>[...composePose(base,{position:v,quaternionXyzw:[0,0,0,1]}).position];
 const tray=at(layout.tray.centerM),pickup=project.world.points.find(p=>p.kind==='coffee_pickup');
 if(!pickup||Math.hypot(tray[0]!-pickup.x,tray[1]!-pickup.y)>ARM_CELL_LAYOUT_TOL_M)
  throw fail('ARM_CELL_LAYOUT_MISMATCH',pickup?`the tray lands at (${tray[0]!.toFixed(3)}, ${tray[1]!.toFixed(3)}), the coffee pickup point is (${pickup.x}, ${pickup.y})`:'the project has no coffee_pickup point');
 const statics=fixtureStatics(declareArmScene(project,{},undefined,XARM6_SI).world,profile).concat((options.extraStatics??[]).map(o=>structuredClone(o)));
 const cup=layout.cup,scene=sealDocument({schemaVersion:1,sceneDigest:'',
  arm:{armId:options.armId,modelId:fixture.id,modelRevision:fixture.revision,baseInMap:{position:[...base.position],quaternionXyzw:[...base.quaternionXyzw]},homeRad:[...(options.homeRad??fixture.programs.waypoints.home!)]},
  statics,supports:[{id:'nozzle-stand',centerM:at(layout.nozzleStand.centerM),sizeM:[...layout.nozzleStand.sizeM]},{id:'tray',centerM:tray,sizeM:[...layout.tray.sizeM]}],
  props:options.propIds.map(propId=>({propId,kind:'cup',radiusM:cup.radiusM,heightM:cup.heightM,massKg:cup.emptyMassKg+cup.drinkMassKg,provenance:'assumed'})),
  graspFrames:{pick:pose(layout.grasp.pick),place:pose(layout.grasp.place)},
  allowedContacts:(['gripper','held_prop'] as const).flatMap(a=>(['nozzle-stand','tray'] as const).map(b=>({a,b}))),
  world3d:{padFriction:options.padFriction??physics.contact.padFriction[0]!,propFriction:physics.contact.propFriction[0]!,supportFriction:XARM_SUPPORT_FRICTION,provenance:'assumed'},
  engine:{id:'mujoco_3d',timestepMs:2,substeps:10},engineSeed:engineSeedOf(seed)} as unknown as ArmCellSceneV1,'sceneDigest');
 const checked=validateArmCellScene(scene);
 if(!checked.ok)throw new Error(`ARM_SCENE_INVALID: ${checked.issues.map(i=>`${i.path} ${i.code}`).join('; ')}`);
 return scene;
}
