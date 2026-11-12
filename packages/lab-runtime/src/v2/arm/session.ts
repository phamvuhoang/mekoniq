// Arm session (plan 03 A05): the controller's status frames become a joint trace (commanded and actual apart) and controller_sim twin
// samples; cup attachment windows and the transfer phase are a ledger; ARM03 evidence comes only from the plan 02 geometric checker
// (TS port in-process, Python port of robotics/simulation/collision through a JSON entry) over the whole trajectory. Missing checker,
// empty/incomplete trace or a geometry revision mismatch is not_run and blocks R-SIM; a viewer overlap or a controller "done" is never
// evidence. Coffee pickup admission follows the shared fixture oracle. Geometry is illustrative: no physical claim.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import type {JsonObject} from '../../../../contracts/src/index';
import type {LabEvidenceV2,TwinSampleV2,ArmObservation} from '../contracts';
import {hashJson} from '../hash';
import {forwardKinematics,toSI,type ArmModelSI,type ArmSourceModel} from '../models/arm-kinematics';
import {checkArmSweep,DEFAULT_ARM_GEOMETRY,type ArmGeometry,type ArmObstacle} from '../models/arm-collision';
import {qrotate,type Vec3} from '../frames';
import {scenarioMatrix} from '../scenario-matrix';
type VirtualGrip=Extract<ArmObservation,{kind:'arm.status.v1'}>['virtualGrip'];
export interface ArmStatusLike {virtualGrip?:VirtualGrip;seq:string;bootId:string;observedAt:string|null;controllerEpoch:number;monotonicNs?:string;reasonCodes?:string[];freshness?:{quality:'valid'|'stale'|'unknown';staleMs:number};task:{state:string;interp:string;homed:boolean;fault:string|null};joints:{actualRad:number[]|null;commandedRad:number[]|null};tcp:{positionM:number[]}|null;program:{id:string|null;state:string}}
export interface ArmTraceSample {virtualGrip?:VirtualGrip;tick:number;seq:string;bootId:string;controllerEpoch:number;receivedMonotonicNs:string;providerMonotonicNs:string|null;reasonCodes:string[];observedAt:string|null;actualRad:number[]|null;commandedRad:number[]|null;quality:'valid'|'unknown';homed:boolean;fault:string|null;program:string|null}
export interface ArmAttachment {cupId:string;fromTick:number;toTick:number|null;parent:string;receiverId?:string;endReason?:'unknown'|'lost'}
export interface ArmCupCustodyUncertainty {cupId:string;tick:number;status:'unknown'|'lost'}
export interface CheckerInput {assetRevision:JsonObject;worldRevision:{id:string;revision:number;hash:string};jointTrace:{tick:number;q:number[]}[];attachments:{cupId:string;fromTick:number;toTick:number}[];world:ArmObstacle[];model:ArmModelSI;geometry:ArmGeometry;toleranceM:number;allowedContacts:AllowedContact[]}
export interface AllowedContact {pair:[string,string];phase:'grasp'|'release';fromTick:number;toTick:number;revision:number}
export interface CheckerInterval {fromTick:number;toTick:number;heldCup:boolean;ok:boolean;evaluations:number;reason:string|null;pair:[string,string]|null;fraction:number|null;clearanceM:number|null}
export interface CheckerReport {engine:string;ok:boolean;modelRevision:string;geometryRevision:string;worldRevision:CheckerInput['worldRevision'];toleranceM:number;trace:{samples:number;fromTick:number;toTick:number};
 method:{kind:string;bound:string;toleranceM:number;maxDepth:number};intervals:CheckerInterval[];colliding:{pair:[string,string];reason:string;fraction:number|null;clearanceM:number|null;interval:{fromTick:number;toTick:number}}[];
 coverage:{intervals:number;evaluations:number;uncertain:number;allowedContactsApplied:number};allowedContacts:AllowedContact[]}
export interface ArmCheckerPort {describe():{engine:string;available:boolean;reason?:string};check(input:CheckerInput):Promise<CheckerReport>}
export interface ArmCollisionEvidenceRecord {id:'ARM03';result:'pass'|'fail'|'not_run';reasonCodes:string[];engine:string|null;modelRevision:string;geometryRevision:string|null;worldRevision:CheckerInput['worldRevision'];assetRef:JsonObject;
 trace:{samples:number;fromTick:number;toTick:number}|null;attachments:{cupId:string;fromTick:number;toTick:number}[];allowedContacts:AllowedContact[];/** Only when the pairs are static for the whole trace (a contact plant). */allowedContactsNote?:string;method:CheckerReport['method']|null;coverage:CheckerReport['coverage']|null;
 colliding:CheckerReport['colliding'];provenance:'geometric_checker';fidelity:'modeled'}
/** The A01 model directory (manifest + modified-dh.json) -> SI model whose revision is the content hash of the source table. */
export function loadArmModel(dir:string):ArmModelSI{
 const dh=JSON.parse(readFileSync(join(dir,'modified-dh.json'),'utf8')) as {id:string;units:ArmSourceModel['units'];joints:ArmSourceModel['joints'];toolTranslation:[number,number,number]};
 const manifest=JSON.parse(readFileSync(join(dir,'manifest.json'),'utf8')) as {tolerances:ArmSourceModel['tolerances']};
 return toSI({id:dh.id,convention:'modified_dh',provenance:'illustrative_reference',mekoniqRobotCode:null,units:dh.units,joints:dh.joints.map(j=>({name:j.name,alpha:j.alpha,a:j.a,d:j.d,thetaOffset:j.thetaOffset,min:j.min,max:j.max,maxVelocity:j.maxVelocity})),toolTranslation:dh.toolTranslation,tolerances:manifest.tolerances});
}
export const armModelManifest=(dir:string)=>{const bytes=readFileSync(join(dir,'manifest.json'));const m=JSON.parse(bytes.toString('utf8')) as {id:string;revision:number};return {id:m.id,revision:m.revision,manifestSha256:createHash('sha256').update(bytes).digest('hex')};};
/** Modeled world cup center, using controller actual TCP + actual joint orientation and an explicit pinned world translation. */
export function modeledCupCenter(model:ArmModelSI,actualRad:number[],tcpM:Vec3,worldFromArmBaseM:Vec3):Vec3{
 if(![...tcpM,...worldFromArmBaseM].every(Number.isFinite))throw new Error('CUP_POSE_INVALID');
 const offset=qrotate(forwardKinematics(model,actualRad).tcp.quaternionXyzw,[0,0,DEFAULT_ARM_GEOMETRY.gripperLengthM+DEFAULT_ARM_GEOMETRY.cupHeightM/2]);
 return tcpM.map((v,i)=>v+worldFromArmBaseM[i]!+offset[i]!) as Vec3;
}
// ---- checker ports (plan 02 owns the algorithm; these only carry the trace to it) ----
/** How checkArmSweep bounds an interval; also the method of an ARM03 record built from a plant's own per-tick checks. */
export const METHOD={kind:'adaptive-subdivision',bound:'reach * sum(|dq|) per interval, conservative',maxDepth:24};
const held=(att:CheckerInput['attachments'],a:number,b:number)=>att.some(x=>x.fromTick<=a&&a<=x.toTick||x.fromTick<=b&&b<=x.toTick);
const allowedFor=(ac:AllowedContact[],a:number,b:number)=>ac.filter(x=>x.fromTick<=a&&b<=x.toTick);
export function tsChecker():ArmCheckerPort{
 return {describe:()=>({engine:'capsule-sweep-v1',available:true}),
  async check(i){
   const intervals:CheckerInterval[]=[];let applied=0;
   const pairs=i.jointTrace.length>1?i.jointTrace.slice(1).map((b,k)=>[i.jointTrace[k]!,b] as const):[[i.jointTrace[0]!,i.jointTrace[0]!] as const];
   for(const [a,b] of pairs){
    const allowed=allowedFor(i.allowedContacts,a.tick,b.tick);applied+=allowed.length;
    const r=checkArmSweep(i.model,a.q,b.q,{world:i.world,heldCup:held(i.attachments,a.tick,b.tick),geometry:i.geometry,toleranceM:i.toleranceM,allowedPairs:allowed.map(x=>x.pair)});
    intervals.push({fromTick:a.tick,toTick:b.tick,heldCup:held(i.attachments,a.tick,b.tick),ok:r.ok,evaluations:r.evaluations,reason:r.reason??null,pair:r.pair??null,fraction:r.fraction??null,clearanceM:r.clearanceM??null});
   }
   const colliding=intervals.filter(x=>!x.ok).map(x=>({pair:x.pair!,reason:x.reason!,fraction:x.fraction,clearanceM:x.clearanceM,interval:{fromTick:x.fromTick,toTick:x.toTick}}));
   return {engine:'capsule-sweep-v1',ok:!colliding.length,modelRevision:i.model.revision,geometryRevision:hashJson({geometry:i.geometry,world:i.world} as unknown as JsonObject),worldRevision:i.worldRevision,toleranceM:i.toleranceM,
    trace:{samples:i.jointTrace.length,fromTick:i.jointTrace[0]!.tick,toTick:i.jointTrace.at(-1)!.tick},method:{...METHOD,toleranceM:i.toleranceM},intervals,colliding,
    coverage:{intervals:intervals.length,evaluations:intervals.reduce((n,x)=>n+x.evaluations,0),uncertain:intervals.filter(x=>x.reason==='SWEEP_UNCERTAIN').length,allowedContactsApplied:applied},allowedContacts:i.allowedContacts};
  }};
}
/** robotics/simulation/collision (plan 02 SIM-05) through `python3 -m collision`: JSON in, report out. Unavailable when the import fails. */
export function pythonChecker(o:{python:string;simDir:string}):ArmCheckerPort{
 let probe:{engine:string;available:boolean;reason?:string}|null=null;
 const describe=()=>{if(!probe){const r=spawnSync(o.python,['-c','import collision.arm_swept_path as c; print(c.ENGINE)'],{cwd:o.simDir,encoding:'utf8'});probe=r.status===0?{engine:r.stdout.trim(),available:true}:{engine:'none',available:false,reason:`CHECKER_IMPORT_FAILED:${(r.stderr||'').trim().split('\n').pop()??''}`};}return probe;};
 return {describe,async check(i){
  const r=spawnSync(o.python,['-m','collision'],{cwd:o.simDir,encoding:'utf8',input:JSON.stringify({...i,model:{id:i.model.id,revision:i.model.revision,convention:i.model.convention,jointNames:i.model.jointNames,links:i.model.links,limits:i.model.limits,toolM:i.model.toolM}}),maxBuffer:64*1024*1024});
  if(r.status!==0)throw new Error(`CHECKER_FAILED:${(r.stderr||'').trim().split('\n').pop()??r.status}`);
  return JSON.parse(r.stdout) as CheckerReport;}};
}
// ---- the session ----
export interface ArmSessionOptions {model:ArmModelSI;checker:ArmCheckerPort;entityId:string;runId:string;providerId:string;staleMs:number;geometry?:ArmGeometry;toleranceM?:number;monotonicNs?:()=>bigint}
export interface ArmSession {
 ingest(status:ArmStatusLike,receivedMonotonicNs:string):ArmTraceSample;samples():TwinSampleV2[];latestSample():TwinSampleV2|null;trace():ArmTraceSample[];
 attach(cupId:string,tick:number,o:{parent:string}):void;detach(cupId:string,tick:number,o?:{receiverId:string;parent:string}):void;attachments():ArmAttachment[];transferPhase(tick:number):'idle'|'approach'|'grasp'|'carry'|'release';
 invalidateCupCustody(cupId:string,tick:number,status:'unknown'|'lost'):void;
 setScene(s:{revision:string;world?:ArmObstacle[]}):void;
 collisionEvidence(i:{world:ArmObstacle[];worldRevision:CheckerInput['worldRevision'];assetRef:JsonObject;sceneRevision?:string}):Promise<ArmCollisionEvidenceRecord>;
 capability():{coupling:'closed_loop_controller';closedLoop:boolean;armController:string;feedback:'controller_actual'|'none';checker:{engine:string;available:boolean;reason?:string};model:{id:string;revision:string};provenance:'controller_sim'};
 report():{provider:string;samples:number;attachments:ArmAttachment[];lastStatus:ArmTraceSample|null;sceneRevision:string|null;custodyUncertainty:ArmCupCustodyUncertainty[]};
}
export function createArmSession(o:ArmSessionOptions):ArmSession{
 const trace:ArmTraceSample[]=[],samples:TwinSampleV2[]=[],ledger:ArmAttachment[]=[],custodyUncertainty=new Map<string,ArmCupCustodyUncertainty>();let sceneRevision:string|null=null;
 let currentWorld:ArmObstacle[]|undefined;const sceneFrames:(ArmObstacle[]|undefined)[]=[];
 const geometry=o.geometry??DEFAULT_ARM_GEOMETRY,toleranceM=o.toleranceM??0.0005;
 if(!Number.isFinite(o.staleMs)||o.staleMs<=0)throw new Error('ARM_STALE_THRESHOLD_INVALID');
 const staleNs=BigInt(Math.ceil(o.staleMs*1e6)),now=o.monotonicNs??(()=>process.hrtime.bigint());
 const unsigned=(n:string|undefined|null)=>n!==undefined&&n!==null&&/^\d+$/.test(n)?BigInt(n):null;
 const joints=(q:number[]|null)=>q?.length===6&&q.every(Number.isFinite)?[...q]:null;
 let lastIngestedAt:bigint|null=null;
 const session:ArmSession={
  ingest(s,receivedMonotonicNs){
   const actual=joints(s.joints.actualRad),commanded=joints(s.joints.commandedRad),tick=trace.length,previous=trace.at(-1);
   const codes=[...(s.reasonCodes??[])],bad=(reason:string)=>codes.push(`${reason}:${tick}`);
   const receipt=unsigned(receivedMonotonicNs),provider=unsigned(s.monotonicNs),seq=unsigned(s.seq);
   if(!actual&&!codes.includes('POSE_MISSING'))codes.push('POSE_MISSING');
   if(s.freshness&&s.freshness.quality!=='valid')bad(`TRACE_PROVIDER_${s.freshness.quality.toUpperCase()}`);
   if(codes.some(c=>c.startsWith('SEQ_GAP:')))bad('TRACE_SEQUENCE_GAP');
   if(receipt===null)bad('TRACE_RECEIPT_INVALID');
   if(seq===null)bad('TRACE_SEQUENCE_INVALID');
   if(s.monotonicNs!==undefined&&provider===null)bad('TRACE_PROVIDER_INVALID');
   if(previous){
    if(s.bootId!==previous.bootId)bad('TRACE_BOOT_CHANGED');
    if(s.controllerEpoch!==previous.controllerEpoch)bad('TRACE_EPOCH_CHANGED');
    const priorSeq=unsigned(previous.seq),priorReceipt=unsigned(previous.receivedMonotonicNs),priorProvider=unsigned(previous.providerMonotonicNs);
    // The bridge sequence includes lifecycle events: a numerical gap alone is not evidence of a lost status frame.
    if(seq!==null&&priorSeq!==null&&seq<=priorSeq)bad('TRACE_SEQUENCE_REORDERED');
    if(receipt!==null&&priorReceipt!==null){if(receipt<priorReceipt)bad('TRACE_RECEIPT_REORDERED');else if(receipt-priorReceipt>staleNs)bad('TRACE_RECEIPT_GAP');}
    if(provider!==null&&priorProvider!==null){if(provider<=priorProvider)bad('TRACE_PROVIDER_REORDERED');else if(provider-priorProvider>staleNs)bad('TRACE_PROVIDER_GAP');}
   }
   const quality=actual&&!codes.some(c=>c.startsWith('TRACE_'))?'valid':'unknown';
   const t:ArmTraceSample={tick,seq:s.seq,bootId:s.bootId,controllerEpoch:s.controllerEpoch,receivedMonotonicNs,providerMonotonicNs:s.monotonicNs??null,reasonCodes:codes,observedAt:s.observedAt,actualRad:actual,commandedRad:commanded,quality,homed:s.task.homed,fault:s.task.fault,program:s.program.id,...s.virtualGrip?{virtualGrip:structuredClone(s.virtualGrip)}:{}};
   lastIngestedAt=now();
   trace.push(t);sceneFrames.push(currentWorld?structuredClone(currentWorld):undefined);
   samples.push({schemaVersion:2,runId:o.runId,entityId:o.entityId,providerId:o.providerId,bootId:s.bootId,seq:s.seq,simTimeNs:null,observedAt:s.observedAt,receivedMonotonicNs,frameId:'arm_base',origin:'controller_sim',quality,
    reasonCodes:[...codes],commanded:commanded?{jointsRad:commanded}:null,observed:actual?{jointsRad:actual,homed:s.task.homed,...s.virtualGrip?{virtualGrip:structuredClone(s.virtualGrip),gripper:s.virtualGrip.closeOutput===null?'unknown':s.virtualGrip.closeOutput?'closed':'open'}:{},...s.tcp?{tcpM:[...s.tcp.positionM]}:{}}:null,estimated:null,causationId:null} as TwinSampleV2);
   return structuredClone(t);
  },
  samples:()=>samples.map(x=>structuredClone(x)),latestSample:()=>samples.length?structuredClone(samples.at(-1)!):null,trace:()=>structuredClone(trace),
  attach(cupId,tick,a){const active=ledger.find(x=>x.toTick===null);if(active){if(active.cupId===cupId&&active.parent===a.parent)return;throw new Error('ARM_ATTACHMENT_CONFLICT');}ledger.push({cupId,fromTick:tick,toTick:null,parent:a.parent});},
  detach(cupId,tick,a){const x=ledger.find(e=>e.cupId===cupId&&e.toTick===null);if(!x)throw new Error('ATTACHMENT_UNKNOWN');x.toTick=tick;if(a){x.receiverId=a.receiverId;}},
  attachments:()=>ledger.map(x=>({...x})),
  invalidateCupCustody(cupId,tick,status){
   const active=ledger.find(a=>a.cupId===cupId&&a.toTick===null);
   if(active){active.toTick=tick;active.endReason=status;}
   // Keep the first uncertainty in this trace. Closing a known span does not prove an absent cup,
   // and later healthy controller samples cannot repair missing physical custody evidence.
   if(!custodyUncertainty.has(cupId))custodyUncertainty.set(cupId,{cupId,tick,status});
  },
  transferPhase(tick){for(const a of ledger){if(a.endReason&&a.toTick!==null&&tick>=a.toTick)continue;if(tick===a.fromTick)return 'grasp';if(a.toTick!==null&&tick===a.toTick)return 'release';if(tick>a.fromTick&&(a.toTick===null||tick<a.toTick))return 'carry';}return ledger.some(a=>tick<a.fromTick)?'approach':'idle';},
  setScene(s){sceneRevision=s.revision;currentWorld=s.world?structuredClone(s.world):undefined;},
  async collisionEvidence(i){
   const checkedCustody=[...custodyUncertainty.values()];
   const checkedTrace=structuredClone(trace); // later status frames belong to a subsequent evidence span
   const base:ArmCollisionEvidenceRecord={id:'ARM03',result:'not_run',reasonCodes:[],engine:null,modelRevision:o.model.revision,geometryRevision:null,worldRevision:i.worldRevision,assetRef:i.assetRef,trace:null,attachments:[],allowedContacts:[],method:null,coverage:null,colliding:[],provenance:'geometric_checker',fidelity:'modeled'};
   const notRun=(...codes:string[])=>({...base,reasonCodes:codes});
   if(checkedCustody.length)return notRun(...checkedCustody.map(c=>`CUP_CUSTODY_${c.status.toUpperCase()}:${c.cupId}:${c.tick}`));
   const d=o.checker.describe();if(!d.available)return notRun(`CHECKER_UNAVAILABLE:${d.reason??'NO_REASON'}`);
   if(!checkedTrace.length)return notRun('TRACE_EMPTY');
   const missing=checkedTrace.filter(t=>!t.actualRad).map(t=>t.tick);if(missing.length)return notRun(`TRACE_INCOMPLETE:${missing.join(',')}`);
   const gaps=checkedTrace.flatMap(t=>t.reasonCodes.filter(c=>c.startsWith('TRACE_')));if(gaps.length)return notRun(...gaps);
   if(i.sceneRevision!==undefined&&sceneRevision!==null&&i.sceneRevision!==sceneRevision)return notRun(`GEOMETRY_REVISION_MISMATCH:${sceneRevision}!=${i.sceneRevision}`);
   const last=checkedTrace.at(-1)!.tick,attachments=ledger.map(a=>({cupId:a.cupId,fromTick:a.fromTick,toTick:a.toTick??last}));
   const ids=new Set([...i.world,...sceneFrames.flatMap(w=>w??[])].map(w=>w.id)),allowed:AllowedContact[]=[];
   // grasp: the gripper closes on the cup at the nozzle and, from the grasp tick, the held-cup capsule coincides with it; both pairs are excused for that interval only
   for(const a of ledger){if(ids.has(`cup:${a.cupId}`))for(const body of ['gripper','held-cup'] as const)allowed.push({pair:[body,`cup:${a.cupId}`],phase:'grasp',fromTick:Math.max(0,a.fromTick-1),toTick:a.fromTick,revision:i.worldRevision.revision});
    if(a.toTick!==null&&a.receiverId&&ids.has(`tray:${a.receiverId}`))allowed.push({pair:['held-cup',`tray:${a.receiverId}`],phase:'release',fromTick:Math.max(0,a.toTick-1),toTick:Math.min(last,a.toTick+1),revision:i.worldRevision.revision});}
   // an attached cup is part of the arm, not an obstacle: segments of the trace share one world each (the cup leaves the world once held at both ends)
   const attachedAt=(t:number)=>new Set(ledger.filter(a=>a.fromTick<=t&&(a.toTick===null||t<a.toTick)).map(a=>a.cupId));
   const worldFor=(a:number,b:number)=>{const both=[...attachedAt(a)].filter(c=>attachedAt(b).has(c));
    // Conservative swept bounds across each actual sample interval; no final-scene replay over earlier motion.
    const from=sceneFrames[a]??i.world,to=sceneFrames[b]??i.world,world=new Map(from.map(w=>[w.id,structuredClone(w)]));
    for(const w of to){const old=world.get(w.id);if(old?.kind==='box'&&w.kind==='box')world.set(w.id,{...w,min:old.min.map((v,k)=>Math.min(v,w.min[k]!)) as Vec3,max:old.max.map((v,k)=>Math.max(v,w.max[k]!)) as Vec3});else if(old&&JSON.stringify(old)!==JSON.stringify(w)){world.set(`${w.id}:end`,{...w,id:`${w.id}:end`});}else world.set(w.id,w);}
    return [...world.values()].filter(w=>!both.some(c=>w.id===`cup:${c}`));};
   const segments:{from:number;to:number;world:ArmObstacle[]}[]=[];
   if(checkedTrace.length===1)segments.push({from:0,to:0,world:i.world});
   for(let k=0;k+1<checkedTrace.length;k++){const w=worldFor(k,k+1),key=JSON.stringify(w),s=segments.at(-1);if(s&&JSON.stringify(s.world)===key&&s.to===k)s.to=k+1;else segments.push({from:k,to:k+1,world:w});}
   const reports:CheckerReport[]=[];
   try{for(const s of segments)reports.push(await o.checker.check({assetRevision:i.assetRef,worldRevision:i.worldRevision,jointTrace:checkedTrace.slice(s.from,s.to+1).map(t=>({tick:t.tick,q:t.actualRad!})),attachments,world:s.world,model:o.model,geometry,toleranceM,allowedContacts:allowed}));}
   catch(e){return notRun(`CHECKER_FAILED:${(e as Error).message}`);}
   const colliding=reports.flatMap(r=>r.colliding),reasons=[...new Set(colliding.map(c=>c.reason))];
   const geometryRevision=reports.length===1?reports[0]!.geometryRevision:hashJson({segments:reports.map(r=>r.geometryRevision)} as unknown as JsonObject);
   return {...base,result:colliding.length?'fail':'pass',reasonCodes:reasons,engine:reports[0]!.engine,geometryRevision,trace:{samples:checkedTrace.length,fromTick:0,toTick:last},attachments,allowedContacts:allowed,method:reports[0]!.method,
    coverage:{intervals:reports.reduce((n,r)=>n+r.coverage.intervals,0),evaluations:reports.reduce((n,r)=>n+r.coverage.evaluations,0),uncertain:reports.reduce((n,r)=>n+r.coverage.uncertain,0),allowedContactsApplied:reports.reduce((n,r)=>n+r.coverage.allowedContactsApplied,0)},colliding};
  },
  capability(){const d=o.checker.describe(),age=lastIngestedAt===null?null:now()-lastIngestedAt,live=trace.at(-1)?.quality==='valid'&&age!==null&&age>=0n&&age<=staleNs;return {coupling:'closed_loop_controller',closedLoop:live,armController:o.providerId,feedback:live?'controller_actual':'none',checker:d,model:{id:o.model.id,revision:o.model.revision},provenance:'controller_sim'};},
  report(){return {provider:o.providerId,samples:trace.length,attachments:ledger.map(x=>({...x})),lastStatus:trace.at(-1)?structuredClone(trace.at(-1)!):null,sceneRevision,custodyUncertainty:[...custodyUncertainty.values()].map(c=>({...c}))};},
 };
 return session;
}
// ---- ARM03 evidence record (LabEvidenceV2) ----
export function buildArmCollisionEvidence(o:{schemaHash:string;runId:string;inputs:{projectHash:string;sourceCommit:string;seed:number;mode:'mock'|'simulation';access:'simulated';backends:string[]};record:ArmCollisionEvidenceRecord}):LabEvidenceV2{
 const row=scenarioMatrix.find(r=>r.id==='ARM03')!,r=o.record,isLink=(p:string)=>p.startsWith('link-'),ran=r.result!=='not_run';
 const self=r.colliding.filter(c=>c.pair.every(isLink)),scene=r.colliding.filter(c=>c.pair.some(p=>/^(fixture:|robot:|tray:|cup:|injected-)/.test(p))),cup=r.colliding.filter(c=>c.pair.includes('held-cup'));
 const detail=(hits:typeof r.colliding,ok:string)=>hits.length?hits.map(c=>`${c.pair.join('/')} ${c.reason} @${c.interval.fromTick}-${c.interval.toTick}`).join('; '):ok;
 // the record's own verdict gates the result; the name buckets below only explain which class of pair failed (an unclassified pair still fails)
 const assertions=[
  {id:'any-collision',passed:ran&&r.result==='pass'&&!r.colliding.length,detail:ran?detail(r.colliding,`checker verdict ${r.result}: no collision or uncertain interval`):r.reasonCodes.join(',')},
  {id:'self-collision',passed:ran&&!self.length,detail:ran?detail(self,'no non-adjacent link pair closer than the tolerance'):r.reasonCodes.join(',')},
  {id:'scene-collision',passed:ran&&!scene.length,detail:ran?detail(scene,`arm/gripper/cup against ${r.worldRevision.id} r${r.worldRevision.revision}: clear`):r.reasonCodes.join(',')},
  {id:'attached-cup-swept-path',passed:ran&&!cup.length&&(r.coverage?.uncertain??1)===0,detail:ran?`${r.attachments.length} attachment window(s), ${r.allowedContacts.length} phase-scoped allowed contact(s); ${detail(cup,'held cup clear along the whole trajectory')}`:r.reasonCodes.join(',')},
  {id:'coverage',passed:ran&&(r.coverage?.intervals??0)>0&&(r.coverage?.uncertain??1)===0,detail:ran?`${r.engine} ${r.method?.kind}: ${r.coverage?.intervals} intervals, ${r.coverage?.evaluations} evaluations, ${r.coverage?.uncertain} uncertain; ticks ${r.trace?.fromTick}-${r.trace?.toTick}`:r.reasonCodes.join(',')},
 ];
 return {schemaVersion:2,id:`ARM03:${o.runId}:arm-collision`,requirementIds:row.requirementIds,scenarioId:'ARM03',runId:o.runId,inputsManifest:{...o.inputs,schemaHash:o.schemaHash},
  result:r.result==='not_run'?'not_run':r.result==='fail'||!assertions.every(a=>a.passed)?'fail':'pass',assertions,artifacts:[{name:'arm-collision.json',sha256:hashJson(r as unknown as JsonObject)}],actualFidelity:'modeled',signer:{id:'lab-runtime',trust:'local_unsigned'}} as LabEvidenceV2;
}
// ---- coffee pickup/handoff admission (shared fixture oracle; the Python bridge evaluates the same rules) ----
export interface PickupInputs {brew:{ack:boolean;complete:boolean};ice:{required:boolean;complete:boolean;fault:string|null};milk:{required:boolean;complete:boolean;fault:string|null;batchFresh:boolean};cup:{present:boolean;id:string|null;expectedId:string;verified:boolean};
 gripper:{secure:boolean};receiver:{ready:boolean};cleaning:{fresh:boolean};interlock:{ok:boolean};cancel:{whileHolding:boolean};feedback:{lost:boolean}}
export function admitPickup(i:PickupInputs):{pickup:'allowed'|'blocked';reasonCodes:string[];custody:'cell'|'arm'|'unresolved';served:false}{
 const codes:string[]=[];
 if(!i.brew.complete)codes.push('BREW_NOT_COMPLETE');
 if(i.ice.required){if(i.ice.fault)codes.push('ICE_JAM');else if(!i.ice.complete)codes.push('ICE_NOT_COMPLETE');}
 if(i.milk.required){if(i.milk.fault)codes.push('MILK_EMPTY');else if(!i.milk.complete)codes.push('MILK_NOT_COMPLETE');if(!i.milk.batchFresh)codes.push('MILK_BATCH_STALE');}
 if(!i.cup.present)codes.push('CUP_ABSENT');else if(i.cup.id!==i.cup.expectedId)codes.push('CUP_IDENTITY_MISMATCH');else if(!i.cup.verified)codes.push('CUP_NOT_VERIFIED');
 if(!i.cleaning.fresh)codes.push('CLEANING_STALE');
 if(!i.interlock.ok)codes.push('INTERLOCK_NOT_READY');
 if(codes.length)return {pickup:'blocked',reasonCodes:codes,custody:'cell',served:false};
 if(!i.gripper.secure)return {pickup:'blocked',reasonCodes:['GRIP_NOT_SECURE'],custody:'unresolved',served:false};
 if(i.feedback.lost)return {pickup:'blocked',reasonCodes:['FEEDBACK_LOST'],custody:'unresolved',served:false};
 if(i.cancel.whileHolding)return {pickup:'blocked',reasonCodes:['CANCELLED_WHILE_HOLDING'],custody:'unresolved',served:false};
 return {pickup:'allowed',reasonCodes:i.receiver.ready?[]:['RECEIVER_NOT_READY'],custody:'arm',served:false};
}
