import 'fake-indexeddb/auto';
import {afterEach,expect,test,vi} from 'vitest';
import type {CreateRun,RunView,TwinRuntime} from '../../src/scenarios/controls';
import type {TwinFrame} from '../../src/twin/scene';
import {coffeeReplay} from '../support/coffee-replay';
import {EvidenceStore} from '../../src/reports/evidence';
vi.stubGlobal('localStorage',{getItem:()=>'en',setItem:()=>{}});
vi.stubGlobal('innerWidth',600);
vi.stubGlobal('document',{getElementById:()=>null,activeElement:null});
const {TwinWorkspace}=await import('../../src/ui/workspace');
const {presetById}=await import('../../src/scenarios/catalog');
const {nextAction}=await import('../../src/ui/operations-panel');
const stores:EvidenceStore[]=[],workspaces:InstanceType<typeof TwinWorkspace>[]=[];
afterEach(async()=>{for(const w of workspaces.splice(0))w.leave();for(const s of stores.splice(0))await s.close();vi.restoreAllMocks();});
type Harness={view:RunView|null;frame():TwinFrame;busy:boolean;saveEvidence():Promise<void>};
function setup(locked=true){
 const project=structuredClone(presetById('coffee')!.project);project.world.width=7;project.entities.find(e=>e.kind==='amr')!.speedLimitMps=0.2;
 const input:CreateRun={project,scenarioId:'BV01',scenarioRevision:1,seed:99,mode:'mock',access:'simulated',backendSetId:'mock-default'},base=coffeeReplay();
 base.view.run.seed=99;base.report.manifest.seed=99;
 const reclaimed={...base.view,controlAccess:'view_reconcile' as const,...locked?{lockedInput:input}:{}};
 const created:CreateRun[]=[],actions:{kind:string;payload:Record<string,unknown>}[]=[];
 const rt:TwinRuntime={paired:true,health:async()=>({} as never),pair:async()=>{},forget(){},get:async()=>reclaimed,report:async()=>base.report,reclaim:async()=>reclaimed,archive:async()=>{},
  create:async request=>{created.push(structuredClone(request));return {...base.view,run:{...base.view.run,id:'reset-run',status:'ready'},tick:0,simTimeNs:'0'};},
  action:async(_view,kind,payload={})=>{actions.push({kind,payload});return reclaimed;}};
 const w=new TwinWorkspace(()=>{},rt),h=w as unknown as Harness,store=new EvidenceStore(`reclaim-${crypto.randomUUID()}`);stores.push(store);workspaces.push(w);
 Object.assign(h,{health:{sourceCommit:'d'.repeat(40),schemaHash:'s',protocolMajors:[2],backends:[],backendSets:[],scenarioIds:[]},openStreams:()=>{},evidenceStore:store});
 return {w,h,store,created,actions,input,reclaimed};
}
test('reclaim preserves edited locked project and seed in the scene, immutable evidence and reset request',async()=>{
 const {w,h,store,created,input}=setup();w.click('twin-reclaim','run');await vi.waitFor(()=>expect(h.busy).toBe(false));
 expect(h.frame().preset.project).toEqual(input.project);expect(h.frame().preset.seed).toBe(99);
 await h.saveEvidence();const saved=await store.list();expect(saved).toHaveLength(1);expect(saved[0]!.project).toEqual(input.project);expect(saved[0]!.report.manifest.seed).toBe(99);
 w.click('twin-reset');await vi.waitFor(()=>expect(created).toHaveLength(1));expect(created[0]).toEqual(input);expect(h.view).toMatchObject({tick:0,run:{id:'reset-run'}});
});
test('reclaim without locked inputs blocks scene admission, evidence saving and reset instead of using preset defaults',async()=>{
 const {w,h,store,created}=setup(false);w.click('twin-reclaim','run');await vi.waitFor(()=>expect(h.busy).toBe(false));
 expect(h.view).toBeNull();expect(w.html()).toContain('RECLAIM_INPUTS_MISSING');await h.saveEvidence();expect(await store.list()).toEqual([]);
 w.click('twin-reset');await new Promise(resolve=>setTimeout(resolve,0));expect(created).toEqual([]);
});
test('a reclaimed mission attention resolves its actual robotId for explicit reconciliation',async()=>{
 const {w,h,actions,reclaimed}=setup();reclaimed.run.status='needs_attention';reclaimed.attention=[{reason:'STOP_REQUESTED',tick:125,robotId:'amr-1',subjectId:'mission-123'},{reason:'RECLAIM_RECONCILIATION_REQUIRED',tick:125}];
 w.click('twin-reclaim','run');await vi.waitFor(()=>expect(h.busy).toBe(false));
 const state={paired:true,ready:true,busy:false,playing:false,view:h.view,preset:presetById('coffee')!};expect(nextAction(state).action?.id).toBe('twin-reconcile');
 w.click('twin-reconcile');expect(w.html()).toContain('Reconcile amr-1');expect(actions).toEqual([]);
 w.click('twin-confirm-ok');await vi.waitFor(()=>expect(actions).toEqual([{kind:'reconcile',payload:{subjectId:'amr-1'}}]));
});
test('unresolvable attention never offers a fabricated reconciliation subject',()=>{
 const {reclaimed}=setup();reclaimed.run.status='needs_attention';reclaimed.attention=[{reason:'STOP_REQUESTED',tick:125,robotId:'missing-robot',subjectId:'missing-mission'}];
 expect(nextAction({paired:true,ready:true,busy:false,playing:false,view:reclaimed,preset:presetById('coffee')!}).action?.id).not.toBe('twin-reconcile');
});
test('reclaimed waiting-stop attention offers its known robot without requiring a stop-request event',async()=>{
 const {w,h,actions,reclaimed}=setup();reclaimed.run.status='needs_attention';reclaimed.tick=691;
 reclaimed.awaiting=[{subjectId:'load-1',confirmationType:'load',robotId:'amr-1',missionId:'mission-1'}];
 reclaimed.attention=[{reason:'RECLAIM_RECONCILIATION_REQUIRED',tick:691,robotId:'amr-1',subjectId:'mission-1'}];
 w.click('twin-reclaim','run');await vi.waitFor(()=>expect(h.busy).toBe(false));
 expect(nextAction({paired:true,ready:true,busy:false,playing:false,view:h.view,preset:presetById('coffee')!}).action?.id).toBe('twin-reconcile');
 w.click('twin-reconcile');expect(w.html()).toContain('Reconcile amr-1');expect(actions).toEqual([]);
 w.click('twin-confirm-ok');await vi.waitFor(()=>expect(actions).toEqual([{kind:'reconcile',payload:{subjectId:'amr-1'}}]));
});
test('multiple known reconciliation targets require an explicit selection and never default to the first robot',async()=>{
 const {w,h,actions,reclaimed}=setup();reclaimed.run.status='needs_attention';
 reclaimed.entities.push({...structuredClone(reclaimed.entities[0]!),id:'amr-2'});
 reclaimed.attention=[{reason:'RECLAIM_RECONCILIATION_REQUIRED',tick:691,robotId:'amr-1',subjectId:'mission-1'},{reason:'STOP_REQUESTED',tick:691,robotId:'amr-1',subjectId:'mission-1'},{reason:'RECLAIM_RECONCILIATION_REQUIRED',tick:691,robotId:'amr-2',subjectId:'mission-2'}];
 w.click('twin-reclaim','run');await vi.waitFor(()=>expect(h.busy).toBe(false));w.click('twin-reconcile');
 expect(w.html()).toContain('id="twin-reconcile-target"');expect(w.html()).toContain('value="amr-2"');
 expect(w.html().match(/<select id="twin-reconcile-target"[^]*?<\/select>/)?.[0].match(/<option value="amr-1"/g)).toHaveLength(1);
 w.click('twin-confirm-ok');expect(actions).toEqual([]);
 w.change('twin-reconcile-target','unknown-robot');w.click('twin-confirm-ok');expect(actions).toEqual([]);
 w.change('twin-reconcile-target','amr-2');expect(w.html()).toContain('Reconcile amr-2');expect(actions).toEqual([]);
 w.click('twin-confirm-ok');await vi.waitFor(()=>expect(actions).toEqual([{kind:'reconcile',payload:{subjectId:'amr-2'}}]));
});

test('reconciliation subject prefers the actual coffee job and otherwise requires an explicit mission or command mapping',async()=>{
 const {reconciliationSubject}=await import('../../src/twin/coffee-cell'),{reclaimed}=setup();
 reclaimed.coffee!.jobs[0]!.status='needs_attention';
 expect(reconciliationSubject({reason:'CUP_REMOVED',tick:125,subjectId:'coffee-job-1',robotId:'amr-1'},reclaimed)).toBe('coffee-job-1');
 reclaimed.awaiting=[{subjectId:'stop-1',missionId:'mission-1',robotId:'amr-1',confirmationType:'load'}];
 expect(reconciliationSubject({reason:'STOP_REQUESTED',tick:125,subjectId:'mission-1'},reclaimed)).toBe('amr-1');
 expect(reconciliationSubject({reason:'STOP_REQUESTED',tick:125,subjectId:'mission-1'},{...reclaimed,controlAccess:'view'})).toBeNull();// terminal world: the runtime refuses reconcile
 reclaimed.entities[0]!.goal={commandId:'command-1',state:'unknown'};
 expect(reconciliationSubject({reason:'OUTCOME_UNKNOWN',tick:125,commandId:'command-1'},reclaimed)).toBe('amr-1');
 expect(reconciliationSubject({reason:'RECLAIM_RECONCILIATION_REQUIRED',tick:125},reclaimed)).toBeNull();
});
