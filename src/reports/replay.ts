import {physicsAt} from './physics';
// Read-only replay of a v2 run report: scrub/playback over recorded business events (durable) and telemetry (lossy), and a causal trace
// command -> observation -> business transition. No runtime client is imported here: replay cannot send anything.
import {pose3dOf} from '../twin/pose3d';
import {reportClock} from './clock';
import {validVerification} from './verification';
import type {RunReport,RunView,AmrView,CoffeeJobView,CupView,ArmCollisionView,ArmCollisionScene,ArmStopView} from '../scenarios/controls';
import type {Held,TwinSample} from '../twin/store';
type Event=RunReport['businessEvents'][number];
export interface TraceRow {tick:number;layer:'command'|'observation'|'business'|'effect'|'telemetry';type:string;id:string;entityId?:string;sequence?:string;detail?:string}
const COMMAND=/^(RobotCommandIssued|RobotGoalAssigned|CellCommandIssued|Coffee(StepStarted|JobStarted)|CupTransferRequested)$/;
const OBSERVATION=/(Observed|^RobotGoal(Accepted|Completed|Failed|Rejected)$|^MissionArrived$|Measured$|CupObserved|DeviceObserved|TransferConfirmed)/;
/** A later scene refresh cannot erase earlier retained checks or make its geometry visible early. */
function collisionAt(report:RunReport,tick:number):ArmCollisionView|null {
 const c=report.coffee?.armTrace.collision;if(!c)return null;
 const e=c.evidence;
 if(!e)return (c.scene?c.scene.tick<=tick:tick>=report.outcome.tick)?structuredClone(c):null;
 const intervals=structuredClone(e.intervals.filter(i=>Number.isFinite(i.firstTick)&&Number.isFinite(i.lastTick)&&i.firstTick<=tick&&i.lastTick>=i.firstTick)
  .map(i=>({...i,lastTick:Math.min(i.lastTick,tick)})));
 const firstFailure=e.firstFailure&&e.firstFailure.tick<=tick?structuredClone(e.firstFailure):undefined;
 if(firstFailure?.scene&&firstFailure.scene.tick>tick)firstFailure.scene=null;
 const worlds:Record<string,unknown[]>={};let missingWorld=false;
 for(const i of intervals){const world=e.worlds[i.worldRevision];if(world)worlds[i.worldRevision]=structuredClone(world);else missingWorld=true;}
 if(firstFailure)worlds[firstFailure.worldRevision]=structuredClone(firstFailure.world);
 const last=intervals.reduce<typeof intervals[number]|undefined>((a,b)=>!a||b.lastTick>a.lastTick?b:a,undefined);
 const useFailure=firstFailure&&(!last||firstFailure.tick>=last.lastTick);
 const lastTick=useFailure?firstFailure.tick:last?.lastTick??null,result=useFailure?firstFailure.result:last?.result??null;
 const worldRevision=useFailure?firstFailure.worldRevision:last?.worldRevision,world=worldRevision?worlds[worldRevision]:undefined;
 const sceneRevision=useFailure?firstFailure.scene?.revision:last?.sceneRevision;
 let scene:ArmCollisionScene|undefined=useFailure&&firstFailure.scene?structuredClone(firstFailure.scene):undefined;
 if(!scene&&lastTick!==null&&c.scene?.tick===lastTick&&c.scene.revision===sceneRevision)scene=structuredClone(c.scene);
 // The declaration supplies immutable scope/profile metadata; the interval supplies the actual checked world.
 const declaration=report.manifest.armCollisionScene;
 if(!scene&&lastTick!==null&&world&&declaration&&declaration.hash===sceneRevision){
  scene={available:!!declaration.profile,scope:declaration.profile?'self_scene_robot':'self_injected_only',
   ...declaration.profile?{}:{reason:'ARM_COLLISION_PROFILE_MISSING'},revision:declaration.hash,profileRevision:declaration.profile?.revision??null,tick:lastTick,world:structuredClone(world)};
 }
 const truncated=e.droppedIntervals!==0,historyComplete=!truncated&&!missingWorld;
 const failureOutsideIntervals=firstFailure&&!intervals.some(i=>i.firstTick<=firstFailure.tick&&firstFailure.tick<=i.lastTick&&i.worldRevision===firstFailure.worldRevision);
 const retainedChecks=intervals.reduce((n,i)=>n+i.lastTick-i.firstTick+1,0)+(failureOutsideIntervals?1:0);
 const ticks=intervals.map(i=>i.firstTick);if(firstFailure)ticks.push(firstFailure.tick);
 return {world:structuredClone(world??[]),checks:truncated?(tick>=report.outcome.tick?c.checks:null):retainedChecks,last:structuredClone(result),...scene?{scene}:{},
  evidence:{intervals,worlds,droppedIntervals:truncated?(tick>=report.outcome.tick?e.droppedIntervals:null):0,...firstFailure?{firstFailure}:{},
   projection:{cursorTick:tick,lastCheckTick:lastTick,retainedRange:{fromTick:ticks.length?ticks.reduce((n,t)=>Math.min(n,t),Infinity):null,toTick:lastTick},historyComplete,worldScope:'checked_geometry',
    ...truncated?{reason:'SOURCE_TRACE_TRUNCATED' as const}:missingWorld?{reason:'MISSING_RECORDED_WORLD' as const}:{}}}};
}
function stopAt(report:RunReport,tick:number):ArmStopView|null {
 const events=structuredClone(report.coffee?.armTrace.stop?.events.filter(e=>e.tick<=tick)??[]);
 const observed=[...events].reverse().find(e=>e.stage==='observed');if(!observed)return null;
 return {events,latched:events.at(-1)?.stage!=='reset',reconcileRequired:true,reason:observed.reason};
}
export function openReplayV2(report:RunReport,o:{maxGapTicks?:number}={}){
 const tickMs=report.manifest.clock.tickMs,{sampleTick:tickOfSample,eventTick}=reportClock(report);
 const samples=[...report.telemetry?.samples??[]].filter(s=>Number.isFinite(tickOfSample(s))).sort((a,b)=>tickOfSample(a)-tickOfSample(b)||(BigInt(a.seq)<BigInt(b.seq)?-1:BigInt(a.seq)>BigInt(b.seq)?1:0)),gaps=report.telemetry?.gaps??[];
 const tickOf=(e:Event)=>eventTick(e.at);
 const events=report.businessEvents.map(e=>({...structuredClone(e),tick:tickOf(e)}));
 const toTick=samples.reduce((n,s)=>Math.max(n,tickOfSample(s)),events.reduce((n,e)=>Math.max(n,e.tick),report.outcome.tick));
 // ponytail: default max interpolation gap = 2 recording periods (10 ticks at 10 Hz); a profile value belongs in the manifest when one exists
 const maxGap=o.maxGapTicks??10;
 const clamp=(t:number)=>{if(!Number.isFinite(t))throw new Error('INVALID_REPLAY_CURSOR');return Math.max(0,Math.min(Math.round(t),toTick));};
 const byEntity=new Map<string,TwinSample[]>();for(const s of samples)byEntity.set(s.entityId,[...byEntity.get(s.entityId)??[],s]);
 const pose=(entityId:string,tick:number)=>{
  const list=byEntity.get(entityId)??[];
  const i=list.findIndex(s=>tickOfSample(s)>tick),before=i<0?list.at(-1):list[i-1],after=i<0?undefined:list[i];
  if(!before)return null;
  const hasPose=(s:TwinSample)=>typeof s.observed?.xM==='number';
  const lastPose=hasPose(before)?before:list.filter(s=>tickOfSample(s)<=tick&&hasPose(s)).at(-1);
  if(!lastPose)return null;
  const p=(s:TwinSample)=>({x:s.observed!.xM as number,y:s.observed!.yM as number,yawRad:s.observed!.yawRad as number,...pose3dOf(s.observed)});
  const tb=tickOfSample(before);
  if(before.quality!=='valid'||!hasPose(before))return {...p(lastPose),interpolated:false,gap:true,epochChange:false,seq:before.seq};
  if(tb===tick||!after)return {...p(before),interpolated:false,gap:!after&&tick-tb>maxGap,epochChange:false,seq:before.seq};
  const ta=tickOfSample(after);
  if(after.quality!=='valid'||!hasPose(after))return {...p(before),interpolated:false,gap:true,epochChange:false,seq:before.seq};
  // never blend across a boot change or a hole wider than the declared gap: hold the last recorded value and say so
  if(after.bootId!==before.bootId)return {...p(before),interpolated:false,gap:false,epochChange:true,seq:before.seq};
  if(ta-tb>maxGap)return {...p(before),interpolated:false,gap:true,epochChange:false,seq:before.seq};
  if(before.providerId==='mujoco_3d')return {...p(before),interpolated:false,gap:false,epochChange:false,seq:before.seq};
  const f=(tick-tb)/(ta-tb),a=p(before),b=p(after);
  const mix=(u:number|undefined,v:number|undefined)=>u!==undefined&&v!==undefined?u+(v-u)*f:undefined,z=mix(a.z,b.z),rollRad=mix(a.rollRad,b.rollRad),pitchRad=mix(a.pitchRad,b.pitchRad);
  return {x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,yawRad:a.yawRad+Math.atan2(Math.sin(b.yawRad-a.yawRad),Math.cos(b.yawRad-a.yawRad))*f,...z!==undefined&&rollRad!==undefined&&pitchRad!==undefined?{z,rollRad,pitchRad}:{},interpolated:true,gap:false,epochChange:false,seq:before.seq};
 };
 const seek=(t:number)=>{
  const tick=clamp(t),entities:Record<string,TwinSample>={};
  for(const [id,list] of byEntity){const last=list.filter(s=>tickOfSample(s)<=tick).at(-1);if(last)entities[id]=structuredClone(last);}
  return {tick,faults:structuredClone(report.faults.filter(x=>x.tick<=tick)),simTimeNs:String(BigInt(tick)*BigInt(tickMs)*1000000n),events:structuredClone(events.filter(e=>e.tick<=tick)),entities,gaps:gaps.filter(g=>(g.fromTick??-Infinity)<=tick&&tick<=g.toTick)};
 };
 return {
  range:{fromTick:0,toTick,tickMs},
  /** Recorded state at a cursor: business events up to it, latest sample per entity, telemetry gaps that cover it. */
  seek,
  /** Rebuild display state from journal snapshots and time-bounded traces. The final view supplies identity only. */
  /** `samples`: per entity, the latest recorded sample at or before the cursor (as the live store holds one; its receipt clock is its sim time, `nowMs` the
   * cursor's), drawn by the live code; none inside a recorded gap that covers the cursor. `unrecorded`: the entities other than AMRs (whose poses are
   * projected above) that have recorded samples but none drawn at this cursor (before their first one, or in a gap). */
  project(base:RunView,t:number):{view:RunView;report:RunReport;seen:Record<string,number>;samples:Record<string,Held>;nowMs:number;unrecorded:string[]}{
   const f=seek(t),states=new Map<string,Map<string,Record<string,unknown>>>(),seen:Record<string,number>={},owners=new Map<string,string>();
   for(const e of f.events){
    if(!e.state)continue;
    const group=states.get(e.kind)??new Map<string,Record<string,unknown>>(),state={...group.get(e.id),...e.state};group.set(e.id,state);states.set(e.kind,group);
    if(e.kind==='cup'&&state.ownerKind&&state.ownerId){const key=`${e.id}:${state.ownerKind}:${state.ownerId}`;if(owners.get(e.id)!==key){seen[key]=e.tick;owners.set(e.id,key);}}
   }
   const entries=(kind:string)=>[...states.get(kind)??[]];
   const jobs=entries('coffee-job').map(([id,s])=>({...s,jobId:String(s.jobId??id)}));
   const cups=entries('cup').map(([id,s])=>({...s,cupId:String(s.cupId??id)}));
   const served=String(entries('fulfillment').reduce((n,[,s])=>n+BigInt(String(s.served??'0')),0n));
   const entities:AmrView[]=base.entities.filter(e=>e.kind==='amr').map(e=>{
    const sample=f.entities[e.id],p=pose(e.id,f.tick),observed=sample?.observed,commanded=sample?.commanded;
    return {id:e.id,kind:'amr',pose:p?{x:p.x,y:p.y,yawRad:p.yawRad,...p.z!==undefined?{z:p.z,rollRad:p.rollRad,pitchRad:p.pitchRad}:{}}:{x:NaN,y:NaN,yawRad:NaN},quality:p&&!p.gap&&!p.epochChange?'valid':'stale',moving:!!observed?.moving,hold:typeof observed?.hold==='string'?observed.hold:null,goal:typeof commanded?.goalCommandId==='string'?{commandId:commanded.goalCommandId,state:String(commanded.goalState??'unknown')}:null,path:[],distanceM:NaN};
   });
   const missions=entries('mission'),awaiting:RunView['awaiting']=[];
   for(const [id,m] of missions)for(const stop of Array.isArray(m.stops)?m.stops as Record<string,unknown>[]:[])if(stop.status==='awaiting_action')awaiting.push({subjectId:String(stop.id),confirmationType:String(stop.action),missionId:id,robotId:String(m.robotId??'')});
   const attention=(report.attention??[]).filter(a=>a.tick<=f.tick);
   const status:RunView['run']['status']=f.tick>=report.outcome.tick?base.run.status:attention.length?'needs_attention':awaiting.length?'awaiting_confirmation':f.events.length?'running':'ready';
   const telemetrySamples=samples.filter(s=>tickOfSample(s)<=f.tick),sampleCounts:Record<string,number>={};for(const s of telemetrySamples)sampleCounts[s.entityId]=(sampleCounts[s.entityId]??0)+1;
   const collision=collisionAt(report,f.tick);
   const projectedReport:RunReport={...structuredClone(report),...report.physicsEvidence?{physicsEvidence:physicsAt(report,f.tick)!}:{},outcome:{status,served,tick:f.tick,simTimeNs:f.simTimeNs},businessEvents:f.events,attention,
    effects:f.tick>=report.outcome.tick?structuredClone(report.effects):[],faults:report.faults.filter(x=>x.tick<=f.tick),reconciliations:report.reconciliations.filter(x=>x.tick<=f.tick),
    metrics:f.tick>=report.outcome.tick?structuredClone(report.metrics):{distanceM:{},collision:{available:false,reason:'NOT_RECORDED_AT_CURSOR',contacts:null,minSeparationM:null}},
    coverage:{...report.coverage,...report.coffee?{armCollisionChecker:!!collision?.last,armSceneCollision:!!collision?.last&&collision.scene?.available===true,
     armCollisionTraceComplete:!!collision?.last&&(collision.evidence?.projection?.historyComplete??false)}:{}},
    ...report.telemetry?{telemetry:{...structuredClone(report.telemetry),samples:telemetrySamples,sampleCounts,gaps:report.telemetry.gaps.filter(g=>g.toTick<=f.tick)}}:{},
    ...report.coffee?{coffee:{jobs:jobs as unknown as NonNullable<RunReport['coffee']>['jobs'],cups:cups as unknown as NonNullable<RunReport['coffee']>['cups'],plantLog:structuredClone((report.coffee.plantLog??[]).filter(e=>typeof e.tick==='number'&&Number.isFinite(e.tick)&&e.tick<=f.tick)),armTrace:{...report.coffee.armTrace,collision,stop:stopAt(report,f.tick),samples:report.coffee.armTrace.samples.filter(s=>s.tick<=f.tick)}}}:{}
   };
   const held:Record<string,Held>={},unrecorded:string[]=[],tickNs=BigInt(tickMs)*1000000n;
   for(const [id,list] of byEntity){
    const candidate=f.entities[id],s=f.gaps.length||candidate?.providerId==='mujoco_3d'&&f.tick-tickOfSample(candidate)>maxGap?undefined:candidate;
    if(s)held[id]={...s,receivedAtMs:Number(s.simTimeNs!==null?BigInt(s.simTimeNs):BigInt(tickOfSample(s))*tickNs)/1e6,epochResetAtMs:null};
    else if(!list.every(x=>typeof x.observed?.xM==='number'))unrecorded.push(id);
   }
   return {seen,samples:held,nowMs:Number(f.simTimeNs)/1e6,unrecorded:unrecorded.sort(),report:projectedReport,view:{...base,tick:f.tick,simTimeNs:f.simTimeNs,served,entities,attention,awaiting,
    run:{...base.run,status,ageMs:0,eventCursor:f.events.at(-1)?.sequence??null,telemetryCursor:telemetrySamples.at(-1)?.seq??null},
    workload:base.workload.map(w=>({...w,status:states.get('mission')?.has(w.missionId??'')?'placed':'planned',missionId:states.get('mission')?.has(w.missionId??'')?w.missionId:undefined})),
    coffee:report.coffee?{jobs:jobs as unknown as CoffeeJobView[],cups:cups as unknown as CupView[]}:null}};
  },
  pose:(entityId:string,t:number)=>t<0?null:pose(entityId,clamp(t)),
  /** Every recorded fact that names `id` (command, mission, job, robot), oldest first, layered command/observation/business/effect/telemetry. */
  trace(id:string):TraceRow[]{
   const names=(x:unknown)=>JSON.stringify(x).includes(JSON.stringify(id));
   const rows:TraceRow[]=events.filter(e=>e.id===id||names(e.state??{})).map(e=>({tick:e.tick,layer:COMMAND.test(e.type)?'command':OBSERVATION.test(e.type)?'observation':'business',type:e.type,id:e.id,sequence:e.sequence}));
   for(const f of report.effects??[])if(names(f.payload)){const cmd=String(f.payload.commandId??''),issued=events.find(e=>e.id===cmd&&COMMAND.test(e.type));rows.push({tick:issued?.tick??0,layer:'effect',type:f.type,id:f.id,detail:`${f.status} · attempts ${f.attempts}`});}
   for(const sample of samples.filter(s=>s.causationId===id||s.entityId===id))rows.push({tick:tickOfSample(sample),layer:'telemetry',type:'TwinSample',id:`${sample.entityId}#${sample.seq}`,entityId:sample.entityId,detail:`${sample.quality} · ${sample.bootId}`});
   return rows.sort((a,b)=>a.tick-b.tick);
  },
 };
}
