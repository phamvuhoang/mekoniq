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
 const issues=checkCaptureClock(record),c=record.capture,p=record.pause,finite=x=>typeof x==='number'&&Number.isFinite(x),events=c?.renderEvents??[],intervals=events.slice(1).map((s,i)=>s.atMs-events[i].atMs),worker=(record.workerRaw??[]).map(s=>s.elapsedMs);
 if(!finite(c?.elapsedMs)||c.elapsedMs<180000||!finite(c?.activeCellMs)||c.activeCellMs<180000||Math.abs(c.elapsedMs-(record.clock?.endEpochMs-record.clock?.startEpochMs))>1)issues.push('CAPTURE_DURATION');
 if(events.length<2||intervals.some(x=>!finite(x)||x<=0)||events.at(-1)?.atMs-events[0]?.atMs<c?.elapsedMs*.9||!(c?.fullCellDrawingFrames>0))issues.push('CAPTURE_RENDER_STREAM');
 if(!worker.length||worker.some(x=>!finite(x)||x<0))issues.push('CAPTURE_WORKER_STREAM');
 if(!finite(p?.clickEpochMs)||!finite(p?.uiObservedAtEpochMs)||p.uiObservedAtEpochMs<p.clickEpochMs)issues.push('CAPTURE_PAUSE_CLOCK');
 if(!Array.isArray(record.errors)||record.errors.length)issues.push('CAPTURE_OBSERVER_ERRORS');
 const p95=a=>[...a].sort((a,b)=>a-b)[Math.ceil(a.length*.95)-1]??Infinity;
 const lastStepReceiptMs=Math.max(0,...(record.actions??[]).filter(a=>a.kind==='step').map(a=>a.observedAtEpochMs-p?.clickEpochMs));
 const metrics={renderIntervalP95Ms:p95(intervals),workerP95Ms:p95(worker),lastStepReceiptMs,pauseAckUiMs:p?.uiObservedAtEpochMs-p?.clickEpochMs};
 return {valid:!issues.length,meetsTargets:!issues.length&&metrics.renderIntervalP95Ms<=33&&metrics.workerP95Ms<=15&&metrics.lastStepReceiptMs<=500,metrics,issues};
}
