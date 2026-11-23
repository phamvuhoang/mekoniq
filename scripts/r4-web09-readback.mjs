// WEB09: the frame timing the e2e-perf suite stores (lab tests/e2e/mujoco-perf.spec.ts). Nothing is trusted but raw data: percentiles, the window, the render stream and the workload are recomputed here,
// the window is tied to the Playwright attempt that produced it, the workload comes from the bench trace/report and the replay package kept beside the measurement, and the build is the
// production receipt of this very tuple (the same reader as WEB07).
import {createHash} from 'node:crypto';
import {tsImport} from 'tsx/esm/api';
import {production} from './r4-web07-readback.mjs';
const LIMIT_MS=33,MIN_MS=60000,GAP_MS=500,RESTART_MS=2000,MAX_RESTARTS=3,BELIEF_SHARE=0.8,BASE='suites/e2e-perf/screens/',hex=/^[a-f0-9]{64}$/;
const sha=b=>createHash('sha256').update(b).digest('hex'),finite=n=>typeof n==='number'&&Number.isFinite(n),p95=v=>[...v].sort((a,b)=>a-b)[Math.ceil(v.length*.95)-1];
const sum=v=>v.reduce((a,b)=>a+b,0);
function attemptWindow(read){
 try{
  const b=read('suites/e2e-perf/result.json'),tests=[];
  const walk=n=>{for(const s of n.specs??[])tests.push(...s.tests);for(const c of n.suites??[])walk(c);};walk(JSON.parse(b));
  const r=tests.length===1&&tests[0].results?.length===1?tests[0].results[0]:null,start=Date.parse(r?.startTime);
  return r&&finite(start)&&finite(r.duration)&&r.duration>0?{start,end:start+r.duration}:null;
 }catch{return null;}
}
function window(s,issues,id){
 const v=s.intervalsMs;
 if(![s.timeOriginEpochMs,s.startMs,s.endMs,s.elapsedMs].every(finite)||Math.abs(s.endMs-s.startMs-s.elapsedMs)>.01||!Array.isArray(v)||!v.length||v.some(x=>!finite(x)||x<=0)){issues.push('WEB09_INTERVALS_INVALID:'+id);return null;}
 const total=sum(v);
 if(s.visibilityState!=='visible')issues.push('WEB09_PAGE_HIDDEN:'+id);
 if(s.elapsedMs<MIN_MS||total<MIN_MS)issues.push('WEB09_WINDOW_SHORT:'+id);
 // the frame intervals are the window: they may not cover more (or much less) than the clock says
 if(Math.abs(s.elapsedMs-total)>Math.max(250,Math.max(...v)))issues.push('WEB09_WINDOW_INCONSISTENT:'+id);
 else if(v.length<Math.max(1000,Math.floor(total/50)))issues.push('WEB09_FRAME_COUNT:'+id);
 if(p95(v)>LIMIT_MS)issues.push('WEB09_P95_OVER_LIMIT:'+id);
 return {start:s.timeOriginEpochMs+s.startMs,end:s.timeOriginEpochMs+s.endMs};
}
function renders(s,issues,id,firstBeliefTick){
 const r=s.renders;
 if(!Array.isArray(r)||r.length<2||r.some((e,i)=>!finite(e?.atMs)||!finite(e.durationMs)||e.durationMs<0||!Number.isInteger(e.count)||!Number.isInteger(e.drawCalls)||e.drawCalls<1||!Number.isInteger(e.worldTick)||typeof e.belief!=='boolean'||
  e.atMs<s.startMs||e.atMs>s.endMs||i>0&&(e.count!==r[i-1].count+1||e.atMs<r[i-1].atMs))){issues.push('WEB09_RENDER_STREAM:'+id);return;}
 // a restart (the spec seeks back to the first estimate and presses play) shows as a tick that goes back; it may pause the stream up to RESTART_MS, at most MAX_RESTARTS times, and is not playback cadence
 const gaps=[];let restarts=0,badRestart=false;
 for(let i=1;i<r.length;i++){const gap=r[i].atMs-r[i-1].atMs;if(r[i].worldTick<r[i-1].worldTick){restarts++;if(gap>RESTART_MS)badRestart=true;}else if(gap>0)gaps.push(gap);}
 if(r.at(-1).atMs-r[0].atMs<s.elapsedMs*.9||gaps.some(g=>g>GAP_MS)||badRestart||restarts>MAX_RESTARTS||s.startMs+GAP_MS<r[0].atMs||s.endMs-r.at(-1).atMs>GAP_MS)issues.push('WEB09_RENDER_GAP:'+id);
 if(p95(r.map(e=>e.durationMs))>LIMIT_MS)issues.push('WEB09_RENDER_P95_OVER_LIMIT:'+id);
 if(gaps.length&&p95(gaps)>LIMIT_MS)issues.push('WEB09_CADENCE_P95_OVER_LIMIT:'+id);
 const belief=r.filter(e=>e.belief).length;
 if(belief<BELIEF_SHARE*r.length||r.some(e=>e.belief&&e.worldTick<firstBeliefTick))issues.push('WEB09_BELIEF_NOT_DRAWN:'+id);
 return r;
}
async function plotWorkload(read,w,issues){
 const bad=()=>issues.push('WEB09_PLOT_WORKLOAD:plot-5000');
 try{
  const tb=read(BASE+w.benchTrace?.file),rb=read(BASE+w.benchReport?.file);
  if(!tb||!rb||sha(tb)!==w.benchTrace.sha256||sha(rb)!==w.benchReport.sha256)return bad();
  const trace=JSON.parse(tb),report=JSON.parse(rb),axis=trace.traces?.[0],n=axis?.samples?.filter(Boolean).length;
  if(!(typeof w.runId==='string'&&w.runId&&report.manifest?.runId===w.runId&&report.outcome?.status==='completed'&&n>=5000&&w.samplesPerSeries===n&&w.plottedPoints===n))bad();
 }catch{bad();}
}
async function openPackage(manifestBytes,assets){
 const {openReplayPackage}=await tsImport('../packages/lab-runtime/src/v2/replay/reader.ts',import.meta.url);return openReplayPackage(manifestBytes,assets);
}
async function beliefWorkload(read,w,issues,id,open){
 const bad=()=>{issues.push('WEB09_BELIEF_PACKAGE:'+id);return null;};
 try{
  const manifestBytes=read(BASE+w.package?.dir+'/manifest.json');if(!manifestBytes||sha(manifestBytes)!==w.package.manifestSha256)return bad();
  const replay=await open(manifestBytes,async function*(asset){const b=read(BASE+w.package.dir+'/'+asset.path);if(!b)throw Error('ASSET');yield b;});
  try{
   const m=replay.manifest,r=replay.capturedReport,e=r.perceptionEvidence,cup=(e?.beliefs??[]).filter(b=>b.objectId==='cup-1'&&b.belief);
   if(!(typeof w.runId==='string'&&w.runId&&m.runId===w.runId&&r.manifest?.runId===w.runId&&r.manifest.perception?.graspMode==='belief_estimated'&&r.manifest.scenario?.id==='MJ-CELL-BV01'&&m.horizon.tick===w.replayHorizonTick&&m.coverage?.prefixCovered&&cup.length>0&&w.view==='3d'))return bad();
   return {firstBeliefTick:Math.min(...cup.map(b=>b.tick)),horizon:m.horizon.tick};
  }finally{replay.close?.();}
 }catch{return bad();}
}
export async function verifyWeb09Record(read,record,{open=openPackage}={}){
 const bytes=read(BASE+'web09.json');if(!bytes)return ['WEB09_MEASUREMENT_MISSING'];
 const build=production(read,BASE,record);if(build.issue)return ['WEB09_'+build.issue];
 let d;try{d=JSON.parse(bytes);}catch{return ['WEB09_MEASUREMENT_CORRUPT'];}
 const issues=[];
 if(d?.schemaVersion!==2||d.kind!=='web09-frame-timing'||d.limitMs!==LIMIT_MS||d.minimumDurationMs!==MIN_MS||d.viewport?.width!==1440||d.viewport?.height!==900)issues.push('WEB09_TARGET_INVALID');
 if(!hex.test(d?.productionSha256)||d.productionSha256!==build.sha256)issues.push('WEB09_BUILD_BINDING');
 const ids=(d?.scenarios??[]).map(s=>s?.id);
 if(JSON.stringify(ids)!==JSON.stringify(['plot-5000','belief-layer'])){issues.push('WEB09_SCENARIOS_INVALID');return issues;}
 const attempt=attemptWindow(read),[plot,belief]=d.scenarios,wp=window(plot,issues,'plot-5000'),wb=window(belief,issues,'belief-layer');
 if(!attempt)issues.push('WEB09_ATTEMPT_MISSING');
 else for(const w of [wp,wb])if(w&&(w.start<attempt.start-1||w.end>attempt.end+1))issues.push('WEB09_WINDOW_OUTSIDE_ATTEMPT');
 if(wp&&wb&&wp.end>wb.start)issues.push('WEB09_WINDOWS_OVERLAP');
 await plotWorkload(read,plot.workload??{},issues);
 const pkg=await beliefWorkload(read,belief.workload??{},issues,'belief-layer',open);
 if(pkg){
  renders(belief,issues,'belief-layer',pkg.firstBeliefTick);
  const ticks=(belief.renders??[]).map(e=>e.worldTick);if(ticks.length&&Math.max(...ticks)-Math.min(...ticks)<(pkg.horizon-(belief.workload.firstTick??0))*.5)issues.push('WEB09_RENDER_PROGRESSION:belief-layer');
 }
 return [...new Set(issues)];
}
