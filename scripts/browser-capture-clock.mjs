// Receipt times are observer upper bounds. Neither the wire ACK nor display cursor is an internal Source commit timestamp.
export function checkCaptureClock(record){
 const r=[],c=record?.clock,finite=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
 if(!c)return ['CAPTURE_CLOCK_MISSING'];
 for(const k of ['nodeTimeOriginEpochMs','browserTimeOriginEpochMs','startEpochMs','endEpochMs','browserStartMs','browserEndMs'])if(!finite(c[k]))r.push('CAPTURE_CLOCK_INVALID:'+k);
 if(c.endEpochMs<=c.startEpochMs||Math.abs(c.browserTimeOriginEpochMs+c.browserStartMs-c.startEpochMs)>.01||Math.abs(c.browserTimeOriginEpochMs+c.browserEndMs-c.endEpochMs)>.01)r.push('CAPTURE_WINDOW_INVALID');
 const ids=new Set();for(const a of record.actions??[]){
  if(a.runId!==record.runId||typeof a.actionId!=='string'||!a.actionId||ids.has(a.actionId)){r.push('ACTION_IDENTITY_AMBIGUOUS');continue;}ids.add(a.actionId);
  if(!Number.isSafeInteger(a.tick)||a.tick<0||![a.requestStartEpochMs,a.responseEndEpochMs,a.observedAtEpochMs].every(finite)||a.requestStartEpochMs>a.responseEndEpochMs||a.responseEndEpochMs>a.observedAtEpochMs+2)r.push('ACTION_CLOCK_INVALID:'+a.actionId);
  const matches=(record.responses??[]).filter(x=>x.actionId===a.actionId&&x.runId===a.runId);
  if(matches.length!==1||matches[0].tick!==a.tick||matches[0].requestStartEpochMs!==a.requestStartEpochMs||matches[0].responseEndEpochMs!==a.responseEndEpochMs||matches[0].status!==200)r.push('ACTION_RESPONSE_CORRELATION:'+a.actionId);
 }
 if(!ids.size)r.push('CAPTURE_ACTIONS_MISSING');return [...new Set(r)];
}

export function assessCapture(record){
 const issues=checkCaptureClock(record),c=record?.capture,p=record?.pause,k=record?.clock,finite=x=>typeof x==='number'&&Number.isFinite(x),integer=x=>Number.isSafeInteger(x)&&x>=0,list=x=>Array.isArray(x)?x:[],fail=code=>issues.push(code);
 const events=list(c?.renderEvents),samples=list(c?.samples),actions=list(record?.actions),steps=actions.filter(a=>a.kind==='step').sort((a,b)=>a.requestStartEpochMs-b.requestStartEpochMs),pauses=actions.filter(a=>a.kind==='pause'),activeSteps=steps.filter(a=>a.observedAtEpochMs>=k?.startEpochMs&&a.observedAtEpochMs<=k?.endEpochMs);
 const windowMs=k?.endEpochMs-k?.startEpochMs;
 // A final priority control may stop a requested batch at a committed boundary.
 // Bind that shorter prefix to the same admitted revision, control and returned H.
 const prefix=new Map(steps.map((a,i)=>[a,i?steps[i-1].tick:a.tick-a.payload?.ticks]));
 const fullOrControlled=(a,i)=>{
  if(!i||a.tick-prefix.get(a)===a.payload?.ticks)return true;
  const pause=pauses[0];return i===steps.length-1&&a.tick>=prefix.get(a)&&a.tick-prefix.get(a)<a.payload?.ticks&&a.status==='paused'&&pause?.status==='paused'&&pause.tick===a.tick&&integer(a.expectedRevision)&&a.expectedRevision===pause.expectedRevision&&a.revision===pause.revision+1&&pause.revision===a.expectedRevision+1&&pause.requestStartEpochMs>=a.requestStartEpochMs&&pause.requestStartEpochMs<=a.responseEndEpochMs;
 };

 if(!finite(c?.elapsedMs)||c.elapsedMs<180000||!finite(windowMs)||Math.abs(c.elapsedMs-windowMs)>1)fail('CAPTURE_DURATION');
 if(activeSteps.length<2||activeSteps.at(-1)?.tick<=activeSteps[0]?.tick||steps.some((a,i)=>!integer(a.tick)||!Number.isSafeInteger(a.payload?.ticks)||a.payload.ticks<1||a.payload.ticks>30000||!fullOrControlled(a,i)))fail('CAPTURE_STEP_PROGRESSION');
 if(pauses.length!==1||p?.actionId!==pauses[0]?.actionId||!finite(p?.clickEpochMs)||p.clickEpochMs<k?.endEpochMs||!finite(p?.uiObservedAtEpochMs)||p.uiObservedAtEpochMs<p.clickEpochMs||pauses[0]?.requestStartEpochMs<p.clickEpochMs||pauses[0]?.responseEndEpochMs>p.uiObservedAtEpochMs||pauses[0]?.status!=='paused')fail('CAPTURE_PAUSE_CORRELATION');
 const pause=pauses[0],last=steps.at(-1);
 if(!last||pause?.tick!==last.tick||p?.lastCommittedTick!==pause?.tick||p?.stableAfterTick!==pause?.tick||p?.status!=='paused'||steps.some(a=>a.requestStartEpochMs>pause?.responseEndEpochMs)||['finalView','stableView','afterExportView'].some(key=>p?.[key]?.run?.id!==record?.runId||p?.[key]?.run?.status!=='paused'||p?.[key]?.tick!==pause?.tick))fail('CAPTURE_FINAL_HORIZON');
 let activeCellMs=0,fullCellDrawingMs=0,fullCellDrawingFrames=0;
 if(samples.length<2)fail('CAPTURE_ACTIVITY_STREAM');
 for(const [i,s]of samples.entries()){
  const previous=samples[i-1],delta=i?s.at-previous.at:0;
  if(!finite(s.at)||s.at<0||s.at>windowMs||i>0&&delta<=0||!finite(s.interval)||Math.abs(s.interval-(i?delta:s.at))>.01||typeof s.fullCell!=='boolean'||typeof s.drawn!=='boolean'||!integer(s.drawCalls)||s.drawn!==(s.drawCalls>0)||!integer(s.tick)||s.tick>pause?.tick||s.fullCell&&(!integer(s.worldTick)||s.worldTick>pause?.tick))fail('CAPTURE_ACTIVITY_STREAM');
  if(i&&previous.fullCell&&s.fullCell)activeCellMs+=delta;if(s.fullCell&&s.drawn)fullCellDrawingFrames++;if(i&&previous.fullCell&&s.fullCell&&s.drawn)fullCellDrawingMs+=delta;
 }
 if(activeCellMs<180000)fail('CAPTURE_ACTIVE_DRAWING_DURATION');
 const intervals=events.slice(1).map((s,i)=>s.atMs-events[i].atMs);
 if(events.length<2||events.some(e=>e.runId!==record?.runId||!finite(e.atMs)||e.atMs<k?.browserStartMs||e.atMs>k?.browserEndMs||!finite(e.durationMs)||e.durationMs<0||!integer(e.drawCalls)||e.drawCalls<1||!integer(e.worldTick)||e.worldTick>pause?.tick)||intervals.some(x=>!finite(x)||x<=0)||events.at(-1)?.atMs-events[0]?.atMs<windowMs*.9)fail('CAPTURE_RENDER_STREAM');
 // Active duration is wall time with a valid full world, independent of RAF/draw ratio.
 // Draw-slice duration remains diagnostic only. Missing streams or >500 ms gaps
 // exceed the existing live sample freshness bound; they are never interpolated away.
 if(samples.some((s,i)=>i>0&&s.at-samples[i-1].at>500)||intervals.some(x=>x>500)||samples[0]?.at>500||windowMs-samples.at(-1)?.at>500||events[0]?.atMs-k?.browserStartMs>500||k?.browserEndMs-events.at(-1)?.atMs>500)fail('CAPTURE_STREAM_GAP');
 if(events.at(-1)?.worldTick<=events[0]?.worldTick||events.some((e,i)=>i>0&&e.worldTick<events[i-1].worldTick))fail('CAPTURE_RENDER_PROGRESSION');
 const advances=events.filter((e,i)=>i===0||e.worldTick!==events[i-1].worldTick);
 if(advances.length<2||advances.at(-1)?.atMs-advances[0]?.atMs<180000||advances.some((e,i)=>i>0&&e.atMs-advances[i-1].atMs>500)||events.at(-1)?.atMs-advances.at(-1)?.atMs>500)fail('CAPTURE_RENDER_PROGRESSION');
 let cursor=0;
 for(const sample of samples){
  let calls=0,lastEvent;while(cursor<events.length&&events[cursor].atMs<=k?.browserStartMs+sample.at){lastEvent=events[cursor++];calls+=lastEvent.drawCalls;}
  if(sample.drawCalls!==calls||!!lastEvent!==sample.drawn||lastEvent&&sample.fullCell&&sample.worldTick!==lastEvent.worldTick)fail('CAPTURE_DRAW_ACTIVITY_CORRELATION');
 }
 // Rendering can continue between the final RAF and observer shutdown; those
 // events are still required to lie inside the capture window above.
 const worker=list(record?.workerRaw),before=list(record?.workerOutsideWindow?.before),after=list(record?.workerOutsideWindow?.after),all=[...before,...worker,...after],ids=new Set(),ticks=new Set();
 for(const [group,rows]of [['active',worker],['before',before],['after',after]])for(const w of rows){
  if(w.runId!==record?.runId||w.op!=='step'||typeof w.requestId!=='string'||!w.requestId||ids.has(w.requestId)||!integer(w.targetTick)||w.targetTick<1||ticks.has(w.targetTick)||w.expectedTick!==w.targetTick||w.ok!==true||!finite(w.elapsedMs)||w.elapsedMs<0||!finite(w.atEpochMs)||!finite(w.wallMs)||Math.abs(k?.nodeTimeOriginEpochMs+w.wallMs-w.atEpochMs)>.01)fail('CAPTURE_WORKER_IDENTITY');ids.add(w.requestId);ticks.add(w.targetTick);
  if(group==='active'?(w.atEpochMs<k?.startEpochMs||w.atEpochMs>k?.endEpochMs):group==='before'?w.atEpochMs>=k?.startEpochMs:w.atEpochMs<=k?.endEpochMs)fail('CAPTURE_WORKER_WINDOW');
  const action=steps.find(a=>w.targetTick>prefix.get(a)&&w.targetTick<=a.tick);if(!action||w.atEpochMs<action.requestStartEpochMs-2||w.atEpochMs>action.responseEndEpochMs+2)fail('CAPTURE_WORKER_ACTION_CORRELATION');
 }
 if(worker.length<2||Math.max(...worker.map(w=>w.atEpochMs))-Math.min(...worker.map(w=>w.atEpochMs))<windowMs*.9||activeSteps.some(a=>!all.some(w=>w.targetTick===a.tick))||last&&!all.some(w=>w.targetTick===last.tick))fail('CAPTURE_WORKER_COVERAGE');
 const requiredTicks=steps.reduce((n,a)=>n+(integer(prefix.get(a))&&integer(a.tick)&&a.tick>=prefix.get(a)?a.tick-prefix.get(a):30001),0);if(requiredTicks>30000)fail('CAPTURE_WORKER_COVERAGE');else for(const a of steps)for(let tick=prefix.get(a)+1;tick<=a.tick;tick++)if(!ticks.has(tick))fail('CAPTURE_WORKER_COVERAGE');
 if(!Array.isArray(record?.errors)||record.errors.length)fail('CAPTURE_OBSERVER_ERRORS');
 const p95=a=>a.length?[...a].sort((a,b)=>a-b)[Math.ceil(a.length*.95)-1]:null;
 const boundaryAvailable=steps.length&&finite(p?.clickEpochMs)&&steps.every(a=>finite(a.observedAtEpochMs));
 const metrics={renderIntervalP95Ms:p95(intervals),workerP95Ms:p95(worker.map(s=>s.elapsedMs)),lastStepReceiptMs:boundaryAvailable?Math.max(0,...steps.map(a=>a.observedAtEpochMs-p.clickEpochMs)):null,pauseAckUiMs:finite(p?.uiObservedAtEpochMs)&&finite(p?.clickEpochMs)?p.uiObservedAtEpochMs-p.clickEpochMs:null,activeCellMs,fullCellDrawingMs,fullCellDrawingFrames};
 const valid=issues.length===0;return {valid,meetsTargets:valid&&metrics.renderIntervalP95Ms!==null&&metrics.renderIntervalP95Ms<=33&&metrics.workerP95Ms!==null&&metrics.workerP95Ms<=15&&metrics.lastStepReceiptMs!==null&&metrics.lastStepReceiptMs<=500,metrics,issues:[...new Set(issues)]};
}
