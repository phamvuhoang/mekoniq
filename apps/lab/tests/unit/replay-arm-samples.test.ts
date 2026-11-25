// I6: replay draws what was recorded: the frame carries, per entity, the latest recorded sample at or before the cursor (never an interpolation,
// never a sample past the cursor). Before an entity's first sample and inside a recorded gap that covers the cursor it carries none, and says which.
// The 3D view's arm model and its cell come from the report's arm plant, not from a sample.
import {expect,test,vi} from 'vitest';
vi.stubGlobal('localStorage',{getItem:()=>'en',setItem:()=>{}});
import type {RunReport} from '../../src/scenarios/controls';
import type {TwinSample} from '../../src/twin/store';
import {coffeeReplay} from '../support/coffee-replay';
const {openReplayV2}=await import('../../src/reports/replay');
const {presetById}=await import('../../src/scenarios/catalog');
const {sceneEntities}=await import('../../src/twin/scene');
const {posesOf,armCellDrawn}=await import('../../src/viewer/twin3d');
const tickNs=(t:number)=>String(t*20_000_000);
const arm=(t:number,q:number,seq:number):TwinSample=>({schemaVersion:2,runId:'run',entityId:'arm-1',providerId:'mujoco_arm',bootId:'b',seq:String(seq),simTimeNs:tickNs(t),observedAt:null,receivedMonotonicNs:'1',frameId:'arm_base',origin:'physics_sim',quality:'valid',reasonCodes:[],
 commanded:{jointsRad:[q,0,0,0,0,0]},observed:{jointsRad:[q,0,0,0,0,0],gripperOpeningM:0.03},estimated:null,causationId:null});
const cup=(t:number,x:number,seq:number):TwinSample=>({...arm(t,0,seq),entityId:'cup-1',frameId:'map',commanded:null,observed:{positionM:[x,1.5,0.9],quaternionXyzw:[0,0,0,1]}});
function mujocoReport():{report:RunReport;view:ReturnType<typeof coffeeReplay>['view']}{
 const {report,view}=coffeeReplay();
 report.arm={armPlant:{engine:'mujoco_3d',engineVersion:'3.3.7',control:'position_actuator',grip:'contact',dynamics:'nominal',calibration:'not_calibrated'}} as never;
 report.telemetry!.samples=[...report.telemetry!.samples,arm(10,0.1,1),arm(20,0.2,2),arm(60,0.6,3),cup(20,3.1,4),cup(30,3.2,5)];
 report.telemetry!.gaps=[{reason:'DROPPED',fromTick:40,toTick:50}];
 return {report,view};
}
test('the projection: before the first sample, between two samples, inside a gap, at the end',()=>{
 const {report,view}=mujocoReport(),rp=openReplayV2(report);
 const at=(t:number)=>rp.project(view,t);
 // before the arm's first recorded sample: nothing for it, and it is named as not recorded here
 expect(at(5).samples['arm-1']).toBeUndefined();expect(at(5).unrecorded).toEqual(['arm-1','cup-1']);
 // between two samples: the earlier one exactly (no interpolation), never the later one
 const mid=at(15);expect(mid.samples['arm-1']!.observed!.jointsRad).toEqual([0.1,0,0,0,0,0]);expect(mid.unrecorded).toEqual(['cup-1']);
 expect(mid.nowMs).toBe(15*20);expect(mid.samples['arm-1']!.receivedAtMs).toBe(10*20);
 // inside a recorded gap that covers the cursor: none drawn from samples, all named
 const gap=at(45);expect(gap.samples['arm-1']).toBeUndefined();expect(gap.samples['cup-1']).toBeUndefined();expect(gap.unrecorded).toEqual(['arm-1','cup-1']);
 // at the end: the newest recorded sample
 const end=at(rp.range.toTick);expect(end.samples['arm-1']!.observed!.jointsRad).toEqual([0.6,0,0,0,0,0]);expect(end.unrecorded).toEqual([]);
});
test('a replay frame draws the recorded arm joints and the cup at its recorded pose by the live code; the cell comes from the report\'s plant',()=>{
 const {report,view}=mujocoReport(),rp=openReplayV2(report),preset=presetById('mujoco-coffee')!;
 const p=rp.project(view,25),f={preset,report:p.report,view:p.view,samples:p.samples,nowMs:p.nowMs};
 expect(posesOf(f).arms['arm-1']!.jointsRad).toEqual([0.2,0,0,0,0,0]);
 expect(sceneEntities(f).find(e=>e.id==='cup-1')?.plant?.positionM).toEqual([3.1,1.5,0.9]);
 expect(armCellDrawn(f)).toBe(true);
 // a sample of another provider does not make the MuJoCo plant's arm into the reference arm: the report says what the plant is
 const other={...f,samples:{...f.samples,'arm-1':{...f.samples['arm-1']!,providerId:'unknown_provider'}}};
 expect(armCellDrawn(other)).toBe(true);
});
test('the viewport says which objects have no recorded sample at the cursor',async()=>{
 vi.stubGlobal('innerWidth',600);vi.stubGlobal('document',{getElementById:()=>null,querySelector:()=>null,activeElement:null});
 const {TwinWorkspace}=await import('../../src/ui/workspace');
 const {report,view}=mujocoReport();Object.assign(report.arm!,{trace:{path:'t',sha256:'a'.repeat(64),samples:3},tracking:{samples:3,peakRad:[0,0,0,0,0,0],rmsRad:[0,0,0,0,0,0]},collision:{result:'pass',reasonCodes:[]}});
 const w=new TwinWorkspace(()=>{},{paired:true} as never),h=w as unknown as Record<string,unknown>;
 Object.assign(h,{view,report,runPreset:presetById('mujoco-coffee')!,replay:{rp:openReplayV2(report),tick:45,playing:false}});
 expect(w.html()).toMatch(/data-testid="replay-unrecorded"[^]*Arm|data-testid="replay-unrecorded"[^]*arm-1/);
 (h.replay as {tick:number}).tick=report.outcome.tick;expect(w.html()).not.toContain('replay-unrecorded');
 w.leave();
});
