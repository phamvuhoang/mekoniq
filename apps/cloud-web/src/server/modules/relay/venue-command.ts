import {randomUUID} from 'node:crypto';
import {hashPayload} from '../../../../../../packages/contracts/src/canonical';
import type {CommandEnvelope,JsonObject} from '../../../../../../packages/contracts/generated/wire';
import {requirePermission,type Actor} from '../identity/rbac';
import {withTenant,type TenantScope} from '../identity/tenant-context';
import {enqueueRelay} from './commands';
/**
 * Back-office commands the cloud admin may ask the venue owner to run. The cloud never decides: it signs nothing and writes no domain state, it relays an intent
 * (permission per command type is the same `requiredPermissions` the venue enforces) and the venue's coordinator accepts or rejects it. Add a type here only together with its
 * handler; tablets never depend on this path.
 */
export const cloudCommandTypes=new Set<string>(['Promotion.Publish','Voucher.Issue','Voucher.GrantEscrow']);
/** Projection kinds the admin pages may read, with the permission each needs (customer data is personal data: it is not readable with a plain report right). */
export const readableKinds:Record<string,string>={promotion:'promotion.write',voucher:'promotion.write','voucher-use':'promotion.write'};
export async function relayVenueCommand(actor:Actor,scope:TenantScope,input:{type:string;payload:JsonObject;operationId?:string}){
 if(!cloudCommandTypes.has(input.type))throw new Error('COMMAND_NOT_RELAYABLE');
 if(!input.payload||typeof input.payload!=='object'||Array.isArray(input.payload))throw new Error('INVALID_COMMAND');
 const context=await withTenant(scope,async sql=>{
  const [owner]=await sql`SELECT epoch FROM venue_ownership WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND resource_id='coordinator' AND status='active'`;
  const [policy]=await sql`SELECT policy_revision FROM authority WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId}`;
  if(!owner||!policy)throw new Error('OWNER_OR_POLICY_UNAVAILABLE');return {epoch:Number(owner.epoch),policyRevision:Number(policy.policy_revision)};
 });
 const operationId=input.operationId??randomUUID();if(!/^[A-Za-z0-9_-]{1,128}$/.test(operationId))throw new Error('INVALID_OPERATION_ID');
 const occurredAt=new Date().toISOString();
 const command:CommandEnvelope={schemaVersion:1,...scope,operationId,type:input.type,actorRef:actor.id,deviceId:'cloud-web',deviceEpoch:'cloud-web-v1',coordinatorEpoch:context.epoch,policyRevision:context.policyRevision,occurredAt,recordedAt:occurredAt,payload:input.payload,payloadHash:hashPayload(input.payload)};
 const result=await enqueueRelay(actor,command,new Date(Date.now()+300000).toISOString());
 return {...result,operationId};
}
/** Last accepted facts of one kind from the cloud projection (what the venue has applied), newest id order; the page shows its age, never presents it as live. */
export async function readVenueRecords(actor:Actor,scope:TenantScope,kind:string){
 const permission=readableKinds[kind];if(!permission)throw new Error('KIND_NOT_READABLE');
 requirePermission(actor,permission,scope);
 return withTenant(scope,async sql=>{
  const rows=await sql`SELECT aggregate_id,version,state FROM sync_projection WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND aggregate_type=${kind} ORDER BY aggregate_id LIMIT 500`;
  return {kind,records:rows.map(r=>({id:r.aggregate_id as string,version:Number(r.version),state:r.state as JsonObject}))};
 });
}
