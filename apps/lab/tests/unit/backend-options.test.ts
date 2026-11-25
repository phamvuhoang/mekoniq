// The run selector offers a portable set only when health says its provider is live and advertises the capability that provider needs; the table is per provider.
import {expect,test,vi} from 'vitest';
vi.hoisted(()=>{(globalThis as Record<string,unknown>).localStorage={getItem:()=>'en',setItem:()=>{}};});
import type {TwinHealth} from '../../src/scenarios/controls';
import {backendSetOptions} from '../../src/scenarios/support';

const IR='engineering-irsim-2d-v1',WB='engineering-webots-3d-v1';
const backend=(id:string,live:boolean)=>({id,modes:['simulation'],installed:live,compatible:live,reachable:live,commissioned:true,enabled:live,...live?{}:{reason:'DISABLED: not configured'}});
const execution={host:'portable_python' as const,clock:'source_fixed_step' as const,manualStep:false,speedMultipliers:[1,4,16,64]};
const health=(o:{webots?:'absent'|'off'|'live';ir?:boolean;capabilities?:string[]}={}):TwinHealth=>({protocolMajors:[1,2],sourceCommit:'a'.repeat(40),schemaHash:'b'.repeat(64),scenarioIds:['FD01','IR-FD01','WB-FD01'],features:{readiness:true},
 capabilities:o.capabilities??['engineering_bundle_v1',...o.ir?['irsim_navigation_v1']:[],...o.webots==='live'?['sim3d_navigation_v1']:[]],
 backends:[{id:'mock_amr',modes:['mock'],installed:true,compatible:true,reachable:true,commissioned:true,enabled:true},backend('irsim_2d',!!o.ir),...o.webots==='absent'?[]:[backend('webots_3d',o.webots==='live')]],
 backendSets:[{id:'mock-amr',mode:'mock',access:'simulated',backends:['mock_amr']},{id:IR,mode:'simulation',access:'simulated',backends:['irsim_2d'],execution},...o.webots==='absent'?[]:[{id:WB,mode:'simulation',access:'simulated',backends:['webots_3d'],execution}]]});
const pick=(h:TwinHealth,id:string)=>backendSetOptions(h).find(o=>o.id===id);

test('a runtime that predates Webots lists no Webots set, and the IR-SIM and mock options are exactly what they were',()=>{
 const h=health({webots:'absent',ir:true});
 expect(backendSetOptions(h)).toEqual([{id:'mock-amr',mode:'mock',selectable:true,reasons:[]},{id:IR,mode:'simulation',selectable:true,reasons:[]}]);
});
test('the Webots set needs webots_3d live and sim3d_navigation_v1; its reasons name that capability, not the IR-SIM one',()=>{
 expect(pick(health({webots:'live'}),WB)).toMatchObject({selectable:true,reasons:[]});
 expect(pick(health({webots:'off'}),WB)).toMatchObject({selectable:false,reasons:['BACKEND_NOT_INSTALLED:webots_3d (DISABLED: not configured)','CAPABILITY_MISSING:sim3d_navigation_v1']});
 // live backend, capability not advertised: still locked, with exactly that reason
 expect(pick(health({webots:'live',capabilities:['engineering_bundle_v1']}),WB)).toMatchObject({selectable:false,reasons:['CAPABILITY_MISSING:sim3d_navigation_v1']});
 // never read from the other provider's capability
 expect(pick(health({webots:'live',capabilities:['engineering_bundle_v1','irsim_navigation_v1']}),WB)?.reasons).toEqual(['CAPABILITY_MISSING:sim3d_navigation_v1']);
});
test('the IR-SIM set is not unlocked by Webots capability and the two providers are independent',()=>{
 const h=health({webots:'live',ir:false});
 expect(pick(h,IR)).toMatchObject({selectable:false,reasons:['BACKEND_NOT_INSTALLED:irsim_2d (DISABLED: not configured)','CAPABILITY_MISSING:irsim_navigation_v1']});
 expect(pick(h,WB)).toMatchObject({selectable:true});
});
