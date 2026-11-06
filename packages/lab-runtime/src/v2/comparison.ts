// A/B comparison of two run reports (CORE-10, UX-10): KPIs with unit, definition and population; compatibility reasons first. Runs on
// different evidence scales (mode/access/backends/fidelity) or different scenarios are not ranked: their deltas are null.
import type {RunReport} from './report';
export interface Kpi {id:string;unit:string;definition:string;value:number|null;available:boolean;reason?:string;samples:number}
const ms=(iso:string)=>Date.parse(iso);
/** KPIs read from one report. Missing data is unavailable with a reason, never 0. */
export function reportKpis(r:RunReport):Kpi[]{
 const ev=r.businessEvents,first=ev.find(e=>e.type==='RobotCommandIssued'),done=[...ev].reverse().find(e=>e.type==='MissionCompleted');
 const execute=r.effects.filter(e=>e.type==='robot.execute');
 let wait=0,waits=0;
 // Arrival belongs to one mission stop. Allocation confirmations may overlap across robots or arrive in parts.
 const pending=new Map<string,{stopId:string;at:number;confirmation:string|undefined;allocations:Set<string>}>();
 for(const e of ev){
  const state=e.state??{},missionId=e.kind==='mission'?e.id:typeof state.missionId==='string'?state.missionId:null;
  if(!missionId)continue;
  const stops=Array.isArray(state.stops)?state.stops as {id:string;action?:string;status?:string;allocationIds?:string[]}[]:[];
  if(e.type==='MissionArrived'){
   const stop=stops.find(s=>s.id===state.currentStopId)??stops.find(s=>s.status==='awaiting_action');
   const stopId=stop?.id??String(state.currentStopId??'');
   if(pending.get(missionId)?.stopId!==stopId)pending.delete(missionId);
   if(!pending.has(missionId))pending.set(missionId,{stopId,at:ms(e.at),confirmation:({load:'CargoLoaded',handoff:'DeliveryHandedOff',return:'CargoReturned'} as Record<string,string>)[stop?.action??''],allocations:new Set(stop?.allocationIds??[])});
   continue;
  }
  const arrival=pending.get(missionId);if(!arrival)continue;
  if(['MissionCancelled','MissionCancellationRequested','MissionFailed'].includes(e.type)||stops.some(s=>s.id===arrival.stopId&&s.status==='skipped')){pending.delete(missionId);continue;}
  if(!['CargoLoaded','DeliveryHandedOff','CargoReturned'].includes(e.type)||arrival.confirmation&&arrival.confirmation!==e.type)continue;
  if(arrival.allocations.size){if(!arrival.allocations.delete(e.id)||arrival.allocations.size)continue;}
  const elapsed=ms(e.at)-arrival.at;
  if(Number.isFinite(elapsed)&&elapsed>=0){wait+=elapsed;waits++;}
  pending.delete(missionId);
 }
 const tickets=new Map<string,number>(),commands=new Map<string,number>();
 let queue=0,queues=0,travel=0,travels=0;
 for(const e of ev){
  if(e.kind==='kitchen-ticket'&&!tickets.has(e.id))tickets.set(e.id,ms(e.at));
  if(e.type==='CoffeeJobReserved'&&typeof e.state?.lineId==='string'){
   const start=tickets.get(e.state.lineId),duration=start===undefined?NaN:ms(e.at)-start;
   if(Number.isFinite(duration)&&duration>=0){queue+=duration;queues++;}
  }
  if(e.type==='RobotCommandIssued')commands.set(e.id,ms(e.at));
  if(e.type==='RobotCommandObserved'&&e.state?.status==='completed'){
   const start=commands.get(e.id),duration=start===undefined?NaN:ms(e.at)-start;
   if(Number.isFinite(duration)&&duration>=0){travel+=duration;travels++;commands.delete(e.id);}
  }
 }
 const active=new Map<string,number>(),spans:[number,number][]=[],finished=new Set<string>();
 for(const raw of r.coffee?.plantLog??[]){
  const e=raw as {event?:string;commandId?:string;tick?:number};if(typeof e.commandId!=='string'||typeof e.tick!=='number'||!Number.isFinite(e.tick))continue;
  if(e.event==='accepted'&&!finished.has(e.commandId)&&!active.has(e.commandId))active.set(e.commandId,e.tick);
  if(e.event==='completed'&&active.has(e.commandId)){
   const start=active.get(e.commandId)!;if(e.tick>=start)spans.push([start,e.tick]);active.delete(e.commandId);finished.add(e.commandId);
  }
 }
 let busyTicks=0,end=-Infinity;
 for(const [a,b]of spans.sort((a,b)=>a[0]-b[0])){busyTicks+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b);}
 const c=r.metrics.collision,d=Object.values(r.metrics.distanceM);
 const k=(id:string,unit:string,definition:string,value:number|null,samples:number,reason?:string):Kpi=>({id,unit,definition,value,available:value!==null,...value===null?{reason:reason??'NO_DATA'}:{},samples});
 return [
  k('coffeeQueueWaitS','s','Coffee order ticket creation to successful resource reservation, summed per job; incomplete reservations excluded.',queues?queue/1000:null,queues,'NO_RESERVED_COFFEE_JOB'),
  k('travelTimeS','s','Issued navigation command to completed observation, summed by command identity; unfinished legs excluded.',travels?travel/1000:null,travels,'NO_COMPLETED_TRAVEL'),
  k('cellProcessBusyS','s','Union of accepted-to-completed mock brew/dispense intervals; excludes arm transfer and becomes unavailable if a process cycle has no terminal evidence.',spans.length&&!active.size?busyTicks*r.manifest.clock.tickMs/1000:null,spans.length,active.size?'INCOMPLETE_CELL_CYCLE':'NO_CELL_PROCESS'),
  k('served','count','Units served after the final handoff confirmation (source fulfillment), not after arrival or brew completion.',Number(r.outcome.served),1),
  k('missionTimeS','s','Sim time from the first RobotCommandIssued to the last MissionCompleted, from journal timestamps (virtual clock).',first&&done?(ms(done.at)-ms(first.at))/1000:null,first&&done?1:0,first?'MISSION_NOT_COMPLETED':'NO_ROBOT_COMMAND'),
  k('humanWaitS','s','Sim time from each MissionArrived to the final allocation confirmation for that mission/stop (CargoLoaded, DeliveryHandedOff, CargoReturned), summed once per fully confirmed stop; cancelled and incomplete stops excluded.',waits?wait/1000:null,waits,'NO_CONFIRMED_STOP'),
  k('distanceM','m','Path length travelled by all robots in the model (mock_kinematic grid path), summed.',d.length?d.reduce((a,b)=>a+b,0):null,d.length,'NO_ROBOT'),
  k('executeAttempts','count','robot.execute dispatch attempts from the source outbox (no resend after unknown).',execute.reduce((n,e)=>n+e.attempts,0),execute.length),
  k('contacts','count','Contacts between robot footprint and the world in the model; needs resolved geometry.',c.available?c.contacts:null,c.available?1:0,c.reason),
  k('minSeparationM','m','Minimum footprint separation between robots in the model; needs resolved geometry and two robots.',c.available&&d.length>=2?c.minSeparationM:null,c.available&&d.length>=2&&c.minSeparationM!==null?1:0,d.length<2?'SINGLE_ROBOT':c.reason??'NO_PAIR_SAMPLE'),
 ];
}
const key=(b:RunReport['manifest']['backends'])=>JSON.stringify([...b].map(x=>[x.id,x.version,x.model,x.dynamics]).sort());
/** Evidence-scale flags: two runs whose coverage differs on these are not on the same scale. */
const FIDELITY=['businessSimulation','kinematicModel','dynamics','nativeExecution','physicalStop','sensorEvidence'];
export function compareRuns(a:RunReport,b:RunReport){
 const ma=a.manifest,mb=b.manifest,reasons:string[]=[];
 if(ma.mode!==mb.mode)reasons.push('MODE_DIFFERS');
 if(ma.access!==mb.access)reasons.push('ACCESS_DIFFERS');
 if(ma.scenario.id!==mb.scenario.id||ma.scenario.revision!==mb.scenario.revision||ma.scenario.hash!==mb.scenario.hash)reasons.push('SCENARIO_DIFFERS');
 if(key(ma.backends)!==key(mb.backends))reasons.push('BACKENDS_DIFFER');
 if(ma.clock.tickMs!==mb.clock.tickMs)reasons.push('CLOCK_DIFFERS');
 if(FIDELITY.some(f=>!!a.coverage[f]!==!!b.coverage[f]))reasons.push('FIDELITY_DIFFERS');
 const comparable=!reasons.length;
 // changed inputs are shown, not judged: a layout or seed change is what an A/B compare is for
 const inputs=[['seed',ma.seed,mb.seed],['project.hash',ma.project.hash,mb.project.hash],['world.hash',ma.world.hash,mb.world.hash],['scenario',`${ma.scenario.id} r${ma.scenario.revision}`,`${mb.scenario.id} r${mb.scenario.revision}`],
  ['backendSetId',ma.backendSetId,mb.backendSetId],['sourceCommit',ma.sourceCommit,mb.sourceCommit],['assets',JSON.stringify(ma.assets),JSON.stringify(mb.assets)]]
  .filter(([,x,y])=>x!==y).map(([field,x,y])=>({field:field as string,a:x as string|number,b:y as string|number}));
 const ka=reportKpis(a),kb=reportKpis(b);
 const kpis=ka.map((x,i)=>{const y=kb[i]!,available=x.available&&y.available;
  return {id:x.id,unit:x.unit,definition:x.definition,a:x.value,b:y.value,available,reasons:[x.reason,y.reason].filter(Boolean) as string[],
   delta:comparable&&available?y.value!-x.value!:null,population:{runs:1,samplesA:x.samples,samplesB:y.samples},percentiles:null as null};});
 const coverage=[...new Set([...Object.keys(a.coverage),...Object.keys(b.coverage)])].map(k=>({key:k,a:!!a.coverage[k],b:!!b.coverage[k]}));
 const pop=(r:RunReport)=>({runs:1,businessEvents:r.businessEvents.length,telemetrySamples:r.telemetry?.samples.length??0,telemetryDropped:r.telemetry?.dropped??0});
 return {comparable,reasons,inputs,kpis,coverage,population:{a:pop(a),b:pop(b)},note:'One run per side: no p50/p95. Repeat with seeds for a distribution.'};
}
