import {expect,test,vi} from 'vitest';
vi.stubGlobal('localStorage',{getItem:()=>'en',setItem:()=>{}});
const {preflight,ready}=await import('../../src/scenarios/preflight');
const {presetById}=await import('../../src/scenarios/catalog');
const p=presetById('coffee')!;
const health={protocolMajors:[2],sourceCommit:'a'.repeat(40),schemaHash:'b'.repeat(64),scenarioIds:['BV01'],features:{readiness:true},backendSets:[{id:'mock-default',mode:'mock',access:'simulated',backends:['mock_amr','mock_coffee','mock_arm']}],backends:['mock_amr','mock_coffee','mock_arm'].map(id=>({id,modes:['mock'],installed:true,compatible:true,reachable:true,commissioned:true,enabled:true}))};
const snapshot={checkedAt:'2026-11-06T00:00:00Z',expiresAt:'2026-11-06T00:00:30Z',scenarioId:'BV01',backendSetId:'mock-default',checks:[{id:'runner',status:'ready' as const,reasonCodes:[],evidenceRef:null}],canStart:true};
const now=Date.parse('2026-11-06T00:00:10Z');
test('an advertised readiness API must answer before Start becomes available',()=>{expect(ready(preflight(p,health,true,null,now))).toBe(false);});
test('expired readiness and a response for another scenario cannot authorize Start',()=>{
 expect(ready(preflight(p,health,true,snapshot,now))).toBe(true);
 expect(ready(preflight(p,health,true,snapshot,now+30000))).toBe(false);
 expect(ready(preflight(p,health,true,{...snapshot,scenarioId:'FD01'},now))).toBe(false);
});
test('readiness explains unavailable probes rather than hiding them behind health',()=>{
 const checks=preflight(p,health,true,{...snapshot,canStart:false,checks:[{id:'probe:world',status:'blocked',reasonCodes:['WORLD_REVISION_MISMATCH'],evidenceRef:null}]},now);
 expect(checks.find(c=>c.id==='readiness')).toMatchObject({ok:false,detail:expect.stringContaining('WORLD_REVISION_MISMATCH')});
});
test('support matrix never calls an enabled but unreachable provider available',async()=>{
 const {supportMatrix}=await import('../../src/scenarios/support');
 const rows=supportMatrix({...health,backends:health.backends.map(b=>b.id==='mock_arm'?{...b,reachable:false}:b)},{schemaVersion:1,id:'coffee',revision:1,title:'Coffee',scenarios:[{id:'BV01',seed:1,repeat:1,mock:{backendSetId:'mock-default'},simulation:{backendSetId:'coffee-simulation',requires:['linuxcnc_sim']}}]});
 expect(rows.find(r=>r.mode==='mock')).toMatchObject({status:'unavailable',reasons:expect.arrayContaining(['BACKEND_UNREACHABLE:mock_arm'])});
});
test('the support matrix follows runtime scenario requirements rather than unused set members',async()=>{
 const {supportMatrix}=await import('../../src/scenarios/support');
 const h={...health,scenarioIds:['FD01'],scenarioRequirements:{FD01:{mock:['mock_amr'],simulation:['gazebo_nav2']}},backends:health.backends.map(b=>({...b,enabled:b.id==='mock_amr'}))};
 const rows=supportMatrix(h,{schemaVersion:1,id:'food',revision:1,title:'Food',scenarios:[{id:'FD01',seed:1,repeat:1,mock:{backendSetId:'mock-default'},simulation:{backendSetId:'simulation-default',requires:['gazebo_nav2']}}]});
 expect(rows.find(r=>r.mode==='mock')).toMatchObject({status:'available',reasons:[]});
});
test('C02 IR-SIM variants are simulation-only rows: no mock row is invented, and an older runtime that does not offer IR-FD07 says so',async()=>{
 const {supportMatrix}=await import('../../src/scenarios/support');
 const entry={id:'IR-FD07',seed:7,repeat:1,simulation:{backendSetId:'engineering-irsim-2d-v1',requires:['irsim_2d']}};
 const irsim={id:'irsim_2d',installed:true,enabled:true,compatible:true,reachable:true,commissioned:true};
 const h={...health,scenarioIds:['IR-FD01','IR-FD07'],backendSets:[...health.backendSets,{id:'engineering-irsim-2d-v1',mode:'simulation',access:'simulated',backends:['irsim_2d']}],backends:[...health.backends,irsim]} as typeof health;
 const rows=supportMatrix(h,{schemaVersion:1,id:'irsim',revision:1,title:'IR',scenarios:[entry]});
 expect(rows).toEqual([{scenarioId:'IR-FD07',mode:'simulation',backendSetId:'engineering-irsim-2d-v1',status:'available',reasons:[]}]);
 const old=supportMatrix({...h,scenarioIds:['IR-FD01']} as typeof health,{schemaVersion:1,id:'irsim',revision:1,title:'IR',scenarios:[entry]});
 expect(old).toEqual([{scenarioId:'IR-FD07',mode:'simulation',backendSetId:'engineering-irsim-2d-v1',status:'unavailable',reasons:['SCENARIO_NOT_OFFERED']}]);
});
test('workspace renders an actionable refresh when readiness expires',async()=>{
 vi.stubGlobal('innerWidth',600);vi.stubGlobal('document',{getElementById:()=>null});
 const {TwinWorkspace}=await import('../../src/ui/workspace');
 const {coffeeReplay}=await import('../support/coffee-replay');const fixture=coffeeReplay();
 const w=new TwinWorkspace(()=>{},{paired:true,health:async()=>health,pair:async()=>{},forget(){},readiness:async()=>snapshot,create:async()=>fixture.view,action:async()=>fixture.view,get:async()=>fixture.view,report:async()=>fixture.report});
 await w.checkHealth();expect(w.html()).toContain('data-action="twin-readiness"');w.leave();
});
test('reset ready runs refresh their locked inputs and remove Start at readiness expiry',async()=>{
 vi.useFakeTimers();vi.setSystemTime(now);
 vi.stubGlobal('innerWidth',600);vi.stubGlobal('document',{getElementById:()=>null});
 const {TwinWorkspace}=await import('../../src/ui/workspace');
 const {coffeeReplay}=await import('../support/coffee-replay');const fixture=coffeeReplay();
 const locked={...p,project:structuredClone(p.project)};locked.project.revision=7;
 const readyView={...fixture.view,run:{...fixture.view.run,status:'ready' as const},tick:0,simTimeNs:'0'};
 const requested:{scenarioId:string;revision:number}[]=[];let rendered='';
 const w=new TwinWorkspace(()=>{rendered=w.html();},{paired:true,health:async()=>health,pair:async()=>{},forget(){},readiness:async(scenarioId,_set,project)=>{requested.push({scenarioId,revision:project!.revision});return {...snapshot,scenarioId,checkedAt:new Date(Date.now()).toISOString(),expiresAt:new Date(Date.now()+1000).toISOString()};},create:async()=>readyView,action:async()=>readyView,get:async()=>readyView,report:async()=>fixture.report});
 const state=w as unknown as {view:typeof fixture.view;runPreset:typeof p;busy:boolean};
 Object.assign(state,{view:fixture.view,runPreset:locked,openStreams:()=>{}});
 try{
  await w.checkHealth();w.click('twin-reset');
  await vi.waitFor(()=>expect(state.busy).toBe(false));
  expect(rendered).toContain('data-action="twin-start"');
  expect(rendered).toContain('data-action="twin-readiness"');
  await vi.advanceTimersByTimeAsync(1000);
  expect(rendered).not.toContain('data-action="twin-start"');
  expect(rendered).toContain('READINESS_EXPIRED');
  expect(rendered).toContain('data-action="twin-readiness"');
  w.click('twin-preset','delivery');await vi.waitFor(()=>expect(state.busy).toBe(false));
  w.click('twin-readiness');await vi.waitFor(()=>expect(state.busy).toBe(false));
  expect(requested.at(-1)).toEqual({scenarioId:'BV01',revision:7});
  expect(rendered).toContain('data-action="twin-start"');
 }finally{w.leave();vi.useRealTimers();}
});
test('C02 fix pass F11: the IR-FD07 preset says in VI/JA/EN that the source moves one robot at a time and that the zone and the customer are not drawn by the Lab',async()=>{
 vi.stubGlobal('document',{documentElement:{}});const {presetById}=await import('../../src/scenarios/catalog');const {setLocale}=await import('../../src/i18n');
 const p=presetById('irsim-fd07')!,texts:Record<string,string>={};
 for(const l of ['vi','ja','en'] as const){setLocale(l);texts[l]=p.summary();}
 setLocale('en');
 expect(texts.en).toMatch(/one robot at a time.*server-side only and not drawn here/);
 expect(texts.vi).toMatch(/lần lượt từng robot.*không vẽ ở đây/);expect(texts.ja).toMatch(/1台ずつ.*描画されない/);
 expect(new Set(Object.values(texts)).size).toBe(3);
});
