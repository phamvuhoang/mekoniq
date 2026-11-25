import {expect,test} from 'vitest';
import * as THREE from 'three';
import scene from '../../fixtures/engineering/scene.json';
import {renderEngineeringScene,rosToThree,threeToRos} from '../../src/viewer/engineering-scene';
import type {CompiledScene} from '../../src/shared/engineering';

const compiled=scene as unknown as CompiledScene;
const worldOf=(g:THREE.Group,name:string)=>{g.updateMatrixWorld(true);return g.getObjectByName(name)!.getWorldPosition(new THREE.Vector3());};

test('the ROS to Three adapter is a rotation that round-trips and maps Z-up to Y-up',()=>{
  for (const v of [[1,2,3],[-0.5,0,0.25],[0,0,0]] as const) expect(threeToRos(rosToThree(v)).map((x,i)=>Math.abs(x-v[i]!))).toEqual([0,0,0].map(()=>expect.any(Number)));
  const up=rosToThree([0,0,1]);expect(up[0]).toBeCloseTo(0);expect(up[1]).toBeCloseTo(1);expect(up[2]).toBeCloseTo(0);
  const left=rosToThree([0,1,0]);expect(left[2]).toBeCloseTo(-1);   // ROS left is Three -Z (right-handed, Y up)
  const back=threeToRos(rosToThree([1,2,3]));expect(back[0]).toBeCloseTo(1);expect(back[1]).toBeCloseTo(2);expect(back[2]).toBeCloseTo(3);
});
test('every compiled link is present under its global id at the compiler\'s pose',()=>{
  const group=renderEngineeringScene(compiled);
  for (const link of compiled.links) expect(group.getObjectByName(link.id),link.id).toBeDefined();
  const left=worldOf(group,'wheel-left/rim');                      // ROS (0, 0.225, 0) -> Three (0, 0, -0.225)
  expect([left.x,left.y,left.z].map(n=>Math.round(n*1e6)/1e6)).toEqual([0,0,-0.225]);
  const battery=worldOf(group,'battery/pack');                     // ROS (-0.1, 0, 0.125)
  expect(battery.x).toBeCloseTo(-0.1);expect(battery.y).toBeCloseTo(0.125);
});
test('shapes come from the scene: wheel rim is the compiler\'s cylinder along the axle, not a guess from the body',()=>{
  const group=renderEngineeringScene(compiled),rim=group.getObjectByName('wheel-left/rim:visual:0')!.children[0] as THREE.Mesh;
  const g=rim.geometry as THREE.CylinderGeometry;
  expect(g.parameters.radiusTop).toBeCloseTo(0.1);expect(g.parameters.height).toBeCloseTo(0.05);
  expect(group.userData.wheelBindings.map((b:{radiusM:number})=>b.radiusM)).toEqual([0.1,0.1]);
  expect(group.userData.fixedJointMapping.length).toBeGreaterThan(0);
});
test('pose samples move only the matching link and are the only thing that does',()=>{
  const base=renderEngineeringScene(compiled),moved=renderEngineeringScene(compiled,[{kind:'pose',entityId:'amr-1',frameId:'battery/pack',values:{x:1,y:0,z:0.5,qx:0,qy:0,qz:0,qw:1}},{kind:'contact',entityId:'amr-1',frameId:'tray/plate',values:{normalForceN:1,durationNs:1}}]);
  expect(worldOf(moved,'battery/pack').x).toBeCloseTo(1);
  expect(worldOf(moved,'tray/plate').toArray()).toEqual(worldOf(base,'tray/plate').toArray());
});

test('moving the chassis moves everything mounted on it', () => {
  const base=renderEngineeringScene(compiled),moved=renderEngineeringScene(compiled,[{kind:'pose',entityId:'amr-1',frameId:'chassis/base',values:{x:1,y:0,z:0,qx:0,qy:0,qz:0,qw:1}}]);
  for (const id of ['battery/pack','tray/plate','wheel-left/rim','wheel-right/hub']) {
    const a=worldOf(base,id),b=worldOf(moved,id);
    expect(b.x-a.x,id).toBeCloseTo(1);              // ROS +x is Three +x
    expect(b.y,id).toBeCloseTo(a.y);expect(b.z,id).toBeCloseTo(a.z);
  }
  expect(worldOf(moved,'battery/pack').x).toBeCloseTo(0.9);
});
test('a pose sample for a mounted part overrides only that part and what hangs under it', () => {
  const moved=renderEngineeringScene(compiled,[{kind:'pose',entityId:'amr-1',frameId:'wheel-left/hub',values:{x:0,y:0.225,z:1,qx:0,qy:0,qz:0,qw:1}}]);
  expect(worldOf(moved,'wheel-left/hub').toArray().map(n=>Math.round(n*1e6)/1e6)).toEqual([0,1,-0.225]);
  expect(worldOf(moved,'wheel-left/rim').y).toBeCloseTo(1);     // the rim hangs under the hub
  expect(worldOf(moved,'wheel-right/rim').y).toBeCloseTo(0);
});
