import {afterEach,expect,test} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startLabGateway,type LabGateway} from '../../packages/lab-runtime/src/gateway';
import {validateProjectV2,validateTwinSampleV2} from '../../packages/lab-runtime/src/v2/contracts';
import {pumpEvents,resumePoint,type SseSink} from '../../packages/lab-runtime/src/v2/event-stream';
import {TelemetryPublisher} from '../../packages/lab-runtime/src/v2/telemetry';
import {restaurant} from '../support/lab-v2';
// Business events (durable, journal cursor) and telemetry (lossy, coalesced) are separate SSE streams of the v2 gateway.
const origin='http://127.0.0.1:4175',hash='a'.repeat(64);
const gateways:LabGateway[]=[],dirs:string[]=[],streams:AbortController[]=[];
afterEach(async()=>{for(const s of streams.splice(0))s.abort();for(const g of gateways.splice(0))await g.close();for(const d of dirs.splice(0))await rm(d,{force:true,recursive:true});});
const post=(url:string,headers:Record<string,string>,body:unknown)=>fetch(url,{method:'POST',headers,body:JSON.stringify(body)});
type Headers=Record<string,string>;
async function gateway(stream:Record<string,number>={},nowMs?:()=>number,directory?:string){
 const dir=directory??await mkdtemp(join(tmpdir(),'lab-v2-stream-'));if(!directory)dirs.push(dir);
 const g=await startLabGateway({port:0,directory:dir,sourceCommit:'test-commit',schemaHash:hash,...nowMs?{nowMs}:{},v2:{enabledBackends:['mock_amr'],stream:{pollMs:20,telemetryMs:20,heartbeatMs:50,...stream}}});gateways.push(g);return {g,dir};
}
async function pair(g:LabGateway):Promise<Headers>{const r=await post(g.url+'/lab/v2/sessions',{Origin:origin,'Content-Type':'application/json'},{token:g.issuePairingToken()});expect(r.status).toBe(201);return {Origin:origin,'Content-Type':'application/json',Cookie:r.headers.get('set-cookie')!.split(';')[0]!,'X-CSRF-Token':(await r.json() as {csrfToken:string}).csrfToken};}
const body={project:restaurant(),scenarioId:'FD01',scenarioRevision:1,seed:42,mode:'mock',backendSetId:'mock-amr',access:'simulated',runtimeIdentity:{sourceCommit:'test-commit',schemaHash:hash}};
interface View {run:{id:string;runRevision:number;eventCursor:string|null;telemetryCursor:string|null;status:string};tick:number;reclaimToken?:string;controlAccess?:string}
async function run(g:LabGateway,h:Headers){
 const v=await (await post(g.url+'/lab/v2/runs',h,body)).json() as View,url=`${g.url}/lab/v2/runs/${v.run.id}`;let rev=v.run.runRevision,n=0;
 const act=async(kind:string,payload:Record<string,unknown>={})=>{const r=await post(url+'/actions',h,{actionId:`a${++n}`,expectedRevision:rev,kind,payload});expect(r.status).toBe(200);const x=await r.json() as View;rev=x.run.runRevision;return x;};
 return {url,view:v,act};
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- SSE payloads are asserted field by field below
interface Msg {event:string;id?:string;data:any}
/** Minimal SSE reader over fetch: parses records and lets a test wait for one. */
async function sse(url:string,headers:Headers){
 const ctl=new AbortController();streams.push(ctl);
 const res=await fetch(url,{headers,signal:ctl.signal});
 const msgs:Msg[]=[];let buf='',wake=()=>{};let finished=()=>{};const ended=new Promise<void>(resolve=>{finished=resolve;});
 if(res.ok)void (async()=>{const dec=new TextDecoder();try{for await(const chunk of res.body as unknown as AsyncIterable<Uint8Array>){buf+=dec.decode(chunk,{stream:true});let i;while((i=buf.indexOf('\n\n'))>=0){const rec=buf.slice(0,i);buf=buf.slice(i+2);const m:Msg={event:'message',data:null};let data='';for(const line of rec.split('\n')){if(line.startsWith(':'))continue;const [k,...v]=line.split(':');const val=v.join(':').replace(/^ /,'');if(k==='event')m.event=val;else if(k==='id')m.id=val;else if(k==='data')data+=val;}if(data){m.data=JSON.parse(data);msgs.push(m);wake();}}}}catch{/* aborted */}finally{finished();}})();
 const until=async(pred:(m:Msg)=>boolean,timeout=5000)=>{const end=Date.now()+timeout;for(;;){const m=msgs.find(pred);if(m)return m;if(Date.now()>end)throw new Error(`SSE timeout; got ${msgs.map(x=>x.event).join(',')}`);await new Promise<void>(r=>{wake=r;setTimeout(r,25);});}};
 return {status:res.status,headers:res.headers,msgs,until,ended,close:()=>ctl.abort()};
}
const seqOf=(m:Msg)=>BigInt(m.id!);

test('durable business events stream with the journal cursor; a dropped stream resumes from Last-Event-ID without gaps or duplicates',async()=>{
 const {g}=await gateway(),h=await pair(g),r=await run(g,h);
 expect((await (await fetch(g.url+'/lab/v2/health')).json() as {features:{sse:boolean}}).features.sse).toBe(true);
 const first=await sse(`${r.url}/events?after=${r.view.run.eventCursor??0}`,h);
 expect(first.status).toBe(200);expect(first.headers.get('content-type')).toMatch(/text\/event-stream/);expect(first.headers.get('cache-control')).toMatch(/no-store/);
 await r.act('start');const stepped=await r.act('step',{ticks:400});
 await first.until(m=>m.event==='business'&&m.id===stepped.run.eventCursor);
 const ids=first.msgs.filter(m=>m.event==='business').map(seqOf);
 expect(ids).toEqual([...ids].sort((a,b)=>a<b?-1:a>b?1:0));expect(new Set(ids).size).toBe(ids.length);
 expect(ids[0]).toBe(BigInt(r.view.run.eventCursor??0)+1n);
 expect((await fetch(`${r.url}/events?after=x`,{headers:h})).status).toBe(400);expect((await fetch(`${r.url}/telemetry?after=1`,{headers:h})).status).toBe(400);
 const m=first.msgs.find(x=>x.event==='business')!;expect(m.data).toMatchObject({sequence:m.id});expect(m.data.events[0]).toHaveProperty('type');
 // the stream drops; the browser reconnects with the last id it saw
 first.close();const seen=ids[Math.floor(ids.length/2)]!;
 const after=await r.act('step',{ticks:400});
 const second=await sse(`${r.url}/events`,{...h,'Last-Event-ID':String(seen)});
 await second.until(x=>x.event==='business'&&x.id===after.run.eventCursor);
 const resumed=second.msgs.filter(x=>x.event==='business').map(seqOf);
 expect(resumed[0]).toBe(seen+1n);expect(new Set(resumed).size).toBe(resumed.length);
 expect(second.msgs.some(x=>x.event==='reset')).toBe(false);
 // v1 keeps refusing streams
 expect((await fetch(`${g.url}/lab/v1/runs/${r.view.run.id}/events`)).status).not.toBe(200);
});

test('a Last-Event-ID older than the retained window, unknown or malformed gets an explicit reset record with a snapshot, not a silent skip',async()=>{
 const {g}=await gateway({eventWindow:3}),h=await pair(g),r=await run(g,h);
 await r.act('start');const v=await r.act('step',{ticks:1500});
 expect(BigInt(v.run.eventCursor!)).toBeGreaterThan(5n);
 for(const [id,reason] of [['1','CURSOR_TOO_OLD'],['999999999','CURSOR_UNKNOWN'],['abc','CURSOR_INVALID']]){
  const s=await sse(`${r.url}/events`,{...h,'Last-Event-ID':id!});
  const reset=await s.until(m=>m.event==='reset');
  expect(reset.data).toMatchObject({reason,cursor:id,snapshot:{run:{id:r.view.run.id,eventCursor:v.run.eventCursor}}});
  expect(reset.id).toBe(v.run.eventCursor);
  expect(s.msgs.filter(m=>m.event==='business')).toHaveLength(0); // nothing older than the snapshot is replayed after a reset
  s.close();
 }
 // inside the window resumes normally
 const s=await sse(`${r.url}/events`,{...h,'Last-Event-ID':String(BigInt(v.run.eventCursor!)-2n)});
 await s.until(m=>m.event==='business'&&m.id===v.run.eventCursor);expect(s.msgs.some(m=>m.event==='reset')).toBe(false);
});

test('telemetry is a separate coalesced stream of schema-valid samples; heartbeats continue while the pose does not refresh; paused sim is acknowledged',async()=>{
 const {g}=await gateway(),h=await pair(g),r=await run(g,h);
 await r.act('start');const view=await r.act('step',{ticks:50});
 const t=await sse(`${r.url}/telemetry`,h);
 const s=await t.until(m=>m.event==='sample'&&m.data.entityId==='amr-1');
 expect(validateTwinSampleV2(s.data)).toMatchObject({ok:true});
 expect(s.data).toMatchObject({runId:r.view.run.id,providerId:'mock_amr',origin:'mock',frameId:'map',quality:'valid',seq:view.run.telemetryCursor,simTimeNs:'1000000000'});
 expect(s.data.observed).toMatchObject({xM:expect.any(Number),yM:expect.any(Number),yawRad:expect.any(Number)});
 // no step: heartbeats keep coming with a rising monotonic clock, but no new pose sample (age keeps growing at the client)
 const beats=()=>t.msgs.filter(m=>m.event==='heartbeat');
 await t.until(()=>beats().length>=3);
 const b=beats();expect(BigInt(b[2]!.data.monotonicNs)).toBeGreaterThan(BigInt(b[0]!.data.monotonicNs));expect(b[2]!.data).toMatchObject({tick:50,paused:false});
 expect(t.msgs.filter(m=>m.event==='sample'&&m.data.entityId==='amr-1')).toHaveLength(1);
 expect(beats().every(m=>m.id===undefined)).toBe(true); // heartbeats never move the cursor
 await r.act('pause');
 await t.until(m=>m.event==='heartbeat'&&m.data.paused===true);
 await r.act('resume');const nextView=await r.act('step',{ticks:10});
 const next=await t.until(m=>m.event==='sample'&&m.data.seq===nextView.run.telemetryCursor);expect(BigInt(next.data.receivedMonotonicNs)).toBeGreaterThan(BigInt(s.data.receivedMonotonicNs));
 // the business stream never carries samples and telemetry never carries business events
 expect(t.msgs.some(m=>m.event==='business')).toBe(false);
});

test('an observer reboot is an epoch reset (new bootId, run cursor remains monotonic); reconnecting telemetry reports an explicit gap',async()=>{
 const {g}=await gateway(),h=await pair(g),r=await run(g,h);
 await r.act('start');const view=await r.act('step',{ticks:50});
 const t=await sse(`${r.url}/telemetry`,h);
 const before=await t.until(m=>m.event==='sample'&&m.data.entityId==='amr-1');
 await r.act('injectFault',{faultId:'reboot',entityId:'amr-1'});
 const after=await t.until(m=>m.event==='sample'&&m.data.entityId==='amr-1'&&m.data.bootId!==before.data.bootId);
 expect(BigInt(after.data.seq)).toBeGreaterThan(BigInt(before.data.seq));expect(after.data.simTimeNs).toBe(before.data.simTimeNs);
 expect(view.run.telemetryCursor).toBe(before.data.seq);
 t.close();const stepped=await r.act('step',{ticks:20});
 const again=await sse(`${r.url}/telemetry`,{...h,'Last-Event-ID':after.data.seq});
 const gap=await again.until(m=>m.event==='gap');
 expect(gap.data).toMatchObject({reason:'RECONNECT',fromSeq:after.data.seq,toSeq:stepped.run.telemetryCursor});expect(gap.data.samplesNotSent).toBeGreaterThan(0);
 await again.until(m=>m.event==='sample'&&m.data.seq===stepped.run.telemetryCursor);
});

test('same-tick fault samples have distinct reconnect cursors while the paused simulation time stays fixed',async()=>{
 const {g}=await gateway(),h=await pair(g),r=await run(g,h);
 await r.act('start');await r.act('step',{ticks:125});const paused=await r.act('pause');
 const t=await sse(`${r.url}/telemetry`,h),before=await t.until(m=>m.event==='sample');t.close();
 const fault=await r.act('injectFault',{faultId:'localization-lost'});
 expect(fault.tick).toBe(paused.tick);expect(BigInt(fault.run.telemetryCursor!)).toBeGreaterThan(BigInt(before.id!));
 const again=await sse(`${r.url}/telemetry`,{...h,'Last-Event-ID':before.id!});
 const gap=await again.until(m=>m.event==='gap');expect(gap.data).toMatchObject({fromSeq:before.id,toSeq:fault.run.telemetryCursor,samplesNotSent:1});
 const after=await again.until(m=>m.event==='sample');expect(after.data).toMatchObject({quality:'stale',simTimeNs:before.data.simTimeNs,observed:{moving:false}});
});

test('streams are owned like runs: no session 401, other session 404; a restarted runtime loses the session and needs re-pairing',async()=>{
 const {g,dir}=await gateway(),h=await pair(g),r=await run(g,h),other=await pair(g);
 expect((await fetch(`${r.url}/events`)).status).toBe(401);
 expect((await fetch(`${r.url}/telemetry`,{headers:other})).status).toBe(404);
 const s=await sse(`${r.url}/events`,h);expect(s.status).toBe(200);
 await g.close();gateways.splice(gateways.indexOf(g),1); // closing ends open streams instead of hanging
 const {g:g2}=await gateway({},undefined,dir);
 const lost=await fetch(`${g2.url}/lab/v2/runs/${r.view.run.id}/events`,{headers:h});
 expect(lost.status).toBe(401);expect((await lost.json() as {error:string}).error).toBe('SESSION_REQUIRED');
 const h2=await pair(g2);expect((await fetch(`${g2.url}/lab/v2/runs/${r.view.run.id}/events`,{headers:h2})).status).toBe(404); // not reclaimable in F06
});

test('reading the report and both streams is read-only: command count and journal are unchanged',async()=>{
 const {g}=await gateway(),h=await pair(g),r=await run(g,h);
 await r.act('start');const v=await r.act('step',{ticks:400});
 const count=async()=>{const rep=await (await fetch(`${r.url}/report`,{headers:h})).json() as {effects:{attempts:number}[];businessEvents:unknown[]};return [rep.effects.reduce((n,e)=>n+e.attempts,0),rep.businessEvents.length];};
 const before=await count();
 for(let i=0;i<3;i++){const e=await sse(`${r.url}/events?after=0`,h),t=await sse(`${r.url}/telemetry`,h);await e.until(m=>m.id===v.run.eventCursor);await t.until(m=>m.event==='sample');e.close();t.close();}
 expect(await count()).toEqual(before);
 expect((await (await fetch(r.url,{headers:h})).json() as View).run.runRevision).toBe(v.run.runRevision);
});

test('open business and telemetry streams end when their pairing session expires',async()=>{
 let now=Date.parse('2026-11-05T00:00:00Z');
 const {g}=await gateway({},()=>now),h=await pair(g),r=await run(g,h);
 const events=await sse(`${r.url}/events`,h),telemetry=await sse(`${r.url}/telemetry`,h);
 await events.until(m=>m.event==='heartbeat');await telemetry.until(m=>m.event==='sample');
 now+=3600001;
 expect((await fetch(r.url,{headers:h})).status).toBe(401);
 await expect(Promise.race([Promise.all([events.ended,telemetry.ended]).then(()=> 'ended'),new Promise(resolve=>setTimeout(()=>resolve('timeout'),500))])).resolves.toBe('ended');
});

test('runs of expired sessions free their slot instead of holding the 20-run cap until restart',async()=>{
 let now=Date.parse('2026-11-05T00:00:00Z');
 const {g}=await gateway({},()=>now),h=await pair(g);
 for(let i=0;i<20;i++)expect((await post(g.url+'/lab/v2/runs',h,body)).status).toBe(201);
 expect((await post(g.url+'/lab/v2/runs',h,body)).status).toBe(429);
 now+=3600001;const fresh=await pair(g);
 expect((await post(g.url+'/lab/v2/runs',fresh,body)).status).toBe(201);
});

test('a new paired runtime reclaims durable evidence only with the local proof and cannot re-drive the run',async()=>{
 const {g,dir}=await gateway(),h=await pair(g),r=await run(g,h);
 expect(r.view.reclaimToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
 await r.act('start');await r.act('step',{ticks:125});
 const before=await (await fetch(r.url+'/report',{headers:h})).json() as {effects:unknown[]};
 expect(JSON.stringify(before)).not.toContain(r.view.reclaimToken!);
 await g.close();gateways.splice(gateways.indexOf(g),1);
 const {g:fresh}=await gateway({},undefined,dir),owner=await pair(fresh),url=`${fresh.url}/lab/v2/runs/${r.view.run.id}`;
 expect((await post(url+'/reclaim',owner,{proof:'wrong'})).status).toBe(404);
 const reclaimed=await post(url+'/reclaim',owner,{proof:r.view.reclaimToken});expect(reclaimed.status).toBe(200);
 const v=await reclaimed.json() as View;expect(v.controlAccess).toBe('view_reconcile');expect(v.run.status).toBe('needs_attention');
 expect((await post(url+'/actions',owner,{actionId:'unsafe',expectedRevision:v.run.runRevision,kind:'step',payload:{ticks:10}})).status).toBe(403);
 const after=await (await fetch(url+'/report',{headers:owner})).json() as {effects:unknown[]};expect(after.effects).toEqual(before.effects);
 expect((await post(url+'/actions',owner,{actionId:'audit',expectedRevision:v.run.runRevision,kind:'reconcile',payload:{subjectId:'amr-1'}})).status).toBe(200);
});

test('archiving frees an active slot while preserving proof-protected evidence for later reclaim',async()=>{
 const {g}=await gateway(),h=await pair(g),r=await run(g,h);
 await r.act('start');await r.act('step',{ticks:125});
 const archived=await post(r.url+'/archive',h,{});expect(archived.status).toBe(200);
 expect((await fetch(r.url,{headers:h})).status).toBe(404);
 for(let i=0;i<20;i++)expect((await post(g.url+'/lab/v2/runs',h,body)).status).toBe(201);
 expect((await post(r.url+'/reclaim',h,{proof:r.view.reclaimToken})).status).toBe(429);
});

// ---- backpressure units: a slow browser never loses business events and sees an explicit telemetry gap ----
function sink(){const s={blocked:false,out:[] as string[],drain:[] as (()=>void)[],write(c:string){s.out.push(c);return !s.blocked;},onDrain(f:()=>void){s.drain.push(f);}};return s;}
test('a slow consumer: business events wait (cursor not advanced), telemetry is coalesced and announced as a gap with the dropped count',()=>{
 const entries=['5','6','7','8'].map(sequence=>({sequence,at:'2026-11-01T00:00:00.000Z',events:[]}));
 const s=sink(),_typed:SseSink=s;void _typed;
 s.blocked=true;
 // the first write is accepted by the socket but signals backpressure; nothing more is written until drain
 expect(pumpEvents(s,entries,'4')).toBe('5');expect(s.out).toHaveLength(1);
 expect(pumpEvents(s,entries,'5',true)).toBe('5');expect(s.out).toHaveLength(1);
 s.blocked=false;expect(pumpEvents(s,entries,'5')).toBe('8');
 expect(s.out.map(c=>/^id: (\d+)/.exec(c)![1])).toEqual(['5','6','7','8']);
 const t=sink();const pub=new TelemetryPublisher(t);
 const sample=(seq:string,entityId='amr-1')=>({entityId,bootId:'b',seq} as never);
 pub.offer([sample('1'),sample('1','arm-1')]);expect(t.out).toHaveLength(2);
 t.blocked=true;pub.offer([sample('2'),sample('1','arm-1')]); // accepted but now blocked
 pub.offer([sample('3'),sample('2','arm-1')]);pub.offer([sample('4'),sample('2','arm-1')]);
 expect(t.out).toHaveLength(3);
 t.blocked=false;pub.drained();pub.offer([sample('5'),sample('2','arm-1')]);
 const tail=t.out.slice(3).map(c=>/^(?:id: \d+\n)?event: (\w+)\ndata: (.*)\n\n$/s.exec(c)!).map(m=>[m[1],JSON.parse(m[2]!)]);
 expect(tail[0]).toEqual(['gap',{reason:'BACKPRESSURE',dropped:2}]); // amr-1 seq 3 and 4 never sent; arm-1 seq 2 is delivered late
 expect(tail.slice(1).map(x=>[x[0],x[1].entityId,x[1].seq])).toEqual([['sample','amr-1','5'],['sample','arm-1','2']]);
});

test('resume point: exact cursor resumes after it; empty/zero starts at the window; older, unknown and malformed cursors reset',()=>{
 const e=['3','4','5','6','7'].map(sequence=>({sequence}));
 expect(resumePoint(e,'5',10)).toEqual({from:3});expect(resumePoint(e,'7',10)).toEqual({from:5});
 expect(resumePoint(e,'2',10)).toEqual({from:0});expect(resumePoint(e,undefined,10)).toEqual({from:0});expect(resumePoint(e,'0',10)).toEqual({from:0});
 expect(resumePoint(e,'4',2)).toEqual({reset:'CURSOR_TOO_OLD'});expect(resumePoint(e,'5',2)).toEqual({from:3});
 expect(resumePoint(e,undefined,2)).toEqual({reset:'CURSOR_TOO_OLD'});
 expect(resumePoint(e,'8',10)).toEqual({reset:'CURSOR_UNKNOWN'});expect(resumePoint(e,'x1',10)).toEqual({reset:'CURSOR_INVALID'});
});

// ---- measurement (opt-in): LAB_V2_MEASURE=<file.json> records actual values; nothing is asserted beyond completion ----
test.runIf(!!process.env.LAB_V2_MEASURE)('measure telemetry latency (gateway ingress -> SSE client receipt, one process clock) and memory',async()=>{
 const {writeFile}=await import('node:fs/promises'),os=await import('node:os'),{coffeeProject,corridor}=await import('../support/lab-v2');
 const opts={pollMs:250,telemetryMs:100,heartbeatMs:1000},dir=await mkdtemp(join(tmpdir(),'lab-v2-measure-'));dirs.push(dir);
 const g=await startLabGateway({port:0,directory:dir,sourceCommit:'test-commit',schemaHash:hash,v2:{enabledBackends:['mock_amr','mock_coffee','mock_arm'],stream:opts}});gateways.push(g);
 const out:Record<string,unknown>={host:{platform:process.platform,arch:process.arch,node:process.version,cpu:os.cpus()[0]?.model,cpus:os.cpus().length,memGiB:Math.round(os.totalmem()/2**30)},streamOptions:opts};
 for(const [name,scenarioId,backendSetId,project] of [['FD07 (2 AMR, corridor)','FD07','mock-amr',corridor()],['BV01 (1 AMR + arm + coffee cell)','BV01','mock-default',coffeeProject()]] as const){
  const h=await pair(g),v=await (await post(g.url+'/lab/v2/runs',h,{...body,project,scenarioId,backendSetId})).json() as View,url=`${g.url}/lab/v2/runs/${v.run.id}`;
  let rev=v.run.runRevision,n=0;const act=async(kind:string,payload={})=>{const r=await (await post(url+'/actions',h,{actionId:`m${++n}`,expectedRevision:rev,kind,payload})).json() as View;rev=r.run.runRevision;return r;};
  const heap0=process.memoryUsage().heapUsed,t=await sse(`${url}/telemetry`,h),rx=new Map<Msg,bigint>(),started=Date.now();
  // receipt is stamped by a 1 ms sweep over parsed records (adds <=1 ms)
  const sweep=setInterval(()=>{const now=process.hrtime.bigint();for(const m of t.msgs)if(m.event==='sample'&&!rx.has(m))rx.set(m,now);},1);
  let view=await act('start');
  while(!['completed','needs_attention','cancelled'].includes(view.run.status)&&view.tick<60000)view=await act('step',{ticks:25});
  await new Promise(r=>setTimeout(r,300));clearInterval(sweep);
  const lat=[...rx].map(([m,at])=>Number(at-BigInt(m.data.receivedMonotonicNs))/1e6).sort((a,b)=>a-b),q=(p:number)=>lat[Math.min(lat.length-1,Math.floor(p*lat.length))]!;
  const report=await (await fetch(url+'/report',{headers:h})).text(),rep=JSON.parse(report) as {telemetry:{samples:unknown[];sampleCounts:Record<string,number>}};
  out[name]={status:view.run.status,simTicks:view.tick,wallMs:Date.now()-started,samplesRecorded:rep.telemetry.samples.length,sampleCounts:rep.telemetry.sampleCounts,samplesDeliveredLive:lat.length,
   latencyMs:{p50:q(0.5),p95:q(0.95),max:lat[lat.length-1]},heapDeltaMiB:+((process.memoryUsage().heapUsed-heap0)/2**20).toFixed(2),rssMiB:+(process.memoryUsage().rss/2**20).toFixed(1),reportBytes:report.length,
   note:'steps of 25 ticks (0.5 s sim) as fast as the runner allows; live delivery is coalesced at 100 ms, so samplesDeliveredLive < samplesRecorded by design'};
  t.close();
 }
 await writeFile(process.env.LAB_V2_MEASURE!,JSON.stringify(out,null,2)+'\n');
},300000);

test('proof-protected reclaim returns the exact stored project, speed limit and nondefault seed, never caller inputs',async()=>{
 const {g}=await gateway(),h=await pair(g),checked=validateProjectV2(restaurant());
 if(!checked.ok)throw new Error('Invalid reclaim test fixture');
 const project=checked.value;project.world.width=14;project.entities.find(e=>e.kind==='amr')!.speedLimitMps=0.2;
 const input={project,scenarioId:'FD01',scenarioRevision:1,seed:99,mode:'mock',backendSetId:'mock-amr',access:'simulated'};
 const response=await post(g.url+'/lab/v2/runs',h,{...input,runtimeIdentity:body.runtimeIdentity});expect(response.status).toBe(201);
 const created=await response.json() as View,url=`${g.url}/lab/v2/runs/${created.run.id}`;
 expect((await post(url+'/archive',h,{})).status).toBe(200);
 const owner=await pair(g);
 expect((await post(url+'/reclaim',owner,{proof:created.reclaimToken,lockedInput:{...input,seed:42}})).status).toBe(422);
 const restored=await post(url+'/reclaim',owner,{proof:created.reclaimToken});expect(restored.status).toBe(200);
 const view=await restored.json() as View&{lockedInput:unknown};expect(view.lockedInput).toEqual({...input,sourceCommit:'test-commit'});
});
