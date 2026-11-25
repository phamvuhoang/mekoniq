import {expect,test,vi} from 'vitest';
vi.mock('../../src/i18n',()=>({tr:(vi:string)=>vi}));
import {preflight} from '../../src/scenarios/preflight';
import {presetById} from '../../src/scenarios/catalog';
import {requestForPreset,type TwinHealth} from '../../src/scenarios/controls';
test('explicit native preset keeps simulation mode and requires matching runtime readiness',()=>{
 const p={...presetById('coffee')!,mode:'simulation' as const,backendSetId:'coffee-simulation'};
 expect(requestForPreset(p)).toMatchObject({mode:'simulation',backendSetId:'coffee-simulation',access:'simulated'});
 const health:TwinHealth={protocolMajors:[2],sourceCommit:'x',schemaHash:'s',scenarioIds:['BV01'],backends:[],backendSets:[{id:'coffee-simulation',mode:'simulation',access:'simulated',backends:[]}],features:{readiness:true}};
 expect(preflight(p,health,true).find(c=>c.id==='backend')?.ok).toBe(true);expect(preflight(p,health,true).find(c=>c.id==='readiness')?.ok).toBe(false);
 expect(preflight({...p,mode:'mock'},health,true).find(c=>c.id==='backend')?.ok).toBe(false);
});
test('changing the backend environment renders the completed readiness response',async()=>{
 vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('innerWidth',600);
 const {TwinWorkspace}=await import('../../src/ui/workspace');
 let resolve!:(v:import('../../src/scenarios/controls').ReadinessSnapshot)=>void;const rendered=vi.fn();
 const w=new TwinWorkspace(rendered,{paired:true,readiness:()=>new Promise(r=>{resolve=r;})} as unknown as import('../../src/scenarios/controls').TwinRuntime);
 Object.assign(w,{health:{features:{readiness:true},backendSets:[{id:'coffee-simulation',mode:'simulation',access:'simulated',backends:[]}]}});
 w.change('twin-backend-set','coffee-simulation');rendered.mockClear();
 resolve({scenarioId:'BV01',backendSetId:'coffee-simulation',checkedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+30000).toISOString(),checks:[],canStart:true});
 await vi.waitFor(()=>expect(rendered).toHaveBeenCalled());w.leave();vi.unstubAllGlobals();
});
test('native controls never issue mock step or auto-run actions',async()=>{
 vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('innerWidth',600);
 const {TwinWorkspace}=await import('../../src/ui/workspace');const {coffeeReplay}=await import('../support/coffee-replay');const {runControls}=await import('../../src/ui/operations-panel');const {transportBar}=await import('../../src/ui/transport');
 const {view}=coffeeReplay();view.run.mode='simulation';view.run.status='running';const act=vi.fn();
 const w=new TwinWorkspace(()=>{},{paired:true} as unknown as import('../../src/scenarios/controls').TwinRuntime);Object.assign(w,{view,act});
 w.click('twin-step');w.click('twin-play');await Promise.resolve();expect(act).not.toHaveBeenCalled();
 const html=transportBar({mode:'live',playing:false,...runControls({paired:true,ready:true,busy:false,playing:false,view,preset:presetById('coffee')!}),speeds:[1],speed:1,simTimeS:0,tick:0});
 expect(html).toMatch(/data-action="twin-step"[^>]*disabled/);expect(html).toMatch(/data-action="twin-play"[^>]*disabled/);w.leave();vi.unstubAllGlobals();
});
