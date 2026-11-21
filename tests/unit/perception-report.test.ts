import {beforeEach,expect,test,vi} from 'vitest';
vi.hoisted(()=>{(globalThis as Record<string,unknown>).localStorage={getItem:()=>'en',setItem:()=>{}};(globalThis as Record<string,unknown>).document={documentElement:{lang:'en'}};});
import {setLocale} from '../../src/i18n';
import {attemptCounter,ghostLegendHtml,perceptionBlockHtml,perceptionSection,parseStudy,studyHtml} from '../../src/reports/perception';
const attempt=(o:Record<string,unknown>={})=>({attemptId:'cup-1#0',cupId:'cup-1',index:0,decidedTick:1444,mode:'belief_estimated',beliefUsed:null,beliefErrorAtCommitM:0.0071,gates:{belief:'pass',region:'pass',ik:'pass',sweep:'pass'},ikResidual:[],outcome:'lifted',...o});
const rep=(attempts:unknown[],extra:Record<string,unknown>={})=>({manifest:{perception:{graspMode:'belief_estimated'}},perceptionEvidence:{schemaVersion:1,beliefs:[],attempts,recovery:[],complete:true,issues:[],...extra}});
beforeEach(()=>setLocale('en'));

test('a report without a perception stream has no section (a fixed-program run) and one that names a mode but lost the stream says why',()=>{
 expect(perceptionSection({manifest:{}})).toEqual({available:false,reason:'NO_PERCEPTION_DATA'});
 expect(perceptionBlockHtml({manifest:{}})).toBe('');
 const lost=perceptionBlockHtml({manifest:{perception:{graspMode:'belief_estimated'}}});expect(lost).toContain('data-available="false"');expect(lost).toContain('NO_PERCEPTION_DATA');
});
test('the attempts table: cup, attempt, tick, belief error in mm, the four gates, outcome',()=>{
 const html=perceptionBlockHtml(rep([attempt(),attempt({attemptId:'cup-2#0',cupId:'cup-2',decidedTick:5000,beliefErrorAtCommitM:0.03,gates:{belief:'pass',region:'BELIEF_OUT_OF_REGION',ik:'not_evaluated',sweep:'not_evaluated'},outcome:'refused',refusal:'BELIEF_OUT_OF_REGION'})]));
 expect(html).toContain('data-testid="perception-attempts"');expect(html.match(/<tr data-attempt=/g)).toHaveLength(2);
 expect(html).toContain('7.1');expect(html).toContain('BELIEF_OUT_OF_REGION');expect(html).toContain('not_evaluated');expect(html).toContain('lifted');
 expect(html).toMatch(/modelled perception error/i);expect(html).not.toMatch(/safe threshold|rank/i);
});
test('at a replay cursor only the attempts decided so far are listed',()=>{
 const r=rep([attempt(),attempt({attemptId:'cup-2#0',cupId:'cup-2',decidedTick:5000})]);
 expect(perceptionBlockHtml(r,2000).match(/<tr data-attempt=/g)).toHaveLength(1);
 expect(perceptionBlockHtml(r,100)).toContain('data-empty="true"');
});
test('an incomplete stream is said to be incomplete, with its issues',()=>{
 const html=perceptionBlockHtml(rep([attempt()],{complete:false,issues:['BELIEF_QUOTA_EXCEEDED']}));expect(html).toContain('BELIEF_QUOTA_EXCEEDED');expect(html).toContain('data-complete="false"');
});
test('all three languages are present for the block',()=>{
 for(const l of ['vi','ja','en'] as const){setLocale(l);const html=perceptionBlockHtml(rep([attempt()]));expect(html.length).toBeGreaterThan(200);if(l==='ja')expect(html).toContain('認識');if(l==='vi')expect(html).toContain('nhận thức');}
});
const point=(id:string,mode:string,runs:number,firstTry:number,low:number,high:number)=>({id,mode,runs,firstTry,afterRecovery:0,attention:runs-firstTry,firstTryInterval:{low,high},medianTicks:1700,unexpectedContacts:0,medianBeliefErrorAtCommitM:id.startsWith('sigma')?0.004:null,outcomes:{lifted:firstTry,refused:runs-firstTry}});
const study={schemaVersion:1,campaignId:'perception-gap-v1',calibration:'not_calibrated',points:[point('fixed-20mm','fixed_program',10,8,0.49,0.94),point('sigma-2mm','belief_estimated',10,9,0.6,0.98),point('sigma-5mm','belief_estimated',10,7,0.4,0.89),point('sigma-10mm','belief_estimated',10,3,0.1,0.6)]};
test('a study file is parsed with its shape checked, and a malformed one is refused with a reason',()=>{
 expect(parseStudy(JSON.stringify({study}))).toMatchObject({ok:true});expect(parseStudy(JSON.stringify(study))).toMatchObject({ok:true});
 for(const bad of ['not json','{}',JSON.stringify({...study,points:[{id:'x'}]}),JSON.stringify({...study,points:[{...study.points[0],firstTryInterval:{low:0.9,high:0.1}}]}),JSON.stringify({...study,points:[{...study.points[0],runs:0}]}),JSON.stringify({...study,schemaVersion:2})])expect(parseStudy(bad).ok,bad.slice(0,40)).toBe(false);
});
test('the study screen: a row per point, the interval plot over sigma with n, no ranking, the not-camera statement',()=>{
 const p=parseStudy(JSON.stringify(study));if(!p.ok)throw Error('x');const html=studyHtml(p.study);
 expect(html.match(/<tr data-point=/g)).toHaveLength(4);expect(html).toContain('<svg');expect(html).toContain('n=10');expect(html.match(/class="study-interval"/g)).toHaveLength(3);
 expect(html).toMatch(/modelled perception error, not camera data/i);expect(html).not.toMatch(/safe threshold|best|rank/i);expect(html).toContain('Wilson');
});
test('the legend says what is drawn, or that nothing is (never silent), in three languages',()=>{
 const data=ghostLegendHtml({status:'data',items:[{objectId:'cup-1',beliefMapM:[0,0,0],truthMapM:[0,0,0],errorMm:7.04}]});
 expect(data).toContain('data-state="data"');expect(data).toContain('cup-1 ↔ 7 mm');expect(data).toMatch(/simulation only/);
 expect(ghostLegendHtml({status:'none'})).toContain('No perception data');expect(ghostLegendHtml({status:'no_data_at_cursor'})).toContain('at this point');
 setLocale('ja');expect(ghostLegendHtml({status:'none'})).toContain('認識データなし');setLocale('vi');expect(ghostLegendHtml({status:'none'})).toContain('Không có dữ liệu nhận thức');
});
test('R10: at a replay cursor an attempt shows the record that existed then (plan, commit, outcome), never the final outcome of the run',()=>{
 const rec=(stage:string,recordedTick:number,outcome:string)=>attempt({stage,recordedTick,outcome});
 const r=rep([attempt({outcome:'lifted'})],{attemptRecords:[rec('plan',1444,'unknown'),rec('commit',1535,'unknown'),rec('outcome',1700,'lifted')]});
 const at=(t:number)=>perceptionBlockHtml(r,t),outcome=(h:string)=>/<tr data-attempt="cup-1#0"[\s\S]*?data-outcome="([a-z_]+)"/.exec(h)?.[1];
 expect(at(1000)).toContain('data-empty="true"');expect(outcome(at(1444))).toBe('unknown');expect(outcome(at(1535))).toBe('unknown');expect(outcome(at(1699))).toBe('unknown');expect(outcome(at(1700))).toBe('lifted');
 expect(outcome(perceptionBlockHtml(r))).toBe('lifted');
});
test('R10: the attempt counter counts the attempts that exist at the cursor',()=>{
 const r=rep([attempt()],{attemptRecords:[attempt({stage:'plan',recordedTick:1444}),attempt({stage:'outcome',recordedTick:1700})]});
 expect(attemptCounter(r,1000,'cup-1')).toBe('');expect(attemptCounter(r,1444,'cup-1')).toContain('1/3');
});
