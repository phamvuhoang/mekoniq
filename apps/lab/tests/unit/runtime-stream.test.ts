import {expect,test,vi} from 'vitest';
import {openRunStreams,type LinkState} from '../../src/runtime/stream';
// Fake EventSource: records URLs, lets the test emit named events, errors and closes like the browser does.
class FakeES {
 static all:FakeES[]=[];static CONNECTING=0;static OPEN=1;static CLOSED=2;
 readyState=0;listeners=new Map<string,((e:MessageEvent)=>void)[]>();onerror:((e:Event)=>void)|null=null;onopen:((e:Event)=>void)|null=null;closed=false;
 constructor(readonly url:string,readonly init?:EventSourceInit){FakeES.all.push(this);}
 addEventListener(type:string,f:(e:MessageEvent)=>void){this.listeners.set(type,[...this.listeners.get(type)??[],f]);}
 emit(type:string,data:unknown,lastEventId=''){this.readyState=1;for(const f of this.listeners.get(type)??[])f({data:JSON.stringify(data),lastEventId} as MessageEvent);}
 open(){this.readyState=1;this.onopen?.(new Event('open'));}
 fail(state:0|2){this.readyState=state;this.onerror?.(new Event('error'));}
 close(){this.closed=true;this.readyState=2;}
}
const flush=()=>new Promise(r=>setTimeout(r,0));
function harness(fetchImpl:(url:string)=>Promise<Response>,o:{visible?:boolean;es?:boolean;network?:EventTarget}={}){
 FakeES.all=[];const states:LinkState[]=[],got:Record<string,unknown[]>={business:[],reset:[],sample:[],gap:[],heartbeat:[],snapshot:[]};
 const s=openRunStreams('run-1','41',{onState:x=>states.push(x),onBusiness:e=>got.business!.push(e),onReset:(v,r)=>got.reset!.push([r,v]),onSample:x=>got.sample!.push(x),onGap:g=>got.gap!.push(g),onHeartbeat:h=>got.heartbeat!.push(h),onSnapshot:v=>got.snapshot!.push(v)},
  {base:'/lab/v2',EventSource:o.es===false?undefined:FakeES as unknown as typeof EventSource,fetch:vi.fn(fetchImpl) as unknown as typeof fetch,visible:()=>o.visible??true,network:o.network??null});
 return {s,states,got};
}
const ok=(body:unknown,status=200)=>Promise.resolve(new Response(JSON.stringify(body),{status}));

test('opens separate business and telemetry streams; the business stream starts after the snapshot cursor',async()=>{
 const {s,states,got}=harness(()=>ok({}));
 const [events,telemetry]=FakeES.all;
 expect(events!.url).toBe('/lab/v2/runs/run-1/events?after=41');expect(telemetry!.url).toBe('/lab/v2/runs/run-1/telemetry');
 expect(events!.init).toEqual({withCredentials:true});
 events!.open();expect(states.at(-1)).toBe('live');
 events!.emit('business',{sequence:'42',at:'t',events:[]},'42');telemetry!.emit('sample',{entityId:'amr-1',seq:'5'},'5');telemetry!.emit('gap',{reason:'BACKPRESSURE',dropped:2});
 events!.emit('heartbeat',{monotonicNs:'1',tick:5,paused:false,runRevision:3});
 expect(got.business).toHaveLength(1);expect(got.sample).toHaveLength(1);expect(got.gap).toEqual([{reason:'BACKPRESSURE',dropped:2}]);expect(got.heartbeat).toHaveLength(1);
 expect(s.lastEventId).toBe('42');
 events!.emit('reset',{reason:'CURSOR_TOO_OLD',cursor:'1',snapshot:{run:{eventCursor:'90'}}},'90');
 expect(got.reset).toEqual([['CURSOR_TOO_OLD',{run:{eventCursor:'90'}}]]);expect(s.lastEventId).toBe('90');
 s.close();expect(FakeES.all.every(e=>e.closed)).toBe(true);expect(states.at(-1)).toBe('closed');
});

test('a dropped connection that the browser retries is "reconnecting", not live',()=>{
 const {states}=harness(()=>ok({}));
 FakeES.all[0]!.open();FakeES.all[0]!.fail(0);
 expect(states.at(-1)).toBe('reconnecting');
 FakeES.all[0]!.open();expect(states.at(-1)).toBe('live');
});

test('a stream refused by the runtime is classified by a probe: 401 needs re-pairing, 404 lost run, network error lost runtime',async()=>{
 for(const [res,state] of [[()=>ok({error:'SESSION_REQUIRED'},401),'session_lost'],[()=>ok({error:'RUN_NOT_FOUND'},404),'run_lost'],[()=>Promise.reject(new TypeError('fetch failed')),'runtime_lost'],[()=>ok({},502),'runtime_lost']] as const){
  const {states,s}=harness(res);
  FakeES.all[0]!.fail(2);await flush();await flush();
  expect(states.at(-1)).toBe(state);
  if(state!=='runtime_lost')expect(FakeES.all.every(e=>e.closed)).toBe(true);
  s.close();
 }
});

test('the runtime coming back after a loss means a new session: the next probe reports session_lost',async()=>{
 vi.useFakeTimers();
 try{
  let up=false;const {states,s}=harness(()=>up?ok({error:'SESSION_REQUIRED'},401):Promise.reject(new TypeError('down')));
  FakeES.all[0]!.fail(2);await vi.advanceTimersByTimeAsync(0);expect(states.at(-1)).toBe('runtime_lost');
  up=true;await vi.advanceTimersByTimeAsync(2000);expect(states.at(-1)).toBe('session_lost');
  s.close();
 }finally{vi.useRealTimers();}
});

test('without EventSource it polls the snapshot: 500 ms in the foreground, 2 s in the background',async()=>{
 vi.useFakeTimers();
 try{
  let n=0;const visible={v:true};FakeES.all=[];
  const got:unknown[]=[],states:LinkState[]=[];
  const s=openRunStreams('run-1','41',{onSnapshot:v=>got.push(v),onState:x=>states.push(x)},{base:'/lab/v2',EventSource:undefined,fetch:(()=>{n++;return ok({run:{id:'run-1',eventCursor:'41'}});}) as unknown as typeof fetch,visible:()=>visible.v});
  await vi.advanceTimersByTimeAsync(1100);expect(n).toBe(2);expect(states.at(-1)).toBe('polling');expect(got).toHaveLength(2);
  visible.v=false;await vi.advanceTimersByTimeAsync(4100);expect(n).toBeLessThanOrEqual(5);expect(n).toBeGreaterThanOrEqual(3);
  expect(FakeES.all).toHaveLength(0);
  s.close();const before=n;await vi.advanceTimersByTimeAsync(5000);expect(n).toBe(before);
 }finally{vi.useRealTimers();}
});

test('network loss drops the streams at once; back online they reopen from the last durable cursor',()=>{
 const network=new EventTarget(),{states,s}=harness(()=>ok({}),{network});
 const [events]=FakeES.all;events!.open();events!.emit('business',{sequence:'57',at:'t',events:[]},'57');
 network.dispatchEvent(new Event('offline'));
 expect(states.at(-1)).toBe('reconnecting');expect(FakeES.all.every(e=>e.closed)).toBe(true);
 network.dispatchEvent(new Event('online'));
 expect(FakeES.all).toHaveLength(4);expect(FakeES.all[2]!.url).toBe('/lab/v2/runs/run-1/events?after=57');
 FakeES.all[2]!.open();expect(states.at(-1)).toBe('live');
 s.close();
});

test('a stream that stays open but silent past the heartbeat deadline is treated as dropped and reopened',async()=>{
 vi.useFakeTimers();
 try{
  const {states,s}=harness(()=>ok({}));
  FakeES.all[0]!.open();FakeES.all[0]!.emit('heartbeat',{monotonicNs:'1',tick:0,paused:false,runRevision:1});
  await vi.advanceTimersByTimeAsync(4000);expect(FakeES.all).toHaveLength(2);
  FakeES.all[1]!.emit('heartbeat',{monotonicNs:'2',tick:0,paused:false,runRevision:1});
  await vi.advanceTimersByTimeAsync(4000);expect(FakeES.all).toHaveLength(2); // heartbeats on either stream keep it alive
  await vi.advanceTimersByTimeAsync(2000);expect(FakeES.all).toHaveLength(4);expect(states).toContain('reconnecting');
  expect(FakeES.all.slice(0,2).every(e=>e.closed)).toBe(true);
  s.close();
 }finally{vi.useRealTimers();}
});

test('refused SSE with a healthy snapshot uses bounded backoff then polling without a reconnect loop',async()=>{
 vi.useFakeTimers();
 try{
  let probes=0;const {s,got}=harness(()=>{probes++;return ok({run:{id:'run-1',runRevision:probes}});});
  for(const delay of [500,1000,2000]){const current=FakeES.all.slice(-2);current.forEach(e=>e.fail(2));await vi.advanceTimersByTimeAsync(0);const count=FakeES.all.length;await vi.advanceTimersByTimeAsync(delay-1);expect(FakeES.all).toHaveLength(count);await vi.advanceTimersByTimeAsync(1);}
  expect(FakeES.all.length).toBeLessThanOrEqual(6);expect(s.state).toBe('polling');expect(got.snapshot!.length).toBeGreaterThan(1);const count=FakeES.all.length;await vi.advanceTimersByTimeAsync(5000);expect(FakeES.all).toHaveLength(count);s.close();
 }finally{vi.useRealTimers();}
});
