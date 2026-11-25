// D58/D65 live playback rules: what the 3D view shows between samples and when it animates. One test per rule.
import {expect,test} from 'vitest';
import {LivePlayback} from '../../src/twin/live-playback';
import type {Held} from '../../src/twin/store';
import type {TwinPoses} from '../../src/viewer/twin3d';

const J=(v:number)=>[v,v,v,v,v,v];
const arm=(seq:number,at:number,o:{observed?:number;commanded?:number;quality?:Held['quality'];boot?:string}={}):Held=>({schemaVersion:2,runId:'r',entityId:'arm-1',providerId:'mock_arm',bootId:o.boot??'b',seq:String(seq),simTimeNs:String(seq*100_000_000),observedAt:null,receivedMonotonicNs:'0',frameId:'map',origin:'mock',
 quality:o.quality??'valid',reasonCodes:[],commanded:o.commanded===undefined?null:{jointsRad:J(o.commanded)},observed:o.observed===undefined?{}:{jointsRad:J(o.observed)},estimated:null,causationId:null,receivedAtMs:at,epochResetAtMs:null});
const amr=(seq:number,at:number,x:number,yaw=0):Held=>({...arm(seq,at),entityId:'amr-1',providerId:'mock_amr',observed:{xM:x,yM:0,yawRad:yaw}});
const exact=():TwinPoses=>({arms:{'arm-1':{jointsRad:J(9),gripperOpeningM:null}},bodies:{'amr-1':{positionM:[9,9,0],quaternionXyzw:[0,0,0,1]}}});
const env=(o:{reduced?:boolean;fresh?:boolean}={})=>new LivePlayback({reducedMotion:()=>!!o.reduced,fresh:()=>o.fresh??true});
const live={live:true,replay:false};
/** Three samples 100 ms apart, then the view at a wall time 50 ms past the last one (150 ms delay: sim 100+50 → between the 2nd and 3rd). */
const shown=(p:LivePlayback,at=250)=>p.poses(exact(),at).arms['arm-1']!.jointsRad[0];

test('samples are played back between two received values',()=>{
 const p=env();for(const [i,v] of [[0,0],[1,1],[2,2]] as const)p.feed(arm(i+1,i*100,{observed:v}),false);
 expect(shown(p,300)).toBeCloseTo(1.5,9);
});
test('no interpolation across a change of display source: observed → commanded shows the commanded value alone',()=>{
 const p=env();p.feed(arm(1,0,{observed:0}),false);p.feed(arm(2,100,{observed:1}),false);p.feed(arm(3,200,{commanded:5}),false);
 for(const t of [200,250,300,1000])expect(shown(p,t)).toBe(5);
});
test('an epoch reset starts a new buffer: no blend with the old epoch',()=>{
 const p=env();p.feed(arm(1,0,{observed:0}),false);p.feed(arm(2,100,{observed:1}),false);p.feed(arm(1,200,{observed:7,boot:'b2'}),true);
 for(const t of [200,250,300])expect(shown(p,t)).toBe(7);
});
test('a gap (or link loss) clears every buffer: the exact poses are shown',()=>{
 const p=env();p.feed(arm(1,0,{observed:0}),false);p.feed(amr(1,0,1),false);p.clear();
 expect(p.poses(exact(),100)).toEqual(exact());
 expect(p.animating(100,live)).toBe(false);
});
test('a stale sample deletes the buffer and is never advanced; a non-live entity keeps its exact pose',()=>{
 const p=env();p.feed(arm(1,0,{observed:0}),false);p.feed(arm(2,100,{observed:1,quality:'stale'}),false);
 expect(shown(p,400)).toBe(9);
 const q=env({fresh:false});q.feed(arm(1,0,{observed:0}),false);q.feed(arm(2,100,{observed:1}),false);
 expect(shown(q,400)).toBe(9);
});
test('an AMR pose turns along the shorter arc and keeps its z at 0 for a planar plant',()=>{
 const p=env();p.feed(amr(1,0,0,3.0),false);p.feed(amr(2,100,1,-3.0),false);
 const b=p.poses(exact(),200).bodies['amr-1']!;// sim 50 ms: halfway
 expect(b.positionM).toEqual([0.5,0,0]);expect(Math.abs(b.quaternionXyzw[3]!)).toBeLessThan(0.05);// yaw ≈ ±π, not 0
});
test('animating: live with a sample in the last second, never in replay, never with reduced motion',()=>{
 const p=env();p.feed(arm(1,0,{observed:0}),false);
 expect(p.animating(500,live)).toBe(true);
 expect(p.animating(500,{live:true,replay:true})).toBe(false);
 expect(p.animating(500,{live:false,replay:false})).toBe(false);
 expect(env({reduced:true}).animating(0,live)).toBe(false);
 const r=env({reduced:true});r.feed(arm(1,0,{observed:0}),false);expect(r.animating(500,live)).toBe(false);
 expect(p.animating(1001,live)).toBe(false);// no sample for a second
});
