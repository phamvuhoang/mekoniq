// I2: an answer is applied only to the page state it was asked for. Opening saved evidence and starting replay wait for the page (busy); dropping or
// retargeting the runtime drops the answers still in flight; nothing a completion does renders a page the user has left.
import {afterEach,expect,test,vi} from 'vitest';
vi.stubGlobal('localStorage',{getItem:()=>'en',setItem:()=>{},removeItem:()=>{}});
vi.stubGlobal('innerWidth',600);
vi.stubGlobal('matchMedia',()=>({matches:false}));
vi.stubGlobal('document',{getElementById:()=>null,querySelector:()=>null,activeElement:null,addEventListener(){},removeEventListener(){}});
vi.stubGlobal('location',{origin:'http://127.0.0.1:4175',hostname:'127.0.0.1'});
import type {RunReport,RunView,TwinHealth,TwinRuntime,ReadinessSnapshot} from '../../src/scenarios/controls';
import {TwinRuntimeError} from '../../src/scenarios/controls';
import type {RuntimeTarget} from '../../src/runtime/target';
import {coffeeReplay,at} from '../support/coffee-replay';
const {TwinWorkspace}=await import('../../src/ui/workspace');
const {presetById}=await import('../../src/scenarios/catalog');
const {captureEvidence}=await import('../../src/reports/evidence');
const workspaces:InstanceType<typeof TwinWorkspace>[]=[];
afterEach(()=>{for(const w of workspaces.splice(0))w.leave();});
const deferred=<T,>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};};
const health:TwinHealth={protocolMajors:[2],sourceCommit:'d'.repeat(40),schemaHash:'a'.repeat(64),scenarioIds:['BV01'],features:{readiness:true},
 backends:['mock_amr','mock_coffee','mock_arm'].map(id=>({id,modes:['mock'],installed:true,compatible:true,reachable:true,commissioned:true,enabled:true})),backendSets:[{id:'mock-default',mode:'mock',access:'simulated',backends:['mock_amr','mock_coffee','mock_arm']}]};
type H={view:RunView|null;report:RunReport|null;archived:boolean;busy:boolean;readiness:ReadinessSnapshot|null;health:TwinHealth|null;refresh():Promise<void>;checkReadiness():Promise<void>;checkHealth():Promise<void>};
function setup(o:{deferAction?:boolean;deferCreate?:boolean;deferGet?:boolean;deferReadiness?:boolean}={}){
 const {view,report}=coffeeReplay();view.run.status='running';report.outcome={...report.outcome,status:'running',tick:view.tick};
 const saved=coffeeReplay().report;saved.manifest.runId='saved-run';
 const calls:string[]=[],pending:{resolve:(v:never)=>void;kind:string}[]=[];let paired=true;
 const later=<T,>(kind:string,v:T,defer?:boolean):Promise<T>=>{if(!defer)return Promise.resolve(structuredClone(v));const d=deferred<T>();pending.push({resolve:(x:never)=>d.resolve(x===undefined?structuredClone(v):x),kind});return d.promise;};
 const created={...structuredClone(view),run:{...view.run,id:'new-run',status:'ready' as const},tick:0};
 const rt:{target:RuntimeTarget}&Record<string,unknown>={get paired(){return paired;},target:{base:'/lab/v2',kind:'same_origin'} as RuntimeTarget,forget(){paired=false;},retarget(t:RuntimeTarget){rt.target=t;paired=false;calls.push(`retarget ${t.base}`);},
  health:async()=>{calls.push('health');return health;},pair:async()=>{calls.push('pair');paired=true;},
  readiness:(s:string)=>{calls.push(`readiness ${s}`);return later('readiness',{checkedAt:'x',expiresAt:'2099-01-01T00:00:00.000Z',scenarioId:s,backendSetId:'mock-default',checks:[],canStart:true},o.deferReadiness);},
  get:(id:string)=>{calls.push(`get ${id}`);return later('get',view,o.deferGet);},
  report:async(id:string)=>{calls.push(`report ${id}`);return {...structuredClone(report),manifest:{...report.manifest,runId:id}};},
  create:()=>{calls.push('create');return later('create',created,o.deferCreate);},
  action:(v:RunView,kind:string)=>{calls.push(`${kind} ${v.run.id}`);return later(kind,{...structuredClone(v),run:{...v.run,status:'running' as const,runRevision:v.run.runRevision+1},tick:v.tick+250},o.deferAction&&kind==='step');},
 };
 let renders=0;const w=new TwinWorkspace(()=>{renders++;},rt as unknown as TwinRuntime),h=w as unknown as H;workspaces.push(w);
 const preset=presetById('coffee')!;
 Object.assign(h,{view,report,health,healthChecked:true,runPreset:preset,preset,openStreams:()=>{},saved:[{...captureEvidence(saved,preset.project),origin:'imported'}]});
 const evidenceId=(h as unknown as {saved:{id:string}[]}).saved[0]!.id;
 return {w,h,calls,pending,evidenceId,renders:()=>renders};
}
const settle=()=>new Promise(r=>setTimeout(r,0));
test('(1) saved evidence is not opened while a step is in flight; the step lands on the live run it was asked for, and the button says it waits',async()=>{
 const {w,h,pending,evidenceId}=setup({deferAction:true});
 w.click('twin-step');expect(h.busy).toBe(true);
 expect(w.html()).toMatch(/data-action="twin-open-evidence"[^>]*disabled/);
 expect(w.html()).toMatch(/data-action="twin-replay"[^>]*disabled/);
 w.click('twin-open-evidence',evidenceId);w.click('twin-replay');
 expect(h.archived).toBe(false);expect(w.html()).not.toContain('data-testid="recorded-tag"');
 pending.find(p=>p.kind==='step')!.resolve({...h.view!,tick:500} as never);await vi.waitFor(()=>expect(h.busy).toBe(false));
 expect(h.archived).toBe(false);expect(h.view!.run.id).toBe('run');expect(h.report!.manifest.runId).toBe('run');
 // once the page is free, it opens and stays the opened report
 w.click('twin-open-evidence',evidenceId);expect(h.archived).toBe(true);expect(h.report!.manifest.runId).toBe('saved-run');expect(w.html()).toContain('data-testid="recorded-tag"');
});
test('(2) saved evidence is not opened while a create is in flight (refused while busy): the new run is adopted whole, never mixed with an opened report',async()=>{
 const {w,h,pending,evidenceId}=setup({deferCreate:true});Object.assign(h,{view:null,report:null,health:{...health,features:{}}});
 w.click('twin-run');await vi.waitFor(()=>expect(pending.some(p=>p.kind==='create')).toBe(true));
 w.click('twin-open-evidence',evidenceId);expect(h.archived).toBe(false);
 pending.find(p=>p.kind==='create')!.resolve(undefined as never);// the deferred create answers with the created run
 await vi.waitFor(()=>expect(h.busy).toBe(false));
 expect(h.archived).toBe(false);expect(h.view!.run.id).toBe('new-run');expect(h.report!.manifest.runId).toBe('new-run');
});
test('(3) Disconnect, then another address, while a GET run and a readiness check are in flight: the old run does not come back and no request names it',async()=>{
 const {w,h,calls,pending}=setup({deferGet:true,deferReadiness:true});
 void h.refresh();void h.checkReadiness();await settle();expect(pending.map(p=>p.kind).sort()).toEqual(['get','readiness']);
 w.click('twin-disconnect');expect(h.view).toBeNull();
 const mark=calls.length;
 (w as unknown as {connect(a:string,t:string):void}).connect('http://127.0.0.1:4999','code');
 for(const p of pending.splice(0))p.resolve((p.kind==='get'?{...structuredClone(coffeeReplay().view),run:{...coffeeReplay().view.run,status:'running'}}:{checkedAt:'x',expiresAt:'2099-01-01T00:00:00.000Z',scenarioId:'BV01',backendSetId:'mock-default',checks:[],canStart:true}) as never);
 // the new runtime's own readiness check answers too
 await vi.waitFor(()=>{for(const p of pending.splice(0))p.resolve(undefined as never);expect(h.busy).toBe(false);});await settle();
 expect(h.view).toBeNull();expect(h.report).toBeNull();
 expect(calls.slice(mark).filter(c=>/\brun\b/.test(c))).toEqual([]);
 expect(calls.slice(mark)).toContain('retarget http://127.0.0.1:4999/lab/v2');
});
test('(4) a completion that lands after the page was left renders nothing',async()=>{
 const {w,h,pending,renders}=setup({deferGet:true});
 void h.refresh();await settle();w.leave();const n=renders();
 pending[0]!.resolve({...h.view!,run:{...h.view!.run,runRevision:99}} as never);await settle();await settle();
 void h.checkHealth();await settle();await settle();
 expect(renders()).toBe(n);
});
test('item 2: while the run is paused, the primary action resumes it (the transport\'s Resume)',async()=>{
 const {w,h,calls}=setup();h.view!.run.status='paused';
 expect(w.html()).toMatch(/<button class="button primary" data-testid="primary-action" data-action="twin-resume">/);
 w.click('twin-resume');await vi.waitFor(()=>expect(calls).toContain('resume run'));
});
test('item 3: an action that gets no answer says so in one translated sentence naming the runtime address, never the browser\'s "Failed to fetch"',async()=>{
 const {w,h}=setup();Object.assign((h as unknown as {rt:Record<string,unknown>}).rt,{action:async()=>{throw new TypeError('Failed to fetch');}});
 w.click('twin-step');await vi.waitFor(()=>expect(h.busy).toBe(false));
 const notice=(h as unknown as {notice:string}).notice;
 expect(notice).not.toContain('Failed to fetch');expect(notice).toContain('RUNTIME_UNREACHABLE');expect(notice).toContain('http://127.0.0.1:4175/lab/v2');
});
test('item 4: a finished run whose report fetch failed: the Report tab says so and offers Reload report, which asks again',async()=>{
 const {w,h,calls}=setup();h.view!.run.status='completed';h.report=null;
 const rt=(h as unknown as {rt:Record<string,unknown>}).rt,report=rt.report as (id:string)=>Promise<RunReport>;
 expect(w.html()).toContain('data-testid="report-missing"');expect(w.html()).toContain('data-action="twin-report-reload"');
 w.click('twin-report-reload');await vi.waitFor(()=>expect(h.busy).toBe(false));
 expect(calls.filter(c=>c==='report run').length).toBeGreaterThan(0);void report;
});

test('known cell Pause ACK updates controls while its independent full-prefix report is still materializing',async()=>{
 const {w,h}=await cellBoundary('running'),internal=w as unknown as CellBoundary&{act(kind:'pause'):Promise<void>};const paused={...structuredClone(h.view!),run:{...h.view!.run,status:'paused' as const,runRevision:12}},gate=deferred<RunReport>();
 internal.rt.action=async()=>paused;internal.rt.report=()=>gate.promise;let finished=false;const pause=internal.act('pause').then(()=>{finished=true;});
 await settle();expect(h.view!.run.status).toBe('paused');expect(finished).toBe(true);expect(internal.frame().view!.run.status).toBe('running');expect(w.html()).toMatch(/data-testid="primary-action" data-action="twin-resume"(?![^>]*disabled)/);expect(transportButton(w.html(),'twin-resume')).not.toContain('disabled');gate.resolve({...h.report!,outcome:{...h.report!.outcome,status:'paused'}});await pause;
});

test('active cell uses current read-only observations; full report materializes on explicit/final request',async()=>{
 const {w,h}=setup(),internal=w as unknown as {rt:TwinRuntime;playing:boolean;ui:{inspectorOpen:boolean;tab:string};refreshReport(final?:boolean):void};h.view!.run.backendSetId='engineering-mujoco-cell-v1';internal.playing=true;internal.ui={...internal.ui,inspectorOpen:false,tab:'objects'};const report=vi.fn(async()=>h.report!);internal.rt.report=report;
 internal.refreshReport();await settle();expect(report).not.toHaveBeenCalled();internal.refreshReport(true);await settle();expect(report).toHaveBeenCalledTimes(1);
});

test('cell retains one matched Source view/world horizon through a later action; no telemetry joins that pair',async()=>{
 const {w,h}=setup(),internal=w as unknown as {world:unknown;worldView:RunView;worldReceived:number;frame():import('../../src/twin/scene').TwinFrame;applyView(v:RunView):void};const {knownWorldDrawing}=await import('../../src/twin/cell'),scene=(await import('../../public/replays/coffee-delivery/bundle/lab-world-scene.json')).default;
 h.view!.run.backendSetId='engineering-mujoco-cell-v1';h.view!.tick=7;h.view!.simTimeNs='140000000';internal.worldView=structuredClone(h.view!);internal.worldReceived=performance.now();internal.world={...knownWorldDrawing(scene as unknown as import('../../src/shared/navigation2d').LabWorldSceneV1),sourceRevision:h.view!.run.runRevision,record:{snapshot:{runId:h.view!.run.id,tick:7,simTimeNs:'140000000',robots:[],arms:[],props:[]},command:null,interactions:[]}};
 internal.applyView({...h.view!,tick:8,simTimeNs:'160000000',run:{...h.view!.run,runRevision:99}});const frame=internal.frame();expect(frame.view!.tick).toBe(7);expect(frame.world!.record.snapshot.tick).toBe(7);expect(h.view!.tick).toBe(8);internal.worldReceived-=1000;expect(internal.frame().world).toBeUndefined();expect(internal.frame().view!.tick).toBe(8);
});

test('explicit new cell trial preserves and retires the previous paused run before new-world admission',async()=>{
 const {w,h}=setup(),internal=w as unknown as {rt:TwinRuntime;create(p:unknown):Promise<void>;settlePrevious():Promise<void>;pinBlock():null};h.view!.run.backendSetId='engineering-mujoco-cell-v1';h.view!.run.status='paused';const calls:string[]=[];internal.pinBlock=()=>null;internal.settlePrevious=async()=>{calls.push('preserve+archive');};internal.rt.readiness=async()=>{calls.push('readiness');throw Error('ADMISSION_REACHED');};
 await expect(internal.create(presetById('mujoco-cell'))).rejects.toThrow('ADMISSION_REACHED');expect(calls).toEqual(['preserve+archive','readiness']);
});

test('registered world stress selection keeps base-composition readiness and never launches a competing smoke',()=>{
 const {w,h}=setup(),internal=w as unknown as {preset:unknown;rt:TwinRuntime};h.health={...health,capabilities:['sim3d_world_experiments_v1'],worldExperiments:[{id:'world-cup-fall-v1',requiresNewRun:true}]};internal.preset=presetById('mujoco-cell');const readiness={checkedAt:'x',expiresAt:'2099-01-01',scenarioId:'MJ-CELL-BV01',backendSetId:'engineering-mujoco-cell-v1',checks:[],canStart:true};h.readiness=readiness;const probe=vi.fn();internal.rt.readiness=probe;
 w.change('twin-world-experiment','world-cup-fall-v1');expect(h.readiness).toBe(readiness);expect(probe).not.toHaveBeenCalled();
});

test('failed/unknown physical authority immediately discards a retained current-valid frame',()=>{
 const {w,h}=setup(),internal=w as unknown as {world:unknown;worldView:RunView|null;applyView(v:RunView):void};internal.world={record:{snapshot:{runId:h.view!.run.id,tick:h.view!.tick}}};internal.worldView=structuredClone(h.view!);internal.applyView({...h.view!,run:{...h.view!.run,status:'needs_attention'},attention:[{tick:h.view!.tick,reason:'WORLD_UNKNOWN'}]});expect(internal.world).toBeNull();expect(internal.worldView).toBeNull();
});

test('a newer owner-scoped world observation refreshes matching Source context and repaints its displayed horizon',async()=>{
 const {w,h,renders}=setup(),internal=w as unknown as {rt:TwinRuntime;left:boolean;refreshWorld():Promise<void>};const scene=(await import('../../public/replays/coffee-delivery/bundle/lab-world-scene.json')).default as unknown as import('../../src/shared/navigation2d').LabWorldSceneV1;h.view!.run.backendSetId='engineering-mujoco-cell-v1';h.view!.tick=0;h.view!.simTimeNs='0';internal.left=false;const current={...structuredClone(h.view!),tick:7,simTimeNs:'140000000',run:{...h.view!.run,runRevision:h.view!.run.runRevision+1}};
 internal.rt.worldDisplayScene=async()=>({runId:current.run.id,availability:'available',reason:null,scene});internal.rt.worldDisplay=async()=>({version:1,runId:current.run.id,tick:7,revision:current.run.runRevision,simTimeNs:current.simTimeNs,availability:'valid',reason:null,control:null,controlReason:'NOT_RECORDED_AT_TICK',view:current,snapshot:{runId:current.run.id,bootId:'one-boot',sceneDigest:scene.sceneDigest,tick:7,simTimeNs:current.simTimeNs,arms:[],robots:[],props:[]} as unknown as import('../../src/shared/navigation2d').Sim3DSnapshotV1});internal.rt.get=async()=>current;
 const before=renders();await internal.refreshWorld();expect(h.view!.tick).toBe(7);expect(renders()).toBeGreaterThan(before);
});


type CellBoundary={world:import('../../src/twin/world-view').WorldDrawing|null;worldView:RunView|null;worldReceived:number;worldAbort:AbortController|null;gen:number;replay:{tick:number}|null;rt:TwinRuntime;left:boolean;playing:boolean;frame():import('../../src/twin/scene').TwinFrame;applyView(v:RunView):void;refreshWorld():Promise<void>;playback:{clear():void};current<T>(p:Promise<T>):Promise<T>};
async function cellBoundary(status:RunView['run']['status']='running'){
 const base=setup(),{w,h}=base,internal=w as unknown as CellBoundary,{knownWorldDrawing}=await import('../../src/twin/cell'),scene=(await import('../../public/replays/coffee-delivery/bundle/lab-world-scene.json')).default as unknown as import('../../src/shared/navigation2d').LabWorldSceneV1;
 const preset=presetById('mujoco-cell')!;Object.assign(h,{preset,runPreset:preset});Object.assign(h.view!,{tick:7,simTimeNs:'140000000',served:'1'});Object.assign(h.view!.run,{backendSetId:'engineering-mujoco-cell-v1',mode:'simulation',status,runRevision:11});h.view!.coffee!.cups[0]!.ownerId='LIVE_TERMINAL_OWNER';
 h.health={...health,features:{...health.features,pacedStep:true},backendSets:[...health.backendSets,{id:'engineering-mujoco-cell-v1',mode:'simulation',access:'simulated',backends:['mujoco_3d','mujoco_arm','mock_coffee'],execution:{host:'portable_python',clock:'source_fixed_step',manualStep:false,speedMultipliers:[1]}}]};
 h.report={...h.report!,manifest:{...h.report!.manifest,backendSetId:'engineering-mujoco-cell-v1'},outcome:{...h.report!.outcome,tick:7,simTimeNs:'140000000',status},businessEvents:[...h.report!.businessEvents.filter(e=>Date.parse(e.at)<=Date.parse(at(0))),{sequence:'8',at:at(7),type:'CupTransferConfirmed',kind:'cup',id:'cup-1',state:{cupId:'cup-1',ownerKind:'customer',ownerId:'LIVE_TERMINAL_OWNER'}}],telemetry:{...h.report!.telemetry!,samples:h.report!.telemetry!.samples.filter(s=>BigInt(s.simTimeNs!)<=140000000n)}};
 internal.worldView=structuredClone(h.view!);internal.worldReceived=performance.now();internal.world={...knownWorldDrawing(scene)!,sourceRevision:11,quality:'valid',record:{snapshot:{runId:h.view!.run.id,bootId:'one-boot',sceneDigest:scene.sceneDigest,tick:7,simTimeNs:'140000000',robots:[],arms:[],props:[]} as unknown as import('../../src/shared/navigation2d').Sim3DSnapshotV1,command:null,interactions:[]}};return {...base,internal};
}
const transportButton=(html:string,action:string)=>html.match(new RegExp('<button[^>]*id="transport-'+action+'"[^>]*>'))?.[0]??'';
for(const matching of [true,false])test(`cell report replay invalidates live H7 immediately and projects cursor0 (${matching?'matching':'fetched'} report)`,async()=>{
 const {w,h,internal}=await cellBoundary('paused'),report=structuredClone(h.report!),gate=deferred<RunReport>(),abort=new AbortController(),clear=vi.spyOn(internal.playback,'clear'),generation=internal.gen;
 internal.worldAbort=abort;if(!matching){h.report={...report,outcome:{...report.outcome,tick:6}};internal.rt.report=()=>gate.promise;}
 const old=deferred<string>(),stale=internal.current(old.promise).catch(e=>e.code);w.click('twin-replay');expect(abort.signal.aborted).toBe(true);expect(internal.world).toBeNull();expect(internal.worldView).toBeNull();expect(internal.gen).toBeGreaterThan(generation);expect(clear).toHaveBeenCalled();old.resolve('old');expect(await stale).toBe('STALE_ANSWER');
 if(!matching){const read=vi.fn();internal.rt.worldDisplay=read;internal.rt.worldDisplayScene=read;internal.left=false;await internal.refreshWorld();expect(read).not.toHaveBeenCalled();gate.resolve(report);}await vi.waitFor(()=>expect(internal.replay).not.toBeNull());await vi.waitFor(()=>expect(h.busy).toBe(false));
 for(const cursor of [0,5,7,0]){w.input('twin-replay-cursor',String(cursor));const f=internal.frame();expect(f.view!.tick).toBe(cursor);expect(f.report!.outcome.tick).toBe(cursor);expect(f.world).toBeUndefined();expect(f.view!.coffee!.cups[0]!.ownerId).toBe(cursor<7?'coffee-1':'LIVE_TERMINAL_OWNER');}
 internal.worldReceived-=1000;expect(internal.frame().view!.tick).toBe(0);expect(internal.frame().world).toBeUndefined();expect(w.html()).toContain('data-testid="cell-report-world-unavailable"');expect(w.html()).toContain('WORLD_NOT_RECORDED_IN_REPORT');expect(w.html()).not.toMatch(/data-testid="primary-action"[^>]*data-action="twin-(pause|resume|play)"/);expect(transportButton(w.html(),'twin-pause')).toContain('disabled');
});
test('even a late retained world cannot override report replay projection',async()=>{const {w,internal}=await cellBoundary('paused'),world=internal.world,worldView=internal.worldView;w.click('twin-replay');await settle();internal.world=world;internal.worldView=worldView;internal.worldReceived=performance.now();w.input('twin-replay-cursor','0');expect(internal.frame().world).toBeUndefined();expect(internal.frame().view!.tick).toBe(0);});

test('acknowledged live Pause and Resume render current controls while the retained H7 context stays coherent',async()=>{
 const {w,h,internal}=await cellBoundary('running'),previous=structuredClone(h.view!);internal.applyView({...previous,run:{...previous.run,status:'paused',runRevision:12}});expect(internal.frame().view!.run.status).toBe('running');expect(internal.frame().world!.sourceRevision).toBe(11);expect(w.html()).toMatch(/data-testid="primary-action" data-action="twin-resume"(?![^>]*disabled)/);expect(transportButton(w.html(),'twin-resume')).not.toContain('disabled');expect(transportButton(w.html(),'twin-resume')).not.toBe('');
 internal.worldView=structuredClone(h.view!);internal.world!.sourceRevision=12;internal.worldReceived=performance.now();internal.applyView({...h.view!,run:{...h.view!.run,status:'running',runRevision:13}});expect(internal.frame().view!.run.status).toBe('paused');expect(internal.frame().world!.sourceRevision).toBe(12);expect(w.html()).toMatch(/data-testid="primary-action" data-action="twin-play"(?![^>]*disabled)/);expect(transportButton(w.html(),'twin-play')).not.toContain('disabled');expect(transportButton(w.html(),'twin-resume')).toBe('');expect(transportButton(w.html(),'twin-pause')).not.toContain('disabled');
});
for(const transition of ['readonly','attention','unknown'] as const)test(`current ${transition} policy never inherits retained running controls`,async()=>{const {w,h,internal}=await cellBoundary('running');internal.playing=true;const current={...structuredClone(h.view!),run:{...h.view!.run,runRevision:12,status:transition==='readonly'?'paused' as const:'needs_attention' as const},...transition==='readonly'?{controlAccess:'view_reconcile' as const}:{attention:[{tick:7,reason:transition==='unknown'?'WORLD_UNKNOWN':'TEST_ATTENTION'}]}};internal.applyView(current);expect(transportButton(w.html(),'twin-play')).toBe('');expect(transportButton(w.html(),transition==='readonly'?'twin-resume':'twin-pause')).toContain('disabled');expect(w.html()).not.toMatch(/data-testid="primary-action" data-action="twin-(play|pause|resume)"/);if(transition==='unknown')expect(internal.world).toBeNull();else {expect(internal.frame().world!.sourceRevision).toBe(11);expect(internal.frame().view!.run.status).toBe('running');}});

test('same-H newer revision expires the retained pair without attaching old geometry to current context',async()=>{const {h,internal}=await cellBoundary('running');internal.applyView({...h.view!,run:{...h.view!.run,status:'paused',runRevision:12}});expect(internal.frame().world!.sourceRevision).toBe(11);expect(internal.frame().view!.run.runRevision).toBe(11);internal.worldReceived-=501;expect(internal.frame().view!.run.runRevision).toBe(12);expect(internal.frame().world).toBeUndefined();internal.worldView=structuredClone(h.view!);internal.world!.sourceRevision=12;internal.worldReceived=performance.now();expect(internal.frame().world!.sourceRevision).toBe(12);});
test('an ignored-abort late world response cannot repopulate report replay after its generation reset',async()=>{const {w,h,internal}=await cellBoundary('paused'),late=deferred<import('../../src/scenarios/controls').WorldDisplay>(),drawing=internal.world!,observer=internal as unknown as {worldRun:string;worldDrawing:Omit<import('../../src/twin/world-view').WorldDrawing,'record'>};observer.worldRun=h.view!.run.id;observer.worldDrawing=drawing;internal.rt.worldDisplayScene=async()=>({runId:h.view!.run.id,availability:'available',reason:null,scene:drawing.scene});internal.rt.worldDisplay=()=>late.promise;internal.left=false;const read=internal.refreshWorld(),abort=internal.worldAbort;w.click('twin-replay');expect(abort!.signal.aborted).toBe(true);late.resolve({version:1,runId:h.view!.run.id,tick:7,revision:11,simTimeNs:'140000000',availability:'valid',reason:null,snapshot:drawing.record.snapshot,control:null,controlReason:'NOT_RECORDED_AT_TICK'});await read;await settle();expect(internal.world).toBeNull();expect(internal.worldView).toBeNull();expect(internal.frame().view!.tick).toBe(0);});

test('a Resume selected against retained running geometry sends the current acknowledged revision',async()=>{const {w,h,internal}=await cellBoundary('running');internal.applyView({...h.view!,run:{...h.view!.run,status:'paused',runRevision:12}});const action=vi.fn(async(v:RunView)=>({...v,run:{...v.run,status:'running' as const,runRevision:13}}));internal.rt.action=action;w.click('twin-resume');await vi.waitFor(()=>expect(h.busy).toBe(false));expect(action.mock.calls[0]![0].run.runRevision).toBe(12);expect(internal.world!.sourceRevision).toBe(11);});

test('paired Source world/context is consumed without racing a later independent GET',async()=>{
 const {h,internal}=await cellBoundary('running'),world=internal.world!,paired={...structuredClone(h.view!),tick:8,simTimeNs:'160000000'};
 const observer=internal as unknown as {worldRun:string;worldDrawing:Omit<import('../../src/twin/world-view').WorldDrawing,'record'>};observer.worldRun=paired.run.id;observer.worldDrawing=world;
 internal.rt.worldDisplayScene=async()=>({runId:paired.run.id,availability:'available',reason:null,scene:world.scene});
 internal.rt.worldDisplay=async()=>({version:1,runId:paired.run.id,revision:paired.run.runRevision,tick:8,simTimeNs:paired.simTimeNs,availability:'valid',reason:null,snapshot:{...world.record.snapshot,tick:8,simTimeNs:paired.simTimeNs},control:null,controlReason:'NOT_RECORDED_AT_TICK',view:paired});
 const get=vi.fn(async()=>({...paired,tick:9,simTimeNs:'180000000'}));internal.rt.get=get;internal.left=false;await internal.refreshWorld();
 expect(internal.world!.record.snapshot.tick).toBe(8);expect(internal.worldView!.tick).toBe(8);expect(get).not.toHaveBeenCalled();
});
test('cell Pause is admitted while its paced step is held and retains the admitted revision',async()=>{
 const {w,h,internal}=await cellBoundary('running');h.health={...h.health!,features:{...h.health!.features,pacedStep:true}};
 const held=deferred<RunView>(),started=deferred<void>(),calls:{kind:string;revision:number}[]=[],before=structuredClone(h.view!);
 internal.rt.action=async(v,kind)=>{calls.push({kind,revision:v.run.runRevision});if(kind==='step'){started.resolve();return held.promise;}return {...before,run:{...before.run,status:'paused',runRevision:12}};};
 w.click('twin-play');await started.promise;w.click('twin-pause');await settle();
 try{expect(calls).toContainEqual({kind:'pause',revision:11});}finally{held.resolve({...before,run:{...before.run,status:'paused',runRevision:13}});await vi.waitFor(()=>expect(h.busy).toBe(false));}
 expect(h.view!.run.runRevision).toBe(13);expect(calls.filter(c=>c.kind==='pause')).toHaveLength(1);
});

for(const code of ['REVISION_CONFLICT','NETWORK_ERROR'])test(`cell priority Pause ${code} preserves definite versus unknown mutation semantics`,async()=>{
 const {w,h,internal}=await cellBoundary('running');h.health={...h.health!,features:{...h.health!.features,pacedStep:true}};
 const held=deferred<RunView>(),started=deferred<void>(),before=structuredClone(h.view!),calls:{kind:string;revision:number;id:string|undefined}[]=[];
 internal.rt.action=async(v,kind,_payload,id)=>{calls.push({kind,revision:v.run.runRevision,id});if(kind==='step'){started.resolve();return held.promise;}if(calls.filter(c=>c.kind==='pause').length===1)throw new TwinRuntimeError(code,[],code==='REVISION_CONFLICT'?409:0);return {...before,run:{...before.run,status:'paused',runRevision:13}};};
 w.click('twin-play');await started.promise;w.click('twin-pause');await settle();held.resolve({...before,run:{...before.run,runRevision:12}});await vi.waitFor(()=>expect(h.busy).toBe(false));
 const pauses=calls.filter(c=>c.kind==='pause');expect(pauses.map(c=>c.revision)).toEqual(code==='REVISION_CONFLICT'?[11,12]:[11]);if(pauses.length===2)expect(pauses[1]!.id).not.toBe(pauses[0]!.id);expect(h.view!.run.status).toBe(code==='REVISION_CONFLICT'?'paused':'running');
});
