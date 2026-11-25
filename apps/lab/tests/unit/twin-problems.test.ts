// U02: one problems list (blockers, then attention, then notices), the next-step strip, the scenario picker order and the simulation label.
import {expect,test,vi} from 'vitest';
vi.mock('../../src/i18n',()=>({tr:(vi:string)=>vi}));
import type {RunView,TwinHealth} from '../../src/scenarios/controls';
import {backendReasons,preflight} from '../../src/scenarios/preflight';
import {IRSIM_SET,presets,presetById} from '../../src/scenarios/catalog';
import {collectProblems,nextStrip,problemsPanel,type Problem} from '../../src/ui/problems';
import {caveatPopover,pickerItems,scenarioPicker,simLabel} from '../../src/ui/run-bar';
import {coffeeReplay} from '../support/coffee-replay';
const coffee=presetById('coffee')!;
const live=(id:string,modes=['mock'])=>({id,modes,installed:true,compatible:true,reachable:true,commissioned:true,enabled:true});
/** A runtime with only mock backends (what the mock launcher offers). */
const mockHealth:TwinHealth={protocolMajors:[2],sourceCommit:'a'.repeat(40),schemaHash:'b'.repeat(64),scenarioIds:['BV01','FD01','FD02-cups','CAMPAIGN-FD02-FD07-BV01-BV03'],
 backends:[live('mock_amr'),live('mock_coffee'),live('mock_arm')],backendSets:[{id:'mock-default',mode:'mock',access:'simulated',backends:['mock_amr','mock_coffee','mock_arm']},{id:'mock-amr',mode:'mock',access:'simulated',backends:['mock_amr']}]};
const base={paired:true,health:mockHealth,healthChecked:true,checks:[],view:null,linkState:'closed' as const};
test('not paired: one blocker whose action opens the runtime box; the pairing-dependent preflight items are not repeated',()=>{
 const p=collectProblems({...base,paired:false,checks:preflight(coffee,mockHealth,false)});
 expect(p).toHaveLength(1);expect(p[0]).toMatchObject({severity:'blocker',action:{id:'twin-runtime-toggle'}});expect(p[0]!.codes.length).toBeGreaterThan(0);
});
test('not paired with a finished run on screen (saved report, replay): no pairing problem',()=>{
 const {view}=coffeeReplay() as {view:RunView};
 expect(collectProblems({...base,paired:false,view})).toEqual([]);
 expect(collectProblems({...base,paired:false,view:{...view,run:{...view.run,status:'ready'}}}).map(x=>x.codes)).toEqual([['NOT_PAIRED']]);
});
test('two failing preflight items: two blockers carrying their reason codes',()=>{
 const checks=preflight({...coffee,backendSetId:'nowhere',project:{...coffee.project,entities:coffee.project.entities.filter(e=>e.kind!=='arm')}},mockHealth,true).filter(c=>c.id!=='paired');
 expect(checks.filter(c=>!c.ok).map(c=>c.id)).toEqual(['backend','entity-arm']);
 const p=collectProblems({...base,checks});
 expect(p.map(x=>x.severity)).toEqual(['blocker','blocker']);
 expect(p[0]!.codes).toEqual(['BACKEND_SET_UNKNOWN:nowhere']);expect(p[1]!.codes).toEqual(['ENTITY_MISSING:arm']);
});
test('a needs_attention run with two attention items: two attention rows, the reconcilable one offers reconcile and names its object',()=>{
 const {view}=coffeeReplay() as {view:RunView};view.run.status='needs_attention';
 view.coffee!.jobs[0]!.status='needs_attention';
 view.attention=[{reason:'MEASUREMENT_MISSING',subjectId:'nobody',tick:10},{reason:'CUP_REMOVED',subjectId:view.coffee!.jobs[0]!.jobId,tick:250}];
 const p=collectProblems({...base,view,linkState:'runtime_lost',preset:coffee});
 expect(p.map(x=>x.severity)).toEqual(['blocker','attention','attention']);
 expect(p[0]!.codes).toEqual(['LINK_RUNTIME_LOST']);
 expect(p[1]!.codes).toEqual(['MEASUREMENT_MISSING']);expect(p[1]!.action).toBeUndefined();
 expect(p[2]).toMatchObject({codes:['CUP_REMOVED'],entityId:view.coffee!.jobs[0]!.jobId,entityName:view.coffee!.jobs[0]!.jobId,action:{id:'twin-reconcile'}});
 const html=problemsPanel(p,true);
 expect(html).toContain('data-testid="problems-panel"');expect(html).not.toMatch(/data-testid="problems-panel"[^>]*hidden/);
 expect(html).toContain('<code>CUP_REMOVED</code>');expect(html).toContain(`data-action="twin-select" data-value="${view.coffee!.jobs[0]!.jobId}"`);
 expect(html.indexOf('LINK_RUNTIME_LOST')).toBeLessThan(html.indexOf('CUP_REMOVED'));
});
test('dynamic text in a problem row is escaped',()=>{
 const html=problemsPanel([{id:'n',severity:'blocker',text:'<img onerror=x>',codes:['<b>'],entityId:'e',entityName:'<i>'}],true);
 expect(html).not.toContain('<img');expect(html).toContain('<code>&lt;b&gt;</code>');expect(html).not.toContain('<i>');expect(html).toContain('aria-label="Xem &lt;i&gt;"');
});
test('nothing wrong: no problems, and no strip when the next step needs no person',()=>{
 expect(collectProblems(base)).toEqual([]);
 expect(nextStrip([],{title:'Continue',detail:'…'})).toBe('');
 const strip=nextStrip([] as Problem[],{title:'Ready',detail:'d',action:{id:'twin-run',label:'Run mock'}});
 expect(strip).toContain('data-testid="next-action"');expect(strip).not.toContain('<button');
});
test('picker with a mock-only runtime: mock presets first, IR-SIM and Webots disabled with reasons after them',()=>{
 const items=pickerItems(presets,mockHealth),firstOff=items.findIndex(i=>!i.runnable);
 expect(firstOff).toBeGreaterThan(0);expect(items.slice(firstOff).every(i=>!i.runnable)).toBe(true);
 for(const i of items.filter(i=>/^(irsim|webots)-/.test(i.id))){expect(i.runnable,i.id).toBe(false);expect(i.reasons.length,i.id).toBeGreaterThan(0);}
 expect(items.filter(i=>i.runnable).map(i=>i.id)).toEqual(presets.map(p=>p.id).filter(id=>items.find(i=>i.id===id)!.runnable));// catalog order kept
 expect(pickerItems(presets,null).every(i=>i.runnable)).toBe(true);
 const html=scenarioPicker(items,'coffee',true),webots=/<button[^>]*data-value="webots-coffee"[^>]*>/.exec(html)?.[0]??'';
 expect(webots).toContain('data-action="twin-preset"');expect(webots).toMatch(/\sdisabled/);
 expect(html.indexOf('data-value="coffee"')).toBeLessThan(html.indexOf('data-value="webots-coffee"'));
});
test('the simulation label: before a run, mock, uncalibrated and calibrated simulation; the caveat box names mode, notes and limitations',()=>{
 expect(simLabel(null,false)).toBe('Mô phỏng · chưa chạy');
 expect(simLabel('mock',false)).toBe('Mô phỏng · MOCK');
 expect(simLabel('simulation',false)).toBe('Mô phỏng · chưa hiệu chuẩn');
 expect(simLabel('simulation',true)).toBe('Mô phỏng · SIMULATION');
 const c=caveatPopover('SIMULATION · simulated',['no hardware <evidence>'],true);
 expect(c).toContain('data-testid="caveat-detail"');expect(c).toContain('SIMULATION · simulated');expect(c).toContain('no hardware &lt;evidence&gt;');
 expect(c).toContain('Mô hình minh họa');expect(c).toContain('Source runtime · chỉ mô phỏng nghiệp vụ');
 expect(caveatPopover('—',[],false)).toMatch(/data-testid="caveat-detail"[^>]*hidden/);
});
test('a notice is not a problem: it stays in the viewport banner',()=>{
 expect(collectProblems({...base,notice:'Runtime v2 paired.'} as Parameters<typeof collectProblems>[0])).toEqual([]);
});
test('one card per attention problem: its chain sits inside the row; the object button shows the display name',()=>{
 const p:Problem[]=[{id:'attention-0',severity:'attention',text:'No cup.',codes:['CUP_REMOVED'],entityId:'arm-1',entityName:'Cánh tay 1'},{id:'check-x',severity:'blocker',text:'x',codes:[],entityId:'arm-1',entityName:'Cánh tay 1'}];
 const html=problemsPanel(p,true,{'attention-0':'<div class="attention-chain" data-testid="attention-reason">chain</div>'});
 const rows=html.split('data-testid="problem-row"').slice(1);
 expect(rows).toHaveLength(2);expect(rows[0]).toContain('data-testid="attention-reason"');expect(rows[1]).not.toContain('attention-reason');
 expect(rows[1]).toMatch(/<button[^>]*data-action="twin-select"[^>]*aria-label="Xem Cánh tay 1"[^>]*>[^]*Cánh tay 1<\/button>/);
});
/** Portable IR-SIM set whose one backend is neither installed nor enabled, and whose capability is missing. */
const irsimHealth:TwinHealth={...mockHealth,scenarioIds:[...mockHealth.scenarioIds,'IR-FD01','IR-FD07'],
 backends:[...mockHealth.backends,{...live('irsim_2d',['simulation']),installed:false,enabled:false,reachable:false,reason:'venv missing'}],
 backendSets:[...mockHealth.backendSets,{id:IRSIM_SET,mode:'simulation',access:'simulated',backends:['irsim_2d'],execution:{host:'portable_python',clock:'source_fixed_step',manualStep:true,speedMultipliers:[1]}}]};
test('picker and the preflight rows list the same reasons from the same health: one reason per backend',()=>{
 for(const h of [mockHealth,irsimHealth])for(const p of presets){
  const rows=preflight(p,h,true),backend=rows.find(c=>c.id==='backend')!,scenario=rows.find(c=>c.id==='scenario')!;
  const shown=[...backend.codes??[],...scenario.ok?[]:scenario.codes??[]];
  expect(pickerItems([p],h)[0]!.reasons,p.id).toEqual(shown);
  expect(backendReasons(p,h),p.id).toEqual(shown);
 }
 const irsim=pickerItems([presetById('irsim-fd01')!],irsimHealth)[0]!;
 expect(irsim.runnable).toBe(false);
 expect(irsim.reasons.filter(r=>/^BACKEND_[A-Z_]+:irsim_2d/.test(r))).toEqual(['BACKEND_NOT_INSTALLED:irsim_2d (venv missing)']);
 expect(irsim.reasons).toContain('CAPABILITY_MISSING:irsim_navigation_v1');
});
test('the preflight gate is the one of fa6fa35: a portable backend that is enabled but unreachable (capability missing) still passes the backend row',()=>{
 // fa6fa35: ok = set exists && set.mode === preset mode && every required backend enabled; reachability and capabilities were not part of the gate
 const h:TwinHealth={...irsimHealth,backends:irsimHealth.backends.map(b=>b.id==='irsim_2d'?{...b,installed:true,enabled:true,reachable:false}:b)};
 const row=preflight(presetById('irsim-fd01')!,h,true).find(c=>c.id==='backend')!;
 expect(row.ok).toBe(true);
 expect(row.codes).toEqual(['BACKEND_UNREACHABLE:irsim_2d','CAPABILITY_MISSING:irsim_navigation_v1']);
 expect(pickerItems([presetById('irsim-fd01')!],h)[0]!.reasons).toEqual(row.codes);
 // the old gate still refuses a disabled backend
 expect(preflight(presetById('irsim-fd01')!,irsimHealth,true).find(c=>c.id==='backend')!.ok).toBe(false);
});
test('I5: a remembered session not yet reached in this page load is "not connected yet" with the Connect way on, never "cannot reach"',async()=>{
 const {collectProblems}=await import('../../src/ui/problems');
 const {preflight}=await import('../../src/scenarios/preflight');
 const {presetById}=await import('../../src/scenarios/catalog');
 const preset=presetById('coffee')!,checks=preflight(preset,null,true);
 const p=collectProblems({paired:true,health:null,healthChecked:false,checks,view:null,linkState:'closed',preset});
 expect(p.map(x=>x.codes.join())).toEqual(['NOT_CONNECTED']);expect(p[0]!.action?.id).toBe('twin-runtime-toggle');
 expect(JSON.stringify(p)).not.toMatch(/RUNTIME_UNREACHABLE|Không thấy runtime/);
 // tried and failed: that is said
 expect(collectProblems({paired:true,health:null,healthChecked:true,checks,view:null,linkState:'closed',preset}).some(x=>x.id==='check-runtime')).toBe(true);
});
test('item 8: the strip\'s codes come from the problem its step answers, never from another one',async()=>{
 const {nextStrip}=await import('../../src/ui/problems');
 const p=[{id:'runtime-pin',severity:'blocker' as const,text:'pin',codes:['RUNTIME_PIN_MISMATCH'],action:{id:'twin-runtime-toggle',label:'Open'}},{id:'attention-0',severity:'attention' as const,text:'cup',codes:['CUP_REMOVED'],action:{id:'twin-reconcile',label:'Reconcile'}}];
 const html=nextStrip(p,{title:'Reconcile needed',detail:'d',action:{id:'twin-reconcile',label:'Reconcile'}});
 expect(html).toContain('<code>CUP_REMOVED</code>');expect(html).not.toContain('RUNTIME_PIN_MISMATCH');
 expect(nextStrip(p,{title:'Run again',detail:'d',action:{id:'twin-rerun',label:'Run again'}})).not.toContain('<code>');
});
