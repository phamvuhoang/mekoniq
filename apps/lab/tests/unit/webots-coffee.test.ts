// X07 (R1.1): the webots-coffee preset (WB-BV01 on engineering-webots-arm-v1) in the Lab: selectable only with live webots_arm and sim3d_arm_v1, labelled actual/commanded for a plant arm, ARM03 and the plant block from the report.
import {expect,test,vi} from 'vitest';
vi.hoisted(()=>{(globalThis as Record<string,unknown>).localStorage={getItem:()=>'en',setItem:()=>{}};});
import type {RunReport,TwinHealth} from '../../src/scenarios/controls';
import {backendSetOptions} from '../../src/scenarios/support';
import {WEBOTS_ARM_SET,presetById} from '../../src/scenarios/catalog';
import {preflight} from '../../src/scenarios/preflight';
import {nextAction} from '../../src/ui/operations-panel';
import {armJointsView} from '../../src/twin/arm/arm-telemetry';
import {arm03Status,armTelemetryRows} from '../../src/twin/arm/arm-view';
import {armPlantHtml} from '../../src/ui/report-panel';
import {armRows} from '../../src/twin/coffee-cell';
import type {Held} from '../../src/twin/store';

const backend=(id:string,live:boolean)=>({id,modes:['simulation'],installed:live,compatible:live,reachable:live,commissioned:true,enabled:live,...live?{}:{reason:'WEBOTS_DISABLED: the Webots arm provider is not configured on this runtime (MEKONIQ_LAB_WEBOTS=1)'}});
const mock=(id:string)=>({id,modes:['mock','simulation'],installed:true,compatible:true,reachable:true,commissioned:true,enabled:true});
const execution={host:'portable_python' as const,clock:'source_fixed_step' as const,manualStep:false,speedMultipliers:[1,4,16,64]};
const health=(o:{live?:boolean;capabilities?:string[]}={}):TwinHealth=>({protocolMajors:[1,2],sourceCommit:'a'.repeat(40),schemaHash:'b'.repeat(64),scenarioIds:['BV01','WB-BV01'],features:{readiness:true},
 capabilities:o.capabilities??['engineering_bundle_v1',...o.live?['sim3d_arm_v1']:[]],
 backends:[mock('mock_amr'),mock('mock_coffee'),backend('webots_arm',!!o.live)],
 backendSets:[{id:WEBOTS_ARM_SET,mode:'simulation',access:'simulated',backends:['mock_amr','webots_arm','mock_coffee'],execution}]});
const preset=presetById('webots-coffee')!;

test('the preset is WB-BV01 on the arm set, simulation, with no engineering bundle',()=>{
 expect(preset).toMatchObject({scenarioId:'WB-BV01',backendSetId:'engineering-webots-arm-v1',mode:'simulation'});expect(preset.engineering).toBeUndefined();
});
test('the arm set is selectable only with webots_arm live and sim3d_arm_v1 advertised; each missing part is named',()=>{
 expect(backendSetOptions(health({live:true})).find(s=>s.id===WEBOTS_ARM_SET)).toMatchObject({selectable:true,reasons:[]});
 expect(backendSetOptions(health()).find(s=>s.id===WEBOTS_ARM_SET)).toMatchObject({selectable:false,reasons:[expect.stringContaining('BACKEND_NOT_INSTALLED:webots_arm'),'CAPABILITY_MISSING:sim3d_arm_v1']});
 expect(backendSetOptions(health({live:true,capabilities:['engineering_bundle_v1']})).find(s=>s.id===WEBOTS_ARM_SET)?.reasons).toEqual(['CAPABILITY_MISSING:sim3d_arm_v1']);
});
test('flag off: the run button is blocked with the runtime\'s reason, never offered as ready',()=>{
 const checks=preflight(preset,health(),true),backendCheck=checks.find(c=>c.id==='backend')!;
 expect(backendCheck.ok).toBe(false);expect(backendCheck.detail).toContain('webots_arm');expect(backendCheck.detail).toContain('WEBOTS_DISABLED');
 const blocked=nextAction({paired:true,ready:false,busy:false,playing:false,view:null,preset});
 expect(blocked.action).toBeUndefined();
 const go=nextAction({paired:true,ready:true,busy:false,playing:false,view:null,preset});
 expect(go.title).toContain('Webots');expect(go.action).toMatchObject({id:'twin-run',primary:true});expect(go.detail).toContain('not_calibrated');
});

const sample=(o:Partial<Held>={}):Held=>({schemaVersion:2,runId:'r',entityId:'arm-1',providerId:'webots_arm',bootId:'boot-1',seq:'9',simTimeNs:'1',observedAt:'2026-11-11T00:00:00.000Z',receivedMonotonicNs:'1',frameId:'arm_base',origin:'physics_sim',quality:'valid',reasonCodes:[],
 commanded:{jointsRad:[0.1,0.2,0.3,0.4,0.5,0.6],gripper:'closed',limitsOk:true},observed:{jointsRad:[0.11,0.2,0.3,0.4,0.5,0.6],limitsOk:true},estimated:null,causationId:null,receivedAtMs:1000,epochResetAtMs:null,...o} as Held);
test('a plant arm shows the actual and the commanded joints apart, labelled; a mock arm keeps "no encoder (mock)"',()=>{
 const rows=armTelemetryRows(armJointsView(sample(),1100));
 const q1=rows.find(r=>r.key==='joint-1')!;expect(q1.observed).toContain('0.1100');expect(q1.commanded).toContain('0.1000');expect(q1.source).toBe('observed');
 expect(rows.find(r=>r.key==='arm-source')!.observed).toContain('actual (Webots) · commanded');
 const report={manifest:{clock:{tickMs:20}},coffee:{armTrace:{samples:[{tick:3,q:[0,0,0,0,0,0],tcp:[0,0,0]}],limitsOk:true}}} as unknown as RunReport;
 expect(armRows(report,5).find(r=>r.key==='joint-1')!.observed).toBe('no encoder (mock)');
});
const armReport=(over:Record<string,unknown>={})=>({manifest:{mode:'simulation',world:{id:'w',revision:1,hash:'h'},clock:{tickMs:20}},outcome:{tick:10},
 arm:{trace:{path:'arm-trace.json',sha256:'a'.repeat(64),samples:300},tracking:{samples:300,peakRad:[0.0168,0,0,0,0,0],rmsRad:[0.003,0,0,0,0,0]},armPlant:{engine:'webots_3d',control:'position_servo',grip:'event',dynamics:'assumed',calibration:'not_calibrated'},collision:{result:'pass',reasonCodes:[]}},
 coffee:{armTrace:{samples:[],limitsOk:true,collision:{scene:{tick:0,available:true,revision:'scene-1',profileRevision:1},evidence:{intervals:[{firstTick:1,lastTick:9,result:{ok:true,engine:'capsule-sweep-v1',geometryRevision:'g'.repeat(64)}}]},last:{ok:true,engine:'capsule-sweep-v1',geometryRevision:'g'.repeat(64)}}}},...over}) as unknown as RunReport;
test('ARM03 of a plant arm comes from its coffee arm trace, not from the native controller-verification path',()=>{
 expect(arm03Status(armReport(),10)).toMatchObject({result:'pass',engine:'capsule-sweep-v1',intervals:1});
 const native=armReport({arm:undefined});expect(arm03Status(native,10)).toMatchObject({result:'not_run',reason:'CONTROLLER_EVIDENCE_INVALID_OR_MISSING'}); // a simulation report without the plant block is still the native path
});
test('the report names the plant, ARM03, the trace hash and not_calibrated; a report without the block draws nothing',()=>{
 const html=armPlantHtml(armReport());
 for(const t of ['webots_3d','position_servo','not_calibrated','ARM03','arm-trace.json','aaaaaaaaaaaa','0.0168'])expect(html).toContain(t);
 expect(armPlantHtml(armReport({arm:undefined}))).toBe('');
});
