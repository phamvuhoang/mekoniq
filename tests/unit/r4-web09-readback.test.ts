// WEB09 (V16, schema 3): frame timing of the production build with a 5,000-sample plot and the belief layer. Everything is recomputed from raw data kept beside the measurement: percentiles from the intervals and the
// render stream, windows against the spec's own test window, the Playwright attempt and the owning process, playback passes from stamped seeks, and the workload from the bench trace/report and the replay package.
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
const BASE='suites/e2e-perf/screens/',ORIGIN=1_800_000_000_000,HORIZON=2100,FIRST=20,STEP=16.7;
const PLOT_START=100,BELIEF_START=100+63000,BELIEF_MS=85000,TEST_START=ORIGIN+50,ATTEMPT_START=ORIGIN;
const put=(root:string,file:string,doc:unknown)=>{const text=typeof doc==='string'?doc:JSON.stringify(doc);mkdirSync(join(root,file,'..'),{recursive:true});writeFileSync(join(root,file),text);return {sha256:sha(text)};};
/** A probe: frames every 16.7 ms from startMs+5 for durationMs-10, so the window is `durationMs` long. */
const probe=(startMs:number,durationMs:number,o:Record<string,unknown>={})=>{
 const n=Math.round((durationMs-10)/STEP),iv=Array.from({length:n},(_,i)=>i%50===0?25:STEP),total=iv.reduce((a,b)=>a+b,0),first=startMs+5,last=first+total;
 return {timeOriginEpochMs:ORIGIN,startMs,endMs:last+5,elapsedMs:last+5-startMs,firstFrameMs:first,lastFrameMs:last,seeks:[],intervalsMs:iv,longTasksMs:[],renders:[],visibilityState:'visible',userAgent:'Chrome',devicePixelRatio:2,webglRenderer:'Apple M',...o};
};
type R={atMs:number;durationMs:number;count:number;drawCalls:number;worldTick:number;belief:boolean};
const NPASS=2500;
const pass=(start:number,count0:number,n=NPASS,step=STEP,o:Record<string,unknown>={}):R[]=>Array.from({length:n},(_,i)=>({atMs:start+i*step,durationMs:1.5,count:count0+i,drawCalls:34,worldTick:Math.round(FIRST+(HORIZON-FIRST)*i/(n-1)),belief:true,...o}));
const TWO_PASSES=(o:Record<string,unknown>={})=>({seeks:[{atMs:BELIEF_START+20,tick:FIRST},{atMs:BELIEF_START+42000,tick:FIRST}],renders:[...pass(BELIEF_START+30,100,NPASS,STEP,o),...pass(BELIEF_START+42050,100+NPASS,NPASS,STEP,o)]});
const trace=(n=5010,over:Record<string,unknown>={})=>({runId:'run-bench',manifestSha256:'9'.repeat(64),traces:['amr-1/wheel-left','amr-1/wheel-right'].map(axisId=>({axisId,dtS:0.002,samples:Array.from({length:n},()=>({target:1,actual:1,feedback:null,torqueNm:0}))})),issues:[],...over});
const benchReport=(over:Record<string,unknown>={},man:Record<string,unknown>={})=>({
 manifest:{runId:'run-bench',sourceCommit:SRC,backendSetId:'engineering-mujoco-bench-v1',backends:[{id:'mujoco_3d',version:'3.17.0',model:'mujoco_drive_bench',dynamics:true}],mode:'simulation',access:'simulated',scenario:{id:'MJ-BENCH-WHEEL'},...man},
 outcome:{status:'completed'},tuning:{runId:'run-bench',status:'completed',unstable:false,accepted:false,axisIds:['amr-1/wheel-left','amr-1/wheel-right'],engine:{id:'mujoco_3d',version:'3.17.0',hostArch:'arm64'},trace:{chunks:11,sha256:'9'.repeat(64),samples:5000}},...over
});
const cellReport=(man:Record<string,unknown>={},pe:Record<string,unknown>={})=>({manifest:{runId:'run-cell',sourceCommit:SRC,backendSetId:'engineering-mujoco-cell-v1',mode:'simulation',access:'simulated',scenario:{id:'MJ-CELL-BV01'},perception:{graspMode:'belief_estimated'},...man},perceptionEvidence:{issues:[],beliefs:[{objectId:'cup-1',tick:10,belief:{valid:true}},{objectId:'cup-1',tick:900,belief:{valid:true}}],...pe}});
const fakeOpen=(o:{report?:unknown;manifest?:Record<string,unknown>}={})=>async()=>({manifest:{runId:'run-cell',horizon:{tick:HORIZON},coverage:{prefixCovered:true},provenance:{accepted:false},...o.manifest},capturedReport:o.report??cellReport(),close(){}});
interface Opt{doc?:Record<string,unknown>;plot?:Record<string,unknown>;belief?:Record<string,unknown>;plotWork?:Record<string,unknown>;beliefWork?:Record<string,unknown>;skip?:string[];trace?:unknown;report?:unknown;attempt?:Record<string,unknown>;proc?:Record<string,unknown>;testWindow?:Record<string,unknown>}
function fixture(o:Opt={}){
 const root=mkdtempSync(join(tmpdir(),'r4-web09-'));dirs.push(root);
 const files=Object.entries({'index.html':'<script type="module" src="/assets/main.js"></script>','source-runtime.lock.json':JSON.stringify({sourceCommit:SRC,...PIN,dirty:false}),'assets/main.js':'document.body.textContent="fixture";'}).map(([path,bytes])=>{put(root,BASE+'production-ui/'+path,bytes);return {path,sha256:sha(bytes),bytes:Buffer.byteLength(bytes)};});
 const receipt=put(root,BASE+'production-ui.json',{schemaVersion:1,kind:'lab-production-ui',labCommit:LAB,labDirty:false,sourceCommit:SRC,runtimeArtifact:PIN.artifactSha256,schemaHash:PIN.schemaHash,files});
 const bt=put(root,BASE+'web09/bench-trace.json',o.trace??trace()),br=put(root,BASE+'web09/bench-report.json',o.report??benchReport());
 put(root,BASE+'web09/belief-package/manifest.json','{"fake":true}');
 const doc={schemaVersion:3,kind:'web09-frame-timing',testWindow:{startEpochMs:TEST_START,endEpochMs:ORIGIN+BELIEF_START+BELIEF_MS+2000,...o.testWindow},productionSha256:receipt.sha256,limitMs:33,minimumDurationMs:60000,viewport:{width:1440,height:900},scenarios:[
  {id:'plot-5000',workload:{runId:'run-bench',samplesPerSeries:5010,plottedPoints:5010,benchReport:{file:'web09/bench-report.json',sha256:br.sha256},benchTrace:{file:'web09/bench-trace.json',sha256:bt.sha256},...o.plotWork},...probe(PLOT_START,62000,o.plot)},
  {id:'belief-layer',workload:{runId:'run-cell',replayHorizonTick:HORIZON,firstTick:FIRST,view:'3d',package:{dir:'web09/belief-package',manifestSha256:sha('{"fake":true}')},...o.beliefWork},...probe(BELIEF_START,BELIEF_MS,{...TWO_PASSES(),...o.belief})}],...o.doc};
 put(root,BASE+'web09.json',doc);
 put(root,'suites/e2e-perf/result.json',{suites:[{specs:[{tests:[{results:[{startTime:new Date(ATTEMPT_START).toISOString(),duration:400000,...o.attempt}]}]}]}]});
 put(root,'suites/e2e-perf/process.json',{startedAt:new Date(ATTEMPT_START-5000).toISOString(),finishedAt:new Date(ORIGIN+BELIEF_START+BELIEF_MS+60000).toISOString(),...o.proc});
 for(const f of o.skip??[])rmSync(join(root,f));
 return {root,record:{identity:{before:{sourceCommit:SRC}},lab:{commit:LAB,pin:{sourceCommit:SRC,...PIN}}}};
}
const reader=(root:string)=>(p:string)=>{try{return readFileSync(join(root,p));}catch{return null;}};
const run=(f:{root:string;record:unknown},open=fakeOpen())=>verifyWeb09Record(reader(f.root),f.record,{open});
const withOpt=(o:Opt,open?:ReturnType<typeof fakeOpen>)=>run(fixture(o),open);
const move=(r:R[],from:number,by:number)=>{for(let k=from;k<r.length;k++)r[k]={...r[k]!,atMs:r[k]!.atMs+by};};

test('WEB09 passes: two stamped playback passes of a real belief run inside the target, a 5,010-sample plot, windows inside the test, the attempt and the process',async()=>{
 expect(await withOpt({})).toEqual([]);
});
test('WEB09 is missing without a measurement and the suite is part of the R4 table',async()=>{
 const f=fixture();rmSync(join(f.root,BASE+'web09.json'));expect(await run(f)).toEqual(['WEB09_MEASUREMENT_MISSING']);
 expect(SUITES_R4.find((s:{id:string})=>s.id==='e2e-perf').command).toContain('--production-ui');expect(CASES_R4.WEB09.suites).toContain('e2e-perf');
});
test('WEB09 recomputes p95 from the raw frame intervals',async()=>{
 const base=probe(PLOT_START,62000),iv=[...base.intervalsMs,...Array(300).fill(60)],total=iv.reduce((a,b)=>a+b,0),last=base.firstFrameMs+total;
 expect(await withOpt({plot:{intervalsMs:iv,lastFrameMs:last,endMs:last+5,elapsedMs:last+5-PLOT_START}})).toContain('WEB09_P95_OVER_LIMIT:plot-5000');
});
test('WEB09 takes no tolerance from the data itself: a 60 s interval appended, a frame span that does not match the clock, a hidden or short window, bad numbers',async()=>{
 const base=probe(PLOT_START,62000);
 expect(await withOpt({plot:{intervalsMs:[...base.intervalsMs,60000]}})).toContain('WEB09_WINDOW_INCONSISTENT:plot-5000');
 expect(await withOpt({plot:{intervalsMs:[...base.intervalsMs,...base.intervalsMs]}})).toContain('WEB09_WINDOW_INCONSISTENT:plot-5000');
 expect(await withOpt({plot:{firstFrameMs:base.firstFrameMs+500,lastFrameMs:base.lastFrameMs+500}})).toContain('WEB09_WINDOW_INCONSISTENT:plot-5000');
 expect(await withOpt({plot:{endMs:base.endMs+400,elapsedMs:base.elapsedMs+400}})).toContain('WEB09_WINDOW_INCONSISTENT:plot-5000');
 // the first frame's vsync timestamp may precede the clock read that opened the window by one frame, not by more
 expect(await withOpt({plot:{startMs:base.startMs+10,elapsedMs:base.elapsedMs-10}})).not.toContain('WEB09_WINDOW_INCONSISTENT:plot-5000');
 expect(await withOpt({plot:{startMs:base.startMs+40,elapsedMs:base.elapsedMs-40}})).toContain('WEB09_WINDOW_INCONSISTENT:plot-5000');
 expect(await withOpt({plot:probe(PLOT_START,30000)})).toContain('WEB09_WINDOW_SHORT:plot-5000');
 expect(await withOpt({plot:{visibilityState:'hidden'}})).toContain('WEB09_PAGE_HIDDEN:plot-5000');
 for(const bad of [-1,'x',0])expect(await withOpt({plot:{intervalsMs:[...base.intervalsMs,bad]}})).toContain('WEB09_INTERVALS_INVALID:plot-5000');
});
test('WEB09 ties its windows to real boundaries: the spec\'s test window, the attempt start and the process end; Playwright\'s duration is not an end time',async()=>{
 // a clean capture whose Playwright duration leaves out worker-fixture time ends after startTime+duration: it must pass
 expect(await withOpt({attempt:{duration:149000}})).toEqual([]);
 // but the duration can never be shorter than the measured time it contained
 expect(await withOpt({attempt:{duration:100000}})).toContain('WEB09_WINDOW_OUTSIDE_ATTEMPT');
 expect(await withOpt({testWindow:{startEpochMs:ATTEMPT_START-1}})).toContain('WEB09_WINDOW_OUTSIDE_ATTEMPT');
 expect(await withOpt({testWindow:{endEpochMs:ORIGIN+BELIEF_START+BELIEF_MS+200000}})).toContain('WEB09_WINDOW_OUTSIDE_ATTEMPT');
 expect(await withOpt({testWindow:{endEpochMs:ORIGIN+BELIEF_START+1000}})).toContain('WEB09_WINDOW_OUTSIDE_ATTEMPT');
 expect(await withOpt({testWindow:{startEpochMs:ORIGIN+PLOT_START+1000}})).toContain('WEB09_WINDOW_OUTSIDE_ATTEMPT');
 expect(await withOpt({skip:['suites/e2e-perf/result.json']})).toContain('WEB09_ATTEMPT_MISSING');
 expect(await withOpt({skip:['suites/e2e-perf/process.json']})).toContain('WEB09_ATTEMPT_MISSING');
 expect(await withOpt({belief:{...probe(BELIEF_START-30000,62000),...TWO_PASSES()}})).toContain('WEB09_WINDOWS_OVERLAP');
});
test('WEB09 judges the renderer, not only requestAnimationFrame: cadence, duration, draw calls, ticks beyond the horizon, a skipped event',async()=>{
 const slow={seeks:[{atMs:BELIEF_START+20,tick:FIRST}],renders:pass(BELIEF_START+30,100,1100,54.3)};
 expect(await withOpt({belief:slow})).toContain('WEB09_CADENCE_P95_OVER_LIMIT:belief-layer');
 expect(await withOpt({belief:TWO_PASSES({durationMs:40})})).toContain('WEB09_RENDER_P95_OVER_LIMIT:belief-layer');
 expect(await withOpt({belief:TWO_PASSES({drawCalls:0})})).toContain('WEB09_RENDER_STREAM:belief-layer');
 expect(await withOpt({belief:TWO_PASSES({worldTick:HORIZON+5})})).toContain('WEB09_RENDER_STREAM:belief-layer');
 expect(await withOpt({belief:{renders:[]}})).toContain('WEB09_RENDER_STREAM:belief-layer');
 const skipped=TWO_PASSES();skipped.renders[10]={...skipped.renders[10]!,count:skipped.renders[10]!.count+3};expect(await withOpt({belief:skipped})).toContain('WEB09_RENDER_STREAM:belief-layer');
});
test('WEB09 allows no stall inside playback and no restart that is not a stamped seek (a tick one lower hides nothing)',async()=>{
 const stalled=(by:number,lower=false)=>{const t=TWO_PASSES();move(t.renders,1200,by);t.seeks[1]={...t.seeks[1]!,atMs:t.seeks[1]!.atMs+by};if(lower)t.renders[1200]={...t.renders[1200]!,worldTick:t.renders[1199]!.worldTick-1};return t;};
 expect(await withOpt({belief:stalled(700)})).toContain('WEB09_RENDER_GAP:belief-layer');
 // the same stall with the first render after it showing the previous tick minus one: a backward tick without a seek
 expect(await withOpt({belief:stalled(700,true)})).toContain('WEB09_RENDER_TICK_BACKWARD:belief-layer');
 // a pass that goes back with no seek recorded
 expect(await withOpt({belief:{...TWO_PASSES(),seeks:[{atMs:BELIEF_START+20,tick:FIRST}]}})).toContain('WEB09_RENDER_TICK_BACKWARD:belief-layer');
});
test('WEB09 counts playback from stamped passes: 60 s of real playback, seeks bounded in number, latency and target tick',async()=>{
 const two=TWO_PASSES();
 // one pass is 41.7 s of playback, not 60
 expect(await withOpt({belief:{seeks:[two.seeks[0]],renders:two.renders.slice(0,NPASS)}})).toContain('WEB09_PLAYBACK_SHORT:belief-layer');
 // a seek that took 4 s to show its first render
 expect(await withOpt({belief:{...two,seeks:[two.seeks[0],{atMs:BELIEF_START+42050-4000,tick:FIRST}]}})).toContain('WEB09_RENDER_PASS:belief-layer');
 // a pass that does not start at the sought tick
 expect(await withOpt({belief:{...two,seeks:[two.seeks[0],{...two.seeks[1]!,tick:300}]}})).toContain('WEB09_RENDER_PASS:belief-layer');
 // more seeks than the spec makes; a seek without a pass
 expect(await withOpt({belief:{...two,seeks:[...two.seeks,...[1,2,3].map(i=>({atMs:BELIEF_START+60000+i*100,tick:FIRST}))]}})).toContain('WEB09_RENDER_STREAM:belief-layer');
 expect(await withOpt({belief:{...two,seeks:[...two.seeks,{atMs:BELIEF_START+64000,tick:FIRST}]}})).toContain('WEB09_RENDER_PASS:belief-layer');
});
test('WEB09 binds the claimed first tick to the first stamped seek and rendered tick',async()=>{
 expect(await withOpt({beliefWork:{firstTick:FIRST-1}})).toContain('WEB09_RENDER_PASS:belief-layer');
});
test.each([-1,HORIZON])('WEB09 rejects a first tick outside the playback range (%i)',async(firstTick)=>{
 expect(await withOpt({beliefWork:{firstTick}})).toContain('WEB09_BELIEF_PACKAGE:belief-layer');
});
test('WEB09 counts the belief ghost per rendered frame and checks it against the package',async()=>{
 expect(await withOpt({belief:TWO_PASSES({belief:false})})).toContain('WEB09_BELIEF_NOT_DRAWN:belief-layer');
 // belief drawn at ticks before the package's first estimate
 expect(await withOpt({},fakeOpen({report:cellReport({},{beliefs:[{objectId:'cup-1',tick:900,belief:{valid:true}}]})}))).toContain('WEB09_BELIEF_NOT_DRAWN:belief-layer');
 // a replay that never moves is not playback
 const still=TWO_PASSES();still.renders.forEach(e=>{e.worldTick=300;});still.seeks.forEach(s=>{s.tick=300;});expect(await withOpt({belief:still})).toContain('WEB09_RENDER_PROGRESSION:belief-layer');
});
test('WEB09 cross-checks the bench workload: run, trace manifest, corruption, axes, sample counts, source and backend',async()=>{
 const bad='WEB09_PLOT_WORKLOAD:plot-5000';
 expect(await withOpt({trace:trace(4000)})).toContain(bad);
 expect(await withOpt({trace:trace(5010,{runId:'another'})})).toContain(bad);
 expect(await withOpt({trace:trace(5010,{manifestSha256:'8'.repeat(64)})})).toContain(bad);
 expect(await withOpt({trace:trace(5010,{issues:['TRACE_CORRUPT']})})).toContain(bad);
 expect(await withOpt({trace:trace(5010,{traces:trace().traces.slice(0,1)})})).toContain(bad);
 expect(await withOpt({trace:trace(5010,{traces:trace().traces.map(a=>({...a,axisId:'x'}))})})).toContain(bad);
 expect(await withOpt({report:benchReport({},{sourceCommit:'f'.repeat(40)})})).toContain(bad);
 expect(await withOpt({report:benchReport({},{backendSetId:'engineering-mujoco-cell-v1'})})).toContain(bad);
 expect(await withOpt({report:benchReport({},{scenario:{id:'MJ-BV01'}})})).toContain(bad);
 expect(await withOpt({report:benchReport({outcome:{status:'failed'}})})).toContain(bad);
 expect(await withOpt({report:benchReport({tuning:{...benchReport().tuning,unstable:true}})})).toContain(bad);
 const noFlag=benchReport();delete (noFlag.tuning as {unstable?:boolean}).unstable;expect(await withOpt({report:noFlag})).not.toContain(bad);
 expect(await withOpt({plotWork:{runId:''}})).toContain(bad);
 expect(await withOpt({plotWork:{runId:'another'}})).toContain(bad);
 expect(await withOpt({plotWork:{plottedPoints:5000}})).toContain(bad);
 expect(await withOpt({skip:[BASE+'web09/bench-trace.json']})).toContain(bad);
});
test.each([
 ['empty',[]],
 ['wrong',['amr-1/wheel-left','xarm-1/joint-1']],
 ['duplicate',['amr-1/wheel-left','amr-1/wheel-left']],
] as const)('WEB09 rejects %s axis sets even when the trace and tuning report agree',async(name,axisIds)=>{
 const report=benchReport();report.tuning.axisIds=[...axisIds];
 const t=trace();t.traces=axisIds.map((axisId,i)=>({...t.traces[i]!,axisId}));
 const plotWork=name==='empty'?{samplesPerSeries:undefined,plottedPoints:undefined}:{};
 expect(await withOpt({trace:t,report,plotWork})).toContain('WEB09_PLOT_WORKLOAD:plot-5000');
});
test.each([
 ['missing measured sample count',{samples:undefined}],
 ['missing chunk count',{chunks:undefined}],
 ['fractional chunk count',{chunks:1.5}],
 ['zero chunk count',{chunks:0}],
] as const)('WEB09 rejects a tuning report with %s',async(_name,counters)=>{
 const report=benchReport({tuning:{...benchReport().tuning,trace:{...benchReport().tuning.trace,...counters}}});
 expect(await withOpt({report})).toContain('WEB09_PLOT_WORKLOAD:plot-5000');
});
test.each(['samplesPerSeries','plottedPoints'] as const)('WEB09 rejects a missing plot counter %s with otherwise valid data',async(counter)=>{
 expect(await withOpt({plotWork:{[counter]:undefined}})).toContain('WEB09_PLOT_WORKLOAD:plot-5000');
});
test('WEB09 requires 5,000 measured samples on both axes after the ten initial substeps',async()=>{
 const t=trace();
 // The first plot still has 5,010 points, but the other axis has only 4,999 measured samples.
 t.traces[1]= {...t.traces[1]!,samples:t.traces[1]!.samples.slice(0,5009)};
 expect(await withOpt({trace:t})).toContain('WEB09_PLOT_WORKLOAD:plot-5000');
});
test('WEB09 rejects a trace over the registered bench sample cap',async()=>{
 const overCap=benchReport();overCap.tuning.trace.samples=5001;
 expect(await withOpt({trace:trace(5011),report:overCap,plotWork:{samplesPerSeries:5011,plottedPoints:5011}})).toContain('WEB09_PLOT_WORKLOAD:plot-5000');
});
const genuineBench=benchReport(),genuineEngine=genuineBench.tuning.engine,genuineBackend=genuineBench.manifest.backends[0];
test.each([
 ['the mock engine and backend',{id:'mock',version:'1'},[{id:'mock',version:'1',model:'mock',dynamics:false}]],
 ['a missing engine',undefined,[genuineBackend]],
 ['mismatched versions',{...genuineEngine,version:'3.16.0'},[genuineBackend]],
 ['a backend without dynamics',genuineEngine,[{...genuineBackend,dynamics:false}]],
 ['a different backend model',genuineEngine,[{...genuineBackend,model:'mock'}]],
] as const)('WEB09 rejects %s in the bench report',async(_name,engine,backends)=>{
 const report=benchReport({tuning:{...genuineBench.tuning,engine}},{backends});
 expect(await withOpt({report})).toContain('WEB09_PLOT_WORKLOAD:plot-5000');
});
test('WEB09 counts only valid trace samples: finite numbers, the recorded step, a boolean saturation flag',async()=>{
 const bad='WEB09_PLOT_WORKLOAD:plot-5000',axes=(f:(a:{axisId:string;dtS:number;samples:unknown[]})=>unknown)=>trace(5010,{traces:trace().traces.map(f)});
 expect(await withOpt({trace:axes(a=>({...a,samples:a.samples.map(()=>({}))}))})).toContain(bad);
 expect(await withOpt({trace:axes(a=>({...a,samples:a.samples.map(x=>({...(x as object),actual:'1'}))}))})).toContain(bad);
 expect(await withOpt({trace:axes(a=>({...a,dtS:-1}))})).toContain(bad);
 expect(await withOpt({trace:axes(a=>({...a,dtS:0.001}))})).toContain(bad);
 expect(await withOpt({trace:axes(a=>({...a,samples:a.samples.map(x=>({...(x as object),torqueNm:Infinity}))}))})).toContain(bad);
 expect(await withOpt({trace:axes(a=>({...a,samples:a.samples.map(x=>({...(x as object),saturated:'yes'}))}))})).toContain(bad);
 expect(await withOpt({trace:axes(a=>({...a,samples:a.samples.map((x,i)=>i<20?{}:x)}))})).toContain(bad);
 expect(await withOpt({trace:axes(a=>({...a,axisId:''}))})).toContain(bad);
 // a few unrecorded samples (null) and an unavailable feedback are fine as long as enough valid samples remain
 expect(await withOpt({plotWork:{samplesPerSeries:5005,plottedPoints:5005},trace:axes(a=>({...a,samples:a.samples.map((x,i)=>i<5?null:{...(x as object),feedback:null})}))})).not.toContain(bad);
});
test('WEB09 counts no standing replay as playback: each pass advances at one tick per 20 ms',async()=>{
 const two=TWO_PASSES();
 // the second pass stands at the first tick for its whole 41.7 s
 const standing=two.renders.map((e,i)=>i<NPASS?e:{...e,worldTick:FIRST});
 expect(await withOpt({belief:{...two,renders:standing}})).toEqual(expect.arrayContaining(['WEB09_PLAYBACK_STALLED:belief-layer']));
 // a pass that advances at a tenth of real time
 const slow=two.renders.map((e,i)=>i<NPASS?e:{...e,worldTick:Math.round(FIRST+(e.worldTick-FIRST)/10)});
 expect(await withOpt({belief:{...two,renders:slow}})).toContain('WEB09_PLAYBACK_STALLED:belief-layer');
 // two real passes pass
 expect(await withOpt({belief:two})).toEqual([]);
});
test.each([0,1])('WEB09 rejects a 20 s cursor freeze followed by catch-up in pass %i',async(index)=>{
 const two=TWO_PASSES(),r=two.renders.slice(index*NPASS,(index+1)*NPASS),start=r[0]!.atMs,remaining=r.at(-1)!.atMs-start-20000;
 for(const e of r) e.worldTick=FIRST+Math.round((HORIZON-FIRST)*Math.max(0,e.atMs-start-20000)/remaining);
 expect(await withOpt({belief:two})).toContain('WEB09_PLAYBACK_STALLED:belief-layer');
});
test.each([-1,1])('WEB09 rejects an interior phase excursion in direction %i with steady rendering and matching endpoints',async(direction)=>{
 const two=TWO_PASSES(),r=two.renders.slice(0,NPASS),start=r[0]!.atMs,wall=r.at(-1)!.atMs-start;
 for(const e of r){
  const fraction=(e.atMs-start)/wall;
  e.worldTick=FIRST+Math.round((HORIZON-FIRST)*(fraction+direction*1000/wall*Math.sin(Math.PI*fraction)));
 }
 expect(await withOpt({belief:two})).toContain('WEB09_PLAYBACK_STALLED:belief-layer');
});
test('WEB09 requires 60 s of playback supported by wall time as well as cursor progress',async()=>{
 const horizon=FIRST+1500,starts=[BELIEF_START+30,BELIEF_START+30030];
 const renders=starts.flatMap((start,i)=>pass(start,100+i*NPASS,NPASS,29900/(NPASS-1)).map((e,j)=>({...e,worldTick:FIRST+Math.round(1500*j/(NPASS-1))})));
 const belief=probe(BELIEF_START,61000,{seeks:starts.map(atMs=>({atMs:atMs-10,tick:FIRST})),renders});
 expect(await withOpt({belief,beliefWork:{replayHorizonTick:horizon}},fakeOpen({manifest:{horizon:{tick:horizon}}}))).toEqual(['WEB09_PLAYBACK_SHORT:belief-layer']);
});
test('WEB09 checks every ghost frame against the package at its cursor: a cup out of view ends the belief, a dropped update keeps it',async()=>{
 const bad='WEB09_BELIEF_NOT_DRAWN:belief-layer',rec=(extra:unknown[])=>fakeOpen({report:cellReport({},{beliefs:[{objectId:'cup-1',tick:10,belief:{valid:true}},...extra]})});
 // from tick 1000 the cup is out of view; every frame still flagged as drawing the ghost is a contradiction
 expect(await withOpt({},rec([{objectId:'cup-1',tick:1000,belief:null,dropped:false,reason:'OUT_OF_VIEW'}]))).toContain(bad);
 // a dropped update keeps the last published belief
 expect(await withOpt({},rec([{objectId:'cup-1',tick:1000,belief:null,dropped:true}]))).not.toContain(bad);
 // an invalid belief is never drawn
 expect(await withOpt({},rec([{objectId:'cup-1',tick:1000,belief:{valid:false},dropped:false}]))).toContain(bad);
 // other cups do not count
 expect(await withOpt({},fakeOpen({report:cellReport({},{beliefs:[{objectId:'cup-2',tick:10,belief:{valid:true}}]})}))).toContain('WEB09_BELIEF_PACKAGE:belief-layer');
});
test('WEB09 cross-checks the belief package: run, manifest hash, tuple, backend, issues, horizon, belief records',async()=>{
 const bad='WEB09_BELIEF_PACKAGE:belief-layer';
 expect(await withOpt({beliefWork:{runId:''}})).toContain(bad);
 expect(await withOpt({beliefWork:{package:{dir:'web09/belief-package',manifestSha256:'f'.repeat(64)}}})).toContain(bad);
 expect(await withOpt({},fakeOpen({manifest:{horizon:{tick:999}}}))).toContain(bad);
 expect(await withOpt({},fakeOpen({report:cellReport({},{beliefs:[]})}))).toContain(bad);
 expect(await withOpt({},fakeOpen({report:cellReport({},{issues:['X']})}))).toContain(bad);
 expect(await withOpt({},fakeOpen({report:cellReport({sourceCommit:'f'.repeat(40)})}))).toContain(bad);
 expect(await withOpt({},fakeOpen({report:cellReport({backendSetId:'engineering-mujoco-bench-v1'})}))).toContain(bad);
 expect(await withOpt({},fakeOpen({report:cellReport({perception:{graspMode:'fixed_program'}})}))).toContain(bad);
 expect(await withOpt({skip:[BASE+'web09/belief-package/manifest.json']})).toContain(bad);
});
test('WEB09 is bound to the production build of this tuple and to its own limit',async()=>{
 expect(await withOpt({doc:{productionSha256:'f'.repeat(64)}})).toContain('WEB09_BUILD_BINDING');
 expect(await withOpt({doc:{limitMs:60}})).toContain('WEB09_TARGET_INVALID');
 expect(await withOpt({doc:{schemaVersion:2}})).toContain('WEB09_TARGET_INVALID');
 const h=fixture();put(h.root,BASE+'production-ui/assets/main.js','substituted');expect(await run(h)).toEqual(['WEB09_PRODUCTION_INVALID']);
 expect(await withOpt({doc:{scenarios:[]}})).toContain('WEB09_SCENARIOS_INVALID');
});
test('verifyWebRecord reports WEB09 through this reader, no longer as a constant',async()=>{
 const f=fixture();expect((await verifyWebRecord(f.root,f.record,{web09:{open:fakeOpen()}})).WEB09).toEqual([]);
 rmSync(join(f.root,BASE+'web09.json'));expect((await verifyWebRecord(f.root,f.record)).WEB09).toEqual(['WEB09_MEASUREMENT_MISSING']);
});
