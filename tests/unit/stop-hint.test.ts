import {expect,test} from 'vitest';
import {stopHint,type StopRunIdentity} from '../../packages/lab-runtime/src/v2/control/stop-hint';
import {buildStopReport} from '../../packages/lab-runtime/src/v2/control/stop-report';
import {AXES,POLICY,decel,records} from '../support/stop-records';

const SRC={kind:'assumed' as const,documentId:'x',revision:'1',locator:'y',contentSha256:'e'.repeat(64)};
const slow=(t:number)=>t<=100?0.8:Math.max(0,0.8-0.2*0.02*(t-100));
const ID:StopRunIdentity={scenarioId:'MJ-TRAY01',seed:7,trigger:{kind:'elapsed_sim_ms',value:1980},experimentId:'tray-stop-brake-v1'};
const report=(fn:'normal'|'protective'|'emergency',o:{speed?:(t:number)=>number;cups?:boolean;onDisable?:'brake'|'coast'|null;brakeTorqueNm?:number|null;rolling?:number}={})=>{
 const onDisable=o.onDisable===undefined?'brake':o.onDisable,brake=o.brakeTorqueNm===undefined?(onDisable==='brake'?6:null):o.brakeTorqueNm;
 return buildStopReport({runId:'r',entry:{id:'s',function:fn,trigger:{kind:'elapsed_sim_ms',value:1980}},intents:[{tick:100,intents:[{entryId:'s',function:fn,appliedBy:fn==='emergency'?'worker':'controller',targetTick:100}]}],
 receipts:[{entryId:'s',function:fn,appliedBy:fn==='emergency'?'worker':'controller',appliedTick:100,runId:'r',bootId:'b',sceneDigest:'a'.repeat(64),requestDigest:'b'.repeat(64)}],
 records:records({ticks:700,speed:o.speed??decel,...o.cups!==false?{cups:t=>({slipM:t>100?0.002:0})}:{}}),policy:POLICY,chainAxes:AXES,wheelRadiusM:0.1,attention:[],served:'0',status:'needs_attention',servedAfterStop:false,
 decidingParameters:[{id:'rollingResistanceM',value:o.rolling??0.0001,source:SRC},{id:'floorContactSliding',value:0.6,source:SRC},...onDisable===null?[]:[{id:'onDisable',value:onDisable,source:SRC}],{id:'brakeTorqueNm',value:brake,source:SRC}]});
};
const run=(r:ReturnType<typeof report>,id:Partial<StopRunIdentity>={})=>({report:r,identity:{...ID,...id}});

test('two runs that differ only in the function give one sentence in three languages, each with both distances, the brake named from the config, and the closing limit',()=>{
 const h=stopHint(run(report('normal')),run(report('emergency',{speed:slow})))!;
 expect(h).not.toBeNull();
 for(const s of [h.vi,h.ja,h.en]){expect(s.length).toBeGreaterThan(40);expect(s).toMatch(/0\.6\d/);expect(s).toMatch(/6 N·m/);}
 expect(h.en).toMatch(/torque cut with a 6 N·m brake/);expect(h.vi).toMatch(/ngắt mô-men và phanh 6 N·m/);expect(h.ja).toMatch(/トルク遮断と6 N·mブレーキ/);
 expect(h.en).not.toMatch(/torque cut and coast/);expect(h.vi).not.toMatch(/ngắt mô-men và thả trôi/);expect(h.ja).not.toMatch(/トルク遮断と惰行/);
 expect(h.en).toMatch(/not measured/);expect(h.vi).toMatch(/chưa được đo/);expect(h.ja).toMatch(/未測定/);expect(h.en).toMatch(/cups slip at most/);
});
test('two emergency stops that differ only in the stop variant: brake against coast, named from onDisable in three languages',()=>{
 const h=stopHint(run(report('emergency')),run(report('emergency',{speed:slow,onDisable:'coast'}),{experimentId:'tray-stop-coast-v1'}))!;
 expect(h).not.toBeNull();
 expect(h.en).toMatch(/torque cut with a 6 N·m brake .* torque cut and coast/);expect(h.vi).toMatch(/phanh 6 N·m.*ngắt mô-men và thả trôi/);expect(h.ja).toMatch(/ブレーキ.*トルク遮断と惰行/);
});
test('null when the runs differ in anything else: seed, trigger, scenario, experiment beyond the drive, physics, or two inputs at once',()=>{
 const a=run(report('normal')),b=report('emergency');
 expect(stopHint(a,run(b,{seed:8}))).toBeNull();
 expect(stopHint(a,run(b,{trigger:{kind:'elapsed_sim_ms',value:2000}}))).toBeNull();
 expect(stopHint(a,run(b,{scenarioId:'MJ-TRAY02'}))).toBeNull();
 expect(stopHint(run(report('emergency')),run(report('emergency',{onDisable:'coast'}),{experimentId:'tray-stop-slow-coast-v1'}))).toBeNull();   // drive and speed
 expect(stopHint(a,run(report('emergency',{onDisable:'coast'}),{experimentId:'tray-stop-coast-v1'}))).toBeNull();                               // function and variant
 expect(stopHint(a,run(report('emergency',{rolling:0.001})))).toBeNull();
 expect(stopHint(run(report('emergency')),run(report('emergency',{onDisable:'coast'})))).toBeNull();                                        // same experiment, different drive config
});
test('null without provenance: no identity, an unregistered experiment, or no onDisable in the report',()=>{
 expect(stopHint({report:report('normal')} as never,run(report('emergency')))).toBeNull();
 expect(stopHint(run(report('normal'),{seed:undefined as never}),run(report('emergency'),{seed:undefined as never}))).toBeNull();
 expect(stopHint(run(report('normal'),{experimentId:'nope'}),run(report('emergency'),{experimentId:'nope'}))).toBeNull();
 expect(stopHint(run(report('normal',{onDisable:null})),run(report('emergency',{onDisable:null})))).toBeNull();
 expect(stopHint(run(report('normal',{brakeTorqueNm:null})),run(report('emergency',{brakeTorqueNm:null})))).toBeNull();                         // a brake with no torque
});
test('null for the same run twice, or when a distance is not available; a run without cups has no slip clause',()=>{
 expect(stopHint(run(report('normal')),run(report('normal')))).toBeNull();
 expect(stopHint(run(report('normal')),run(report('emergency',{speed:t=>t<=100?0.8:0.3})))).toBeNull();
 expect(stopHint(run(report('normal',{cups:false})),run(report('emergency',{cups:false})))!.en).not.toMatch(/slip/);
});
