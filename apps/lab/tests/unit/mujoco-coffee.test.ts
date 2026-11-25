// U06: the MuJoCo arm in the Lab: its joints labelled actual (MuJoCo) / commanded, its next step and the report's plant block (what the plant is, the solved
// waypoints, the allowed contacts over the whole trace, the assumed release timeout, a stop as the runtime reports it, and whether the docked robot was in the check).
// Every string in its three languages (tr is replaced by `vi|ja|en`).
import {expect,test,vi} from 'vitest';
vi.mock('../../src/i18n',()=>({tr:(vi:string,ja:string,en:string)=>`${vi}|${ja}|${en}`}));
import type {RunReport} from '../../src/scenarios/controls';
import {presetById} from '../../src/scenarios/catalog';
import {nextAction} from '../../src/ui/operations-panel';
import {armJointsView} from '../../src/twin/arm/arm-telemetry';
import {armTelemetryRows} from '../../src/twin/arm/arm-view';
import {armPlantHtml} from '../../src/ui/report-panel';
import {inspect} from '../../src/twin/inspector';
import type {Held} from '../../src/twin/store';
import type {TwinFrame} from '../../src/twin/scene';
const preset=presetById('mujoco-coffee')!;
const sample=(o:Partial<Held>={}):Held=>({schemaVersion:2,runId:'r',entityId:'arm-1',providerId:'mujoco_arm',bootId:'boot-1',seq:'9',simTimeNs:'1',observedAt:'2026-11-13T00:00:00.000Z',receivedMonotonicNs:'1',frameId:'arm_base',origin:'physics_sim',quality:'valid',reasonCodes:[],
 commanded:{jointsRad:[0.1,0.2,0.3,0.4,0.5,0.6]},observed:{jointsRad:[0.11,0.2,0.3,0.4,0.5,0.6],gripperOpeningM:0.02},estimated:null,causationId:null,receivedAtMs:1000,epochResetAtMs:null,...o} as Held);

test('the MuJoCo arm\'s joints: actual and commanded apart, labelled thực (MuJoCo) / lệnh; the Webots label is unchanged',()=>{
 const rows=armTelemetryRows(armJointsView(sample(),1100));
 expect(rows.find(r=>r.key==='arm-source')!.observed).toContain('thực (MuJoCo) · lệnh|実測(MuJoCo) · 指令|actual (MuJoCo) · commanded');
 const q1=rows.find(r=>r.key==='joint-1')!;expect(q1.observed).toContain('0.1100');expect(q1.commanded).toContain('0.1000');
 expect(armTelemetryRows(armJointsView(sample({providerId:'webots_arm'}),1100)).find(r=>r.key==='arm-source')!.observed).toContain('thực (Webots) · lệnh');
});

test('the inspector note for the MuJoCo arm: grip by simulated contact, assumed and not calibrated; never a gripper sensor or a real arm',()=>{
 const f={preset,report:null,view:{tick:1,run:{},entities:[],coffee:null},samples:{'arm-1':sample()},nowMs:1100} as unknown as TwinFrame;
 const note=inspect(f,'arm-1')!.note;
 expect(note).toContain('MuJoCo');expect(note).toContain('not_calibrated');expect(note).not.toContain('Webots');expect(note).not.toMatch(/event|sự kiện/);
});

test('ready for MuJoCo: one primary Run, and the detail says simulation with assumed, not calibrated dynamics',()=>{
 const go=nextAction({paired:true,ready:true,busy:false,playing:false,view:null,preset});
 expect(go.title).toContain('MuJoCo');expect(go.action).toMatchObject({id:'twin-run',primary:true});expect(go.detail).toContain('not_calibrated');expect(go.detail).not.toContain('Webots');
 expect(nextAction({paired:true,ready:false,busy:false,playing:false,view:null,preset}).action).toBeUndefined();
});

const W=[{waypoint:'pick-approach',q:[0.1,0.2,0.3,0.4,0.5,0.6],positionErrorM:0.00012,orientationErrorRad:0.0003,condition:12.5},{waypoint:'place',q:[0,0,0,0,0,0],positionErrorM:0,orientationErrorRad:0,condition:3}];
const mujocoReport=(o:{stop?:Record<string,unknown>|null;scene?:boolean}={})=>({manifest:{mode:'simulation',world:{id:'w',revision:1,hash:'h'},clock:{tickMs:20}},outcome:{tick:4800},coverage:{armSceneCollision:o.scene??true},
 arm:{trace:{path:'arm-trace.json',sha256:'a'.repeat(64),samples:2700},tracking:{samples:2700,peakRad:[0.02,0,0,0,0,0],rmsRad:[0.004,0,0,0,0,0]},
  armPlant:{engine:'mujoco_3d',engineVersion:'3.3.7',control:'position_actuator',grip:'contact',dynamics:'manufacturer_nominal+assumed',calibration:'not_calibrated'},
  collision:{result:'pass',reasonCodes:[],allowedContacts:[{pair:['gripper','nozzle-stand'],phase:'grasp',fromTick:10,toTick:4700,revision:1}],allowedContactsNote:'The allowed pairs are static: each applies over the whole trace (fromTick..toTick), not within a phase.',coverage:{intervals:2690,evaluations:9122,uncertain:0,allowedContactsApplied:92}},
  waypoints:{digest:'d'.repeat(64),table:W},props:{path:'arm-props-trace.json',sha256:'c'.repeat(64),samples:2700},allowedContacts:[{a:'gripper',b:'nozzle-stand'},{a:'held_prop',b:'tray'}],releaseTimeoutTicks:150,
  notes:['Plant: MuJoCo 3.3.7, xArm 6 with Gripper G2 under position actuators; not_calibrated: masses ...']},
 coffee:{armTrace:{samples:[],limitsOk:true,stop:o.stop===undefined?null:o.stop}}}) as unknown as RunReport;

test('the MuJoCo plant block: the plant, the waypoint table, the allowed contacts over the whole trace, the assumed release timeout, the docked robot in the check',()=>{
 const html=armPlantHtml(mujocoReport());
 for(const t of ['MuJoCo','mujoco_3d','3.3.7','position_actuator','contact','manufacturer_nominal+assumed','not_calibrated','ARM03','arm-trace.json'])expect(html).toContain(t);
 expect(html).not.toContain('Webots');
 const table=/data-testid="arm-waypoints"[^]*?<\/table>/.exec(html)?.[0]??'';
 expect(table).toContain('pick-approach');expect(table).toContain('place');expect(table).toContain('0.12');// position error in mm
 const allowed=/data-testid="arm-allowed-contacts"[^]*?<\/div>/.exec(html)?.[0]??'';
 expect(allowed).toContain('gripper');expect(allowed).toContain('nozzle-stand');expect(allowed).toContain('tray');expect(allowed).toMatch(/toàn bộ vệt[^|]*\|[^|]*\|[^|]*whole trace/);
 expect(/data-testid="arm-release-timeout"[^>]*>[^]*?<\/p>/.exec(html)?.[0]).toMatch(/150[^]*giả định[^|]*\|[^|]*仮定[^|]*\|[^|]*assumed/);
 expect(html).toMatch(/data-testid="arm-scene-coverage" data-value="true"/);
 expect(armPlantHtml(mujocoReport({scene:false}))).toMatch(/data-testid="arm-scene-coverage" data-value="false"/);
 expect(html).not.toContain('arm-stop');// a normal run has no stop
 expect(html).toContain('Plant: MuJoCo 3.3.7');// the runtime's own statements are shown as it wrote them
});

test('an arm the plant stopped: the stop reason and its detail, as the runtime reports them',()=>{
 const html=armPlantHtml(mujocoReport({stop:{latched:true,reconcileRequired:true,reason:'PLANT_UNSTABLE',detail:'the engine reported a bad state (BADQACC) and reset itself',events:[]}}));
 const stop=/data-testid="arm-stop"[^]*?<\/p>/.exec(html)?.[0]??'';
 expect(stop).toContain('PLANT_UNSTABLE');expect(stop).toContain('the engine reported a bad state (BADQACC) and reset itself');
});

// Fix round 1: the identity names each backend's model; the run-level tag is the scenario runner's tag for the mock parts, said as such when a plant backend is present.
import {identityItems} from '../../src/twin/inspector';
import type {RunView} from '../../src/scenarios/controls';
const runView=(backends:string[],model='mock_kinematic')=>({run:{backendSetId:'set',backends,scenarioId:'S',scenarioRevision:1,seed:42,sourceCommit:'8543765aaaa'},model,coffee:null} as unknown as RunView);
const manifest=(backends:{id:string;version:string;model:string}[])=>({manifest:{backends,project:{id:'p',revision:1},world:{revision:1}},coffee:null} as unknown as RunReport);
test('identity of a mock run: unchanged (backends with versions, then model <tag>)',()=>{
 const items=identityItems(runView(['mock_amr','mock_coffee']),manifest([{id:'mock_amr',version:'1',model:'mock_kinematic'},{id:'mock_coffee',version:'1',model:'mock_process'}]));
 expect(items.slice(0,3)).toEqual(['set','mock_amr@1, mock_coffee@1','model mock_kinematic']);
});
for(const [plant,model] of [['mujoco_arm','xarm6-g2-v1'],['webots_arm','arm-ref-3d-v1']] as const)test(`identity of a ${plant} run: each backend with its own model; the run tag only as the mock parts' tag`,()=>{
 const items=identityItems(runView(['mock_amr',plant]),manifest([{id:'mock_amr',version:'1',model:'mock_kinematic'},{id:plant,version:'3.17.0',model}]));
 expect(items).toContain(`mock_amr@1 · mock_kinematic, ${plant}@3.17.0 · ${model}`);
 expect(items).not.toContain('model mock_kinematic');
 expect(items).toContain('thẻ mô hình của phần mock|モック部分のモデルタグ|model tag of the mock parts: mock_kinematic');
 // no report yet: the backends without a model, never the run tag as the run's model
 expect(identityItems(runView(['mock_amr',plant]),null)).not.toContain('model mock_kinematic');
});
test('the arm note without a live sample follows the report\'s plant engine; a mock run keeps its note',()=>{
 const note=(arm?:Record<string,unknown>)=>inspect({preset,report:arm?{manifest:{clock:{tickMs:20}},arm:{armPlant:arm}}:null,view:{tick:1,run:{},entities:[],coffee:null},samples:{},nowMs:1100} as unknown as TwinFrame,'arm-1')!.note;
 expect(note({engine:'mujoco_3d'})).toContain('MuJoCo');expect(note({engine:'mujoco_3d'})).not.toContain('mock_kinematic');
 expect(note({engine:'webots_3d'})).toContain('Webots R2025a');
 expect(note()).toBe('Góc khớp là quỹ đạo lệnh của mock_kinematic; không có encoder hay lực kẹp.|関節角はmock_kinematicの指令軌道。エンコーダ・把持力なし。|Joint angles are the mock_kinematic commanded trace; no encoder or grip force.');
});
