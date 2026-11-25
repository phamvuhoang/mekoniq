// Pure acceptance boundary for a renderer capture.
export function validateUiCapture(capture,profile,durationMs){
 const errors=[],positive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
 const elapsed=capture?.elapsedMs,frame=capture?.frameIntervals,paint=capture?.workspacePaint;
 if(!positive(durationMs)||durationMs<60000||!positive(elapsed)||elapsed<durationMs)errors.push('CAPTURE_DURATION');
 if(!positive(profile?.limitMs)||capture?.renderedView!==profile?.view)errors.push('RENDER_PROFILE');
 if(!Array.isArray(capture?.pageErrors)||capture.pageErrors.length)errors.push('PAGE_ERRORS');
 if(!positive(frame?.p95Ms)||!positive(paint?.p95Ms))errors.push('INVALID_PERCENTILE');
 if(!Number.isInteger(frame?.samples)||frame.samples<Math.max(1000,Math.floor(elapsed/50)))errors.push('FRAME_COUNT');
 const expectedPaints=elapsed/100;
 if(!Number.isInteger(paint?.samples)||paint.samples<expectedPaints*0.9||paint.samples>expectedPaints*1.1+1)errors.push('PAINT_COUNT');
 if(!Number.isInteger(capture?.renderedPaints)||capture.renderedPaints<=0||capture.renderedPaints!==paint?.samples)errors.push('RENDER_COUNT');
 if(capture?.entities!==2||capture?.armCount!==1||capture?.tableCount!==6)errors.push('WORKLOAD');
 const valid=errors.length===0,meetsTarget=valid&&frame.p95Ms<=profile.limitMs&&paint.p95Ms<=profile.limitMs;
 return {valid,meetsTarget,errors};
}
