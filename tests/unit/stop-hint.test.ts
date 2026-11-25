import {expect,test} from 'vitest';
import {stopHint} from '../../packages/lab-runtime/src/v2/control/stop-hint';
import {buildStopReport} from '../../packages/lab-runtime/src/v2/control/stop-report';
import {AXES,POLICY,decel,records} from '../support/stop-records';

const SRC={kind:'assumed' as const,documentId:'x',revision:'1',locator:'y',contentSha256:'e'.repeat(64)};
const report=(fn:'normal'|'protective'|'emergency',speed:(t:number)=>number=decel,cups=true)=>buildStopReport({runId:'r',entry:{id:'s',function:fn,trigger:{kind:'elapsed_sim_ms',value:1980}},intents:[{tick:100,intents:[{entryId:'s',function:fn,appliedBy:fn==='emergency'?'worker':'controller',targetTick:100}]}],
 receipts:[{entryId:'s',function:fn,appliedBy:fn==='emergency'?'worker':'controller',appliedTick:100,runId:'r',bootId:'b',sceneDigest:'a'.repeat(64),requestDigest:'b'.repeat(64)}],
 records:records({ticks:700,speed,...cups?{cups:t=>({slipM:t>100?0.002:0})}:{}}),policy:POLICY,chainAxes:AXES,wheelRadiusM:0.1,attention:[],served:'0',status:'needs_attention',servedAfterStop:false,decidingParameters:[{id:'rolling',value:1,source:SRC}]});

test('two reports that differ only in the function give one sentence in three languages, each with both distances and the closing limit',()=>{
 const slow=(t:number)=>t<=100?0.8:Math.max(0,0.8-0.2*0.02*(t-100));
 const h=stopHint(report('normal'),report('emergency',slow))!;
 expect(h).not.toBeNull();
 for(const s of [h.vi,h.ja,h.en]){expect(s.length).toBeGreaterThan(40);expect(s).toMatch(/0\.6\d/);}
 expect(h.en).toMatch(/not measured/);expect(h.vi).toMatch(/chưa được đo/);expect(h.ja).toMatch(/未測定/);expect(h.en).toMatch(/cups slip at most/);
});
test('it is null when the reports differ in more than the function, when they are the same function, or when a distance is not available',()=>{
 expect(stopHint(report('normal'),report('emergency'),{sameInputsExceptFunction:false})).toBeNull();
 expect(stopHint(report('normal'),report('normal'))).toBeNull();
 expect(stopHint(report('normal'),report('emergency',t=>t<=100?0.8:0.3))).toBeNull();
});
test('a run without cups gets the sentence without the slip clause',()=>{
 expect(stopHint(report('normal',decel,false),report('emergency',decel,false))!.en).not.toMatch(/slip/);
});
