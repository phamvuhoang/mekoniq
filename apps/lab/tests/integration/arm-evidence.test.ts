// Plan 03 A05 (Lab): arm telemetry renders only observed source values with their age and provenance (no extrapolation, frozen when stale),
// commanded and actual stay apart, and the ARM03 row comes from recorded checker evidence only: no checker evidence -> not run, whatever
// the picture shows. Custody/served never derive from arm telemetry; the shared handoff fixture says so when the sibling exists.
import {existsSync,readFileSync} from 'node:fs';
import {expect,test,vi} from 'vitest';
import {TwinStore,type TwinSample} from '../../src/twin/store';
import {armJointsView,displayJoints} from '../../src/twin/arm/arm-telemetry';
import {coffeeReplay} from '../support/coffee-replay';
vi.stubGlobal('localStorage',{getItem:()=>'en',setItem:()=>{}});
const {arm03Status,arm03Rows,armTelemetryRows}=await import('../../src/twin/arm/arm-view');
const {inspect}=await import('../../src/twin/inspector');
const {presets}=await import('../../src/scenarios/catalog');
const base=(over:Partial<TwinSample>):TwinSample=>({schemaVersion:2,runId:'run',entityId:'arm-1',providerId:'linuxcnc_sim',bootId:'ctl-1',seq:'7',simTimeNs:null,observedAt:'2026-11-05T08:00:01.000Z',receivedMonotonicNs:'1',frameId:'arm_base',origin:'controller_sim',quality:'valid',reasonCodes:[],
 commanded:{jointsRad:[0,-0.5,0.3,0,0.81,0]},observed:{jointsRad:[0,-0.5,0.3,0,0.8,0],homed:true,tcpM:[0.43,0.14,0.18]},estimated:null,causationId:null,...over});

test('controller_sim samples keep actual and commanded apart, carry provenance and age, and go stale by the receipt clock',()=>{
 let clock=1000;const store=new TwinStore({now:()=>clock});store.apply(base({}));
 const fresh=armJointsView(store.entity('arm-1')!,clock+100,500);
 expect(fresh).toMatchObject({jointsActualRad:[0,-0.5,0.3,0,0.8,0],jointsCommandedRad:[0,-0.5,0.3,0,0.81,0],tcpM:[0.43,0.14,0.18],homed:true,provenance:'controller_sim',providerId:'linuxcnc_sim',quality:'valid',ageMs:100,stale:false,reasonCodes:[]});
 const stale=armJointsView(store.entity('arm-1')!,clock+900,500);
 expect(stale).toMatchObject({quality:'stale',stale:true,ageMs:900,reasonCodes:['STALE']});
 const rows=armTelemetryRows(fresh);
 expect(rows.filter(r=>r.key.startsWith('joint-'))).toHaveLength(6);expect(rows[4]).toMatchObject({key:'joint-5',observed:expect.stringContaining('0.8000'),commanded:expect.stringContaining('0.8100'),source:'observed',unit:'rad'});
 expect(armTelemetryRows(stale)[0]).toMatchObject({source:'unknown'});expect(armTelemetryRows(stale).find(r=>r.key==='arm-source')!.observed).toContain('STALE');
 const mock=armJointsView({...base({providerId:'mock_arm',origin:'mock',quality:'unknown',reasonCodes:['NO_ENCODER_MOCK'],observed:null}),receivedAtMs:clock,epochResetAtMs:null},clock+10);
 expect(mock).toMatchObject({jointsActualRad:null,jointsCommandedRad:[0,-0.5,0.3,0,0.81,0],provenance:'mock',quality:'unknown'});
 expect(armTelemetryRows(mock)[0]).toMatchObject({observed:'none',source:'commanded'});
});

test('the renderer shows the latest observed joints and freezes when stale; it never interpolates past the last sample',()=>{
 let clock=0;const store=new TwinStore({now:()=>clock});store.apply(base({seq:'1',observed:{jointsRad:[0,0,0,0,0,0]}}));
 const a=armJointsView(store.entity('arm-1')!,clock,500);clock=100;store.apply(base({seq:'2',observed:{jointsRad:[0.2,0,0,0,0,0]}}));
 const b=armJointsView(store.entity('arm-1')!,clock,500);
 expect(displayJoints(a,b)).toEqual({jointsRad:[0.2,0,0,0,0,0],source:'observed',frozen:false});
 expect(displayJoints(a,armJointsView(store.entity('arm-1')!,clock+2000,500))).toEqual({jointsRad:[0.2,0,0,0,0,0],source:'observed',frozen:true});
 expect(displayJoints(null,null)).toEqual({jointsRad:null,source:'unknown',frozen:false});
 const commandedOnly=armJointsView({...base({observed:null,quality:'unknown',reasonCodes:['NO_ENCODER_MOCK']}),receivedAtMs:clock,epochResetAtMs:null},clock);
 expect(displayJoints(null,commandedOnly)).toMatchObject({source:'commanded'});
});

test('ARM03 is not run without recorded checker evidence, fails on a retained failure at the cursor and passes only on checked intervals in an available scene',()=>{
 const {report}=coffeeReplay();
 expect(arm03Status(report,100)).toMatchObject({result:'not_run',reason:'CHECKER_EVIDENCE_MISSING'});
 const ok={ok:true,engine:'capsule-sweep-v1',geometryRevision:'g'.repeat(64),modelRevision:'m'},scene={available:true,scope:'self_scene_robot' as const,revision:'s'.repeat(64),profileRevision:1,tick:5,world:[]};
 report.coffee!.armTrace.collision={world:[],checks:3,last:ok,scene,evidence:{intervals:[{firstTick:5,lastTick:20,fromQ:[0],toQ:[0.1],heldCupId:null,worldRevision:'w',sceneRevision:scene.revision,result:ok}],worlds:{w:[]},droppedIntervals:0}};
 expect(arm03Status(report,4)).toMatchObject({result:'not_run',reason:'NO_CHECKED_INTERVAL_AT_CURSOR'});
 expect(arm03Status(report,20)).toMatchObject({result:'pass',engine:'capsule-sweep-v1',intervals:1,geometryRevision:'g'.repeat(64)});
 report.coffee!.armTrace.collision.scene={...scene,available:false,reason:'ARM_COLLISION_PROFILE_MISSING'};
 expect(arm03Status(report,20)).toMatchObject({result:'not_run',reason:'ARM_COLLISION_PROFILE_MISSING'});
 report.coffee!.armTrace.collision.scene=scene;
 const bad={...ok,ok:false,reason:'COLLISION',pair:['held-cup','fixture:tray'] as [string,string]};
 report.coffee!.armTrace.collision.evidence!.firstFailure={tick:30,fromQ:[0.1],toQ:[0.2],heldCupId:'cup-1',worldRevision:'w',world:[],scene,result:bad};
 expect(arm03Status(report,25)).toMatchObject({result:'pass'});
 expect(arm03Status(report,30)).toMatchObject({result:'fail',reason:'COLLISION:held-cup/fixture:tray'});
 expect(arm03Rows(report,30)[0]).toMatchObject({key:'arm03',observed:expect.stringContaining('fail'),source:'modeled'});
 expect(arm03Rows(coffeeReplay().report,30)[0]).toMatchObject({source:'unknown',observed:expect.stringContaining('not run')});
});

test('the arm inspector prefers live telemetry rows and still ends with ARM03; without a sample it shows the commanded trace',()=>{
 const {report,view}=coffeeReplay(),preset=presets[0]!;
 let clock=50;const store=new TwinStore({now:()=>clock});store.apply(base({}));
 const withSample=inspect({preset,view,report,samples:Object.fromEntries(store.entities().map(s=>[s.entityId,s])),nowMs:clock+20},'arm-1')!;
 expect(withSample.rows.slice(0,6).map(r=>r.source)).toEqual(Array(6).fill('observed'));expect(withSample.rows.at(-1)!.key).toBe('arm03');expect(withSample.note).toContain('LinuxCNC sim');
 const without=inspect({preset,view,report},'arm-1')!;
 expect(without.rows.find(r=>r.key==='joint-1')!.observed).toContain('no encoder');expect(without.rows.at(-1)!.key).toBe('arm03');expect(without.note).toContain('mock_kinematic');
});

test('the shared handoff fixture never serves from arm evidence and keeps custody explicit',()=>{
 const sibling='../source/integrations/arm-controller/tests/fixtures/coffee-handoff.json';
 if(!existsSync(sibling))return;
 const fx=JSON.parse(readFileSync(sibling,'utf8')) as {cases:{name:string;expected:{served:boolean;custody:string;pickup:string}}[]};
 for(const c of fx.cases){expect(c.expected.served,c.name).toBe(false);expect(['cell','arm','unresolved'],c.name).toContain(c.expected.custody);}
 expect(fx.cases.filter(c=>c.expected.custody==='unresolved').length).toBeGreaterThanOrEqual(3);
});
