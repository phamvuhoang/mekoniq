import {expect,test} from 'vitest';
import {readFileSync} from 'node:fs';
import {createRestaurantLab} from '../support/restaurant-lab';
import {eligibleRobots} from '../../packages/domain/src/fleet/admission';
import type {JsonObject} from '../../packages/contracts/src/index';
const baseline=JSON.parse(readFileSync(new URL('../fixtures/trial/site-baseline.json',import.meta.url),'utf8')) as JsonObject;
const demo=JSON.parse(readFileSync(new URL('../fixtures/trial/site-demo.json',import.meta.url),'utf8')) as JsonObject;
const clone=<T>(v:T):T=>structuredClone(v);
const kinds=async(lab:Awaited<ReturnType<typeof createRestaurantLab>>)=>new Set((await (await lab.getStore('coordinator')).snapshots(lab.scope)).map(s=>s.ref.kind));

test('trial import cannot replay runtime missions or billing state',async()=>{
 const lab=await createRestaurantLab();
 try {
  const before=await kinds(lab);
  const result=await lab.importTrial({points:{},robots:[],missions:[{id:1}],orders:[{id:1}]});
  expect(result.status).toBe('rejected');
  expect(result.report.rejectedFields).toEqual([{field:'missions',reason:'RUNTIME_STATE'},{field:'orders',reason:'RUNTIME_STATE'}]);
  expect(await lab.effectCount('robot.execute')).toBe(0);
  expect(await lab.count('CashRecorded')).toBe(0);
  expect(await kinds(lab)).toEqual(before);
  expect(await lab.count('TrialConfigurationImported')).toBe(0);
 } finally { await lab.close(); }
});

test('import is a manager command, dry-run creates nothing and apply needs the matching preview',async()=>{
 const lab=await createRestaurantLab();
 try {
  const input=clone(demo);
  expect((await lab.command('cashier','Trial.ImportPreview',{input})).status).toBe('rejected');
  expect((await lab.command('cashier','Trial.ImportApply',{input,previewHash:'x'})).status).toBe('rejected');
  const preview=await lab.command('manager','Trial.ImportPreview',{input});
  expect(preview.status).toBe('accepted');
  expect(preview.value).toMatchObject({status:'ready',liveEffects:'none'});
  expect(await lab.count('TrialConfigurationImported')).toBe(0);
  expect((await lab.command('manager','Trial.ImportApply',{input,previewHash:'0'.repeat(64)})).code).toBe('PREVIEW_CHANGED');
  expect((await lab.command('manager','Trial.ImportApply',{input})).code).toBe('PREVIEW_CHANGED');
  const changedInput=clone(input);changedInput.name='Other';
  expect((await lab.command('manager','Trial.ImportApply',{input:changedInput,previewHash:String(preview.value.previewHash)})).code).toBe('PREVIEW_CHANGED');
  expect(await lab.count('TrialConfigurationImported')).toBe(0);
 } finally { await lab.close(); }
});

test('baseline site imports points and robots, reports unmapped fields and maps nothing live',async()=>{
 const lab=await createRestaurantLab();
 try {
  const result=await lab.importTrial(clone(baseline));
  expect(result.status,JSON.stringify(result.report)).toBe('accepted');
  const report=result.report;
  expect(report.rejectedFields).toEqual([]);
  expect((report.unmappedFields as {field:string}[]).map(f=>f.field)).toEqual(expect.arrayContaining(['rev','trays','dishPoint','roles','featurePolicyVersion','serviceProfile','customerCancel','service','notes','payment']));
  expect(report.schema).toMatchObject({featurePolicyVersion:2,migrated:false});
  // baseline: every legacy flag off -> only the trial-service core; bussing follows busRobot=false
  expect((report.featurePlan as {enabled:string[]}).enabled.sort()).toEqual(['fleet','fulfillment','robot.delivery']);
  // kitchen/bar/dish become stations; the dock is a home point, never a station or table
  expect((await lab.state<JsonObject>('station','dish')).trialKind).toBe('dish');
  expect((await lab.state<JsonObject>('station','kitchen')).name).toBe('Bếp');
  expect((await (await lab.getStore('coordinator')).snapshots(lab.scope)).some(s=>s.ref.id==='D1'&&['station','table'].includes(s.ref.kind))).toBe(false);
  // the active configuration is untouched: importing never switches a feature
  expect((await lab.state<JsonObject>('configuration','applied')).revision).toBe(1);
  const robot=await lab.state<JsonObject>('robot','R1');
  expect(robot).toMatchObject({driver:'valetudo',validation:'integration_tested',chargingDock:'D1',bindings:{},capabilities:[]});
  expect(robot.mapRevision).toBeUndefined();
  expect(await lab.effectCount('robot.execute')).toBe(0);
  const live=await kinds(lab);
  for(const kind of ['mission','order','bill','session','payment','shift','robot-command'])expect(live.has(kind)).toBe(false);
 } finally { await lab.close(); }
});

test('legacy features map to independent keys; old schema migrates, current schema is taken as is',async()=>{
 const lab=await createRestaurantLab();
 try {
  const current=clone(demo);
  const cur=(await lab.command('manager','Trial.ImportPreview',{input:current})).value as JsonObject;
  expect(cur.schema).toMatchObject({featurePolicyVersion:2,migrated:false});
  expect((cur.featurePlan as {enabled:string[]}).enabled).toEqual(expect.arrayContaining(['guest.call','guest.bill','robot.guide','robot.order','payment.transfer.manual','robot.bussing','catalog','sessions','billing','orders']));
  expect((cur.featurePlan as {enabled:string[]}).enabled).not.toContain('payment.transfer');
  expect(cur.legacyFeatures).toEqual({callStaff:true,requestBill:true,guide:true,order:true,pay:true,busRobot:true});
  // pre-v2 site: no version marker, `call` meant callStaff+requestBill, busRobot was implicitly on
  const old=clone(baseline);delete old.featurePolicyVersion;delete old.serviceProfile;delete old.customerCancel;delete old.service;old.features={call:true};
  const prev=(await lab.command('manager','Trial.ImportPreview',{input:old})).value as JsonObject;
  expect(prev.schema).toMatchObject({featurePolicyVersion:null,migrated:true});
  expect(prev.legacyFeatures).toEqual({callStaff:true,requestBill:true,guide:false,order:false,pay:false,busRobot:true});
  expect((prev.featurePlan as {enabled:string[]}).enabled.sort()).toEqual(['fleet','fulfillment','guest.bill','guest.call','robot.bussing','robot.delivery']);
  // a schema newer than the one this importer knows is refused, not guessed
  const future=clone(baseline);future.featurePolicyVersion=3;
  const refused=await lab.importTrial(future);
  expect(refused.code).toBe('UNSUPPORTED_SCHEMA_VERSION');
  expect(await lab.count('TrialConfigurationImported')).toBe(0);
  expect((await lab.importTrial({...clone(baseline),features:{callStaff:'yes'}})).code).toBe('INVALID_FEATURE_VALUE');
 } finally { await lab.close(); }
});

test('a point reference that no longer exists blocks the whole import',async()=>{
 const lab=await createRestaurantLab();
 try {
  const dock=clone(baseline);(dock.robots as JsonObject[])[0]!.dock='D9';
  const r1=await lab.importTrial(dock);
  expect(r1.code).toBe('STALE_POINT_REFERENCE');
  expect(r1.report.blocking).toEqual([{path:'robots[0].dock',code:'STALE_POINT_REFERENCE'}]);
  const teach=clone(baseline);((teach.robots as JsonObject[])[0]!.valetudo as JsonObject).points={ghost:{segment:1}};
  expect((await lab.importTrial(teach)).report.blocking).toEqual([{path:'robots[0].valetudo.points.ghost',code:'STALE_POINT_REFERENCE'}]);
  const menu=clone(demo);((menu.menu as JsonObject).cats as JsonObject[])[0]!.station='nowhere';
  expect((await lab.importTrial(menu)).report.blocking).toEqual([{path:'menu.cats[0].station',code:'STALE_POINT_REFERENCE'}]);
  const wrongKind=clone(baseline);(wrongKind.robots as JsonObject[])[0]!.dock='kitchen';
  expect((await lab.importTrial(wrongKind)).code).toBe('STALE_POINT_REFERENCE');
  expect(await kinds(lab)).not.toContain('trial-import');
  expect((await lab.state<JsonObject>('robot','R1')).id).toBeUndefined();
 } finally { await lab.close(); }
});

test('an unknown driver is refused and never becomes a robot',async()=>{
 const lab=await createRestaurantLab();
 try {
  const input=clone(baseline);(input.robots as JsonObject[])[0]!.driver='acme-lidar';
  const result=await lab.importTrial(input);
  expect(result.code).toBe('UNKNOWN_DRIVER');
  expect(result.report.blocking).toEqual([{path:'robots[0].driver',code:'UNKNOWN_DRIVER'}]);
  expect((await lab.state<JsonObject>('robot','R1')).id).toBeUndefined();
  const proto=clone(baseline);(proto.robots as JsonObject[])[0]!.driver='constructor';
  expect((await lab.importTrial(proto)).code).toBe('UNKNOWN_DRIVER');
 } finally { await lab.close(); }
});

test('importing the same configuration twice is refused, not doubled; an existing robot id is not overwritten',async()=>{
 const lab=await createRestaurantLab();
 try {
  expect((await lab.importTrial(clone(baseline))).status).toBe('accepted');
  const again=await lab.importTrial(clone(baseline));
  expect(again.status).toBe('rejected');
  expect(again.code).toBe('TRIAL_IMPORT_ALREADY_APPLIED');
  expect(await lab.count('TrialConfigurationImported')).toBe(1);
  const collide=clone(baseline);collide.name='Second';(collide.robots as JsonObject[])[0]!.id='sim-1';
  expect((await lab.importTrial(collide)).code).toBe('ROBOT_EXISTS');
  expect((await lab.state<JsonObject>('robot','sim-1')).driver).toBe('simulator');
  const clash=clone(baseline);clash.name='Third';(clash.points as JsonObject).kitchen={name:'Bếp',kind:'table'};
  expect((await lab.importTrial(clash)).code).toBe('POINT_KIND_CONFLICT');
 } finally { await lab.close(); }
});

test('imported robots are not dispatchable until the robot reports a map, an operator binds it and it is commissioned',async()=>{
 const lab=await createRestaurantLab();
 try {
  // the demo robots carry no driver (trial simulator); make R1 the Valetudo robot the pilot would import
  const site=clone(demo);(site.robots as JsonObject[])[0]!.driver='valetudo';
  expect((await lab.importTrial(site)).status).toBe('accepted');
  const robot=async()=>{const state=await lab.state<JsonObject>('robot','R1');return {ref:{...lab.scope,kind:'robot',id:'R1'},version:Number(state.version),state};};
  const demand={stops:[{targetId:'kitchen'},{targetId:'T01'}],capability:'delivery',trays:1};
  const first=eligibleRobots(demand,[await robot()])[0]!;
  expect(first.eligible).toBe(false);
  expect(first.reasons).toEqual(expect.arrayContaining(['VALIDATION_INSUFFICIENT','TARGET_UNBOUND','CAPABILITY_UNSUPPORTED']));
  const dispatch=await lab.command('cashier','Mission.Create',{robotId:'R1',target:'T01'});
  expect(dispatch.status).toBe('rejected');
  // with the fixture robot ready the feature guard passes, so admission must refuse this robot by name
  expect(dispatch.code).toBe('VALIDATION_INSUFFICIENT');
  expect(await lab.effectCount('robot.execute')).toBe(0);
  // the point exists as a venue point but carries no binding; the robot has not reported a map, so BindMap is refused
  const bindPayload=async(extra:JsonObject={})=>({robotId:'R1',mapId:'m1',mapRevision:'1',frame:'map',units:'m',waypoints:{kitchen:{x:1,y:1}},expectedVersion:(await robot()).version,...extra});
  expect((await lab.command('manager','Robot.BindMap',await bindPayload())).code).toBe('MAP_NOT_REPORTED');
  // once the robot reports its map and the operator teaches the point, binding is current but the driver is still only integration_tested
  await lab.seed('robot','R1',{...(await robot()).state,mapId:'m1',mapRevision:'1'});
  expect((await lab.command('manager','Robot.BindMap',await bindPayload())).status).toBe('accepted');
  const bound=eligibleRobots({stops:[{targetId:'kitchen'}],capability:'delivery',trays:1},[await robot()])[0]!;
  expect(bound.reasons).not.toContain('TARGET_UNBOUND');
  expect(bound.reasons).toContain('VALIDATION_INSUFFICIENT');
  expect((await lab.command('cashier','Mission.Create',{robotId:'R1',target:'kitchen'})).code).toBe('VALIDATION_INSUFFICIENT');
  expect(await lab.effectCount('robot.execute')).toBe(0);
 } finally { await lab.close(); }
});

test('the demo menu is kept as an unpublished draft with integer minor-unit prices',async()=>{
 const lab=await createRestaurantLab();
 try {
  const catalogBefore=await lab.state<JsonObject>('catalog','current');
  const bad=clone(demo);((bad.menu as JsonObject).items as JsonObject[])[0]!.price=12.5;
  expect((await lab.importTrial(bad)).code).toBe('INVALID_PRICE');
  expect((await lab.state<JsonObject>('robot','R1')).id).toBeUndefined();
  expect((await lab.importTrial(clone(demo))).status).toBe('accepted');
  expect(await lab.state<JsonObject>('catalog','current')).toEqual(catalogBefore);
  const record=(await (await lab.getStore('coordinator')).snapshots(lab.scope)).find(s=>s.ref.kind==='trial-import')!.state as {menuDraft:{status:string;items:{id:string;priceMinor:string}[]};timing:JsonObject};
  expect(record.menuDraft.status).toBe('draft_not_published');
  expect(record.menuDraft.items.find(i=>i.id==='pho')?.priceMinor).toBe('65000');
  expect(record.timing.loadSec).toBe(120);
 } finally { await lab.close(); }
});

test('the offline script is dry-run only: report on stdout, exit 0 ready / 2 rejected, no output files',async()=>{
 const {spawnSync}=await import('node:child_process');
 const {mkdtempSync,writeFileSync,readdirSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const run=(file:string)=>spawnSync(process.execPath,['scripts/import-trial-config.mjs',file],{encoding:'utf8'});
 const dir=mkdtempSync(join(tmpdir(),'trial-script-')),bad=join(dir,'bad.json');writeFileSync(bad,JSON.stringify({orders:[{id:1}]}));
 const ok=run('tests/fixtures/trial/site-baseline.json'),rejected=run(bad);
 expect(ok.status).toBe(0);expect(JSON.parse(ok.stdout)).toMatchObject({status:'ready',liveEffects:'none',venueChecks:'not_evaluated_offline'});
 expect(rejected.status).toBe(2);expect(JSON.parse(rejected.stdout).rejectedFields).toEqual([{field:'orders',reason:'RUNTIME_STATE'}]);
 expect(spawnSync(process.execPath,['scripts/import-trial-config.mjs'],{encoding:'utf8'}).status).toBe(1);
 expect(readdirSync(dir)).toEqual(['bad.json']);
});

test('points the venue already has are kept and listed, with name differences, in the report',async()=>{
 const lab=await createRestaurantLab();
 try {
  const input=clone(baseline);((input.points as JsonObject).kitchen as JsonObject).name='Bếp trial';
  const venueKitchen=String((await lab.state<JsonObject>('station','kitchen')).name);
  const result=await lab.importTrial(input);
  expect(result.status).toBe('accepted');
  const kept=result.report.keptExisting as {id:string;kind:string;venueName:string;trialName:string;nameDiffers:boolean}[];
  expect(kept.map(k=>k.id).sort()).toEqual(['bar','kitchen']);
  expect(kept.find(k=>k.id==='kitchen')).toEqual({id:'kitchen',kind:'station',venueName:venueKitchen,trialName:'Bếp trial',nameDiffers:true});
  // kept as they are: the venue's name wins, the new `dish` point is created
  expect((await lab.state<JsonObject>('station','kitchen')).name).toBe(venueKitchen);
  expect((await lab.state<JsonObject>('station','dish')).name).toBe('Khu rửa chén');
 } finally { await lab.close(); }
});
