import {expect,test} from 'vitest';
import {applyPageActionTimes,correlatePageActions} from '../../scripts/page-action-clock';
const url='http://h/lab/v2/runs/r1/actions',O=1e12;
test('actions are matched to their own resource entry by actionId on the page timeline',()=>{
 const calls=[{actionId:'b',name:url,callAt:20},{actionId:'a',name:url,callAt:10}],entries=[{name:url,startTime:20.5,responseEnd:30},{name:url,startTime:10.2,responseEnd:15},{name:'http://h/other',startTime:10.1,responseEnd:11}];
 expect(correlatePageActions(calls,entries,O)).toEqual([{actionId:'a',startEpochMs:O+10.2,endEpochMs:O+15},{actionId:'b',startEpochMs:O+20.5,endEpochMs:O+30}]);
});
test('a request that started before the click stays earlier than the click (reader rejects it, nothing is clamped)',()=>{
 const click=O+50,[t]=correlatePageActions([{actionId:'p',name:url,callAt:40}],[{name:url,startTime:40.1,responseEnd:60}],O);
 expect(t!.startEpochMs).toBeLessThan(click);
 const data={actions:[{actionId:'p',requestStartEpochMs:7,responseEndEpochMs:8}],responses:[{actionId:'p',requestStartEpochMs:7,responseEndEpochMs:8},{path:'/x'}]};
 applyPageActionTimes(data,[t!]);
 expect(data.actions[0]).toMatchObject({requestStartEpochMs:O+40.1,responseEndEpochMs:O+60,playwrightRequestStartEpochMs:7,playwrightResponseEndEpochMs:8});expect(data.responses[0]).toMatchObject({requestStartEpochMs:O+40.1});expect(data.responses[1]).toEqual({path:'/x'});
});
test('missing or ambiguous identity is an explicit error, never a silent pass',()=>{
 const entry={name:url,startTime:5,responseEnd:6};
 expect(()=>correlatePageActions([{actionId:undefined,name:url,callAt:1}],[entry],O)).toThrow('PAGE_ACTION_ID_MISSING');
 expect(()=>correlatePageActions([{actionId:'',name:url,callAt:1}],[entry],O)).toThrow('PAGE_ACTION_ID_MISSING');
 expect(()=>correlatePageActions([{actionId:'a',name:url,callAt:1},{actionId:'a',name:url,callAt:2}],[entry,{...entry,startTime:6}],O)).toThrow('PAGE_ACTION_ID_DUPLICATE:a');
 expect(()=>correlatePageActions([{actionId:'a',name:url,callAt:1}],[],O)).toThrow('PAGE_ACTION_REQUEST_MISSING:a');
 expect(()=>correlatePageActions([{actionId:'a',name:url,callAt:9}],[entry],O)).toThrow('PAGE_ACTION_REQUEST_MISSING:a');
 expect(()=>correlatePageActions([],[],0)).toThrow('PAGE_ACTION_CLOCK_ORIGIN_INVALID');
 expect(()=>applyPageActionTimes({actions:[{actionId:'z'}],responses:[]},[])).toThrow('PAGE_ACTION_UNMATCHED:z');
});
