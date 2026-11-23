// Shared semantic proof for a registered full-cell recovery and its public native replay.
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {readBoundedPhysicsFile} from '../simulation3d/physics-evidence';
import type {CupPhysicalState} from '../beverage/cup-ledger';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import type {ArmProgramSet,ArmPlantState} from '../../../../cell-adapters/src/mock-arm';
import type {WorldEvidenceRecord} from '../../../../contracts/generated/navigation2d';
import {hashJson} from '../hash';
import {composePose,invertPose,qrotate} from '../frames';
import type {RunReport} from '../report';
import {documentDigest} from '../navigation2d/contracts';
import {loadOracleProfile} from '../algorithm/checker';
import {readXArmFixture,type XArmPhysics} from '../simulation3d/arm-cell-scene';
import {worldDocument,worldArmGeometry} from '../simulation3d/world-control';
import {readWorldFixture} from '../simulation3d/world-scene';
import type {WorldAdmission} from '../simulation3d/world-evidence';
import type {WorldSweepResult} from '../simulation3d/world-sweep';
import {MEASURED_CUP_NUDGE,MEASURED_GRASP_PROGRAM,WORLD_DISTURBANCE_PRESETS,validateWorldDisturbance} from '../simulation3d/world-disturbance';
import {worldWireCommand,type WorldTickCommand} from '../simulation3d/world-ports';
import {MUJOCO_ARM_RELEASE_TIMEOUT_TICKS} from '../simulation3d/mujoco-arm-ports';
import {loadGraspConfig,graspOffsetsFrom} from './grasp-config';
import {matchesGraspProgramRecord} from './grasp-programs';
import {verifyCellExecution} from './cell-execution';
import {readBeliefEvidence,readBeliefManifest} from './belief-evidence';
import {registeredBeliefPolicy,beliefPublicationIssues,verifyBeliefNativeCommits,nativeBeliefTruth,scoreBeliefAttempts,beliefDecisionIssues,validateBeliefRecordShape,validateGraspAttemptShape,validateRecoveryStepShape} from './belief-world-proof';
const root=fileURLToPath(new URL('../../../../../robotics/simulation-mujoco/',import.meta.url));
export const RECOVERY_OPTIONS={graspMode:'belief_estimated',perceptionProfileId:'perception-nominal-v1',recoveryPolicyId:'pick-recovery-v1',graspProgramId:MEASURED_GRASP_PROGRAM} as const;
type Row=WorldEvidenceRecord;
type Receipt=NonNullable<NonNullable<Row['snapshot']['worldStep']>['disturbances']>[number];
type Contact=NonNullable<ArmProgramSet['contact']>;
type Spec={kind:string;seed:number};
const same=(a:unknown,b:unknown)=>a===b||a!==undefined&&b!==undefined&&hashJson(a)===hashJson(b);
function check(condition:unknown,code:string):asserts condition {if(!condition)throw Error('RECOVERY_'+code);}
export function verifyRecoverySession(requests:readonly (WorkerStep&{op:string})[],initial:Row['snapshot'],seed:number,stepCount:number){
 const [create,start]=requests;
 check(requests.length===stepCount+2&&same(create,{requestId:'world-1',op:'create',targetTick:1,delivered:true,requestDigest:hashJson({sceneRef:'lab-world-scene.json',seed}),responseDigest:hashJson(initial)})&&same(start,{requestId:'world-2',op:'start',targetTick:1,delivered:true,requestDigest:hashJson({}),responseDigest:hashJson({state:'running'})}),'WORKER_SESSION');
}
export function verifyRecoveryBirths(rows:readonly Row[],centre:readonly number[]){
 for(const row of rows)for(const placement of row.command?.propPlacements??[]){
  if(placement.pose)check(same(placement.pose,{position:centre,quaternionXyzw:[0,0,0,1]}),'BIRTH_COMMAND');
 }
}
export function verifyRecoveryIntent(stored:unknown,row:Row,receipt:Receipt,execution:string){
 const command=structuredClone(row.command) as WorldTickCommand;delete command.faultReceipts;
 const {runId,bootId,sceneDigest}=row.snapshot,requestDigest=hashJson(worldWireCommand(command,false));
 check(requestDigest===receipt.requestDigest&&same(stored,{schemaVersion:1,runId,bootId,sceneDigest,requestId:receipt.requestId,requestDigest,graspProgramExecutionDigest:execution,command}),'INTENT_BINDING');
}
export function verifyCaptureTargets(interval:readonly Row[],armId:string,cup:string,id:string,c:Contact,lifted:boolean){
 let capture=0,secure=0;
 for(const row of interval){
  const p=row.command?.worldControl?.program,target=row.command?.gripperTargets?.find(g=>g.armId===armId)?.openingM;
  check(p?.commandId===id&&p.cupId===cup&&p.programId==='cup-pick','CAPTURE_PROGRAM');
  if(p.waypoint==='pick'&&target===c.captureM&&!secure)capture++;
  else if(p.waypoint==='lift'&&lifted&&capture>=c.gripSettleTicks&&target===c.closedM&&row.snapshot.arms?.[0]?.gripper?.heldPropIds.includes(cup))secure++;
  else check(!capture&&!secure&&target===c.openM&&['pickApproach','pick'].includes(p.waypoint),'CAPTURE_COMMAND');
 }
 check(capture>=c.gripSettleTicks&&(lifted?secure>0:secure===0),'CAPTURE_MISSING');
}
async function registeredExecution(report:RunReport,admission:WorldAdmission,spec:Spec){
 const {scene}=admission,m=report.manifest;
 const {scene:expected}=await readWorldFixture(root,'coffee-delivery-cell-v1');
 const presetId=spec.kind==='pulse'?MEASURED_CUP_NUDGE:spec.kind==='dock-drift'?'world-dock-drift-v1':spec.kind==='cup-fall'?'world-cup-fall-v1':undefined;
 if(presetId){const preset=WORLD_DISTURBANCE_PRESETS[presetId];expected.disturbance={presetId,revision:preset.revision,trigger:preset.trigger,cupId:'cup-1',targetId:spec.kind==='dock-drift'?expected.navigation.robots[0]!.robotId:'cup-1'};}
 expected.armCell.engineSeed=spec.seed;expected.armCell.sceneDigest=documentDigest(expected.armCell,'sceneDigest');expected.sceneDigest=documentDigest(expected,'sceneDigest');
 check(same(scene,expected)&&m.seed===spec.seed&&m.calibration.status==='not_calibrated'&&m.worldExperimentId===(spec.kind==='pulse'?MEASURED_CUP_NUDGE:undefined)&&m.models.find(x=>x.id==='mujoco_shared_world')?.hash===scene.sceneDigest,'FIXTURE_IDENTITY');
 verifyCellExecution(m,admission);
 const cfg=(await loadGraspConfig(root,RECOVERY_OPTIONS))!,pm=m.perception,arm=m.armProgram;
 check(arm&&pm&&m.graspProgramId===MEASURED_GRASP_PROGRAM&&matchesGraspProgramRecord(m.graspProgramId,pm.program,arm)&&same(pm,{graspMode:cfg.mode,profile:{id:cfg.profile.id,revision:cfg.profile.revision,digest:cfg.profile.digest,sha256:cfg.profileSha256},program:pm.program,recoveryPolicy:{id:cfg.recovery!.policy.id,digest:cfg.recovery!.policy.digest}}),'PROGRAM_IDENTITY');
 const doc=worldDocument<{programs:ArmProgramSet;digest:string}>(admission.files,scene.programsRef.path),physics=worldDocument<XArmPhysics>(admission.files,scene.models.armPhysics.path),oracle=loadOracleProfile().profile.mujocoArm!;
 const contact:Contact={openM:physics.gripper.openingMaxM,closedM:0,captureM:cfg.program!.captureM,gripSettleTicks:oracle.gripSettleTicks,dropTicks:oracle.dropTicks,liftMinM:oracle.liftMinM,releaseTimeoutTicks:MUJOCO_ARM_RELEASE_TIMEOUT_TICKS,releaseObservationRequired:true,releaseSettleTicks:25};
 const birth=worldDocument<{birth:{centerM:[number,number,number]}}>(admission.files,scene.handoffPolicyRef.path).birth.centerM;
 const centre=composePose(invertPose(scene.armCell.arm.baseInMap),{position:birth,quaternionXyzw:[0,0,0,1]}).position,offsets=graspOffsetsFrom(readXArmFixture(root).layout,centre,cfg.program);
 check(same(arm.graspOffsets,offsets)&&same(arm.fixture,{id:scene.id,revision:String(scene.revision)})&&arm.physicsDigest===scene.models.armPhysics.sha256&&arm.waypointsDigest===doc.digest&&same(arm.programs,{...doc.programs,contact,collision:{geometry:worldArmGeometry(scene,admission.files),allowedPairs:[]},beliefGrasp:true,recovery:true}),'PROGRAM_CONFIGURATION');
 return {cfg,contact,centre,birth,programs:doc.programs};
}
/** Input is the captured report, authenticated scene bundle and ordered native world records. The private journal and write-before-send intents are checked only in the full campaign. */
export async function verifyNativeRecoveryCase(report:RunReport,admission:WorldAdmission,rows:readonly Row[],spec:Spec){
 const {scene}=admission,{cfg,contact,centre,birth,programs}=await registeredExecution(report,admission,spec),m=report.manifest,e=report.perceptionEvidence;
 verifyRecoveryBirths(rows,birth);
 const unknown=['worker-loss','lost-ack'].includes(spec.kind),success=['nominal','pulse'].includes(spec.kind),pulse=spec.kind==='pulse',h=report.outcome.tick;
 check(e&&h<=12000&&rows.length===h+1&&rows.every((r,t)=>r.snapshot.tick===t&&r.snapshot.runId===m.runId&&r.snapshot.bootId===rows[0]!.snapshot.bootId&&r.snapshot.sceneDigest===scene.sceneDigest&&r.snapshot.worldStep?.workerPid===rows[0]!.snapshot.worldStep?.workerPid)&&rows[0]!.snapshot.worldStep!.workerPid>0,'WORLD_HORIZON');
 const identity={runId:m.runId,bootId:rows[0]!.snapshot.bootId,sceneDigest:scene.sceneDigest,seed:spec.seed,graspMode:cfg.mode,graspProgramDigest:m.perception!.program!.executionDigest,perceptionProfileDigest:cfg.profile.digest,recoveryPolicyDigest:cfg.recovery!.policy.digest};
 check(e.graspProgramDigest===identity.graspProgramDigest&&same(e.policy,await registeredBeliefPolicy(cfg.profile.digest))&&e.coverage?.scope==='belief_evaluations'&&e.complete===e.coverage.streamFinalized&&(!unknown||!e.complete)&&e.coverage.firstTick===0&&e.coverage.lastTick===h&&e.coverage.prefixCovered===!unknown&&same(e.issues,unknown?['BELIEF_COVERAGE_INCOMPLETE','BELIEF_WORLD_COVERAGE']:[]),'BELIEF_HORIZON');
 check(e.beliefs.every(r=>validateBeliefRecordShape(r))&&e.attemptRecords.every(a=>validateGraspAttemptShape(a))&&e.recovery.every(s=>validateRecoveryStepShape(s))&&!beliefDecisionIssues(e.beliefs,e.attemptRecords,identity,cfg.profile).length&&!beliefPublicationIssues(e.beliefs,cfg.profile,rows,scene,h).length,'BELIEF_DECISIONS');
 verifyBeliefNativeCommits(e.attemptRecords,e.recovery,rows,scene,programs);
 const truth=nativeBeliefTruth(rows,scene),attempts=scoreBeliefAttempts(e.attemptRecords,truth);
 check(same(attempts,e.attemptRecords)&&same(e.attempts,[...new Map(attempts.map(a=>[a.attemptId,a])).values()]),'ATTEMPT_SCORE');
 const outcomes=attempts.filter(a=>a.stage==='outcome'),expected=[...pulse?[['cup-1#0','grip_not_established']]:[],[pulse?'cup-1#1':'cup-1#0','lifted'],...success?[['cup-2#0','lifted']]:[]];
 check(same(outcomes.map(a=>[a.attemptId,a.outcome]),expected)&&e.attempts.length===expected.length,'ATTEMPT_OUTCOME');
 const armId=scene.armCell.arm.armId;
 for(const a of outcomes){
  const decision=rows[a.decidedTick]!,end=rows[a.recordedTick!]!,p=decision.command?.worldControl?.program,held=end.snapshot.arms?.[0]?.gripper?.heldPropIds;
  check(p&&held&&a.recordedTick!>a.decidedTick,'GRASP_OBSERVATION');
  verifyCaptureTargets(rows.slice(a.decidedTick,a.recordedTick!+1),armId,a.cupId,p.commandId,contact,a.outcome==='lifted');
  if(a.outcome==='lifted'){const start=decision.snapshot.props?.find(prop=>prop.propId===a.cupId),finish=end.snapshot.props?.find(prop=>prop.propId===a.cupId);check(start&&finish&&same(held,[a.cupId])&&finish.position[2]-start.position[2]>=contact.liftMinM,'LIFT_OBSERVATION');}
 }
 const seen=new Set<string>(),receipts:Receipt[]=[];
 for(const [i,row] of rows.entries()){const preset=validateWorldDisturbance(row.snapshot,row.command,scene,rows[i-1]?.snapshot,seen);if(preset){seen.add(preset);receipts.push(...row.snapshot.worldStep!.disturbances!);}}
 if(!pulse){check(e.recovery.length===0&&receipts.length===(scene.disturbance?1:0),'UNREGISTERED_RECOVERY');return {identity,receipts};}
 const miss=outcomes[0]!,tick=miss.recordedTick!,decision=rows[miss.decidedTick]!,end=rows[tick]!,grip=decision.command!.worldControl!.program!,prop=end.snapshot.props?.find(p=>p.propId==='cup-1'),before=decision.snapshot.props?.find(p=>p.propId==='cup-1'),cup=scene.armCell.props.find(p=>p.propId==='cup-1')!;
 check(receipts.length===WORLD_DISTURBANCE_PRESETS[MEASURED_CUP_NUDGE].segments&&receipts.every((r,i)=>r.presetId===MEASURED_CUP_NUDGE&&r.segmentIndex===i&&r.targetTick===miss.decidedTick+i+1&&r.eventId===receipts[0]!.eventId),'PULSE_WINDOW');
 const pos=truth('cup-1',tick),axis=prop&&qrotate(prop.quaternionXyzw,[0,0,1]);
 check(before&&prop&&axis&&axis[2]>0&&Math.hypot(axis[0],axis[1])*cup.heightM/2<cup.radiusM*axis[2]&&prop.restingOn===cfg.regions.view.supportId&&end.snapshot.arms![0]!.gripper!.heldPropIds.length===0&&pos&&cfg.regions.workHalfExtentM.every((half,i)=>Math.abs(pos[i]!-centre[i]!)<=Math.min(half,cfg.regions.view.halfExtentM[i]!))&&prop.position[0]>before.position[0]&&receipts.at(-1)!.afterPositionM[0]>receipts[0]!.beforePositionM[0],'MISS_OBSERVATION');
 const actions=['open_gripper','retreat_pick_approach','await_fresh_belief','retry_pick'];let previous=tick;
 check(e.recovery.length===actions.length*2,'RECOVERY_COUNT');
 for(const [i,action] of actions.entries()){const pending=e.recovery[2*i]!,done=e.recovery[2*i+1]!,at=done.completedTick;
  check(at!==null&&at>=pending.recordedTick&&same(pending,{attemptId:miss.attemptId,stepId:miss.attemptId+'/grip-not-established/'+i,rule:'grip-not-established',action,commandId:'recovery:'+grip.commandId+':g0:'+i,recordedTick:previous+1,completedTick:null,result:'pending'})&&same(done,{...pending,completedTick:at,result:'done'}),'RECOVERY_ORDER');previous=at;
 }
 const retry=attempts.find(a=>a.stage==='commit'&&a.attemptId==='cup-1#1')!,retreat=e.recovery[3]!.completedTick!,fresh=e.recovery[5]!.completedTick!;
 check(retry.decidedTick===previous+1&&retry.beliefUsed&&retry.beliefUsed.observedTick>retreat&&retry.beliefUsed.publishedTick===fresh&&rows.slice(e.recovery[0]!.recordedTick+1,previous+1).every(r=>r.command?.gripperTargets?.find(g=>g.armId===armId)?.openingM===contact.openM),'FRESH_RETRY');
 return {identity,receipts};
}
interface WorkerStep {requestId:string;targetTick:number;delivered:boolean;requestDigest:string;responseDigest?:string}
// SQLite may create its SHM on a read-only connection. Open only private copies of the recorded database.
async function readPhysicalCustody(directory:string,runId:string){
 const temp=await mkdtemp(join(tmpdir(),'recovery-custody-')),file='cup-ledger.sqlite';
 try{
  for(const suffix of ['','-wal','-shm']){
   const name=file+suffix;
   try{await writeFile(join(temp,name),await readBoundedPhysicsFile(directory,name,32*1024*1024),{mode:0o600,flag:'wx'});}
   catch(error){if(!suffix||(error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  }
  const db=new DatabaseSync(join(temp,file),{readOnly:true});
  try{
   check(db.prepare('SELECT run_id FROM cup_ledger_meta WHERE id=1').get()?.run_id===runId,'PHYSICAL_LEDGER_IDENTITY');
   return db.prepare('SELECT state FROM cup_projection ORDER BY cup_id LIMIT 3').all().map(r=>JSON.parse(String(r.state)) as CupPhysicalState);
  }finally{db.close();}
 }finally{await rm(temp,{recursive:true,force:true});}
}
interface PrivateCase {
 spec:Spec;report:RunReport;admission:WorldAdmission;rows:Row[];steps:WorkerStep[];sweep:WorldSweepResult;paths:Set<string>;directory:string;
 checkpoint:{manifest:RunReport['manifest'];coffee:{arm:ArmPlantState};world:{snapshot:Row['snapshot']}};
 read(path:string):Promise<unknown>;
}
export async function verifyRecoveryCell({spec,report,admission,rows,read,paths,steps,checkpoint,sweep,directory}:PrivateCase){
 const {identity,receipts}=await verifyNativeRecoveryCase(report,admission,rows,spec),unknown=['worker-loss','lost-ack'].includes(spec.kind),success=['nominal','pulse'].includes(spec.kind),h=report.outcome.tick,e=report.perceptionEvidence!;
 check(same(checkpoint.manifest,report.manifest)&&same(checkpoint.world.snapshot,rows[h]!.snapshot)&&same(await read('controller-state.json'),checkpoint.coffee.arm)&&same(await read('physical-custody.json'),report.coffee?.physicalCustody),'CHECKPOINT');
 const dir=join(directory,'run/belief-evidence'),bm=await readBeliefManifest(dir),b=await readBeliefEvidence(dir,bm,{identity});
 check(same(bm.identity,identity)&&bm.coverage.evaluatedThroughTick===h&&b.complete===!unknown&&same(b.issues,unknown?['BELIEF_COVERAGE_INCOMPLETE']:[])&&bm.terminalReason===(unknown?'WORLD_FAILED':null)&&!bm.gaps.length&&same(b.beliefs,e.beliefs)&&same(b.recovery,e.recovery)&&same(scoreBeliefAttempts(b.attempts,nativeBeliefTruth(rows,admission.scene)),e.attemptRecords),'FINALIZED_BELIEF_STREAM');
 for(const [i,step] of steps.entries()){
  const row=rows[i+1];check(step.requestId==='world-'+(i+3)&&(!row||step.requestDigest===hashJson(worldWireCommand(row.command as WorldTickCommand,false))),'WORKER_REQUEST');
 }
 const pulse=receipts.filter(r=>r.presetId===MEASURED_CUP_NUDGE),files=[...paths].filter(p=>p.startsWith('run/world-pulse-intent-'));
 check(files.length===pulse.length,'PRIVATE_INTENT_POPULATION');
 for(const r of pulse){const file='run/world-pulse-intent-'+r.segmentIndex+'.json',step=steps[r.targetTick-1];check(files.includes(file)&&step?.delivered&&step.requestId===r.requestId&&step.requestDigest===r.requestDigest,'PRIVATE_INTENT_REQUEST');verifyRecoveryIntent(await read(file),rows[r.targetTick]!,r,identity.graspProgramDigest);}
 const scope=report.worldSweep?.scope;
 check(scope?.prefixCovered&&scope.publicCommittedTick===h&&same(scope.identity,{runId:identity.runId,bootId:identity.bootId,sceneDigest:identity.sceneDigest,admissionDigest:admission.digest}),'WORLD_SCOPE');
 const physical=report.coffee?.physicalCustody??[],ledger=await readPhysicalCustody(join(directory,'run'),identity.runId);
 check(ledger.length>=1&&ledger.length<=2&&same(physical,ledger.map(p=>unknown&&p.status==='known'?{...p,parent:null,status:'unknown'}:p)),'PHYSICAL_LEDGER');
 if(unknown)check(ledger.some(p=>p.cupId==='cup-1'&&p.status==='known'&&p.parent==='arm:'+admission.scene.armCell.arm.armId+'/tcp'),'LAST_KNOWN_PHYSICAL_CUSTODY');
 if(success){
  check(report.worldSweep?.status===sweep.status&&same(report.worldSweep?.geometry,sweep.geometry)&&same(report.worldSweep?.reasonCodes,sweep.reasonCodes)&&sweep.complete&&sweep.status==='pass'&&sweep.nativeContacts.status==='pass'&&sweep.nativeContacts.unexpected===0&&same(report.worldSweep?.nativeContacts,sweep.nativeContacts),'SWEEP');
  for(const cup of ['cup-1','cup-2']){
   const miss=e.attempts.find(a=>a.cupId===cup&&a.outcome==='grip_not_established');
   if(miss){const at=report.manifest.clock.businessEpochMs!+miss.recordedTick!*20,before=report.businessEvents.filter(x=>x.kind==='cup'&&x.id===cup&&Date.parse(x.at)<=at);check(before.length>0&&before.every(x=>x.state.ownerKind==='cell'),'SOURCE_MISS_CUSTODY');}
   const transfers=report.businessEvents.filter(x=>x.kind==='cup'&&x.id===cup&&['CupTransferConfirmed','CupHandedOff'].includes(x.type)),lift=e.attempts.find(a=>a.cupId===cup&&a.outcome==='lifted')!;
   check(same(transfers.map(x=>[x.type,x.state.ownerKind]),[['CupTransferConfirmed','arm'],['CupTransferConfirmed','robot'],['CupHandedOff','customer']])&&Date.parse(transfers[0]!.at)===report.manifest.clock.businessEpochMs!+lift.recordedTick!*20&&physical.some(p=>p.cupId===cup&&p.status==='known'&&p.parent==='table:'+transfers[2]!.state.ownerId),'SOURCE_TRANSFER');
  }
 }else if(unknown){
  check(same(rows.at(-1)?.snapshot.arms?.[0]?.gripper?.heldPropIds,['cup-1'])&&physical.some(p=>p.cupId==='cup-1'&&p.status==='unknown'&&p.parent===null),'LATCHED_CUSTODY');
  if(spec.kind==='worker-loss')check(steps.at(-1)?.responseDigest===undefined,'WORKER_LOSS_RESPONSE');
  if(spec.kind==='lost-ack'){
   const lost=await read('lost-ack-native-response.json') as {request:{requestId:string;payload:unknown};response:{requestId:string;result:unknown}};
   const last=steps.at(-1)!;check(lost.request.requestId===last.requestId&&lost.response.requestId===last.requestId&&hashJson(lost.request.payload)===last.requestDigest&&hashJson(lost.response.result)===last.responseDigest,'LOST_NATIVE_ACK');
  }
 }else if(spec.kind==='cup-fall')check(physical.some(p=>p.cupId==='cup-1'&&p.status==='lost'&&p.parent===null),'LOST_CUSTODY');
 else check(physical.some(p=>p.cupId==='cup-1'&&p.status==='known'&&p.parent==='arm:'+admission.scene.armCell.arm.armId+'/tcp'),'RETAINED_CUSTODY');
}
