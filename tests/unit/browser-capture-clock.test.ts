import {expect,test} from 'vitest';
// @ts-expect-error standalone tooling
import * as clock from '../../scripts/browser-capture-clock.mjs';
const fixture=()=>({runId:'r',clock:{nodeTimeOriginEpochMs:100000,browserTimeOriginEpochMs:100100,startEpochMs:100200,endEpochMs:100400,browserStartMs:100,browserEndMs:300},actions:[{runId:'r',actionId:'a',kind:'step',tick:5,requestStartEpochMs:100220,responseEndEpochMs:100250,observedAtEpochMs:100260}],responses:[{runId:'r',actionId:'a',tick:5,requestStartEpochMs:100220,responseEndEpochMs:100250,status:200}]});
test('explicit clocks and unique run/action/tick correlation are required; response receipt is not internal commit time',()=>{
 const f=fixture();expect(clock.checkCaptureClock(f)).toEqual([]);
 for(const mutate of [(x:ReturnType<typeof fixture>)=>{x.clock.browserTimeOriginEpochMs=NaN;},(x:ReturnType<typeof fixture>)=>{x.clock.endEpochMs=0;},(x:ReturnType<typeof fixture>)=>{x.responses.push({...x.responses[0]!});},(x:ReturnType<typeof fixture>)=>{x.responses[0]!.actionId='different';},(x:ReturnType<typeof fixture>)=>{x.responses[0]!.tick=6;}]){const x=fixture();mutate(x);expect(clock.checkCaptureClock(x).length).toBeGreaterThan(0);}
 expect(clock.checkCaptureClock({...f,clock:undefined})).toContain('CAPTURE_CLOCK_MISSING');
});

test('performance targets are recalculated from observations and reject empty/slow streams despite claimed booleans',()=>{
 const f={...fixture(),clock:{...fixture().clock,endEpochMs:280200,browserEndMs:180100},capture:{elapsedMs:180000,activeCellMs:180000,renderEvents:Array.from({length:9001},(_,i)=>({atMs:100+i*20})),fullCellDrawingFrames:9001},workerRaw:[{elapsedMs:10}],pause:{clickEpochMs:280300,uiObservedAtEpochMs:280400},errors:[],targets:{durationMet:true,displayMet:true,workerMet:true,pauseMet:true}};
 expect(clock.assessCapture(f).meetsTargets).toBe(true);
 expect(clock.assessCapture({...f,workerRaw:[]}).valid).toBe(false);
 expect(clock.assessCapture({...f,workerRaw:[{elapsedMs:100}]}).meetsTargets).toBe(false);
 expect(clock.assessCapture({...f,capture:{...f.capture,renderEvents:[]}}).valid).toBe(false);
});
