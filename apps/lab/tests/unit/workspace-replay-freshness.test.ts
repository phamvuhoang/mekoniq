import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {ghostsAt} from '../../src/twin/belief';
import {afterEach,expect,test,vi} from 'vitest';
import {coffeeReplay,sample} from '../support/coffee-replay';
import type {RunReport,RunView,TwinRuntime} from '../../src/scenarios/controls';
import type {TwinFrame,ViewState} from '../../src/twin/scene';
import type {TwinStore} from '../../src/twin/store';
import type {Link} from '../../src/twin/freshness';
vi.stubGlobal('localStorage',{getItem:()=>'en',setItem:()=>{}});
vi.stubGlobal('innerWidth',600);
const {TwinWorkspace}=await import('../../src/ui/workspace');
const {presetById}=await import('../../src/scenarios/catalog');
const {inspect}=await import('../../src/twin/inspector');
const {openReplayV2}=await import('../../src/reports/replay');
const {reportKpis}=await import('../../src/reports/compare');
const {armRows}=await import('../../src/twin/coffee-cell');
const nodes=new Map<string,{innerHTML:string;outerHTML:string;dataset:Record<string,string>}>();
const node=(id:string)=>{const n={innerHTML:'',outerHTML:'',dataset:{} as Record<string,string>};nodes.set(id,n);return n;};
vi.stubGlobal('document',{querySelector:()=>null,getElementById:(id:string)=>nodes.get(id)??null,activeElement:null});
type Harness={view:RunView;report:RunReport;runPreset:ReturnType<typeof presetById>;store:TwinStore;link:Link;vs:ViewState;frame():TwinFrame;tick():void};
function workspace(){const w=new TwinWorkspace(()=>{}, {paired:false} as TwinRuntime),h=w as unknown as Harness;Object.assign(h,coffeeReplay(),{runPreset:presetById('coffee')});return {w,h};}
afterEach(()=>{nodes.clear();vi.restoreAllMocks();});
test('actual workspace replays BV01 cup/job/measurement/served state at each custody boundary',()=>{
 const {w,h}=workspace(),original=JSON.stringify(h.report);w.click('twin-replay');
 for(const [tick,owner,status,served,measured] of [[0,'cell','reserved','0',null],[10,'cell','ready_for_pickup','0','0.00003'],[20,'arm','ready_for_pickup','0','0.00003'],[30,'robot','loaded','0','0.00003'],[40,'customer','delivered','1','0.00003']] as const){
  w.input('twin-replay-cursor',String(tick));const f=h.frame();
  expect(f.view).toMatchObject({tick,simTimeNs:String(tick*20000000),served,coffee:{jobs:[{status}],cups:[{ownerKind:owner}]}});
  expect(f.report?.outcome).toMatchObject({tick,served});
  expect(f.report?.coffee?.jobs[0]?.steps[0]?.measured?.amount??null).toBe(measured);
  expect(f.report?.businessEvents.every(e=>Date.parse(e.at)<=Date.parse('2026-11-01T00:00:00Z')+tick*20)).toBe(true);
 }
 w.input('twin-replay-cursor','0');expect(w.html()).toContain('Coffee cell');expect(w.html()).toMatch(/data-testid="run-served"[^]*?<b>0<\/b>/);
 expect(JSON.stringify(h.report)).toBe(original);w.leave();
});
test('arm inspector selects the latest recorded joint sample at or before the cursor',()=>{
 const {report}=coffeeReplay();expect(armRows(report,10)[0]).toMatchObject({commanded:'0.000 (0.0°)',ageMs:200});
 expect(armRows(report,-1)[0]).toMatchObject({source:'unknown',ageMs:null});
});
test('replay uses simulation time, keeps same-tick fault samples, and does not interpolate through them',()=>{
 const {report}=coffeeReplay();report.telemetry!.samples=[sample(0,1000),sample(5,1001),sample(5,1002,'stale'),sample(10,1003)];
 const rp=openReplayV2(report);expect(rp.range.toTick).toBe(100);
 expect(rp.seek(5).entities['amr-1']).toMatchObject({seq:'1002',quality:'stale'});
 expect(rp.pose('amr-1',5)).toMatchObject({gap:true,seq:'1002'});
 expect(rp.pose('amr-1',7)).toMatchObject({interpolated:false,gap:true,seq:'1002'});
});
test('replayed cell busy KPI uses only process events at the cursor, without leaking the final duration',()=>{
 const {w,h}=workspace();h.report.coffee!.plantLog=[{event:'accepted',commandId:'brew-1',tick:5},{event:'completed',commandId:'brew-1',tick:25}];
 const original=JSON.stringify(h.report);w.click('twin-replay');
 for(const [tick,events,expected]of [[0,0,{value:null,available:false,reason:'NO_CELL_PROCESS'}],[10,1,{value:null,available:false,reason:'INCOMPLETE_CELL_CYCLE'}],[25,2,{value:0.4,available:true,samples:1}]]as const){
  w.input('twin-replay-cursor',String(tick));const report=h.frame().report!;
  expect(report.coffee!.plantLog).toHaveLength(events);
  expect(reportKpis(report).find(k=>k.id==='cellProcessBusyS')).toMatchObject(expected);
 }
 expect(JSON.stringify(h.report)).toBe(original);w.leave();
});
test('replay report withholds future arm collision results and keeps undated legacy results until the endpoint',()=>{
 const {report,view}=coffeeReplay();
 report.coffee!.armTrace.collision={world:[],checks:3,last:{ok:false,engine:'checker',geometryRevision:'geometry-1',modelRevision:'arm-1',pair:['arm','fixture']},scene:{available:true,scope:'self_scene_robot',revision:'scene-1',profileRevision:1,tick:40}};
 const replay=openReplayV2(report),collision=(tick:number)=>replay.project(view,tick).report.coffee!.armTrace.collision;
 expect(collision(39)).toBeNull();expect(collision(40)).toEqual(report.coffee!.armTrace.collision);
 delete report.coffee!.armTrace.collision.scene;
 expect(collision(99)).toBeNull();expect(collision(100)).toEqual(report.coffee!.armTrace.collision);
});
test('scene and inspector repaint when freshness/link changes with zero new samples',()=>{
 let now=0;vi.spyOn(performance,'now').mockImplementation(()=>now);
 const {w,h}=workspace();h.vs.selected='amr-1';h.link={state:'live',lastHeartbeatMs:0,paused:false};h.view.simTimeNs='0';h.view.tick=0;
 const stage=node('twin-stage'),inspector=node('twin-inspector'),chip=node('twin-telemetry');
 h.store.apply(sample(0,1));h.tick();expect(stage.innerHTML).toContain('data-source="observed"');
 now=1000;h.link.lastHeartbeatMs=1000;h.tick();
 expect(chip.dataset.state).toBe('stale');expect(stage.innerHTML).toContain('data-source="unknown"');expect(inspector.innerHTML).toContain('stale / unknown');
 h.link.state='reconnecting';h.tick();expect(chip.dataset.state).toBe('disconnected');
 h.link={state:'live',lastHeartbeatMs:1000,paused:true};h.tick();expect(chip.dataset.state).toBe('frozen_sim');expect(stage.innerHTML).toContain('data-source="observed"');expect(inspector.innerHTML).toContain('valid');
 expect(h.store.stats.applied).toBe(1);w.leave();
});
test('live workspace compares sample time with snapshot time and updates quality/motion at an action boundary',()=>{
 const {w,h}=workspace();h.link={state:'live',lastHeartbeatMs:performance.now(),paused:true};h.view.tick=100;h.view.simTimeNs='2000000000';h.view.run.telemetryCursor='1';
 h.store.apply(sample(100,2,'stale'));expect(h.frame().view?.entities[0]).toMatchObject({pose:{x:10},quality:'stale'});
 w.leave();
});
test('reset creates a new run with the locked inputs at tick zero and preserves the old report',async()=>{
 const {w,h}=workspace(),prior=h.report,created:unknown[]=[],actions:string[]=[];
 Object.assign(h,{health:{sourceCommit:'d'.repeat(40),schemaHash:'s'},openStreams:()=>{},rt:{paired:true,create:async(request:unknown)=>{created.push(request);return {...coffeeReplay().view,tick:0,simTimeNs:'0',served:'0',coffee:{jobs:[],cups:[]},run:{...coffeeReplay().view.run,id:'new-run',status:'ready'}};},report:async()=>({...coffeeReplay().report,manifest:{...coffeeReplay().report.manifest,runId:'new-run'}}),action:async(_v:unknown,kind:string)=>{actions.push(kind);return coffeeReplay().view;}}});
 w.click('twin-reset');await vi.waitFor(()=>expect(created).toHaveLength(1));
 expect(h.view).toMatchObject({tick:0,run:{id:'new-run',status:'ready'}});expect(actions).toEqual([]);expect((h as unknown as {previous:RunReport}).previous).toEqual(prior);w.leave();
});
test('speed inputs validate positive bounded AMR limits and retain the running project while editing the next run',()=>{
 const {w,h}=workspace(),locked=structuredClone(h.runPreset?.project);w.change('twin-speed-limit','0.2');
 expect(h.runPreset?.project).toEqual(locked);expect(w.html()).toContain('value="0.2"');
 w.change('twin-speed-limit','-1');expect(w.html()).toContain('value="0.2"');
 w.change('twin-run-speed','4');expect(w.html()).toContain('value="4" selected');w.leave();
});
test('choosing another preset preserves the active run and its locked scene',()=>{
 const {w,h}=workspace();const id=h.view.run.id;w.click('twin-preset','delivery');expect(h.view.run.id).toBe(id);expect(h.frame().preset.scenarioId).toBe('BV01');w.leave();
});
test('cup correction requires a recoverable job and explicit confirmation before requesting bound observation',async()=>{
 const {w,h}=workspace(),actions:string[]=[];h.view.coffee!.jobs[0]={...h.view.coffee!.jobs[0]!,status:'reserved',canRestoreCup:true};
 Object.assign(h,{rt:{paired:true,action:async(_v:unknown,kind:string)=>{actions.push(kind);return coffeeReplay().view;},report:async()=>coffeeReplay().report}});
 w.click('twin-restore-cup');expect(actions).toEqual([]);expect(w.html()).toContain('Confirm cup correction');w.click('twin-confirm-cancel');expect(actions).toEqual([]);
 w.click('twin-restore-cup');w.click('twin-confirm-ok');await vi.waitFor(()=>expect(actions).toEqual(['restoreCup']));w.leave();
});

test('opening a saved cell report retains its admitted belief at a cursor without exact world poses',()=>{
 const {w,h}=workspace(),p=presetById('mujoco-cell')!;
 const report=JSON.parse(gunzipSync(readFileSync('public/replays/belief-recovery/report.json.gz.bin')).toString());
 Object.assign(h,{saved:[{id:'recovery',report,project:p.project}]});
 w.click('twin-open-evidence','recovery');
 w.input('twin-replay-cursor','30');
 const frame=h.frame();
 expect(frame.world).toBeUndefined();expect(frame.report?.arm).toBeUndefined();expect(frame.report?.physicsEvidence).toBeUndefined();
 expect(ghostsAt(frame,p.project.armCollisionProfile?.baseInMap).status).toBe('data');
 w.leave();
});
