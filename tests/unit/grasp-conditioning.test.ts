import {expect,test} from 'vitest';
import {planBeliefGrasp} from '../../packages/lab-runtime/src/v2/perception/grasp-conditioning';
import {createBeliefWorld} from '../../packages/lab-runtime/src/v2/perception/belief';
import type {BeliefRecord} from '../../packages/contracts/generated/navigation2d';
const belief=(x:number,y:number,tick=100):BeliefRecord=>({tick,objectId:'cup-1',dropped:false,truthAtObservedTick:[0.5,0,0.15],errorM:0,
 belief:{objectId:'cup-1',kind:'cup',frameId:'arm-base',positionM:[x,y,0.15],sigmaM:[0.005,0.005,0],observedTick:tick-5,publishedTick:tick,ageTicks:0,source:'pose_estimator_sim',valid:true}});
const q=[0,0,0,0,0,0,0];const id=[0,0,0,1] as [number,number,number,number];
const offsets={pickApproach:{positionM:[0,-0.1,0.02] as [number,number,number],quaternionXyzw:id},pick:{positionM:[0,0,0.02] as [number,number,number],quaternionXyzw:id},lift:{positionM:[0,0,0.12] as [number,number,number],quaternionXyzw:id}};
const seeds={pickApproach:q,pick:q,lift:q};
const region={centerM:[0.5,0] as [number,number],halfExtentM:[0.03,0.03] as [number,number]};
function setup(b?:BeliefRecord,calls={solve:0,sweep:0}){
 const w=createBeliefWorld(50);if(b)w.apply(b);
 const input=(o:{tick?:number;solve?:never;sweep?:never}={})=>({view:w.view(),cupId:'cup-1',tick:o.tick??110,attemptIndex:0,mode:'belief_estimated' as const,region,graspOffsets:offsets,seeds,
  solve:(o.solve??((pose:{positionM:number[]})=>{calls.solve++;return {ok:true as const,q:[pose.positionM[0]!,pose.positionM[1]!,pose.positionM[2]!,0,0,0],residual:{positionM:1e-6,orientationRad:1e-6,condition:10}};})) as never,
  sweep:(o.sweep??(()=>{calls.sweep++;return {ok:true as const};})) as never});
 return {input,calls};
}
test('a belief that passes every gate gives three solved waypoints, offsets applied to the believed position, and a full attempt',()=>{
 const {input,calls}=setup(belief(0.502,0.004)),r=planBeliefGrasp(input());
 expect(r.ok).toBe(true);if(!r.ok)return;
 expect(r.waypoints.pick.slice(0,2)).toEqual([0.502,0.004]);expect(r.waypoints.pick[2]).toBeCloseTo(0.17,12);expect(r.waypoints.pickApproach[1]).toBeCloseTo(0.004-0.1,12);expect(r.waypoints.lift[2]).toBeCloseTo(0.27,12);
 expect(r.attempt).toMatchObject({attemptId:'cup-1#0',cupId:'cup-1',index:0,decidedTick:110,mode:'belief_estimated',beliefErrorAtCommitM:null,gates:{belief:'pass',region:'pass',ik:'pass',sweep:'pass'}});
 expect(r.attempt.beliefUsed).toMatchObject({publishedTick:100,ageTicks:10});expect(r.attempt.ikResidual).toHaveLength(3);expect(calls).toEqual({solve:3,sweep:1});
});
test('the gates run in the fixed order and the first failing one names the refusal; later gates are not evaluated',()=>{
 const none=planBeliefGrasp(setup().input());
 expect(none).toMatchObject({ok:false,code:'BELIEF_UNAVAILABLE',attempt:{outcome:'refused',beliefUsed:null,gates:{belief:'BELIEF_UNAVAILABLE',region:'not_evaluated',ik:'not_evaluated',sweep:'not_evaluated'}}});
 expect(planBeliefGrasp(setup(belief(0.5,0)).input({tick:200}))).toMatchObject({ok:false,code:'BELIEF_STALE',attempt:{gates:{belief:'BELIEF_STALE',region:'not_evaluated'}}});
 const out=setup(belief(0.56,0));expect(planBeliefGrasp(out.input())).toMatchObject({ok:false,code:'BELIEF_OUT_OF_REGION',attempt:{gates:{belief:'pass',region:'BELIEF_OUT_OF_REGION',ik:'not_evaluated',sweep:'not_evaluated'}}});
 expect(out.calls).toEqual({solve:0,sweep:0});
});
test('an unreachable pose refuses with GRASP_UNREACHABLE and the sweep is never called',()=>{
 const {input,calls}=setup(belief(0.5,0)),r=planBeliefGrasp(input({solve:(()=>({ok:false,reason:'JOINT_LIMIT'})) as never}));
 expect(r).toMatchObject({ok:false,code:'GRASP_UNREACHABLE',attempt:{gates:{belief:'pass',region:'pass',ik:'GRASP_UNREACHABLE',sweep:'not_evaluated'},outcome:'refused'}});expect(calls.sweep).toBe(0);
});
test('a sweep refusal keeps its ARM03 code and the solved waypoints stay in the attempt',()=>{
 for(const code of ['ARM_COLLISION','ARM_SWEEP_UNCERTAIN'] as const){
  const r=planBeliefGrasp(setup(belief(0.5,0)).input({sweep:(()=>({ok:false,code})) as never}));
  expect(r).toMatchObject({ok:false,code,attempt:{gates:{ik:'pass',sweep:code},outcome:'refused'}});expect(r.attempt.waypointsRad?.pick).toHaveLength(6);
 }
});
test('the boundary of the region is inside, a hair beyond is outside',()=>{
 expect(planBeliefGrasp(setup(belief(0.53,0.03)).input()).ok).toBe(true);expect(planBeliefGrasp(setup(belief(0.5301,0)).input()).ok).toBe(false);
});
test('the attempt index is carried into the attempt id',()=>{
 const r=planBeliefGrasp({...setup(belief(0.5,0)).input(),attemptIndex:2});expect(r.attempt).toMatchObject({index:2,attemptId:'cup-1#2'});
});
test('R03: a commit plan solves, sweeps and records only the path the arm will run (pick, lift) from where it holds, not an approach it does not execute',()=>{
 const swept:number[][][]=[],{input}=setup(belief(0.502,0.004));
 const r=planBeliefGrasp({...input({sweep:((w:number[][])=>{swept.push(w);return {ok:true as const};}) as never}),path:'commit'});
 expect(r.ok).toBe(true);if(!r.ok)return;
 expect(swept).toHaveLength(1);expect(swept[0]).toEqual([r.waypoints.pick,r.waypoints.lift]);
 expect(Object.keys(r.attempt.waypointsRad!).sort()).toEqual(['lift','pick']);expect(r.attempt.ikResidual).toHaveLength(2);
});
