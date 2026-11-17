import {expect,test} from 'vitest';
import {applyPageActionTimes,correlatePageActions} from '../../scripts/page-action-clock';
// @ts-expect-error Source-owned standalone reader, imported read-only like scripts/measure-cell-production.ts does
import {assessCapture,checkCaptureClock} from '../../../source/scripts/browser-capture-clock.mjs';
import {captureFixture} from '../../../source/tests/support/r2b-capture';
const url='http://h/lab/v2/runs/r1/actions',O=1e12;
test('actions are matched to their own resource entry by actionId on the page timeline',()=>{
 const calls=[{actionId:'b',name:url,callAt:20},{actionId:'a',name:url,callAt:10}],entries=[{name:url,startTime:20.5,responseEnd:30},{name:url,startTime:10.2,responseEnd:15}];
 expect(correlatePageActions(calls,entries,O,2)).toEqual([{actionId:'a',startEpochMs:O+10.2,endEpochMs:O+15},{actionId:'b',startEpochMs:O+20.5,endEpochMs:O+30}]);
});
test('a request that started before the click stays earlier than the click (reader rejects it, nothing is clamped)',()=>{
 const click=O+50,[t]=correlatePageActions([{actionId:'p',name:url,callAt:40}],[{name:url,startTime:40.1,responseEnd:60}],O,1);
 expect(t!.startEpochMs).toBeLessThan(click);
 const data={actions:[{actionId:'p',requestStartEpochMs:7,responseEndEpochMs:8}],responses:[{actionId:'p',requestStartEpochMs:7,responseEndEpochMs:8},{path:'/x'}]};
 applyPageActionTimes(data,[t!]);
 expect(data.actions[0]).toMatchObject({requestStartEpochMs:O+40.1,responseEndEpochMs:O+60,pageClockOffsetMs:O+40.1-7,playwrightRequestStartEpochMs:7,playwrightResponseEndEpochMs:8});expect(data.responses[0]).toMatchObject({requestStartEpochMs:O+40.1});expect(data.responses[1]).toEqual({path:'/x'});
});
test('missing or ambiguous identity is an explicit error, never a silent pass',()=>{
 const entry={name:url,startTime:5,responseEnd:6};
 expect(()=>correlatePageActions([{actionId:undefined,name:url,callAt:1}],[entry],O,1)).toThrow('PAGE_ACTION_ID_MISSING');
 expect(()=>correlatePageActions([{actionId:'',name:url,callAt:1}],[entry],O,1)).toThrow('PAGE_ACTION_ID_MISSING');
 expect(()=>correlatePageActions([{actionId:'a',name:url,callAt:1},{actionId:'a',name:url,callAt:2}],[entry,{...entry,startTime:6}],O,2)).toThrow('PAGE_ACTION_ID_DUPLICATE:a');
 expect(()=>correlatePageActions([{actionId:'a',name:url,callAt:1}],[{...entry,name:'http://h/other'}],O,1)).toThrow('PAGE_ACTION_REQUEST_MISSING:a');
 expect(()=>correlatePageActions([{actionId:'a',name:url,callAt:9}],[entry],O,1)).toThrow('PAGE_ACTION_REQUEST_MISSING:a');
 expect(()=>correlatePageActions([],[],0,0)).toThrow('PAGE_ACTION_CLOCK_ORIGIN_INVALID');
 expect(()=>applyPageActionTimes({actions:[{actionId:'z'}],responses:[]},[])).toThrow('PAGE_ACTION_UNMATCHED:z');
});
test('calls, entries and action rows must be one-to-one',()=>{
 const call={actionId:'a',name:url,callAt:1},entry={name:url,startTime:5,responseEnd:6};
 expect(()=>correlatePageActions([call],[entry,{...entry,startTime:7}],O,1)).toThrow('PAGE_ACTION_COUNT_MISMATCH:calls=1,entries=2,actions=1');
 expect(()=>correlatePageActions([call,{...call,actionId:'b',callAt:2}],[entry],O,2)).toThrow('PAGE_ACTION_COUNT_MISMATCH');
 expect(()=>correlatePageActions([call],[entry],O,2)).toThrow('PAGE_ACTION_COUNT_MISMATCH:calls=1,entries=1,actions=2');
});
test('end to end: the real reader still rejects a pause whose page-clock request start precedes the click',()=>{
 const f=captureFixture(),pause=f.actions.at(-1)!,row=f.responses.at(-1)!,click=f.pause.clickEpochMs;
 expect(assessCapture(f).issues).not.toContain('CAPTURE_PAUSE_CORRELATION');
 const times=(start:number)=>[...f.actions.slice(0,-1).map(a=>({actionId:a.actionId,startEpochMs:a.requestStartEpochMs,endEpochMs:a.responseEndEpochMs})),{actionId:'pause',startEpochMs:start,endEpochMs:pause.responseEndEpochMs}];
 applyPageActionTimes(f,times(click+10));
 expect(checkCaptureClock(f)).toEqual([]);expect(assessCapture(f).issues).not.toContain('CAPTURE_PAUSE_CORRELATION');
 applyPageActionTimes(f,times(click-0.5));
 expect(row.requestStartEpochMs).toBe(click-0.5);expect(assessCapture(f).issues).toContain('CAPTURE_PAUSE_CORRELATION');
});
