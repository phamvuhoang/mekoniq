// R4.4 in a cell run: truth goes into the simulated estimator, estimates are recorded and applied to the belief world, and a belief grasp waiting for its plan is decided from the BeliefView alone.
// The attempt is on the durable stream BEFORE the plant is told its plan; a refusal never moves the arm. Truth is used for scoring only (`beliefErrorAtCommitM`, the BeliefRecord).
import type {GraspAttempt,PerceptionProfileV1,RecoveryPolicyV1,RecoveryStep} from '../../../../contracts/generated/navigation2d';
import {decideRecovery,type RecoveryAction,type RecoveryFact} from './recovery-policy';
import {createBeliefWorld,type BeliefView} from './belief';
import {planBeliefGrasp,type GraspPlanInput} from './grasp-conditioning';
import {createPoseEstimator,type TruthSample,type CupSupportGeometry} from './pose-estimator-sim';
import type {FailedGripContext} from '../../../../cell-adapters/src/mock-arm';
import type {BeliefRecorder} from './belief-evidence';
type Box={centerM:[number,number];halfExtentM:[number,number]};
/** What the world needs from the arm plant (MockArmPlant implements it; tests pass a fake). */
export interface ArmFacade {
 /** R4.4 recovery (a plant with a recovery policy only): the cup-pick whose grip is known not to have formed and that waits for the decision; the decision to give up (the program latches); what the plant itself knows of the arm; one recovery step of the plant (running until done). */
 commitPending?():{commandId:string}|null;setCommitPlan?(commandId:string,plan:{ok:true;waypoints:Record<'pick'|'lift',number[]>}|{ok:false;code:string}):void;gripFailedPending?():{commandId:string}|null;failGrip?(commandId:string,reason:string,context?:FailedGripContext):void;facts?():{armFresh:boolean;noUnknown:boolean};recoverStep?(commandId:string,action:'open_gripper'|'retreat_pick_approach'):'running'|'done';
 graspPending():{commandId:string}|null;setGraspPlan(commandId:string,plan:{ok:true;waypoints:Record<'pickApproach'|'pick'|'lift',number[]>}|{ok:false;code:string}):void;
 program(commandId:string):{state:string;evidence:Record<string,unknown>}|undefined;stopReason():string|undefined}
export interface WorldBeliefOptions {mode:'belief_ground_truth'|'belief_estimated';profile:PerceptionProfileV1;seed:number;cups:readonly {cupId:string;propId:string;geometry:CupSupportGeometry}[];recorder:Pick<BeliefRecorder,'appendBelief'|'appendAttempt'|'appendRecovery'>;
 view:Box&{supportId:string};region:Box;beliefWaitTicks:number;graspOffsets:GraspPlanInput['graspOffsets'];seeds:GraspPlanInput['seeds'];solve:GraspPlanInput['solve'];sweep:GraspPlanInput['sweep'];
 /** The cup the transfer of this arm command is for; null while it is not known yet (the pick then waits). */cupOf(commandId:string):string|null;
 /** Present = a failed pick is recovered from by this table (V13); absent = R4.4 V11 behaviour, byte for byte. `declaredSupportId` is the support the cup is observed on to count as "on the declared support". */
 recovery?:{policy:RecoveryPolicyV1;declaredSupportId:string};
 /** Campaign rig / test only (never a request field): a modelled perception error that is added to the belief of the first `attempts` grasp attempts of each cup, like a transient mis-detection. The belief used and its error at commit are recorded as usual. */
 injectBias?:{vectorM:[number,number];attempts:number}}
type PropTruth={propId:string;position:readonly number[];restingOn:string|null};
export function createWorldBelief(o:WorldBeliefOptions){
 const world=createBeliefWorld(o.profile.maxAgeTicks),estimators=new Map(o.cups.map(c=>[c.cupId,createPoseEstimator(o.profile,o.seed,c.cupId,c.geometry)])),truth=new Map<string,Map<number,TruthSample>>(o.cups.map(c=>[c.cupId,new Map()]));
 let lastObservedTick=-1;
 const firstCommitted=new Set<string>(),keep=o.profile.latencyTicks+o.profile.updateEveryTicks+2,waitStart=new Map<string,number>(),index=new Map<string,number>(),open=new Map<string,GraspAttempt>();
 const recoveries=new Map<string,number>(),lastProps=new Map<string,PropTruth>(),attemptOf=new Map<string,number>(),beliefWaits=new Map<string,{st:RecoveryStep;k:number;cupId:string;trigger:string}>(),retryCommits=new Set<string>();let active:{k:number;commandId:string;cupId:string;attemptId:string;rule:string;steps:RecoveryAction[];i:number;failTick:number;/** the tick the retreat ended: a fresh belief must be observed after it */retreatDone:number;recorded:boolean;since:number}|null=null;
 const inView=(p:PropTruth)=>p.restingOn===o.view.supportId&&Math.abs(p.position[0]!-o.view.centerM[0])<=o.view.halfExtentM[0]&&Math.abs(p.position[1]!-o.view.centerM[1])<=o.view.halfExtentM[1];
 return {
  /** True once the first COMMIT of this cup was accepted (the attempt is on the stream with the belief of the start of the descent, the arm goes down); the registered cup nudge of R4-D33 fires on it. */
  committed:(cupId:string)=>firstCommitted.has(cupId),
  /** How many grasp attempts of this cup were started (planned or refused). */
  attemptsStarted:(cupId:string)=>index.get(cupId)??0,
  /** Every tick, after the engine step: record where each cup is (truth, for the estimator and for scoring) and publish the estimates that are due. */
  async observe(tick:number,props:readonly PropTruth[]){
   for(const {cupId,propId} of o.cups){
    const p=props.find(x=>x.propId===propId),ring=truth.get(cupId)!;if(p)lastProps.set(cupId,{...p,position:[...p.position]});else lastProps.delete(cupId);
    if(p){ring.set(tick,{tick,positionM:[p.position[0]!,p.position[1]!,p.position[2]!],inRegion:inView(p)});ring.delete(tick-keep);}
    const r=estimators.get(cupId)!.update(tick,t=>ring.get(t)??null);
    if(r){await o.recorder.appendBelief(r);world.apply(r);}
   }
   lastObservedTick=tick;
  },
  /** Every tick, after the arm observed: decide a pending grasp (the plan, before the first motion), decide the commit when the arm holds at its approach (spec §5.3: the moment the descent starts, with the belief of that moment), run a recovery in progress, and record the outcome of the attempts that ended. */
  async step(tick:number,arm:ArmFacade,obs?:{tick:number;heldPropIds:readonly string[]}){
   const pend=arm.graspPending(),cupId=pend?o.cupOf(pend.commandId):null;
   const step=(a:typeof active&{},result:RecoveryStep['result'],completed:number|null):RecoveryStep=>({stepId:`${a.attemptId}/${a.rule}/${a.i}`,attemptId:a.attemptId,rule:a.rule,action:a.steps[a.i]!,commandId:`recovery:${a.commandId}:g${a.k}:${a.i}`,recordedTick:a.since,completedTick:completed,result});
   const factsOf=(cupId:string)=>{const f=arm.facts?.()??{armFresh:false,noUnknown:false},cup=lastProps.get(cupId),facts=new Set<RecoveryFact>();
    const current=lastObservedTick===tick&&obs?.tick===tick;
    if(current&&f.armFresh)facts.add('arm_state_fresh');if(f.noUnknown)facts.add('no_unknown_command');
    if(current&&cup&&cup.restingOn===o.recovery?.declaredSupportId&&cup.position.length===3&&cup.position.every(Number.isFinite))facts.add('cup_on_declared_support');
    if(current&&Array.isArray(obs.heldPropIds)&&obs.heldPropIds.length===0)facts.add('cup_not_between_pads');return facts;};
   const viewFor=(n:number):BeliefView=>o.injectBias&&n<o.injectBias.attempts?{get:(id,t)=>{const b=world.view().get(id,t);return b.status==='ok'?{status:'ok',belief:{...b.belief,positionM:[b.belief.positionM[0]+o.injectBias!.vectorM[0],b.belief.positionM[1]+o.injectBias!.vectorM[1],b.belief.positionM[2]]}}:b;}}:world.view();
   const scored=(r:ReturnType<typeof planBeliefGrasp>,cupId:string)=>{const a=r.attempt,b=a.beliefUsed,t=truth.get(cupId)!.get(tick);
    a.beliefErrorAtCommitM=b&&t?Math.hypot(b.positionM[0]-t.positionM[0],b.positionM[1]-t.positionM[1]):null; // scoring: the plant holds the truth, the planner never saw it
    if(r.ok)a.outcome='unknown';return a;};
   // the belief-not-usable rule (R4-B §7.2 row 2): a wait that ran out is repeated by the table, within its bound; false = a person is asked (the refusal goes on as before)
   const waitAgain=async(cupId:string,commandId:string,code:string,n:number):Promise<boolean>=>{
    const ran=beliefWaits.get(commandId);if(ran){await o.recorder.appendRecovery({...ran.st,completedTick:tick,result:'failed'});beliefWaits.delete(commandId);} // the window that ran out ends here, as failed
    if(!o.recovery)return false;const count=recoveries.get(cupId)??0,d=decideRecovery(o.recovery.policy,{code},factsOf(cupId),count);if(d.action!=='recover')return false;
    recoveries.set(cupId,count+1);const st:RecoveryStep={stepId:`${cupId}#${n}/${d.rule}/w${count}`,attemptId:`${cupId}#${n}`,rule:d.rule,action:'await_fresh_belief',commandId:`recovery:${commandId}:w${count}`,recordedTick:tick,completedTick:null,result:'pending'};
    await o.recorder.appendRecovery(st);beliefWaits.set(commandId,{st,k:count,cupId,trigger:code});return true;};
   // a usable belief ends the open window (done) and is followed by the table's retry_pick; a window still open when the plan is refused for another reason ends failed
   const closeWaits=async(commandId:string,usable:boolean,planned=false)=>{const w=beliefWaits.get(commandId);if(!w)return;beliefWaits.delete(commandId);
    await o.recorder.appendRecovery({...w.st,completedTick:tick,result:usable?'done':'failed'});
    if(usable){const r:RecoveryStep={stepId:`${w.st.attemptId}/${w.st.rule}/r${w.k}`,attemptId:w.st.attemptId,rule:w.st.rule,action:'retry_pick',commandId:`recovery:${commandId}:w${w.k}:retry`,recordedTick:tick,completedTick:null,result:'pending'};await o.recorder.appendRecovery(r);await o.recorder.appendRecovery({...r,completedTick:tick,result:planned?'done':'failed'});}};
   const cp=arm.commitPending?.();
   for(const [commandId,w] of beliefWaits){
    const planning=pend?.commandId===commandId,committing=cp?.commandId===commandId;
    if(!planning&&!committing){
     await closeWaits(commandId,false);retryCommits.delete(commandId);
     continue;
    }
    const facts=factsOf(w.cupId);
    const rule=decideRecovery(o.recovery!.policy,{code:w.trigger},facts,0);
    // The wait rule permits a passive wait for an unseen cup. Any affirmative
    // motion additionally needs current support and empty-pad observations (§7.1).
    const canSeeEstimate=world.view().get(w.cupId,tick).status==='ok';
    const stopped=arm.stopReason()??(arm.program(commandId)?.state!=='running'?'RECOVERY_NOT_APPLICABLE':undefined);
    if(stopped||rule.action==='attention'||(canSeeEstimate&&(!facts.has('cup_on_declared_support')||!facts.has('cup_not_between_pads')))){
     await closeWaits(commandId,false);retryCommits.delete(commandId);
     const refusal={ok:false as const,code:stopped??'RECOVERY_FACTS_MISSING'};
     if(planning)arm.setGraspPlan(commandId,refusal);else arm.setCommitPlan!(commandId,refusal);
     return;
    }
   }
   // a recovery in progress owns the cup-pick: nothing is planned until its `retry_pick` step
   if(o.recovery&&active){const a=active,action=a.steps[a.i]!;
    // the program ended or the arm latched under the recovery: nothing more is done to it, and the step that did not finish says so
    const prog=arm.program(a.commandId);if(!prog||prog.state!=='running'||arm.stopReason()){if(a.recorded)await o.recorder.appendRecovery(step(a,'failed',tick));active=null;return;}
    // The grip recovery remains conditional on THIS tick's facts, including the
    // wait/retry after retreat: a newly held cup must not start another descent.
    const d=decideRecovery(o.recovery.policy,{code:'GRIP_NOT_ESTABLISHED'},factsOf(a.cupId),0);if(d.action==='attention'){if(a.recorded)await o.recorder.appendRecovery(step(a,'failed',tick));arm.failGrip!(a.commandId,d.reason);active=null;return;}
    if(!a.recorded){a.since=tick;await o.recorder.appendRecovery(step(a,'pending',null));a.recorded=true;}
    let done=false;
    if(action==='open_gripper'||action==='retreat_pick_approach'){done=arm.recoverStep!(a.commandId,action)==='done';if(done&&action==='retreat_pick_approach')a.retreatDone=tick;}
    else if(action==='await_fresh_belief'){const v=world.view().get(a.cupId,tick);
     if(v.status==='ok'&&v.belief.observedTick>a.retreatDone)done=true; // a belief OBSERVED after the retreat ended, not one published late about the scene before it
     else if(tick-a.since>=o.beliefWaitTicks){await o.recorder.appendRecovery(step(a,'failed',tick));arm.failGrip!(a.commandId,v.status==='ok'?'BELIEF_STALE':v.reason);active=null;return;}}
    else{done=true;const n=index.get(a.cupId)??0;index.set(a.cupId,n+1);attemptOf.set(a.commandId,n);retryCommits.add(a.commandId);waitStart.delete('commit:'+a.commandId);} // retry_pick: the arm is at its approach, the commit decides the next descent
    if(done){await o.recorder.appendRecovery(step(a,'done',tick));a.i++;a.recorded=false;if(a.i>=a.steps.length)active=null;}
    return;
   }
   const failed=o.recovery?arm.gripFailedPending?.():null,failedCup=failed?o.cupOf(failed.commandId):null;
   if(o.recovery&&failed&&failedCup){
    const a=open.get(failed.commandId);if(a){open.delete(failed.commandId);await o.recorder.appendAttempt({...a,outcome:'grip_not_established',stage:'outcome',recordedTick:tick});}
    const d=decideRecovery(o.recovery.policy,{code:'GRIP_NOT_ESTABLISHED'},factsOf(failedCup),recoveries.get(failedCup)??0);
    if(d.action==='attention'){arm.failGrip!(failed.commandId,d.reason,d.reason==='RECOVERY_EXHAUSTED'?{tick,propId:o.cups.find(c=>c.cupId===failedCup)!.propId,declaredSupportId:o.recovery.declaredSupportId}:undefined);return;}
    const k=recoveries.get(failedCup)??0;recoveries.set(failedCup,k+1);
    active={k,commandId:failed.commandId,cupId:failedCup,attemptId:a?.attemptId??`${failedCup}#${(attemptOf.get(failed.commandId)??0)}`,rule:d.rule,steps:d.steps,i:0,failTick:tick,retreatDone:0,recorded:false,since:tick};
    return;
   }
   const cpCup=cp?o.cupOf(cp.commandId):null;
   if(cp&&cpCup){
    if(o.recovery&&retryCommits.has(cp.commandId)){
     const d=decideRecovery(o.recovery.policy,{code:'GRIP_NOT_ESTABLISHED'},factsOf(cpCup),0);
     if(d.action==='attention'){retryCommits.delete(cp.commandId);arm.failGrip!(cp.commandId,d.reason);return;}
    }
    const key='commit:'+cp.commandId,start=waitStart.get(key)??tick;waitStart.set(key,start);
    const n=attemptOf.get(cp.commandId)??0,r=planBeliefGrasp({path:'commit',view:viewFor(n),cupId:cpCup,tick,attemptIndex:n,mode:o.mode,region:o.region,graspOffsets:o.graspOffsets,seeds:o.seeds,solve:o.solve,sweep:o.sweep});
    const unusable=!r.ok&&(r.code==='BELIEF_UNAVAILABLE'||r.code==='BELIEF_STALE');
    if(unusable&&tick-start<o.beliefWaitTicks)return;                                                  // no usable estimate at the approach: wait, nothing commanded
    if(unusable&&await waitAgain(cpCup,cp.commandId,r.code,n)){waitStart.set(key,tick);return;}
    const a=scored(r,cpCup);a.stage='commit';a.recordedTick=tick;open.delete(cp.commandId);await o.recorder.appendAttempt(a);waitStart.delete(key);retryCommits.delete(cp.commandId);await closeWaits(cp.commandId,!unusable,r.ok);
    if(r.ok){open.set(cp.commandId,a);if(n===0)firstCommitted.add(cpCup);arm.setCommitPlan!(cp.commandId,{ok:true,waypoints:{pick:r.waypoints.pick,lift:r.waypoints.lift}});}
    else arm.setCommitPlan!(cp.commandId,{ok:false,code:r.code});
   }
   if(pend&&cupId){
    const start=waitStart.get(pend.commandId)??tick;waitStart.set(pend.commandId,start);
    const n=index.get(cupId)??0,r=planBeliefGrasp({view:viewFor(n),cupId,tick,attemptIndex:n,mode:o.mode,region:o.region,graspOffsets:o.graspOffsets,seeds:o.seeds,solve:o.solve,sweep:o.sweep});
    // no usable estimate yet: wait, up to beliefWaitTicks (nothing is recorded or commanded meanwhile)
    const unusable=!r.ok&&(r.code==='BELIEF_UNAVAILABLE'||r.code==='BELIEF_STALE');
    if(unusable&&tick-start<o.beliefWaitTicks)return;
    if(unusable&&await waitAgain(cupId,pend.commandId,r.code,n)){waitStart.set(pend.commandId,tick);return;}
    const a=scored(r,cupId);a.stage='plan';a.recordedTick=tick;
    await o.recorder.appendAttempt(a);  // on the stream before any command can follow from it
    if(r.ok&&beliefWaits.has(pend.commandId)&&arm.commitPending)retryCommits.add(pend.commandId);
    await closeWaits(pend.commandId,!unusable,r.ok);
    index.set(cupId,n+1);attemptOf.set(pend.commandId,n);if(r.ok){open.set(pend.commandId,a);if(!arm.commitPending&&n===0)firstCommitted.add(cupId);}
    arm.setGraspPlan(pend.commandId,r.ok?{ok:true,waypoints:r.waypoints}:{ok:false,code:r.code});
   }
   for(const [commandId,a] of [...open]){
    const prog=arm.program(commandId);if(!prog||prog.state==='running')continue;
    const outcome:GraspAttempt['outcome']=prog.state==='completed'?(prog.evidence.liftPoseReached===true?'lifted':prog.evidence.objectPresent===false?'grip_not_established':'unknown'):prog.state==='unknown'&&arm.stopReason()==='CUP_DROPPED'?'cup_dropped':'unknown';
    open.delete(commandId);await o.recorder.appendAttempt({...a,outcome,stage:'outcome',recordedTick:tick});
   }
  }};
}
