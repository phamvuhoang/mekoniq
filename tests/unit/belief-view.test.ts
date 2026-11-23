import {expect,test} from 'vitest';
import {coveredReport,loadedReport} from '../support/belief-display';
import {admitBeliefReport,beliefAt,ghostsAt} from '../../src/twin/belief';
import type {BeliefRecord} from '../../src/shared/navigation2d';
const rec=(tick:number,o:Partial<BeliefRecord>={}):BeliefRecord=>({tick,objectId:'cup-1',dropped:false,truthAtObservedTick:[0.49,0,0.15],errorM:0.002,belief:{objectId:'cup-1',kind:'cup',frameId:'arm-base',positionM:[0.49+tick*1e-4,0.002,0.15],sigmaM:[0.002,0.002,0],observedTick:tick-5,publishedTick:tick,ageTicks:0,source:'pose_estimator_sim',valid:true},...o});

test('no records, or none at or before the cursor: NO_BELIEF_DATA',()=>{
 expect(beliefAt([],10,{maxAgeTicks:50,lastTick:100})).toEqual({available:false,reason:'NO_BELIEF_DATA'});
 expect(beliefAt([rec(20)],10,{maxAgeTicks:50,lastTick:100})).toEqual({available:false,reason:'NO_BELIEF_DATA'});
});
test('the newest record not later than the cursor, with its truth and error',()=>{
 const r=beliefAt([rec(10),rec(20),rec(30)],25,{maxAgeTicks:50,lastTick:100});
 expect(r).toMatchObject({available:true,truthM:[0.49,0,0.15],errorM:0.002});
 if(r.available)expect(r.belief.publishedTick).toBe(20);
 expect(beliefAt([rec(10),rec(20)],20,{maxAgeTicks:50,lastTick:100})).toMatchObject({available:true});
});
test('a dropped update keeps the belief the controller still holds; an out-of-view record ends it',()=>{
 const dropped=rec(30,{belief:null,dropped:true,reason:'DROPOUT',errorM:null}),gone=rec(40,{belief:null,reason:'OUT_OF_VIEW',errorM:null});
 const r=beliefAt([rec(10),rec(20),dropped],35,{maxAgeTicks:50,lastTick:100});expect(r.available&&r.belief.publishedTick).toBe(20);
 expect(beliefAt([rec(10),dropped,gone],45,{maxAgeTicks:50,lastTick:100})).toEqual({available:false,reason:'OUT_OF_VIEW'});
 expect(beliefAt([dropped],35,{maxAgeTicks:50,lastTick:100})).toEqual({available:false,reason:'NO_BELIEF_DATA'});
});
test('an invalid belief is not drawn',()=>{
 const bad=rec(10);bad.belief!.valid=false;
 expect(beliefAt([bad],10,{maxAgeTicks:50,lastTick:100})).toEqual({available:false,reason:'NO_BELIEF_DATA'});
});
const base={position:[1,2,0.5],quaternionXyzw:[0,0,Math.SQRT1_2,Math.SQRT1_2]};
test('ghosts are mapped from the arm base frame to the map through baseInMap, one per cup',()=>{
 const second=rec(20);second.objectId=second.belief!.objectId='cup-2';
 const f={view:{tick:20},report:loadedReport([rec(10),rec(20),second])};
 const g=ghostsAt(f,base);
 expect(g.status).toBe('data');
 if(g.status==='data'){expect(g.items.map(i=>i.objectId)).toEqual(['cup-1','cup-2']);
  const [x,y,z]=g.items[0]!.beliefMapM;expect(x).toBeCloseTo(1-0.002,6);expect(y).toBeCloseTo(2+0.492,6);expect(z).toBeCloseTo(0.65,9); // yaw +90°: (0.492, 0.002) -> (-0.002, 0.492)
  expect(g.items[0]!.errorMm).toBeCloseTo(2,9);}
});
test('a report without the stream says so; it never draws a ghost',()=>{
 expect(ghostsAt({view:{tick:20},report:{}} as never,base)).toEqual({status:'none'});
 expect(ghostsAt({view:{tick:20},report:null} as never,base)).toEqual({status:'none'});
 expect(ghostsAt({view:{tick:5},report:{perceptionEvidence:{schemaVersion:1,beliefs:[rec(10)],attempts:[],recovery:[],complete:true,issues:[]}}} as never,base)).toEqual({status:'no_data_at_cursor'});
 expect(ghostsAt({view:{tick:20},report:{perceptionEvidence:{schemaVersion:1,beliefs:[],attempts:[],recovery:[],complete:false,issues:['BELIEF_EVIDENCE_MISSING']}}} as never,base)).toEqual({status:'none'});
});

test('publication age is inclusive and the covered horizon limits a dropout chain',()=>{
 const rows=[rec(20),rec(30,{belief:null,dropped:true,reason:'DROPOUT',errorM:null})];
 expect(beliefAt(rows,70,{maxAgeTicks:50,lastTick:100})).toMatchObject({available:true,belief:{ageTicks:50}});
 expect(beliefAt(rows,71,{maxAgeTicks:50,lastTick:100}).available).toBe(false);
 expect(beliefAt(rows,21,{maxAgeTicks:50,lastTick:20}).available).toBe(false);
});

test('admitted snapshots survive input mutation and do not carry over to replacements with the same identity',()=>{
 const r=loadedReport([rec(20)]),draw=(report:unknown)=>ghostsAt({view:{tick:20},report},base);
 r.perceptionEvidence.beliefs[0]!.belief!.positionM[0]=99;r.perceptionEvidence.beliefs.length=0;
 const g=draw(r);expect(g.status==='data'&&g.items[0]!.beliefMapM[1]).toBeCloseTo(2.492);
 for(const change of [(v:typeof r)=>v.perceptionEvidence.issues.push('BELIEF_WORLD_COVERAGE'),(v:typeof r)=>v.perceptionEvidence.policy.profile.maxAgeTicks++,
  (v:typeof r)=>v.perceptionEvidence.policy.profileBytes+=' ',(v:typeof r)=>v.arm.worldTrace.samples--,(v:typeof r)=>v.perceptionEvidence.coverage.prefixCovered=false,
  (v:typeof r)=>v.perceptionEvidence.beliefs[0]!.belief!.observedTick++,(v:typeof r)=>v.perceptionEvidence.beliefs[0]!.belief!.positionM[0]=Infinity]){
  const v=coveredReport([rec(20)]);change(v);admitBeliefReport(v);expect(draw(v).status).toBe('no_data_at_cursor');
 }
 expect(draw(coveredReport([rec(20)])).status).toBe('no_data_at_cursor');
});

test('replay admission requires an issue-free covered world prefix for this report identity',()=>{
 const r=coveredReport([rec(20)]),m={runId:'run',horizon:{tick:100},coverage:{prefixCovered:true,terminal:null,gaps:[],issues:[]},streams:[{kind:'world',firstTick:0,lastTick:100,samples:101}]};
 for(const replay of [{...m,runId:'other'},{...m,horizon:{tick:99}},{...m,streams:[]},{...m,coverage:{...m.coverage,terminal:'restart'}},{...m,coverage:{...m.coverage,gaps:[1]}}]){
  admitBeliefReport(r,replay as never);expect(ghostsAt({view:{tick:20},report:r},base).status).toBe('no_data_at_cursor');
 }
 admitBeliefReport(r,m as never);expect(ghostsAt({view:{run:{id:'run'},tick:20},report:r},base).status).toBe('data');
 expect(ghostsAt({view:{run:{id:'replacement'},tick:20},report:r},base).status).toBe('no_data_at_cursor');
});
