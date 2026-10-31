import type {CommandEnvelope,JsonObject,Snapshot} from '../../../contracts/src/index';
import {stateEvent,type ModuleRegistry} from '../modules';
import {guarded,objects,text,amount,find,change,ok} from '../continuity/shared';
function points(value:JsonObject[string]):JsonObject[] {
 const values=objects(value);if(values.length>200)throw new Error('LAYOUT_TOO_LARGE');
 const ids=new Set<string>();
 for(const item of values){const id=text(item.id);text(item.name);if(!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)||ids.has(id)||Object.keys(item).some(key=>!['id','name'].includes(key)))throw new Error('INVALID_LAYOUT_POINT');ids.add(id);}
 return values;
}
export function configureVenue(c:CommandEnvelope,s:Snapshot[]) {
 const current=find(s,'venue-layout','current');
 if(current&&c.expectedVersion!==current.version)throw new Error('VERSION_CONFLICT');
 const stations=points(c.payload.stations),tables=points(c.payload.tables);
 if(!stations.length||!tables.length)throw new Error('LAYOUT_POINTS_REQUIRED');
 const ids=[...stations,...tables].map(p=>String(p.id));if(new Set(ids).size!==ids.length)throw new Error('DUPLICATE_LAYOUT_POINT');
 const timezone=text(c.payload.timezone??current?.state.timezone??'UTC');try{new Intl.DateTimeFormat('en',{timeZone:timezone}).format(0);}catch{throw new Error('INVALID_TIMEZONE');}
 const events=[stateEvent('VenueLayoutConfigured','venue-layout','current',{stations,tables,timezone,configuredBy:c.actorRef,configuredAt:c.recordedAt})];
 for(const station of stations)events.push(change('StationConfigured','station',String(station.id),{...find(s,'station',String(station.id))?.state,...station}));
 for(const table of tables)events.push(change('TableConfigured','table',String(table.id),{activeSessionId:null,...find(s,'table',String(table.id))?.state,...table}));
 const robots=c.payload.simulatedRobots===undefined?[]:objects(c.payload.simulatedRobots);
 if(robots.length>10)throw new Error('SIMULATOR_LIMIT');
 const robotIds=new Set<string>();
 for(const robot of robots) {
  const id=text(robot.id);if(robotIds.has(id)||!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id))throw new Error('INVALID_ROBOT_ID');robotIds.add(id);
  if((robot.driver!==undefined&&robot.driver!=='simulator')||(robot.validation!==undefined&&robot.validation!=='simulated'))throw new Error('SIMULATION_PROFILE_REQUIRED');
  const old=find(s,'robot',id);if(old&&old.state.validation!=='simulated')throw new Error('HARDWARE_PROFILE_IMMUTABLE');
  if(s.some(x=>x.ref.kind==='mission'&&x.state.robotId===id&&!['completed','cancelled','failed'].includes(String(x.state.status))))throw new Error('ROBOT_HAS_OPEN_MISSION');
  const trays=robot.trays??2;if(typeof trays!=='number'||!Number.isInteger(trays)||trays<1||trays>8)throw new Error('INVALID_TRAY_COUNT');
  const maxLoadMinor=amount(robot.maxLoadMinor??'20000');if(BigInt(maxLoadMinor)<=0n)throw new Error('INVALID_LOAD');
  const authority=find(s,'__scope__','authority')?.state;if(!authority)throw new Error('AUTHORITY_REQUIRED');
  const mapId='simulated-layout-v1',mapRevision='1';
  const bindings=Object.fromEntries([...ids,'parking'].map((point,index)=>[point,{waypointId:point,mapId,mapRevision,frame:'map',x:index%5,y:Math.floor(index/5),yaw:0}]));
  events.push(change('SimulatedRobotConfigured','robot',id,{id,driver:'simulator',validation:'simulated',capabilities:['delivery','bussing','guide'],trays,maxLoadMinor,battery:100,minBattery:20,availability:'idle',goalState:'idle',controlEpoch:old?.state.controlEpoch??1,ownerDeviceId:authority.ownerDeviceId,offlineExecution:true,mapId,mapRevision,parkingPoint:'parking',bindings}));
 }
 return ok(events,{version:(current?.version??0)+1,simulatedRobotCount:robots.length});
}
export function registerLayout(registry:ModuleRegistry){registry.register('Venue.Configure',guarded(configureVenue));}
