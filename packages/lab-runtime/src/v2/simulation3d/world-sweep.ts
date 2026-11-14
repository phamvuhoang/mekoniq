/** Independent, bounded geometric review of complete raw world evidence. Legacy ARM03
 * retains its own truncation result. Native substep contact aggregates stay separate. */
import {setImmediate as yieldTurn} from 'node:timers/promises';
import type {DomainEvent,JournalEntry} from '../../../../contracts/src/index';
import type {WorldEvidenceRecord,RobotPhysicalModelV1} from '../../../../contracts/generated/navigation2d';
import {readWorldEvidence,validateWorldRecord,type WorldAdmission,type WorldPrefixRead} from './world-evidence';
import {worldArmGeometry,worldAllowedPairs,worldDocument} from './world-control';
import {worldArmObstacles,type WorldInteractionIntent} from './world-scene';
import {checkArmSweep,type SweepResult} from '../models/arm-collision';
import {XARM6_SI} from '../models/arm-kinematics';
import {hashJson} from '../hash';
import {READ_LIMITS} from '../navigation2d/evidence';
/** Additional bounded trusted-journal input; observations retain shared evidence limits. */
export const WORLD_SWEEP_SOURCE_LIMITS={entries:10000,bytes:16*1024*1024} as const;
export interface WorldSweepAuthority {runId:string;bootId:string;sceneDigest:string;lastCommittedTick:number;businessEpochMs:number}
export type WorldSourceJournal=readonly Pick<JournalEntry,'entryId'|'organizationId'|'venueId'|'recordedAt'|'payload'>[];
export interface WorldSweepResult {scope?:{kind:'source_committed_prefix';publicCommittedTick:number;prefixCovered:boolean;streamFinalized:boolean;identity:{runId:string;bootId:string;sceneDigest:string;admissionDigest:string|null};publication?:WorldPrefixRead['publication']};id:'world-full-capsule-v1';accepted:false;calibration:'not_calibrated';status:'pass'|'fail'|'not_run';complete:boolean;reasonCodes:string[];sourceJournal:'trusted_source_session';
 geometry:{status:'pass'|'fail'|'not_run';checkedIntervals:number;expectedIntervals:number;distinctSceneRevisions:number;uncertainIntervals:number;geometryHash:string;firstFailure:null|{tick:number;pair:string[];reason:string}};
 nativeContacts:{status:'pass'|'fail'|'not_run';aggregateRows:number;unexpected:number;firstUnexpected:null|{tick:number;a:string;b:string}};
 method:{engine:'capsule-sweep-v1';toleranceM:number;modelRevision:string;sampling:string};
}
export function unavailableWorldSweep(lastCommittedTick:number,reasonCodes:string[]):WorldSweepResult{return {id:'world-full-capsule-v1',accepted:false,calibration:'not_calibrated',status:'not_run',complete:false,reasonCodes:[...reasonCodes],sourceJournal:'trusted_source_session',geometry:{status:'not_run',checkedIntervals:0,expectedIntervals:lastCommittedTick,distinctSceneRevisions:0,uncertainIntervals:0,geometryHash:'',firstFailure:null},nativeContacts:{status:'not_run',aggregateRows:0,unexpected:0,firstUnexpected:null},method:{engine:'capsule-sweep-v1',toleranceM:.0005,modelRevision:XARM6_SI.revision,sampling:'actual consecutive arm joints and current observed full AMR geometry; native aggregates cover all10 substeps separately'}};}
function* evaluateWorldSweepSteps(records:readonly WorldEvidenceRecord[],admission:WorldAdmission,journal:WorldSourceJournal,authority:WorldSweepAuthority,complete:boolean,onInterval?:(tick:number,result:SweepResult)=>void):Generator<void,WorldSweepResult>{
 const result=unavailableWorldSweep(authority.lastCommittedTick,[]);
 try{
  if(!complete||admission.scene.controlContextVersion!==1||authority.sceneDigest!==admission.scene.sceneDigest||!Number.isFinite(authority.businessEpochMs)||!Number.isSafeInteger(authority.lastCommittedTick)||authority.lastCommittedTick<0||authority.lastCommittedTick>30000||records.length!==authority.lastCommittedTick+1||records.length>30001)throw Error('WORLD_SWEEP_INCOMPLETE');
  let observationBytes=0;for(const [i,row]of records.entries()){const n=Buffer.byteLength(JSON.stringify(row))+1;observationBytes+=n;if(n>READ_LIMITS.lineBytes||observationBytes>READ_LIMITS.totalInflated)throw Error('WORLD_SWEEP_READ_LIMIT');if((i+1)%32===0)yield;}
  if(journal.length>WORLD_SWEEP_SOURCE_LIMITS.entries||Buffer.byteLength(JSON.stringify(journal))>WORLD_SWEEP_SOURCE_LIMITS.bytes)throw Error('WORLD_SOURCE_JOURNAL_READ_LIMIT');
  const events=new Map<string,{event:DomainEvent;at:number}>();for(const entry of journal){if(entry.organizationId!==`lab-${authority.runId}`||entry.venueId!=='simulation'||!Number.isFinite(Date.parse(entry.recordedAt)))throw Error('WORLD_CONTROL_SOURCE_MISMATCH');const list=entry.payload.events as unknown as DomainEvent[];for(let i=0;i<list.length;i++){const key=`${entry.entryId}:${i}`;if(events.has(key))throw Error('WORLD_CONTROL_SOURCE_MISMATCH');events.set(key,{event:list[i]!,at:Date.parse(entry.recordedAt)});}}
  const scene=admission.scene,physical=worldDocument<RobotPhysicalModelV1>(admission.files,scene.models.mobilePhysical.path),geometry=worldArmGeometry(scene,admission.files),rid=scene.navigation.robots[0]!.robotId,aid=scene.armCell.arm.armId,revision=new Set<string>(),disturbances=new Set<string>();result.geometry.geometryHash=hashJson(geometry);let history:WorldInteractionIntent[]=[];
  for(let i=0;i<records.length;i++){
   const row=records[i]!,s=row.snapshot,previous=records[i-1]?.snapshot;history=validateWorldRecord(row,admission,history,previous,authority,disturbances);
   for(const intent of row.interactions){const e=events.get(intent.eventId)?.event;if(!e||e.type!==(intent.kind==='birth'?'CupBound':'CupHandedOff')||e.data.kind!=='cup'||e.data.id!==intent.cupId)throw Error('WORLD_LIFECYCLE_SOURCE_MISMATCH');}
   if(!previous)continue;
   const c=row.command!,control=c.worldControl!,p=control.program;
   if(c.velocities.length!==1||c.velocities[0]!.robotId!==rid||c.jointTargets?.length!==1||c.jointTargets[0]!.armId!==aid||c.gripperTargets?.length!==1||c.gripperTargets[0]!.armId!==aid)throw Error('WORLD_CONTROL_INVALID');
   if(p){const source=events.get(p.sourceEventId),e=source?.event,transfer=(e?.data.state as Record<string,unknown>)?.pendingTransfer as Record<string,unknown>|undefined,to=transfer?.to as {kind?:string;id?:string;slot?:number}|undefined;
    if(!e||source!.at>authority.businessEpochMs+(s.tick-1)*20||e.type!=='CupTransferRequested'||e.data.kind!=='cup'||e.data.id!==p.cupId||!transfer||['commandId','transferId','payloadHash','controlEpoch'].some(k=>transfer[k]!==p[k as keyof typeof p])||(p.programId==='cup-pick'?(to?.kind!=='arm'||to.id!==aid):(to?.kind!=='robot'||to.id!==rid||to.slot!==1)))throw Error('WORLD_CONTROL_SOURCE_MISMATCH');
   }
   if(control.attachmentProxyPropId&&!previous.props?.some(prop=>prop.propId===control.attachmentProxyPropId))throw Error('WORLD_CONTROL_SOURCE_MISMATCH');
   const allowedPairs=worldAllowedPairs(scene,admission.files,p?.programId??null),world=worldArmObstacles(scene,physical,s),sweep=checkArmSweep(XARM6_SI,previous.arms![0]!.positionsRad,s.arms![0]!.positionsRad,{world,geometry,heldCup:control.attachmentProxyPropId!==null,allowedPairs,toleranceM:.0005});
   result.geometry.checkedIntervals++;revision.add(sweep.geometryRevision);if(sweep.reason==='SWEEP_UNCERTAIN')result.geometry.uncertainIntervals++;if(!sweep.ok&&!result.geometry.firstFailure)result.geometry.firstFailure={tick:s.tick,pair:sweep.pair??[],reason:sweep.reason??'UNKNOWN'};onInterval?.(s.tick,sweep);
   for(const contact of s.physics!.contacts){result.nativeContacts.aggregateRows++;const pair=[contact.a,contact.b],armSide=pair.find(x=>x.startsWith(`${aid}/`)),supportSide=pair.find(x=>x.startsWith('support/')),mobileSide=pair.find(x=>x.startsWith(`${rid}/`));let unexpected=!contact.expected;
    if(armSide&&(supportSide||mobileSide)){const primitive=armSide===`${aid}/palm`||armSide.startsWith(`${aid}/pad/`)?'gripper':armSide,target=supportSide??mobileSide!;if(!allowedPairs.some(p=>p[0]===primitive&&p[1]===target))unexpected=true;}
    if(unexpected){result.nativeContacts.unexpected++;result.nativeContacts.firstUnexpected??={tick:s.tick,a:contact.a,b:contact.b};}
   }
   if((i+1)%32===0)yield;
  }
  result.geometry.distinctSceneRevisions=revision.size;result.complete=true;result.geometry.status=result.geometry.firstFailure?'fail':result.geometry.uncertainIntervals?'not_run':'pass';result.nativeContacts.status=result.nativeContacts.unexpected?'fail':'pass';result.status=result.geometry.status==='fail'||result.nativeContacts.status==='fail'?'fail':result.geometry.status==='pass'&&result.geometry.checkedIntervals===authority.lastCommittedTick?'pass':'not_run';if(result.status!=='pass')result.reasonCodes.push(result.geometry.firstFailure?.reason??'WORLD_NATIVE_CONTACT');
 }catch(error){result.reasonCodes.push((error as Error).message);result.status='not_run';result.complete=false;}
 return result;
}
/** One core preserves the legacy synchronous review and callback order. */
export function evaluateWorldSweep(...args:Parameters<typeof evaluateWorldSweepSteps>):WorldSweepResult{const work=evaluateWorldSweepSteps(...args);let step=work.next();while(!step.done)step=work.next();return step.value;}
/** Only detached, captured report materialization opts into cooperative scheduling. */
export async function evaluateWorldSweepAsync(...args:Parameters<typeof evaluateWorldSweepSteps>):Promise<WorldSweepResult>{const work=evaluateWorldSweepSteps(...args);let step=work.next();while(!step.done){await yieldTurn();step=work.next();}return step.value;}
export async function readWorldSweep(directory:string,admission:WorldAdmission,journal:WorldSourceJournal,authority:WorldSweepAuthority){const read=await readWorldEvidence(directory,admission);return evaluateWorldSweep(read.records,admission,journal,authority,read.complete);}
