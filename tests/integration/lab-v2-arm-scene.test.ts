import {afterEach,expect,test} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import {act,cleanupRuns,coffeeProject,executeCoffee,openCoffee,stepUntil} from '../support/lab-v2';
import {PUMA560_SI} from '../../packages/lab-runtime/src/v2/models/arm-kinematics';
import {declareArmScene,materializeArmScene} from '../../packages/lab-runtime/src/v2/models/arm-scene';
import type {LabProjectV2} from '../../packages/lab-runtime/src/v2/contracts';
import {MockArmPlant,ARM_COLLISION_TRACE_LIMIT} from '../../packages/cell-adapters/src/mock-arm';
import type {CellCommand} from '../../packages/cell-adapters/src/contract';
afterEach(cleanupRuns);
const profile=()=>({schemaVersion:1,id:'coffee-arm-scene',revision:1,units:'SI',provenance:'illustrative',reference:'Illustrative map alignment, not calibrated',modelId:PUMA560_SI.id,modelRevision:PUMA560_SI.revision,
 baseInMap:{position:[2.794821,0.941325,1.2],quaternionXyzw:[0,0,0,1]},fixtureHeightM:1,robotHeightM:0.7});
const project=()=>({...structuredClone(coffeeProject()),armCollisionProfile:profile()});
test('ARM03 project fixture stops real arm motion and leaves the cup at the nozzle',async()=>{
 const p=project();p.armCollisionProfile.fixtureHeightM=2;
 p.world.obstacles.push({id:'base-blocker',x:2.78,y:0.93,width:0.03,height:0.03} as never);
 const run=await openCoffee('BV01',{seed:42,project:p});
 try{await run.start();await stepUntil(run);const r=await run.report();
  expect(r.coffee!.armTrace.stop?.reason).toBe('ARM_COLLISION');
  expect(r.coffee!.armTrace.collision!.last!.pair).toContain('fixture:base-blocker');
  expect(r.coffee!.armTrace.samples).toEqual([]);expect(r.coffee!.cups[0]).toMatchObject({ownerKind:'cell'});
  expect(r.coffee!.cups[0]!.movements).toHaveLength(0);expect(r.outcome.served).toBe('0');
 }finally{await run.close();}
});
test('ARM03 the current AMR pose and compiled radius block the arm independently of project fixtures',async()=>{
 const p=project();p.armCollisionProfile.robotHeightM=2;
 const parking=p.world.points.find(x=>x.kind==='parking')!;parking.x=2.794821;parking.y=0.941325;
 const run=await openCoffee('BV01',{seed:42,project:p});
 try{await run.start();await stepUntil(run);const r=await run.report();
  expect(r.coffee!.armTrace.stop?.reason).toBe('ARM_COLLISION');
  expect(r.coffee!.armTrace.collision!.last!.pair).toContain('robot:amr-1');
  expect(r.coffee!.cups[0]).toMatchObject({ownerKind:'cell'});expect(r.outcome.served).toBe('0');
 }finally{await run.close();}
});
test('ARM03 nominal BV01 records the declared scene and hashes without claiming physical validation',async()=>{
 const p=project(),r=await executeCoffee('BV01',{seed:42,project:p});
 expect(r.outcome.status).toBe('completed');expect(r.coverage.armSceneCollision).toBe(true);
 expect(r.coffee!.armTrace.collision).toMatchObject({scene:{available:true,scope:'self_scene_robot',profileRevision:1}});
 expect(r.manifest).toMatchObject({armCollisionScene:{profile:p.armCollisionProfile,world:p.world,hash:expect.stringMatching(/^[a-f0-9]{64}$/)}});
 expect(r.manifest.calibration.status).toBe('not_calibrated');
 expect(r.coverage.armCollisionTraceComplete).toBe(true);
 const evidence=r.coffee!.armTrace.collision!.evidence!;
 expect(evidence.intervals.some(i=>i.heldCupId==='cup-1')).toBe(true);expect(evidence.droppedIntervals).toBe(0);
 for(const i of evidence.intervals)expect(evidence.worlds[i.worldRevision]).toBeDefined();
});
const LAB_COFFEE_FIXTURE='../lab/fixtures/twins/coffee-cell-v2.json';
test.skipIf(process.env.LAB_V2_REQUIRE_LAB_FIXTURES!=='1'&&!existsSync(LAB_COFFEE_FIXTURE))('ARM03 the shipped Lab coffee counter fixture completes nominal BV01',async()=>{
 const fixture=JSON.parse(readFileSync(LAB_COFFEE_FIXTURE,'utf8'));
 const r=await executeCoffee('BV01',{seed:42,project:fixture.project,assets:fixture.assets});
 expect(r.outcome.status).toBe('completed');expect(r.coverage.armSceneCollision).toBe(true);expect(r.coverage.armCollisionTraceComplete).toBe(true);
 expect(r.coffee!.armTrace.collision!.evidence!.firstFailure).toBeUndefined();
});
test('ARM03 a legacy project reports self/injected-only coverage',async()=>{
 const p=coffeeProject();delete (p as {armCollisionProfile?:unknown}).armCollisionProfile;
 const r=await executeCoffee('BV01',{seed:42,project:p});expect(r.outcome.status).toBe('completed');
 expect(r.coverage.armCollisionChecker).toBe(true);expect(r.coverage.armSceneCollision).toBe(false);
 expect(r.coffee!.armTrace.collision).toMatchObject({scene:{available:false,scope:'self_injected_only',reason:'ARM_COLLISION_PROFILE_MISSING'}});
});
test('ARM03 unknown AMR geometry cannot run scene clearance or transfer a cup',async()=>{
 const p=project();p.entities[0]!.assetRef.contentHash='a'.repeat(64);
 const run=await openCoffee('BV01',{seed:42,project:p,assets:[]});
 try{await run.start();await stepUntil(run);const r=await run.report();
  expect(r.coverage.armSceneCollision).toBe(false);expect(r.coffee!.armTrace.stop?.reason).toBe('ARM_SCENE_GEOMETRY_UNAVAILABLE');
  expect(r.coffee!.armTrace.collision).toMatchObject({scene:{available:false,reason:'ROBOT_GEOMETRY_UNKNOWN'}});
  expect(r.coffee!.cups[0]).toMatchObject({ownerKind:'cell'});
 }finally{await run.close();}
});
test('ARM03 scene refresh never erases a manually injected collision obstacle',async()=>{
 const run=await openCoffee('BV01',{seed:42,project:project()});
 try{await run.start();await stepUntil(run,v=>v.coffee?.jobs.some(j=>j.status==='transferring')??false,5);
  await act(run,'injectFault',{faultId:'arm-collision'});await act(run,'step',{ticks:5});const r=await run.report();
  expect(r.coffee!.armTrace.collision!.last!.pair).toContainEqual(expect.stringMatching(/^injected-fixture-/));
  expect(r.coffee!.armTrace.collision).toMatchObject({scene:{available:true}});
 }finally{await run.close();}
});
test('ARM03 full inverse base transform encloses all eight fixture corners',()=>{
 const p=project();p.armCollisionProfile.baseInMap={position:[1,2,3],quaternionXyzw:[Math.SQRT1_2,0,0,Math.SQRT1_2]};
 p.world.obstacles.push({id:'rotated',x:2,y:3,width:1,height:2} as never);
 const d=declareArmScene(p as unknown as LabProjectV2,{'amr-1':0.4});
 const scene=materializeArmScene(d,[{id:'amr-1',radiusM:0.4,pose:{x:5,y:3,yawRad:0}}],1);
 const box=scene.world.find(o=>o.id==='fixture:rotated')!;expect(box.kind).toBe('box');
 if(box.kind!=='box')throw new Error('BOX_EXPECTED');
 for(const [i,n] of [1,-3,-3].entries())expect(box.min[i]).toBeCloseTo(n,12);
 for(const [i,n] of [2,-2,-1].entries())expect(box.max[i]).toBeCloseTo(n,12);
});
test('ARM03 robot refresh uses compiled radius and sweeps previous/current map positions',()=>{
 const p=project(),d=declareArmScene(p as unknown as LabProjectV2,{'amr-1':0.4});
 const previous=[{id:'amr-1',radiusM:0.4,pose:{x:1,y:1,yawRad:0}}],current=[{id:'amr-1',radiusM:0.4,pose:{x:2,y:2,yawRad:1}}];
 const s=materializeArmScene(d,current,2,previous),box=s.world.find(o=>o.id==='robot:amr-1')!;
 expect(s.robotPoses).toEqual([{id:'amr-1',from:[1,1],to:[2,2]}]);
 if(box.kind!=='box')throw new Error('BOX_EXPECTED');
 expect(box.min[0]).toBeCloseTo(0.6-p.armCollisionProfile.baseInMap.position[0]!,12);expect(box.max[0]).toBeCloseTo(2.4-p.armCollisionProfile.baseInMap.position[0]!,12);
 expect(materializeArmScene(d,[],3)).toMatchObject({available:false,reason:'ROBOT_GEOMETRY_UNKNOWN'});
});
test('ARM03 a project fixture touching only the held cup blocks motion and retains attachment',()=>{
 const p=project();p.armCollisionProfile.fixtureHeightM=1;
 // Pick TCP is map (2.8563,1.1457,.9827); the attached cup extends toward (2.7556,1.0907,.9746).
 p.world.obstacles.push({id:'cup-only',x:2.750,y:1.086,width:0.01,height:0.01} as never);
 const scene=materializeArmScene(declareArmScene(p as unknown as LabProjectV2,{'amr-1':0.4}),[{id:'amr-1',radiusM:0.4,pose:{x:0.8,y:0.8,yawRad:0}}],1);
 const state=MockArmPlant.initial('arm');state.q=[0.5,-0.3,0.9,0,0.9,0];state.holding='held';state.gripper='closed';const start=[...state.q];
 const plant=new MockArmPlant(state,()=>0,()=> 'boot',{take:()=>null,put:()=>{throw new Error('must retain cup');}},()=>({robotId:'amr-1',slot:1}));
 plant.setCollisionScene(scene);
 const c:CellCommand={runId:'r',commandId:'place',deviceId:'arm',controlEpoch:1,expiresAt:'2026-11-06T00:00:00Z',recipeRevision:1,programRef:{id:'cup-place',hash:'a'.repeat(64)},payloadHash:'a'.repeat(64),capability:'start_job',payload:{jobId:'j'}};
 expect(plant.execute(c).accepted).toBe(true);plant.advance();
 expect(state.collision!.last!.pair).toEqual(['held-cup','fixture:cup-only']);expect(state.q).toEqual(start);expect(state.holding).toBe('held');expect(state.gripper).toBe('closed');
 expect(plant.reconcile('place').status).toBe('unknown');
});
test('ARM03 a robot entering a stationary held-cup arm is checked between programs',()=>{
 const p=project();p.armCollisionProfile.robotHeightM=2;
 const d=declareArmScene(p as unknown as LabProjectV2,{'amr-1':0.4}),far=[{id:'amr-1',radiusM:0.4,pose:{x:0.8,y:0.8,yawRad:0}}],near=[{id:'amr-1',radiusM:0.4,pose:{x:2.8,y:1,yawRad:0}}];
 const state=MockArmPlant.initial('arm');state.holding='held';state.gripper='closed';
 const plant=new MockArmPlant(state,()=>0,()=> 'boot',{take:()=>null,put:()=>{throw new Error('must retain cup');}},()=>null);
 plant.setCollisionScene(materializeArmScene(d,far,1));plant.advance();expect(state.stop).toBeUndefined();
 plant.setCollisionScene(materializeArmScene(d,near,2,far));plant.advance();
 expect(state.stop?.reason).toBe('ARM_COLLISION');expect(state.collision!.last!.pair).toContain('robot:amr-1');expect(state.holding).toBe('held');
});
test('ARM03 the triggering geometry, attachment and tick survive a later cleared scene',()=>{
 const p=project();p.armCollisionProfile.robotHeightM=2;
 const d=declareArmScene(p as unknown as LabProjectV2,{'amr-1':0.4}),near=[{id:'amr-1',radiusM:0.4,pose:{x:2.8,y:1,yawRad:0}}],far=[{id:'amr-1',radiusM:0.4,pose:{x:0.8,y:0.8,yawRad:0}}];
 const state=MockArmPlant.initial('arm');state.holding='cup-retained';state.gripper='closed';
 const plant=new MockArmPlant(state,()=>0,()=> 'boot',{take:()=>null,put:()=>{}},()=>null);
 plant.setCollisionScene(materializeArmScene(d,near,1));plant.advance();
 const first=structuredClone(state.collision!.evidence?.firstFailure);
 expect(first).toMatchObject({tick:1,heldCupId:'cup-retained',result:{ok:false,pair:expect.arrayContaining(['robot:amr-1'])},scene:{tick:1}});
 plant.setCollisionWorld([]);plant.setCollisionScene(materializeArmScene(d,far,2));plant.advance();
 expect(state.collision!.evidence!.firstFailure).toEqual(first);expect(state.collision!.scene!.tick).toBe(2);
 expect(state.collision!.evidence!.worlds[first!.worldRevision]).toEqual(first!.world);
});
test('ARM03 bounded collision evidence reports dropped intervals and still retains the first failure',()=>{
 const p=project(),d=declareArmScene(p as unknown as LabProjectV2,{'amr-1':0.4}),state=MockArmPlant.initial('arm');
 const plant=new MockArmPlant(state,()=>0,()=> 'boot',{take:()=>null,put:()=>{}},()=>null);
 for(let i=0;i<ARM_COLLISION_TRACE_LIMIT+2;i++){
  plant.setCollisionScene(materializeArmScene(d,[{id:'amr-1',radiusM:0.4,pose:{x:0.8+i*0.00001,y:0.8,yawRad:0}}],i+1));plant.advance();
 }
 expect(state.collision!.evidence!.intervals).toHaveLength(ARM_COLLISION_TRACE_LIMIT);expect(state.collision!.evidence!.droppedIntervals).toBe(2);
 plant.fault('arm-collision');plant.advance();expect(state.collision!.evidence!.firstFailure!.result.pair).toContainEqual(expect.stringMatching(/^injected-fixture-/));
 expect(state.collision!.evidence!.droppedIntervals).toBe(3);
});
test.each(['quaternion','units','model','bounds'] as const)('ARM03 invalid declared %s cannot claim scene coverage',async kind=>{
 const p=project();
 if(kind==='quaternion')p.armCollisionProfile.baseInMap.quaternionXyzw=[0,0,0,0.5];
 if(kind==='units')p.armCollisionProfile.units='mm';
 if(kind==='model')p.armCollisionProfile.modelRevision='0'.repeat(64);
 if(kind==='bounds')p.armCollisionProfile.baseInMap.position=[1001,0,0];
 await expect(openCoffee('BV01',{seed:42,project:p})).rejects.toThrow(/INVALID_PROJECT|QUATERNION_NOT_NORMALIZED|ARM_COLLISION_MODEL_MISMATCH/);
});
