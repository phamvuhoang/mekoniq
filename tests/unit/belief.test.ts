import {expect,expectTypeOf,test} from 'vitest';
import {createBeliefWorld,type BeliefView} from '../../packages/lab-runtime/src/v2/perception/belief';
import type {BeliefObject,BeliefRecord} from '../../packages/contracts/generated/navigation2d';
const rec=(tick:number,x=0.5,o:Partial<BeliefRecord>={}):BeliefRecord=>({tick,objectId:'cup-1',dropped:false,truthAtObservedTick:[x+0.002,0.1,0.15],errorM:0.002,
 belief:{objectId:'cup-1',kind:'cup',frameId:'arm-base',positionM:[x,0.1,0.15],sigmaM:[0.005,0.005,0],observedTick:tick-5,publishedTick:tick,ageTicks:0,source:'pose_estimator_sim',valid:true},...o});
const keys=(v:unknown):string[]=>v&&typeof v==='object'?Object.entries(v).flatMap(([k,x])=>[k,...keys(x)]):[];

test('no record yet is unavailable, an old one is stale, a fresh one is ok with its age',()=>{
 const w=createBeliefWorld(50);
 expect(w.view().get('cup-1',10)).toEqual({status:'unavailable',reason:'BELIEF_UNAVAILABLE'});
 w.apply(rec(20));
 const ok=w.view().get('cup-1',30);
 expect(ok.status).toBe('ok');if(ok.status==='ok')expect(ok.belief).toMatchObject({publishedTick:20,ageTicks:10,positionM:[0.5,0.1,0.15]});
 expect(w.view().get('cup-1',70)).toMatchObject({status:'ok'});
 expect(w.view().get('cup-1',71)).toEqual({status:'stale',reason:'BELIEF_STALE'});
});
test('a dropped update keeps the last estimate, which then goes stale',()=>{
 const w=createBeliefWorld(50);w.apply(rec(20));w.apply(rec(30,0,{belief:null,dropped:true,errorM:null}));
 expect(w.view().get('cup-1',40)).toMatchObject({status:'ok',belief:{publishedTick:20}});expect(w.view().get('cup-1',80).status).toBe('stale');
});
test('an invalid belief is unavailable, and the view is per object',()=>{
 const w=createBeliefWorld(50),r=rec(20);r.belief!.valid=false;w.apply(r);
 expect(w.view().get('cup-1',21)).toEqual({status:'unavailable',reason:'BELIEF_UNAVAILABLE'});expect(w.view().get('cup-2',21).status).toBe('unavailable');
});
test('nothing the decision code can read names the truth, the actual state or the error',()=>{
 const w=createBeliefWorld(50);w.apply(rec(20));
 for(const t of [10,21,500])expect(keys(w.view().get('cup-1',t)).filter(k=>/truth|actual|error/i.test(k))).toEqual([]);
 expect(Object.keys(w.view())).toEqual(['get']);
});
test('the view type has no truth property',()=>{
 expectTypeOf<BeliefObject>().not.toHaveProperty('truthAtObservedTick');
 expectTypeOf<BeliefView['get']>().returns.not.toHaveProperty('truthAtObservedTick');
});
test('the view is a copy: changing what it returned changes nothing',()=>{
 const w=createBeliefWorld(50);w.apply(rec(20));const a=w.view().get('cup-1',21);if(a.status==='ok')a.belief.positionM[0]=9;
 const b=w.view().get('cup-1',21);expect(b.status==='ok'&&b.belief.positionM[0]).toBe(0.5);
});
