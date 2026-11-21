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
 const prog={state:'running',evidence:{} as Record<string,unknown>};let pending:{commandId:string}|null=null,failed:{commandId:string}|null=null,doing=0;
 const arm:ArmFacade={graspPending:()=>pending,setGraspPlan:(c,p)=>{log.push(`plan:${c}:${p.ok?'ok':p.code}`);pending=null;},program:()=>prog,stopReason:()=>undefined,
  gripFailedPending:()=>failed,failGrip:(c,r)=>{log.push(`fail:${c}:${r}`);failed=null;},facts:()=>o.facts??{armFresh:true,noUnknown:true},
  recoverStep:(c,a)=>{if(!doing)log.push(`do:${a}`);doing++;if(doing<(o.recoverTicks??2))return 'running';doing=0;if(a==='retreat_pick_approach'){failed=null;pending={commandId:c};}return 'done';}};
 const wb=createWorldBelief({mode:'belief_estimated',profile,seed:42,cups:[{cupId:'cup-1',propId:'prop-1'}],recorder,view,region,beliefWaitTicks:250,graspOffsets:offsets,seeds:{pickApproach:q,pick:q,lift:q},
  solve:((p:{positionM:number[]})=>({ok:true,q:[...p.positionM,0,0,0],residual:{positionM:1e-6,orientationRad:1e-6,condition:10}})) as never,sweep:(()=>({ok:true})) as never,cupOf:()=>'cup-1',
  recovery:{policy:policy as never,declaredSupportId:'nozzle-stand'}});
 const truth=[{propId:'prop-1',position:[0.49,0,0.151] as [number,number,number],restingOn:'nozzle-stand' as string|null}];
 return {wb,log,attempts,steps,truth,arm,setPending:(c:string|null)=>{pending=c?{commandId:c}:null;},setFailed:(c:string|null)=>{failed=c?{commandId:c}:null;}};
}
const run=async(h:ReturnType<typeof make>,from:number,to:number,o:{held?:string[];props?:ReturnType<typeof make>['truth']}={})=>{for(let t=from;t<=to;t++){await h.wb.observe(t,o.props??h.truth);await h.wb.step(t,h.arm,{heldPropIds:o.held??[]});}};
const failOnce=async(h:ReturnType<typeof make>,from:number,o:Parameters<typeof run>[3]={})=>{h.setPending('c1');await run(h,from,from);h.setFailed('c1');await run(h,from+1,from+30,o);};

test('a grip that did not form, with every fact observed, is recovered: steps in table order, each recorded before it is done, then the pick is planned again as attempt 2',async()=>{
 const h=make();await run(h,0,60);await failOnce(h,61);
 const i=(s:string)=>h.log.indexOf(s);
 expect(h.log.filter(l=>l.startsWith('attempt:cup-1#0'))).toEqual(['attempt:cup-1#0:unknown','attempt:cup-1#0:grip_not_established']);
 for(const a of ['open_gripper','retreat_pick_approach','await_fresh_belief','retry_pick'])expect(i(`recovery:${a}:pending`),a).toBeGreaterThan(-1);
 expect(i('recovery:open_gripper:pending')).toBeLessThan(i('do:open_gripper'));expect(i('do:open_gripper')).toBeLessThan(i('recovery:open_gripper:done'));
 expect(i('recovery:retry_pick:done')).toBeLessThan(h.log.lastIndexOf('plan:c1:ok'));
 expect(h.attempts.filter(a=>a.outcome==='unknown').map(a=>a.attemptId)).toEqual(['cup-1#0','cup-1#1']);
});
test('a cup that may still be between the pads is never released: facts missing, a person is asked, nothing is done',async()=>{
 const h=make();await run(h,0,60);h.setPending('c1');await run(h,61,61);h.setFailed('c1');await run(h,62,70,{held:['prop-1']});
 expect(h.log.filter(l=>l.startsWith('do:')||l.startsWith('recovery:'))).toEqual([]);expect(h.log).toContain('fail:c1:RECOVERY_FACTS_MISSING');
});
test('the cup is no longer on the declared support (fell, or was pushed off): not recovered',async()=>{
 const h=make();await run(h,0,60);h.setPending('c1');await run(h,61,61);h.setFailed('c1');await run(h,62,70,{props:[{...h.truth[0]!,restingOn:null}]});
 expect(h.log).toContain('fail:c1:RECOVERY_FACTS_MISSING');expect(h.log.filter(l=>l.startsWith('do:'))).toEqual([]);
});
test('an unknown command or a stale arm state is not recovered',async()=>{
 for(const facts of [{armFresh:false,noUnknown:true},{armFresh:true,noUnknown:false}]){
  const h=make({facts});await run(h,0,60);h.setPending('c1');await run(h,61,61);h.setFailed('c1');await run(h,62,70);
  expect(h.log).toContain('fail:c1:RECOVERY_FACTS_MISSING');expect(h.log.filter(l=>l.startsWith('do:'))).toEqual([]);
 }
});
test('two failures are recovered, the third ends in RECOVERY_EXHAUSTED',async()=>{
 const h=make();await run(h,0,60);await failOnce(h,61);await failOnce(h,100);
 h.setPending('c1');await run(h,140,141);h.setFailed('c1');await run(h,142,160);
 expect(h.log.filter(l=>l==='recovery:open_gripper:pending')).toHaveLength(2);expect(h.log).toContain('fail:c1:RECOVERY_EXHAUSTED');
});
test('an estimate that never comes after the retreat asks a person, not forever',async()=>{
 const h=make();await run(h,0,60);h.setPending('c1');await run(h,61,61);h.setFailed('c1');
 await run(h,62,62);for(let t=63;t<=700;t++){await h.wb.observe(t,[]);await h.wb.step(t,h.arm,{heldPropIds:[]});}
 expect(h.log.some(l=>l.startsWith('fail:c1:BELIEF_'))).toBe(true);
});
