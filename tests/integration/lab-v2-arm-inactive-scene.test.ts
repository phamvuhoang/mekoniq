import {afterEach,expect,test} from 'vitest';
import {cleanupRuns,coffeeProject,executeCoffee} from '../support/lab-v2';
afterEach(cleanupRuns);
const twoRobots=(parked={x:0.8,y:3.2})=>{
 const p=structuredClone(coffeeProject());p.entities.push({...structuredClone(p.entities[0]!),id:'amr-2'});
 p.world.points.push({id:'parking-2',name:'Parking 2',kind:'parking',...parked});return p;
};
test('ARM03 BV01 includes an unused project AMR as a declared static parked obstacle',async()=>{
 const p=twoRobots(),r=await executeCoffee('BV01',{seed:42,project:p});
 expect(r.outcome.status).toBe('completed');expect(r.entities.map(e=>e.id)).toEqual(['amr-1']);expect(r.coverage.armSceneCollision).toBe(true);
 expect(r.manifest.armCollisionScene!.robotGeometry).toContainEqual(expect.objectContaining({id:'amr-2',motion:'static_parked',parkingId:'parking-2',parkedPose:{x:0.8,y:3.2,yawRad:0}}));
 const collision=r.coffee!.armTrace.collision!;
 expect(collision.scene!.robotPoses).toContainEqual({id:'amr-2',from:[0.8,3.2],to:[0.8,3.2]});
 for(const world of Object.values(collision.evidence!.worlds))expect(world.some(o=>o.id==='robot:amr-2')).toBe(true);
});
test('ARM03 an unused AMR parked under the arm remains an obstruction and retains cell custody',async()=>{
 const p=twoRobots({x:2.794821,y:0.941325});p.armCollisionProfile.robotHeightM=2;
 const r=await executeCoffee('BV01',{seed:42,project:p});
 expect(r.outcome.status).toBe('needs_attention');expect(r.outcome.served).toBe('0');
 expect(r.coffee!.armTrace.stop?.reason).toBe('ARM_COLLISION');
 expect(r.coffee!.armTrace.collision!.evidence!.firstFailure!.result.pair).toContain('robot:amr-2');
 expect(r.coffee!.armTrace.collision!.evidence!.firstFailure!.scene!.robotPoses).toContainEqual({id:'amr-2',from:[2.794821,0.941325],to:[2.794821,0.941325]});
 expect(r.coffee!.cups[0]).toMatchObject({ownerKind:'cell'});expect(r.coffee!.cups[0]!.movements).toHaveLength(0);
});
test('ARM03 an unused project AMR without a parking binding reports unknown pose and blocks clearance',async()=>{
 const p=twoRobots();p.world.points=p.world.points.filter(x=>x.id!=='parking-2');
 const r=await executeCoffee('BV01',{seed:42,project:p});
 expect(r.coverage.armSceneCollision).toBe(false);expect(r.coffee!.armTrace.collision!.scene).toMatchObject({available:false,reason:'ROBOT_POSE_UNKNOWN'});
 expect(r.coffee!.armTrace.stop?.reason).toBe('ARM_SCENE_GEOMETRY_UNAVAILABLE');
});
