import {expect,test,vi} from 'vitest';
import {FetchEventSource} from '../../src/runtime/fetch-event-source';
// A fake fetch whose body is a ReadableStream the test writes into chunk by chunk.
function server(status=200,type='text/event-stream'){
 let ctl!:ReadableStreamDefaultController<Uint8Array>;const enc=new TextEncoder(),calls:{url:string;init:RequestInit}[]=[];
 const body=new ReadableStream<Uint8Array>({start:c=>{ctl=c;}});
 const fetch=vi.fn(async(url:string,init:RequestInit)=>{calls.push({url,init});
  init.signal?.addEventListener('abort',()=>{try{ctl.error(new DOMException('aborted','AbortError'));}catch{/* already closed */}});
  return new Response(status===200?body:'{"error":"SESSION_REQUIRED"}',{status,headers:{'Content-Type':status===200?type:'application/json'}});});
 return {fetch:fetch as unknown as typeof globalThis.fetch,calls,send:(s:string)=>ctl.enqueue(enc.encode(s)),end:()=>ctl.close()};
}
const flush=()=>new Promise(r=>setTimeout(r,5));

test('parses id/event/data across chunks, CRLF, multi-line data, comments and retry; lastEventId carries over; opens on 200 with the bearer',async()=>{
 const s=server(),es=new FetchEventSource('http://127.0.0.1:4176/lab/v2/runs/r/events?after=4',{headers:{Authorization:'Bearer tok'},fetch:s.fetch,extra:{credentials:'omit'}});
 const got:[string,string,string][]=[],opened=vi.fn(),errors=vi.fn();es.onopen=opened;es.onerror=errors;
 for(const type of ['business','heartbeat','message'])es.addEventListener(type,e=>got.push([type,e.data,e.lastEventId]));
 expect(es.readyState).toBe(0);
 await flush();expect(opened).toHaveBeenCalledTimes(1);expect(es.readyState).toBe(1);
 expect(s.calls[0]!.url).toBe('http://127.0.0.1:4176/lab/v2/runs/r/events?after=4');
 expect(new Headers(s.calls[0]!.init.headers).get('Authorization')).toBe('Bearer tok');expect(s.calls[0]!.init.credentials).toBe('omit');
 s.send(': keep-alive\nretry: 1000\nid: 5\nevent: busi');s.send('ness\ndata: {"sequence":"5"}\n\n');
 s.send('event: heartbeat\r\ndata: {"tick":1}\r');s.send('\n\r\n');// CRLF split between chunks: one line break, not two
 s.send('data: line one\ndata:line two\n\n');
 s.send('id: 6\nevent: business\ndata: {"sequence":"6"}\n\nevent: business\ndata: half');// the last record is never finished
 await flush();
 expect(got).toEqual([['business','{"sequence":"5"}','5'],['heartbeat','{"tick":1}','5'],['message','line one\nline two','5'],['business','{"sequence":"6"}','6']]);
 expect(errors).not.toHaveBeenCalled();
 s.end();await flush();
 expect(got).toHaveLength(4);expect(es.readyState).toBe(2);expect(errors).toHaveBeenCalledTimes(1);
 await flush();expect(errors).toHaveBeenCalledTimes(1);// exactly once; no reconnect of its own
 expect(s.calls).toHaveLength(1);
});

test('a refused stream (401) is closed with one error and never opens',async()=>{
 const s=server(401),es=new FetchEventSource('/lab/v2/runs/r/events',{fetch:s.fetch}),opened=vi.fn(),errors=vi.fn();es.onopen=opened;es.onerror=errors;
 await flush();expect(es.readyState).toBe(2);expect(errors).toHaveBeenCalledTimes(1);expect(opened).not.toHaveBeenCalled();
});

test('a network error is closed with one error',async()=>{
 const es=new FetchEventSource('/x',{fetch:(()=>Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch}),errors=vi.fn();es.onerror=errors;
 await flush();expect(es.readyState).toBe(2);expect(errors).toHaveBeenCalledTimes(1);
});

test('close() aborts the fetch and reports no error, before or after the stream opened',async()=>{
 const s=server(),es=new FetchEventSource('/lab/v2/runs/r/telemetry',{fetch:s.fetch}),errors=vi.fn(),got=vi.fn();es.onerror=errors;es.addEventListener('sample',got);
 await flush();expect(es.readyState).toBe(1);
 es.close();expect(es.readyState).toBe(2);expect(s.calls[0]!.init.signal!.aborted).toBe(true);
 await flush();expect(errors).not.toHaveBeenCalled();
 const early=server(),closed=new FetchEventSource('/y',{fetch:early.fetch}),errors2=vi.fn();closed.onerror=errors2;closed.close();
 await flush();expect(errors2).not.toHaveBeenCalled();expect(closed.readyState).toBe(2);
});

test('a 200 that is not text/event-stream is a failure (a proxy page, a JSON error), never opened',async()=>{
 const s=server(200,'text/html'),es=new FetchEventSource('/x',{fetch:s.fetch}),opened=vi.fn(),errors=vi.fn();es.onopen=opened;es.onerror=errors;
 await flush();expect(es.readyState).toBe(2);expect(errors).toHaveBeenCalledTimes(1);expect(opened).not.toHaveBeenCalled();
 const ok=server(200,'text/event-stream; charset=utf-8'),es2=new FetchEventSource('/y',{fetch:ok.fetch});await flush();expect(es2.readyState).toBe(1);es2.close();
});

test('an unparsed buffer beyond 1 MiB fails once and aborts the request',async()=>{
 const s=server(),es=new FetchEventSource('/x',{fetch:s.fetch}),errors=vi.fn(),got=vi.fn();es.onerror=errors;es.addEventListener('message',got);
 await flush();
 s.send('data: '+'x'.repeat(600*1024));await flush();expect(errors).not.toHaveBeenCalled();// one line without a break, still under the bound
 s.send('x'.repeat(600*1024));await flush();
 expect(es.readyState).toBe(2);expect(errors).toHaveBeenCalledTimes(1);expect(s.calls[0]!.init.signal!.aborted).toBe(true);expect(got).not.toHaveBeenCalled();
 await flush();expect(errors).toHaveBeenCalledTimes(1);
});

test('one network chunk over 1 MiB made of complete records is parsed, not refused (the bound applies to what stays unparsed)',async()=>{
 const s=server(),es=new FetchEventSource('/x',{fetch:s.fetch}),errors=vi.fn(),got:string[]=[];es.onerror=errors;es.addEventListener('message',e=>got.push(e.data));
 await flush();
 const big='y'.repeat(500*1024);s.send(`data: ${big}\n\ndata: ${big}\n\ndata: ${big}\n\n`);await flush();
 expect(errors).not.toHaveBeenCalled();expect(got).toHaveLength(3);expect(es.readyState).toBe(1);es.close();
});
