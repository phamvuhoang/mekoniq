import type { ModuleRegistry } from '../modules';
import type { JsonObject } from '../../../contracts/src/index';
import { changed, done, expectVersion, fail, find, handle, record, requireState, text } from '../restaurant-context';
export function bindingCurrent(binding:{mapId:string;revision:string},robot:{mapId:string;revision:string}) {
 return binding.mapId===robot.mapId && binding.revision===robot.revision;
}
/**
 * A target is dispatchable only if the robot's operator binding epoch (`bindingRevision`) matches the map revision it reports now AND the taught
 * waypoint was taught on that same map. An opaque vendor map id or this explicit epoch is the identity; a same-size map proves nothing.
 */
export function bindingReason(robot:JsonObject,targetId:string):string|undefined {
 const now={mapId:String(robot.mapId),revision:String(robot.mapRevision)},binding=((robot.bindings ?? {}) as JsonObject)[targetId] as JsonObject|undefined;
 if(robot.bindingRevision!==robot.mapRevision) return 'MAP_BINDING_STALE';
 if(!binding||typeof binding!=='object'||Array.isArray(binding)) return 'TARGET_UNBOUND';
 return bindingCurrent({mapId:String(binding.mapId),revision:String(binding.mapRevision)},now)?undefined:'MAP_BINDING_STALE';
}
/** Going home: the charging dock when one is taught on the current map, otherwise the parking point (S100-class robots have no dock). */
export function homeTarget(robot:JsonObject):string {
 if(typeof robot.chargingDock==='string'&&!bindingReason(robot,robot.chargingDock)) return robot.chargingDock;
 return typeof robot.parkingPoint==='string' ? robot.parkingPoint : fail('PARKING_UNSET');
}
const metres:Record<string,number>={m:1,cm:100,mm:1000};
/**
 * Robot.BindMap {robotId,mapId,mapRevision,frame,units:'m'|'cm'|'mm',waypoints:{pointId:{x,y,yaw?}},parkingPoint?,chargingDock?}: an operator teaches
 * waypoints for the map the robot reports right now and so opens a new binding epoch. Units and frame are explicit: x/y are converted to metres,
 * yaw is radians. Waypoints taught on an older revision stay stale until taught again. Points are venue tables/stations or the robot's home points.
 */
export function registerMapBinding(registry:ModuleRegistry):void {
 handle(registry,'Robot.BindMap',(c,s)=>{
  const robot=requireState(s,'robot',text(c.payload.robotId));expectVersion(c,robot);
  const mapId=text(c.payload.mapId,'MAP_REQUIRED'),mapRevision=text(c.payload.mapRevision,'MAP_REQUIRED');
  if(mapId!==robot.state.mapId||mapRevision!==robot.state.mapRevision) return fail('MAP_NOT_REPORTED');
  const frame=text(c.payload.frame,'FRAME_REQUIRED'),scale=metres[String(c.payload.units)] ?? fail('UNITS_REQUIRED');
  const home:JsonObject={};
  for(const key of ['parkingPoint','chargingDock']) if(c.payload[key]!==undefined) home[key]=key==='chargingDock'&&c.payload[key]===null?null:text(c.payload[key],'INVALID_POINT');
  const homes=new Set([home.parkingPoint??robot.state.parkingPoint,home.chargingDock??robot.state.chargingDock].filter(x=>typeof x==='string'));
  const points=Object.entries(record(c.payload.waypoints));
  if(!points.length||points.length>100) return fail('WAYPOINTS_REQUIRED');
  const bindings={...(robot.state.bindings ?? {}) as JsonObject};
  for(const [pointId,raw] of points) {
   if(!find(s,'table',pointId)&&!find(s,'station',pointId)&&!homes.has(pointId)) return fail('UNKNOWN_POINT');
   const pose=record(raw),yaw=pose.yaw ?? 0;
   if(![pose.x,pose.y,yaw].every(v=>typeof v==='number'&&Number.isFinite(v))||Math.abs(yaw as number)>Math.PI) return fail('INVALID_POSE');
   bindings[pointId]={waypointId:pointId,mapId,mapRevision,frame,x:(pose.x as number)/scale,y:(pose.y as number)/scale,yaw};
  }
  const stale=Object.keys(bindings).filter(id=>bindingReason({...robot.state,bindings,bindingRevision:mapRevision},id));
  return done([changed('RobotMapBound',robot,{...home,bindings,bindingRevision:mapRevision,boundBy:c.actorRef,boundAt:c.recordedAt})],{robotId:robot.ref.id,bindingRevision:mapRevision,stale});
 });
}
