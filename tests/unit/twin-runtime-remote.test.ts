import {afterEach,expect,test,vi} from 'vitest';
import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import type {AddressInfo} from 'node:net';
import {httpTwinRuntime,TwinRuntimeError,type RunView,type TwinRuntime} from '../../src/scenarios/controls';
import {openRunStreams,type LinkState} from '../../src/runtime/stream';
import type {RunReport} from '../../src/scenarios/controls';
import {coffeeReplay} from '../support/coffee-replay';
/** A report made from a view: the same run, tick and status. */
const reportOf=(v:RunView):RunReport=>{const {report}=coffeeReplay();return {...report,manifest:{...report.manifest,runId:v.run.id},outcome:{...report.outcome,tick:v.tick,status:v.run.status,simTimeNs:v.simTimeNs}};};
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
const flush=()=>new Promise(r=>setTimeout(r,5));
/** A stand-in gateway on an ephemeral loopback port: bearer only (401 without it), pairing, health, a run and its two SSE streams. */
async function gateway(){
 const seen:{method:string;url:string;auth:string|undefined;csrf:string|undefined}[]=[];let eventsOpened=0;const state={revoked:false};
 const sse=(res:ServerResponse)=>res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store'});
 const record=(seq:number)=>`id: ${seq}\nevent: business\ndata: ${JSON.stringify({sequence:String(seq),at:'t',events:[]})}\n\n`;
 const server=createServer((req:IncomingMessage,res:ServerResponse)=>{
  const url=new URL(req.url!,'http://x');seen.push({method:req.method!,url:req.url!,auth:req.headers.authorization,csrf:req.headers['x-csrf-token'] as string|undefined});
  const json=(status:number,body:unknown)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
  if(url.pathname==='/lab/v2/health')return json(200,{sourceCommit:'b'.repeat(40),schemaHash:'s',protocolMajors:[2],features:{bearer:true,pacedStep:true}});
  if(url.pathname==='/lab/v2/sessions'&&req.method==='POST')return json(201,{csrfToken:'csrf-1',sessionToken:'tok-1',principal:'p'});
  if(req.headers.authorization!=='Bearer tok-1'||state.revoked)return json(401,{error:'SESSION_REQUIRED'});
  if(url.pathname==='/lab/v2/runs/r1')return json(200,{run:{id:'r1',runRevision:7}});
  if(url.pathname==='/lab/v2/runs/r1/actions')return json(200,{run:{id:'r1',runRevision:8}});
  if(url.pathname==='/lab/v2/runs/r1/telemetry'){sse(res);res.write(': open\n\n');return;}
  if(url.pathname==='/lab/v2/runs/r1/events'){
   sse(res);eventsOpened++;const after=Number(url.searchParams.get('after')??0);
   // first connection: records 1 and 2, then the server cuts the stream; the next connection resumes after the cursor
   if(eventsOpened===1){res.write(record(after+1));res.write(record(after+2));setTimeout(()=>res.end(),30);}
   else for(let s=after+1;s<=3;s++)res.write(record(s));
   return;
  }
  json(404,{error:'NOT_FOUND'});
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const port=(server.address() as AddressInfo).port;
 return {seen,state,base:`http://127.0.0.1:${port}/lab/v2`,close:()=>new Promise<void>(r=>{server.closeAllConnections();server.close(()=>r());})};
}

const memory=()=>{const m=new Map<string,string>();return {m,get length(){return m.size;},key:(i:number)=>[...m.keys()][i]??null,getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>void m.set(k,v),removeItem:(k:string)=>void m.delete(k)};};
test('a loopback target pairs once, then sends the bearer (never a CSRF header or a cookie) and forgets it on 401',async()=>{
 const g=await gateway(),session=memory();vi.stubGlobal('sessionStorage',session);
 try{
  const rt=httpTwinRuntime({base:g.base,kind:'loopback'});
  expect(rt.target).toEqual({base:g.base,kind:'loopback'});expect(rt.paired).toBe(false);
  await rt.pair('one-use');expect(rt.paired).toBe(true);
  await rt.action({run:{id:'r1',runRevision:7}} as RunView,'step',{ticks:20,pace:{factor:4}},'a-1');
  const post=g.seen.find(s=>s.url.endsWith('/actions'))!;
  expect(post.auth).toBe('Bearer tok-1');expect(post.csrf).toBeUndefined();
  expect(g.seen.find(s=>s.url.endsWith('/sessions'))!.auth).toBeUndefined();
  expect(session.m.get(`mekoniq-lab-session:${g.base}`)).toBe('tok-1');
  // the token is the session: a runtime that no longer knows it (restart) answers 401; the bearer is dropped from memory and storage
  g.state.revoked=true;
  await expect(rt.get('r1')).rejects.toMatchObject({code:'SESSION_REQUIRED',status:401});
  expect(rt.paired).toBe(false);expect(session.m.size).toBe(0);
  expect(httpTwinRuntime({base:g.base,kind:'loopback'}).paired).toBe(false);// a reload finds no bearer either
 }finally{await g.close();}
});

test('the bearer request carries no credentials and names the loopback address space',async()=>{
 const calls:RequestInit[]=[];
 vi.stubGlobal('fetch',vi.fn(async(_u:string,init:RequestInit)=>{calls.push(init);return new Response(JSON.stringify({csrfToken:'c',sessionToken:'t'}),{status:201});}));
 const rt=httpTwinRuntime({base:'http://127.0.0.1:4176/lab/v2',kind:'loopback'});await rt.pair('x');await rt.get('r1').catch(()=>null);
 expect(calls[1]).toMatchObject({credentials:'omit',targetAddressSpace:'loopback',headers:{Authorization:'Bearer t'}});
});

test('the same-origin default is unchanged: cookie credentials and the CSRF header',async()=>{
 const calls:[string,RequestInit][]=[];
 vi.stubGlobal('fetch',vi.fn(async(u:string,init:RequestInit)=>{calls.push([u,init]);return new Response(JSON.stringify({csrfToken:'c1',sessionToken:'t'}),{status:201});}));
 const rt=httpTwinRuntime();expect(rt.target).toEqual({base:'/lab/v2',kind:'same_origin'});
 await rt.pair('x');await rt.action({run:{id:'r1',runRevision:1}} as RunView,'start');
 expect(calls[1]![0]).toBe('/lab/v2/runs/r1/actions');
 expect(calls[1]![1]).toMatchObject({method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-CSRF-Token':'c1'}});
 expect(JSON.stringify(calls[1]![1].headers)).not.toContain('Authorization');
 expect(rt.streamDeps!().base).toBe('/lab/v2');
});

test('openRunStreams over FetchEventSource: connecting, live, a cut stream, live again from ?after=<cursor> without losing a business record',async()=>{
 const g=await gateway();
 try{
  const rt=httpTwinRuntime({base:g.base,kind:'loopback'});await rt.pair('one-use');
  const states:LinkState[]=[],business:string[]=[];
  const s=openRunStreams('r1','0',{onState:x=>states.push(x),onBusiness:e=>business.push(e.sequence)},{...rt.streamDeps!(),network:null});
  expect(s.state).toBe('connecting');
  await vi.waitFor(()=>expect(business).toEqual(['1','2','3']),{timeout:4000});
  await vi.waitFor(()=>expect(states.at(-1)).toBe('live'));
  expect(states[0]).toBe('live');expect(states.some(x=>x==='polling'||x==='reconnecting')).toBe(true);
  const opens=g.seen.filter(x=>x.url.includes('/events'));
  expect(opens.map(x=>x.url)).toEqual(['/lab/v2/runs/r1/events?after=0','/lab/v2/runs/r1/events?after=2']);
  // every stream request and the probe carry the bearer; none carries a token in its URL
  for(const x of g.seen.filter(x=>x.url.startsWith('/lab/v2/runs/')))expect(x.auth).toBe('Bearer tok-1');
  expect(g.seen.some(x=>x.url.includes('tok-1'))).toBe(false);
  s.close();
 }finally{await g.close();}
});

test('create refuses a runtime whose source commit differs from the Lab pin (other targets only)',async()=>{
 const urls:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(u:string)=>{urls.push(u);
  if(u==='/source-runtime.lock.json')return new Response(JSON.stringify({sourceCommit:'a'.repeat(40)}));
  if(u.endsWith('/health'))return new Response(JSON.stringify({sourceCommit:'b'.repeat(40)}));
  return new Response(JSON.stringify({run:{id:'r1'}}),{status:201});}));
 const rt=httpTwinRuntime({base:'https://rt.example/lab/v2',kind:'remote'});
 const e=await rt.create({} as never,{sourceCommit:'b'.repeat(40),schemaHash:'s'}).catch(x=>x);
 expect(e).toBeInstanceOf(TwinRuntimeError);expect(e).toMatchObject({code:'RUNTIME_PIN_MISMATCH',reasonCodes:['bbbbbbb','aaaaaaa']});
 expect(urls.some(u=>u.endsWith('/runs'))).toBe(false);
 urls.length=0;await httpTwinRuntime().create({} as never,{sourceCommit:'b'.repeat(40),schemaHash:'s'});
 expect(urls).toEqual(['/lab/v2/runs']);// same origin: the launcher installed the pinned runtime, no pin request
});

test('a loopback fetch the browser refuses becomes LOOPBACK_BLOCKED; a remote one stays a network error',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>{throw new TypeError('Failed to fetch');}));
 await expect(httpTwinRuntime({base:'http://127.0.0.1:4176/lab/v2',kind:'loopback'}).health()).rejects.toMatchObject({code:'LOOPBACK_BLOCKED'});
 await expect(httpTwinRuntime({base:'https://rt.example/lab/v2',kind:'remote'}).health()).rejects.toBeInstanceOf(TypeError);
});

// The play loop of the workspace against a runtime that paces steps (features.pacedStep).
const docStub={getElementById:()=>null,activeElement:null,visibilityState:'visible' as 'visible'|'hidden',listeners:[] as (()=>void)[],
 addEventListener(t:string,f:()=>void){if(t==='visibilitychange')this.listeners.push(f);},removeEventListener(t:string,f:()=>void){this.listeners=this.listeners.filter(x=>x!==f);}};
async function loop(o:{conflictAt?:number;lostAt?:number;completeAt?:number;onSend?:(n:number)=>void;stepMs?:number;reportMs?:number|((n:number)=>number);reportHang?:boolean;hangAt?:number[];onPause?:()=>void}={}){
 vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('innerWidth',600);
 docStub.visibilityState='visible';docStub.listeners=[];vi.stubGlobal('document',docStub);
 const {TwinWorkspace}=await import('../../src/ui/workspace');const {presetById}=await import('../../src/scenarios/catalog');
 let rev=3,inflight=0,maxInflight=0,gets=0,paused=false,reportsInFlight=0,maxReports=0;let tick=0;const receipts=new Map<string,RunView>();
 const sent:{expected:number;payload:Record<string,unknown>;actionId:string;at:number;answeredAt?:number}[]=[],pauses:number[]=[],reports:{at:number;done?:number}[]=[];
 const viewAt=():RunView=>({run:{schemaVersion:2,id:'r1',mode:'mock',access:'simulated',backendSetId:'mock-default',backends:[],status:paused?'paused':o.completeAt!==undefined&&tick>=o.completeAt*20?'completed':'running',runRevision:rev,eventCursor:null,telemetryCursor:null,fidelity:'modeled',ageMs:0,sourceCommit:'d',scenarioId:'BV01',scenarioRevision:1,seed:42},
  tick,simTimeNs:String(tick*20_000_000),model:'m',entities:[],workload:[],awaiting:[],attention:[],served:'0',coffee:null});
 const rt={paired:true,target:{base:'http://127.0.0.1:4176/lab/v2',kind:'loopback'},forget(){},health:async()=>({}),
  report:async()=>{if(o.reportMs===undefined&&!o.reportHang)throw new Error('none');const r={at:performance.now()} as {at:number;done?:number};reports.push(r);reportsInFlight++;maxReports=Math.max(maxReports,reportsInFlight);
   // the report is made when it is asked for (the runtime's state then), and arrives after its delay
   const made=reportOf(viewAt());
   if(o.reportHang)await new Promise(()=>{});
   await new Promise(res=>setTimeout(res,typeof o.reportMs==='function'?o.reportMs(reports.length):o.reportMs));reportsInFlight--;r.done=performance.now();return made;},
  create:async()=>({...viewAt(),run:{...viewAt().run,id:'r2',status:'ready',runRevision:1}}),
  get:async()=>{gets++;return viewAt();},
  action:async(v:RunView,kind:string,payload:Record<string,unknown>={},actionId='',signal?:AbortSignal)=>{
   if(kind==='pause'){if(v.run.runRevision!==rev)throw new TwinRuntimeError('REVISION_CONFLICT',[],409);pauses.push(v.run.runRevision);o.onPause?.();rev++;paused=true;return viewAt();}
   const entry={expected:v.run.runRevision,payload,actionId,at:performance.now()} as (typeof sent)[number];sent.push(entry);const n=sent.length;
   inflight++;maxInflight=Math.max(maxInflight,inflight);
   try{
    if(o.hangAt?.includes(n))await new Promise((_r,reject)=>signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));
    await new Promise(r=>setTimeout(r,o.stepMs??3));
   }finally{inflight--;}
   o.onSend?.(n);
   const receipt=receipts.get(actionId);if(receipt){entry.answeredAt=performance.now();return receipt;}// the runtime's idempotency: a known actionId returns its stored receipt
   // another tab steps with the same expectedRevision first: ours is the second and is refused
   if(n===o.conflictAt)rev++;
   if(v.run.runRevision!==rev)throw new TwinRuntimeError('REVISION_CONFLICT',[],409);
   expect(kind).toBe('step');rev++;tick+=Number(payload.ticks);const r=viewAt();receipts.set(actionId,r);
   if(n===o.lostAt)throw new TypeError('Failed to fetch');// the step ran; its response was lost
   entry.answeredAt=performance.now();return r;
  }} as unknown as TwinRuntime;
 const w=new TwinWorkspace(()=>{},rt);
 const saved:{report:RunReport}[]=[];
 Object.assign(w,{health:{sourceCommit:'d',schemaHash:'s',protocolMajors:[2],scenarioIds:[],backends:[],backendSets:[],features:{pacedStep:true}},view:viewAt(),openStreams:()=>{},
  runPreset:presetById('coffee'),evidenceStore:{save:async(e:{report:RunReport})=>{saved.push(e);},list:async()=>[]}});
 const h=w as unknown as {playing:boolean;busy:boolean;notice:string;view:RunView;report:RunReport|null;previous:RunReport|null;measuredSpeed:number|undefined;html():string;saveEvidence():Promise<void>};
 return {w,h,sent,pauses,reports,saved,stats:()=>({maxInflight,gets,rev,maxReports,reportsInFlight})};
}

test('Review Focus: paced steps one at a time; a REVISION_CONFLICT re-reads the run and stops the loop',async()=>{
 const {w,h,sent,stats}=await loop({conflictAt:4});
 w.change('twin-run-speed','4');w.click('twin-play');
 await vi.waitFor(()=>expect(h.busy).toBe(false),{timeout:3000});
 expect(h.playing).toBe(false);expect(h.notice).toContain('REVISION_CONFLICT');
 expect(sent).toHaveLength(4);expect(stats().maxInflight).toBe(1);
 // each step carries the revision the previous one returned; the fourth reused it and lost to the other tab
 expect(sent.map(s=>s.expected)).toEqual([3,4,5,6]);
 for(const s of sent)expect(s.payload).toEqual({ticks:20,pace:{factor:4}});
 expect(new Set(sent.map(s=>s.actionId)).size).toBe(4);
 expect(stats().gets).toBe(1);expect(h.view.run.runRevision).toBe(stats().rev);// the workspace shows the runtime's run, not a guess
 await new Promise(r=>setTimeout(r,30));expect(sent).toHaveLength(4);
 w.leave();
});

test('a factor change applies to the next step; a lost response is resent once with the same actionId; a final run stops the loop',async()=>{
 // the speed changes while the second step is in flight (its response is then lost): the resend keeps its body, the next step takes 64×
 let ws!:{change(id:string,v:string):void};const {w,h,sent}=await loop({lostAt:2,completeAt:5,onSend:n=>{if(n===2)ws.change('twin-run-speed','64');}});ws=w;
 w.click('twin-play');
 await vi.waitFor(()=>expect(h.busy).toBe(false),{timeout:3000});
 expect(sent[1]!.actionId).toBe(sent[2]!.actionId);expect(sent[2]!.payload).toEqual({ticks:20,pace:{factor:16}});expect(sent[1]!.expected).toBe(sent[2]!.expected);
 expect(sent.slice(3).map(s=>s.payload)).toEqual([{ticks:20,pace:{factor:64}},{ticks:20,pace:{factor:64}},{ticks:20,pace:{factor:64}}]);
 expect(h.view.run.status).toBe('completed');expect(h.playing).toBe(false);expect(h.notice).toBe('');
 expect(h.measuredSpeed).toBeGreaterThan(0);
 const n=sent.length;await new Promise(r=>setTimeout(r,30));expect(sent).toHaveLength(n);
 w.leave();
});

test('a hidden tab stops sending after the in-flight step and resumes when visible unless the user stopped',async()=>{
 const {w,h,sent}=await loop();
 w.click('twin-play');await vi.waitFor(()=>expect(sent.length).toBeGreaterThanOrEqual(2));
 docStub.visibilityState='hidden';
 await vi.waitFor(()=>expect(h.busy).toBe(false));const n=sent.length;
 await new Promise(r=>setTimeout(r,30));expect(sent).toHaveLength(n);
 docStub.visibilityState='visible';for(const f of [...docStub.listeners])f();
 await vi.waitFor(()=>expect(sent.length).toBeGreaterThan(n+1));
 w.click('twin-stop');await vi.waitFor(()=>expect(h.busy).toBe(false));const m=sent.length;
 docStub.visibilityState='hidden';for(const f of [...docStub.listeners])f();docStub.visibilityState='visible';for(const f of [...docStub.listeners])f();
 await new Promise(r=>setTimeout(r,30));expect(sent).toHaveLength(m);
 w.leave();
});

test('reclaim proofs are kept per runtime: a proof from one runtime is never listed for, nor sent to, another',async()=>{
 const local=memory();local.m.set('mekoniq-lab-reclaim',JSON.stringify({old:'p-old'}));vi.stubGlobal('localStorage',local);vi.stubGlobal('sessionStorage',memory());
 const sent:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(u:string,init:RequestInit)=>{sent.push(`${u} ${init.body??''}`);
  if(u.endsWith('/sessions'))return new Response(JSON.stringify({csrfToken:'c',sessionToken:'t'}),{status:201});
  if(u==='/source-runtime.lock.json'||u.endsWith('/health'))return new Response(JSON.stringify({sourceCommit:'a'.repeat(40)}));
  return new Response(JSON.stringify({run:{id:'run-a'},reclaimToken:'proof-a'}),{status:201});}));
 // the same-origin key stays as it was: existing proofs keep working
 expect(httpTwinRuntime().recoverableRunIds).toEqual(['old']);
 const a={base:'https://a.example/lab/v2',kind:'remote'} as const,b={base:'https://b.example/lab/v2',kind:'remote'} as const;
 const rt=httpTwinRuntime(a);expect(rt.recoverableRunIds).toEqual([]);
 await rt.pair('k');await rt.create({} as never,{sourceCommit:'a'.repeat(40),schemaHash:'s'});
 expect(rt.recoverableRunIds).toEqual(['run-a']);expect(JSON.parse(local.m.get('mekoniq-lab-reclaim')!)).toEqual({old:'p-old'});
 rt.retarget!(b);expect(rt.recoverableRunIds).toEqual([]);
 sent.length=0;expect(()=>rt.reclaim!('run-a')).toThrow('RUN_PROOF_MISSING');expect(()=>rt.reclaim!('old')).toThrow('RUN_PROOF_MISSING');expect(sent).toEqual([]);
 expect(httpTwinRuntime(b).recoverableRunIds).toEqual([]);expect(httpTwinRuntime().recoverableRunIds).toEqual(['old']);
 const back=httpTwinRuntime(a);expect(back.recoverableRunIds).toEqual(['run-a']);
 await back.reclaim!('run-a');expect(sent.at(-1)).toBe('https://a.example/lab/v2/runs/run-a/reclaim {"proof":"proof-a"}');
});

test('a late 401 from a stream of the previous runtime never clears the bearer of the current one; its errors are typed by its own target',async()=>{
 vi.stubGlobal('sessionStorage',memory());
 let deny=false;
 vi.stubGlobal('fetch',vi.fn(async(u:string)=>{
  if(u.endsWith('/sessions'))return new Response(JSON.stringify({csrfToken:'c',sessionToken:'t'}),{status:201});
  if(u.startsWith('http://127.0.0.1'))throw new TypeError('Failed to fetch');
  return new Response('{"error":"SESSION_REQUIRED"}',{status:deny?401:200});}));
 const rt=httpTwinRuntime({base:'https://a.example/lab/v2',kind:'remote'});await rt.pair('k');
 const old=rt.streamDeps!();
 const loop=httpTwinRuntime({base:'http://127.0.0.1:4176/lab/v2',kind:'loopback'});const oldLoop=loop.streamDeps!();
 rt.retarget!({base:'https://b.example/lab/v2',kind:'remote'});await rt.pair('k2');expect(rt.paired).toBe(true);
 deny=true;expect((await old.fetch!('https://a.example/lab/v2/runs/r1')).status).toBe(401);
 expect(rt.paired).toBe(true);
 loop.retarget!({base:'https://c.example/lab/v2',kind:'remote'});
 await expect(oldLoop.fetch!('http://127.0.0.1:4176/lab/v2/runs/r1')).rejects.toMatchObject({code:'LOOPBACK_BLOCKED'});
});

test('the paced loop never waits for the report: one report request at a time, at most once a second, and one more when the loop ends',async()=>{
 const {w,h,sent,reports,stats}=await loop({reportMs:600,completeAt:10});
 w.click('twin-play');
 await vi.waitFor(()=>expect(h.busy).toBe(false),{timeout:3000});
 expect(sent).toHaveLength(10);
 for(let i=1;i<sent.length;i++)expect(sent[i]!.at-sent[i-1]!.answeredAt!,`gap before step ${i+1}`).toBeLessThan(50);
 expect(sent.at(-1)!.answeredAt!-sent[0]!.at).toBeLessThan(500);// ten steps finished long before one 600 ms report
 await vi.waitFor(()=>expect(stats().reportsInFlight).toBe(0),{timeout:3000});
 expect(stats().maxReports).toBe(1);
 // one report while the loop ran (the next was not yet due), then the final one after the loop ended
 expect(reports).toHaveLength(2);expect(reports[1]!.at).toBeGreaterThanOrEqual(sent.at(-1)!.answeredAt!);
 w.leave();
});

test('one Pause press during a paced step: the loop stops, the in-flight step returns, then exactly one pause with that step\'s revision',async()=>{
 const {w,h,sent,pauses}=await loop({stepMs:40});
 w.click('twin-play');await vi.waitFor(()=>expect(sent.length).toBeGreaterThanOrEqual(2));
 expect(h.html()).toMatch(/data-action="twin-pause"(?![^>]*disabled)/);// enabled during a paced run
 w.click('twin-pause');const n=sent.length;
 expect(h.html()).toMatch(/data-action="twin-pause"[^>]*disabled/);expect(h.html()).toContain('Đang tạm dừng');
 w.click('twin-pause');// a second press while pausing does nothing
 await vi.waitFor(()=>expect(h.busy).toBe(false),{timeout:3000});
 expect(sent).toHaveLength(n);expect(pauses).toHaveLength(1);
 expect(pauses[0]).toBe(sent.at(-1)!.expected+1);// the revision the in-flight step returned
 expect(h.view.run.status).toBe('paused');expect(h.playing).toBe(false);expect(h.notice).toBe('');
 w.leave();
});

test('a paced step with no answer after 30 s is aborted and resent once; a second silence stops the loop with the problem shown',async()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
 try{
  const first=await loop({hangAt:[2],completeAt:4,stepMs:0});
  first.w.click('twin-play');
  await vi.advanceTimersByTimeAsync(100);expect(first.sent).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(30_000);
  await vi.advanceTimersByTimeAsync(100);
  expect(first.sent[2]!.actionId).toBe(first.sent[1]!.actionId);expect(first.sent[2]!.payload).toEqual(first.sent[1]!.payload);
  expect(first.h.view.run.status).toBe('completed');expect(first.h.busy).toBe(false);first.w.leave();
  const second=await loop({hangAt:[1,2],stepMs:0});
  second.w.click('twin-play');
  await vi.advanceTimersByTimeAsync(30_100);expect(second.sent).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(30_100);
  expect(second.sent).toHaveLength(2);expect(second.h.busy).toBe(false);expect(second.h.playing).toBe(false);expect(second.h.notice).toContain('PACED_STEP_TIMEOUT');
  second.w.leave();
 }finally{vi.useRealTimers();}
});

test('disconnecting, or another address, closes the streams and drops the run of the old runtime',async()=>{
 const {w,h}=await loop();
 vi.stubGlobal('location',{origin:'http://127.0.0.1:4175',hostname:'127.0.0.1'});
 const closed=vi.fn();Object.assign(w,{streams:{state:'live',close:closed},report:{}});
 w.click('twin-disconnect');
 expect(closed).toHaveBeenCalled();expect(h.view).toBeNull();expect((w as unknown as {report:unknown}).report).toBeNull();
 w.leave();
});

test('Assembly sends nothing to a runtime it may not probe by itself; the compile click asks first',async()=>{
 vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('indexedDB',undefined);
 const {AssemblyWorkspace}=await import('../../src/ui/assembly-page');
 const calls:string[]=[];
 const rt=(kind:'same_origin'|'loopback')=>({paired:true,target:{base:kind==='same_origin'?'/lab/v2':'http://127.0.0.1:4176/lab/v2',kind},health:async()=>{calls.push('health');return {capabilities:[]};},compileEngineering:async()=>{calls.push('compile');throw new Error('x');}}) as unknown as TwinRuntime;
 for(const [kind,host,probes] of [['loopback','lab.example',false],['loopback','127.0.0.1',false],['same_origin','lab.example',false],['same_origin','127.0.0.1',true]] as const){
  vi.stubGlobal('location',{hostname:host,origin:`http://${host}`});calls.length=0;
  const a=new AssemblyWorkspace(()=>{},rt(kind)) as unknown as {restore():Promise<void>;click(a:string):void;canCompile:boolean|null};
  await a.restore();expect(calls,`${kind} on ${host}`).toEqual(probes?['health']:[]);
  if(!probes){a.click('asm-compile');await vi.waitFor(()=>expect(calls).toEqual(['health']));expect(a.canCompile).toBe(false);}
 }
});

test('evidence waits for the final report: a run completed inside the loop, then saved and replaced at once, keeps its final report',async()=>{
 vi.stubGlobal('indexedDB',{});
 const {w,h,saved}=await loop({completeAt:3,reportMs:250});
 w.click('twin-play');await vi.waitFor(()=>expect(h.view.run.status).toBe('completed'),{timeout:3000});
 await vi.waitFor(()=>expect(h.busy).toBe(false));
 expect(h.report?.outcome.status).not.toBe('completed');// the final report has not landed yet
 expect(h.html()).toContain('data-testid="report-pending"');
 w.click('twin-save-evidence');await vi.waitFor(()=>expect(saved).toHaveLength(1),{timeout:3000});
 expect(saved[0]!.report.outcome).toMatchObject({tick:60,status:'completed'});
 await vi.waitFor(()=>expect(h.busy).toBe(false));
 w.click('twin-reset');await vi.waitFor(()=>expect(h.view.run.id).toBe('r2'),{timeout:3000});
 expect(saved.every(e=>e.report.outcome.tick===60&&e.report.outcome.status==='completed')).toBe(true);
 expect(h.previous?.outcome).toMatchObject({tick:60,status:'completed'});
 w.leave();
});

test('an action that needs the final report fails visibly when it cannot be fetched, instead of using an older one',async()=>{
 vi.stubGlobal('indexedDB',{});
 const {w,h,saved}=await loop({completeAt:2,reportMs:5});
 w.click('twin-play');await vi.waitFor(()=>expect(h.busy).toBe(false),{timeout:3000});
 await new Promise(r=>setTimeout(r,30));
 Object.assign(h,{report:reportOf({...h.view,tick:20,run:{...h.view.run,status:'running'}})});// an older report is all the page holds
 (w as unknown as {rt:{report():Promise<never>}}).rt.report=async()=>{throw new TypeError('Failed to fetch');};
 w.click('twin-save-evidence');await vi.waitFor(()=>expect(h.busy).toBe(false));await new Promise(r=>setTimeout(r,10));
 expect(saved).toEqual([]);expect(h.notice).not.toBe('');
 w.leave();
});

test('Space while a pause is pending does not cancel it: exactly one pause, no further step',async()=>{
 const {w,h,sent,pauses}=await loop({stepMs:40});
 w.click('twin-play');await vi.waitFor(()=>expect(sent.length).toBeGreaterThanOrEqual(1));
 w.click('twin-pause');const n=sent.length;
 w.click('twin-toggle-play');w.click('twin-play');// Space, then the button
 await vi.waitFor(()=>expect(h.view.run.status).toBe('paused'),{timeout:3000});await vi.waitFor(()=>expect(h.busy).toBe(false));
 await new Promise(r=>setTimeout(r,100));
 expect(pauses).toHaveLength(1);expect(sent).toHaveLength(n);expect(h.playing).toBe(false);
 w.leave();
});

test('while pausing, the run bar says so too',async()=>{
 const {w,h,sent}=await loop({stepMs:40});
 w.click('twin-play');await vi.waitFor(()=>expect(sent.length).toBeGreaterThanOrEqual(1));
 w.click('twin-pause');
 expect(h.html()).toMatch(/data-testid="primary-action"[^>]*>[^<]*(<[^>]*>)*[^<]*Đang tạm dừng/);
 await vi.waitFor(()=>expect(h.busy).toBe(false),{timeout:3000});w.leave();
});

test('an older report never replaces a newer one (the pre-pause report lands after the post-pause one)',async()=>{
 // the pause's own report (the second request) is fast; the one asked during the run and the final one are slow
 const {w,h,sent}=await loop({stepMs:40,reportMs:n=>n===2?5:400});
 w.click('twin-play');await vi.waitFor(()=>expect(sent.length).toBeGreaterThanOrEqual(1));
 w.click('twin-pause');
 await vi.waitFor(()=>expect(h.report?.outcome.status).toBe('paused'),{timeout:3000});
 // the run-time report lands now: it must not replace the newer one
 const seen=new Set<string>();const until=Date.now()+1000;while(Date.now()<until){seen.add(String(h.report?.outcome.status));await new Promise(r=>setTimeout(r,10));}
 expect([...seen]).toEqual(['paused']);
 w.leave();
});

test('a report request that never settles is abandoned after 30 s and the final report is still fetched',async()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
 try{
  const {w,h,reports}=await loop({reportHang:true,completeAt:2,stepMs:0});
  w.click('twin-play');await vi.advanceTimersByTimeAsync(50);
  expect(h.view.run.status).toBe('completed');expect(reports).toHaveLength(1);// the final one is queued behind the hung one
  await vi.advanceTimersByTimeAsync(30_100);
  expect(reports).toHaveLength(2);
  w.leave();
 }finally{vi.useRealTimers();}
});

test('a 2xx whose body is not JSON (or is cut off) is INVALID_RUNTIME_RESPONSE, never data',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('<html>proxy</html>',{status:200})));
 await expect(httpTwinRuntime().get('r1')).rejects.toMatchObject({code:'INVALID_RUNTIME_RESPONSE'});
 const body=new ReadableStream({start:c=>c.error(new DOMException('aborted','AbortError'))});
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(body,{status:200})));
 await expect(httpTwinRuntime({base:'https://a.example/lab/v2',kind:'remote'}).action({run:{id:'r1',runRevision:1}} as RunView,'step',{ticks:20})).rejects.toMatchObject({code:'INVALID_RUNTIME_RESPONSE'});
});

test('Save with a report that never comes: after 30 s it fails visibly (REPORT_TIMEOUT), the controls are usable and the pending line is gone',async()=>{
 vi.stubGlobal('indexedDB',{});
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
 try{
  const {w,h,saved}=await loop({reportHang:true,completeAt:2,stepMs:0});
  w.click('twin-play');await vi.advanceTimersByTimeAsync(50);expect(h.view.run.status).toBe('completed');
  await vi.advanceTimersByTimeAsync(30_100);// the run-time and final refreshes time out too
  w.click('twin-save-evidence');await vi.advanceTimersByTimeAsync(10);
  expect(h.busy).toBe(true);expect(h.html()).toContain('data-testid="report-pending"');
  await vi.advanceTimersByTimeAsync(30_100);
  expect(h.busy).toBe(false);expect(h.notice).toContain('REPORT_TIMEOUT');expect(saved).toEqual([]);
  expect(h.html()).not.toContain('data-testid="report-pending"');
  w.leave();
 }finally{vi.useRealTimers();}
});

test('an action whose report never comes releases the page after 30 s (apply is bounded too)',async()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
 try{
  const {w,h,sent}=await loop({reportHang:true,stepMs:0});
  w.click('twin-step');await vi.advanceTimersByTimeAsync(10);expect(sent).toHaveLength(1);expect(h.busy).toBe(true);
  await vi.advanceTimersByTimeAsync(30_100);
  expect(h.busy).toBe(false);expect(h.view.tick).toBe(250);
  w.leave();
 }finally{vi.useRealTimers();}
});

test('a previous run the runtime no longer has (404) does not block a new one: no evidence, a notice; any other failure still blocks',async()=>{
 vi.stubGlobal('indexedDB',{});
 for(const [status,proceeds] of [[404,true],[500,false]] as const){
  const {w,h,saved}=await loop({completeAt:1,reportMs:1});
  w.click('twin-play');await vi.waitFor(()=>expect(h.busy).toBe(false),{timeout:3000});
  const rt=(w as unknown as {rt:Record<string,unknown>}).rt,fail=async()=>{throw new TwinRuntimeError(status===404?'RUN_NOT_FOUND':'INTERNAL',[],status);};
  Object.assign(h,{report:null});rt.report=fail;rt.archive=fail;
  w.click('twin-reset');await vi.waitFor(()=>expect(h.busy).toBe(false),{timeout:3000});
  expect(saved).toEqual([]);
  if(proceeds){expect(h.view.run.id).toBe('r2');expect(h.notice).toContain('không còn trên runtime');}
  else{expect(h.view.run.id).toBe('r1');expect(h.notice).toContain('INTERNAL');}
  w.leave();
 }
});

test('U06: only a not-found answer for the run from the report step means the previous run was lost; a 404 from archive keeps its saved evidence and record',async()=>{
 vi.stubGlobal('indexedDB',{});
 const settle=async(fail:{report?:TwinRuntimeError;archive?:TwinRuntimeError})=>{
  const {w,h,saved}=await loop({completeAt:1,reportMs:1});
  w.click('twin-play');await vi.waitFor(()=>expect(h.busy).toBe(false),{timeout:3000});
  const rt=(w as unknown as {rt:Record<string,unknown>}).rt;
  if(fail.report){Object.assign(h,{report:null});rt.report=async()=>{throw fail.report;};}
  rt.archive=async()=>{if(fail.archive)throw fail.archive;};
  w.click('twin-reset');await vi.waitFor(()=>expect(h.busy).toBe(false),{timeout:3000});
  w.leave();return {h,saved};
 };
 // archive answers 404 after the evidence was saved: the evidence and the comparison record stand, the new run is created, the notice says what happened
 const a=await settle({archive:new TwinRuntimeError('RUN_NOT_FOUND',[],404)});
 expect(a.saved).toHaveLength(1);expect(a.h.previous?.manifest.runId).toBe('r1');expect(a.h.view.run.id).toBe('r2');
 expect(a.h.notice).toContain('đã lưu');expect(a.h.notice).not.toContain('không lưu được');
 // a 404 whose body is not the runtime's (not JSON: INVALID_RUNTIME_RESPONSE) or another not-found is no proof the run is gone: it blocks
 for(const e of [new TwinRuntimeError('INVALID_RUNTIME_RESPONSE',[],404),new TwinRuntimeError('NOT_FOUND',[],404)]){
  const b=await settle({report:e});expect(b.h.view.run.id).toBe('r1');expect(b.h.notice).toContain(e.code);expect(b.saved).toEqual([]);
 }
 // the report step says the run is not found: lost, no evidence, the notice says so, the new run is created
 const c=await settle({report:new TwinRuntimeError('RUN_NOT_FOUND',[],404)});
 expect(c.h.view.run.id).toBe('r2');expect(c.saved).toEqual([]);expect(c.h.previous).toBeNull();expect(c.h.notice).toContain('không còn trên runtime');
});

test('item 6: Assembly asks again on a new connection and on Compile; not reached says "not connected", never that the runtime lacks the capability',async()=>{
 vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('indexedDB',undefined);vi.stubGlobal('location',{hostname:'127.0.0.1',origin:'http://127.0.0.1:4175'});
 const {AssemblyWorkspace}=await import('../../src/ui/assembly-page');
 let up=false,paired=true;const calls:string[]=[];
 const rt={get paired(){return paired;},target:{base:'/lab/v2',kind:'same_origin'},health:async()=>{calls.push('health');if(!up)throw new TypeError('Failed to fetch');return {capabilities:['engineering_bundle_v1']};},compileEngineering:async()=>{calls.push('compile');throw new Error('x');}} as unknown as TwinRuntime;
 const a=new AssemblyWorkspace(()=>{},rt) as unknown as {restore():Promise<void>;click(a:string):void;html():string;canCompile:boolean|null;busy:boolean};
 await a.restore();expect(a.canCompile).toBe(false);
 expect(a.html()).toContain('data-reason="not-connected"');expect(a.html()).not.toContain('has no engineering_bundle_v1');expect(a.html()).not.toMatch(/data-action="asm-compile"[^>]*disabled/);
 // the runtime comes up; the next press asks again and compiles
 up=true;calls.length=0;a.click('asm-compile');await vi.waitFor(()=>expect(calls).toEqual(['health','compile']));
 // another connection: the last answer no longer applies
 await vi.waitFor(()=>expect(a.busy).toBe(false));paired=false;a.html();expect(a.canCompile).toBeNull();
});

test('an export completing after retarget keeps the original run/auth/version through real reader IO and idempotent release',async()=>{
 const local=memory(),session=memory(),oldBase='https://old.example/lab/v2',newBase='https://new.example/lab/v2';vi.stubGlobal('localStorage',local);vi.stubGlobal('sessionStorage',session);session.m.set('mekoniq-lab-session:'+oldBase,'original-owner');session.m.set('mekoniq-lab-session:'+newBase,'new-owner');
 const plain=Buffer.from(JSON.stringify({manifest:{runId:'run-one'},outcome:{tick:7}})),bytes=gzipSync(plain),sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex'),manifest={schemaVersion:1,documentType:'web-replay-package',runId:'run-one',horizon:{tick:7,tickMs:20},provenance:{kind:'imported_integrity_only',accepted:false,calibration:'not_calibrated',scope:'display_only_not_requalification',reportTransform:'credential_redaction_v1',rawReportSha256:sha(plain)},coverage:{prefixCovered:false,streamFinalized:false,sampled:false,terminal:null,gaps:[],issues:['NO_STREAM']},assets:[{path:'report.json.gz',sha256:sha(bytes),decodedSha256:sha(plain),bytes:bytes.length,decodedBytes:plain.length,encoding:'gzip',role:'report',mediaType:'application/json'}],streams:[],licensing:[]};
 let complete!:(r:Response)=>void;const calls:{url:string;init:RequestInit}[]=[];vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{calls.push({url,init});if(url.endsWith('/replay'))return new Promise<Response>(r=>{complete=r;});if(url.endsWith('/assets/0'))return new Response(bytes);return new Response(JSON.stringify(init.method==='DELETE'?{deleted:true}:{}),{status:200});}));
 const rt=httpTwinRuntime({base:oldBase,kind:'remote'}),pending=rt.exportReplay!('run-one',new AbortController().signal);rt.retarget!({base:newBase,kind:'remote'});complete(new Response(JSON.stringify({exportId:'owned-version',manifest}),{status:200}));const capture=await pending;expect(capture.reader.manifest.runId).toBe('run-one');expect(Buffer.from(await capture.reader.readStoredAsset('report.json.gz'))).toEqual(bytes);capture.reader.close();await capture.release();await capture.release();const originalCalls=[...calls];expect(originalCalls.length).toBe(4);for(const c of originalCalls){expect(c.url).toMatch(/^https:\/\/old.example\/lab\/v2\/runs\/run-one\/replay/);expect(new Headers(c.init.headers).get('Authorization')).toBe('Bearer original-owner');expect(c.init.credentials).toBe('omit');}expect(originalCalls.filter(c=>c.init.method==='DELETE').map(c=>c.url)).toEqual([oldBase+'/runs/run-one/replay/owned-version']);await rt.health();expect(calls.at(-1)!.url).toBe(newBase+'/health');expect(new Headers(calls.at(-1)!.init.headers).get('Authorization')).toBe('Bearer new-owner');
});

test('two tabs store independent proofs, observe revocation and read legacy proofs',async()=>{
 const storage=memory();vi.stubGlobal('localStorage',{...storage,get length(){return storage.m.size;},key:(i:number)=>[...storage.m.keys()][i]??null});
 storage.setItem('mekoniq-lab-reclaim',JSON.stringify({old:'legacy'}));let i=0;
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({run:{id:'r'+(++i)},reclaimToken:'token-'+i}))));
 const a=httpTwinRuntime(),b=httpTwinRuntime();await Promise.all([a.create({} as never,{} as never),b.create({} as never,{} as never)]);
 expect(a.recoverableRunIds?.slice().sort()).toEqual(['old','r1','r2']);expect(b.recoverableRunIds?.slice().sort()).toEqual(['old','r1','r2']);
 a.dropProof!('old');b.dropProof!('r2');expect(a.recoverableRunIds).toEqual(['r1']);
});

test('retarget during the remote pin check never creates on the replacement target',async()=>{
 let release!:(r:Response)=>void;const sent:string[]=[];vi.stubGlobal('fetch',vi.fn(async(u:string)=>{
  sent.push(u);if(u.endsWith('/health'))return new Promise<Response>(res=>{release=res;});
  return new Response(JSON.stringify({sourceCommit:'a'.repeat(40)}));
 }));
 const a=httpTwinRuntime({kind:'remote',base:'https://a.example/lab/v2'}),request=a.create({} as never,{} as never);
 a.retarget!({kind:'remote',base:'https://b.example/lab/v2'});release(new Response(JSON.stringify({sourceCommit:'a'.repeat(40)})));
 await expect(request).rejects.toMatchObject({code:'SESSION_CHANGED'});expect(sent.some(u=>u.endsWith('/runs'))).toBe(false);
});
test('an archive requires an acknowledgement for the original run',async()=>{
 const rt=httpTwinRuntime();for(const ack of [{},{archived:true,runId:'other-run'}]){
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(ack))));
  await expect(rt.archive!('expected-run')).rejects.toMatchObject({code:'INVALID_RUNTIME_RESPONSE'});
 }
});
