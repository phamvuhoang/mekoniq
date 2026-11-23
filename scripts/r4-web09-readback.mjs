// WEB09: the frame timing the e2e-perf suite stores (lab tests/e2e/mujoco-perf.spec.ts). Nothing is trusted but the raw intervals: p95 is recomputed here, the window and workload are re-checked,
// and the measurement is bound to the production build (the same receipt reader as WEB07) of this very tuple.
import {production} from './r4-web07-readback.mjs';
const LIMIT_MS=33,MIN_MS=60000,BASE='suites/e2e-perf/screens/',hex=/^[a-f0-9]{64}$/;
const p95=v=>[...v].sort((a,b)=>a-b)[Math.ceil(v.length*.95)-1];
export function verifyWeb09Record(read,record){
 const bytes=read(BASE+'web09.json');if(!bytes)return ['WEB09_MEASUREMENT_MISSING'];
 const build=production(read,BASE,record);if(build.issue)return ['WEB09_'+build.issue];
 let d;try{d=JSON.parse(bytes);}catch{return ['WEB09_MEASUREMENT_CORRUPT'];}
 const issues=[];
 if(d?.schemaVersion!==1||d.kind!=='web09-frame-timing'||d.limitMs!==LIMIT_MS||d.minimumDurationMs!==MIN_MS||d.viewport?.width!==1440||d.viewport?.height!==900)issues.push('WEB09_TARGET_INVALID');
 if(!hex.test(d?.productionSha256)||d.productionSha256!==build.sha256)issues.push('WEB09_BUILD_BINDING');
 const ids=(d?.scenarios??[]).map(s=>s?.id);
 if(JSON.stringify(ids)!==JSON.stringify(['plot-5000','belief-layer'])){issues.push('WEB09_SCENARIOS_INVALID');return issues;}
 for(const s of d.scenarios){
  const v=s.intervalsMs,id=':'+s.id;
  if(!Array.isArray(v)||!v.length||v.some(x=>typeof x!=='number'||!Number.isFinite(x)||x<=0)){issues.push('WEB09_INTERVALS_INVALID'+id);continue;}
  const sum=v.reduce((a,b)=>a+b,0);
  if(s.visibilityState!=='visible')issues.push('WEB09_PAGE_HIDDEN'+id);
  if(!(s.elapsedMs>=MIN_MS)||sum<MIN_MS)issues.push('WEB09_WINDOW_SHORT'+id);
  else if(v.length<Math.max(1000,Math.floor(sum/50)))issues.push('WEB09_FRAME_COUNT'+id);
  if(p95(v)>LIMIT_MS)issues.push('WEB09_P95_OVER_LIMIT'+id);
  const w=s.workload??{};
  if(s.id==='plot-5000'&&!(Number.isInteger(w.samplesPerSeries)&&w.samplesPerSeries>=5000&&w.plottedPoints===w.samplesPerSeries&&typeof w.runId==='string'))issues.push('WEB09_PLOT_WORKLOAD'+id);
  if(s.id==='belief-layer'&&!(Number.isInteger(w.beliefRecords)&&w.beliefRecords>0&&Number.isInteger(s.beliefFrames)&&s.beliefFrames>=0.8*v.length&&w.view==='3d'&&typeof w.runId==='string'))issues.push('WEB09_BELIEF_NOT_DRAWN'+id);
 }
 return [...new Set(issues)];
}
