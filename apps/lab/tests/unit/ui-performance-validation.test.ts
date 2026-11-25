import {expect,test} from 'vitest';
// @ts-expect-error JavaScript measurement CLI boundary
import {validateUiCapture} from '../../scripts/ui-performance-validation.mjs';
const profile={id:'desktop-3d',view:'3d',limitMs:33};
const valid=()=>({elapsedMs:60010,frameIntervals:{samples:3599,p95Ms:16.7},workspacePaint:{samples:600,p95Ms:3},renderedPaints:600,pageErrors:[],renderedView:'3d',entities:2,armCount:1,tableCount:6});
test('renderer evidence accepts a complete finite capture with actual paints and the declared workload',()=>{
 expect(validateUiCapture(valid(),profile,60000)).toMatchObject({valid:true,meetsTarget:true,errors:[]});
});
test.each(['empty','null','zero','nan','infinite','too_few','no_actual_render','page_error','short','wrong_workload'] as const)('renderer evidence rejects %s capture even when a comparison could coerce it to pass',reason=>{
 const capture=valid();
 if(reason==='empty')capture.workspacePaint={samples:0,p95Ms:null as unknown as number};
 if(reason==='null')capture.workspacePaint.p95Ms=null as unknown as number;
 if(reason==='zero')capture.frameIntervals.p95Ms=0;
 if(reason==='nan')capture.workspacePaint.p95Ms=NaN;
 if(reason==='infinite')capture.frameIntervals.p95Ms=Infinity;
 if(reason==='too_few')capture.workspacePaint.samples=capture.renderedPaints=50;
 if(reason==='no_actual_render')capture.renderedPaints=0;
 if(reason==='page_error')capture.pageErrors=['render failed'] as never[];
 if(reason==='short')capture.elapsedMs=59000;
 if(reason==='wrong_workload')capture.entities=1;
 expect(validateUiCapture(capture,profile,60000)).toMatchObject({valid:false,meetsTarget:false});
});
test('renderer evidence rejects a short requested duration and distinguishes slow valid measurements',()=>{
 expect(validateUiCapture(valid(),profile,1000).valid).toBe(false);
 const slow=valid();slow.workspacePaint.p95Ms=34;
 expect(validateUiCapture(slow,profile,60000)).toMatchObject({valid:true,meetsTarget:false});
});
