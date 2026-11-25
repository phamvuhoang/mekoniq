// Review C01 F2: an opened saved/imported IR-SIM report draws only the compiled scene its own evidence names (sceneDigest), loaded from its own bundle;
// the scene of the last live run is never shown as another run's geometry, and a missing scene is unavailable with its reason (fail closed).
import 'fake-indexeddb/auto';
import {afterEach,expect,test,vi} from 'vitest';
import type {RunReport,TwinRuntime} from '../../src/scenarios/controls';
import type {TwinFrame} from '../../src/twin/scene';
import type {NavigationSceneV1} from '../../src/shared/navigation2d';
import type {SavedEvidence} from '../../src/reports/evidence';
import serveScene from '../../fixtures/engineering/serve-demo-v1/navigation-scene.json' with {type:'json'};
import {D,evidence,project,report} from '../support/navigation-report';
// Task 1.4: create() reads the payload bundle only for the MuJoCo mobile preset, and a bundle that fails never stops the run
const payloadSpy=vi.hoisted(()=>({fn:null as null|((...a:unknown[])=>Promise<unknown>)}));
vi.mock('../../src/twin/payload',async orig=>{const m=await orig<typeof import('../../src/twin/payload')>();return {...m,loadPayloadBundle:(...a:unknown[])=>payloadSpy.fn?payloadSpy.fn(...a):m.loadPayloadBundle(...(a as Parameters<typeof m.loadPayloadBundle>))};});
vi.stubGlobal('localStorage',{getItem:()=>'en',setItem:()=>{}});
vi.stubGlobal('innerWidth',600);
vi.stubGlobal('document',{querySelector:()=>null,getElementById:()=>null,activeElement:null});
const {TwinWorkspace}=await import('../../src/ui/workspace');
const {captureEvidence}=await import('../../src/reports/evidence');
const {boundNavigationScene}=await import('../../src/reports/navigation2d');
const workspaces:InstanceType<typeof TwinWorkspace>[]=[];
afterEach(()=>{for(const w of workspaces.splice(0))w.leave();});
const scene=(digest:string)=>({...structuredClone(serveScene),sceneDigest:digest}) as unknown as NavigationSceneV1;
const A=scene(D('a')),B=scene(D('b')),BUNDLE_A=D('1'),BUNDLE_B=D('2');
/** run A: its evidence names scene A, its manifest bundle A */
function runA():RunReport{const r=report({navigation2d:{...evidence(),sceneDigest:A.sceneDigest}});r.manifest.engineering={bundleDigest:BUNDLE_A,projectDigest:D('3')};return r;}
type Harness={frame():TwinFrame;busy:boolean;navigation:NavigationSceneV1|null;saved:SavedEvidence[]};
function open(bundles:Record<string,NavigationSceneV1>){
 const enc=new TextEncoder(),rt={paired:true,engineeringManifest:async(digest:string)=>{if(!bundles[digest])throw new Error('BUNDLE_NOT_FOUND');return {files:[{path:'navigation-scene.json',sha256:digest}]};},
  engineeringBlob:async(sha:string)=>enc.encode(JSON.stringify(bundles[sha]))} as unknown as TwinRuntime;
 const w=new TwinWorkspace(()=>{},rt),h=w as unknown as Harness;workspaces.push(w);
 const saved=captureEvidence(runA(),structuredClone(project) as never);
 Object.assign(h,{navigation:B,saved:[saved]});// scene B: what the last live create() loaded
 w.click('twin-open-evidence',saved.id);
 return {w,h};
}
test('the decision: a scene is shown only when it is the one the report evidence names; otherwise unavailable with the reason',()=>{
 expect(boundNavigationScene(runA(),A,false)).toEqual({scene:A,reason:null});
 expect(boundNavigationScene(runA(),B,false)).toEqual({scene:null,reason:'NAVIGATION_SCENE_MISMATCH'});
 expect(boundNavigationScene(runA(),null,false)).toEqual({scene:null,reason:'NAVIGATION_SCENE_UNAVAILABLE'});
 const old=report();delete (old as {navigation2d?:unknown}).navigation2d;
 expect(boundNavigationScene(old,A,false)).toEqual({scene:null,reason:'NAVIGATION_SCENE_UNBOUND'});// an archived report without evidence names no scene
 expect(boundNavigationScene(old,A,true)).toEqual({scene:A,reason:null});// a live run keeps the scene of the bundle it was created from
});
test('opening saved run A after a live run B shows scene A from bundle A, never scene B',async()=>{
 const {h}=open({[BUNDLE_A]:A,[BUNDLE_B]:B});
 expect(h.frame().navigation?.sceneDigest).not.toBe(B.sceneDigest);
 await vi.waitFor(()=>expect(h.frame().navigation?.sceneDigest).toBe(A.sceneDigest));
});
test('when bundle A is no longer on the runtime, the layers are unavailable with a visible reason, not scene B',async()=>{
 const {w,h}=open({[BUNDLE_B]:B});
 await new Promise(r=>setTimeout(r,10));
 expect(h.frame().navigation).toBeNull();
 expect(w.html()).toContain('NAVIGATION_SCENE_UNAVAILABLE');
});
test('a bundle whose scene is not the one the evidence names is refused as a mismatch',async()=>{
 const {w,h}=open({[BUNDLE_A]:B});
 await new Promise(r=>setTimeout(r,10));
 expect(h.frame().navigation).toBeNull();
 expect(w.html()).toContain('NAVIGATION_SCENE_MISMATCH');
});
test('review5 #5: a reclaimed IR-SIM run shows the scene its locked bundle holds; a missing one is unavailable with the reason, never silently dropped',async()=>{
 const {presets}=await import('../../src/scenarios/catalog');
 const ir=presets.find(p=>p.engineering)!,m=runA().manifest;
 const reclaim=(bundles:Record<string,NavigationSceneV1>)=>{
  const view={run:{schemaVersion:2,id:m.runId,mode:'simulation',access:'simulated',backendSetId:m.backendSetId,backends:['irsim_2d'],status:'completed',runRevision:0,eventCursor:null,telemetryCursor:null,fidelity:'modeled',ageMs:0,sourceCommit:m.sourceCommit,scenarioId:m.scenario.id,scenarioRevision:1,seed:m.seed},
   tick:400,simTimeNs:'8000000000',model:'irsim',entities:[],workload:[],awaiting:[],attention:[],served:'1',coffee:null,controlAccess:'view_reconcile',
   lockedInput:{project:structuredClone(project),scenarioId:m.scenario.id,scenarioRevision:1,seed:m.seed,mode:'simulation',access:'simulated',backendSetId:m.backendSetId,engineering:{ref:{bundleDigest:BUNDLE_A,projectDigest:D('3')},project:ir.engineering!.project,runtimeProjection:{project:structuredClone(project),assets:[]}}}};
  const enc=new TextEncoder(),rt={paired:true,reclaim:async()=>view,report:async()=>runA(),engineeringManifest:async(digest:string)=>{if(!bundles[digest])throw new Error('BUNDLE_NOT_FOUND');return {files:[{path:'navigation-scene.json',sha256:digest}]};},
   engineeringBlob:async(sha:string)=>enc.encode(JSON.stringify(bundles[sha]))} as unknown as TwinRuntime;
  const w=new TwinWorkspace(()=>{},rt),h=w as unknown as Harness;workspaces.push(w);
  Object.assign(h,{health:{sourceCommit:'d'.repeat(40),schemaHash:'s',protocolMajors:[2],backends:[],backendSets:[],scenarioIds:[]},openStreams:()=>{}});
  w.click('twin-reclaim',m.runId);return {w,h};
 };
 const {h}=reclaim({[BUNDLE_A]:A});
 await vi.waitFor(()=>expect(h.busy).toBe(false));
 expect(h.frame().preset.engineering).toEqual({project:ir.engineering!.project,receipt:null});
 await vi.waitFor(()=>expect(h.frame().navigation?.sceneDigest).toBe(A.sceneDigest));
 const gone=reclaim({});
 await vi.waitFor(()=>expect(gone.h.busy).toBe(false));await new Promise(r=>setTimeout(r,10));
 expect(gone.h.frame().navigation).toBeNull();
 expect(gone.w.html()).toContain('NAVIGATION_SCENE_UNAVAILABLE');
});
test('review5 #5: a digest-bound scene is shown whatever preset the report maps to (no engineering preset for its scenario)',async()=>{
 const enc=new TextEncoder(),rt={paired:true,engineeringManifest:async()=>({files:[{path:'navigation-scene.json',sha256:BUNDLE_A}]}),engineeringBlob:async()=>enc.encode(JSON.stringify(A))} as unknown as TwinRuntime;
 const w=new TwinWorkspace(()=>{},rt),h=w as unknown as Harness;workspaces.push(w);
 const r=runA();r.manifest.scenario={...r.manifest.scenario,id:'IR-UNLISTED'};
 const saved=captureEvidence(r,structuredClone(project) as never);Object.assign(h,{saved:[saved]});
 w.click('twin-open-evidence',saved.id);
 await vi.waitFor(()=>expect(h.frame().navigation?.sceneDigest).toBe(A.sceneDigest));
 // and the same report whose bundle is gone states why
 const w2=new TwinWorkspace(()=>{},{paired:true,engineeringManifest:async()=>{throw new Error('BUNDLE_NOT_FOUND');}} as unknown as TwinRuntime),h2=w2 as unknown as Harness;workspaces.push(w2);
 Object.assign(h2,{saved:[saved]});w2.click('twin-open-evidence',saved.id);await new Promise(res=>setTimeout(res,10));
 expect(h2.frame().navigation).toBeNull();expect(w2.html()).toContain('NAVIGATION_SCENE_UNAVAILABLE');
});
test('review7 #3: the navigation verdict is the full report\'s at every replay cursor (never the cursor projection, never stale)',async()=>{
 const {w}=open({[BUNDLE_A]:A});
 const verdict=()=>/data-testid="navigation-evidence" data-supported="(\w+)" data-complete="(\w+)"/.exec(w.html())?.slice(1);
 expect(verdict()).toEqual(['true','true']);// opened at its outcome tick: complete
 w.click('twin-replay');// replay from tick 0
 for(const tick of ['0','5','200','400']){w.input('twin-replay-cursor',tick);expect(verdict(),tick).toEqual(['true','true']);expect(w.html(),tick).not.toContain('IDENTITY_MISMATCH');}
});
test('review7 #4: in 3D a layer the 3D view does not draw is disabled with a visible reason and never shown as on',async()=>{
 const {w,h}=open({[BUNDLE_A]:A});
 await vi.waitFor(()=>expect(h.frame().navigation?.sceneDigest).toBe(A.sceneDigest));
 w.click('twin-layer','contacts');// on in 2D
 w.click('twin-view','3d');
 const html=w.html(),button=(l:string)=>new RegExp(`<button data-action="twin-layer" data-value="${l}"[^>]*>`).exec(html)?.[0]??'';
 for(const l of ['contacts','scan']){expect(button(l),l).toContain('disabled');expect(button(l),l).toContain('aria-pressed="false"');}
 for(const l of ['footprint','safety','path','observed','frames'])expect(button(l),l).not.toContain('disabled');
 expect(html).toContain('data-testid="layers-2d-only"');expect(html).toContain('Drawn on the 2D plan only');
 w.click('twin-layer','scan');expect((h as unknown as {vs:{layers:Record<string,boolean>}}).vs.layers.scan).toBe(false);// a 2D-only layer cannot be switched in 3D
});
async function created(presetId:string,bundle:()=>Promise<unknown>){
 const {presets}=await import('../../src/scenarios/catalog'),{hashJson}=await import('../../src/twin/hash'),base=presets.find(x=>x.id===presetId)!;
 const p={...base,engineering:{project:base.engineering!.project,receipt:{state:'compiled',problems:[],bundleDigest:BUNDLE_A,projectDigest:hashJson(base.engineering!.project)}}};// a compiled receipt for exactly this draft
 const log:string[]=[],calls=vi.fn(bundle);payloadSpy.fn=calls;
 const view={run:{id:'run-1',backendSetId:p.backendSetId,status:'created'}};
 const rt={paired:true,create:async()=>{log.push('rt.create');return view;},engineeringManifest:async()=>{throw new Error('BUNDLE_NOT_FOUND');}} as unknown as TwinRuntime;
 const w=new TwinWorkspace(()=>{},rt);workspaces.push(w);
 Object.assign(w,{health:{sourceCommit:'d'.repeat(40),schemaHash:'s',features:{}},settlePrevious:async()=>{},apply:async()=>{log.push('apply');},
  openStreams:()=>{},refreshWorld:async()=>{},render:()=>log.push('render'),act:async(a:string)=>{log.push(`act:${a}`);}});
 await (w as unknown as {create(p:unknown,start?:boolean):Promise<void>}).create(p,true);payloadSpy.fn=null;
 return {log,calls};
}
test('Task 1.4: a non-mobile engineering preset (Webots FD01) never loads the payload bundle, and the run view is painted before start',async()=>{
 const {log,calls}=await created('webots-fd01',async()=>null);
 expect(calls).toHaveBeenCalledTimes(0);
 expect(log.slice(0,4)).toEqual(['rt.create','apply','render','act:start']);
});
test('Task 1.4: the mobile preset whose payload bundle rejects still reaches rt.create',async()=>{
 const {MUJOCO_MOBILE_SET}=await import('../../src/twin/payload');
 const {presets}=await import('../../src/scenarios/catalog');expect(presets.some(p=>p.id==='mujoco-payload'&&p.backendSetId===MUJOCO_MOBILE_SET)).toBe(true);
 const {log,calls}=await created('mujoco-payload',async()=>{throw new Error('PAYLOAD_MODEL_INVALID');});
 expect(calls).toHaveBeenCalledTimes(1);
 expect(log).toContain('rt.create');
});
