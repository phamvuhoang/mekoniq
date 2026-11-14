import {expect,test} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {validateWorldScene,validateWorldObservation,activeWorldProps} from '../../packages/lab-runtime/src/v2/simulation3d/world-scene';
import {documentDigest} from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
const fixture=()=>JSON.parse(readFileSync(resolve('robotics/simulation-mujoco/fixtures/coffee-delivery-world-v1/lab-world-scene.json'),'utf8'));
test('admits the declared one-world fixture and rejects stale identity or unknown fields',()=>{
 const scene=fixture();expect(()=>validateWorldScene(scene)).not.toThrow();
 const extra={...scene,url:'http://untrusted'};expect(()=>validateWorldScene(extra)).toThrow('WORLD_SCENE_INVALID');
 scene.inputs.projectDigest='a'.repeat(64);expect(()=>validateWorldScene(scene)).toThrow('WORLD_SCENE_DIGEST_MISMATCH');
});
test('rejects aliases between admitted arm, robot and cup identities',()=>{
 const scene=fixture();scene.propBindings[0].propId=scene.navigation.robots[0].robotId;scene.sceneDigest=documentDigest(scene,'sceneDigest');expect(()=>validateWorldScene(scene)).toThrow('WORLD_IDENTITY_INVALID');
});
test('active props are derived only from admitted source interactions, never an observation',()=>{
 const scene=fixture();const prop=scene.propBindings[0];
 expect(activeWorldProps(scene,[],0)).toEqual([]);
 const birth={eventId:'source-1',tick:1,kind:'birth' as const,...prop};
 expect(activeWorldProps(scene,[birth],0)).toEqual([]);expect(activeWorldProps(scene,[birth],1)).toEqual([prop.propId]);
 expect(()=>activeWorldProps(scene,[birth,{...birth,eventId:'source-2',tick:2}],2)).toThrow('WORLD_PROP_LIFECYCLE_INVALID');
 expect(()=>activeWorldProps(scene,[{...birth,cupId:'unadmitted'}],1)).toThrow('WORLD_PROP_LIFECYCLE_INVALID');
});
test('world ACK validation refuses missing arm, wrong robot, vector length and unadmitted active prop',()=>{
 const scene=fixture();const base={schemaVersion:1,worldStep:{workerPid:1,modelCount:1,physicsSubsteps:10,primingSubsteps:10,nq:35,nv:32,nbody:30,ngeom:27},runId:'r',bootId:'b',seq:'1',tick:0,simTimeNs:'0',sceneDigest:scene.sceneDigest,robots:[{robotId:scene.navigation.robots[0].robotId,poseDriveMap:[.35,.48,1.57],bodyVelocity:[0,0],collisionIds:[],scans:[],pose3d:{z:.09,roll:0,pitch:0},wheels:{leftRadS:0,rightRadS:0}}],arms:[{armId:scene.armCell.arm.armId,positionsRad:scene.armCell.arm.homeRad,velocitiesRadS:[0,0,0,0,0,0],collisionIds:[],gripper:{openingM:.0889,heldPropIds:[]}}],props:[]};
 expect(()=>validateWorldObservation(base,scene,[])).not.toThrow();
 for(const patch of [{arms:[]},{robots:[{...base.robots[0],robotId:'wrong'}]},{arms:[{...base.arms[0],positionsRad:[0]}]},{arms:[{...base.arms[0],positionsRad:[100,0,0,0,0,0]}]},{arms:[{...base.arms[0],gripper:{openingM:NaN,heldPropIds:[]}}]},{props:[{propId:scene.propBindings[0].propId,position:[0,0,0],quaternionXyzw:[0,0,0,1],restingOn:null}]}])expect(()=>validateWorldObservation({...base,...patch},scene,[])).toThrow('WORLD_OBSERVATION_INVALID');
});
