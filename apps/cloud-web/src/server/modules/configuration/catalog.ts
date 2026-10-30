import {randomUUID} from 'node:crypto';
import {hashPayload} from '../../../../../../packages/contracts/src/canonical';
import type {CommandEnvelope,JsonObject} from '../../../../../../packages/contracts/generated/wire';
import {requirePermission,type Actor} from '../identity/rbac';
import {withTenant,type TenantScope} from '../identity/tenant-context';
import {enqueueRelay} from '../relay/commands';
export async function readCatalog(actor:Actor,scope:TenantScope){
 requirePermission(actor,'catalog.read',scope);
 return withTenant(scope,async sql=>{
  const [catalog]=await sql`SELECT version,state FROM sync_projection WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND aggregate_type='catalog' AND aggregate_id='current'`;
  const stations=await sql`SELECT aggregate_id,state FROM sync_projection WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND aggregate_type='station' ORDER BY aggregate_id`;
  const pending=await sql`SELECT operation_id,status,command FROM relay_command WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND command->>'type'='Catalog.Publish' AND status IN('pending','unknown') ORDER BY created_at DESC LIMIT 20`;
  return {catalog:catalog?.state??null,stations:stations.map(s=>({id:s.aggregate_id,name:String(s.state.name??s.aggregate_id)})),pending:pending.map(p=>({operationId:p.operation_id,status:p.status,version:p.command.payload.version}))};
 });
}
export async function relayCatalogPublication(actor:Actor,scope:TenantScope,input:{operationId?:string;version:number;currency:string;items:JsonObject[]}){
 requirePermission(actor,'catalog.publish',scope);
 if(!Number.isSafeInteger(input.version)||input.version<1||!/^[A-Z]{3}$/.test(input.currency)||!Array.isArray(input.items)||input.items.length<1||input.items.length>1000)throw new Error('INVALID_CATALOG');
 const current=await readCatalog(actor,scope);const knownStations=new Set(current.stations.map(s=>s.id));
 if(input.version!==Number((current.catalog as JsonObject|null)?.version??0)+1)throw new Error('VERSION_CONFLICT');
 const ids=new Set<string>();
 const items=input.items.map(item=>{
  if(typeof item.id!=='string'||!item.id||item.id.length>128||ids.has(item.id)||typeof item.name!=='string'||!item.name.trim()||item.name.length>120||typeof item.stationId!=='string'||!knownStations.has(item.stationId)||typeof item.unitMinor!=='string'||!/^(0|[1-9][0-9]{0,29})$/.test(item.unitMinor)||typeof item.available!=='boolean')throw new Error('INVALID_CATALOG_ITEM');
  ids.add(item.id);return {id:item.id,name:item.name.trim(),stationId:item.stationId,unitMinor:item.unitMinor,available:item.available,...(typeof item.imageManifestId==='string'?{imageManifestId:item.imageManifestId}:{})};
 });
 const context=await withTenant(scope,async sql=>{
  for(const item of items)if(item.imageManifestId){const ready=await sql`SELECT id FROM asset_manifest WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND id=${item.imageManifestId} AND status='ready'`;if(ready.length!==1)throw new Error('ASSET_NOT_READY');}

  const [owner]=await sql`SELECT epoch FROM venue_ownership WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND resource_id='coordinator' AND status='active'`;
  const [policy]=await sql`SELECT policy_revision FROM authority WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId}`;
  if(!owner||!policy)throw new Error('OWNER_OR_POLICY_UNAVAILABLE');return {epoch:Number(owner.epoch),policyRevision:Number(policy.policy_revision)};
 });
 const operationId=input.operationId??randomUUID();if(!/^[A-Za-z0-9_-]{1,128}$/.test(operationId))throw new Error('INVALID_OPERATION_ID');
 const payload={version:input.version,currency:input.currency,items};
 const occurredAt=new Date().toISOString();const command:CommandEnvelope={schemaVersion:1,...scope,operationId,type:'Catalog.Publish',actorRef:actor.id,deviceId:'cloud-web',deviceEpoch:'cloud-web-v1',coordinatorEpoch:context.epoch,policyRevision:context.policyRevision,occurredAt,recordedAt:occurredAt,payload,payloadHash:hashPayload(payload)};
 const result=await enqueueRelay(actor,command,new Date(Date.now()+300000).toISOString());
 return {...result,operationId,version:input.version};
}
