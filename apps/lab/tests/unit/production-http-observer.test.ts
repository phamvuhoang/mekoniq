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

test('release and publication correlate after drain even when publication JSON observation completes later',async()=>{
 const page=new EventEmitter(),rows={responses:[] as Record<string,unknown>[],actions:[],exports:[] as Record<string,unknown>[],errors:[] as string[]};let publication!:(v:unknown)=>void;
 const body=new Promise(r=>{publication=r;}),observer=observeProductionHTTP(page as unknown as Page,rows,{timeoutMs:1000,drainTimeoutMs:1000});
 const request=(path:string,method:string)=>({url:()=> 'http://fixture/lab/v2/runs/run-1/'+path,method:()=>method,timing:()=>({startTime:1000,responseEnd:2})}) as Request;
 const post=request('replay','POST'),remove=request('replay/export-1','DELETE');
 for(const [r,status,json] of [[post,201,()=>body],[remove,200,async()=>({deleted:true})]] as const){page.emit('request',r);page.emit('response',{request:()=>r,status:()=>status,json} as Response);page.emit('requestfinished',r);}
 await Promise.resolve();await Promise.resolve();expect(rows.exports).toEqual([]);expect(rows.errors).toEqual([]);expect(rows.responses[0]).toMatchObject({method:'DELETE',outcome:'completed',runId:'run-1',exportId:'export-1'});
 let drained=false;const finish=observer.finish().then(()=>{drained=true;});await Promise.resolve();expect(drained).toBe(false);
 publication({exportId:'export-1',manifest:{documentType:'web-replay-package',runId:'run-1',horizon:{tick:7}}});await finish;expect(rows.errors).toEqual([]);expect(rows.exports[0]).toMatchObject({exportId:'export-1',runId:'run-1'});expect(rows.responses).toHaveLength(2);expect(page.eventNames()).toEqual([]);
});
