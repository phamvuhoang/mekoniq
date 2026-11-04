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
import {relayVenueCommand,readVenueRecords} from './relay/venue-command';
import {createAssetUpload,createAssetDownload,type UploadInput} from './storage/signed-upload';
import {finalizeAsset} from './storage/finalize';
import {guestMenu,guestMenuImage,guestSession,submitGuestCommand} from './guest/api';
import {createChainRevision,rollBackForward,chainPublish,previewRollout,compareBranches,listChainRevisions} from './chain/catalog-rollout';
import {setBranchOverride} from './chain/branch-overrides';
import {rolloutStatus} from './chain/rollout-state';
import {chainReport,chainReportCsv} from './chain/reports';
import {createSharedBalance,reserveSharedBalance,reconcileSharedBalance,readSharedBalance} from './chain/shared-entitlements';
import {receiveExternalOrder,receiveChannelCancellation,externalOrderStatus,newWebExternalId} from './channels/ingress';
import {issueChannelCredential,revokeChannelCredential} from './channels/credentials';
import {resolveDeadLetter} from './channels/restaurant-ack';
import {submitAutomationCommand,readAutomationResult,readAutomationEvents} from './automation/api';
import {bindMerchant,createPaymentIntent,readPaymentIntent,receivePaymentWebhook,reconcilePaymentIntents,requestProviderRefund,unappliedFunds} from './payments/provider';
import {amendInvoice,collectInvoiceRequests,listInvoices,reconcileInvoices} from './invoices/issuer';
import {exportAccounting} from './accounting/export';
import {readReport} from './reports/read';
import {reportCsv} from '../../../../../packages/domain/src/reporting/report';
import type {CommandEnvelope,CommandResult,JsonObject} from '../../../../../packages/contracts/generated/wire';
export type CloudRouteContext={actor:Actor|null;params:Record<string,string>;body:unknown;rawBody:string};
export type CloudRoute={method:string;path:string;permission:string|null;bodyLimit:number;raw?:boolean;handler:(request:Request,context:CloudRouteContext)=>Promise<Response>};
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('INVALID_BODY');return value as Record<string,unknown>;}
function actorRequired(actor:Actor|null){if(!actor)throw new Error('UNAUTHENTICATED');return actor;}
function actorScope(actor:Actor,venueId:string):TenantScope{return {organizationId:actor.organizationId,venueId};}
function protectMutation(request:Request,actor:Actor){if(actor.deviceId)return;if(!csrfAllowed(request))throw new Error('CSRF_DENIED');}
function safe(handler:CloudRoute['handler']):CloudRoute['handler']{return async(request,context)=>{
 try{return await handler(request,context);}catch(error){
  const code=error instanceof Error?error.message:'SERVICE_UNAVAILABLE';
  const status=code==='UNAUTHENTICATED'?401:/DENIED|FORBIDDEN|OWNER_REQUIRED|INVALID_SIGNATURE|UNENROLLED|NOT_ENABLED|KIND_NOT_READABLE/.test(code)?403:/CONFLICT|HANDOFF_REQUIRED|NOT_READY|UNRECONCILED|SESSION_EXPIRED|EXHAUSTED|BALANCE_EXISTS|FEATURE_|REFUND_IN_PROGRESS|INTENT_NOT_CAPTURED|INVOICE_NOT_ISSUED|NOT_CANCELLABLE/.test(code)?409:/NOT_FOUND/.test(code)?404:/INVALID|EXPIRED|REJECTED|MISMATCH|UNKNOWN_FEATURE|OVERRIDE_|ESCROW_|COMMAND_NOT_RELAYABLE|AMOUNT_EXCEEDS|BILL_NOT_PAYABLE|MERCHANT_NOT_BOUND|REFUND_EXCEEDS|SIGNATURE_SCHEME|UNSUPPORTED_BY_PROVIDER|REJECTED_BY_PROVIDER/.test(code)?400:/PAYLOAD_TOO_LARGE/.test(code)?413:/QUOTA/.test(code)?507:/RATE_LIMITED/.test(code)?429:503;
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
 add('POST','/v1/venues/:venueId/commands','relay.write',async(request,c)=>{const actor=actorRequired(c.actor);protectMutation(request,actor);const body=object(c.body);const result=await relayVenueCommand(actor,actorScope(actor,c.params.venueId),{type:String(body.type),payload:object(body.payload) as Parameters<typeof relayVenueCommand>[2]['payload'],...(typeof body.operationId==='string'?{operationId:body.operationId}:{})});return Response.json(result,{status:result.status==='pending'?202:200});});
 add('GET','/v1/venues/:venueId/records/:kind','configuration.read',async(_request,c)=>{const actor=actorRequired(c.actor);return Response.json(await readVenueRecords(actor,actorScope(actor,c.params.venueId),c.params.kind));});
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
 add('GET','/v1/reports/:kind','report.read',async(request,c)=>{
  const actor=actorRequired(c.actor),query=new URL(request.url).searchParams,businessDate=query.get('businessDate')??'';
  const report=await readReport(actor,actorScope(actor,query.get('venueId')??''),c.params.kind,businessDate);
  if(query.get('format')!=='csv')return Response.json(report);
  return new Response('\uFEFF'+reportCsv(report),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${c.params.kind}-${businessDate}.csv"`}}); // kind and date are validated by readReport
 });
 // Chain (organisation-wide) back office: owner-level rights checked again per venue; the cloud relays intents and reports what each branch has acknowledged.
 add('GET','/v1/chain/revisions','chain.read',async(_request,c)=>{const actor=actorRequired(c.actor);return Response.json(await listChainRevisions(actor,actor.organizationId));});
 add('POST','/v1/chain/revisions','chain.publish',async(request,c)=>{const actor=actorRequired(c.actor);protectMutation(request,actor);const body=object(c.body);return Response.json(await createChainRevision(actor,actor.organizationId,{expectedRevision:Number(body.expectedRevision),snapshot:body.snapshot,...(typeof body.note==='string'?{note:body.note}:{})}),{status:201});});
 add('POST','/v1/chain/rollback','chain.publish',async(request,c)=>{const actor=actorRequired(c.actor);protectMutation(request,actor);const body=object(c.body);return Response.json(await rollBackForward(actor,actor.organizationId,{expectedRevision:Number(body.expectedRevision),toRevision:Number(body.toRevision),...(typeof body.note==='string'?{note:body.note}:{})}),{status:201});});
 add('POST','/v1/chain/revisions/:revision/preview','chain.read',async(_request,c)=>{const actor=actorRequired(c.actor);return Response.json(await previewRollout(actor,actor.organizationId,{revision:Number(c.params.revision),venues:object(c.body).venues as string[]}));});
 add('POST','/v1/chain/revisions/:revision/publish','chain.publish',async(request,c)=>{const actor=actorRequired(c.actor);protectMutation(request,actor);return Response.json(await chainPublish(actor,actor.organizationId,{revision:Number(c.params.revision),venues:object(c.body).venues as string[]}),{status:202});});
 add('GET','/v1/chain/revisions/:revision/status','chain.read',async(_request,c)=>{const actor=actorRequired(c.actor);return Response.json(await rolloutStatus(actor,actor.organizationId,Number(c.params.revision)));});
 add('POST','/v1/chain/venues/:venueId/override','chain.publish',async(request,c)=>{const actor=actorRequired(c.actor);protectMutation(request,actor);const body=object(c.body);return Response.json(await setBranchOverride(actor,actor.organizationId,c.params.venueId,{expectedRevision:Number(body.expectedRevision),patch:body.patch}),{status:201});});
 add('GET','/v1/chain/compare','chain.read',async(request,c)=>{const actor=actorRequired(c.actor),q=new URL(request.url).searchParams;return Response.json(await compareBranches(actor,actor.organizationId,q.get('a')??'',q.get('b')??''));});
 add('GET','/v1/chain/reports','report.read',async(request,c)=>{
  const actor=actorRequired(c.actor),q=new URL(request.url).searchParams,venues=q.get('venues');
  const report=await chainReport(actor,actor.organizationId,q.get('kind')??'chain-sales',q.get('businessDate')??'',venues?venues.split(','):undefined);
  if(q.get('format')!=='csv')return Response.json(report);
  return new Response('\uFEFF'+chainReportCsv(report),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${String(report.kind)}-${String(report.businessDate)}.csv"`}});
 });
 add('POST','/v1/chain/shared-balances','chain.publish',async(request,c)=>{const actor=actorRequired(c.actor);protectMutation(request,actor);const body=object(c.body);return Response.json(await createSharedBalance(actor,actor.organizationId,{balanceId:String(body.balanceId),voucherId:String(body.voucherId),total:Number(body.total)}),{status:201});});
 add('GET','/v1/chain/shared-balances/:id','chain.read',async(_request,c)=>{const actor=actorRequired(c.actor);return Response.json(await readSharedBalance(actor,actor.organizationId,c.params.id));});
 add('POST','/v1/chain/shared-balances/:id/reserve','chain.publish',async(request,c)=>{const actor=actorRequired(c.actor);protectMutation(request,actor);const body=object(c.body);const r=await reserveSharedBalance(actor,actor.organizationId,{balanceId:c.params.id,venueId:String(body.venueId),count:Number(body.count),operationId:String(body.operationId)});return Response.json(r,{status:r.duplicate?200:202});});
 add('POST','/v1/chain/shared-balances/:id/reconcile','chain.publish',async(request,c)=>{const actor=actorRequired(c.actor);protectMutation(request,actor);const body=object(c.body);return Response.json(await reconcileSharedBalance(actor,actor.organizationId,{balanceId:c.params.id,venueId:String(body.venueId),release:body.release===true}));});
 // External channels: signed webhooks are verified on the raw bytes (`raw`), before any parsing; 202 means received, never accepted.
 register({method:'POST',path:'/v1/channels/:provider/webhooks',permission:null,bodyLimit:65536,raw:true,handler:safe(async(request,c)=>{const r=await receiveExternalOrder({provider:c.params.provider,rawBody:c.rawBody,headers:request.headers});return Response.json(r.body,{status:r.status});})});
 register({method:'POST',path:'/v1/channels/:provider/cancellations',permission:null,bodyLimit:8192,raw:true,handler:safe(async(request,c)=>{const r=await receiveChannelCancellation({provider:c.params.provider,rawBody:c.rawBody,headers:request.headers});return Response.json(r.body,{status:r.status});})});
 add('GET','/v1/channels/:provider/merchants/:merchantId/orders/:externalId',null,async(request,c)=>Response.json(await externalOrderStatus({provider:c.params.provider,merchantId:c.params.merchantId,externalId:c.params.externalId,headers:request.headers})));
 register({method:'POST',path:'/v1/channels/web-sandbox/:organizationId/:venueId/orders',permission:null,bodyLimit:16384,raw:true,handler:safe(async(request,c)=>{
  // Sandbox web checkout: public, so the server assigns the id and the merchant; it is refused unless CHANNELS_SANDBOX_WEB=1 and every order is tagged sandbox.
  let body:Record<string,unknown>;try{body=JSON.parse(c.rawBody);}catch{throw new Error('INVALID_BODY');}if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('INVALID_BODY');
  const raw=JSON.stringify({items:body.items,currency:body.currency,merchantId:'web',externalId:newWebExternalId(),expiresAt:new Date(Date.now()+30*60000).toISOString()});
  const r=await receiveExternalOrder({provider:'web-sandbox',rawBody:raw,headers:request.headers,publicScope:{organizationId:c.params.organizationId,venueId:c.params.venueId}});
  return Response.json({...r.body,externalId:JSON.parse(raw).externalId},{status:r.status});})});
 add('GET','/v1/channels/web-sandbox/:organizationId/:venueId/orders/:externalId',null,async(request,c)=>Response.json(await externalOrderStatus({provider:'web-sandbox',merchantId:'web',externalId:c.params.externalId,headers:request.headers,publicScope:{organizationId:c.params.organizationId,venueId:c.params.venueId}})));
 add('POST','/v1/venues/:venueId/channels/credentials','channel.operate',async(request,c)=>{const actor=actorRequired(c.actor);protectMutation(request,actor);const body=object(c.body);return Response.json(await issueChannelCredential(actor,actorScope(actor,c.params.venueId),{provider:String(body.provider),merchantId:String(body.merchantId),...(body.unavailablePolicy==='reject'||body.unavailablePolicy==='hold'?{unavailablePolicy:body.unavailablePolicy}:{})}),{status:201});});
 add('POST','/v1/venues/:venueId/channels/credentials/:keyId/revoke','channel.operate',async(request,c)=>{const actor=actorRequired(c.actor);protectMutation(request,actor);return Response.json(await revokeChannelCredential(actor,actorScope(actor,c.params.venueId),c.params.keyId));});
 add('POST','/v1/venues/:venueId/channels/jobs/:jobId/resolve','channel.operate',async(request,c)=>{const actor=actorRequired(c.actor);protectMutation(request,actor);const body=object(c.body);return Response.json(await resolveDeadLetter(actor,actorScope(actor,c.params.venueId),c.params.jobId,body.action as 'retry'|'abandon'));});
 // Automation (service accounts): allowlisted commands with a caller-chosen operationId, own-result reads, polled events. Never a robot, MQTT or database path.
 add('POST','/v1/automation/venues/:venueId/commands','relay.write',async(request,c)=>{const actor=actorRequired(c.actor);protectMutation(request,actor);const body=object(c.body);const result=await submitAutomationCommand(actor,actorScope(actor,c.params.venueId),{type:String(body.type),payload:object(body.payload) as Parameters<typeof submitAutomationCommand>[2]['payload'],...(typeof body.operationId==='string'?{operationId:body.operationId}:{})});return Response.json(result,{status:result.status==='pending'?202:200});});
 add('GET','/v1/automation/venues/:venueId/commands/:operationId','relay.write',async(_request,c)=>{const actor=actorRequired(c.actor);return Response.json(await readAutomationResult(actor,actorScope(actor,c.params.venueId),c.params.operationId));});
 add('GET','/v1/automation/venues/:venueId/events',null,async(request,c)=>{const actor=actorRequired(c.actor),q=new URL(request.url).searchParams;return Response.json(await readAutomationEvents(actor,actorScope(actor,c.params.venueId),q.get('kind')??'',q.get('after')??''));});
 // Payment provider (W10-T02): signed webhook on the raw bytes, then the provider is QUERIED; a QR / intent is a request to pay, only a verified provider fact is money.
 register({method:'POST',path:'/v1/payments/:profileId/webhooks',permission:null,bodyLimit:65536,raw:true,handler:safe(async(request,c)=>Response.json(await receivePaymentWebhook({profileId:c.params.profileId,rawBody:c.rawBody,headers:request.headers})))});
 add('POST','/v1/venues/:venueId/payments/merchant','payment.operate',async(request,c)=>{const actor=actorRequired(c.actor);protectMutation(request,actor);const b=object(c.body);return Response.json(await bindMerchant(actor,actorScope(actor,c.params.venueId),{profileId:String(b.profileId),merchantId:String(b.merchantId),...(typeof b.bin==='string'?{bin:b.bin}:{}),...(typeof b.account==='string'?{account:b.account}:{})}),{status:201});});
 add('POST','/v1/venues/:venueId/payments/intents','payment.intent',async(request,c)=>{const actor=actorRequired(c.actor);protectMutation(request,actor);const b=object(c.body);return Response.json(await createPaymentIntent(actor,actorScope(actor,c.params.venueId),{billId:String(b.billId),amountMinor:String(b.amountMinor),profileId:String(b.profileId),...(typeof b.intentId==='string'?{intentId:b.intentId}:{})}),{status:201});});
 add('GET','/v1/venues/:venueId/payments/intents/:intentId','payment.intent',async(_request,c)=>{const actor=actorRequired(c.actor);return Response.json(await readPaymentIntent(actor,actorScope(actor,c.params.venueId),c.params.intentId));});
 add('POST','/v1/venues/:venueId/payments/intents/:intentId/refund','payment.refund',async(request,c)=>{const actor=actorRequired(c.actor);protectMutation(request,actor);const b=object(c.body);return Response.json(await requestProviderRefund(actor,actorScope(actor,c.params.venueId),{intentId:c.params.intentId,amountMinor:String(b.amountMinor),reason:String(b.reason),...(typeof b.refundId==='string'?{refundId:b.refundId}:{})}));});
 add('GET','/v1/venues/:venueId/payments/unapplied','payment.operate',async(_request,c)=>{const actor=actorRequired(c.actor);return Response.json(await unappliedFunds(actor,actorScope(actor,c.params.venueId)));});
 add('POST','/v1/venues/:venueId/payments/reconcile','payment.operate',async(request,c)=>{const actor=actorRequired(c.actor);protectMutation(request,actor);requirePermission(actor,'payment.operate',actorScope(actor,c.params.venueId));return Response.json(await reconcilePaymentIntents(actorScope(actor,c.params.venueId)));});
 // E-invoices (W10-T03): the venue owns the request and the answer; the cloud guards the provider call (claim as unknown, query before any re-issue).
 add('POST','/v1/venues/:venueId/invoices/collect','invoice.operate',async(request,c)=>{const actor=actorRequired(c.actor);protectMutation(request,actor);const scope=actorScope(actor,c.params.venueId);requirePermission(actor,'invoice.operate',scope);return Response.json(await collectInvoiceRequests(scope,String(object(c.body).profileId)));});
 add('POST','/v1/venues/:venueId/invoices/reconcile','invoice.operate',async(request,c)=>{const actor=actorRequired(c.actor);protectMutation(request,actor);const scope=actorScope(actor,c.params.venueId);requirePermission(actor,'invoice.operate',scope);return Response.json(await reconcileInvoices(scope));});
 add('GET','/v1/venues/:venueId/invoices','invoice.request',async(_request,c)=>{const actor=actorRequired(c.actor);return Response.json(await listInvoices(actor,actorScope(actor,c.params.venueId)));});
 add('POST','/v1/venues/:venueId/invoices/:requestId/amend','invoice.operate',async(request,c)=>{const actor=actorRequired(c.actor);protectMutation(request,actor);const b=object(c.body);return Response.json(await amendInvoice(actor,actorScope(actor,c.params.venueId),{requestId:c.params.requestId,action:b.action==='cancel'?'cancel':'adjust',reason:String(b.reason),key:String(b.key),...(typeof b.deltaMinor==='string'?{deltaMinor:b.deltaMinor}:{})}));});
 add('GET','/v1/venues/:venueId/accounting/export','report.read',async(request,c)=>{
  const actor=actorRequired(c.actor),q=new URL(request.url).searchParams,date=q.get('businessDate')??'',out=await exportAccounting(actor,actorScope(actor,c.params.venueId),date);
  if(q.get('format')!=='csv')return Response.json({lines:out.lines,timeZone:out.timeZone,timeZoneAssumed:out.timeZoneAssumed,complete:out.complete});
  return new Response('\uFEFF'+out.csv,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="accounting-${date}.csv"`}});
 });
 // Guest web: no staff session. Scope comes from the venue-signed table token (or the public menu's own org/venue), never from a cookie.
 add('GET','/v1/guest/menu/:organizationId/:venueId',null,async(_request,c)=>Response.json(await guestMenu({organizationId:c.params.organizationId,venueId:c.params.venueId})));
 add('GET','/v1/guest/menu/:organizationId/:venueId/images/:assetId',null,async(_request,c)=>new Response(null,{status:302,headers:{Location:await guestMenuImage({organizationId:c.params.organizationId,venueId:c.params.venueId},c.params.assetId)}}));
 add('POST','/v1/guest/session',null,async(_request,c)=>Response.json(await guestSession(object(c.body).token)),8192);
 add('POST','/v1/guest/commands',null,async(_request,c)=>{
  const body=object(c.body),result=await submitGuestCommand(body.token,String(body.type),object(body.payload??{}) as JsonObject,body.operationId);return Response.json(result,{status:result.status==='pending'?202:200});
 },16384);
}
