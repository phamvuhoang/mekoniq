import 'fake-indexeddb/auto';
import {expect,test,vi} from 'vitest';
import {coffeeReplay} from '../support/coffee-replay';
import type {EngineeringAssessment} from '../../src/shared/engineering';
vi.stubGlobal('localStorage',{getItem:()=>'en',setItem:()=>{}});
const {presetById}=await import('../../src/scenarios/catalog');
const {validReportShape}=await import('../../src/reports/report-shape');
const {captureEvidence,evidenceStatus}=await import('../../src/reports/evidence');
const {compareRuns}=await import('../../src/reports/compare');
const {engineeringView}=await import('../../src/reports/engineering-view');
type Report=ReturnType<typeof coffeeReplay>['report'];
const D1='1'.repeat(64),D2='2'.repeat(64),P1='a'.repeat(64),P2='b'.repeat(64);
const caps=(over:Partial<EngineeringAssessment['capabilities']>={}):EngineeringAssessment['capabilities']=>({geometry:'modeled',rigidBody:'modeled',actuator:'modeled',sensor:'unsupported',grasp:'unsupported',process:'unsupported',calibration:'unsupported',...over});
const assessment=(status:EngineeringAssessment['status'],reasons:string[]=[],c=caps()):EngineeringAssessment=>({status,reasons,capabilities:c,caseResults:[],artifactRefs:{sampleCount:0,firstSimTimeNs:null,lastSimTimeNs:null,samplesSha256:'0'.repeat(64),artifacts:[]}});
function engineered(a:EngineeringAssessment,bundle=D1,project=P1):Report{
 const {report}=coffeeReplay(),r=structuredClone(report) as Report&{engineeringEvidence?:EngineeringAssessment};
 (r.manifest as Report['manifest']&{engineering?:unknown}).engineering={bundleDigest:bundle,projectDigest:project};r.engineeringEvidence=a;return r;
}
test('engineering report fields are validated and legacy reports still decode',()=>{
 expect(validReportShape(coffeeReplay().report)).toBe(true);
 expect(validReportShape(engineered(assessment('pass')))).toBe(true);
 const bad=engineered(assessment('pass'));(bad as unknown as {engineeringEvidence:{status:string}}).engineeringEvidence.status='green';
 expect(validReportShape(bad)).toBe(false);
 const noDigest=engineered(assessment('pass'));delete (noDigest.manifest as unknown as {engineering:{bundleDigest?:string}}).engineering.bundleDigest;
 expect(validReportShape(noDigest)).toBe(false);
});
test('saved engineering evidence goes stale for the assembly scope only when the project digest changes',()=>{
 const project=structuredClone(presetById('coffee')!.project),report=engineered(assessment('pass')),saved=captureEvidence(report,project);
 expect(saved.engineering).toEqual({bundleDigest:D1,projectDigest:P1});
 expect(evidenceStatus(saved,project,null,{engineeringProjectDigest:P1})).toMatchObject({stale:false,scopes:[]});
 expect(evidenceStatus(saved,project,null,{engineeringProjectDigest:P2})).toMatchObject({stale:true,scopes:['assembly']});
 expect(evidenceStatus(saved,project)).toMatchObject({stale:true,scopes:['assembly']}); // unknown current design is not evidence it still applies
 const legacy=captureEvidence(coffeeReplay().report,project);expect(legacy.engineering).toBeUndefined();
 expect(evidenceStatus(legacy,project,null,{engineeringProjectDigest:P2})).toMatchObject({stale:false,scopes:[]});
});
test('compare refuses to rank engineering against legacy or different capability vectors',()=>{
 const a=engineered(assessment('pass')),legacy=coffeeReplay().report;
 expect(compareRuns(a,legacy).reasons).toContain('ENGINEERING_DIFFERS');
 expect(compareRuns(a,legacy).comparable).toBe(false);
 const b=engineered(assessment('pass',[],caps({actuator:'verified'})));
 const c=compareRuns(a,b);expect(c.reasons).toContain('CAPABILITY_DIFFERS');expect(c.kpis.every(k=>k.delta===null)).toBe(true);
 const same=compareRuns(a,engineered(assessment('pass'),D2,P2));expect(same.reasons).not.toContain('CAPABILITY_DIFFERS');expect(same.inputs.map(i=>i.field)).toContain('engineering.bundleDigest');
});
test('engineering view shows blockers instead of green numbers when nothing ran or the run failed',()=>{
 expect(engineeringView(coffeeReplay().report)).toBeNull();
 const notRun=engineeringView(engineered(assessment('not_run',['PHYSICS_BACKEND_UNAVAILABLE'])))!;
 expect(notRun).toMatchObject({status:'not_run',tone:'blocked',blockers:['PHYSICS_BACKEND_UNAVAILABLE'],showMetrics:false});
 const failed=engineeringView(engineered(assessment('fail',['EVIDENCE_GAP'])))!;
 expect(failed).toMatchObject({status:'fail',tone:'fail',showMetrics:false});
 const ok=engineeringView(engineered(assessment('pass'),D1,P1))!;
 expect(ok).toMatchObject({status:'pass',tone:'ok',showMetrics:true,blockers:[]});
 expect(ok.capabilities.find(c=>c.id==='actuator')).toEqual({id:'actuator',level:'modeled'});
 expect(ok.capabilities.find(c=>c.id==='sensor')).toEqual({id:'sensor',level:'unsupported'});
});
test('report panel lists blockers and capability levels for an engineering run, and nothing for a legacy one',async()=>{
 const {reportPanel}=await import('../../src/ui/report-panel');
 const o={replay:null,previous:null,selected:null,business:0};
 expect(reportPanel(coffeeReplay().report,o)).not.toContain('engineering-evidence');
 const html=reportPanel(engineered(assessment('not_run',['PHYSICS_BACKEND_UNAVAILABLE'])),o);
 expect(html).toContain('data-testid="engineering-evidence"');expect(html).toContain('PHYSICS_BACKEND_UNAVAILABLE');expect(html).toContain('data-tone="blocked"');
 expect(html).toContain('data-capability="actuator" data-level="modeled"');expect(html).toContain('data-capability="sensor" data-level="unsupported"');
 const hostile=reportPanel(engineered(assessment('fail',['<img src=x onerror=alert(1)>'])),o);expect(hostile).not.toContain('<img src=x');
});
test('an unknown capability or a hostile capability value is neither accepted at import nor rendered as markup',async()=>{
  const {reportPanel}=await import('../../src/ui/report-panel');
  const hostile=engineered(assessment('pass'));
  (hostile.engineeringEvidence!.capabilities as unknown as Record<string,string>).extra='x" onmouseover="alert(1)';
  expect(validReportShape(hostile)).toBe(false);                       // closed set of capabilities at the import boundary
  const levelInjection=engineered(assessment('pass'));
  (levelInjection.engineeringEvidence!.capabilities as unknown as Record<string,string>).actuator='modeled" onmouseover="alert(1)';
  expect(validReportShape(levelInjection)).toBe(false);                 // and a closed set of levels
  // defence in depth: even a report that skipped validation cannot put a value into an attribute
  const html=reportPanel(levelInjection,{replay:null,previous:null,selected:null,business:0});
  expect(html).not.toContain('onmouseover');
  expect(html).toContain('data-capability="actuator" data-level="unsupported"');
  const extra=reportPanel(hostile,{replay:null,previous:null,selected:null,business:0});
  expect(extra).not.toContain('onmouseover');
  const badStatus=engineered(assessment('pass'));(badStatus.engineeringEvidence as unknown as {status:string}).status='pass" onclick="x';
  expect(reportPanel(badStatus,{replay:null,previous:null,selected:null,business:0})).not.toContain('onclick');
});
test('compare judges capability by name and value, and never ranks runs whose engineering evidence did not pass',()=>{
  const a=engineered(assessment('pass')),reordered=engineered(assessment('pass'));
  reordered.engineeringEvidence!.capabilities=Object.fromEntries(Object.entries(reordered.engineeringEvidence!.capabilities).reverse()) as never;
  expect(compareRuns(a,reordered).reasons).not.toContain('CAPABILITY_DIFFERS');       // key order is not a difference
  expect(compareRuns(a,reordered).comparable).toBe(true);
  const empty1=engineered(assessment('not_run',['PHYSICS_BACKEND_UNAVAILABLE'])),empty2=engineered(assessment('not_run',['PHYSICS_BACKEND_UNAVAILABLE']));
  const c=compareRuns(empty1,empty2);
  expect(c.comparable).toBe(false);expect(c.reasons).toContain('ENGINEERING_EVIDENCE_NOT_PASSED');
  expect(c.kpis.every(k=>k.delta===null&&k.a===null&&k.b===null&&!k.available)).toBe(true);   // no green zeroes from a run that never ran
  const failed=engineered(assessment('fail',['EVIDENCE_GAP']));
  expect(compareRuns(a,failed).reasons).toContain('ENGINEERING_EVIDENCE_NOT_PASSED');
  expect(compareRuns(a,failed).kpis.every(k=>k.delta===null)).toBe(true);
});
test('engineering identity without an assessment blocks ranking and hides that side’s KPI values',()=>{
  const missing=engineered(assessment('pass'));delete missing.engineeringEvidence;
  for(const [a,b] of [[missing,missing],[missing,engineered(assessment('pass'))],[engineered(assessment('pass')),missing]]){
    const c=compareRuns(a!,b!);
    expect(c.comparable).toBe(false);
    expect(c.reasons).toContain('ENGINEERING_EVIDENCE_NOT_PASSED');
    for(const k of c.kpis){
      expect(k).toMatchObject({available:false,delta:null});
      expect(k.reasons).toContain('ENGINEERING_EVIDENCE_NOT_PASSED');
      if(a===missing)expect(k.a).toBeNull();
      if(b===missing)expect(k.b).toBeNull();
    }
  }
  const legacy=compareRuns(coffeeReplay().report,coffeeReplay().report);
  expect(legacy).toMatchObject({comparable:true,reasons:[]});
  expect(legacy.kpis.find(k=>k.id==='served')).toMatchObject({available:true,a:1,b:1,delta:0});
});
