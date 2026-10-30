import type {Actor} from './identity/rbac';
import {requirePermission,permissionsForVenue} from './identity/rbac';
import {csrfAllowed} from './identity/session';
import {login,logout,refresh} from './identity/auth';
import {withTenant,type TenantScope} from './identity/tenant-context';
import {initializeVenueOwner} from './devices/ownership';
import {createDeviceProvision} from './devices/provision';
import {createEnrollmentNonce,enrollDevice} from './devices/enrollment';
import type {EnrollmentPayload} from './devices/enrollment';
import {issueOfflineGrant,type SignedGrant} from './devices/grants';
import {randomUUID} from 'node:crypto';
import type {JsonWebKey} from 'node:crypto';
import {readVenueLayout,relayVenueLayout} from './configuration/venue-layout';
import {readCatalog,relayCatalogPublication} from './configuration/catalog';
import {publishConfiguration,readConfiguration,applyConfiguration,signedConfiguration} from './configuration/publish';
import type {FeatureConfig} from '../../../../../packages/domain/src/policy/registry';
import {syncActor,pushEntries,pullEntries,syncWatermark} from './sync/controller';
import {enqueueRelay,pendingRelay,recordVenueReceipt} from './relay/commands';
import {createAssetUpload,createAssetDownload,type UploadInput} from './storage/signed-upload';
import {finalizeAsset} from './storage/finalize';
import type {CommandEnvelope,CommandResult} from '../../../../../packages/contracts/generated/wire';
export type CloudRouteContext={actor:Actor|null;params:Record<string,string>;body:unknown};
export type CloudRoute={method:string;path:string;permission:string|null;bodyLimit:number;handler:(request:Request,context:CloudRouteContext)=>Promise<Response>};
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('INVALID_BODY');return value as Record<string,unknown>;}
function actorRequired(actor:Actor|null){if(!actor)throw new Error('UNAUTHENTICATED');return actor;}
function actorScope(actor:Actor,venueId:string):TenantScope{return {organizationId:actor.organizationId,venueId};}
function protectMutation(request:Request,actor:Actor){if(actor.deviceId)return;if(!csrfAllowed(request))throw new Error('CSRF_DENIED');}
function safe(handler:CloudRoute['handler']):CloudRoute['handler']{return async(request,context)=>{
 try{return await handler(request,context);}catch(error){
  const code=error instanceof Error?error.message:'SERVICE_UNAVAILABLE';
  const status=code==='UNAUTHENTICATED'?401:/DENIED|OWNER_REQUIRED|INVALID_SIGNATURE|UNENROLLED/.test(code)?403:/CONFLICT|HANDOFF_REQUIRED|NOT_READY|UNRECONCILED/.test(code)?409:/NOT_FOUND/.test(code)?404:/INVALID|EXPIRED|REJECTED|MISMATCH|UNKNOWN_FEATURE/.test(code)?400:/QUOTA/.test(code)?507:503;
  return Response.json({code:status===503?'SERVICE_UNAVAILABLE':code},{status});
 }
};}
export function registerWave02Routes(register:(route:CloudRoute)=>void):void {
 const add=(method:string,path:string,permission:string|null,handler:CloudRoute['handler'],bodyLimit=262144)=>register({method,path,permission,bodyLimit,handler:safe(handler)});
 add('POST','/v1/auth/login',null,(request,c)=>login(request,c.body),4096);
 add('POST','/v1/auth/refresh',null,request=>refresh(request),4096);
 add('POST','/v1/auth/logout',null,request=>logout(request),4096);
 add('GET','/v1/venues/:venueId/orders','order.read',async(_request,c)=>{
  const actor=actorRequired(c.actor),scope=actorScope(actor,c.params.venueId);requirePermission(actor,'order.read',scope);
  const orders=await withTenant(scope,sql=>sql`SELECT aggregate_id AS id,version,state FROM sync_projection WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND aggregate_type='order'`);
  return Response.json({orders:orders.map(row=>({id:row.id,version:row.version,state:row.state}))});
 });
 add('POST','/v1/venues/:venueId/devices/challenge','device.enroll',async(request,c)=>{
  const actor=actorRequired(c.actor);protectMutation(request,actor);return Response.json(await createEnrollmentNonce(actor,actorScope(actor,c.params.venueId)));
 });
 add('POST','/v1/devices/enroll','device.enroll',async(request,c)=>{
  const actor=actorRequired(c.actor);protectMutation(request,actor);return Response.json(await enrollDevice(actor,c.body as SignedGrant<EnrollmentPayload>),{status:201});
 });
 add('POST','/v1/venues/:venueId/ownership/initialize','device.enroll',async(request,c)=>{const actor=actorRequired(c.actor);protectMutation(request,actor);const body=object(c.body);if(typeof body.deviceId!=='string')throw new Error('INVALID_DEVICE_ID');return Response.json(await initializeVenueOwner(actor,actorScope(actor,c.params.venueId),body.deviceId),{status:201});});
 add('POST','/v1/venues/:venueId/devices/:deviceId/provision','device.enroll',async(request,c)=>{const actor=actorRequired(c.actor);protectMutation(request,actor);const body=object(c.body);return Response.json(await createDeviceProvision(actor,actorScope(actor,c.params.venueId),c.params.deviceId,{actorId:typeof body.actorId==='string'?body.actorId:undefined}));});
 add('POST','/v1/venues/:venueId/devices/:deviceId/offline-grant','device.enroll',async(request,c)=>{
  const actor=actorRequired(c.actor);protectMutation(request,actor);const scope=actorScope(actor,c.params.venueId);requirePermission(actor,'device.enroll',scope);
  const issuerPermissions=permissionsForVenue(actor,scope.venueId);
  const body=object(c.body);if(!Array.isArray(body.permissions)||body.permissions.length>100||body.permissions.some(p=>typeof p!=='string'||p==='*'||(!issuerPermissions.includes('*')&&!issuerPermissions.includes(p))))throw new Error('INVALID_GRANT_PERMISSIONS');
  const privateKey=process.env.DEVICE_GRANT_PRIVATE_KEY;if(!privateKey)throw new Error('GRANT_SIGNER_UNAVAILABLE');
  const enrolled=await withTenant(scope,async sql=>{const [device]=await sql`SELECT device_epoch FROM device_enrollment WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND device_id=${c.params.deviceId} AND status='active'`;const [owner]=await sql`SELECT epoch FROM venue_ownership WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND resource_id='coordinator'`;if(!device||!owner)throw new Error('UNENROLLED_DEVICE');return {device,owner};});
  return Response.json(issueOfflineGrant({...scope,actorRef:actor.id,deviceId:c.params.deviceId,deviceEpoch:enrolled.device.device_epoch,permissions:body.permissions as string[],stationIds:actor.stationIdsByVenue?.[scope.venueId]??[],coordinatorEpoch:Number(enrolled.owner.epoch),nonce:randomUUID()},JSON.parse(privateKey) as JsonWebKey));
 });
 add('GET','/v1/venues/:venueId/layout','configuration.read',async(_request,c)=>{const actor=actorRequired(c.actor);return Response.json(await readVenueLayout(actor,actorScope(actor,c.params.venueId)));});
 add('POST','/v1/venues/:venueId/layout','configuration.publish',async(request,c)=>{const actor=actorRequired(c.actor);protectMutation(request,actor);const body=object(c.body);return Response.json(await relayVenueLayout(actor,actorScope(actor,c.params.venueId),body as unknown as Parameters<typeof relayVenueLayout>[2]),{status:202});});
 add('GET','/v1/venues/:venueId/catalog','catalog.read',async(_request,c)=>{const actor=actorRequired(c.actor);return Response.json(await readCatalog(actor,actorScope(actor,c.params.venueId)));});
 add('POST','/v1/venues/:venueId/catalog','catalog.publish',async(request,c)=>{const actor=actorRequired(c.actor);protectMutation(request,actor);const body=object(c.body);return Response.json(await relayCatalogPublication(actor,actorScope(actor,c.params.venueId),body as unknown as Parameters<typeof relayCatalogPublication>[2]),{status:202});});
 add('POST','/v1/venues/:venueId/configuration/pull',null,async(request,c)=>{
  const actor=actorRequired(await syncActor(request,c.body,c.actor));const body=object(c.body);return Response.json(await signedConfiguration(actor,actorScope(actor,c.params.venueId),Number(body.afterRevision??0)));
 });
 add('GET','/v1/venues/:venueId/configuration','configuration.read',async(_request,c)=>{const actor=actorRequired(c.actor);return Response.json(await readConfiguration(actor,actorScope(actor,c.params.venueId)));});
 add('POST','/v1/venues/:venueId/configuration','configuration.publish',async(request,c)=>{
  const actor=actorRequired(c.actor);protectMutation(request,actor);const body=object(c.body);return Response.json(await publishConfiguration(actor,actorScope(actor,c.params.venueId),{expectedRevision:Number(body.expectedRevision),features:body.features as FeatureConfig}),{status:202});
 });
 add('POST','/v1/venues/:venueId/configuration/apply',null,async(request,c)=>{
  const actor=actorRequired(await syncActor(request,c.body,c.actor));const body=object(c.body);return Response.json(await applyConfiguration(actor,actorScope(actor,c.params.venueId),{revision:Number(body.revision),coordinatorEpoch:Number(body.coordinatorEpoch),receiptHash:String(body.receiptHash)}));
 });
 add('POST','/v1/sync/handshake',null,async(request,c)=>{
  const actor=actorRequired(await syncActor(request,c.body,c.actor));const body=object(c.body);const scope=actorScope(actor,String(body.venueId));requirePermission(actor,'sync.read',scope);
  const deviceId=actor.deviceId??String(body.deviceId),deviceEpoch=actor.deviceEpoch??String(body.deviceEpoch);
  return Response.json({schemaVersions:[1],limits:{entries:100,bytes:1048576},...await syncWatermark(scope,deviceId,deviceEpoch)});
 },1048576);
 add('POST','/v1/sync/push',null,async(request,c)=>{
  const actor=actorRequired(await syncActor(request,c.body,c.actor));protectMutation(request,actor);const body=object(c.body);if(!Array.isArray(body.entries)||!body.entries.length)throw new Error('INVALID_SYNC_BATCH');
  const first=object(body.entries[0]);const scope=actorScope(actor,String(first.venueId));return Response.json(await pushEntries(actor,scope,body.entries));
 },1048576);
 add('POST','/v1/sync/pull',null,async(request,c)=>{
  const actor=actorRequired(await syncActor(request,c.body,c.actor));const body=object(c.body),scope=actorScope(actor,String(body.venueId));requirePermission(actor,'sync.read',scope);
  return Response.json({entries:await pullEntries(scope,{deviceId:String(body.producerDeviceId??actor.deviceId),deviceEpoch:String(body.producerDeviceEpoch??actor.deviceEpoch)},String(body.after??'0'))});
 },1048576);
 add('POST','/v1/sync/ack',null,async(request,c)=>{
  const actor=actorRequired(await syncActor(request,c.body,c.actor));const body=object(c.body),scope=actorScope(actor,String(body.venueId));requirePermission(actor,'sync.read',scope);
  return Response.json(await syncWatermark(scope,actor.deviceId??String(body.deviceId),actor.deviceEpoch??String(body.deviceEpoch)));
 },1048576);
 add('POST','/v1/relay/commands','relay.write',async(request,c)=>{
  const actor=actorRequired(c.actor);protectMutation(request,actor);const body=object(c.body);const result=await enqueueRelay(actor,body.command as CommandEnvelope,String(body.expiresAt));return Response.json(result,{status:result.status==='pending'?202:200});
 });
 add('POST','/v1/venues/:venueId/relay/pull',null,async(request,c)=>{
  const actor=actorRequired(await syncActor(request,c.body,c.actor));return Response.json({commands:await pendingRelay(actor,actorScope(actor,c.params.venueId))});
 });
 add('POST','/v1/venues/:venueId/relay/receipt',null,async(request,c)=>{
  const actor=actorRequired(await syncActor(request,c.body,c.actor)),body=object(c.body);return Response.json(await recordVenueReceipt(actor,actorScope(actor,c.params.venueId),{coordinatorEpoch:Number(body.coordinatorEpoch),result:body.result as CommandResult}));
 });
 add('POST','/v1/assets/uploads','assets.write',async(request,c)=>{
  const actor=actorRequired(c.actor);protectMutation(request,actor);const body=object(c.body);return Response.json(await createAssetUpload(actor,actorScope(actor,String(body.venueId)),body as unknown as UploadInput),{status:201});
 });
 add('POST','/v1/assets/:id/finalize','assets.write',async(request,c)=>{
  const actor=actorRequired(c.actor);protectMutation(request,actor);const body=object(c.body);return Response.json(await finalizeAsset(actor,actorScope(actor,String(body.venueId)),c.params.id));
 });
 add('GET','/v1/assets/:id/download','assets.read',async(request,c)=>{
  const actor=actorRequired(c.actor);return Response.json(await createAssetDownload(actor,actorScope(actor,new URL(request.url).searchParams.get('venueId')??''),c.params.id));
 });
}
