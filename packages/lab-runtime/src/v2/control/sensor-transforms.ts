// Runtime-side sensor faults (R4-A §7.1): applied to a scan before the controller sees it. The draw rule is fixed so that one dropped ray never shifts the noise of the next:
// every ray spends three uniforms, u0 for the dropout decision, then a Box-Muller pair of which the first is the range noise.
import {actorStream,gaussianPair,type Stream} from '../random';
import type {FaultScheduleEntry} from '../fault-schedule';
import {runtimeFaultsAt} from './drive-faults';

export function lidarNoise<T extends {rangesM:(number|null)[];states:string[];rangeMinM?:number;rangeMaxM?:number}>(scan:T,params:{sigmaM:number;dropoutFraction:number},stream:Stream):T{
 const rangesM=[...scan.rangesM],states=[...scan.states];
 for(let i=0;i<rangesM.length;i++){
  const u0=stream.next(),[noise]=gaussianPair(stream),r=rangesM[i];
  if(r===null||r===undefined||states[i]!=='hit')continue;
  if(u0<params.dropoutFraction){rangesM[i]=null;states[i]='no_return';continue;}
  let v=r+params.sigmaM*noise;
  if(scan.rangeMinM!==undefined)v=Math.max(scan.rangeMinM,v);
  if(scan.rangeMaxM!==undefined)v=Math.min(scan.rangeMaxM,v);
  rangesM[i]=v;
 }
 return {...scan,rangesM,states};
}

/** What the runner's lidar-noise must have recorded, re-derived from the true publications alone: at each decision tick T inside a window the newest publication up to tick T-1 is perturbed once (a publication
 * already perturbed for this target is reused, not drawn again) from the target's own stream, which runs across windows. The reader compares this with the run's recorded `sensorTransforms`. */
export function replayLidarNoise(o:{seed:number;robotId:string;schedule:readonly FaultScheduleEntry[];publications:readonly {tick:number;scan:{sensorId:string;rangesM:(number|null)[];states:string[];rangeMinM?:number;rangeMaxM?:number}}[];lastTick:number}){
 const out:{tick:number;entryId:string;sensorId:string;scanTick:number;rangesM:(number|null)[];states:string[]}[]=[],streams=new Map<string,Stream>(),held=new Map<string,number>();
 for(let t=1;t<=o.lastTick;t++){
  const active=runtimeFaultsAt(o.schedule,t).active.filter(e=>e.faultId==='lidar-noise');
  for(const k of held.keys())if(!active.some(e=>e.targetId===k))held.delete(k);
  for(const e of active){
   const sensorId=e.targetId.slice(o.robotId.length+1),pub=o.publications.filter(p=>p.scan.sensorId===sensorId&&p.tick<=t-1).at(-1);
   if(!pub||held.get(e.targetId)===pub.tick)continue;
   const stream=streams.get(e.targetId)??actorStream(o.seed,`lidar-noise:${e.targetId}`);streams.set(e.targetId,stream);
   const noisy=lidarNoise(pub.scan,{sigmaM:e.params!.sigmaM!,dropoutFraction:e.params!.dropoutFraction!},stream);
   held.set(e.targetId,pub.tick);out.push({tick:t,entryId:e.id,sensorId,scanTick:pub.tick,rangesM:noisy.rangesM,states:noisy.states});
  }
 }
 return out;
}
