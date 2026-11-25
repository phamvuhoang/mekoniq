// D51: an arm drawn from the visual meshes of its engineering component (the xArm 6 fixture xarm6-g2-v1). A picture of the arm, not a measurement and not its
// collision geometry. The arm links sit at the joint frames the caller computes (armFrames); the gripper links hang from the last arm link by their joint
// origins, and the fingers turn with the measured opening only. No knowledge of the workspace or the runtime: blobs come through `blob`.
import * as THREE from 'three';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import {sha256Hex} from '../twin/hash';
import type {ArmJointDef,Mat4} from '../twin/arm/arm-frames';
type Pose={xyzM:number[];quaternionXyzw:number[]};
interface Component {links:{id:string;visual?:{geometry:{kind:string;blobSha256?:string;scale?:number[]};pose:Pose}[]}[];joints:{id:string;kind:string;parent:string;child:string;axis:number[];origin:Pose}[]}
interface Physics {gripper:{driveJoint:string;closedRad:number;openingMaxM:number;mimic:{joint:string;multiplier:number}[]}}
/** `links`: every link object (arm links first, root to flange, then the gripper's); `fingers`: the drive joint and its mimic joints, as pivots. */
export interface ArmMeshSet {group:THREE.Group;links:THREE.Object3D[];fingers:{object:THREE.Object3D;multiplier:number}[]}
const gripperJoints=(p:Physics)=>new Map([[p.gripper.driveJoint,1],...p.gripper.mimic.map(m=>[m.joint,m.multiplier] as [string,number])]);
/** The arm's own joints (revolute, not the gripper's), root to flange: what armFrames poses. */
export function armJoints(component:unknown,physics:unknown):(ArmJointDef&{id:string})[]{
 const c=component as Component,g=gripperJoints(physics as Physics);return c.joints.filter(j=>j.kind==='revolute'&&!g.has(j.id));
}
/** For display only: the drive joint's angle from the measured opening between the pads, linear from open (0 rad at openingMaxM) to closedRad (at 0 m).
 * The real linkage is not linear; this only shows the gripper opening and closing. Unknown (null): open, never a guess. */
export function gripperDriveRad(physics:unknown,openingM:number|null):number{
 const g=(physics as Physics).gripper;if(openingM===null||!Number.isFinite(openingM))return 0;
 return g.closedRad*(1-Math.min(1,Math.max(0,openingM/g.openingMaxM)));
}
/** SHA-256 by crypto.subtle (native, off the main thread's long tasks); the synchronous pure-JS hash only where subtle is missing (an insecure context). */
const hex=async(b:ArrayBuffer)=>globalThis.crypto?.subtle?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join(''):sha256Hex(new Uint8Array(b));
const q=(p:number[])=>new THREE.Quaternion(p[0],p[1],p[2],p[3]);
/** Why a blob could not be used: it could not be fetched (`fetch`: worth another try), its content's sha256 is not its name (`hash`), or it does not parse (`parse`). */
export type MeshFailure='fetch'|'hash'|'parse';
/** Fetches every visual blob once, checks that its content's sha256 is its name and parses it. Throws `ARM_MESH_UNAVAILABLE:<sha256>` (its `reason` a MeshFailure)
 * for a blob that cannot be fetched, differs from its name or does not parse. */
export async function loadArmMeshes(component:unknown,physics:unknown,blob:(sha256:string)=>Promise<ArrayBuffer>,material:THREE.Material):Promise<ArmMeshSet>{
 const c=component as Component,p=physics as Physics,stl=new STLLoader(),shas=[...new Set(c.links.flatMap(l=>(l.visual??[]).map(v=>v.geometry.blobSha256!).filter(Boolean)))];
 const geo=new Map(await Promise.all(shas.map(async sha=>{
  const fail=(reason:MeshFailure)=>Object.assign(new Error(`ARM_MESH_UNAVAILABLE:${sha}`),{reason});
  let b:ArrayBuffer;try{b=await blob(sha);}catch{throw fail('fetch');}
  if(await hex(b)!==sha)throw fail('hash');
  try{const g=stl.parse(b);g.computeVertexNormals();return [sha,g] as const;}catch{throw fail('parse');}
 })));
 const obj=new Map(c.links.map(l=>{const o=new THREE.Object3D();o.name=`link:${l.id}`;
  for(const v of l.visual??[])if(v.geometry.kind==='mesh'&&v.geometry.blobSha256){const m=new THREE.Mesh(geo.get(v.geometry.blobSha256)!,material);m.position.fromArray(v.pose.xyzM);m.quaternion.copy(q(v.pose.quaternionXyzw));m.scale.fromArray(v.geometry.scale??[1,1,1]);m.userData.shared=true;o.add(m);}
  return [l.id,o];}));
 const arm=new Set(armJoints(c,p).map(j=>j.id)),root=c.links.find(l=>!c.joints.some(j=>j.child===l.id))!.id,group=new THREE.Group(),pivots=new Map<string,THREE.Object3D>();
 // arm links are placed by the caller's frames, directly in the group; every other joint (fixed, gripper) is a pivot under its parent link
 const armLinks=[root,...c.joints.filter(j=>arm.has(j.id)).map(j=>j.child)];for(const id of armLinks)group.add(obj.get(id)!);
 for(const j of c.joints.filter(j=>!arm.has(j.id))){
  const pivot=new THREE.Object3D();pivot.name=`joint:${j.id}`;pivot.position.fromArray(j.origin.xyzM);pivot.quaternion.copy(q(j.origin.quaternionXyzw));
  pivot.userData.q0=pivot.quaternion.clone();pivot.userData.axis=new THREE.Vector3().fromArray(j.axis).normalize();
  obj.get(j.parent)!.add(pivot);pivot.add(obj.get(j.child)!);pivots.set(j.id,pivot);
 }
 const fingers=[...gripperJoints(p)].map(([id,multiplier])=>({object:pivots.get(id)!,multiplier}));
 group.userData.physics=p;group.userData.armLinks=armLinks.length;
 return {group,links:[...armLinks.map(id=>obj.get(id)!),...c.links.filter(l=>!armLinks.includes(l.id)).map(l=>obj.get(l.id)!)],fingers};
}
/** A copy that shares the parsed geometry (never re-fetched or re-parsed) with its own material. */
export function cloneArmMeshes(set:ArmMeshSet,material:THREE.Material):ArmMeshSet{
 const group=set.group.clone(true),by=(o:THREE.Object3D)=>group.getObjectByName(o.name)!;
 group.traverse(o=>{if((o as THREE.Mesh).isMesh)(o as THREE.Mesh).material=material;});
 set.group.traverse(o=>{if(o.userData.q0)by(o).userData={...o.userData};});// clone() copies userData through JSON: the pivots keep their quaternion and axis objects
 return {group,links:set.links.map(by),fingers:set.fingers.map(f=>({object:by(f.object),multiplier:f.multiplier}))};
}
const m4=new THREE.Matrix4(),turn=new THREE.Quaternion();
/** Arm links at `frames` (armFrames of the arm joints: root, then one per joint), fingers at the drive angle for `gripperOpeningM` (gripperDriveRad). */
export function poseArmMeshes(set:ArmMeshSet,frames:readonly Mat4[],gripperOpeningM:number|null):void{
 const n=set.group.userData.armLinks as number;
 for(let i=0;i<n&&i<frames.length;i++){m4.set(...(frames[i] as [number,number,number,number,number,number,number,number,number,number,number,number,number,number,number,number]));m4.decompose(set.links[i]!.position,set.links[i]!.quaternion,set.links[i]!.scale);}
 const drive=gripperDriveRad(set.group.userData.physics,gripperOpeningM);
 for(const f of set.fingers)f.object.quaternion.copy(f.object.userData.q0 as THREE.Quaternion).multiply(turn.setFromAxisAngle(f.object.userData.axis as THREE.Vector3,f.multiplier*drive));
 set.group.userData.driveRad=drive;
}
/** The last arm link's origin (the flange) in the group's frame (the arm base). */
export const meshFlange=(set:ArmMeshSet):[number,number,number]=>set.links[(set.group.userData.armLinks as number)-1]!.position.toArray() as [number,number,number];
