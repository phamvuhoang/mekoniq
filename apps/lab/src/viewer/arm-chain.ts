// The articulated arm in the 3D twin: one cylinder per link and a sphere at each joint, in the arm base frame (ROS, z up); the caller places the group at the arm's base pose.
import * as THREE from 'three';
import {framePosition,type Mat4} from '../twin/arm/arm-frames';
const LINK_R=0.035,JOINT_R=0.05;
/** `frames` as armFrames returns them. `group.userData.tipM` is the last frame's origin (the flange). Geometry is shared by nothing: the caller disposes the group like the rest of the dynamic scene. */
export function armChain(frames:readonly Mat4[],material:THREE.Material):THREE.Group{
 const g=new THREE.Group(),pts=frames.map(f=>new THREE.Vector3(...framePosition(f)));
 pts.forEach(()=>g.add(new THREE.Mesh(new THREE.SphereGeometry(JOINT_R,12,8),material)));
 // links are rigid: the distance between two consecutive frame origins does not depend on the joint angles, so poseArmChain only moves them
 for(let i=0;i+1<pts.length;i++){const m=new THREE.Mesh(new THREE.CylinderGeometry(LINK_R,LINK_R,pts[i]!.distanceTo(pts[i+1]!),10),material);m.userData.link=i+1;g.add(m);}
 return poseArmChain(g,frames);
}
/** Move the chain's spheres and links to `frames` (same joint count) without building geometry. */
export function poseArmChain(g:THREE.Group,frames:readonly Mat4[]):THREE.Group{
 const pts=frames.map(f=>new THREE.Vector3(...framePosition(f))),n=pts.length,Y=new THREE.Vector3(0,1,0);
 pts.forEach((p,i)=>g.children[i]!.position.copy(p));
 for(let i=0;i+1<n;i++){
  const a=pts[i]!,m=g.children[n+i]!,d=pts[i+1]!.clone().sub(a),len=d.length();
  m.position.copy(a).addScaledVector(d,0.5);if(len>1e-9)m.quaternion.setFromUnitVectors(Y,d.normalize());
 }
 g.userData.tipM=pts.at(-1)!.toArray();
 return g;
}
