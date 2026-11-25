// Run controls follow the backend set's execution metadata from health: mock keeps step/auto-run, simulation with a source fixed-step clock gets step and
// pacing, native simulation keeps its native controls only. The IR-SIM set is selectable only when health says its provider is live.
import {expect,test,vi} from 'vitest';
vi.hoisted(()=>{(globalThis as Record<string,unknown>).localStorage={getItem:()=>'en',setItem:()=>{}};});
import {clockControls,type RunView,type TwinHealth} from '../../src/scenarios/controls';
import {backendSetOptions} from '../../src/scenarios/support';
import {preflight} from '../../src/scenarios/preflight';
import {presetById} from '../../src/scenarios/catalog';

const IR='engineering-irsim-2d-v1';
const backend=(id:string,live:boolean)=>({id,modes:['simulation'],installed:live,compatible:live,reachable:live,commissioned:true,enabled:live,...live?{}:{reason:'IRSIM_DISABLED: not configured'}});
const health=(live:boolean,capabilities=live?['engineering_bundle_v1','irsim_navigation_v1']:['engineering_bundle_v1']):TwinHealth=>({protocolMajors:[1,2],sourceCommit:'a'.repeat(40),schemaHash:'b'.repeat(64),scenarioIds:['FD01','BV01','IR-FD01'],features:{readiness:true},capabilities,
 backends:[{id:'mock_amr',modes:['mock'],installed:true,compatible:true,reachable:true,commissioned:true,enabled:true},backend('gazebo_nav2',false),backend('irsim_2d',live)],
 backendSets:[{id:'mock-amr',mode:'mock',access:'simulated',backends:['mock_amr']},{id:'coffee-simulation',mode:'simulation',access:'simulated',backends:['gazebo_nav2']},
  {id:IR,mode:'simulation',access:'simulated',backends:['irsim_2d'],execution:{host:'portable_python',clock:'source_fixed_step',manualStep:false,speedMultipliers:[1,4,16,64]}}]});
const view=(mode:'mock'|'simulation',backendSetId:string,status:RunView['run']['status']='running'):RunView=>({run:{schemaVersion:2,id:'r',mode,access:'simulated',backendSetId,backends:[],status,runRevision:1,eventCursor:null,telemetryCursor:null,fidelity:'modeled',ageMs:0,sourceCommit:'a',scenarioId:'IR-FD01',scenarioRevision:1,seed:1},
 tick:0,simTimeNs:'0',model:'m',entities:[],workload:[],awaiting:[],attention:[],served:'0',coffee:null});

test('mock keeps step and auto-run at the Lab pacing (unchanged)',()=>{
 expect(clockControls(view('mock','mock-amr'),health(true))).toEqual({clock:'mock',step:true,play:true,speeds:[1,4,16,64]});
 expect(clockControls(view('mock','mock-amr','paused'),health(true))).toMatchObject({step:false,play:false});
});
test('simulation + source_fixed_step: step and pacing from the set metadata; no step while paused unless manualStep',()=>{
 expect(clockControls(view('simulation',IR),health(true))).toEqual({clock:'source_fixed_step',step:true,play:true,speeds:[1,4,16,64]});
 expect(clockControls(view('simulation',IR,'paused'),health(true))).toMatchObject({step:false,play:false});
 const manual=health(true);manual.backendSets[2]!.execution={...manual.backendSets[2]!.execution!,manualStep:true,speedMultipliers:[1,4]};
 expect(clockControls(view('simulation',IR,'paused'),manual)).toEqual({clock:'source_fixed_step',step:true,play:false,speeds:[1,4]});
});
test('simulation + native (or no metadata): native controls only, never a Lab step',()=>{
 expect(clockControls(view('simulation','coffee-simulation'),health(true))).toEqual({clock:'native',step:false,play:false,speeds:[]});
 const native=health(true);native.backendSets[1]!.execution={host:'linux_native',clock:'native',manualStep:false,speedMultipliers:[]};
 expect(clockControls(view('simulation','coffee-simulation'),native)).toMatchObject({clock:'native',step:false,play:false});
 // a set the health no longer lists is unknown: no step either
 expect(clockControls(view('simulation',IR),null)).toMatchObject({clock:'native',step:false,play:false});
});
test('the IR-SIM set is selectable only when health says irsim_2d is live and irsim_navigation_v1 is advertised; others keep their behaviour',()=>{
 const on=backendSetOptions(health(true)),off=backendSetOptions(health(false));
 expect(on.find(o=>o.id===IR)).toMatchObject({selectable:true,reasons:[]});
 expect(off.find(o=>o.id===IR)).toMatchObject({selectable:false,reasons:['BACKEND_NOT_INSTALLED:irsim_2d (IRSIM_DISABLED: not configured)','CAPABILITY_MISSING:irsim_navigation_v1']});
 // advertised capability but a backend that is not reachable: still not selectable (never guessed from one field)
 const half=health(true);half.backends[2]={...half.backends[2]!,reachable:false};
 expect(backendSetOptions(half).find(o=>o.id===IR)).toMatchObject({selectable:false,reasons:['BACKEND_UNREACHABLE:irsim_2d']});
 for(const o of [on,off])expect(o.filter(x=>x.id!==IR).map(x=>[x.id,x.selectable])).toEqual([['mock-amr',true],['coffee-simulation',true]]);
 expect(backendSetOptions(null)).toEqual([]);
});
test('the IR preset never runs without a compiled Serve design for exactly this draft',()=>{
 const p=presetById('irsim-fd01')!;
 expect(p).toMatchObject({mode:'simulation',backendSetId:IR,scenarioId:'IR-FD01'});
 const c=preflight(p,health(true),true).find(x=>x.id==='engineering')!;
 expect(c.ok).toBe(false);expect(c.detail).toContain('ENGINEERING_NOT_COMPILED');
});
