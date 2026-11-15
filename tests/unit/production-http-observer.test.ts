import {afterEach,expect,test,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import type {Page,Request,Response} from '@playwright/test';
import {observeProductionHTTP} from '../../scripts/production-http-observer';
afterEach(()=>vi.useRealTimers());
// The real browser test covers the terminal request boundary. This isolates a stalled protocol body read and timer cleanup.
test('bounded body read cannot publish late and finish/dispose remove all owned timers/listeners',async()=>{
 vi.useFakeTimers();const page=new EventEmitter(),rows={responses:[] as Record<string,unknown>[],actions:[],exports:[],errors:[] as string[]};
 let resolveBody!:(body:unknown)=>void;const body=new Promise(r=>{resolveBody=r;});
 const request={url:()=> 'http://fixture/lab/v2/runs/run-1/actions',method:()=> 'POST',timing:()=>({startTime:1000,responseEnd:2}),postDataJSON:()=>({actionId:'pause-1',kind:'pause'})} as Request;
 const response={request:()=>request,status:()=>200,json:()=>body} as Response;
 const observer=observeProductionHTTP(page as unknown as Page,rows,{timeoutMs:100,drainTimeoutMs:50});page.emit('request',request);page.emit('response',response);page.emit('requestfinished',request);
 const finished=observer.finish();await vi.advanceTimersByTimeAsync(50);await finished;expect(rows.responses[0]).toMatchObject({outcome:'timed_out',failure:'DRAIN_DEADLINE',responseEnd:2});expect(rows.errors).toHaveLength(1);expect(vi.getTimerCount()).toBe(0);expect(page.eventNames()).toEqual([]);
 resolveBody({run:{id:'run-1',runRevision:1,status:'paused'},tick:7});await Promise.resolve();expect(rows.actions).toEqual([]);expect(rows.responses).toHaveLength(1);observer.dispose();expect(vi.getTimerCount()).toBe(0);
});
test('dispose before deadline records incompleteness and clears the request timer',()=>{
 vi.useFakeTimers();const page=new EventEmitter(),rows={responses:[] as Record<string,unknown>[],actions:[],exports:[],errors:[] as string[]};const observer=observeProductionHTTP(page as unknown as Page,rows);
 const request={url:()=> 'http://fixture/lab/v2/runs',method:()=> 'POST',timing:()=>({startTime:1000,responseEnd:-1})} as Request;
 page.emit('request',request);observer.dispose();expect(rows.responses[0]).toMatchObject({outcome:'target_closed',status:null,responseEnd:-1});expect(rows.errors).toHaveLength(1);expect(vi.getTimerCount()).toBe(0);expect(page.eventNames()).toEqual([]);
});
