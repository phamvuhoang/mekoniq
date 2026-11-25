import * as THREE from 'three';
import type {CompiledScene,Pose} from '../shared/engineering';

/** Minimal view of a PhysicsSample (source engineering/physics-adapter.ts): only pose samples move the scene. */
export interface PhysicsSampleView {kind:string;entityId:string;frameId:string;values:Record<string,number>}
/**
 * The ONLY place ROS (X forward, Y left, Z up, right-handed) meets Three (Y up). Everything below is built in ROS coordinates and this rotation is applied once at the root:
 * ROS -> Three maps (x,y,z) to (x,z,-y), i.e. a rotation of -90 degrees about X.
 */
export const ROS_TO_THREE=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI/2);
export const rosToThree=(v:readonly [number,number,number]):[number,number,number]=>{const r=new THREE.Vector3(...v).applyQuaternion(ROS_TO_THREE);return [r.x,r.y,r.z];};
export const threeToRos=(v:readonly [number,number,number]):[number,number,number]=>{const r=new THREE.Vector3(...v).applyQuaternion(ROS_TO_THREE.clone().invert());return [r.x,r.y,r.z];};

const applyPose=(object:THREE.Object3D,pose:Pose)=>{object.position.set(...pose.xyzM);object.quaternion.set(...pose.quaternionXyzw);};
function geometryOf(g:CompiledScene['links'][number]['visual'][number]['geometry']):THREE.BufferGeometry|null {
  if (g.kind==='box') return new THREE.BoxGeometry(...g.sizeM);
  if (g.kind==='sphere') return new THREE.SphereGeometry(g.radiusM,24,16);
  if (g.kind==='cylinder') return new THREE.CylinderGeometry(g.radiusM,g.radiusM,g.lengthM,32).rotateX(Math.PI/2); // URDF/SDF cylinders run along local Z
  return null; // meshes arrive as blobs; until loaded the link shows a marker, never invented geometry
}
/**
 * Renders the compiler's own CompiledScene: its links, frames and shapes, with no primitives derived here. Link groups are named by the global link id so inspector selection,
 * telemetry and fixed-joint mapping keep one identity. Pose samples (sim time already resolved by the caller) override the zero-position frame of the matching link.
 */
export function renderEngineeringScene(scene:CompiledScene,state:PhysicsSampleView[]=[]):THREE.Group {
  const root=new THREE.Group();root.name='engineering-scene';root.quaternion.copy(ROS_TO_THREE);
  const frames=new Map(scene.frames.map(f=>[f.id,f])),groups=new Map<string,THREE.Group>();
  for (const link of scene.links) {
    const group=new THREE.Group();group.name=link.id;
    link.visual.forEach((shape,i)=>{
      const geometry=geometryOf(shape.geometry),holder=new THREE.Group();holder.name=`${link.id}:visual:${i}`;
      if (geometry) holder.add(new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:link.id.includes('wheel')||link.id.endsWith('/rim')?0x39414a:0x7d8da0})));
      else {holder.userData.missingMesh=shape.geometry.kind==='mesh'?shape.geometry.blobSha256:true;holder.add(new THREE.Mesh(new THREE.BoxGeometry(0.05,0.05,0.05),new THREE.MeshBasicMaterial({color:0xcc6600,wireframe:true})));}
      applyPose(holder,shape.pose);group.add(holder);
    });
    groups.set(link.id,group);
  }
  // the frame hierarchy is the scene graph: a link's group lives under its parent's group at the frame's local pose, so moving a parent moves what is mounted on it
  for (const [id,group] of groups) {
    const f=frames.get(id);if (f) applyPose(group,f.pose);
    const parentGroup=f?.parent?groups.get(f.parent):undefined;
    (parentGroup??root).add(group);
  }
  const depth=(id:string):number=>{let n=0,f=frames.get(id);while (f?.parent&&n<1000) {n+=1;f=frames.get(f.parent);}return n;};
  const rootInverse=new THREE.Matrix4();
  for (const s of state.filter(x=>x.kind==='pose'&&groups.has(x.frameId)).sort((a,b)=>depth(a.frameId)-depth(b.frameId))) {
    // sample poses are world (ROS) poses: convert to the local pose under the already-placed parent
    root.updateMatrixWorld(true);rootInverse.copy(root.matrixWorld).invert();
    const group=groups.get(s.frameId)!,parent=group.parent!;
    const worldPose=new THREE.Matrix4().compose(new THREE.Vector3(s.values.x!,s.values.y!,s.values.z!),new THREE.Quaternion(s.values.qx!,s.values.qy!,s.values.qz!,s.values.qw!),new THREE.Vector3(1,1,1));
    const parentInRos=parent===root?new THREE.Matrix4():rootInverse.clone().multiply(parent.matrixWorld);
    parentInRos.invert().multiply(worldPose).decompose(group.position,group.quaternion,group.scale);
  }
  root.userData.fixedJointMapping=scene.fixedJointMapping;root.userData.wheelBindings=scene.wheelBindings;
  return root;
}
