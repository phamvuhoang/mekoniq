// Where a 3D plant's base sits in the three.js scene (y up; ROS x,y,z-up -> x,z,-y): flat on the floor as before when the sample carries no 3D pose,
// raised and tilted by the plant's z, roll and pitch when it does.
import {expect,test} from 'vitest';
import * as THREE from 'three';
import {bodyPlacement} from '../../src/twin/pose3d';

const up=(q:[number,number,number,number])=>new THREE.Vector3(0,1,0).applyQuaternion(new THREE.Quaternion(...q));
test('no 3D pose: the legacy placement, flat on the floor with the body centred at its height',()=>{
 expect(bodyPlacement({x:2,y:1.5,yawRad:0.7},0.225,0.09)).toEqual({position:[2,0.225,-1.5],quaternion:[0,0,0,1]});
});
test('standing level at the base height gives the same centre as the legacy placement; the yaw turns it about the vertical',()=>{
 const p=bodyPlacement({x:2,y:1.5,yawRad:Math.PI/2,z:0.09,rollRad:0,pitchRad:0},0.225,0.09);
 expect(p.position[0]).toBeCloseTo(2,12);expect(p.position[1]).toBeCloseTo(0.225,12);expect(p.position[2]).toBeCloseTo(-1.5,12);
 const u=up(p.quaternion);expect([u.x,u.y,u.z].map(v=>Math.abs(v)<1e-12?0:v)).toEqual([0,1,0]);
 // yaw +90 degrees about ROS +z turns the ROS x axis into ROS y, which is three -z
 const forward=new THREE.Vector3(1,0,0).applyQuaternion(new THREE.Quaternion(...p.quaternion));
 expect(forward.x).toBeCloseTo(0,12);expect(forward.z).toBeCloseTo(-1,12);
});
test('a base that rose by 3 cm lifts the body by 3 cm; the z of the base is the plant\'s, not a guess',()=>{
 expect(bodyPlacement({x:0,y:0,yawRad:0,z:0.12,rollRad:0,pitchRad:0},0.225,0.09).position[1]).toBeCloseTo(0.255,12);
});
test('pitch tips the body forward and moves its centre with it',()=>{
 const pitch=0.2,p=bodyPlacement({x:1,y:1,yawRad:0,z:0.09,rollRad:0,pitchRad:pitch},0.225,0.09),u=up(p.quaternion);
 // ROS: the body up axis (0,0,1) becomes (sin p, 0, cos p); in three that is (sin p, cos p, 0)
 expect(u.x).toBeCloseTo(Math.sin(pitch),12);expect(u.y).toBeCloseTo(Math.cos(pitch),12);expect(u.z).toBeCloseTo(0,12);
 const c=0.225-0.09;// centre is c above the base origin along the body up axis
 expect(p.position[0]).toBeCloseTo(1+c*Math.sin(pitch),12);expect(p.position[1]).toBeCloseTo(0.09+c*Math.cos(pitch),12);
});
test('a non-finite 3D pose falls back to the flat placement instead of putting a NaN into the scene',()=>{
 expect(bodyPlacement({x:2,y:1.5,yawRad:0,z:Number.NaN,rollRad:0,pitchRad:0},0.225,0.09)).toEqual({position:[2,0.225,-1.5],quaternion:[0,0,0,1]});
});
