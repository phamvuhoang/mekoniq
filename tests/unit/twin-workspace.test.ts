import {expect,test,vi} from 'vitest';
vi.stubGlobal('localStorage',{getItem:()=>'en',setItem:()=>{}});
const {presets,presetById}=await import('../../src/scenarios/catalog');
const {renderTwin,sceneEntities}=await import('../../src/twin/scene');
const {defaultLayers,toggleLayer,legend}=await import('../../src/twin/overlays');
const {selectEntity,selectedEntity,onSelection}=await import('../../src/twin/selection');
const {inspect,identityItems}=await import('../../src/twin/inspector');
const {preflight,ready}=await import('../../src/scenarios/preflight');
const {explain,qty,currentCup,reconcilable}=await import('../../src/twin/coffee-cell');
const {nextAction}=await import('../../src/ui/operations-panel');
import type {RunView,RunReport,TwinHealth} from '../../src/scenarios/controls';
const coffee=presetById('coffee')!;
const view=(o:Partial<RunView>={}):RunView=>({run:{schemaVersion:2,id:'r1',mode:'mock',access:'simulated',backendSetId:'mock-default',backends:['mock_amr','mock_coffee','mock_arm'],status:'running',runRevision:3,eventCursor:null,telemetryCursor:null,fidelity:'modeled',ageMs:0,sourceCommit:'d'.repeat(40),scenarioId:'BV01',scenarioRevision:1,seed:42},
 tick:250,simTimeNs:'5000000000',model:'mock_kinematic',entities:[{id:'amr-1',kind:'amr',pose:{x:0.8,y:0.8,yawRad:0},quality:'valid',moving:true,hold:null,goal:{commandId:'robot-command-abc',state:'executing'},path:[[2,0.8],[3,1]],distanceM:1.2}],
 workload:[],awaiting:[],attention:[],served:'0',coffee:{jobs:[{jobId:'coffee-job-1',status:'dispensing',recipeId:'espresso',cupId:'cup-1',attentionReason:null}],cups:[{cupId:'cup-1',ownerKind:'cell',ownerId:'coffee-1'}]},...o});
const health:TwinHealth={protocolMajors:[1,2],sourceCommit:'d'.repeat(40),schemaHash:'a'.repeat(64),scenarioIds:['FD01','FD07','BV01'],
 backends:['mock_amr','mock_coffee','mock_arm'].map(id=>({id,modes:['mock'],installed:true,compatible:true,reachable:true,commissioned:true,enabled:true})),backendSets:[{id:'mock-default',mode:'mock',access:'simulated',backends:['mock_amr','mock_coffee','mock_arm']},{id:'mock-amr',mode:'mock',access:'simulated',backends:['mock_amr']}]};
test('renderTwin is read-only and marks the shared selection',()=>{
 const f={preset:coffee,view:view(),report:null},before=JSON.stringify(f);
 const svg=renderTwin(f,{view:'2d',layers:defaultLayers(),selected:'cup-1'});
 expect(JSON.stringify(f)).toBe(before);
 expect(svg).toContain('data-entity="cup-1" data-selected="true"');
 expect(svg).toContain('data-entity="amr-1" data-selected="false"');
});
test('layers toggle overlays and the legend names modeled, observed and unknown',()=>{
 const f={preset:coffee,view:view(),report:null},on=defaultLayers();
 expect(renderTwin(f,{view:'2d',layers:on,selected:null})).toContain('class="tw-path"');
 expect(renderTwin(f,{view:'2d',layers:toggleLayer(on,'path'),selected:null})).not.toContain('class="tw-path"');
 expect(renderTwin(f,{view:'2d',layers:{...on,frames:true},selected:null})).toContain('amr-1/base_link');
 expect(legend().map(l=>l.id)).toEqual(expect.arrayContaining(['modeled','observed','unknown']));
});
test('footprint and contacts become unknown when the runtime ran a point model',()=>{
 const report={manifest:{clock:{tickMs:20},assets:[{...coffee.project.entities[0]!.assetRef,resolved:false}]},metrics:{collision:{available:false,reason:'GEOMETRY_UNKNOWN',contacts:null,minSeparationM:null}}} as unknown as RunReport;
 const svg=renderTwin({preset:coffee,view:view(),report},{view:'2d',layers:{...defaultLayers(),contacts:true},selected:null});
 expect(svg).toContain('tw-footprint unknown');
 expect(svg).toContain('? (GEOMETRY_UNKNOWN)');
 expect(svg).not.toMatch(/Contacts: 0/);
});
test('one selection is shared by every subscriber',()=>{
 const seen:(string|null)[]=[];const off=onSelection(id=>seen.push(id));
 selectEntity('amr-1');selectEntity('amr-1');selectEntity('cup-1');off();selectEntity(null);
 expect(seen).toEqual(['amr-1','cup-1']);expect(selectedEntity()).toBeNull();
});
test('inspector separates observed from commanded, keeps units and leaves unknown unknown',()=>{
 const f={preset:coffee,view:view(),report:null};
 const amr=inspect(f,'amr-1')!;
 expect(amr.rows.find(r=>r.key==='pose-x')).toMatchObject({observed:'0.80',commanded:'3.00',unit:'m',source:'observed',ageMs:0});
 expect(amr.rows.find(r=>r.key==='lidar')!.source).toBe('unknown');
 const arm=inspect(f,'arm-1')!;
 expect(arm.rows.find(r=>r.key==='joint-1')).toMatchObject({unit:'rad',source:'unknown',ageMs:null});
 const withTrace={...f,report:{manifest:{clock:{tickMs:20},assets:[]},coffee:{jobs:[],cups:[],armTrace:{tag:'mock',interpolation:'x',modelRevision:'1',limitsOk:true,samples:[{tick:240,q:[0.5,0,0,0,0,0],tcp:[0.1,0.2,0.3]}]}}} as unknown as RunReport};
 expect(inspect(withTrace,'arm-1')!.rows.find(r=>r.key==='joint-1')).toMatchObject({commanded:'0.500 (28.6°)',ageMs:200,source:'commanded'});
 expect(inspect(f,'cup-1',{'cup-1:cell:coffee-1':200})!.rows[0]).toMatchObject({observed:'Coffee cell (cell)',ageMs:1000});
});
test('quantities display in mL / g from canonical SI strings',()=>{
 expect(qty({amount:'0.00003',unit:'m3',provenance:'illustrative',tolerance:'0.000003'})).toEqual({text:'30.0 ± 3.0',unit:'mL'});
 expect(qty({amount:'0.12',unit:'kg',provenance:'modelled'})).toEqual({text:'120.0',unit:'g'});
 expect(qty(null)).toEqual({text:'—',unit:''});
});
test('preflight names the missing entity and the disabled backend',()=>{
 expect(ready(preflight(coffee,health,true))).toBe(true);
 const noArm={...coffee,project:{...coffee.project,entities:coffee.project.entities.filter(e=>e.kind!=='arm')}};
 expect(preflight(noArm,health,true).find(c=>c.id==='entity-arm')).toMatchObject({ok:false});
 const off={...health,backends:health.backends.map(b=>b.id==='mock_arm'?{...b,enabled:false,reason:'switched off'}:b)};
 expect(preflight(coffee,off,true).find(c=>c.id==='backend')).toMatchObject({ok:false,detail:expect.stringContaining('mock_arm (switched off)')});
 expect(ready(preflight(coffee,null,false))).toBe(false);
});
test('missing cup: explained chain, affected entities, reconcile then rerun as next actions',()=>{
 const a={reason:'CUP_REMOVED',subjectId:'coffee-job-1',tick:250};
 expect(explain(a)).toMatchObject({entities:['coffee-job-1','cup-1'],observed:expect.stringContaining('no cup')});
 const held=view({run:{...view().run,status:'needs_attention'},attention:[a],coffee:{jobs:[{jobId:'coffee-job-1',status:'needs_attention',recipeId:'espresso',cupId:'cup-1',attentionReason:'CUP_REMOVED'}],cups:[{cupId:'cup-1',ownerKind:'cell',ownerId:'coffee-1'}]}});
 expect(reconcilable(a,held)).toBe(true);
 const base={paired:true,ready:true,busy:false,playing:false,preset:coffee};
 expect(nextAction({...base,view:held}).action?.id).toBe('twin-reconcile');
 const quarantined={...held,coffee:{...held.coffee!,jobs:[{...held.coffee!.jobs[0]!,status:'quarantined'}]}};
 expect(nextAction({...base,view:quarantined}).action?.id).toBe('twin-rerun');
 expect(nextAction({...base,view:null}).action?.id).toBe('twin-run');
 expect(nextAction({...base,paired:false,view:null}).action).toBeUndefined();
});
test('current cup follows the first unfinished job, then the last cup',()=>{
 expect(currentCup(view())!.cupId).toBe('cup-1');
 const done=view({coffee:{jobs:[{jobId:'coffee-job-1',status:'delivered',recipeId:'espresso',cupId:'cup-1',attentionReason:null},{jobId:'coffee-job-2',status:'delivered',recipeId:'iced-milk-coffee',cupId:'cup-2',attentionReason:null}],cups:[{cupId:'cup-1',ownerKind:'customer',ownerId:'table-1'},{cupId:'cup-2',ownerKind:'customer',ownerId:'table-1'}]}});
 expect(currentCup(done)!.cupId).toBe('cup-2');
 expect(presets.map(p=>p.backendSetId)).toEqual(['mock-default','mock-amr','mock-default','mock-default','coffee-simulation','engineering-irsim-2d-v1','engineering-irsim-2d-v1','engineering-webots-3d-v1','engineering-webots-3d-v1','engineering-webots-arm-v1','engineering-mujoco-arm-v1','engineering-mujoco-3d-v1','engineering-mujoco-cell-v1']);
});
test('locked identity shows recipe and project revisions as the runtime reported them, never preset constants',()=>{
 const report={manifest:{clock:{tickMs:20},assets:[],backends:[{id:'mock_amr',version:'1',model:'m',dynamics:false}],project:{id:'runtime-project',revision:7,hash:'h'},world:{id:'w',revision:4,hash:'h'}},
  coffee:{jobs:[{jobId:'coffee-job-1',recipeId:'espresso',recipeRevision:3,status:'dispensing',steps:[]},{jobId:'coffee-job-2',recipeId:'espresso',recipeRevision:3,status:'reserved',steps:[]}],cups:[],armTrace:{samples:[]}}} as unknown as RunReport;
 const items=identityItems(view(),report);
 expect(items).toContain('recipe espresso r3');
 expect(items).toContain('project runtime-project r7');
 expect(items).toContain('world r4');
 expect(items.join(' ')).not.toContain('iced-milk-coffee r1');
 // no report yet: unknown, not the preset's values
 expect(identityItems(view(),null)).toEqual(expect.arrayContaining(['recipe ?','project ?','world ?']));
 expect(identityItems(view({coffee:null}),null).some(x=>x.startsWith('recipe'))).toBe(false);
});
