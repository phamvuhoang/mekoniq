import {afterEach,expect,test} from 'vitest';
import {readFile,rm} from 'node:fs/promises';
import {studyFixture} from '../support/pick-rig';
import {verifyPerceptionStudy} from '../../packages/lab-runtime/src/v2/perception/perception-study';
import {readPickRigEvidence} from '../../packages/lab-runtime/src/v2/perception/pick-rig-evidence';
const dirs:string[]=[];
afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
const fixture=async()=>{const h=await studyFixture();dirs.push(h.root);return h;};
const read=(h:Awaited<ReturnType<typeof fixture>>)=>readPickRigEvidence(h.directory,h.input,h.report);
const reject=async(h:Awaited<ReturnType<typeof fixture>>,code:string)=>{await h.write();const v=await verifyPerceptionStudy(h.root,'truth-0');expect(v.completedRuns).toBe(0);expect(v.issues.join()).toContain(code);};
test.each([0,-1,.001,undefined])('F01: an unlifted cup cannot qualify by declaring liftMinM=%s',async lift=>{
 const h=await fixture(),z=lift===.001?.152:.151;
 h.records.at(-1)!.snapshot.props![0]!.position[2]=z;h.props.samples.at(-1)!.props[0]!.positionM[2]=z;
 Object.assign(h.report.manifest.armProgram!.programs.contact!,{liftMinM:lift});
 await reject(h,'RIG_LIFT_ORACLE_MISMATCH');
});
test('F01: a cup below the registered lift threshold fails even with completed receipts',async()=>{
 const h=await fixture();h.records.at(-1)!.snapshot.props![0]!.position[2]=.152;h.props.samples.at(-1)!.props[0]!.positionM[2]=.152;h.beliefs.at(-1)!.truthAtObservedTick[2]=.152;await reject(h,'RIG_LIFT_OBSERVATION_MISSING');
});
test.each(['mode','access','backendSetId','backends','scenario','scenario.id','scenario.revision','scenario.hash','project'])('F02: missing execution identity %s is refused',async key=>{
 const h=await fixture(),[parent,child]=key.split('.'),m=h.report.manifest as unknown as Record<string,unknown>;
 if(child)delete (m[parent!] as Record<string,unknown>)[child];else delete m[parent!];
 await reject(h,'RIG_EXECUTION_IDENTITY');
});
test.each(['mode','access','backendSetId','backend_model','backend_dynamics','backend_version','scenario_id','scenario_revision','scenario_hash','project_hash'])('F02: contradictory execution identity %s is refused',async key=>{
 const h=await fixture(),m=h.report.manifest;
 if(key==='mode')m.mode='mock';if(key==='access')Object.assign(m,{access:'live'});if(key==='backendSetId')m.backendSetId='mock-amr';
 if(key==='backend_model')m.backends[0]!.model='mock_amr';if(key==='backend_dynamics')m.backends[0]!.dynamics=false;if(key==='backend_version')m.backends[0]!.version='0';
 if(key==='scenario_id')m.scenario.id='FD01';if(key==='scenario_revision')m.scenario.revision=2;if(key==='scenario_hash')m.scenario.hash='a'.repeat(64);if(key==='project_hash')m.project.hash='a'.repeat(64);
 await reject(h,'RIG_EXECUTION_IDENTITY');
});
test.each(['needs_attention','completed','ready','paused','cancelled'])('F03: coordinated result/report status %s cannot replace the retained controller and journal',async status=>{
 const h=await fixture();h.report.outcome.status=status;h.record.result.attention=status==='needs_attention';await reject(h,'CELL_OUTCOME_NOT_FROM_JOURNAL');
});
test('F03: adding report attention entries as well cannot replace the checkpoint',async()=>{
 const h=await fixture();h.report.outcome.status='needs_attention';h.report.attention=[{reason:'ARM_COLLISION',tick:30,subjectId:'mission-1'}];h.record.result.attention=true;await reject(h,'CELL_OUTCOME_NOT_FROM_JOURNAL');
});
test('F03: a signed Source mission needing attention cannot be hidden by empty checkpoint/report lists',async()=>{
 const h=await fixture();h.sourceStates.set('mission/mission-1',{status:'needs_attention'});await reject(h,'CELL_OUTCOME_NOT_FROM_JOURNAL');
});
test.each(['refused','unknown','grip_not_established'] as const)('F03: a retained %s grasp and matching Source/controller attention still qualify',async outcome=>{
 const h=await fixture(),p=h.checkpoint.coffee.arm.programs[0]!;
 p.state=outcome==='refused'?'failed':'unknown';Object.assign(p.evidence,{objectPresent:false,liftPoseReached:false});if(outcome==='refused')Object.assign(h.checkpoint.coffee.arm,{grasp:{commandId:p.commandId,status:'refused'}});
 (h.sourceEvents[2]!.state.pendingTransfer as Record<string,unknown>).lastResult=outcome==='refused'?'failed':'outcome_unknown';h.sourceEvents.pop();h.attempts.at(-1)!.outcome=outcome;
 h.report.outcome.status='needs_attention';h.checkpoint.attention.push({reason:outcome==='refused'?'ARM_COLLISION':outcome==='unknown'?'COMMAND_OUTCOME_UNKNOWN':'RECOVERY_EXHAUSTED',tick:30,subjectId:'mission-1'});h.sourceStates.set('mission/mission-1',{status:'needs_attention'});
 h.records.at(-1)!.snapshot.arms![0]!.gripper!.heldPropIds=[];h.props.samples.at(-1)!.props[0]!.held=false;Object.assign(h.record.result,{outcome,attention:true});await h.write();
 expect(await read(h)).toMatchObject({outcome,attention:true,endpoint:{reason:'resolved',lastTick:30}});expect((await verifyPerceptionStudy(h.root,'truth-0')).issues).toEqual([]);
});
test('F03: a recovered final grasp retains its outcome and has no invented attention',async()=>{
 const h=await fixture(),policy=JSON.parse(await readFile('robotics/simulation-mujoco/fixtures/recovery-v1/pick-recovery-v1.json','utf8'));
 h.input.recoveryPolicyId=policy.id;h.report.manifest.perception!.recoveryPolicy={id:policy.id,digest:policy.digest};
 const last=h.attempts.at(-1)!;last.outcome='grip_not_established';last.recordedTick=10;
 const commit={...last,attemptId:'cup-1#1',index:1,decidedTick:21,recordedTick:21,stage:'commit' as const,outcome:'unknown' as const,beliefUsed:structuredClone(h.beliefs.find(b=>b.tick===21)!.belief!)};
 h.attempts.push(commit,{...commit,recordedTick:30,stage:'outcome',outcome:'lifted'});
 h.recovery.push({stepId:'recovery-1',attemptId:'cup-1#0',rule:'empty_pick',action:'retry_pick',commandId:'retry-1',recordedTick:20,completedTick:21,result:'done'});
 await h.write();expect(await read(h)).toMatchObject({outcome:'lifted',attempts:2,recovered:true,attention:false,ticks:30});
});
