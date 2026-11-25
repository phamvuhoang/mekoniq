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
function make(belief=true,recovery=false,captureM?:number){
 const set=programs(belief,recovery);if(captureM!==undefined)set.contact={...set.contact!,captureM};const state=MockArmPlant.initial('arm','boot-0:arm',set),reports:CellReport[]=[];
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
 let reached=-1;for(let i=0;i<600&&reached<0;i++){h.tick();if(h.plant.commitPending())reached=i;}
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

// R4.4 commit gate: at the end of the approach the arm holds and waits for the commit plan, the moment the descent starts (spec §5.3); only then does it go down, to the committed pick and lift.
const toApproach=(recovery=false)=>{const h=make(true,recovery);h.plant.execute(cmd('c1'));h.tick();h.plant.setGraspPlan('c1',{ok:true,waypoints:planned(h.set)});
 for(let i=0;i<2000&&!h.plant.commitPending();i++)h.tick();return h;};
const commit=(h:ReturnType<typeof make>,pickShift=0)=>{const p=planned(h.set);h.plant.setCommitPlan('c1',{ok:true,waypoints:{pick:p.pick.map(v=>v+pickShift),lift:p.lift}});return p;};
test('the arm holds at the end of the approach until the commit plan: no motion, the program stays running, index 0',()=>{
 const h=toApproach();expect(h.plant.commitPending()).toEqual({commandId:'c1'});const q=[...h.state.q];
 for(let i=0;i<50;i++){h.tick();expect(h.state.programs[0]!.state).toBe('running');expect(h.state.programs[0]!.index).toBe(0);}expect(h.state.q).toEqual(q);expect(h.plant.commitPending()).toEqual({commandId:'c1'});
});
test('the commit plan sets the pick and lift the arm goes down to; the approach it came to is kept',()=>{
 const h=toApproach(),before=[...h.state.q];commit(h,0.01);expect(h.plant.commitPending()).toBeNull();
 for(let i=0;i<800&&h.state.programs[0]!.index<1;i++)h.tick();
 expect(h.state.programs[0]!.index).toBe(1);expect(h.state.q.every((v,i)=>Math.abs(v-before[i]!)<=TRACKING.reachTolRad)).toBe(true); // still at the approach: no second visit to a new one
 for(let i=0;i<800&&h.state.programs[0]!.index<2&&h.state.programs[0]!.state==='running'&&!h.plant.gripFailedPending();i++)h.tick();
 expect(h.state.q.every((v,i)=>Math.abs(v-(planned(h.set).pick[i]!+(i===0?0.01:0)))<=TRACKING.reachTolRad+0.05)).toBe(true);
});
test('a refused commit fails the program with its code, the arm stays at the approach',()=>{
 const h=toApproach(),q=[...h.state.q];h.plant.setCommitPlan('c1',{ok:false,code:'BELIEF_STALE'});h.tick();
 expect(h.state.programs[0]!.state).toBe('failed');expect(h.state.q).toEqual(q);
});
test('a commit plan is refused when nothing waits for it or a waypoint is out of limits',()=>{
 const h=make(true);h.plant.execute(cmd('c1'));h.tick();expect(()=>h.plant.setCommitPlan('c1',{ok:true,waypoints:{pick:[0,0,0,0,0,0],lift:[0,0,0,0,0,0]}})).toThrow('GRASP_PLAN_NOT_PENDING');
 const g=toApproach();expect(()=>g.plant.setCommitPlan('c1',{ok:true,waypoints:{pick:g.state.q.map(()=>99),lift:g.state.q}})).toThrow('ARM_PROGRAM_INVALID');
});
// V13: the pick whose grip is known not to have formed waits for the decision of the plant's ports; the table's steps are executed by the plant.
const toGripFailure=(recovery=true)=>{const h=toApproach(recovery);commit(h);
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
test('the recovery steps: open the gripper, retreat to the approach and wait there for a commit plan, and the retry commits a NEW pick without leaving the approach',()=>{
 const h=toGripFailure();
 let r=h.plant.recoverStep('c1','open_gripper');expect(r).toBe('running');expect(h.state.gripper).toBe('open');expect(h.state.gripperCommandM).toBe(CONTACT.openM);
 for(let i=0;i<CONTACT.gripSettleTicks+2&&r!=='done';i++){h.tick();r=h.plant.recoverStep('c1','open_gripper');}expect(r).toBe('done');
 r=h.plant.recoverStep('c1','retreat_pick_approach');for(let i=0;i<800&&r!=='done';i++){h.tick();r=h.plant.recoverStep('c1','retreat_pick_approach');}
 expect(r).toBe('done');expect(h.plant.commitPending()).toEqual({commandId:'c1'});expect(h.state.programs[0]!.state).toBe('running');expect(h.state.programs[0]!.index).toBe(0);
 const p=planned(h.set);h.plant.setCommitPlan('c1',{ok:true,waypoints:{pick:p.pick.map(v=>v+0.01),lift:p.lift}});
 for(let i=0;i<1600&&!h.plant.gripFailedPending();i++)h.tick();
 expect(h.state.programs[0]!.index).toBe(1);expect(h.state.q.every((v,i)=>Math.abs(v-(p.pick[i]!+0.01))<=TRACKING.reachTolRad)).toBe(true); // the second grip was attempted at the NEW pick pose
});
test('a recovery that cannot finish ends the command from any recovery status instead of throwing: retreating or waiting for the commit',()=>{
 for(const stage of ['retreating','commit']){
  const h=toGripFailure();h.plant.recoverStep('c1','open_gripper');for(let i=0;i<CONTACT.gripSettleTicks+2;i++){h.tick();if(h.plant.recoverStep('c1','open_gripper')==='done')break;}
  h.plant.recoverStep('c1','retreat_pick_approach');
  if(stage==='commit')for(let i=0;i<800&&!h.plant.commitPending();i++){h.tick();h.plant.recoverStep('c1','retreat_pick_approach');}
  h.plant.failGrip('c1','BELIEF_STALE');
  expect(h.state.programs[0]!.state,stage).toBe('unknown');expect(h.state.stop).toMatchObject({latched:true,reason:'BELIEF_STALE'});
 }
});
// R02: an observation never advances the choreography of a pick that waits for a decision (the plan, the commit, the recovery), and never commands the gripper for it, also when the plan equals the fixture waypoints.
const same=(set:ArmProgramSet)=>({pickApproach:[...set.waypoints.pickApproach!],pick:[...set.waypoints.pick!],lift:[...set.waypoints.lift!]});
test('R02: waiting for the commit with a plan equal to the fixture waypoints, observations do not advance the program',()=>{
 const h=make(true);h.plant.execute(cmd('c1'));h.plant.setGraspPlan('c1',{ok:true,waypoints:same(h.set)});
 for(let i=0;i<2000&&!h.plant.commitPending();i++)h.tick();expect(h.plant.commitPending()).toEqual({commandId:'c1'});
 for(let i=0;i<60;i++){h.tick();expect(h.state.programs[0]!.index).toBe(0);expect(h.plant.commitPending()).toEqual({commandId:'c1'});}
});
test('R02: after a missed grip the observation of the next tick does not close the gripper again, take a cup or advance, even when it reports one between the pads',()=>{
 const h=make(true,true);h.plant.execute(cmd('c1'));h.plant.setGraspPlan('c1',{ok:true,waypoints:same(h.set)});
 for(let i=0;i<2000&&!h.plant.commitPending();i++)h.tick();
 h.plant.setCommitPlan('c1',{ok:true,waypoints:{pick:same(h.set).pick,lift:same(h.set).lift}});
 for(let i=0;i<2000&&!h.plant.gripFailedPending();i++)h.tick();expect(h.plant.gripFailedPending()).toEqual({commandId:'c1'});
 const index=h.state.programs[0]!.index;h.plant.recoverStep('c1','open_gripper');expect(h.state.gripperCommandM).toBe(CONTACT.openM);
 for(const held of [[],['prop-1'],['prop-1']]){h.plant.advance();h.plant.observe(h.plant.state.commandedQ??h.plant.state.q,[],{gripper:{openingM:0.0889,heldPropIds:held},props:[]});
  expect(h.state.programs[0]!.index).toBe(index);expect(h.state.grasp!.status).toBe('grip_failed');expect(h.state.gripperCommandM).toBe(CONTACT.openM);expect(h.state.holding).toBeNull();}
});
test('two-stage recovery opens fully, repeats capture on retry, and secures only after retry contact is stable',()=>{
 const h=make(true,true,0.07);h.plant.execute(cmd('c1'));h.plant.setGraspPlan('c1',{ok:true,waypoints:same(h.set)});
 for(let i=0;i<2000&&!h.plant.commitPending();i++)h.tick();commit(h);
 for(let i=0;i<2000&&!h.plant.gripFailedPending();i++)h.tick();
 expect(h.plant.gripFailedPending()).toEqual({commandId:'c1'});expect(h.state.gripperCommandM).toBe(0.07);expect(h.state.holding).toBeNull();
 let opened=h.plant.recoverStep('c1','open_gripper');expect(h.state.gripperCommandM).toBe(CONTACT.openM);
 for(let i=0;i<50&&opened!=='done';i++){h.tick();opened=h.plant.recoverStep('c1','open_gripper');}expect(opened).toBe('done');
 let retreat=h.plant.recoverStep('c1','retreat_pick_approach');
 for(let i=0;i<2000&&retreat!=='done';i++){h.tick();retreat=h.plant.recoverStep('c1','retreat_pick_approach');}expect(retreat).toBe('done');commit(h);
 for(let i=0;i<2000&&h.state.gripper!=='closed';i++)h.tick();
 expect(h.state.gripperCommandM).toBe(0.07);expect(h.state.holding).toBeNull();
 // A pad observation cannot bypass the existing stable-opening threshold.
 for(let i=0;i<CONTACT.gripSettleTicks+5&&h.state.holding===null;i++){
  h.plant.advance();h.plant.observe(h.state.commandedQ??h.state.q,[],{gripper:{openingM:0.0793,heldPropIds:['cup-1']},props:[]});
  if(h.state.holding===null)expect(h.state.gripperCommandM).toBe(0.07);
 }
 expect(h.state.holding).toBe('cup-1');expect(h.state.gripperCommandM).toBe(0);expect(h.state.programs[0]!.index).toBe(2);
});

// A known exhausted empty grip is still latched, but its command outcome is known failed.
const emptyGripObservation=(h:ReturnType<typeof make>,held:string[]=[],restingOn:string|null='nozzle-stand')=>{
 h.plant.advance();h.plant.observe(h.state.commandedQ??h.state.q,[],{gripper:{openingM:0.0889,heldPropIds:held},props:[{propId:'prop-1',position:[0.49,0,0.15],restingOn}]});
 return {tick:h.state.tick,propId:'prop-1',declaredSupportId:'nozzle-stand'};
};
test('recovery freshness needs a current valid native observation, including a physical gripper opening',()=>{
 const h=toGripFailure();emptyGripObservation(h);expect(h.plant.recoveryFacts()).toEqual({armFresh:true,noUnknown:true});
 h.plant.advance();expect(h.plant.recoveryFacts().armFresh).toBe(false);
 h.plant.observe(h.state.q,[],{gripper:{openingM:-1,heldPropIds:[]},props:[]});expect(h.plant.recoveryFacts().armFresh).toBe(false);
 emptyGripObservation(h);h.state.limitsOk=false;expect(h.plant.recoveryFacts().armFresh).toBe(false);
});
test('a proven exhausted empty grip emits failed, retains the latch/reconcile requirement and never takes or opens a cup',()=>{
 const h=toGripFailure(),facts=emptyGripObservation(h),opening=h.state.gripperCommandM;
 h.plant.failGrip('c1','RECOVERY_EXHAUSTED',facts);
 expect(h.state.programs[0]!.state).toBe('failed');expect(h.plant.reconcile('c1')).toMatchObject({status:'failed',evidence:{objectPresent:false,cupId:null}});
 expect(h.reports.filter(r=>r.observation?.result!=='accepted'&&r.observation).map(r=>r.observation!.result)).toEqual(['failed']);
 expect(h.reports.at(-1)?.observation?.reasonCodes).toEqual(['RECOVERY_EXHAUSTED']);
 expect(h.state.stop).toMatchObject({latched:true,reconcileRequired:true,reason:'RECOVERY_EXHAUSTED'});expect(h.state.holding).toBeNull();expect(h.state.gripperCommandM).toBe(opening);
 for(let i=0;i<3;i++)h.tick();expect(h.plant.reconcile('c1').status).toBe('failed');expect(h.state.gripperCommandM).toBe(opening);
 expect(h.plant.execute(cmd('c2'))).toMatchObject({accepted:false,reason:'ARM_STOP_LATCHED'});
 h.plant.fault('arm-reset');expect(h.plant.execute(cmd('c2'))).toMatchObject({accepted:false,reason:'ARM_RECONCILE_REQUIRED'});
});
test.each(['no-context','wrong-tick','stale-native','wrong-prop','wrong-support','fallen','held-target','held-other','previously-held','unknown-command','missing-native','wrong-reason','before-grip'])('an exhausted label cannot turn ambiguous grip state into known failure: %s',change=>{
 const h=change==='before-grip'?toApproach(true):toGripFailure();
 const facts=emptyGripObservation(h,change==='held-target'?['prop-1']:change==='held-other'?['prop-2']:[],change==='fallen'?null:'nozzle-stand');
 if(change==='wrong-tick')facts.tick--;
 if(change==='stale-native')h.plant.advance();
 if(change==='wrong-prop')facts.propId='other';
 if(change==='wrong-support')facts.declaredSupportId='other';
 if(change==='previously-held')Object.assign(h.state.programs[0]!.evidence,{objectPresent:true,cupId:'prop-1'});
 if(change==='unknown-command')h.state.programs.push({...h.state.programs[0]!,commandId:'unknown-old',state:'unknown'});
 if(change==='missing-native'){h.plant.advance();h.plant.observe(h.state.commandedQ??h.state.q,[]);facts.tick=h.state.tick;}
 const opening=h.state.gripperCommandM;
 h.plant.failGrip('c1',change==='wrong-reason'?'BELIEF_STALE':'RECOVERY_EXHAUSTED',change==='no-context'?undefined:facts);
 expect(h.plant.reconcile('c1').status).toBe('unknown');expect(h.reports.some(r=>r.observation?.result==='outcome_unknown')).toBe(true);
 expect(h.state.stop).toMatchObject({latched:true,reconcileRequired:true});expect(h.state.gripperCommandM).toBe(opening);
});
