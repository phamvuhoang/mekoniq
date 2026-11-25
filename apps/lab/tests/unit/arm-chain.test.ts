// X07 (R1.1): the articulated arm of the 3D twin. The chain's tip at a golden pose is the runtime's flange; without joint telemetry nothing here draws an arm.
import {expect,test} from 'vitest';
import * as THREE from 'three';
import component from '../../fixtures/engineering/arm-ref-3d-v1/component.json' with {type:'json'};
import golden from '../../fixtures/engineering/arm-ref-3d-v1/fk-golden.json' with {type:'json'};
import {armFrames,framePosition,type ArmJointDef} from '../../src/twin/arm/arm-frames';
import {armChain} from '../../src/viewer/arm-chain';
const joints=component.joints as unknown as ArmJointDef[];
const HOME=[0,-0.6,1.2,0,0.6,0];

test('the last frame at every golden pose is the flange the runtime computed (≤ 1e-6 m)',()=>{
 for(const p of golden.poses){const f=armFrames(joints,p.q);expect(f).toHaveLength(7);framePosition(f.at(-1)!).forEach((v,k)=>expect(Math.abs(v-p.flangeM[k]!)).toBeLessThanOrEqual(1e-6));}
});
test('armChain at home: six link cylinders and seven joint spheres, and the last link ends on the flange',()=>{
 const flange=golden.poses.find(p=>p.q.every((v,i)=>v===HOME[i]))!.flangeM,g=armChain(armFrames(joints,HOME),new THREE.MeshBasicMaterial());
 expect(g.children.filter(c=>c.userData.link)).toHaveLength(6);expect(g.children.filter(c=>!c.userData.link)).toHaveLength(7);
 (g.userData.tipM as number[]).forEach((v,k)=>expect(Math.abs(v-flange[k]!)).toBeLessThanOrEqual(1e-6));
 const last=g.children.find(c=>c.userData.link===6) as THREE.Mesh,h=(last.geometry as THREE.CylinderGeometry).parameters.height;
 const end=new THREE.Vector3(0,h/2,0).applyQuaternion(last.quaternion).add(last.position);
 end.toArray().forEach((v,k)=>expect(Math.abs(v-flange[k]!)).toBeLessThanOrEqual(1e-6));
});
test('a joint moves the frames after it and none before it',()=>{
 const a=armFrames(joints,HOME),b=armFrames(joints,[...HOME.slice(0,2),HOME[2]!+0.3,...HOME.slice(3)]);
 expect(b[1]).toEqual(a[1]);expect(b[2]).toEqual(a[2]);expect(framePosition(b[3]!)).toEqual(framePosition(a[3]!)); // J3's own origin does not move with J3
 expect(framePosition(b[6]!)).not.toEqual(framePosition(a[6]!));
});
