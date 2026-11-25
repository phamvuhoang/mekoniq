// Review5 #1: an imported report is untrusted. Every field the Lab renders or computes on is type-checked at import (fail closed with a reason), and every
// interpolated value is escaped at render time regardless (defense in depth): no payload ever becomes an element, attribute or handler.
import {expect,test,vi} from 'vitest';
vi.hoisted(()=>{(globalThis as Record<string,unknown>).localStorage={getItem:()=>'en',setItem:()=>{}};});
import {importNavigationEvidence} from '../../src/reports/navigation2d';
import {reportHtml} from '../../src/reports/metrics';
import {navigationHtml,reportPanel,reportSummary,engineeringHtml} from '../../src/ui/report-panel';
import {modelValidationPanel,validationView} from '../../src/ui/model-validation-panel';
import {serveProject} from '../../src/design/assembly';
import type {RunReport} from '../../src/scenarios/controls';
import {chunks,evidence,project,report} from '../support/navigation-report';
import type {ModelValidationReportV1} from '../../src/shared/navigation2d';

const X='<img src=x onerror=window.__xss=1>',Y='"><script>window.__xss=1</script>';
const files=(r:unknown)=>[new File([JSON.stringify(r)],'report.json'),new File([JSON.stringify(project)],'project.json'),...[...chunks.trajectory,...chunks.control,...chunks.sensors].map(c=>new File([c.bytes as BlobPart],c.path))];
/** No element, attribute or handler from a payload: the only tags are the builder's own (never img/script), and no attribute named on*. */
const inert=(html:string)=>{expect(html).not.toMatch(/<\s*(img|script|iframe|object|embed)\b/i);expect(html.replace(/"[^"]*"/g,'""')).not.toMatch(/<[^>]*\son[a-z]+\s*=/i);};// quoted values removed first: an escaped payload inside one cannot leave it
const nav=(over:Record<string,unknown>)=>({...report().metrics,navigation:{...(report().metrics as {navigation:object}).navigation,...over}});

test('import refuses a report whose rendered navigation metrics are not what they claim to be (sensor publications, episodes, reasons)',async()=>{
 const bad:[string,Record<string,unknown>][]=[
  ['recorded html',{sensorPublications:{expected:81,recorded:X,complete:true}}],['expected html',{sensorPublications:{expected:Y,recorded:81,complete:true}}],
  ['negative',{sensorPublications:{expected:-1,recorded:-1,complete:true}}],['fraction',{sensorPublications:{expected:1.5,recorded:1.5,complete:true}}],
  ['unsafe',{sensorPublications:{expected:2**60,recorded:2**60,complete:true}}],['complete text',{sensorPublications:{expected:81,recorded:81,complete:'yes'}}],
  ['collision episodes',{collisionEpisodes:X}],['safety episodes',{safetyEnvelopeEpisodes:Y}],['horizon',{horizon:X}],['reasons',{reasons:[1]}],['coverage',{coverage:X}],['clearance',{minClearanceM:X}],
 ];
 for(const [name,over] of bad)await expect(importNavigationEvidence(files(report({metrics:nav(over)}))),name).rejects.toThrow('REPORT_INVALID');
 // the untouched report still imports
 expect((await importNavigationEvidence(files(report()))).origin).toBe('imported');
});

test('every renderable string of an importable report carries a payload: the import succeeds and nothing it renders is live markup',async()=>{
 const n=evidence() as Record<string,unknown>;
 Object.assign(n,{controller:{id:'grid-diff-v1',version:X},engine:{...n.engine as object,version:Y,pythonVersion:X,platform:Y},limitations:[X],completeness:{status:'incomplete',reasons:[X,Y]},
  assertions:[{id:X,result:'pass',detail:Y},{id:Y,result:'fail',detail:X}],recording:{...n.recording as object,terminal:X,gaps:[{fromTick:1,toTick:2,reason:Y}]},recordingGaps:[{fromTick:3,toTick:4,reason:X}]});
 const r=report({navigation2d:n,limitations:[X],coverage:{[X]:false},telemetry:{lossy:true,coalesced:true,rateHz:5,source:Y,samples:[],sampleCounts:{[X]:1},dropped:0,gaps:[{reason:X,fromTick:null,toTick:1}]},
  faults:[{tick:1,faultId:X,entityId:Y}],businessEvents:[{sequence:'1',at:'2026-11-01T00:00:00.000Z',type:X,kind:Y,id:X,state:{}}]});
 Object.assign(r.manifest,{sourceCommit:X,backendSetId:Y,access:X,backends:[{id:'irsim_2d',version:X,model:Y,dynamics:false}]});
 const {report:imported}=await importNavigationEvidence(files(r));
 for(const html of [navigationHtml(imported),reportPanel(imported,{replay:null,previous:null,selected:null,business:0}),reportSummary(imported,1),engineeringHtml(imported),reportHtml(imported)])inert(html);
});

test('renderers escape every interpolated value even when a value slipped past validation (numbers included)',()=>{
 const r=report({metrics:nav({sensorPublications:{expected:Y,recorded:X,complete:true},collisionEpisodes:X,safetyEnvelopeEpisodes:Y}),
  telemetry:{lossy:true,coalesced:true,rateHz:5,source:'s',samples:[],sampleCounts:{a:X},dropped:Y,gaps:[]}}) as RunReport;
 inert(navigationHtml(r));inert(reportSummary(r,1));inert(reportPanel(r,{replay:null,previous:null,selected:null,business:0}));
 expect(navigationHtml(r)).toContain('&lt;img');
 const v=({schemaVersion:1,documentType:'model-validation-report',physicalModelDigest:'2'.repeat(64),assemblyDigest:'3'.repeat(64),execution:'ran',result:'pass',nameMapRef:null,inputUrdfRef:null,referenceUrdfRef:null,referenceSrdfRef:null,issues:[{code:X,severity:Y as never,path:X,entityId:Y,linkId:X,source:Y,detail:X}] as never,robotId:X,mode:Y as never,checks:[{id:X,source:Y,result:X as never,coverageScope:Y}] as never,
  assumptions:[{kind:X,documentId:Y} as never],limitations:[X],reportDigest:Y,engine:{package:X,packageVersion:Y,pythonVersion:X,lockDigest:'d'.repeat(64),adapterVersion:'1',policyVersion:'1'}}) as unknown as ModelValidationReportV1;
 const project_=serveProject(),state={ref:{bundleDigest:'a'.repeat(64),projectDigest:'b'.repeat(64)},robotId:X,report:v};
 inert(modelValidationPanel({v:state,view:validationView(state,{projectDigest:'b'.repeat(64),ref:state.ref},project_),robots:[X,Y],canValidate:true,busy:false,error:Y}));
});
