// U01 review: the honesty items that appear only in some run states are still rendered, and inside the container the layout gives them
// (Display menu, viewport overlay, problems box). Same harnesses as workspace-navigation-scene / workspace-replay-freshness.
import 'fake-indexeddb/auto';
import {afterEach,expect,test,vi} from 'vitest';
import type {TwinRuntime} from '../../src/scenarios/controls';
import type {NavigationSceneV1} from '../../src/shared/navigation2d';
import serveScene from '../../fixtures/engineering/serve-demo-v1/navigation-scene.json' with {type:'json'};
import {D,evidence,project,report} from '../support/navigation-report';
import {coffeeReplay} from '../support/coffee-replay';
vi.stubGlobal('localStorage',{getItem:()=>'en',setItem:()=>{}});
vi.stubGlobal('innerWidth',1440);
vi.stubGlobal('document',{querySelector:()=>null,getElementById:()=>null,activeElement:null});
const {TwinWorkspace}=await import('../../src/ui/workspace');
const {captureEvidence}=await import('../../src/reports/evidence');
const {presetById}=await import('../../src/scenarios/catalog');
const workspaces:InstanceType<typeof TwinWorkspace>[]=[];
afterEach(()=>{for(const w of workspaces.splice(0))w.leave();});
/** The markup between a container's opening marker and the marker of what follows it. */
const between=(html:string,from:string,to:string)=>{const a=html.indexOf(from),b=html.indexOf(to,a);expect(a,from).toBeGreaterThanOrEqual(0);expect(b,to).toBeGreaterThan(a);return html.slice(a,b);};
const displayMenu=(html:string)=>between(html,'data-testid="display-menu"','class="twin-overlay"');
const overlay=(html:string)=>between(html,'class="twin-overlay"','data-testid="twin-inspector"');
const problemsBox=(html:string)=>between(html,'data-testid="problems-panel"','data-testid="caveat-detail"');
const count=(html:string,testid:string)=>html.split(`data-testid="${testid}"`).length-1;
const BUNDLE=D('1'),scene={...structuredClone(serveScene),sceneDigest:D('a')} as unknown as NavigationSceneV1;
/** An opened IR-SIM report whose evidence names `scene`; `bundles` is what the runtime still holds. */
function irsim(bundles:Record<string,NavigationSceneV1>){
 const enc=new TextEncoder(),rt={paired:true,engineeringManifest:async(digest:string)=>{if(!bundles[digest])throw new Error('BUNDLE_NOT_FOUND');return {files:[{path:'navigation-scene.json',sha256:digest}]};},
  engineeringBlob:async(sha:string)=>enc.encode(JSON.stringify(bundles[sha]))} as unknown as TwinRuntime;
 const w=new TwinWorkspace(()=>{},rt),h=w as unknown as {frame():{navigation:NavigationSceneV1|null}};workspaces.push(w);
 const r=report({navigation2d:{...evidence(),sceneDigest:scene.sceneDigest}});r.manifest.engineering={bundleDigest:BUNDLE,projectDigest:D('3')};
 const saved=captureEvidence(r,structuredClone(project) as never);Object.assign(w,{saved:[saved]});w.click('twin-open-evidence',saved.id);
 return {w,h};
}
test('IR-SIM run in 3D: layer provenance and the 2D-only reason are in the Display menu, plus the app honesty notes',async()=>{
 const {w,h}=irsim({[BUNDLE]:scene});
 await vi.waitFor(()=>expect(h.frame().navigation?.sceneDigest).toBe(scene.sceneDigest));
 w.click('twin-view','3d');
 const html=w.html(),menu=displayMenu(html);
 for(const id of ['layer-provenance','layers-2d-only','twin-legend','honesty-notes']){expect(count(html,id),id).toBe(1);expect(count(menu,id),`${id} in the Display menu`).toBe(1);}
 expect(menu).toContain('hardware unvalidated');expect(menu).toContain('business simulation only');
});
test('IR-SIM run whose scene is gone: the unavailable reason is in the Display menu',async()=>{
 const {w}=irsim({});
 await new Promise(r=>setTimeout(r,10));
 const html=w.html();
 expect(count(html,'navigation-scene-unavailable')).toBe(1);
 expect(displayMenu(html)).toContain('data-testid="navigation-scene-unavailable"');expect(displayMenu(html)).toContain('NAVIGATION_SCENE_UNAVAILABLE');
});
test('a run with attention: the attention chain is in the problems box, after its rows',()=>{
 const w=new TwinWorkspace(()=>{},{paired:false} as TwinRuntime);workspaces.push(w);
 const fixture=coffeeReplay();fixture.view.run.status='needs_attention';fixture.view.attention=[{reason:'CUP_REMOVED',subjectId:'coffee-job-1',tick:250}];
 Object.assign(w,fixture,{runPreset:presetById('coffee')});
 const html=w.html();
 expect(count(html,'attention-reason')).toBe(1);
 const box=problemsBox(html);expect(box).toContain('data-testid="attention-reason"');expect(box).toContain('CUP_REMOVED');
 expect(box.indexOf('data-testid="problem-row"')).toBeLessThan(box.indexOf('attention-reason'));
});
test('WebGL failed: the 2D fallback note is in the viewport overlay',()=>{
 const w=new TwinWorkspace(()=>{},{paired:false} as TwinRuntime);workspaces.push(w);
 Object.assign(w,{webglFailed:true});
 const html=w.html();
 expect(count(html,'twin-fallback-note')).toBe(1);expect(overlay(html)).toContain('data-testid="twin-fallback-note"');
});
test('a saved report opened without a runtime: no pairing problem, no count, no NOT_PAIRED in the strip',()=>{
 const w=new TwinWorkspace(()=>{},{paired:false} as TwinRuntime);workspaces.push(w);
 const {report}=coffeeReplay(),saved=captureEvidence(report,structuredClone(presetById('coffee')!.project));
 Object.assign(w,{saved:[saved]});w.click('twin-open-evidence',saved.id);
 const html=w.html();
 expect(html).toContain('data-testid="run-status"');expect(html).not.toContain('NOT_PAIRED');expect(count(html,'problems-count')).toBe(0);
});
