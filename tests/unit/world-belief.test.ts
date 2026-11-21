// V11: the belief side of a cell run, driven without an engine: truth in, estimates recorded and applied, the grasp decided (waiting, refusing, planning) and its outcome recorded, with the attempt on the stream BEFORE the plant is told.
import {expect,test} from 'vitest';
import {createWorldBelief,type ArmFacade} from '../../packages/lab-runtime/src/v2/perception/world-belief';
import type {GraspAttempt,PerceptionProfileV1} from '../../packages/contracts/generated/navigation2d';
const profile=(o:object={})=>({schemaVersion:1,id:'t',revision:1,digest:'0'.repeat(64),updateEveryTicks:10,latencyTicks:5,biasM:[0,0],sigmaM:[0,0],dropoutProbability:0,visibleRegionId:'nozzle-stand',maxAgeTicks:50,...o}) as unknown as PerceptionProfileV1;
const id=[0,0,0,1] as [number,number,number,number];
const offsets={pickApproach:{positionM:[0,-0.1,0] as [number,number,number],quaternionXyzw:id},pick:{positionM:[0.022,0,-0.001] as [number,number,number],quaternionXyzw:id},lift:{positionM:[0,0,0.15] as [number,number,number],quaternionXyzw:id}};
const q=[0,0,0,0,0,0],seeds={pickApproach:q,pick:q,lift:q};
const view={centerM:[0.49,0] as [number,number],halfExtentM:[0.05,0.05] as [number,number],supportId:'nozzle-stand'};
const region={centerM:[0.49,0] as [number,number],halfExtentM:[0.02,0.02] as [number,number]};
const ok=(p:{positionM:number[]})=>({ok:true as const,q:[p.positionM[0]!,p.positionM[1]!,p.positionM[2]!,0,0,0],residual:{positionM:1e-6,orientationRad:1e-6,condition:10}});
function make(o:{profile?:PerceptionProfileV1;beliefWaitTicks?:number;solve?:never;sweep?:never;mode?:'belief_ground_truth'|'belief_estimated'}={}){
 const log:string[]=[],attempts:GraspAttempt[]=[],beliefs:unknown[]=[];
 const recorder={appendBelief:async(r:unknown)=>{beliefs.push(r);},appendAttempt:async(a:GraspAttempt)=>{log.push(`attempt:${a.attemptId}:${a.outcome}`);attempts.push(a);},appendRecovery:async()=>{}};
 const prog={state:'running',evidence:{} as Record<string,unknown>};let pending:{commandId:string}|null=null,stopReason:string|undefined;
 const arm:ArmFacade={graspPending:()=>pending,setGraspPlan:(c,p)=>{log.push(`plan:${c}:${p.ok?'ok':p.code}`);pending=null;},program:()=>prog,stopReason:()=>stopReason};
 const wb=createWorldBelief({mode:o.mode??'belief_estimated',profile:o.profile??profile(),seed:42,cups:[{cupId:'cup-1',propId:'prop-1'}],recorder,view,region,beliefWaitTicks:o.beliefWaitTicks??250,graspOffsets:offsets,seeds,
  solve:o.solve??((p:{positionM:number[]})=>ok(p)) as never,sweep:o.sweep??(()=>({ok:true})) as never,cupOf:()=>'cup-1'});
 const truth=(x=0.49,resting:string|null='nozzle-stand')=>[{propId:'prop-1',position:[x,0,0.151] as [number,number,number],restingOn:resting}];
 return {wb,arm,log,attempts,beliefs,prog,setPending:(c:string|null)=>{pending=c?{commandId:c}:null;},setStop:(r:string)=>{stopReason=r;},truth};
}
const run=async(h:ReturnType<typeof make>,from:number,to:number,props=h.truth())=>{for(let t=from;t<=to;t++){await h.wb.observe(t,props);await h.wb.step(t,h.arm);}};

test('truth in, estimates out: updates are recorded on their own cadence, the last estimate is the delayed truth',async()=>{
 const h=make();await run(h,0,100);
 expect(h.beliefs.length).toBeGreaterThanOrEqual(9);
 const r=h.beliefs.at(-1) as {tick:number;belief:{observedTick:number}};expect(r.tick).toBe(100);expect(r.belief.observedTick).toBe(95);
});
test('a pending pick with a fresh belief is planned; the attempt is on the stream before the plant is told',async()=>{
 const h=make();await run(h,0,60);h.setPending('c1');await run(h,61,62);
 expect(h.log).toEqual(['attempt:cup-1#0:unknown','plan:c1:ok']);
 expect(h.attempts[0]).toMatchObject({cupId:'cup-1',mode:'belief_estimated',gates:{belief:'pass',region:'pass',ik:'pass',sweep:'pass'}});
 expect(h.attempts[0]!.beliefErrorAtCommitM).toBeCloseTo(0,9);
});
test('without a belief the grasp waits, writes nothing, then refuses BELIEF_UNAVAILABLE after beliefWaitTicks',async()=>{
 const h=make({beliefWaitTicks:40});h.setPending('c1');await run(h,0,30,[]);
 expect(h.log).toEqual([]);
 await run(h,31,60,[]);
 expect(h.log).toEqual(['attempt:cup-1#0:refused','plan:c1:BELIEF_UNAVAILABLE']);expect(h.attempts[0]).toMatchObject({refusal:'BELIEF_UNAVAILABLE',beliefUsed:null});
});
test('a belief outside the work region refuses at once, with no waiting',async()=>{
 const h=make();await run(h,0,60,h.truth(0.52));h.setPending('c1');await run(h,61,61,h.truth(0.52));
 expect(h.log).toEqual(['attempt:cup-1#0:refused','plan:c1:BELIEF_OUT_OF_REGION']);
});
test('a cup that is not on the stand is out of view: no belief, so the pick waits',async()=>{
 const h=make({beliefWaitTicks:30});await run(h,0,60,h.truth(0.49,null));expect((h.beliefs.at(-1) as {reason?:string}).reason).toBe('OUT_OF_VIEW');
 h.setPending('c1');await run(h,61,100,h.truth(0.49,null));expect(h.log).toEqual(['attempt:cup-1#0:refused','plan:c1:BELIEF_UNAVAILABLE']);
});
test('the outcome of a planned attempt is appended once the program ends: lifted, grip not established, cup dropped, unknown',async()=>{
 const cases:[string,object,string|undefined,string][]=[['completed',{liftPoseReached:true},undefined,'lifted'],['completed',{objectPresent:false,liftPoseReached:false},undefined,'grip_not_established'],['unknown',{},'CUP_DROPPED','cup_dropped'],['unknown',{},'ARM_COLLISION','unknown']];
 for(const [state,evidence,stop,outcome] of cases){
  const h=make();await run(h,0,60);h.setPending('c1');await run(h,61,62);
  h.prog.state=state;h.prog.evidence=evidence as never;if(stop)h.setStop(stop);await run(h,63,64);
  expect(h.attempts.map(a=>a.outcome),outcome).toEqual(['unknown',outcome]);expect(h.attempts[1]!.attemptId).toBe('cup-1#0');
 }
});
test('the decision code sees the belief, never the truth: a biased estimator plans from the biased position',async()=>{
 let planned:number[]|undefined;const h=make({profile:profile({biasM:[0.01,0]}),solve:(p:{positionM:number[]})=>{planned??=p.positionM;return ok(p);}} as never);
 await run(h,0,60);h.setPending('c1');await run(h,61,61);
 expect(planned![0]).toBeCloseTo(0.49+0.01,9); // the first waypoint (pickApproach) is the believed x (truth 0.49 + bias) plus its offset 0
 expect(h.attempts[0]!.beliefErrorAtCommitM).toBeCloseTo(0.01,9);
});
