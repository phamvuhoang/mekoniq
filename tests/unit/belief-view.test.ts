import {expect,test} from 'vitest';
import {beliefAt,ghostsAt} from '../../src/twin/belief';
import type {BeliefRecord} from '../../src/shared/navigation2d';
const rec=(tick:number,o:Partial<BeliefRecord>={}):BeliefRecord=>({tick,objectId:'cup-1',dropped:false,truthAtObservedTick:[0.49,0,0.15],errorM:0.002,belief:{objectId:'cup-1',kind:'cup',frameId:'arm-base',positionM:[0.49+tick*1e-4,0.002,0.15],sigmaM:[0.002,0.002,0],observedTick:tick-5,publishedTick:tick,ageTicks:0,source:'pose_estimator_sim',valid:true},...o});

test('no records, or none at or before the cursor: NO_BELIEF_DATA',()=>{
 expect(beliefAt([],10)).toEqual({available:false,reason:'NO_BELIEF_DATA'});
 expect(beliefAt([rec(20)],10)).toEqual({available:false,reason:'NO_BELIEF_DATA'});
});
test('the newest record not later than the cursor, with its truth and error',()=>{
 const r=beliefAt([rec(10),rec(20),rec(30)],25);
 expect(r).toMatchObject({available:true,truthM:[0.49,0,0.15],errorM:0.002});
 if(r.available)expect(r.belief.publishedTick).toBe(20);
 expect(beliefAt([rec(10),rec(20)],20)).toMatchObject({available:true});
});
test('a dropped update keeps the belief the controller still holds; an out-of-view record ends it',()=>{
 const dropped=rec(30,{belief:null,dropped:true,reason:'DROPOUT',errorM:null}),gone=rec(40,{belief:null,reason:'OUT_OF_VIEW',errorM:null});
 const r=beliefAt([rec(10),rec(20),dropped],35);expect(r.available&&r.belief.publishedTick).toBe(20);
 expect(beliefAt([rec(10),dropped,gone],45)).toEqual({available:false,reason:'OUT_OF_VIEW'});
 expect(beliefAt([dropped],35)).toEqual({available:false,reason:'NO_BELIEF_DATA'});
});
test('an invalid belief is not drawn',()=>{
 const bad=rec(10);bad.belief!.valid=false;
 expect(beliefAt([bad],10)).toEqual({available:false,reason:'NO_BELIEF_DATA'});
});
const base={position:[1,2,0.5],quaternionXyzw:[0,0,Math.SQRT1_2,Math.SQRT1_2]};
test('ghosts are mapped from the arm base frame to the map through baseInMap, one per cup',()=>{
 const f={view:{tick:20},report:{perceptionEvidence:{schemaVersion:1,beliefs:[rec(10),rec(20),{...rec(20),objectId:'cup-2'}],attempts:[],recovery:[],complete:true,issues:[]}}} as never;
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
