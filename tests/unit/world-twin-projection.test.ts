import {expect,test} from 'vitest';
import {projectSamples} from '../../packages/lab-runtime/src/v2/twin-projection';
test('world telemetry names actual physics and retains observed pose with unknown source custody',()=>{
 const robot={id:'amr-1',pose:{x:9,y:9,yawRad:0},goals:[],bootId:'old',stale:false,moving:false,hold:null} as never;
 const world={tick:10,bootId:'world-boot',sceneDigest:'1'.repeat(64),robots:[{robotId:'amr-1',poseDriveMap:[.35,.48,1.57],bodyVelocity:[.02,0],pose3d:{z:.09,roll:0,pitch:0}}],props:[{propId:'cup-1',position:[.35,.35,.57],quaternionXyzw:[0,0,0,1],restingOn:'amr-1/tray-1'}],arms:[{gripper:{heldPropIds:[]}}]} as never;
 const out=projectSamples({runId:'run',seq:'1',simTimeNs:'200000000',nowMs:0,robots:[robot],world},'20');
 expect(out[0]).toMatchObject({origin:'physics_sim',providerId:'mujoco_3d',bootId:'world-boot',observed:{xM:.35,yM:.48,yawRad:1.57}});
 expect(out.find(x=>x.entityId==='cup-1')).toMatchObject({origin:'physics_sim',providerId:'mujoco_3d',observed:{positionM:[.35,.35,.57],restingOn:'amr-1/tray-1',held:false}});
 expect(out.find(x=>x.entityId==='cup-1')?.observed).toMatchObject({ownerKind:'unknown',ownerId:null});
 expect(projectSamples({runId:'run',seq:'1',simTimeNs:'200000000',nowMs:0,robots:[robot],world,worldStale:true},'20').every(s=>s.quality==='stale')).toBe(true);
});
