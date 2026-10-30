import {hashPayload} from '../../../../../../packages/contracts/src/canonical';
import {signGrant,configuredGrantSigner} from '../devices/grants';
import {featureRegistry,validateDependencies,type FeatureConfig} from '../../../../../../packages/domain/src/policy/registry';
import {withTenant,type TenantScope} from '../identity/tenant-context';
import {requirePermission,type Actor} from '../identity/rbac';
import {validateOwnership} from '../devices/ownership';
export function validateFeatureConfig(features:unknown):asserts features is FeatureConfig {
 if(!features||typeof features!=='object'||Array.isArray(features))throw new Error('INVALID_FEATURE_CONFIGURATION');
 for(const [key,value] of Object.entries(features)){
  if(!featureRegistry[key]||!value||typeof value!=='object'||Array.isArray(value))throw new Error('UNKNOWN_FEATURE');
  if(Object.keys(value).some(k=>!['status','revision'].includes(k))||!Number.isSafeInteger(value.revision)||value.revision<1)throw new Error('INVALID_FEATURE_CONFIGURATION');
 }
 const errors=validateDependencies(features as FeatureConfig);if(errors.length)throw new Error('INVALID_FEATURE_CONFIGURATION:'+errors.join(','));
}
export async function publishConfiguration(actor:Actor,scope:TenantScope,input:{expectedRevision:number;features:FeatureConfig}) {
 requirePermission(actor,'configuration.publish',scope);validateFeatureConfig(input.features);
 return withTenant(scope,async sql=>{
  await sql`SELECT pg_advisory_xact_lock(hashtext(${JSON.stringify(scope)}))`;
  const [current]=await sql`SELECT revision FROM configuration_revision WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} ORDER BY revision DESC LIMIT 1`;
  if((current?.revision??0)!==input.expectedRevision)throw new Error('VERSION_CONFLICT');
  const revision=input.expectedRevision+1;
  const features=Object.fromEntries(Object.entries(input.features).map(([key,value])=>[key,{...value,revision}]));
  await sql`INSERT INTO configuration_revision(organization_id,venue_id,revision,features,status,published_by) VALUES(${scope.organizationId},${scope.venueId},${revision},${sql.json(features)},'published',${actor.id})`;
  return {revision,status:'pending_venue',features};
 });
}
export async function applyConfiguration(actor:Actor,scope:TenantScope,input:{revision:number;coordinatorEpoch:number;receiptHash:string}) {
 requirePermission(actor,'configuration.apply',scope);
 if(!actor.deviceId||!await validateOwnership(scope,'coordinator',actor.deviceId,input.coordinatorEpoch,actor.deviceEpoch))throw new Error('OWNER_REQUIRED');
 if(!/^[a-f0-9]{64}$/.test(input.receiptHash))throw new Error('INVALID_DURABLE_RECEIPT');
 return withTenant(scope,async sql=>{
  const facts=await sql`SELECT raw_entry FROM sync_inbox WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND status='applied' AND raw_entry->>'kind'='accepted_fact' AND raw_entry->'payload'->>'operationType'='Configuration.Apply' AND raw_entry->'payload'->'mutations' @> ${sql.json([{ref:{kind:'configuration',id:'applied'},newState:{revision:input.revision}}])}::jsonb`;
  const committed=facts.some(row=>{const entry=row.raw_entry;const originalHash=entry.payload.commandPayloadHash;return typeof originalHash==='string'&&/^[a-f0-9]{64}$/.test(originalHash)&&hashPayload({operationId:entry.operationId,revision:input.revision,payloadHash:originalHash})===input.receiptHash;});
  if(!committed)throw new Error('CONFIGURATION_RECEIPT_PENDING');
  const rows=await sql`UPDATE configuration_revision SET status='applied',applied_at=now() WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND revision=${input.revision} RETURNING revision`;
  if(rows.length!==1)throw new Error('CONFIGURATION_NOT_FOUND');
  return {revision:input.revision,status:'applied'};
 });
}
export async function readConfiguration(actor:Actor,scope:TenantScope){
 requirePermission(actor,actor.deviceId?'sync.read':'configuration.read',scope);
 return withTenant(scope,async sql=>{
  const [row]=await sql`SELECT revision,features,status,applied_at FROM configuration_revision WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} ORDER BY revision DESC LIMIT 1`;
  return row??{revision:0,features:{},status:'unconfigured'};
 });
}

export async function signedConfiguration(actor:Actor,scope:TenantScope,afterRevision:number){
 requirePermission(actor,'sync.read',scope);
 if(!Number.isSafeInteger(afterRevision)||afterRevision<0)throw new Error('INVALID_CONFIG_CURSOR');
 const next=await withTenant(scope,async sql=>{
  const [row]=await sql`SELECT revision,features,status FROM configuration_revision WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND revision>${afterRevision} ORDER BY revision ASC LIMIT 1`;
  return row;
 });
 if(!next)return {revision:afterRevision,status:'current',publication:null};
 const nowMs=Date.now();const signed=signGrant({schemaVersion:1,...scope,revision:Number(next.revision),features:next.features,issuedAt:new Date(nowMs).toISOString(),expiresAt:new Date(nowMs+60000).toISOString()},configuredGrantSigner());
 return {...next,publication:{grant:signed.payload,signature:signed.signature}};
}
