// V13: the recovery side of a cell run without an engine. A grip that is known to have failed is recovered from by the table, within its bound, each step recorded BEFORE it is done; anything else ends in a person.
import {expect,test} from 'vitest';
import {createWorldBelief,type ArmFacade} from '../../packages/lab-runtime/src/v2/perception/world-belief';
import policy from '../../robotics/simulation-mujoco/fixtures/recovery-v1/pick-recovery-v1.json';
import type {GraspAttempt,PerceptionProfileV1,RecoveryStep} from '../../packages/contracts/generated/navigation2d';
const profile={schemaVersion:1,id:'t',revision:1,digest:'0'.repeat(64),updateEveryTicks:10,latencyTicks:5,biasM:[0,0],sigmaM:[0,0],dropoutProbability:0,visibleRegionId:'nozzle-stand',maxAgeTicks:50} as unknown as PerceptionProfileV1;
const id=[0,0,0,1] as [number,number,number,number],q=[0,0,0,0,0,0];
const offsets={pickApproach:{positionM:[0,-0.1,0] as [number,number,number],quaternionXyzw:id},pick:{positionM:[0.022,0,-0.001] as [number,number,number],quaternionXyzw:id},lift:{positionM:[0,0,0.15] as [number,number,number],quaternionXyzw:id}};
const view={centerM:[0.49,0] as [number,number],halfExtentM:[0.05,0.05] as [number,number],supportId:'nozzle-stand'},region={centerM:[0.49,0] as [number,number],halfExtentM:[0.02,0.02] as [number,number]};
function make(o:{facts?:{armFresh:boolean;noUnknown:boolean};recoverTicks?:number}={}){
 const log:string[]=[],attempts:GraspAttempt[]=[],steps:RecoveryStep[]=[];
 const recorder={appendBelief:async()=>{},appendAttempt:async(a:GraspAttempt)=>{log.push(`attempt:${a.attemptId}:${a.outcome}`);attempts.push(a);},appendRecovery:async(s:RecoveryStep)=>{log.push(`recovery:${s.action}:${s.result}`);steps.push(s);}};
 const prog={state:'running',evidence:{} as Record<string,unknown>};let pending:{commandId:string}|null=null,failed:{commandId:string}|null=null,commitP:{commandId:string}|null=null,doing=0;
 const arm:ArmFacade={graspPending:()=>pending,setGraspPlan:(c,p)=>{log.push(`plan:${c}:${p.ok?'ok':p.code}`);pending=null;},program:()=>prog,stopReason:()=>undefined,
  commitPending:()=>commitP,setCommitPlan:(c,p)=>{log.push(`commit:${c}:${p.ok?'ok':p.code}`);commitP=null;},gripFailedPending:()=>failed,failGrip:(c,r)=>{log.push(`fail:${c}:${r}`);failed=null;},facts:()=>o.facts??{armFresh:true,noUnknown:true},
  recoverStep:(c,a)=>{if(!doing)log.push(`do:${a}`);doing++;if(doing<(o.recoverTicks??2))return 'running';doing=0;if(a==='retreat_pick_approach'){failed=null;commitP={commandId:c};}return 'done';}};
 const wb=createWorldBelief({mode:'belief_estimated',profile,seed:42,cups:[{cupId:'cup-1',propId:'prop-1'}],recorder,view,region,beliefWaitTicks:250,graspOffsets:offsets,seeds:{pickApproach:q,pick:q,lift:q},
  solve:((p:{positionM:number[]})=>({ok:true,q:[...p.positionM,0,0,0],residual:{positionM:1e-6,orientationRad:1e-6,condition:10}})) as never,sweep:(()=>({ok:true})) as never,cupOf:()=>'cup-1',
  recovery:{policy:policy as never,declaredSupportId:'nozzle-stand'}});
 const truth=[{propId:'prop-1',position:[0.49,0,0.151] as [number,number,number],restingOn:'nozzle-stand' as string|null}];
 return {wb,log,attempts,steps,truth,arm,setCommit:(c:string|null)=>{commitP=c?{commandId:c}:null;},prog,setPending:(c:string|null)=>{pending=c?{commandId:c}:null;},setFailed:(c:string|null)=>{failed=c?{commandId:c}:null;}};
}
const run=async(h:ReturnType<typeof make>,from:number,to:number,o:{held?:string[];props?:ReturnType<typeof make>['truth']}={})=>{for(let t=from;t<=to;t++){await h.wb.observe(t,o.props??h.truth);await h.wb.step(t,h.arm,{heldPropIds:o.held??[]});}};
const failOnce=async(h:ReturnType<typeof make>,from:number,o:Parameters<typeof run>[3]={})=>{h.setPending('c1');await run(h,from,from);h.setCommit('c1');await run(h,from+1,from+1);h.setFailed('c1');await run(h,from+2,from+32,o);};

test('a grip that did not form, with every fact observed, is recovered: steps in table order, each recorded before it is done, then the pick is planned again as attempt 2',async()=>{
 const h=make();await run(h,0,60);await failOnce(h,61);
 const i=(s:string)=>h.log.indexOf(s);
 expect(h.log.filter(l=>l.startsWith('attempt:cup-1#0'))).toEqual(['attempt:cup-1#0:unknown','attempt:cup-1#0:unknown','attempt:cup-1#0:grip_not_established']); // the plan, the commit at the approach, the outcome
 for(const a of ['open_gripper','retreat_pick_approach','await_fresh_belief','retry_pick'])expect(i(`recovery:${a}:pending`),a).toBeGreaterThan(-1);
 expect(i('recovery:open_gripper:pending')).toBeLessThan(i('do:open_gripper'));expect(i('do:open_gripper')).toBeLessThan(i('recovery:open_gripper:done'));
 expect(i('recovery:retry_pick:done')).toBeLessThan(h.log.lastIndexOf('commit:c1:ok'));
 expect([...new Set(h.attempts.filter(a=>a.outcome==='unknown').map(a=>a.attemptId))]).toEqual(['cup-1#0','cup-1#1']);
});
test('a cup that may still be between the pads is never released: facts missing, a person is asked, nothing is done',async()=>{
 const h=make();await run(h,0,60);h.setPending('c1');await run(h,61,61);h.setCommit('c1');await run(h,62,62);h.setFailed('c1');await run(h,63,70,{held:['prop-1']});
 expect(h.log.filter(l=>l.startsWith('do:')||l.startsWith('recovery:'))).toEqual([]);expect(h.log).toContain('fail:c1:RECOVERY_FACTS_MISSING');
});
test('the cup is no longer on the declared support (fell, or was pushed off): not recovered',async()=>{
 const h=make();await run(h,0,60);h.setPending('c1');await run(h,61,61);h.setCommit('c1');await run(h,62,62);h.setFailed('c1');await run(h,63,70,{props:[{...h.truth[0]!,restingOn:null}]});
 expect(h.log).toContain('fail:c1:RECOVERY_FACTS_MISSING');expect(h.log.filter(l=>l.startsWith('do:'))).toEqual([]);
});
test('an unknown command or a stale arm state is not recovered',async()=>{
 for(const facts of [{armFresh:false,noUnknown:true},{armFresh:true,noUnknown:false}]){
  const h=make({facts});await run(h,0,60);h.setPending('c1');await run(h,61,61);h.setCommit('c1');await run(h,62,62);h.setFailed('c1');await run(h,63,70);
  expect(h.log).toContain('fail:c1:RECOVERY_FACTS_MISSING');expect(h.log.filter(l=>l.startsWith('do:'))).toEqual([]);
 }
});
test('two failures are recovered, the third ends in RECOVERY_EXHAUSTED',async()=>{
 const h=make();await run(h,0,60);await failOnce(h,61);await failOnce(h,100);
 h.setPending('c1');await run(h,140,140);h.setCommit('c1');await run(h,141,141);h.setFailed('c1');await run(h,142,160);
 expect(h.log.filter(l=>l==='recovery:open_gripper:pending')).toHaveLength(2);expect(h.log).toContain('fail:c1:RECOVERY_EXHAUSTED');
});
test('an estimate that never comes after the retreat asks a person, not forever',async()=>{
 const h=make();await run(h,0,60);h.setPending('c1');await run(h,61,61);h.setFailed('c1');
 await run(h,62,62);for(let t=63;t<=700;t++){await h.wb.observe(t,[]);await h.wb.step(t,h.arm,{heldPropIds:[]});}
 expect(h.log.some(l=>l.startsWith('fail:c1:BELIEF_'))).toBe(true);
});

test('the commit plan is decided when the arm reaches the approach, from the belief of THAT moment: the cup moved after the first plan is picked up where it is now, and the nudge counts as after the commit only from there',async()=>{
 const planned:number[][]=[];const h=make();
 const wb2=createWorldBelief({mode:'belief_estimated',profile,seed:42,cups:[{cupId:'cup-1',propId:'prop-1'}],recorder:{appendBelief:async()=>{},appendAttempt:async(a:GraspAttempt)=>{h.log.push(`attempt:${a.attemptId}:${a.outcome}:${a.decidedTick}`);},appendRecovery:async()=>{}},view,region,beliefWaitTicks:250,graspOffsets:offsets,seeds:{pickApproach:q,pick:q,lift:q},
  solve:((p:{positionM:number[]})=>{planned.push([...p.positionM]);return {ok:true,q:[...p.positionM,0,0,0],residual:{positionM:1e-6,orientationRad:1e-6,condition:10}};}) as never,sweep:(()=>({ok:true})) as never,cupOf:()=>'cup-1'});
 const at=(x:number)=>[{propId:'prop-1',position:[x,0,0.151] as [number,number,number],restingOn:'nozzle-stand' as string|null}];
 for(let t=0;t<=60;t++){await wb2.observe(t,at(0.49));await wb2.step(t,h.arm);}
 h.setPending('c1');await wb2.observe(61,at(0.49));await wb2.step(61,h.arm);expect(wb2.committed('cup-1')).toBe(false);
 const first=planned.length;
 for(let t=62;t<=140;t++){await wb2.observe(t,at(0.499));await wb2.step(t,h.arm);} // the cup moves 9 mm while the arm approaches; the belief follows
 h.setCommit('c1');await wb2.observe(141,at(0.499));await wb2.step(141,h.arm);
 expect(h.log.filter(l=>l.startsWith('attempt:cup-1#0'))).toHaveLength(2); // the plan record and the commit record of the same attempt
 expect(planned[first]![0]).toBeCloseTo(0.499+0.0,2);expect(planned[0]![0]).toBeCloseTo(0.49,2);expect(h.log).toContain('commit:c1:ok');expect(wb2.committed('cup-1')).toBe(true);
});
test('a commit whose belief went stale waits, then refuses BELIEF_STALE after beliefWaitTicks: never a descent on an old estimate',async()=>{
 const h=make();await run(h,0,60);h.setPending('c1');await run(h,61,61);
 for(let t=62;t<=160;t++){await h.wb.observe(t,[]);await h.wb.step(t,h.arm);}h.setCommit('c1'); // the arm reaches its approach after the estimate has aged out
 for(let t=161;t<=1100;t++){await h.wb.observe(t,[]);await h.wb.step(t,h.arm);} // the cup left the view: no estimate any more; the table repeats the wait twice, then a person
 expect(h.log.filter(l=>l.startsWith('commit:'))).toEqual(['commit:c1:BELIEF_STALE']);expect(h.attempts.at(-1)).toMatchObject({outcome:'refused',refusal:'BELIEF_STALE'});
});
test('a recovery whose program has ended or latched is dropped: no further step, the failed step is on the stream',async()=>{
 const h=make();await run(h,0,60);await failOnce(h,61);
 // second failure: recovery starts, then the arm stops during the open step
 h.setPending('c1');await run(h,100,100);h.setCommit('c1');await run(h,101,101);h.setFailed('c1');await run(h,102,103);
 h.prog.state='unknown';const before=h.log.filter(l=>l.startsWith('do:')).length;await run(h,104,120);
 expect(h.log.filter(l=>l.startsWith('do:')).length).toBe(before);expect(h.steps.some(s=>s.result==='failed')).toBe(true);
});
test('a belief that is not usable at the first plan is waited for again by the belief-not-usable rule, twice at most, then a person',async()=>{
 const h=make();h.setPending('c1');for(let t=0;t<=1200;t++){await h.wb.observe(t,[]);await h.wb.step(t,h.arm,{heldPropIds:[]});}
 expect(h.steps.filter(s=>s.rule==='belief-not-usable'&&s.result==='pending')).toHaveLength(2);expect(h.log.filter(l=>l.startsWith('plan:'))).toEqual(['plan:c1:BELIEF_UNAVAILABLE']);
});
test('a fresh belief after a retreat is one OBSERVED after the retreat ended, not one published later about the old scene',async()=>{
 const h=make();await run(h,0,60);h.setPending('c1');await run(h,61,61);h.setCommit('c1');await run(h,62,62);h.setFailed('c1');
 // the open step takes 2 ticks, the retreat 2: an estimate published right after still describes ticks before the retreat ended (latency 5)
 await run(h,63,63);const ticks:number[]=[];for(let t=64;t<=120;t++){await h.wb.observe(t,h.truth);await h.wb.step(t,h.arm,{heldPropIds:[]});if(h.log.includes('recovery:await_fresh_belief:done')&&!ticks.length)ticks.push(t);}
 const retreatDone=h.steps.find(s=>s.action==='retreat_pick_approach'&&s.result==='done')!.completedTick!,awaited=h.steps.find(s=>s.action==='await_fresh_belief'&&s.result==='done')!.completedTick!;
 expect(awaited-retreatDone).toBeGreaterThanOrEqual(profile.latencyTicks); // observed (= published - latency) after the retreat ended
});
