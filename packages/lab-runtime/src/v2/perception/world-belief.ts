// R4.4 in a cell run: truth goes into the simulated estimator, estimates are recorded and applied to the belief world, and a belief grasp waiting for its plan is decided from the BeliefView alone.
// The attempt is on the durable stream BEFORE the plant is told its plan; a refusal never moves the arm. Truth is used for scoring only (`beliefErrorAtCommitM`, the BeliefRecord).
import type {GraspAttempt,PerceptionProfileV1,RecoveryPolicyV1,RecoveryStep} from '../../../../contracts/generated/navigation2d';
import {decideRecovery,type RecoveryAction,type RecoveryFact} from './recovery-policy';
import {createBeliefWorld,type BeliefView} from './belief';
import {planBeliefGrasp,type GraspPlanInput} from './grasp-conditioning';
import {createPoseEstimator,type TruthSample} from './pose-estimator-sim';
import type {BeliefRecorder} from './belief-evidence';
type Box={centerM:[number,number];halfExtentM:[number,number]};
/** What the world needs from the arm plant (MockArmPlant implements it; tests pass a fake). */
export interface ArmFacade {
 /** R4.4 recovery (a plant with a recovery policy only): the cup-pick whose grip is known not to have formed and that waits for the decision; the decision to give up (the program latches); what the plant itself knows of the arm; one recovery step of the plant (running until done). */
 gripFailedPending?():{commandId:string}|null;failGrip?(commandId:string,reason:string):void;facts?():{armFresh:boolean;noUnknown:boolean};recoverStep?(commandId:string,action:'open_gripper'|'retreat_pick_approach'):'running'|'done';
 graspPending():{commandId:string}|null;setGraspPlan(commandId:string,plan:{ok:true;waypoints:Record<'pickApproach'|'pick'|'lift',number[]>}|{ok:false;code:string}):void;
 program(commandId:string):{state:string;evidence:Record<string,unknown>}|undefined;stopReason():string|undefined}
export interface WorldBeliefOptions {mode:'belief_ground_truth'|'belief_estimated';profile:PerceptionProfileV1;seed:number;cups:readonly {cupId:string;propId:string}[];recorder:Pick<BeliefRecorder,'appendBelief'|'appendAttempt'|'appendRecovery'>;
 view:Box&{supportId:string};region:Box;beliefWaitTicks:number;graspOffsets:GraspPlanInput['graspOffsets'];seeds:GraspPlanInput['seeds'];solve:GraspPlanInput['solve'];sweep:GraspPlanInput['sweep'];
 /** The cup the transfer of this arm command is for; null while it is not known yet (the pick then waits). */cupOf(commandId:string):string|null;
 /** Present = a failed pick is recovered from by this table (V13); absent = R4.4 V11 behaviour, byte for byte. `declaredSupportId` is the support the cup is observed on to count as "on the declared support". */
 recovery?:{policy:RecoveryPolicyV1;declaredSupportId:string};
 /** Campaign rig / test only (never a request field): a modelled perception error that is added to the belief of the first `attempts` grasp attempts of each cup, like a transient mis-detection. The belief used and its error at commit are recorded as usual. */
 injectBias?:{vectorM:[number,number];attempts:number}}
type PropTruth={propId:string;position:readonly number[];restingOn:string|null};
export function createWorldBelief(o:WorldBeliefOptions){
 const world=createBeliefWorld(o.profile.maxAgeTicks),estimators=new Map(o.cups.map(c=>[c.cupId,createPoseEstimator(o.profile,o.seed,c.cupId)])),truth=new Map<string,Map<number,TruthSample>>(o.cups.map(c=>[c.cupId,new Map()]));
 const firstCommitted=new Set<string>(),keep=o.profile.latencyTicks+o.profile.updateEveryTicks+2,waitStart=new Map<string,number>(),index=new Map<string,number>(),open=new Map<string,GraspAttempt>();
 const recoveries=new Map<string,number>(),lastProps=new Map<string,PropTruth>();let active:{commandId:string;cupId:string;attemptId:string;rule:string;steps:RecoveryAction[];i:number;failTick:number;recorded:boolean;since:number}|null=null;
 const inView=(p:PropTruth)=>p.restingOn===o.view.supportId&&Math.abs(p.position[0]!-o.view.centerM[0])<=o.view.halfExtentM[0]&&Math.abs(p.position[1]!-o.view.centerM[1])<=o.view.halfExtentM[1];
 return {
  /** True once the first grasp plan of this cup was accepted (the attempt is on the stream, the arm goes down); the registered cup nudge of R4-D33 fires on it. */
  committed:(cupId:string)=>firstCommitted.has(cupId),
  /** How many grasp attempts of this cup were started (planned or refused). */
  attemptsStarted:(cupId:string)=>index.get(cupId)??0,
  /** Every tick, after the engine step: record where each cup is (truth, for the estimator and for scoring) and publish the estimates that are due. */
  async observe(tick:number,props:readonly PropTruth[]){
   for(const {cupId,propId} of o.cups){
    const p=props.find(x=>x.propId===propId),ring=truth.get(cupId)!;if(p)lastProps.set(cupId,p);else lastProps.delete(cupId);
    if(p){ring.set(tick,{tick,positionM:[p.position[0]!,p.position[1]!,p.position[2]!],inRegion:inView(p)});ring.delete(tick-keep);}
    const r=estimators.get(cupId)!.update(tick,t=>ring.get(t)??null);
    if(r){await o.recorder.appendBelief(r);world.apply(r);}
   }
  },
  /** Every tick, after the arm observed: decide a pending grasp, and record the outcome of the ones that ended. */
  async step(tick:number,arm:ArmFacade,obs?:{heldPropIds:readonly string[]}){
   const pend=arm.graspPending(),cupId=pend?o.cupOf(pend.commandId):null;
   const step=(a:typeof active&{},result:RecoveryStep['result'],completed:number|null):RecoveryStep=>({stepId:`${a.attemptId}/${a.rule}/${a.i}`,attemptId:a.attemptId,rule:a.rule,action:a.steps[a.i]!,commandId:`recovery:${a.commandId}:${a.i}`,recordedTick:a.since,completedTick:completed,result});
   // a recovery in progress owns the cup-pick: nothing is planned until its `retry_pick` step
   if(o.recovery&&active){const a=active,action=a.steps[a.i]!;
    if(!a.recorded){a.since=tick;await o.recorder.appendRecovery(step(a,'pending',null));a.recorded=true;}
    let done=false;
    if(action==='open_gripper'||action==='retreat_pick_approach')done=arm.recoverStep!(a.commandId,action)==='done';
    else if(action==='await_fresh_belief'){const v=world.view().get(a.cupId,tick);
     if(v.status==='ok'&&v.belief.publishedTick>a.failTick)done=true;
     else if(tick-a.since>=o.beliefWaitTicks){await o.recorder.appendRecovery(step(a,'failed',tick));arm.failGrip!(a.commandId,v.status==='ok'?'BELIEF_STALE':v.reason);active=null;return;}}
    else{done=true;waitStart.delete(a.commandId);} // retry_pick: the normal plan flow decides the next attempt
    if(done){await o.recorder.appendRecovery(step(a,'done',tick));a.i++;a.recorded=false;if(a.i>=a.steps.length)active=null;}
    return;
   }
   const failed=o.recovery?arm.gripFailedPending?.():null,failedCup=failed?o.cupOf(failed.commandId):null;
   if(o.recovery&&failed&&failedCup){
    const a=open.get(failed.commandId);if(a){open.delete(failed.commandId);await o.recorder.appendAttempt({...a,outcome:'grip_not_established'});}
    const f=arm.facts?.()??{armFresh:false,noUnknown:false},cup=lastProps.get(failedCup),facts=new Set<RecoveryFact>();
    if(f.armFresh)facts.add('arm_state_fresh');if(f.noUnknown)facts.add('no_unknown_command');
    if(cup?.restingOn===o.recovery.declaredSupportId)facts.add('cup_on_declared_support');
    const prop=o.cups.find(c=>c.cupId===failedCup)!.propId;if(obs&&!obs.heldPropIds.includes(prop))facts.add('cup_not_between_pads');
    const d=decideRecovery(o.recovery.policy,{code:'GRIP_NOT_ESTABLISHED'},facts,recoveries.get(failedCup)??0);
    if(d.action==='attention'){arm.failGrip!(failed.commandId,d.reason);return;}
    recoveries.set(failedCup,(recoveries.get(failedCup)??0)+1);
    active={commandId:failed.commandId,cupId:failedCup,attemptId:a?.attemptId??`${failedCup}#${(index.get(failedCup)??1)-1}`,rule:d.rule,steps:d.steps,i:0,failTick:tick,recorded:false,since:tick};
    return;
   }
   if(pend&&cupId){
    const start=waitStart.get(pend.commandId)??tick;waitStart.set(pend.commandId,start);
    const n=index.get(cupId)??0,view:BeliefView=o.injectBias&&n<o.injectBias.attempts?{get:(id,t)=>{const b=world.view().get(id,t);return b.status==='ok'?{status:'ok',belief:{...b.belief,positionM:[b.belief.positionM[0]+o.injectBias!.vectorM[0],b.belief.positionM[1]+o.injectBias!.vectorM[1],b.belief.positionM[2]]}}:b;}}:world.view(),r=planBeliefGrasp({view,cupId,tick,attemptIndex:n,mode:o.mode,region:o.region,graspOffsets:o.graspOffsets,seeds:o.seeds,solve:o.solve,sweep:o.sweep});
    // no usable estimate yet: wait, up to beliefWaitTicks (nothing is recorded or commanded meanwhile)
    if(!r.ok&&(r.code==='BELIEF_UNAVAILABLE'||r.code==='BELIEF_STALE')&&tick-start<o.beliefWaitTicks)return;
    const a=r.attempt,b=a.beliefUsed,t=truth.get(cupId)!.get(tick);
    a.beliefErrorAtCommitM=b&&t?Math.hypot(b.positionM[0]-t.positionM[0],b.positionM[1]-t.positionM[1]):null; // scoring: the plant holds the truth, the planner never saw it
    if(r.ok)a.outcome='unknown';
    await o.recorder.appendAttempt(a);  // on the stream before any command can follow from it
    index.set(cupId,n+1);if(r.ok){open.set(pend.commandId,a);if(n===0)firstCommitted.add(cupId);}
    arm.setGraspPlan(pend.commandId,r.ok?{ok:true,waypoints:r.waypoints}:{ok:false,code:r.code});
   }
   for(const [commandId,a] of [...open]){
    const prog=arm.program(commandId);if(!prog||prog.state==='running')continue;
    const outcome:GraspAttempt['outcome']=prog.state==='completed'?(prog.evidence.liftPoseReached===true?'lifted':prog.evidence.objectPresent===false?'grip_not_established':'unknown'):prog.state==='unknown'&&arm.stopReason()==='CUP_DROPPED'?'cup_dropped':'unknown';
    open.delete(commandId);await o.recorder.appendAttempt({...a,outcome});
   }
  }};
}
