import {expect,test,vi} from 'vitest';
import {coffeeReplay} from '../support/coffee-replay';
import {openReplayV2} from '../../src/reports/replay';
import type {ArmCollisionScene,ArmCollisionView} from '../../src/scenarios/controls';
import {validateProjectV2} from '../../src/project/schema';
import coffeeFixture from '../../fixtures/twins/coffee-cell-v2.json';
vi.stubGlobal('localStorage',{getItem:()=> 'en',setItem:()=>{}});
const {armRows}=await import('../../src/twin/coffee-cell');
function fixture(){
 const {report,view}=coffeeReplay(),world=[{id:'fixture:blocked',kind:'sphere',center:[0,0,0],radiusM:0.1}],future=[{id:'future-world'}];
 const scene:ArmCollisionScene={available:true,scope:'self_scene_robot',revision:'scene-1',profileRevision:1,tick:20,world};
 const result={ok:false,engine:'capsule-sweep-v1',geometryRevision:'geometry-1',modelRevision:'model-1',pair:['held-cup','fixture:blocked'] as [string,string]};
 const collision:ArmCollisionView={world:future,checks:32,last:{...result,ok:true,pair:undefined},scene:{...scene,tick:100,world:future},evidence:{intervals:[
  {firstTick:1,lastTick:10,fromQ:[0],toQ:[0],heldCupId:null,worldRevision:'empty',sceneRevision:'scene-1',result:{...result,ok:true,pair:undefined}},
  {firstTick:20,lastTick:20,fromQ:[0],toQ:[0.1],heldCupId:'cup-1',worldRevision:'blocked',sceneRevision:'scene-1',result},
  {firstTick:80,lastTick:100,fromQ:[0.1],toQ:[0.1],heldCupId:'cup-1',worldRevision:'future',sceneRevision:'scene-1',result:{...result,ok:true,pair:undefined}},
 ],worlds:{empty:[],blocked:world,future},droppedIntervals:0,firstFailure:{tick:20,fromQ:[0],toQ:[0.1],heldCupId:'cup-1',worldRevision:'blocked',world,scene,result}}};
 report.coffee!.armTrace.collision=collision;report.coverage={armCollisionChecker:true,armSceneCollision:true,armCollisionTraceComplete:true};
 return {report,view,collision,project:(tick:number)=>openReplayV2(report).project(view,tick).report};
}
test('collision replay exposes the retained trigger at its tick despite a newer final scene, without future geometry',()=>{
 const {report,collision,project}=fixture(),original=JSON.stringify(report),before=project(19),at=project(20),c=at.coffee!.armTrace.collision!;
 expect(before.coffee!.armTrace.collision?.evidence?.firstFailure).toBeUndefined();
 expect(JSON.stringify(before.coffee!.armTrace.collision)).not.toContain('fixture:blocked');
 expect(JSON.stringify(before.coffee!.armTrace.collision)).not.toContain('future-world');
 expect(c.evidence?.firstFailure).toEqual(collision.evidence!.firstFailure);expect(c.last).toMatchObject({ok:false,pair:['held-cup','fixture:blocked']});
 expect(c.scene?.tick).toBe(20);expect(c.evidence?.worlds).toEqual({empty:[],blocked:collision.evidence!.firstFailure!.world});
 expect(c.evidence?.projection?.retainedRange).toEqual({fromTick:1,toTick:20});
 expect(armRows(at,20).find(r=>r.key==='arm-checker')?.observed).toContain('blocked');
 expect(armRows(at,20).find(r=>r.key==='arm-checker')?.observed).toContain('held-cup');
 expect(JSON.stringify(report)).toBe(original);
});
test('collision replay clips a stationary interval and does not expose a later failure or final coverage',()=>{
 const {project}=fixture(),r=project(5),c=r.coffee!.armTrace.collision!;
 expect(c.evidence?.intervals).toHaveLength(1);expect(c.evidence?.intervals[0]).toMatchObject({firstTick:1,lastTick:5});
 expect(c.checks).toBe(5);expect(c.last).toMatchObject({ok:true});expect(c.scene).toBeUndefined();
 expect(c.evidence?.firstFailure).toBeUndefined();expect(c.evidence?.worlds).toEqual({empty:[]});
 const start=project(0);expect(start.coverage).toMatchObject({armCollisionChecker:false,armSceneCollision:false,armCollisionTraceComplete:false});
});
test('truncated replay retains an independently stored first failure and marks missing history explicitly',()=>{
 const {collision,project}=fixture();collision.evidence!.intervals=collision.evidence!.intervals.slice(0,1);collision.evidence!.droppedIntervals=90;collision.checks=101;
 const r=project(20),c=r.coffee!.armTrace.collision!;
 expect(c.last).toMatchObject({ok:false,pair:['held-cup','fixture:blocked']});expect(c.evidence?.firstFailure?.tick).toBe(20);
 expect(c.evidence?.worlds.blocked).toEqual(collision.evidence!.firstFailure!.world);
 expect(c.checks).toBeNull();expect(c.evidence?.droppedIntervals).toBeNull();expect(c.evidence?.projection).toMatchObject({lastCheckTick:20,historyComplete:false,reason:'SOURCE_TRACE_TRUNCATED'});
 expect(r.coverage.armCollisionTraceComplete).toBe(false);expect(project(100).coffee!.armTrace.collision?.evidence?.droppedIntervals).toBe(90);
 expect(armRows(r,20).find(row=>row.key==='arm-trace')?.observed).toMatch(/incomplete|lịch sử lưu không đầy đủ|保存履歴が不完全/);
});
test('retained interval scene uses the immutable declaration and referenced historical geometry only',()=>{
 const {report,project}=fixture(),p=validateProjectV2(coffeeFixture.project);
 report.manifest.armCollisionScene={hash:'scene-1',profile:p.armCollisionProfile!,profileHash:'profile',world:p.world,worldHash:'world',robotGeometry:[]};
 const r=project(5),c=r.coffee!.armTrace.collision!;
 expect(c.scene).toMatchObject({available:true,scope:'self_scene_robot',revision:'scene-1',tick:5,world:[]});
 expect(c.scene?.robotPoses).toBeUndefined();expect(JSON.stringify(c)).not.toContain('future-world');
 expect(r.coverage).toMatchObject({armSceneCollision:true,armCollisionTraceComplete:true});
});
test('missing retained geometry marks history incomplete instead of borrowing the final world',()=>{
 const {collision,project}=fixture();delete collision.evidence!.worlds.empty;
 const r=project(5),c=r.coffee!.armTrace.collision!;
 expect(c.world).toEqual([]);expect(c.scene).toBeUndefined();expect(c.evidence?.projection).toMatchObject({historyComplete:false,reason:'MISSING_RECORDED_WORLD'});
 expect(r.coverage.armCollisionTraceComplete).toBe(false);
});
test('arm stop replay hides future collision and reset events and reconstructs the observed latch at the cursor',()=>{
 const {report,project}=fixture();report.coffee!.armTrace.stop={latched:false,reconcileRequired:true,reason:'ARM_COLLISION',events:[
  {tick:20,stage:'requested',reason:'ARM_COLLISION',provenance:'modelled'},{tick:20,stage:'acknowledged',reason:'ARM_COLLISION',provenance:'modelled'},
  {tick:20,stage:'observed',reason:'ARM_COLLISION',provenance:'modelled'},{tick:80,stage:'reset',reason:'EXPLICIT_MOCK_RESET',provenance:'modelled'},
 ]};const original=JSON.stringify(report);
 expect(project(19).coffee!.armTrace.stop).toBeNull();
 const at=project(20).coffee!.armTrace.stop!;expect(at).toMatchObject({latched:true,reconcileRequired:true,reason:'ARM_COLLISION'});expect(at.events).toHaveLength(3);
 expect(project(80).coffee!.armTrace.stop).toMatchObject({latched:false,reconcileRequired:true});expect(JSON.stringify(report)).toBe(original);
});
