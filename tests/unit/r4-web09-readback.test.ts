// WEB09 (V16): frame timing of the production build with a 5,000-sample plot and the belief layer. Everything is recomputed from raw data kept beside the measurement: percentiles from the intervals and the render
// stream, the window against the Playwright attempt, the workload from the bench trace/report and the replay package. A counter written into the JSON proves nothing.
import {afterAll,expect,test} from 'vitest';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// @ts-expect-error plain ESM script without types
import {verifyWeb09Record} from '../../scripts/r4-web09-readback.mjs';
// @ts-expect-error plain ESM script without types
import {verifyWebRecord} from '../../scripts/r4-readback.mjs';
// @ts-expect-error plain ESM script without types
import {SUITES_R4,CASES_R4} from '../../scripts/sim-extension-r4.mjs';

const dirs:string[]=[];afterAll(()=>{for(const d of dirs)rmSync(d,{recursive:true,force:true});});
const sha=(b:string)=>createHash('sha256').update(b).digest('hex'),SRC='a'.repeat(40),LAB='b'.repeat(40),PIN={artifactSha256:'c'.repeat(64),schemaHash:'d'.repeat(64),portableToolsDigest:'e'.repeat(64)};
const BASE='suites/e2e-perf/screens/',ORIGIN=1_800_000_000_000,ATTEMPT_START=ORIGIN+1000;
const put=(root:string,file:string,doc:unknown)=>{const text=typeof doc==='string'?doc:JSON.stringify(doc);mkdirSync(join(root,file,'..'),{recursive:true});writeFileSync(join(root,file),text);return {sha256:sha(text)};};
const BELIEF_START=100+65000;
const intervals=(n=3700,ms=16.7)=>Array.from({length:n},(_,i)=>i%50===0?ms*1.5:ms);
const probe=(startMs:number,o:Record<string,unknown>={})=>{const iv=intervals(),elapsed=iv.reduce((a,b)=>a+b,0);return {timeOriginEpochMs:ORIGIN,startMs,endMs:startMs+elapsed,elapsedMs:elapsed,intervalsMs:iv,longTasksMs:[],renders:[],visibilityState:'visible',userAgent:'Chrome',devicePixelRatio:2,webglRenderer:'Apple M',...o};};
const renderStream=(startMs:number,n=3720,step=16.7,o:Record<string,unknown>={})=>Array.from({length:n},(_,i)=>({atMs:startMs+10+i*step,durationMs:1.5,count:100+i,drawCalls:34,worldTick:20+Math.floor(i*1900/n),belief:true,...o}));
const trace=(n=5010)=>({traces:[{axisId:'wheels',dtS:0.002,samples:Array.from({length:n},(_,i)=>({target:1,actual:i/n,feedback:null,torqueNm:0}))}]});
const PACKAGE={runId:'run-cell',firstBeliefTick:10,horizon:2100};
const fakeOpen=(over:Record<string,unknown>={})=>async()=>({manifest:{runId:'run-cell',horizon:{tick:2100},coverage:{prefixCovered:true}},capturedReport:{manifest:{runId:'run-cell',scenario:{id:'MJ-CELL-BV01'},perception:{graspMode:'belief_estimated'}},perceptionEvidence:{beliefs:[{objectId:'cup-1',tick:PACKAGE.firstBeliefTick,belief:{}},{objectId:'cup-1',tick:900,belief:{}}]}},close(){},...over});
function fixture(o:{doc?:Record<string,unknown>;plot?:Record<string,unknown>;belief?:Record<string,unknown>;plotWork?:Record<string,unknown>;beliefWork?:Record<string,unknown>;skip?:string[];traceDoc?:unknown;reportDoc?:unknown;attempt?:Record<string,unknown>}={}){
 const root=mkdtempSync(join(tmpdir(),'r4-web09-'));dirs.push(root);
 const files=Object.entries({'index.html':'<script type="module" src="/assets/main.js"></script>','source-runtime.lock.json':JSON.stringify({sourceCommit:SRC,...PIN,dirty:false}),'assets/main.js':'document.body.textContent="fixture";'}).map(([path,bytes])=>{put(root,BASE+'production-ui/'+path,bytes);return {path,sha256:sha(bytes),bytes:Buffer.byteLength(bytes)};});
 const receipt=put(root,BASE+'production-ui.json',{schemaVersion:1,kind:'lab-production-ui',labCommit:LAB,labDirty:false,sourceCommit:SRC,runtimeArtifact:PIN.artifactSha256,schemaHash:PIN.schemaHash,files});
 const bt=put(root,BASE+'web09/bench-trace.json',o.traceDoc??trace()),br=put(root,BASE+'web09/bench-report.json',o.reportDoc??{manifest:{runId:'run-bench'},outcome:{status:'completed'}});
 put(root,BASE+'web09/belief-package/manifest.json','{"fake":true}');const pm=sha('{"fake":true}');
 const plotStart=100,beliefStart=BELIEF_START;
 const doc={schemaVersion:2,kind:'web09-frame-timing',productionSha256:receipt.sha256,limitMs:33,minimumDurationMs:60000,viewport:{width:1440,height:900},scenarios:[
  {id:'plot-5000',workload:{runId:'run-bench',samplesPerSeries:5010,plottedPoints:5010,benchReport:{file:'web09/bench-report.json',sha256:br.sha256},benchTrace:{file:'web09/bench-trace.json',sha256:bt.sha256},...o.plotWork},...probe(plotStart,o.plot)},
  {id:'belief-layer',workload:{runId:'run-cell',replayHorizonTick:2100,firstTick:20,view:'3d',package:{dir:'web09/belief-package',manifestSha256:pm},...o.beliefWork},...probe(beliefStart,{renders:renderStream(beliefStart),...o.belief})}],...o.doc};
 put(root,BASE+'web09.json',doc);
 const attempt={startTime:new Date(ATTEMPT_START-1000).toISOString(),duration:170000,...o.attempt};
 put(root,'suites/e2e-perf/result.json',{suites:[{specs:[{tests:[{results:[attempt]}]}]}]});
 for(const f of o.skip??[])rmSync(join(root,f));
 return {root,record:{identity:{before:{sourceCommit:SRC}},lab:{commit:LAB,pin:{sourceCommit:SRC,...PIN}}}};
}
const reader=(root:string)=>(p:string)=>{try{return readFileSync(join(root,p));}catch{return null;}};
const run=(f:{root:string;record:unknown},open=fakeOpen())=>verifyWeb09Record(reader(f.root),f.record,{open});

test('WEB09 passes with both windows tied to the attempt, a 5,010-sample plot, a render stream inside the target and the belief ghost in the scene',async()=>{
 expect(await run(fixture())).toEqual([]);
});
test('WEB09 is missing without a measurement and the suite is part of the R4 table',async()=>{
 const f=fixture();rmSync(join(f.root,BASE+'web09.json'));expect(await run(f)).toEqual(['WEB09_MEASUREMENT_MISSING']);
 expect(SUITES_R4.find((s:{id:string})=>s.id==='e2e-perf').command).toContain('--production-ui');expect(CASES_R4.WEB09.suites).toContain('e2e-perf');
});
test('WEB09 recomputes p95 from the raw frame intervals',async()=>{
 const slow=[...intervals(3700),...Array(300).fill(60)];
 expect(await run(fixture({plot:{intervalsMs:slow,elapsedMs:slow.reduce((a,b)=>a+b,0),endMs:100+slow.reduce((a,b)=>a+b,0)}}))).toContain('WEB09_P95_OVER_LIMIT:plot-5000');
});
test('WEB09 refuses a window the clock contradicts: doubled intervals, a short or hidden window, bad numbers',async()=>{
 const twice=[...intervals(),...intervals()];
 expect(await run(fixture({plot:{intervalsMs:twice}}))).toContain('WEB09_WINDOW_INCONSISTENT:plot-5000');
 expect(await run(fixture({plot:{elapsedMs:30000,endMs:30100}}))).toContain('WEB09_WINDOW_SHORT:plot-5000');
 expect(await run(fixture({plot:{visibilityState:'hidden'}}))).toContain('WEB09_PAGE_HIDDEN:plot-5000');
 for(const bad of [-1,'x',0])expect(await run(fixture({plot:{intervalsMs:[...intervals(),bad]}}))).toContain('WEB09_INTERVALS_INVALID:plot-5000');
});
test('WEB09 ties both windows to the Playwright attempt that produced them and keeps them apart',async()=>{
 expect(await run(fixture({attempt:{duration:30000}}))).toContain('WEB09_WINDOW_OUTSIDE_ATTEMPT');
 expect(await run(fixture({attempt:{startTime:new Date(ATTEMPT_START+5000).toISOString()}}))).toContain('WEB09_WINDOW_OUTSIDE_ATTEMPT');
 expect(await run(fixture({skip:['suites/e2e-perf/result.json']}))).toContain('WEB09_ATTEMPT_MISSING');
 expect(await run(fixture({belief:{startMs:50,endMs:50+61000,elapsedMs:61000,intervalsMs:Array(3660).fill(61000/3660),renders:renderStream(50)}}))).toContain('WEB09_WINDOWS_OVERLAP');
});
test('WEB09 judges the renderer, not only requestAnimationFrame: render cadence, duration, gaps and draw calls',async()=>{
 const start=BELIEF_START,s=(o:Record<string,unknown>)=>fixture({belief:{renders:renderStream(start,3720,16.7,o)}});
 // a canvas that stops drawing while rAF keeps ticking: every frame 55 ms apart
 expect(await run(fixture({belief:{renders:renderStream(start,1100,54.3)}}))).toEqual(expect.arrayContaining(['WEB09_CADENCE_P95_OVER_LIMIT:belief-layer','WEB09_RENDER_GAP:belief-layer']));
 expect(await run(s({durationMs:40}))).toContain('WEB09_RENDER_P95_OVER_LIMIT:belief-layer');
 expect(await run(s({drawCalls:0}))).toContain('WEB09_RENDER_STREAM:belief-layer');
 const gap=renderStream(start);gap.splice(1800,1000);gap.forEach((e,i)=>{e.count=100+i;});
 expect(await run(fixture({belief:{renders:gap}}))).toContain('WEB09_RENDER_GAP:belief-layer');
 expect(await run(fixture({belief:{renders:[]}}))).toContain('WEB09_RENDER_STREAM:belief-layer');
 const skipped=renderStream(start);skipped[10].count+=3;expect(await run(fixture({belief:{renders:skipped}}))).toContain('WEB09_RENDER_STREAM:belief-layer');
});
test('WEB09 allows only a bounded restart of the replay to pause the stream, never a stall in playback',async()=>{
 const start=BELIEF_START,restart=(pause:number,at=[1800])=>{const r=renderStream(start,3720);for(const i of at){for(let k=i;k<r.length;k++){r[k].atMs+=pause;}r[i].worldTick=20;for(let k=i+1;k<r.length;k++)r[k].worldTick=Math.max(21,r[k].worldTick-r[i-1].worldTick);}return r.filter(e=>e.atMs<=start+62000);};
 expect(await run(fixture({belief:{renders:restart(580)}}))).not.toContain('WEB09_RENDER_GAP:belief-layer');
 expect(await run(fixture({belief:{renders:restart(3000)}}))).toContain('WEB09_RENDER_GAP:belief-layer');
 expect(await run(fixture({belief:{renders:restart(300,[900,1500,2100,2700])}}))).toContain('WEB09_RENDER_GAP:belief-layer');
 // the same pause without a backward tick is a stall
 const stall=renderStream(start,3720);for(let k=1800;k<stall.length;k++)stall[k].atMs+=580;expect(await run(fixture({belief:{renders:stall.filter(e=>e.atMs<=start+62000)}}))).toContain('WEB09_RENDER_GAP:belief-layer');
});
test('WEB09 counts the belief ghost per rendered frame and checks it against the package',async()=>{
 const start=BELIEF_START;
 expect(await run(fixture({belief:{renders:renderStream(start,3720,16.7,{belief:false})}}))).toContain('WEB09_BELIEF_NOT_DRAWN:belief-layer');
 // a belief drawn before the first estimate exists
 const early=renderStream(start).map(e=>({...e,worldTick:5}));expect(await run(fixture({belief:{renders:early}}))).toContain('WEB09_BELIEF_NOT_DRAWN:belief-layer');
 // a replay that never moves is not playback
 const still=renderStream(start).map(e=>({...e,worldTick:300}));expect(await run(fixture({belief:{renders:still}}))).toContain('WEB09_RENDER_PROGRESSION:belief-layer');
});
test('WEB09 recomputes the workload from the kept bench and package, not from counters in its own JSON',async()=>{
 expect(await run(fixture({traceDoc:trace(4000),plotWork:{samplesPerSeries:5010,plottedPoints:5010}}))).toContain('WEB09_PLOT_WORKLOAD:plot-5000');
 expect(await run(fixture({plotWork:{runId:''}}))).toContain('WEB09_PLOT_WORKLOAD:plot-5000');
 expect(await run(fixture({plotWork:{runId:'another'}}))).toContain('WEB09_PLOT_WORKLOAD:plot-5000');
 expect(await run(fixture({reportDoc:{manifest:{runId:'run-bench'},outcome:{status:'failed'}}}))).toContain('WEB09_PLOT_WORKLOAD:plot-5000');
 expect(await run(fixture({skip:[BASE+'web09/bench-trace.json']}))).toContain('WEB09_PLOT_WORKLOAD:plot-5000');
 expect(await run(fixture({beliefWork:{runId:''}}))).toContain('WEB09_BELIEF_PACKAGE:belief-layer');
 expect(await run(fixture({beliefWork:{package:{dir:'web09/belief-package',manifestSha256:'f'.repeat(64)}}}))).toContain('WEB09_BELIEF_PACKAGE:belief-layer');
 expect(await run(fixture(),fakeOpen({manifest:{runId:'run-cell',horizon:{tick:999},coverage:{prefixCovered:true}}}))).toContain('WEB09_BELIEF_PACKAGE:belief-layer');
 expect(await run(fixture(),fakeOpen({capturedReport:{manifest:{runId:'run-cell',scenario:{id:'MJ-CELL-BV01'},perception:{graspMode:'belief_estimated'}},perceptionEvidence:{beliefs:[]}}}))).toContain('WEB09_BELIEF_PACKAGE:belief-layer');
 expect(await run(fixture({skip:[BASE+'web09/belief-package/manifest.json']}))).toContain('WEB09_BELIEF_PACKAGE:belief-layer');
});
test('WEB09 is bound to the production build of this tuple and to its own limit',async()=>{
 expect(await run(fixture({doc:{productionSha256:'f'.repeat(64)}}))).toContain('WEB09_BUILD_BINDING');
 expect(await run(fixture({doc:{limitMs:60}}))).toContain('WEB09_TARGET_INVALID');
 const h=fixture();put(h.root,BASE+'production-ui/assets/main.js','substituted');expect(await run(h)).toEqual(['WEB09_PRODUCTION_INVALID']);
 expect(await run(fixture({doc:{scenarios:[]}}))).toContain('WEB09_SCENARIOS_INVALID');
});
test('verifyWebRecord reports WEB09 through this reader, no longer as a constant',async()=>{
 const f=fixture();expect((await verifyWebRecord(f.root,f.record,{web09:{open:fakeOpen()}})).WEB09).toEqual([]);
 rmSync(join(f.root,BASE+'web09.json'));expect((await verifyWebRecord(f.root,f.record)).WEB09).toEqual(['WEB09_MEASUREMENT_MISSING']);
});
