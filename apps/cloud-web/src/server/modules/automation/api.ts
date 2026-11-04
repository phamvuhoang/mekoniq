import type {JsonObject} from '../../../../../../packages/contracts/generated/wire';
import {commandFeatures} from '../../../../../../packages/domain/src/restaurant-context';
import type {FeatureConfig} from '../../../../../../packages/domain/src/policy/registry';
import {requiredPermissions} from '../../../../../../packages/domain/src/application';
import {requirePermission,type Actor} from '../identity/rbac';
import {withTenant,type TenantScope} from '../identity/tenant-context';
import {relayVenueCommand} from '../relay/venue-command';
/**
 * Automation API (Node-RED, partner scripts, the SDK). Narrow on purpose:
 *  - only these command types, each still checked against the caller's own role at the cloud AND again at the venue;
 *  - the caller names the operationId, so a replayed trigger is the SAME command, never a second one;
 *  - no endpoint here reaches a robot, MQTT topic or database: every effect is a command the venue's coordinator decides.
 */
export const automationCommandTypes=new Set(['Mission.Create','Mission.Cancel']);
/** Projection kinds an automation may read, each with the permission it needs (its own role's, nothing wider). */
export const automationKinds:Record<string,string>={allocation:'order.read',fulfillment:'order.read',mission:'order.read',robot:'order.read'};
export const AUTOMATION_PENDING_LIMIT=50;
const OPERATION_ID=/^[A-Za-z0-9_-]{1,128}$/;
/** Fast feedback only: the venue's coordinator is the authority. If the venue's APPLIED configuration already disables the feature this command needs for new work, say so before queueing it. */
async function featureAlreadyOff(scope:TenantScope,type:string,payload:JsonObject){
 const mapped=commandFeatures[type];if(!mapped)return undefined;
 const feature=type==='Mission.Create'?(payload.kind==='bus'?'robot.bussing':payload.kind==='guide'?'robot.guide':mapped.feature):mapped.feature;
 const [row]=await withTenant(scope,sql=>sql`SELECT features FROM configuration_revision WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND status='applied' ORDER BY revision DESC LIMIT 1`);
 if(!row)return undefined;
 // Only the plain on/off switch is judged here; readiness, capability and entitlement stay the venue's call.
 const status=(row.features as FeatureConfig)[feature]?.status??'disabled';
 return mapped.intent!=='new'||status==='enabled'?undefined:status==='draining'?'FEATURE_DRAINING':'FEATURE_DISABLED';
}
export async function submitAutomationCommand(actor:Actor,scope:TenantScope,input:{type:string;payload:JsonObject;operationId?:string}){
 if(!automationCommandTypes.has(input.type))throw new Error('COMMAND_NOT_RELAYABLE');
 const operationId=input.operationId;
 if(typeof operationId!=='string'||!OPERATION_ID.test(operationId))throw new Error('INVALID_OPERATION_ID');
 if(!input.payload||typeof input.payload!=='object'||Array.isArray(input.payload))throw new Error('INVALID_COMMAND');
 requirePermission(actor,'relay.write',scope);
 for(const permission of requiredPermissions(input.type,input.payload))requirePermission(actor,permission,scope);
 const off=await featureAlreadyOff(scope,input.type,input.payload);if(off)throw new Error(off);
 // A re-send of a command that already exists is the same command, not new load: only genuinely new ids count against the cap.
 const blocked=await withTenant(scope,async sql=>{
  const [known]=await sql`SELECT 1 AS x FROM relay_command WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND operation_id=${operationId}`;
  if(known)return false;
  const [open]=await sql`SELECT count(*)::int AS n FROM relay_command WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND command->>'actorRef'=${actor.id} AND status IN('pending','unknown')`;
  return Number(open!.n)>=AUTOMATION_PENDING_LIMIT;
 });
 if(blocked)throw new Error('RATE_LIMITED');
 return relayVenueCommand(actor,scope,{type:input.type,payload:input.payload,operationId},{internal:true});
}
/** Result of a command THIS caller sent. pending = the venue has not answered yet; unknown = it may have; accepted/rejected = the venue's own receipt. */
export async function readAutomationResult(actor:Actor,scope:TenantScope,operationId:string){
 requirePermission(actor,'relay.write',scope);
 if(!OPERATION_ID.test(operationId))throw new Error('INVALID_OPERATION_ID');
 return withTenant(scope,async sql=>{
  const [row]=await sql`SELECT status,venue_receipt,command->>'type' AS type FROM relay_command WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND operation_id=${operationId} AND command->>'actorRef'=${actor.id}`;
  if(!row)throw new Error('COMMAND_NOT_FOUND');
  const receipt=(row.venue_receipt??{}) as JsonObject;
  return {operationId,type:String(row.type),status:String(row.status),ack:(receipt.ack as string|undefined)??'none',...(receipt.code?{code:String(receipt.code)}:{}),...(receipt.value?{value:receipt.value as JsonObject}:{})};
 });
}
/** Polling "subscription": what the venue has applied for one kind, after a cursor (aggregate id), with the age of the data so a caller can tell a quiet venue from a silent one. */
export async function readAutomationEvents(actor:Actor,scope:TenantScope,kind:string,after=''){
 const permission=automationKinds[kind];if(!permission)throw new Error('KIND_NOT_READABLE');
 requirePermission(actor,permission,scope);
 if(typeof after!=='string'||after.length>256)throw new Error('INVALID_CURSOR');
 return withTenant(scope,async sql=>{
  const rows=await sql`SELECT aggregate_id,version,state FROM sync_projection WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND aggregate_type=${kind} AND aggregate_id>${after} ORDER BY aggregate_id LIMIT 100`;
  const [inbox]=await sql`SELECT max(received_at) FILTER (WHERE status='applied') AS applied_at FROM sync_inbox WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId}`;
  return {kind,records:rows.map(r=>({id:r.aggregate_id as string,version:Number(r.version),state:r.state as JsonObject})),next:rows.length===100?String(rows[99]!.aggregate_id):null,appliedAt:inbox?.applied_at?new Date(inbox.applied_at as string).toISOString():null};
 });
}
