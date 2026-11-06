import type {RunReport} from '../report';
import type {JsonObject} from '../../../../contracts/src/index';
import {hashJson} from '../hash';
import type {ArmCollisionEvidenceRecord,ArmTraceSample} from '../arm/session';
import type {SilAssertion} from './campaign';
export interface NativeFaultExpectation {faultId:string;outcome:'needs_attention';attentionReasons:string[]}
export interface NativeFaultBaseline {id:string;kind:string;sourceCursor:string;arm:ArmCollisionEvidenceRecord|null;armTickMap:NonNullable<RunReport['verification']>['armTickMap'];armSamples:unknown[];armTrace:ArmTraceSample[];navSamples:unknown[];contacts:{available:boolean;contacts:unknown[];sensors:JsonObject[]};cups:JsonObject[];blockers:string[]}
export function validateNativeFaultExpectation(value:unknown):NativeFaultExpectation{
 const v=value as NativeFaultExpectation;if(!v||typeof v!=='object'||Object.keys(v).some(k=>!['faultId','outcome','attentionReasons'].includes(k))||!/^[-A-Za-z0-9_.:]{1,200}$/.test(v.faultId)||v.outcome!=='needs_attention'||!Array.isArray(v.attentionReasons)||!v.attentionReasons.length||v.attentionReasons.length>10||v.attentionReasons.some(r=>typeof r!=='string'||!/^[-A-Za-z0-9_.:]{1,200}$/.test(r)))throw new Error('NATIVE_FAULT_EXPECTATION_INVALID');return structuredClone(v);
}
// Only these fields can change while an unresolved transfer retains its command/custody identity.
function pendingIdentity(value:unknown):unknown {
 if(value===null||value===undefined)return null;
 return Object.fromEntries(Object.entries(value as JsonObject).filter(([key])=>!['giver','receiver','lastResult','lastObservedBy'].includes(key)));
}
function mappedArmSamples(b:NativeFaultBaseline,report:RunReport,faultTick:unknown):boolean {
 const map=b.armTickMap,trace=b.armTrace,bounds=b.arm?.trace;
 if(!map||!trace||!bounds||map.length!==b.armSamples.length||trace.length!==map.length||bounds.samples!==map.length||bounds.fromTick!==0||bounds.toTick!==map.length-1||!Number.isSafeInteger(faultTick)||Number(faultTick)<0||!Number.isSafeInteger(report.outcome.tick)||Number(faultTick)>report.outcome.tick)return false;
 return map.every((m,i)=>{
  const sample=b.armSamples[i] as {entityId?:string;bootId?:string;seq?:string;receivedMonotonicNs?:string;observed?:{jointsRad?:number[]}},t=trace[i]!,previous=map[i-1];
  return typeof sample.entityId==='string'&&sample.entityId.length>0&&typeof sample.bootId==='string'&&sample.bootId.length>0&&typeof sample.seq==='string'&&/^[0-9]+$/.test(sample.seq)&&m.entityId===sample.entityId&&m.bootId===sample.bootId&&m.seq===sample.seq&&m.sampleTick===i&&t.tick===m.sampleTick&&t.bootId===m.bootId&&t.seq===m.seq&&t.quality==='valid'&&Number.isSafeInteger(t.controllerEpoch)&&t.controllerEpoch>=0&&t.controllerEpoch===trace[0]!.controllerEpoch&&t.receivedMonotonicNs===sample.receivedMonotonicNs&&Array.isArray(t.actualRad)&&hashJson(t.actualRad)===hashJson(sample.observed?.jointsRad??null)&&Number.isSafeInteger(m.runTick)&&m.runTick>=0&&m.runTick<=Number(faultTick)&&(!previous||m.runTick>=previous.runTick&&m.entityId===previous.entityId&&m.bootId===previous.bootId&&typeof previous.seq==='string'&&/^[0-9]+$/.test(previous.seq)&&BigInt(sample.seq)>BigInt(previous.seq));
 });
}
/** Pure test oracle. Business RunReport is never rewritten. Caller separately gates actual-engine provenance. */
export function assessNativeFaultCase(expectation:NativeFaultExpectation,report:RunReport,log:JsonObject[],baselines:NativeFaultBaseline[],dispatches:JsonObject[]):SilAssertion[]{
 const records=log.filter(r=>r.id===expectation.faultId),intent=records.find(r=>r.status==='intent'),baseline=baselines.find(b=>b.id===expectation.faultId),kind=String(intent?.kind),restart=kind==='controller-restart';
 const applied=records.some(r=>{if(r.status!=='observed')return false;const p=r.proof as JsonObject|undefined;if(!p)return false;return kind==='tunnel-loss'?p.producer==='transport'&&p.closed===true:kind==='missing-cup'?p.producer==='modeled_coffee_sensor'&&p.present===false&&Array.isArray(p.cupIds)&&p.cupIds.length>0:kind==='grip-failure'?p.producer==='linuxcnc_virtual_grip'&&p.state==='fault':kind==='amr-disconnect'?p.producer==='native_navigation_transport'&&p.request==='rejected_disconnected':kind==='amr-delay'?p.producer==='native_navigation_transport'&&typeof p.delayMs==='number'&&p.delayMs>0&&p.delayMs<=1000:kind==='blocker'?p.producer==='gazebo_world'&&p.blocker==='native_fault'&&p.applied===true:false;});
 const observation=records.find(r=>r.status===(restart?'observed_transition':'fired'));
 const transition=observation?.before as JsonObject|undefined,after=observation?.after as JsonObject|undefined;
 const observed=records.filter(r=>r.status==='intent').length===1&&!!observation&&!records.some(r=>r.status==='unperformed')&&(restart||applied)&&(!restart||!!transition&&!!after&&typeof transition.bootId==='string'&&typeof after.bootId==='string'&&Number.isSafeInteger(transition.controllerEpoch)&&Number.isSafeInteger(after.controllerEpoch)&&transition.bootId!==after.bootId&&transition.controllerEpoch!==after.controllerEpoch);
 const exercised=kind!=='missing-cup'||!!report.coffee?.jobs.length&&!!report.coffee.cups.some(c=>c.present===false);
 const reasons=report.attention.map(a=>a.reason),attention=report.outcome.status===expectation.outcome&&reasons.length>0&&reasons.every(r=>expectation.attentionReasons.includes(r))&&expectation.attentionReasons.some(r=>reasons.includes(r));
 const later=baseline?report.businessEvents.filter(e=>BigInt(e.sequence)>BigInt(baseline.sourceCursor)):[];
 const custody=!!baseline&&report.outcome.served==='0'&&!later.some(e=>['CupTransferConfirmed','CargoLoaded','DeliveryHandedOff','CupHandedOff'].includes(e.type))&&baseline.cups.every(before=>{const cup=report.coffee?.cups.find(c=>c.cupId===before.cupId);return !!cup&&cup.ownerKind===before.ownerKind&&cup.ownerId===before.ownerId&&cup.slot===before.slot&&cup.epoch===before.epoch&&hashJson(pendingIdentity(cup.pendingTransfer))===hashJson(pendingIdentity(before.pendingTransfer));});
 const ids=dispatches.map(d=>`${d.provider??'unknown'}:${String(d.commandId)}`),noReplay=new Set(ids).size===ids.length&&[...report.effects,...report.coffee?.cellEffects??[]].every(e=>e.attempts<=1)&&!report.recoveredOps.some(r=>!r.committed);
 const validSample=(s:unknown,providerId:string)=>{const v=s as {runId?:string;quality?:string;providerId?:string};return v.runId===report.manifest.runId&&v.quality==='valid'&&v.providerId===providerId;};
 const samples=!!baseline&&baseline.armSamples.length>=2&&baseline.navSamples.length>=2&&mappedArmSamples(baseline,report,intent?.tick)&&baseline.navSamples.every(s=>validSample(s,'gazebo_nav2'))&&baseline.armSamples.every(s=>validSample(s,'linuxcnc_sim'));
 const gap=baseline?.blockers.some(b=>/COVERAGE_GAP|NAV_STALE|SAMPLE_INVALID|CLOCK_REGRESSION/.test(b));
 const contact=!!baseline&&baseline.contacts.available&&baseline.contacts.sensors.length>=2&&baseline.contacts.sensors.every(s=>s.alive===true)&&!baseline.contacts.contacts.length&&report.metrics.collision.contacts===0;
 const collision=(report.metrics.collision.contacts??0)>0||!!baseline?.contacts.contacts.length||baseline?.arm?.result==='fail'||!!report.verification?.arm?.colliding.length||report.verification?.blockers.includes('GAZEBO_CONTACT');
 const arm=samples&&!gap&&baseline?.arm?.result==='pass';
 const fires=report.faultScheduleFires??[],schedule=fires.length===1&&fires[0]?.id===expectation.faultId&&fires[0].outcome==='applied'&&log.filter(r=>r.status==='intent').length===1&&!log.some(r=>r.status==='unperformed')&&!report.verification?.blockers.some(b=>b.startsWith('NATIVE_FAULT_NOT_FIRED:')||['CONTROLLER_RESTART_PENDING','CONTROLLER_RESTART_UNPERFORMED','FAULT_JOURNAL_FAILED'].includes(b));
 const row=(id:string,pass:boolean,reason:string):SilAssertion=>({id,result:pass?'pass':'fail',...pass?{}:{reason}});
 return [row('BV01.fault-schedule',schedule,'REQUIRED_FAULT_SCHEDULE_INCOMPLETE'),row('BV01.fault-observed',observed&&exercised,'FAULT_NOT_OBSERVED'),row('BV01.expected-attention',attention,'UNEXPECTED_BUSINESS_OUTCOME'),row('BV01.custody-preserved',custody,'CUSTODY_ADVANCED_AFTER_FAULT'),row('BV01.no-replay',noReplay,'COMMAND_REPLAY'),
 {id:'ARM03',result:collision?'fail':arm?'pass':'not_run',reason:collision?'COLLISION':arm?undefined:'PRE_FAULT_ARM_COVERAGE_MISSING',detail:'Negative-case coverage ends immediately before fault injection; no post-loss physics pass is claimed.'},
 {id:'SIM.engine-samples',result:samples&&!gap?'pass':'not_run',reason:samples&&!gap?undefined:'PRE_FAULT_ENGINE_SAMPLES_MISSING'},
 {id:'SIM.no-contact',result:collision?'fail':contact?'pass':'not_run',reason:collision?'CONTACT':contact?undefined:'PRE_FAULT_CONTACT_COVERAGE_MISSING'},
 row('BV01.cup-ledger',custody,'CUSTODY_NOT_PRESERVED')];
}
