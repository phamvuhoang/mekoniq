import {expect,test,vi} from 'vitest';
vi.stubGlobal('localStorage',{getItem:()=> 'en',setItem:()=>{}});
const {semanticStudyHtml,comparisonTabs,parseSemanticStudy}=await import('../../src/reports/compare');
const hash='a'.repeat(64),ref={id:'common',sha256:hash},artifact={path:'report.json',sha256:hash,bytes:10};
const study={schemaVersion:1,documentType:'semantic-study',accepted:false,status:'complete',reasonCodes:[],equivalence:{model:ref,world:ref,task:ref,commonProjection:ref},invariantPolicy:{id:'fd01-source-causal-v1',revision:1},runs:[{runId:'run-1',engine:'irsim_2d',reportRef:artifact,artifactRefs:[],sceneDigest:hash,modelDigest:hash,firstTick:0,lastTick:12,replay:{runId:'run-1',tick:12}}],invariants:[{runId:'run-1',id:'arrival-confirmation-served',status:'pass',reasonCodes:[],tick:null}],differences:[{runId:'run-1',dimension:'clearance',value:null,unit:'m',status:'unavailable',reason:'NO_RAW'}],unsupportedDimensions:[{engine:'irsim_2d',dimension:'contact',status:'unsupported',reason:'PLANAR_KINEMATICS_NO_CONTACT_DYNAMICS'}],percentiles:null,limitations:['not_calibrated']};
test('separate semantic-study tab shows scope, unsupported, unavailable and replay run/tick offline',()=>{
 const parsed=parseSemanticStudy(JSON.stringify(study)),html=semanticStudyHtml(parsed),tabs=comparisonTabs('study','run view',html);
 expect(html).toContain('unsupported');expect(html).toContain('Unavailable');expect(html).toContain('not_calibrated');expect(html).toContain('data-action="twin-study-replay"');expect(html).toContain('data-run-id="run-1"');expect(html).toContain('data-tick="12"');expect(html).toContain('imported_integrity_only');expect(html).not.toContain('engine is more accurate');expect(tabs).toContain('role="tablist"');expect(tabs).toContain('aria-selected="true"');expect(tabs).toContain('twin-import-study');
});
test('a malformed or ranking-bearing imported report is rejected; runtime strings remain escaped',()=>{
 expect(()=>parseSemanticStudy(JSON.stringify({...study,winner:'MuJoCo'}))).toThrow('SEMANTIC_STUDY_INVALID');expect(()=>parseSemanticStudy('{}')).toThrow('SEMANTIC_STUDY_INVALID');
 const copy=structuredClone(study);copy.runs[0]!.runId='<img src=x onerror=alert(1)>';const html=semanticStudyHtml(parseSemanticStudy(JSON.stringify(copy)));expect(html).not.toMatch(/<img|<script/);expect(html).toContain('&lt;img');
});
