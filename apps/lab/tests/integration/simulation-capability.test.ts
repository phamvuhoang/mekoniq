// SIM-10 / UX-19: the Lab reads what a simulation can run from the runtime's health/capability answer; it never hardcodes "available".
// The campaign fixture names the scenarios and the backend set each needs; support rows carry the runtime's own reasons.
import {existsSync,readFileSync} from 'node:fs';
import {expect,test,vi} from 'vitest';
import campaign from '../../fixtures/scenarios/food-beverage-campaign.json';
import compatibility from '../../config/simulation-compatibility.json';
import {supportMatrix,type CampaignFixture} from '../../src/scenarios/support';
import type {TwinHealth} from '../../src/scenarios/controls';
vi.stubGlobal('localStorage',{getItem:()=>'en',setItem:()=>{}}); // catalog/preflight copy is localized; the locale store is browser-only
const {preflight}=await import('../../src/scenarios/preflight');
const {presets}=await import('../../src/scenarios/catalog');
const fixture=campaign as CampaignFixture;
const backend=(id:string,modes:string[],installed:boolean,enabled:boolean,reason?:string)=>({id,modes,installed,compatible:installed,reachable:installed,commissioned:true,enabled,...reason?{reason}:{}});
const health=(simInstalled:boolean):TwinHealth=>({protocolMajors:[1,2],sourceCommit:'c'.repeat(40),schemaHash:'s'.repeat(64),scenarioIds:['FD01','FD07','FD02','BV01','CAMPAIGN-FD02-FD07-BV01-BV03'],
 backends:[backend('mock_amr',['mock'],true,true),backend('mock_coffee',['mock'],true,true),backend('mock_arm',['mock'],true,true),
  backend('gazebo_nav2',['simulation'],simInstalled,simInstalled,simInstalled?undefined:'Simulation provider package is not installed on this host'),backend('linuxcnc_sim',['simulation'],simInstalled,simInstalled,simInstalled?undefined:'Simulation provider package is not installed on this host'),backend('coffee_io_sim',['simulation'],simInstalled,simInstalled,simInstalled?undefined:'Simulation provider package is not installed on this host')],
 backendSets:[{id:'mock-amr',mode:'mock',access:'simulated',backends:['mock_amr']},{id:'mock-default',mode:'mock',access:'simulated',backends:['mock_amr','mock_coffee','mock_arm']},{id:'simulation-default',mode:'simulation',access:'simulated',backends:['gazebo_nav2','linuxcnc_sim','coffee_io_sim']},{id:'coffee-simulation',mode:'simulation',access:'simulated',backends:['gazebo_nav2','linuxcnc_sim','coffee_io_sim']}]});

test('the campaign fixture names registry scenarios and backend sets the runtime offers; it equals the source copy when the sibling exists',()=>{
 expect(fixture.scenarios.map(s=>s.id)).toEqual(['FD02','FD07','BV01','CAMPAIGN-FD02-FD07-BV01-BV03']);
 const known=new Set((compatibility as {scenarios:{id:string}[]}).scenarios.map(s=>s.id));
 for(const s of fixture.scenarios){expect(known.has(s.id)).toBe(true);expect(s.repeat).toBeGreaterThanOrEqual(3);expect(s.simulation.requires.length).toBeGreaterThan(0);}
 const sibling='../source/tests/fixtures/digital-twin/campaigns/food-beverage.json';
 if(existsSync(sibling))expect(JSON.parse(readFileSync(sibling,'utf8'))).toEqual(fixture);
});

test('support rows come from health: not installed is unavailable with the runtime reason, installed is available, no runtime is unknown',()=>{
 const off=supportMatrix(health(false),fixture);
 expect(off.map(r=>[r.scenarioId,r.mode,r.status])).toEqual([['FD02','mock','available'],['FD02','simulation','unavailable'],['FD07','mock','available'],['FD07','simulation','unavailable'],['BV01','mock','available'],['BV01','simulation','unavailable'],['CAMPAIGN-FD02-FD07-BV01-BV03','mock','available'],['CAMPAIGN-FD02-FD07-BV01-BV03','simulation','unavailable']]);
 for(const i of [1,3])expect(off[i]!.reasons).toEqual(['BACKEND_NOT_INSTALLED:gazebo_nav2 (Simulation provider package is not installed on this host)']); // FD02/FD07 runner scenarios need the AMR backend only
 for(const i of [5,7])expect(off[i]!.reasons).toEqual(['BACKEND_NOT_INSTALLED:gazebo_nav2 (Simulation provider package is not installed on this host)','BACKEND_NOT_INSTALLED:linuxcnc_sim (Simulation provider package is not installed on this host)','BACKEND_NOT_INSTALLED:coffee_io_sim (Simulation provider package is not installed on this host)']);
 const on=supportMatrix(health(true),fixture);
 expect(on.every(r=>r.status==='available')).toBe(true);
 expect(supportMatrix(null,fixture).every(r=>r.status==='unknown'&&r.reasons[0]==='RUNTIME_UNREACHABLE')).toBe(true);
 const h=health(true);h.scenarioIds=h.scenarioIds.filter(id=>id!=='BV01');
 expect(supportMatrix(h,fixture).find(r=>r.scenarioId==='BV01'&&r.mode==='mock')).toMatchObject({status:'unavailable',reasons:['SCENARIO_NOT_OFFERED']});
 const noSet={...health(true),backendSets:health(true).backendSets.filter(s=>s.id!=='coffee-simulation')};
 expect(supportMatrix(noSet,fixture).find(r=>r.scenarioId==='BV01'&&r.mode==='simulation')).toMatchObject({status:'unavailable',reasons:['BACKEND_SET_UNKNOWN:coffee-simulation']});
 const disabled=health(true);disabled.backends.find(b=>b.id==='linuxcnc_sim')!.enabled=false;
 expect(supportMatrix(disabled,fixture).find(r=>r.scenarioId==='BV01'&&r.mode==='simulation')!.reasons).toEqual(['BACKEND_NOT_ENABLED:linuxcnc_sim']);
});

test('preflight of a simulation preset fails the backend check with the runtime reason instead of claiming availability',()=>{
 const preset={...presets[0]!,backendSetId:'coffee-simulation'};
 const checks=preflight(preset,health(false),true);
 const b=checks.find(c=>c.id==='backend')!;
 expect(b.ok).toBe(false);expect(b.detail).toContain('gazebo_nav2');expect(b.detail).toContain('not installed');
 expect(preflight({...presets[0]!,backendSetId:'mock-default'},health(false),true).find(c=>c.id==='backend')!.ok).toBe(true);
});
