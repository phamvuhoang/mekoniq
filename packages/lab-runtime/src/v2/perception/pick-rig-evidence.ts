/** The study observes the first cup's final grasp, through its correlated program receipt.
 * A later delivery/drop is a different scope. Read-only: never reopen/resume a ScenarioRun. */
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {ArmPlantState,ArmPropSample} from '../../../../cell-adapters/src/mock-arm';
import type {GraspAttempt,RecoveryStep,WorldEvidenceRecord} from '../../../../contracts/generated/navigation2d';
import type {RunReport} from '../report';
import {hashJson} from '../hash';
import {readCampaignJournal} from '../control/campaign-source-evidence';
import {readRetainedWorldAdmission} from '../simulation3d/world-arm-report';
import {readWorldEvidence,type WorldAdmission} from '../simulation3d/world-evidence';
import {readBoundedPhysicsFile} from '../simulation3d/physics-evidence';
import {evaluateWorldSweepAsync} from '../simulation3d/world-sweep';
import {worldDocument} from '../simulation3d/world-control';
import {loadGraspConfig} from './grasp-config';
import {readBeliefEvidence,readBeliefManifest} from './belief-evidence';
import {rigOffsetM} from './perception-study';
import type {PickRigInput} from './pick-rig';
export const PICK_RIG_ENDPOINT_PROTOCOL='first-cup-grasp-v2' as const;
export interface RigEndpoint {protocol:typeof PICK_RIG_ENDPOINT_PROTOCOL;cupId:'cup-1';commandId:string|null;reason:'resolved'|'timeout'|'terminal';firstTick:0;lastTick:number;tickMs:20}
export type RigReport=RunReport&{pickRig?:{endpointProtocol:typeof PICK_RIG_ENDPOINT_PROTOCOL;maxTicks:number}};
type Arm=Pick<ArmPlantState,'programs'|'grasp'|'stop'>;
type Belief={attempts:GraspAttempt[];recovery:RecoveryStep[]};
const sha=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex'),same=(a:unknown,b:unknown)=>hashJson(a as never)===hashJson(b as never);
const fail=(code:string):never=>{throw Error(code);};
const SRC=fileURLToPath(new URL('../../../../../',import.meta.url));
/** No serving counter or global stop fallback. The first pick's own receipt supplies its tick.
 * This also inspects old reports truthfully, but does not qualify them under the new protocol. */
export function rigReportFacts(report:RigReport,arm:Arm,evidence:Belief={attempts:[],recovery:[]}){
 const effects=report.coffee?.cellEffects.filter(e=>e.payload.cupId==='cup-1'&&(e.payload.programRef as {id?:string}|null)?.id==='cup-pick')??[];
 if(effects.length>1)fail('RIG_PICK_COMMAND_AMBIGUOUS');
 const c=effects[0]?.payload,commandId=typeof c?.commandId==='string'?c.commandId:null,p=arm?.programs.find(p=>p.commandId===commandId),h=report.outcome.tick;
 const endpoint=(tick:number,reason:RigEndpoint['reason']):RigEndpoint=>({protocol:PICK_RIG_ENDPOINT_PROTOCOL,cupId:'cup-1',commandId,reason,firstTick:0,lastTick:tick,tickMs:20});
 const mine=evidence.attempts.filter(a=>a.cupId==='cup-1'),last=mine.at(-1);
 if(!c||!p||p.state==='running'){
  if(report.pickRig?.maxTicks!==h||['completed','needs_attention','cancelled'].includes(report.outcome.status))fail('RIG_PICK_RECEIPT_MISSING');
  return {fixedOutcome:'unknown' as GraspAttempt['outcome'],endpointTick:h,endpoint:endpoint(h,'timeout')};
 }
 if(p.program!=='cup-pick'||p.accepted?.accepted!==true||p.accepted.unknown!==false||p.payloadHash!==c.payloadHash||p.controlEpoch!==c.controlEpoch)fail('RIG_PICK_COMMAND_MISMATCH');
 const receipt=report.businessEvents.find(e=>e.kind==='cup'&&e.id==='cup-1'&&e.type==='CupTransferObserved'&&(e.state.pendingTransfer as {commandId?:string}|null)?.commandId===commandId&&['completed','failed','outcome_unknown'].includes(String((e.state.pendingTransfer as {lastResult?:string}).lastResult)));
 if(!receipt)fail('RIG_PICK_RECEIPT_MISSING');
 const transfer=receipt!.state.pendingTransfer as Record<string,unknown>,want=p.state==='unknown'?'outcome_unknown':p.state;
 if(transfer.lastResult!==want||transfer.payloadHash!==p.payloadHash||transfer.controlEpoch!==p.controlEpoch||transfer.transferId!==c.transferId)fail('RIG_PICK_RECEIPT_MISMATCH');
 const tick=(Date.parse(receipt!.at)-report.manifest.clock.businessEpochMs!)/20;
 if(report.manifest.clock.tickMs!==20||!Number.isSafeInteger(tick)||tick<0||tick>h)fail('RIG_PICK_RECEIPT_TICK');
 let outcome:GraspAttempt['outcome']='unknown';
 if(p.state==='completed'&&p.evidence.objectPresent===true&&p.evidence.liftPoseReached===true&&p.evidence.cupId==='cup-1')outcome='lifted';
 else if(p.evidence.objectPresent===false&&(p.state==='completed'||last?.outcome==='grip_not_established'))outcome='grip_not_established';
 else if(p.state==='failed'&&arm.grasp?.commandId===commandId&&arm.grasp.status==='refused'&&last?.outcome==='refused')outcome='refused';
 else if(p.state==='unknown'&&p.evidence.stopReason==='CUP_DROPPED')outcome='cup_dropped';
 return {fixedOutcome:outcome,endpointTick:tick,endpoint:endpoint(tick,'resolved')};
}
/** The pre-step native read supplies the birth pose. First post-step props are bound
 * separately: integration/contact may already have moved them during the birth tick. */
export function verifyRigBirth(records:readonly WorldEvidenceRecord[],admission:WorldAdmission,seed:number,magnitude:number){
 const binding=admission.scene.propBindings.find(b=>b.cupId==='cup-1');if(!binding)fail('RIG_BIRTH_IDENTITY');
 const births=records.flatMap(r=>r.interactions.filter(i=>i.kind==='birth'&&i.cupId==='cup-1').map(i=>({row:r,event:i})));
 if(births.length!==1)fail('RIG_BIRTH_MISSING');
 const {row,event}=births[0]!,first=records.find(r=>r.snapshot.props?.some(p=>p.propId===binding!.propId)),prop=row.snapshot.props?.find(p=>p.propId===binding!.propId),placement=row.command?.propPlacements?.find(p=>p.propId===binding!.propId);
 if(!first||first.snapshot.tick!==row.snapshot.tick||event.propId!==binding!.propId||event.before!==null||!prop||!event.after||!same(event.after,{position:prop.position,quaternionXyzw:prop.quaternionXyzw}))fail('RIG_BIRTH_IDENTITY');
 const native=row.snapshot.worldStep?.birthObservations?.find(r=>r.eventId===event.eventId&&r.propId===binding!.propId&&r.cupId==='cup-1');if(!native)fail('RIG_BIRTH_NATIVE_MISSING');
 const policy=worldDocument<{birth:{centerM:number[]}}>(admission.files,admission.scene.handoffPolicyRef.path),offset=rigOffsetM(seed,magnitude),want=[policy.birth.centerM[0]!+offset[0],policy.birth.centerM[1]!+offset[1]];
 if(!want.every(Number.isFinite)||!placement?.pose||!prop!.position.every(Number.isFinite)||want.some((v,k)=>Math.abs(placement.pose!.position[k]!-v)>1e-12||Math.abs(native!.qposPositionM[k]!-v)>1e-12||Math.abs(native!.bodyPositionM[k]!-v)>1e-10))fail('RIG_BIRTH_OFFSET_MISMATCH');
 return {tick:row.snapshot.tick,cupId:'cup-1' as const,propId:binding!.propId,eventId:event.eventId,positionM:[...native!.qposPositionM],firstPostStepPositionM:[...prop!.position],method:native!.method,physicsSubstepsBefore:native!.physicsSubstepsBefore,fixtureId:admission.scene.id,handoffPolicySha256:admission.scene.handoffPolicyRef.sha256};
}
/** Every new rig run retains the original world stream, admitted bundle, signed journal,
 * program checkpoint and the report's exact props ref. All metrics share one horizon. */
export async function readPickRigEvidence(directory:string,input:Omit<PickRigInput,'directory'>,report:RigReport){
 if(report.pickRig?.endpointProtocol!==PICK_RIG_ENDPOINT_PROTOCOL)fail('RIG_ENDPOINT_PROTOCOL_UNSUPPORTED');
 const max=report.pickRig!.maxTicks,h=report.outcome.tick,runDir=join(directory,'run'),m=report.manifest;
 if(!Number.isSafeInteger(max)||max<1||max>12000||!Number.isSafeInteger(h)||h<0||h>max||max!==(input.maxTicks??12000)||m.seed!==input.seed||m.sourceCommit!==input.sourceCommit||m.calibration.status!=='not_calibrated')fail('RIG_RUN_IDENTITY');
 const cp=JSON.parse((await readBoundedPhysicsFile(runDir,'run.json',32*1024*1024)).toString()) as {runId:string;tick:number;manifest:RunReport['manifest'];coffee:{arm:ArmPlantState};world:{snapshot:{bootId:string;tick:number}}};
 if(cp.runId!==m.runId||cp.tick!==h||cp.world?.snapshot.tick!==h||!same(cp.manifest,m))fail('RIG_CHECKPOINT_IDENTITY');
 const sceneDigest=m.models.find(x=>x.id==='mujoco_shared_world')?.hash;if(!sceneDigest)fail('RIG_WORLD_IDENTITY');
 const admission=await readRetainedWorldAdmission(runDir,sceneDigest!),scope=report.worldSweep?.scope,trace=report.arm?.worldTrace;
 if(admission.scene.id!=='pick-rig-v1'||m.armProgram?.fixture.id!=='pick-rig-v1'||admission.scene.armCell.engineSeed!==input.seed||scope?.identity.runId!==m.runId||scope.identity.bootId!==cp.world.snapshot.bootId||scope.identity.sceneDigest!==sceneDigest||scope.identity.admissionDigest!==admission.digest||scope.publicCommittedTick!==h||scope.prefixCovered!==true||trace?.prefixCovered!==true||trace.firstTick!==0||trace.lastTick!==h||trace.samples!==h+1||trace.publicCommittedTick!==h||trace.reasonCodes.length)fail('RIG_WORLD_IDENTITY');
 const policyBytes=await readFile(join(SRC,'robotics/simulation-mujoco/fixtures/pick-rig-v1/handoff-policy.json'));
 if(admission.scene.handoffPolicyRef.sha256!==sha(policyBytes))fail('RIG_BIRTH_FIXTURE_MISMATCH');
 const cfg=await loadGraspConfig(join(SRC,'robotics/simulation-mujoco'),{graspMode:input.mode,...input.profileId?{perceptionProfileId:input.profileId}:{},...input.recoveryPolicyId?{recoveryPolicyId:input.recoveryPolicyId}:{}}),pm=m.perception;
 let evidence:Belief={attempts:[],recovery:[]};
 if(cfg){
  const want={graspMode:cfg.mode,profile:{id:cfg.profile.id,revision:cfg.profile.revision,digest:cfg.profile.digest,sha256:cfg.profileSha256},recoveryPolicy:cfg.recovery?{id:cfg.recovery.policy.id,digest:cfg.recovery.policy.digest}:null};
  if(!pm||!same(pm,want))fail('RIG_PERCEPTION_IDENTITY');
  const dir=join(runDir,'belief-evidence'),manifest=await readBeliefManifest(dir),read=await readBeliefEvidence(dir,manifest,{identity:{runId:m.runId,bootId:cp.world.snapshot.bootId,sceneDigest:sceneDigest!,seed:input.seed,graspMode:cfg.mode,perceptionProfileDigest:cfg.profile.digest,recoveryPolicyDigest:cfg.recovery?.policy.digest??null}});
  if(!read.complete||read.issues.length)fail(`BELIEF_EVIDENCE:${read.issues.join(',')}`);
  evidence={attempts:read.attempts,recovery:read.recovery};
 }else if(pm)fail('RIG_PERCEPTION_IDENTITY');
 const world=await readWorldEvidence(join(runDir,'world-evidence'),admission);
 if(!world.complete||world.issues.length||world.records.length!==h+1||world.records[0]?.snapshot.runId!==m.runId||world.records[0]?.snapshot.bootId!==cp.world.snapshot.bootId)fail(`RIG_WORLD_EVIDENCE:${world.issues.join(',')}`);
 const source=await readCampaignJournal(runDir,m.runId);
 if(!same(source.events,report.businessEvents))fail('RIG_SOURCE_REPORT_MISMATCH');
 const facts=rigReportFacts(report,cp.coffee.arm,evidence);
 if(facts.endpointTick!==h)fail('RIG_ENDPOINT_HORIZON_MISMATCH');
 // Accepted place on the completion tick is visible in run.json. No subsequent place
 // command may have reached the engine; acceptance does not mean physical execution.
 if(world.records.some(r=>r.command?.worldControl?.program?.programId==='cup-place'))fail('RIG_PLACE_EXECUTED');
 const ref=report.arm?.props;
 if(!ref||!/^arm-props-trace-[a-f0-9]{64}\.json$/.test(ref.path)||ref.path!==`arm-props-trace-${ref.sha256}.json`||ref.samples!==h+1)fail('RIG_PROPS_REFERENCE');
 const bytes=await readBoundedPhysicsFile(runDir,ref!.path,32*1024*1024);if(sha(bytes)!==ref!.sha256)fail('RIG_PROPS_HASH');
 const props=JSON.parse(bytes.toString()) as {schemaVersion:number;frame:string;samples:ArmPropSample[]};
 if(props.schemaVersion!==1||props.frame!=='map'||!Array.isArray(props.samples)||props.samples.length!==h+1)fail('RIG_PROPS_COVERAGE');
 for(const [t,sample]of props.samples.entries()){
  const s=world.records[t]!.snapshot,want={tick:t,props:s.props!.map(p=>({propId:p.propId,positionM:p.position,quaternionXyzw:p.quaternionXyzw,restingOn:p.restingOn,held:s.arms![0]!.gripper!.heldPropIds.includes(p.propId)}))};
  if(!same(sample,want))fail('RIG_PROPS_WORLD_MISMATCH');
 }
 const birth=verifyRigBirth(world.records,admission,input.seed,input.truthOffsetM),mine=evidence.attempts.filter(a=>a.cupId==='cup-1'),last=mine.at(-1),physical=world.records[h]!.snapshot,held=physical.arms![0]!.gripper!.heldPropIds.includes(birth.propId),cup=physical.props!.find(p=>p.propId===birth.propId);
 if(facts.fixedOutcome==='lifted'){
  const event=source.events.find(e=>e.kind==='cup'&&e.id==='cup-1'&&e.type==='CupTransferConfirmed'&&(e.state.movements as {evidence?:{commandId?:string}}[]|undefined)?.some(x=>x.evidence?.commandId===facts.endpoint.commandId)),movement=(event?.state.movements as {evidence?:Record<string,unknown>}[]|undefined)?.find(x=>x.evidence?.commandId===facts.endpoint.commandId),receipt=movement?.evidence,observation=receipt?.world as {tick?:number;sceneDigest?:string}|undefined;
  const hp=worldDocument<{birth:{centerM:number[]}}>(admission.files,admission.scene.handoffPolicyRef.path),lift=m.armProgram?.programs.contact?.liftMinM;
  if(!receipt||receipt.objectPresent!==true||receipt.liftPoseReached!==true||observation?.tick!==h||observation.sceneDigest!==sceneDigest||!held||!cup||!Number.isFinite(lift)||cup.position[2]!<hp.birth.centerM[2]!+lift!)fail('RIG_LIFT_OBSERVATION_MISSING');
 }
 if(facts.fixedOutcome==='grip_not_established'&&held)fail('RIG_MISS_OBSERVATION_CONTRADICTION');
 if(input.mode!=='fixed_program'&&facts.endpoint.reason!=='timeout'&&(!last||last.outcome!==facts.fixedOutcome||last.recordedTick===undefined||last.recordedTick>h||last.recordedTick<h-(last.outcome==='refused'?1:0)))fail('RIG_ATTEMPT_ENDPOINT_MISMATCH');
 if(input.nudge){
  const commit=evidence.attempts.find(a=>a.cupId==='cup-1'&&a.stage==='commit')?.recordedTick;
  const cupAt=(t:number)=>props.samples[t]?.props.find(p=>p.propId===birth.propId)?.positionM,before=commit===undefined?undefined:cupAt(commit);
  if(commit===undefined||!before||!world.records[commit+1]?.command?.worldPerturbations?.some(p=>p.presetId==='world-cup-nudge-v1'&&p.targetId===birth.propId)||!Array.from({length:25},(_,k)=>cupAt(commit+1+k)).some(q=>q&&Math.hypot(q[0]-before[0],q[1]-before[1])>=.003))fail('NUDGE_NOT_OBSERVED');
 }
 const sweep=await evaluateWorldSweepAsync(world.records,admission,source.entries,{runId:m.runId,bootId:cp.world.snapshot.bootId,sceneDigest:sceneDigest!,lastCommittedTick:h,businessEpochMs:m.clock.businessEpochMs!},true);
 if(!sweep.complete||sweep.nativeContacts.status==='not_run')fail(`RIG_CONTACT_EVIDENCE:${sweep.reasonCodes.join(',')}`);
 if(!same(sweep.nativeContacts,report.worldSweep!.nativeContacts))fail('RIG_CONTACT_REPORT_MISMATCH');
 const attempts=[...new Map(mine.map(a=>[a.attemptId,a])).values()];
 return {outcome:facts.fixedOutcome,attempts:input.mode==='fixed_program'?(facts.endpoint.commandId?1:0):attempts.length,recovered:evidence.recovery.length>0&&facts.fixedOutcome==='lifted',attention:report.outcome.status==='needs_attention',ticks:h,unexpectedContacts:sweep.nativeContacts.unexpected,beliefErrorAtCommitM:attempts[0]?.beliefErrorAtCommitM??null,endpoint:facts.endpoint,birth};
}
