// V11: the arm plant waits for a grasp plan before the first motion of a cup-pick (belief grasp), moves to the planned waypoints once told, and fails the program with the refusal code otherwise.
import {expect,test} from 'vitest';
import {readFileSync} from 'node:fs';
import {MockArmPlant,type ArmProgramSet,type ArmTracking} from '../../packages/cell-adapters/src/mock-arm';
import type {CellCommand,CellReport} from '../../packages/cell-adapters/src/contract';
import {XARM6_SI} from '../../packages/lab-runtime/src/v2/models/arm-kinematics';
import {loadOracleProfile} from '../../packages/lab-runtime/src/v2/algorithm/checker';
const FILE=JSON.parse(readFileSync('robotics/simulation-mujoco/fixtures/xarm6-g2-v1/programs.json','utf8')) as {programs:ArmProgramSet};
const P=(loadOracleProfile().profile as unknown as {mujocoArm:Record<string,number>}).mujocoArm;
const TRACKING:ArmTracking={reachTolRad:P.reachTolRad!,settleTicks:P.settleTicks!,followTolRad:P.followTolRad!,followTicks:P.followTicks!};
const CONTACT={openM:0.0889,closedM:0,gripSettleTicks:P.gripSettleTicks!,dropTicks:P.dropTicks!,liftMinM:P.liftMinM!,releaseTimeoutTicks:200};
const programs=(belief:boolean,recovery=false):ArmProgramSet=>({...structuredClone(FILE.programs),contact:CONTACT,...belief?{beliefGrasp:true as const}:{},...recovery?{recovery:true as const}:{}});
const cmd=(id:string,program:'cup-pick'|'cup-place'='cup-pick'):CellCommand=>({runId:'r',commandId:id,deviceId:'arm',controlEpoch:1,expiresAt:'2026-11-06T00:00:00Z',recipeRevision:1,programRef:{id:program,hash:'a'.repeat(64)},payloadHash:'a'.repeat(64),capability:'start_job',payload:{jobId:'j'}});
function make(belief=true,recovery=false){
 const set=programs(belief,recovery),state=MockArmPlant.initial('arm','boot-0:arm',set),reports:CellReport[]=[];
 const plant=new MockArmPlant(state,()=>Date.parse('2026-11-12T00:00:00Z'),()=>'boot-2',{take:id=>id??null,put:()=>{}},()=>null,XARM6_SI,TRACKING,set);plant.on(r=>reports.push(r));
 // a perfect plant: the joints are where they were commanded
 const tick=()=>{plant.advance();plant.observe(plant.state.commandedQ??plant.state.q,[],{gripper:{openingM:0.0889,heldPropIds:[]},props:[]});};
 return {plant,state,reports,tick,set};
}
const nudge=(q:number[])=>q.map((v,i)=>i===0?v+0.05:v);
const planned=(set:ArmProgramSet)=>({pickApproach:nudge(set.waypoints.pickApproach!),pick:nudge(set.waypoints.pick!),lift:nudge(set.waypoints.lift!)});

test('a belief cup-pick holds still until a plan is set: no motion command, the program stays running',()=>{
 const h=make(),home=[...h.state.q];
 expect(h.plant.execute(cmd('c1'))).toMatchObject({accepted:true});
 expect(h.plant.graspPending()).toEqual({commandId:'c1',program:'cup-pick'});
 for(let i=0;i<60;i++){h.tick();expect(h.state.commandedQ).toEqual(home);}
 expect(h.state.programs[0]!.state).toBe('running');
});
test('once a plan is set the arm moves to the planned approach, not the nominal one',()=>{
 const h=make(),plan=planned(h.set);h.plant.execute(cmd('c1'));h.tick();
 h.plant.setGraspPlan('c1',{ok:true,waypoints:plan});expect(h.plant.graspPending()).toBeNull();
 let reached=-1;for(let i=0;i<600&&reached<0;i++){h.tick();if(h.state.programs[0]!.index>=1)reached=i;}
 expect(reached).toBeGreaterThan(0);
 expect(h.state.q.every((v,i)=>Math.abs(v-plan.pickApproach[i]!)<=TRACKING.reachTolRad)).toBe(true);
 expect(Math.abs(h.state.q[0]!-h.set.waypoints.pickApproach![0]!)).toBeGreaterThan(0.04);
});
test('a refusal fails the program with its code before the first motion',()=>{
 const h=make(),home=[...h.state.q];h.plant.execute(cmd('c1'));h.tick();
 h.plant.setGraspPlan('c1',{ok:false,code:'BELIEF_OUT_OF_REGION'});
 for(let i=0;i<10;i++){h.tick();expect(h.state.commandedQ).toEqual(home);}
 expect(h.state.programs[0]!.state).toBe('failed');
 expect(h.reports.find(r=>r.observation?.result==='failed')?.observation?.reasonCodes).toEqual(['BELIEF_OUT_OF_REGION']);
 expect(h.state.stop).toBeUndefined();
});
test('a plan for a command that is not waiting is refused',()=>{
 const h=make();h.plant.execute(cmd('c1'));
 expect(()=>h.plant.setGraspPlan('other',{ok:true,waypoints:planned(h.set)})).toThrow('GRASP_PLAN_NOT_PENDING');
 h.plant.setGraspPlan('c1',{ok:true,waypoints:planned(h.set)});
 expect(()=>h.plant.setGraspPlan('c1',{ok:true,waypoints:planned(h.set)})).toThrow('GRASP_PLAN_NOT_PENDING');
});
test('a plan with a waypoint outside the joint limits or with a missing waypoint is refused',()=>{
 const h=make();h.plant.execute(cmd('c1'));const bad=planned(h.set);bad.pick[1]=9;
 expect(()=>h.plant.setGraspPlan('c1',{ok:true,waypoints:bad})).toThrow('ARM_PROGRAM_INVALID');
 expect(()=>h.plant.setGraspPlan('c1',{ok:true,waypoints:{pickApproach:[0]} as never})).toThrow('ARM_PROGRAM_INVALID');
});
test('without beliefGrasp the program runs the fixture waypoints at once, as before',()=>{
 const h=make(false),home=[...h.state.q];h.plant.execute(cmd('c1'));expect(h.plant.graspPending()).toBeNull();
 for(let i=0;i<5;i++)h.tick();expect(h.state.commandedQ).not.toEqual(home);
});
test('the next cup-pick waits for its own plan; a cup-place is not gated',()=>{
 const h=make();h.plant.execute(cmd('c1'));h.plant.setGraspPlan('c1',{ok:false,code:'GRASP_UNREACHABLE'});h.tick();
 h.plant.execute(cmd('c2'));expect(h.plant.graspPending()).toEqual({commandId:'c2',program:'cup-pick'});
 h.plant.setGraspPlan('c2',{ok:false,code:'GRASP_UNREACHABLE'});h.tick();
 const h2=make();h2.plant.execute(cmd('p1','cup-place'));expect(h2.plant.graspPending()).toBeNull();
});

// V13: the pick whose grip is known not to have formed waits for the decision of the plant's ports; the table's steps are executed by the plant.
const toGripFailure=(recovery=true)=>{const h=make(true,recovery);h.plant.execute(cmd('c1'));h.tick();h.plant.setGraspPlan('c1',{ok:true,waypoints:planned(h.set)});
 for(let i=0;i<2000&&!h.plant.gripFailedPending();i++){h.tick();if(h.state.programs[0]!.state!=='running')break;}return h;};
test('without a recovery policy a grip that did not form still completes with objectPresent false (R2b behaviour)',()=>{
 const h=toGripFailure(false);expect(h.plant.gripFailedPending()).toBeNull();
 for(let i=0;i<600&&h.state.programs[0]!.state==='running';i++)h.tick();
 expect(h.state.programs[0]!.state).toBe('completed');expect(h.state.programs[0]!.evidence).toMatchObject({objectPresent:false});
});
test('with a recovery policy a missed grip freezes the arm and the program stays running until the ports decide',()=>{
 const h=toGripFailure();expect(h.plant.gripFailedPending()).toEqual({commandId:'c1'});
 const q=[...h.state.q];for(let i=0;i<50;i++){h.tick();expect(h.state.programs[0]!.state).toBe('running');}expect(h.state.q).toEqual(q);expect(h.plant.gripFailedPending()).toEqual({commandId:'c1'});
});
test('giving up latches the arm like a lost cup: the program is unknown with the reason, never completed',()=>{
 const h=toGripFailure();h.plant.failGrip('c1','RECOVERY_FACTS_MISSING');
 expect(h.state.programs[0]!.state).toBe('unknown');expect(h.state.stop).toMatchObject({latched:true,reason:'RECOVERY_FACTS_MISSING'});expect(h.plant.gripFailedPending()).toBeNull();
});
test('the recovery steps: open the gripper (settled after its ticks), retreat to the planned approach, wait for a plan, and the retry goes to the new plan',()=>{
 const h=toGripFailure();
 let r=h.plant.recoverStep('c1','open_gripper');expect(r).toBe('running');expect(h.state.gripper).toBe('open');expect(h.state.gripperCommandM).toBe(CONTACT.openM);
 for(let i=0;i<CONTACT.gripSettleTicks+2&&r!=='done';i++){h.tick();r=h.plant.recoverStep('c1','open_gripper');}expect(r).toBe('done');
 r=h.plant.recoverStep('c1','retreat_pick_approach');for(let i=0;i<800&&r!=='done';i++){h.tick();r=h.plant.recoverStep('c1','retreat_pick_approach');}
 expect(r).toBe('done');expect(h.plant.graspPending()).toEqual({commandId:'c1',program:'cup-pick'});expect(h.state.programs[0]!.state).toBe('running');
 const first=planned(h.set),again={pickApproach:first.pickApproach,pick:first.pick.map(v=>v+0.01),lift:first.lift};
 h.plant.setGraspPlan('c1',{ok:true,waypoints:again});
 for(let i=0;i<800&&!h.plant.gripFailedPending();i++)h.tick();
 expect(h.state.programs[0]!.index).toBe(1);expect(h.state.q.every((v,i)=>Math.abs(v-again.pick[i]!)<=TRACKING.reachTolRad)).toBe(true); // the second grip was attempted at the NEW pick pose
});
