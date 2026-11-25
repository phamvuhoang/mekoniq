// WEB09: the frame timing the e2e-perf suite stores (lab tests/e2e/mujoco-perf.spec.ts, schema 3). Nothing is trusted but raw data kept beside the measurement: percentiles, windows, the render stream, the
// playback passes and the workload are recomputed here. Windows are tied to the real boundaries the spec wrote (its own test window), to the Playwright attempt and to the owning process; the workload is
// cross-checked between the bench trace, its report and the replay package, and against this tuple. The build is the production receipt of this very tuple (the WEB07 reader).
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {tsImport} from 'tsx/esm/api';
import {completedWheelBench,measuredWheelTrace} from './r4-wheel-bench-readback.mjs';
import {production} from './r4-web07-readback.mjs';
const LIMIT_MS=33,MIN_MS=60000,GAP_MS=500,SEEK_GAP_MS=3000,MAX_SEEKS=4,EDGE_MS=100,FRAME_LEAD_MS=17,CLOCK_MS=50,BELIEF_SHARE=0.8,BASE='suites/e2e-perf/screens/',hex=/^[a-f0-9]{64}$/;
const TICK_MS=20,PLAYBACK_PHASE_MS=200;
const sha=b=>createHash('sha256').update(b).digest('hex'),finite=n=>typeof n==='number'&&Number.isFinite(n),p95=v=>[...v].sort((a,b)=>a-b)[Math.ceil(v.length*.95)-1];
const sum=v=>v.reduce((a,b)=>a+b,0),parse=b=>{try{return JSON.parse(b);}catch{return null;}};
/** The attempt's start (Playwright's duration leaves out worker-fixture time, so it is not an end) and the owning process's real start and end. */
function boundaries(read){
 const tests=[],walk=n=>{for(const s of n.specs??[])tests.push(...s.tests);for(const c of n.suites??[])walk(c);},result=parse(read('suites/e2e-perf/result.json')),proc=parse(read('suites/e2e-perf/process.json'));
 if(!result||!proc)return null;walk(result);
 const r=tests.length===1&&tests[0].results?.length===1?tests[0].results[0]:null,start=Date.parse(r?.startTime),from=Date.parse(proc.startedAt),to=Date.parse(proc.finishedAt);
 return r&&[start,from,to,r.duration].every(finite)&&r.duration>0&&from<=start&&start<=to?{attemptStart:start,duration:r.duration,processStart:from,processEnd:to}:null;
}
function windowOf(s,issues,id){
 const v=s.intervalsMs;
 if(![s.timeOriginEpochMs,s.startMs,s.endMs,s.elapsedMs,s.firstFrameMs,s.lastFrameMs].every(finite)||Math.abs(s.endMs-s.startMs-s.elapsedMs)>.01||!Array.isArray(v)||!v.length||v.some(x=>!finite(x)||x<=0)){issues.push('WEB09_INTERVALS_INVALID:'+id);return null;}
 const total=sum(v);
 if(s.visibilityState!=='visible')issues.push('WEB09_PAGE_HIDDEN:'+id);
 // the intervals ARE the span between the first and the last animation frame, to the float; that span lies inside the window and leaves at most EDGE_MS at either end
 // (a frame timestamp is the vsync time: the first may lead the clock read that started the window by up to one 60 Hz frame)
 if(Math.abs(s.lastFrameMs-s.firstFrameMs-total)>.01||s.firstFrameMs<s.startMs-FRAME_LEAD_MS||s.lastFrameMs>s.endMs||s.firstFrameMs-s.startMs>EDGE_MS||s.endMs-s.lastFrameMs>EDGE_MS)issues.push('WEB09_WINDOW_INCONSISTENT:'+id);
 else if(v.length<Math.max(1000,Math.floor(total/50)))issues.push('WEB09_FRAME_COUNT:'+id);
 if(s.elapsedMs<MIN_MS||total<MIN_MS)issues.push('WEB09_WINDOW_SHORT:'+id);
 if(p95(v)>LIMIT_MS)issues.push('WEB09_P95_OVER_LIMIT:'+id);
 return {start:s.timeOriginEpochMs+s.startMs,end:s.timeOriginEpochMs+s.endMs,elapsed:s.elapsedMs};
}
function playbackDuration(frames){
 const first=frames[0],last=frames.at(-1),wall=last.atMs-first.atMs,sim=(last.worldTick-first.worldTick)*TICK_MS;
 if(sim<=0||wall<=0)return 0;
 let lastAdvance=first,minPhase=0,maxPhase=0;
 for(const e of frames){
  if(e.atMs-lastAdvance.atMs>GAP_MS)return 0;
  if(e.worldTick>lastAdvance.worldTick)lastAdvance=e;
  const phase=(e.atMs-first.atMs)-(e.worldTick-first.worldTick)*TICK_MS;
  // Bound elapsed-time error between any two renders. Repeated ticks and small
  // start/render delays fit the fixed envelope; longer passes earn no extra slack.
  minPhase=Math.min(minPhase,phase);
  maxPhase=Math.max(maxPhase,phase);
  if(maxPhase-minPhase>PLAYBACK_PHASE_MS)return 0;
 }
 return Math.min(wall,sim);
}
/** The render stream. Playback restarts exist only as stamped seeks: passes are cut at them, a pause across one is bounded, a tick that goes back without one is an error. */
function renders(s,issues,id,pkg){
 const r=s.renders,seeks=s.seeks,bad=()=>{issues.push('WEB09_RENDER_STREAM:'+id);};
 if(!Array.isArray(r)||r.length<2||!Array.isArray(seeks)||seeks.length<1||seeks.length>MAX_SEEKS||seeks.some((k,i)=>!finite(k?.atMs)||!Number.isInteger(k.tick)||k.tick<pkg.firstTick||k.tick>pkg.horizon||k.atMs<s.startMs||k.atMs>s.endMs||i>0&&k.atMs<=seeks[i-1].atMs))return bad();
 if(r.some((e,i)=>!finite(e?.atMs)||!finite(e.durationMs)||e.durationMs<0||!Number.isInteger(e.count)||!Number.isInteger(e.drawCalls)||e.drawCalls<1||!Number.isInteger(e.worldTick)||e.worldTick<0||e.worldTick>pkg.horizon||typeof e.belief!=='boolean'||e.atMs<s.startMs||e.atMs>s.endMs||i>0&&(e.count!==r[i-1].count+1||e.atMs<r[i-1].atMs)))return bad();
 if(seeks[0].tick!==pkg.firstTick)issues.push('WEB09_RENDER_PASS:'+id);
 const gaps=[],passes=[];let cur=null,k=0;
 for(let i=0;i<r.length;i++){
  const e=r[i];let startsPass=false;
  while(k<seeks.length&&seeks[k].atMs<=e.atMs){startsPass=true;cur={seek:seeks[k],frames:[]};k++;}
  if(i===0&&!cur){issues.push('WEB09_RENDER_PASS:'+id);return;}
  if(startsPass){
   // the first render after a stamped seek shows the sought tick, and the whole pause (end of the previous pass, seek, first render) is bounded
   if(e.worldTick!==cur.seek.tick||i>0&&e.atMs-r[i-1].atMs>SEEK_GAP_MS||e.atMs-cur.seek.atMs>SEEK_GAP_MS){issues.push('WEB09_RENDER_PASS:'+id);return;}
   passes.push(cur);
  }else{
   const prev=r[i-1],gap=e.atMs-prev.atMs;if(e.worldTick<prev.worldTick){issues.push('WEB09_RENDER_TICK_BACKWARD:'+id);return;}
   if(gap>0)gaps.push(gap);
  }
  cur.frames.push(e);
 }
 if(k<seeks.length||passes.length!==seeks.length)issues.push('WEB09_RENDER_PASS:'+id);
 const playback=passes.map(p=>playbackDuration(p.frames));
 if(playback.some(ms=>ms===0))issues.push('WEB09_PLAYBACK_STALLED:'+id);
 if(sum(playback)<MIN_MS)issues.push('WEB09_PLAYBACK_SHORT:'+id);
 if(gaps.some(g=>g>GAP_MS)||s.startMs+SEEK_GAP_MS<r[0].atMs||s.endMs-r.at(-1).atMs>SEEK_GAP_MS)issues.push('WEB09_RENDER_GAP:'+id);
 if(p95(r.map(e=>e.durationMs))>LIMIT_MS)issues.push('WEB09_RENDER_P95_OVER_LIMIT:'+id);
 if(gaps.length&&p95(gaps)>LIMIT_MS)issues.push('WEB09_CADENCE_P95_OVER_LIMIT:'+id);
 // every frame that claims the ghost must have a believed cup at its cursor in the package; and the ghost is in the scene in at least BELIEF_SHARE of the frames
 if(r.filter(e=>e.belief).length<BELIEF_SHARE*r.length||r.some(e=>e.belief&&!pkg.beliefAvailable(e.worldTick)))issues.push('WEB09_BELIEF_NOT_DRAWN:'+id);
 if(Math.max(...r.map(e=>e.worldTick))-Math.min(...r.map(e=>e.worldTick))<(pkg.horizon-pkg.firstTick)*.9)issues.push('WEB09_RENDER_PROGRESSION:'+id);
}
const identity=(report,record,backend,scenario)=>report?.manifest?.sourceCommit===record.identity?.before?.sourceCommit&&report.manifest.backendSetId===backend&&report.manifest.scenario?.id===scenario&&report.manifest.mode==='simulation'&&report.manifest.access==='simulated';
function plotWorkload(read,w,record,issues){
 const bad=()=>issues.push('WEB09_PLOT_WORKLOAD:plot-5000');
 try{
  const tb=read(BASE+w.benchTrace?.file),rb=read(BASE+w.benchReport?.file);
  if(!tb||!rb||sha(tb)!==w.benchTrace.sha256||sha(rb)!==w.benchReport.sha256)return bad();
  const trace=JSON.parse(tb),report=JSON.parse(rb),t=report.tuning,axes=trace.traces;
  if(typeof w.runId!=='string'||!w.runId||!identity(report,record,'engineering-mujoco-bench-v1','MJ-BENCH-WHEEL')||
   report.manifest.runId!==w.runId||!completedWheelBench(report)||!measuredWheelTrace(trace,t))return bad();
  // The response plot measures the first reported wheel and includes any valid initial points.
  const plotted=axes[0].samples.filter(sample=>sample!==null).length;
  if(w.samplesPerSeries!==plotted||w.plottedPoints!==plotted)bad();
 }catch{bad();}
}
async function openPackage(manifestBytes,assets){
 const {openReplayPackage}=await tsImport('../packages/lab-runtime/src/v2/replay/reader.ts',import.meta.url);return openReplayPackage(manifestBytes,assets);
}
let beliefTools;
async function beliefWorkload(read,w,record,issues,id,open){
 const bad=()=>{issues.push('WEB09_BELIEF_PACKAGE:'+id);return null;};
 try{
  const manifestBytes=read(BASE+w.package?.dir+'/manifest.json');if(!manifestBytes||sha(manifestBytes)!==w.package.manifestSha256)return bad();
  const replay=await open(manifestBytes,async function*(asset){const b=read(BASE+w.package.dir+'/'+asset.path);if(!b)throw Error('ASSET');yield b;});
  try{
   const m=replay.manifest,r=replay.capturedReport,e=r.perceptionEvidence,all=(e?.beliefs??[]).filter(b=>b.objectId==='cup-1'),cup=all.filter(b=>b.belief?.valid===true);
   if(!(typeof w.runId==='string'&&w.runId&&m.runId===w.runId&&r.manifest?.runId===w.runId&&identity(r,record,'engineering-mujoco-cell-v1','MJ-CELL-BV01')&&r.manifest.perception?.graspMode==='belief_estimated'&&
    m.horizon.tick===w.replayHorizonTick&&m.coverage?.prefixCovered&&m.provenance?.accepted!==true&&e?.issues?.length===0&&cup.length>0&&w.view==='3d'&&Number.isInteger(w.firstTick)&&w.firstTick>=0&&w.firstTick<m.horizon.tick))return bad();
   const {registeredBeliefPolicy,displayedBeliefAt,beliefDecisionIssues,beliefPublicationIssues,verifyBeliefNativeCommits,nativeBeliefTruth,scoreBeliefAttempts,validateBeliefRecordShape,validateGraspAttemptShape,validateRecoveryStepShape}=await (beliefTools??=tsImport('../packages/lab-runtime/src/v2/perception/belief-world-proof.ts',import.meta.url));
   const pm=r.manifest.perception,policy=await registeredBeliefPolicy(pm.profile?.digest),c=e.coverage,wt=r.arm?.worldTrace;
   if(!isDeepStrictEqual(e.policy,policy)||!isDeepStrictEqual(pm.profile,{id:policy.profile.id,revision:policy.profile.revision,digest:policy.profile.digest,sha256:policy.profileSha256})||
    c?.scope!=='belief_evaluations'||c.prefixCovered!==true||c.firstTick!==0||c.lastTick!==m.horizon.tick||typeof c.streamFinalized!=='boolean'||e.complete!==c.streamFinalized||
    wt?.prefixCovered!==true||wt.firstTick!==0||wt.lastTick!==m.horizon.tick||wt.publicCommittedTick!==m.horizon.tick||wt.samples!==m.horizon.tick+1||wt.reasonCodes?.length!==0||
    m.coverage.issues?.length!==0||m.coverage.terminal!==null||m.coverage.gaps?.length!==0||!e.beliefs.every(validateBeliefRecordShape)||!Array.isArray(e.attemptRecords)||!e.attemptRecords.every(validateGraspAttemptShape)||!Array.isArray(e.recovery)||!e.recovery.every(validateRecoveryStepShape))return bad();
   if(beliefDecisionIssues(e.beliefs,e.attemptRecords,{graspMode:pm.graspMode},policy.profile).length)return bad();
   const sceneRef=m.assets.find(a=>a.role==='scene'),scene=JSON.parse(Buffer.from(await replay.readAsset(sceneRef.path)).toString()),world=[];
   for await(const row of replay.samples('world'))world.push(row);
   if(beliefPublicationIssues(e.beliefs,policy.profile,world,scene,m.horizon.tick).length||!isDeepStrictEqual(e.attempts,[...new Map(e.attemptRecords.map(a=>[a.attemptId,a])).values()]))return bad();
   const programs=Buffer.from(await replay.readAsset('bundle/'+scene.programsRef.path));if(sha(programs)!==scene.programsRef.sha256)return bad();
   verifyBeliefNativeCommits(e.attemptRecords,e.recovery,world,scene,JSON.parse(programs).programs);
   scoreBeliefAttempts(e.attemptRecords,nativeBeliefTruth(world,scene));
   return {firstBeliefTick:Math.min(...cup.map(b=>b.tick)),horizon:m.horizon.tick,firstTick:w.firstTick,beliefAvailable:tick=>displayedBeliefAt(e,'cup-1',tick)!==null};
  }finally{replay.close?.();}
 }catch{return bad();}
}
export async function verifyWeb09Record(read,record,{open=openPackage}={}){
 const bytes=read(BASE+'web09.json');if(!bytes)return ['WEB09_MEASUREMENT_MISSING'];
 const build=production(read,BASE,record);if(build.issue)return ['WEB09_'+build.issue];
 const d=parse(bytes);if(!d)return ['WEB09_MEASUREMENT_CORRUPT'];
 const issues=[];
 if(d.schemaVersion!==3||d.kind!=='web09-frame-timing'||d.limitMs!==LIMIT_MS||d.minimumDurationMs!==MIN_MS||d.viewport?.width!==1440||d.viewport?.height!==900)issues.push('WEB09_TARGET_INVALID');
 if(!hex.test(d.productionSha256)||d.productionSha256!==build.sha256)issues.push('WEB09_BUILD_BINDING');
 const ids=(d.scenarios??[]).map(s=>s?.id);
 if(JSON.stringify(ids)!==JSON.stringify(['plot-5000','belief-layer'])){issues.push('WEB09_SCENARIOS_INVALID');return issues;}
 const [plot,belief]=d.scenarios,wp=windowOf(plot,issues,'plot-5000'),wb=windowOf(belief,issues,'belief-layer'),b=boundaries(read),tw=d.testWindow;
 if(!b||!finite(tw?.startEpochMs)||!finite(tw.endEpochMs)||tw.endEpochMs<=tw.startEpochMs)issues.push('WEB09_ATTEMPT_MISSING');
 else{
  // the test body started after the attempt did and ended inside the owning process; the scenario windows lie inside the body (two clocks, CLOCK_MS apart at most);
  // the attempt's duration (which leaves out fixture time) cannot be shorter than the measured time it contained
  if(tw.startEpochMs<b.attemptStart||tw.endEpochMs>b.processEnd)issues.push('WEB09_WINDOW_OUTSIDE_ATTEMPT');
  for(const w of [wp,wb])if(w&&(w.start<tw.startEpochMs-CLOCK_MS||w.end>tw.endEpochMs+CLOCK_MS))issues.push('WEB09_WINDOW_OUTSIDE_ATTEMPT');
  if(wp&&wb&&sum([wp.elapsed,wb.elapsed])>b.duration)issues.push('WEB09_WINDOW_OUTSIDE_ATTEMPT');
 }
 if(wp&&wb&&wp.end>wb.start)issues.push('WEB09_WINDOWS_OVERLAP');
 plotWorkload(read,plot.workload??{},record,issues);
 const pkg=await beliefWorkload(read,belief.workload??{},record,issues,'belief-layer',open);
 if(pkg)renders(belief,issues,'belief-layer',pkg);
 return [...new Set(issues)];
}
