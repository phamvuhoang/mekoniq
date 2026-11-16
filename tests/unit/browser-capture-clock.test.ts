import {expect,test} from 'vitest';
// @ts-expect-error standalone tooling
import * as clock from '../../scripts/browser-capture-clock.mjs';
const fixture=()=>({runId:'r',clock:{nodeTimeOriginEpochMs:100000,browserTimeOriginEpochMs:100100,startEpochMs:100200,endEpochMs:100400,browserStartMs:100,browserEndMs:300},actions:[{runId:'r',actionId:'a',kind:'step',tick:5,requestStartEpochMs:100220,responseEndEpochMs:100250,observedAtEpochMs:100260}],responses:[{runId:'r',actionId:'a',tick:5,requestStartEpochMs:100220,responseEndEpochMs:100250,status:200}]});
test('explicit clocks and unique run/action/tick correlation are required; response receipt is not internal commit time',()=>{
 const f=fixture();expect(clock.checkCaptureClock(f)).toEqual([]);
 for(const mutate of [(x:ReturnType<typeof fixture>)=>{x.clock.browserTimeOriginEpochMs=NaN;},(x:ReturnType<typeof fixture>)=>{x.clock.endEpochMs=0;},(x:ReturnType<typeof fixture>)=>{x.responses.push({...x.responses[0]!});},(x:ReturnType<typeof fixture>)=>{x.responses[0]!.actionId='different';},(x:ReturnType<typeof fixture>)=>{x.responses[0]!.tick=6;}]){const x=fixture();mutate(x);expect(clock.checkCaptureClock(x).length).toBeGreaterThan(0);}
 expect(clock.checkCaptureClock({...f,clock:undefined})).toContain('CAPTURE_CLOCK_MISSING');
});

import {captureFixture} from '../support/r2b-capture';
test('complete coherent observer fixture qualifies with an explicitly separated trailing worker receipt',()=>{const f=captureFixture();expect(clock.assessCapture(f).valid).toBe(true);expect(clock.assessCapture(f).meetsTargets).toBe(true);});
test('review reproducer cannot qualify start-only actions, unbound worker and out-of-window renders',()=>{const record={runId:'r',clock:{nodeTimeOriginEpochMs:100000,browserTimeOriginEpochMs:100100,startEpochMs:100200,endEpochMs:280200,browserStartMs:100,browserEndMs:180100},actions:[{runId:'r',actionId:'start-only',kind:'start',tick:0,requestStartEpochMs:100220,responseEndEpochMs:100250,observedAtEpochMs:100260}],responses:[{runId:'r',actionId:'start-only',tick:0,requestStartEpochMs:100220,responseEndEpochMs:100250,status:200}],capture:{elapsedMs:180000,activeCellMs:180000,fullCellDrawingFrames:1,renderEvents:Array.from({length:9001},(_,i)=>({atMs:1000000000+i*20}))},workerRaw:[{elapsedMs:10}],pause:{clickEpochMs:280300,uiObservedAtEpochMs:1280300},errors:[]};expect(clock.assessCapture(record).meetsTargets).toBe(false);});
test.each(['step','pause','render-window','worker-run','worker-tick','worker-origin','worker-window','active-summary','drawing-summary','final-horizon','pause-correlation','tail-window'])('coherent %s mutation reaches performance observation rejection',kind=>{const f=captureFixture();expect(clock.assessCapture(f).valid).toBe(true);switch(kind){case 'step':for(const a of f.actions)if(a.kind==='step')a.kind='start';break;case 'pause':f.actions=f.actions.filter(a=>a.kind!=='pause');f.responses=f.responses.filter(a=>a.actionId!=='pause');break;case 'render-window':for(const e of f.capture.renderEvents)e.atMs+=1000000000;break;case 'worker-run':f.workerRaw[50]!.runId='other';break;case 'worker-tick':f.workerRaw[50]!.targetTick=1000;f.workerRaw[50]!.expectedTick=1000;break;case 'worker-origin':f.workerRaw[50]!.wallMs+=200;break;case 'worker-window':f.workerRaw[50]!.atEpochMs+=1000000;f.workerRaw[50]!.wallMs+=1000000;break;case 'active-summary':for(const s of f.capture.samples)s.fullCell=false;break;case 'drawing-summary':for(const s of f.capture.samples){s.drawn=false;s.drawCalls=0;}break;case 'final-horizon':f.pause.finalView.tick=100;break;case 'pause-correlation':f.pause.actionId='different';break;case 'tail-window':f.workerOutsideWindow.after[0]!.atEpochMs=f.clock.endEpochMs-1;f.workerOutsideWindow.after[0]!.wallMs=f.clock.endEpochMs-1-f.clock.nodeTimeOriginEpochMs;break;}expect(clock.assessCapture(f).valid).toBe(false);});

test('existing latency budgets apply to coherent observations; pause UI has no added budget',()=>{
 const slowWorker=captureFixture();for(const w of slowWorker.workerRaw)w.elapsedMs=16;const worker=clock.assessCapture(slowWorker);expect(worker.valid).toBe(true);expect(worker.meetsTargets).toBe(false);
 const slowRender=captureFixture();slowRender.capture.renderEvents=slowRender.capture.renderEvents.filter((_,i)=>i%2===0);for(const [i,s]of slowRender.capture.samples.entries()){s.drawn=i%2===0;s.drawCalls=s.drawn?1:0;}const render=clock.assessCapture(slowRender);expect(render.valid).toBe(true);expect(render.metrics.renderIntervalP95Ms).toBe(40);expect(render.meetsTargets).toBe(false);
 const lateReceipt=captureFixture(),tail=lateReceipt.actions.find(a=>a.actionId==='tail')!;tail.observedAtEpochMs=lateReceipt.pause.clickEpochMs+501;const receipt=clock.assessCapture(lateReceipt);expect(receipt.valid).toBe(true);expect(receipt.metrics.lastStepReceiptMs).toBe(501);expect(receipt.meetsTargets).toBe(false);
 const slowUI=captureFixture();slowUI.pause.uiObservedAtEpochMs+=1000000;expect(clock.assessCapture(slowUI).meetsTargets).toBe(true);
});
test('missing streams remain unavailable rather than a zero latency pass',()=>{for(const stream of ['workerRaw','renders','steps']){const f=captureFixture();if(stream==='workerRaw')f.workerRaw=[];else if(stream==='renders')f.capture.renderEvents=[];else f.actions=f.actions.filter(a=>a.kind!=='step');const result=clock.assessCapture(f);expect(result.valid).toBe(false);expect(result.meetsTargets).toBe(false);if(stream==='workerRaw')expect(result.metrics.workerP95Ms).toBeNull();if(stream==='renders')expect(result.metrics.renderIntervalP95Ms).toBeNull();if(stream==='steps')expect(result.metrics.lastStepReceiptMs).toBeNull();}});

function lowerDrawCadence(){
 const f=captureFixture();f.capture.samples=Array.from({length:18501},(_,i)=>({at:i*10,interval:i?10:0,drawn:i%2===0,drawCalls:i%2===0?1:0,fullCell:true,tick:Math.min(1850,Math.floor(i/10)),worldTick:Math.min(1850,Math.floor(i/10))}));return f;
}
test('active moving-world wall duration admits genuine 20 ms draws sampled by 10 ms RAF',()=>{
 const f=lowerDrawCadence(),r=clock.assessCapture(f);expect(r.issues).toEqual([]);expect(r.metrics.activeCellMs).toBe(185000);expect(r.metrics.fullCellDrawingMs).toBe(92500);expect(r.metrics.renderIntervalP95Ms).toBe(20);expect(r.meetsTargets).toBe(true);
});
test.each(['short','frozen','missing','gap'])('coherent %s activity cannot qualify by summary duration or repeated repaint',kind=>{
 const f=lowerDrawCadence();
 if(kind==='short'){f.capture.samples=f.capture.samples.filter(s=>s.at<179000);f.capture.renderEvents=f.capture.renderEvents.filter(s=>s.atMs<f.clock.browserStartMs+179000);}
 if(kind==='frozen'){for(const s of f.capture.samples)s.worldTick=0;for(const e of f.capture.renderEvents)e.worldTick=0;}
 if(kind==='missing'){f.capture.renderEvents=[];for(const s of f.capture.samples){s.drawn=false;s.drawCalls=0;}}
 if(kind==='gap'){f.capture.samples=f.capture.samples.filter(s=>s.at<=90000||s.at>=92000);for(let i=1;i<f.capture.samples.length;i++)f.capture.samples[i]!.interval=f.capture.samples[i]!.at-f.capture.samples[i-1]!.at;f.capture.renderEvents=f.capture.renderEvents.filter(s=>s.atMs<=f.clock.browserStartMs+90000||s.atMs>=f.clock.browserStartMs+92000);}
 const r=clock.assessCapture(f);expect(r.valid).toBe(false);expect(r.issues).toContain(kind==='short'?'CAPTURE_ACTIVE_DRAWING_DURATION':kind==='frozen'?'CAPTURE_RENDER_PROGRESSION':kind==='missing'?'CAPTURE_RENDER_STREAM':'CAPTURE_STREAM_GAP');
});

test('a final priority-paused batch covers its exact actual prefix, never its unexecuted requested tail',()=>{
 const f=captureFixture(),tail=f.actions.find(a=>a.actionId==='tail')! as typeof f.actions[number]&{revision:number;expectedRevision:number},pause=f.actions.find(a=>a.actionId==='pause')! as typeof tail;
 Object.assign(tail,{payload:{ticks:50}});tail.status='paused';tail.expectedRevision=10;tail.revision=12;pause.expectedRevision=10;pause.revision=11;pause.requestStartEpochMs=f.clock.endEpochMs+40;f.pause.clickEpochMs=pause.requestStartEpochMs;
 f.responses.find(r=>r.actionId==='pause')!.requestStartEpochMs=pause.requestStartEpochMs;
 expect(clock.assessCapture(f).issues).toEqual([]);expect(clock.assessCapture(f).meetsTargets).toBe(true);
 for(const change of ['worker','revision','earlier'] as const){const bad=structuredClone(f);if(change==='worker')bad.workerOutsideWindow.after=[];if(change==='revision')(bad.actions.find(a=>a.actionId==='pause')! as typeof pause).expectedRevision=9;if(change==='earlier')Object.assign(bad.actions[10]!,{payload:{ticks:50}});expect(clock.assessCapture(bad).valid,change).toBe(false);}
});

test('continuous repaint cannot hide a long frozen Source horizon inside an otherwise advancing capture',()=>{
 const f=captureFixture();for(const e of f.capture.renderEvents)if(e.atMs>=f.clock.browserStartMs+90000&&e.atMs<f.clock.browserStartMs+92000)e.worldTick=900;
 for(const s of f.capture.samples)if(s.at>=90000&&s.at<92000)s.worldTick=900;
 const r=clock.assessCapture(f);expect(r.valid).toBe(false);expect(r.issues).toContain('CAPTURE_RENDER_PROGRESSION');
});
