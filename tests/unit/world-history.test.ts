import {expect,test} from 'vitest';
import {MockArmPlant,PUMA_PROGRAMS} from '../../packages/cell-adapters/src/mock-arm';
import {PUMA560_SI} from '../../packages/lab-runtime/src/v2/models/arm-kinematics';
import {boundWorldArmHistory,WORLD_HISTORY_POLICY} from '../../packages/lab-runtime/src/v2/simulation3d/world-history';
import type {CellCommand} from '../../packages/cell-adapters/src/contract';
function setup(world=true){const state=MockArmPlant.initial('arm-1');if(world)Object.assign(state,{historyRetention:{...WORLD_HISTORY_POLICY,droppedTraceSamples:0,droppedPropsSamples:0,droppedDebugSamples:0}});
 const arm=new MockArmPlant(state,()=>0,()=> 'boot',{take:()=>null,put:()=>{}},()=>null,PUMA560_SI,{reachTolRad:1e-9,settleTicks:1,followTolRad:100,followTicks:2},PUMA_PROGRAMS);
 arm.execute({commandId:'c',payloadHash:'0'.repeat(64),controlEpoch:1,capability:'start_job',programRef:{id:'cup-pick'}} as CellCommand);
 const step=(n:number)=>{arm.setCollisionScene({available:true,scope:'self_scene_robot',revision:'r'+n,profileRevision:1,tick:n,world:[{id:'far',kind:'sphere',center:[100+n*1e-6,100,100],radiusM:.01}],robotPoses:[]});arm.advance();arm.observe(state.q,[]);(state.tracking!.props??=[]).push({tick:n,props:[]});boundWorldArmHistory(state);};return {state,arm,step};}
test('world hot history stays bounded while every changing-scene sweep and tracking statistic survives',()=>{
 const h=setup();for(let n=1;n<=200;n++)h.step(n);const bytes=JSON.stringify(h.state).length;
 for(let n=201;n<=5000;n++)h.step(n);const s=h.state;expect(s.collision!.checks).toBe(5000);expect(s.tracking!.samples).toBe(5000);expect(s.collision!.evidence!.intervals).toHaveLength(16);expect(Object.keys(s.collision!.evidence!.worlds)).toHaveLength(16);expect(s.collision!.evidence!.droppedIntervals).toBe(4984);
 expect(s.tracking!.trace).toHaveLength(16);expect(s.tracking!.props).toHaveLength(16);expect(s.trace.length).toBeLessThanOrEqual(16);expect(JSON.stringify(s).length).toBeLessThan(bytes+2048);expect(s.q).toEqual(PUMA_PROGRAMS.waypoints.home);expect(s.programs[0]!.state).toBe('running');
},120000);
test('legacy history retains its existing4096 cap and the world bound never removes firstFailure geometry',()=>{
 const legacy=setup(false);for(let n=1;n<=20;n++)legacy.step(n);expect(legacy.state.collision!.evidence!.intervals).toHaveLength(20);
 const h=setup();for(let n=1;n<=20;n++)h.step(n);const e=h.state.collision!.evidence!,i=e.intervals[0]!,world=e.worlds[i.worldRevision]!;e.firstFailure={tick:i.firstTick,fromQ:i.fromQ,toQ:i.toQ,heldCupId:null,worldRevision:i.worldRevision,world,scene:null,result:{...i.result,ok:false,reason:'COLLISION'}};const first=structuredClone(e.firstFailure);
 for(let n=21;n<=60;n++)h.step(n);expect(e.firstFailure).toEqual(first);expect(e.worlds[first.worldRevision]).toEqual(world);expect(Object.keys(e.worlds).length).toBeLessThanOrEqual(17);
});
