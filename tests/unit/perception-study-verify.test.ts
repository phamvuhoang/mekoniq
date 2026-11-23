import {afterEach,expect,test} from 'vitest';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {verifyPerceptionStudy} from '../../packages/lab-runtime/src/v2/perception/perception-study';
import {readPickRigEvidence} from '../../packages/lab-runtime/src/v2/perception/pick-rig-evidence';
import {hashJson} from '../../packages/lab-runtime/src/v2/hash';
import {studyFixture} from '../support/pick-rig';
const dirs:string[]=[];
afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
const fixture=async(...args:Parameters<typeof studyFixture>)=>{const h=await studyFixture(...args);dirs.push(h.root);return h;};
const check=async(h:Awaited<ReturnType<typeof fixture>>)=>(await verifyPerceptionStudy(h.root,h.record.input.mode==='fixed_program'?'fixed-20mm':h.input.nudge?'stale-nudge':'truth-0')).issues.filter(x=>x.startsWith(h.directory.slice(h.root.length+1)+':'));
const read=(h:Awaited<ReturnType<typeof fixture>>)=>readPickRigEvidence(h.directory,h.input,h.report);
const syncProps=(h:Awaited<ReturnType<typeof fixture>>)=>{h.props.samples=h.records.map(r=>({tick:r.snapshot.tick,props:r.snapshot.props!.map(p=>({propId:p.propId,positionM:[...p.position],quaternionXyzw:[...p.quaternionXyzw],restingOn:p.restingOn,held:r.snapshot.arms![0]!.gripper!.heldPropIds.includes(p.propId)}))}));};
test.each(['truth-0','fixed-20mm','stale-nudge'])('the %s reader derives one shared grasp endpoint and binds birth/props to the world',async point=>{
 const h=await fixture(point,point==='fixed-20mm'?2:1);expect(await check(h)).toEqual([]);
 const d=await read(h);expect(d).toMatchObject({outcome:'lifted',ticks:point==='stale-nudge'?50:30,unexpectedContacts:0,endpoint:{lastTick:point==='stale-nudge'?50:30,reason:'resolved'},birth:{tick:1,cupId:'cup-1'}});
});
test('historical study bytes explicitly require a new endpoint protocol',async()=>{
 const h=await fixture();await writeFile(join(h.root,'campaign.json'),JSON.stringify({campaign:{id:'perception-gap-v1'}}));const v=await verifyPerceptionStudy(h.root,'truth-0');expect(v.completedRuns).toBe(0);expect(v.issues).toEqual(['STUDY_ENDPOINT_PROTOCOL_UNSUPPORTED']);
});
test.each(['points','max_ticks','source','acceptance','calibration','execution'])('the study rejects %s outside the registered campaign identity',async mode=>{
 const h=await fixture(),path=join(h.root,'campaign.json'),doc=JSON.parse(await readFile(path,'utf8'));
 if(mode==='points')doc.campaign.points[0].seeds=[999];if(mode==='max_ticks')doc.campaign.maxTicks=999;if(mode==='source')doc.sourceCommit='development:study';if(mode==='acceptance')doc.accepted=true;if(mode==='calibration')doc.calibration='calibrated';if(mode==='execution')doc.execution='mock';
 await writeFile(path,JSON.stringify(doc));const v=await verifyPerceptionStudy(h.root,'truth-0');expect(v.completedRuns).toBe(0);expect(v.issues.join()).toMatch(/STUDY_(CAMPAIGN|SOURCE)_IDENTITY/);
});
test.each(['mode','profile','recovery'])('the requested mode is bound to the retained report/checkpoint %s',async mode=>{
 const h=await fixture();if(mode==='mode')h.report.manifest.perception!.graspMode='belief_estimated';if(mode==='profile')h.report.manifest.perception!.profile.digest='d'.repeat(64);if(mode==='recovery')h.report.manifest.perception!.recoveryPolicy={id:'pick-recovery-v1',digest:'a'.repeat(64)};
 await h.write();expect((await check(h)).join()).toContain('RIG_PERCEPTION_IDENTITY');
});
test.each(['magnitude','direction','identity','missing','contradiction'])('a rehashed %s birth cannot qualify from requested offset or later settled pose',async mode=>{
 const h=await fixture('fixed-20mm',2),r=h.records[1]!;
 if(mode==='magnitude'||mode==='direction'){
  const p=r.snapshot.props![0]!.position;p[0]=mode==='magnitude'?.49:(.49-(p[0]!-.49));p[1]=mode==='magnitude'?0:-p[1]!;
  r.command!.propPlacements![0]!.pose!.position=[...p];r.interactions[0]!.commandDigest=hashJson(r.command);
  const b=r.snapshot.worldStep!.birthObservations![0]!;b.qposPositionM=[...p];b.bodyPositionM=[...p];b.requestDigest=hashJson(r.command);
 }else if(mode==='identity'){r.interactions[0]!.cupId='cup-2';r.command!.worldInteractions![0]!.cupId='cup-2';r.interactions[0]!.commandDigest=hashJson(r.command);}
 else if(mode==='missing')r.interactions=[];
 else r.interactions[0]!.after={position:[.51,0,.151],quaternionXyzw:[0,0,0,1]};
 syncProps(h);await h.write();expect((await check(h)).join()).toMatch(/RIG_(BIRTH|WORLD)/);
});
test('a rehashed requested zero offset does not excuse an actual cup born 20 mm away',async()=>{
 const h=await fixture(),r=h.records[1]!,b=r.snapshot.worldStep!.birthObservations![0]!;b.qposPositionM[0]=.51;b.bodyPositionM[0]=.51;await h.write();expect((await check(h)).join()).toContain('RIG_BIRTH_OFFSET_MISMATCH');
});
test('the native pre-step birth stays exact while the first post-step observation may move under contact',async()=>{
 const h=await fixture('fixed-20mm',2),p=h.records[1]!.snapshot.props![0]!.position;p[0]!+=.000008;p[2]!-=.0014;h.record.result.birth.firstPostStepPositionM=[...p];syncProps(h);await h.write();expect(await check(h)).toEqual([]);expect((await read(h)).birth.positionM).not.toEqual(p);
});
test.each(['missing','echo_only','body_disagrees','run','boot','scene','event','cup','prop','request','digest','tick','post_step'])('a rehashed %s native birth witness is refused',async mode=>{
 const h=await fixture(),r=h.records[1]!,b=r.snapshot.worldStep!.birthObservations![0]!;
 if(mode==='missing')delete r.snapshot.worldStep!.birthObservations;
 else if(mode==='echo_only')Object.assign(b,{method:'requested-placement-v1'});
 else if(mode==='body_disagrees')b.bodyPositionM[0]!+=.002;
 else if(mode==='post_step')b.physicsSubstepsBefore=20;
 else if(mode==='tick')b.targetTick=2;
 else Object.assign(b,{[{run:'runId',boot:'bootId',scene:'sceneDigest',event:'eventId',cup:'cupId',prop:'propId',request:'requestId',digest:'requestDigest'}[mode]!]:'a'.repeat(64)});
 await h.write();expect((await check(h)).join()).toMatch(/RIG_WORLD_EVIDENCE:.*(WORLD_BIRTH_OBSERVATION_INVALID|WORLD_EVIDENCE_RECORD_INVALID)/);
});
test.each(['outcome','ticks','attention','recovered','unexpectedContacts','birth'])('the recorded %s is recomputed, even after rehashing',async field=>{
 const h=await fixture();Object.assign(h.record.result,{[field]:field==='outcome'?'refused':field==='birth'?{}:field==='attention'||field==='recovered'?true:999});await h.write();expect((await check(h)).join()).toContain('RESULT_NOT_FROM_EVIDENCE');
});
test.each(['missing_receipt','wrong_endpoint','later_drop','later_contact'])('a rehashed %s cannot change the observation horizon',async mode=>{
 const h=await fixture();if(mode==='missing_receipt')h.sourceEvents.splice(2,1);else if(mode==='wrong_endpoint')h.sourceEvents[2]!.at=new Date(Date.parse(h.sourceEvents[2]!.at)-20).toISOString();else{
  const row=structuredClone(h.records.at(-1)!);row.snapshot.tick=31;row.snapshot.seq='32';row.snapshot.simTimeNs='620000000';row.snapshot.physics!.tick=31;row.snapshot.physics!.simTimeNs='620000000';row.snapshot.worldStep!.physicsSubsteps=320;row.command!.targetTick=31;h.records.push(row);h.report.outcome.tick=31;h.checkpoint.tick=31;h.checkpoint.world.snapshot.tick=31;h.report.arm!.worldTrace!.lastTick=31;h.report.arm!.worldTrace!.samples=32;h.report.arm!.worldTrace!.publicCommittedTick=31;h.report.worldSweep!.scope!.publicCommittedTick=31;
  if(mode==='later_drop'){row.snapshot.arms![0]!.gripper!.heldPropIds=[];h.checkpoint.coffee.arm.programs.push({...h.checkpoint.coffee.arm.programs[0]!,commandId:'place-1',program:'cup-place',state:'unknown',evidence:{...h.checkpoint.coffee.arm.programs[0]!.evidence,stopReason:'CUP_DROPPED'}} as never);}
  else row.snapshot.physics!.contacts=[{a:'floor',b:'prop/cup-1',samples:1,peakNormalN:1,normalImpulseNs:.002,netImpulseMapNs:[0,0,.002],pointAtPeakMapM:[.49,0,0],expected:false}];syncProps(h);
 }
 await h.write();expect((await check(h)).join()).toContain(mode==='missing_receipt'?'RIG_PICK_RECEIPT_MISSING':'RIG_ENDPOINT_HORIZON_MISMATCH');
});
test.each(['absent','wrong_reference','wrong_hash','wrong_count','duplicate_tick','nonfinite','other_run','missing_contact'])('a rehashed %s trace/world never supplies a successful grip or zero contacts',async mode=>{
 const h=await fixture();if(mode==='wrong_count')h.props.samples.pop();if(mode==='duplicate_tick')h.props.samples[5]!.tick=4;if(mode==='nonfinite')h.props.samples[1]!.props[0]!.positionM[0]=Number.NaN;if(mode==='other_run')h.records[3]!.snapshot.runId='other';if(mode==='missing_contact')delete (h.records[3]!.snapshot.physics as unknown as Record<string,unknown>).contacts;
 await h.write();const report=JSON.parse(await readFile(join(h.directory,'report.json'),'utf8'));
 if(mode==='absent')delete report.arm.props;if(mode==='wrong_reference')report.arm.props.path='extra-trace.json';if(mode==='wrong_hash')report.arm.props.sha256='a'.repeat(64);
 await writeFile(join(h.directory,'report.json'),JSON.stringify(report));await h.rehash();expect((await check(h)).join()).toMatch(/RIG_(PROPS|WORLD)/);
});
test('only actual per-tick props in the referenced trace observe a nudge; no recent belief is required',async()=>{
 const h=await fixture('stale-nudge');expect(await check(h)).toEqual([]);
 for(const r of h.records)if(r.snapshot.tick>=h.nudgeTick)r.snapshot.props![0]!.position[0]!-=.005;
 for(const r of h.beliefs)if(r.belief!.observedTick>=h.nudgeTick){r.truthAtObservedTick[0]-=.005;r.belief!.positionM[0]-=.005;}
 syncProps(h);await h.write();expect((await check(h)).join()).toContain('NUDGE_NOT_OBSERVED');
});
test('a nudge without its actual receipt is refused even when a displacement remains',async()=>{
 const h=await fixture('stale-nudge');h.records[h.nudgeTick]!.snapshot.worldStep!.disturbances=[];await h.write();expect((await check(h)).join()).toContain('WORLD_PERTURBATION_EVIDENCE_INVALID');
});
test('an explicit timeout remains unknown, never a failed or successful grip',async()=>{
 const h=await fixture();h.input.maxTicks=30;h.report.pickRig!.maxTicks=30;h.checkpoint.coffee.arm.programs[0]!.state='running';h.sourceEvents.splice(2);h.attempts.pop();await h.write();expect(await read(h)).toMatchObject({outcome:'unknown',endpoint:{reason:'timeout',lastTick:30}});
});
