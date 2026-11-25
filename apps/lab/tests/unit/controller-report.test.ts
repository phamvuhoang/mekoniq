import {expect,test,vi} from 'vitest';
vi.mock('../../src/i18n',()=>({tr:(vi:string)=>vi}));
import {arm03Status} from '../../src/twin/arm/arm-view';
import {controllerReportFixture} from '../support/controller-report';
test('native checker verdict respects explicit run tick mapping and never leaks future collision',()=>{
 const report=controllerReportFixture(20);expect(arm03Status(report,10).result).toBe('not_run');expect(arm03Status(report,20).result).toBe('fail');
 expect(arm03Status(controllerReportFixture(null),20).result).toBe('not_run');
 delete report.verification!.armTickMap;expect(arm03Status(report,20).result).toBe('not_run');
});
test('controller samples with no sim clock replay only through their explicit identity mapping',async()=>{
 const {openReplayV2}=await import('../../src/reports/replay');const {sample}=await import('../support/coffee-replay');const report=controllerReportFixture(20);
 report.telemetry!.samples=[0,20].map((tick,i)=>({...sample(tick,i+1),entityId:'arm-1',bootId:'controller',origin:'controller_sim' as const,simTimeNs:null,observed:{jointsRad:[i,0,0,0,0,0]},causationId:'pick-command'}));
 const replay=openReplayV2(report);expect(replay.seek(10).entities['arm-1']!.seq).toBe('1');expect(replay.seek(20).entities['arm-1']!.seq).toBe('2');expect(replay.trace('pick-command')).toHaveLength(2);
 delete report.verification!.armTickMap;expect(openReplayV2(report).seek(20).entities['arm-1']).toBeUndefined();
});
test('bounded bundle import verifies hashes and marks evidence imported without a runtime dependency',async()=>{
 const {importControllerBundle}=await import('../../src/reports/verification');const {validateProjectV2}=await import('../../src/project/schema');const {hashJson}=await import('../../src/twin/hash');const fixture=await import('../../fixtures/twins/coffee-cell-v2.json');
 const project=validateProjectV2(fixture.default.project),report=controllerReportFixture(20);report.manifest.project={id:project.id,revision:project.revision,hash:hashJson(project)};report.manifest.world={id:project.world.id,revision:project.world.revision,hash:hashJson(project.world)};report.verification!.arm!.worldRevision={...report.manifest.world};
 const bytes='raw trace',hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(bytes))),b=>b.toString(16).padStart(2,'0')).join('');report.verification!.artifacts=[{path:'trace.json',bytes:bytes.length,sha256:hash}];
 const files=[new File([JSON.stringify(report)],'report.json'),new File([JSON.stringify(project)],'project.json'),new File([bytes],'trace.json')];
 const result=await importControllerBundle(files);expect(result.origin).toBe('imported');expect(result.project.id).toBe(project.id);expect(result.report.verification!.arm!.result).toBe('fail');
 await expect(importControllerBundle([...files.slice(0,2),new File(['bad trace'],'trace.json')])).rejects.toThrow('ARTIFACT');
 await expect(importControllerBundle([...files,new File(['escape'],'../escape')])).rejects.toThrow('ARTIFACT_PATH');
 await expect(importControllerBundle([new File(['x'.repeat(1024)],'report.json'),...Array.from({length:10000},()=>new File([],'x'))])).rejects.toThrow('EVIDENCE_SIZE_LIMIT');
});
test('report panel shows checker provenance and cursor-safe verdict with escaped metadata',async()=>{
 const {reportPanel}=await import('../../src/ui/report-panel');const {openReplayV2}=await import('../../src/reports/replay');const report=controllerReportFixture(20);report.verification!.arm!.engine='<unsafe>';
 const render=(tick:number)=>reportPanel(report,{replay:{rp:openReplayV2(report),tick,playing:false},previous:null,selected:'arm-1',business:0});
 expect(render(10)).toContain('ARM03: <b>not_run</b>');expect(render(20)).toContain('ARM03: <b>fail</b>');expect(render(20)).toContain('&lt;unsafe&gt;');expect(render(20)).not.toContain('<unsafe>');
});
test('report exports keep safe relative artifact references and mapped controller ticks',async()=>{
 const {reportJson,reportHtml,reportCsv}=await import('../../src/reports/metrics');const {sample}=await import('../support/coffee-replay');const report=controllerReportFixture(20);report.verification!.artifacts=[{path:'evidence/trace.json',bytes:5,sha256:'a'.repeat(64)}];
 report.telemetry!.samples=[{...sample(20,2),entityId:'arm-1',bootId:'controller',simTimeNs:null,origin:'controller_sim',observed:{jointsRad:[0,0,0,0,0,0]}}];
 expect(reportJson(report)).toContain('evidence/trace.json');expect(reportHtml(report)).toContain('Controller verification');expect(reportCsv(report)).toContain(',20,arm-1,');
});
test('unexecuted controller evidence never publishes a subsystem pass',async()=>{
 const {validVerification}=await import('../../src/reports/verification');const r=controllerReportFixture(20),v=r.verification!;
 v.execution='not_run';v.result='not_run';v.arm!.result='pass';v.arm!.reasonCodes=[];v.arm!.colliding=[];
 expect(validVerification(v)).toBe(false);expect(arm03Status(r,20).result).toBe('not_run');
});
test('import rejects malformed enclosing metadata, events and telemetry before persistence',async()=>{
 const {importControllerBundle}=await import('../../src/reports/verification');
 for(const mutate of [(r:any)=>{r.manifest.runId=42;},(r:any)=>{r.telemetry.samples[0].seq='bad';},(r:any)=>{r.businessEvents[0]=null;},(r:any)=>{r.businessEvents[0].state.steps=42;},(r:any)=>{r.businessEvents.push({...r.businessEvents[0],kind:'fulfillment',state:{served:'NaN'}});},(r:any)=>{r.coffee.jobs[0].steps=null;}]){
  const report=controllerReportFixture(20);mutate(report);
  await expect(importControllerBundle([new File([JSON.stringify(report)],'report.json')])).rejects.toThrow('REPORT_INVALID');
 }
});
test('import shape rejects nested iterable/coercion hazards and accepts a full recorder buffer',async()=>{
 const {validReportShape}=await import('../../src/reports/report-shape');
 for(const mutate of [(r:any)=>{r.businessEvents[0].state.stops=[{id:'s',allocationIds:42}];},(r:any)=>{r.businessEvents[0].state.currentStopId={toString:0,valueOf:0};},(r:any)=>{r.effects=[{id:'x',type:'robot.execute',status:'pending',attempts:0,payload:{commandId:{toString:0}}}];},(r:any)=>{r.telemetry.samples[0].observed.cycleState={toString:0};}]){const r=controllerReportFixture(20);mutate(r);expect(validReportShape(r)).toBe(false);}
 const r=controllerReportFixture(20);r.telemetry!.samples=Array.from({length:20000},(_,i)=>({...r.telemetry!.samples[0]!,seq:String(i)}));expect(validReportShape(r)).toBe(true);
 const {stateLabel}=await import('../../src/ui/labels');expect(stateLabel('constructor')).toBe('constructor');expect(stateLabel('__proto__')).toBe('__proto__');
});
test('native clock mapping survives verified import and aligns navigation, events, faults and distinct ARM03 sample indices',async()=>{
 const {openReplayV2}=await import('../../src/reports/replay'),{reportJson,reportCsv}=await import('../../src/reports/metrics'),{importControllerBundle}=await import('../../src/reports/verification'),{validReportShape}=await import('../../src/reports/report-shape'),{validateProjectV2}=await import('../../src/project/schema'),{hashJson}=await import('../../src/twin/hash'),fixture=await import('../../fixtures/twins/coffee-cell-v2.json'),{sample}=await import('../support/coffee-replay');
 const project=validateProjectV2(fixture.default.project),report=controllerReportFixture(20),epoch=Date.parse('2026-11-06T00:00:00Z');report.manifest.clock.native={provider:'gazebo_nav2',originNs:'12000000000',businessEpochMs:epoch};report.manifest.project={id:project.id,revision:project.revision,hash:hashJson(project)};report.manifest.world={id:project.world.id,revision:project.world.revision,hash:hashJson(project.world)};report.verification!.arm!.worldRevision={...report.manifest.world};report.outcome.tick=20;
 report.businessEvents=[{sequence:'1',at:new Date(epoch).toISOString(),type:'Start',kind:'run',id:'run',state:{}},{sequence:'2',at:new Date(epoch+400).toISOString(),type:'Hold',kind:'run',id:'run',state:{}}];report.faults=[{tick:20,faultId:'cut',entityId:'arm-1'}];
 report.telemetry!.samples=[{...sample(0,10),providerId:'gazebo_nav2',simTimeNs:'12000000000',observedAt:null},{...sample(20,11),providerId:'gazebo_nav2',simTimeNs:'12400000000',observedAt:null},...report.verification!.armTickMap!.map(m=>({...sample(m.runTick,Number(m.seq)),entityId:m.entityId!,bootId:m.bootId!,providerId:'linuxcnc_sim',simTimeNs:null,observedAt:null}))];
 const imported=(await importControllerBundle([new File([reportJson(report)],'report.json'),new File([JSON.stringify(project)],'project.json')])).report;
 for(const r of [report,imported]){const replay=openReplayV2(r);expect(replay.range.toTick).toBe(20);expect(replay.seek(19).events).toHaveLength(1);expect(replay.seek(19).faults).toHaveLength(0);expect(replay.seek(19).entities['arm-1']!.seq).toBe('1');expect(replay.seek(20).entities['arm-1']!.seq).toBe('2');expect(arm03Status(r,19).result).toBe('not_run');expect(arm03Status(r,20).result).toBe('fail');expect(reportCsv(r)).toContain('telemetry,11,,20,amr-1');}
 for(const invalid of [{provider:'wall',originNs:'0',businessEpochMs:epoch},{provider:'gazebo_nav2',originNs:'-1',businessEpochMs:epoch},{provider:'gazebo_nav2',originNs:'0',businessEpochMs:'yesterday'}]){const r=structuredClone(report);r.manifest.clock.native=invalid as never;expect(validReportShape(r)).toBe(false);}
});
