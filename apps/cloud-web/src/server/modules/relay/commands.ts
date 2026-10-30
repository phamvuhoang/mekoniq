import type {CommandEnvelope,CommandResult} from '../../../../../../packages/contracts/generated/wire';
import {productionPermissions} from '../../../../../../packages/domain/src/application';
import {hashPayload} from '../../../../../../packages/contracts/src/canonical';
import {signGrant,configuredGrantSigner} from '../devices/grants';
import {rolePermissions} from '../identity/rbac';
import {validateEnvelope} from '../../../../../../packages/contracts/src/validate';
import {withTenant,type TenantScope} from '../identity/tenant-context';
import {requirePermission,type Actor} from '../identity/rbac';
import {validateOwnership} from '../devices/ownership';
export async function enqueueRelay(actor:Actor,command:CommandEnvelope,expiresAt:string){
 validateEnvelope(command);requirePermission(actor,'relay.write',command);
 const commandPermission=productionPermissions[command.type];if(!commandPermission)throw new Error('UNKNOWN_COMMAND');requirePermission(actor,commandPermission,command);
 if(actor.deviceId?(command.deviceId!==actor.deviceId||command.deviceEpoch!==actor.deviceEpoch):(command.deviceId!=='cloud-web'||command.deviceEpoch!=='cloud-web-v1'))throw new Error('SOURCE_DEVICE_MISMATCH');
 if(command.actorRef!==actor.id)throw new Error('ACTOR_MISMATCH');
 const expiry=Date.parse(expiresAt);
 return withTenant(command,async sql=>{
  await sql`SELECT pg_advisory_xact_lock(hashtext(${JSON.stringify([command.organizationId,command.venueId,command.operationId])}))`;
  const [current]=await sql`SELECT payload_hash,status,venue_receipt,command FROM relay_command WHERE organization_id=${command.organizationId} AND venue_id=${command.venueId} AND operation_id=${command.operationId}`;
  if(current){if(current.payload_hash!==command.payloadHash||['type','actorRef','deviceId','deviceEpoch','coordinatorEpoch','expectedVersion','policyRevision'].some(key=>current.command[key]!==command[key as keyof CommandEnvelope]))throw new Error('IDEMPOTENCY_CONFLICT');return {status:current.status,receipt:current.venue_receipt,duplicate:true};}
  const [owner]=await sql`SELECT epoch,owner_device_id,status FROM venue_ownership WHERE organization_id=${command.organizationId} AND venue_id=${command.venueId} AND resource_id='coordinator'`;
  if(!owner||owner.status!=='active'||Number(owner.epoch)!==command.coordinatorEpoch)throw new Error('OWNER_REQUIRED');
  if(!Number.isFinite(expiry)||expiry<=Date.now()||expiry>Date.now()+300000)throw new Error('INVALID_RELAY_EXPIRY');
  await sql`INSERT INTO relay_command(organization_id,venue_id,operation_id,payload_hash,command,coordinator_epoch,expires_at) VALUES(${command.organizationId},${command.venueId},${command.operationId},${command.payloadHash},${sql.json({...command})},${command.coordinatorEpoch},${new Date(expiry)})`;
  await sql`INSERT INTO cloud_job(organization_id,venue_id,id,type,payload) VALUES(${command.organizationId},${command.venueId},${'hint:'+command.operationId},'hint.publish',${sql.json({ref:command.operationId,revision:command.policyRevision,watermark:'0'})}) ON CONFLICT DO NOTHING`;
  return {status:'pending',duplicate:false};
 });
}
export async function pendingRelay(actor:Actor,scope:TenantScope){
 requirePermission(actor,'relay.read',scope);if(!actor.deviceId)throw new Error('DEVICE_REQUIRED');
 const signer=configuredGrantSigner();
 return withTenant(scope,async sql=>{
  const [owner]=await sql`SELECT owner_device_id,owner_device_epoch,epoch,status FROM venue_ownership WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND resource_id='coordinator'`;
  if(!owner||owner.owner_device_id!==actor.deviceId||owner.owner_device_epoch!==actor.deviceEpoch||owner.status!=='active')throw new Error('OWNER_REQUIRED');
  const rows=await sql`SELECT command,expires_at,status FROM relay_command WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND status IN('pending','unknown') AND coordinator_epoch=${Number(owner.epoch)} ORDER BY created_at LIMIT 100`;
  const commands=[];
  for(const row of rows){
   const command=row.command as CommandEnvelope;
   const permission=productionPermissions[command.type];
   const member=/^[0-9a-f-]{36}$/i.test(command.actorRef)?(await sql`SELECT role,station_ids FROM venue_membership WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND user_id=${command.actorRef}::uuid AND active`)[0]:undefined;
   const permissions=member?rolePermissions(member.role):[];
   const receiptOnly=Date.parse(row.expires_at)<=Date.now()||row.status==='unknown'||!permission||(!permissions.includes('*')&&!permissions.includes(permission));
   const nowMs=Date.now();const payload={schemaVersion:1,...scope,recipientDeviceId:actor.deviceId,recipientDeviceEpoch:actor.deviceEpoch!,coordinatorEpoch:Number(owner.epoch),commandHash:hashPayload({...command}),actorRef:command.actorRef,deviceId:command.deviceId,deviceEpoch:command.deviceEpoch,permissions:receiptOnly?[]:permissions,stationIds:receiptOnly?[]:member?.station_ids??[],receiptOnly,issuedAt:new Date(nowMs).toISOString(),expiresAt:new Date(receiptOnly?nowMs+60000:Math.min(Date.parse(row.expires_at),nowMs+60000)).toISOString()};
   const signed=signGrant(payload,signer);
   commands.push({command,expiresAt:row.expires_at,authorization:{grant:signed.payload,signature:signed.signature}});
  }
  return commands;
 });
}

export async function recordVenueReceipt(actor:Actor,scope:TenantScope,input:{coordinatorEpoch:number;result:CommandResult}){
 requirePermission(actor,'relay.receipt',scope);if(!actor.deviceId||!await validateOwnership(scope,'coordinator',actor.deviceId,input.coordinatorEpoch,actor.deviceEpoch))throw new Error('OWNER_REQUIRED');
 const r=input.result;if(!['accepted','rejected','unknown'].includes(r.status)||(r.status==='accepted'?r.ack!=='venue':!['none','venue'].includes(r.ack)))throw new Error('INVALID_VENUE_RECEIPT');
 return withTenant(scope,async sql=>{
  const rows=await sql`UPDATE relay_command SET status=${r.status},venue_receipt=${sql.json({...r})} WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND operation_id=${r.operationId} AND coordinator_epoch=${input.coordinatorEpoch} AND status IN('pending','unknown') RETURNING operation_id`;
  return {recorded:rows.length===1};
 });
}
