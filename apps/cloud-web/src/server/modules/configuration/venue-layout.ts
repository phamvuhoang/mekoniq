import {randomUUID} from 'node:crypto';
import type {CommandEnvelope,JsonObject} from '../../../../../../packages/contracts/generated/wire';
import {hashPayload} from '../../../../../../packages/contracts/src/canonical';
import {requirePermission,type Actor} from '../identity/rbac';
import {withTenant,type TenantScope} from '../identity/tenant-context';
import {enqueueRelay} from '../relay/commands';
export async function readVenueLayout(actor:Actor,scope:TenantScope){
 requirePermission(actor,'configuration.read',scope);
 return withTenant(scope,async sql=>{
  const rows=await sql`SELECT aggregate_type,aggregate_id,version,state FROM sync_projection WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND aggregate_type IN('venue-layout','station','table','robot') ORDER BY aggregate_type,aggregate_id`;
  const layout=rows.find(r=>r.aggregate_type==='venue-layout'&&r.aggregate_id==='current');
  const kind=(type:string)=>rows.filter(r=>r.aggregate_type===type).map(r=>({id:r.aggregate_id,...r.state}));
  return {version:Number(layout?.version??0),timezone:String(layout?.state.timezone??'UTC'),stations:kind('station'),tables:kind('table'),simulatedRobots:kind('robot').filter(r=>r.driver==='simulator'&&r.validation==='simulated')};
 });
}
export type LayoutDraft={operationId?:string;expectedVersion:number;timezone?:string;stations:JsonObject[];tables:JsonObject[];simulatedRobots?:JsonObject[]};
export async function relayVenueLayout(actor:Actor,scope:TenantScope,input:LayoutDraft){
 requirePermission(actor,'configuration.publish',scope);
 if(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0||!Array.isArray(input.stations)||input.stations.length>200||!Array.isArray(input.tables)||input.tables.length>500||!Array.isArray(input.simulatedRobots??[])||(input.simulatedRobots?.length??0)>10)throw new Error('INVALID_VENUE_LAYOUT');
 const timezone=input.timezone??'UTC';if(typeof timezone!=='string'||timezone.length>100)throw new Error('INVALID_TIMEZONE');try{new Intl.DateTimeFormat('en',{timeZone:timezone}).format(0);}catch{throw new Error('INVALID_TIMEZONE');}
 const ids=new Set<string>();
 function points(values:JsonObject[]){return values.map(value=>{
  if(typeof value.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(value.id)||ids.has(value.id)||typeof value.name!=='string'||!value.name.trim()||value.name.length>120)throw new Error('INVALID_LAYOUT_POINT');
  ids.add(value.id);return {id:value.id,name:value.name.trim()};
 });}
 const stations=points(input.stations),tables=points(input.tables);
 const robots=(input.simulatedRobots??[]).map(robot=>{
  if(typeof robot.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(robot.id)||ids.has(robot.id)||!Number.isSafeInteger(robot.trays)||Number(robot.trays)<1||Number(robot.trays)>8||typeof robot.maxLoadMinor!=='string'||!/^[1-9][0-9]{0,29}$/.test(robot.maxLoadMinor)||(robot.mapId!==undefined&&(typeof robot.mapId!=='string'||!robot.mapId))||(robot.mapRevision!==undefined&&(typeof robot.mapRevision!=='string'||!robot.mapRevision))||(robot.bindings!==undefined&&(!robot.bindings||Array.isArray(robot.bindings)||typeof robot.bindings!=='object')))throw new Error('INVALID_SIMULATED_ROBOT');
  if(robot.driver!==undefined&&robot.driver!=='simulator')throw new Error('REAL_ROBOT_NOT_CONFIGURED');if(robot.validation!==undefined&&robot.validation!=='simulated')throw new Error('REAL_ROBOT_NOT_CONFIGURED');ids.add(robot.id);
  return {id:robot.id,trays:robot.trays,maxLoadMinor:robot.maxLoadMinor,...(robot.mapId!==undefined?{mapId:robot.mapId}:{}),...(robot.mapRevision!==undefined?{mapRevision:robot.mapRevision}:{}),...(robot.bindings!==undefined?{bindings:robot.bindings}:{})};
 });
 const current=await readVenueLayout(actor,scope);if(current.version!==input.expectedVersion)throw new Error('VERSION_CONFLICT');
 const authority=await withTenant(scope,async sql=>{
  const [owner]=await sql`SELECT epoch,owner_device_epoch FROM venue_ownership WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND resource_id='coordinator' AND status='active'`;
  const [policy]=await sql`SELECT policy_revision FROM authority WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId}`;
  if(!owner?.owner_device_epoch||!policy)throw new Error('OWNER_OR_POLICY_UNAVAILABLE');return {epoch:Number(owner.epoch),policyRevision:Number(policy.policy_revision)};
 });
 const operationId=input.operationId??randomUUID();if(!/^[A-Za-z0-9_-]{1,128}$/.test(operationId))throw new Error('INVALID_OPERATION_ID');
 const payload={stations,tables,simulatedRobots:robots,timezone},now=new Date().toISOString();const command:CommandEnvelope={schemaVersion:1,...scope,operationId,type:'Venue.Configure',actorRef:actor.id,deviceId:'cloud-web',deviceEpoch:'cloud-web-v1',coordinatorEpoch:authority.epoch,policyRevision:authority.policyRevision,expectedVersion:input.expectedVersion,occurredAt:now,recordedAt:now,payload,payloadHash:hashPayload(payload)};
 return {...await enqueueRelay(actor,command,new Date(Date.now()+300000).toISOString()),operationId};
}
