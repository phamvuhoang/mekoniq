import {canonicalBytes,hashPayload,verifyEs256,type PublicEcJwk} from '../../../../../../packages/contracts/src/index';
import type {CommandEnvelope,JsonObject} from '../../../../../../packages/contracts/generated/wire';
import {decodeGuestToken,guestCommand,guestSessionValid,guestTokenCapability} from '../../../../../../packages/domain/src/service/guest-token';
import {withTenant,type TenantScope} from '../identity/tenant-context';
import {enqueueGuestRelay,guestRelaySource} from '../relay/commands';
import {supabaseAdmin} from '../../supabase/admin';
import {ASSET_BUCKET} from '../storage/manifest';
/**
 * Guest web API. No Supabase session is involved: the only authority is a QR token the venue coordinator signed. The cloud checks the
 * signature against the enrolled coordinator key so it can scope what it shows; the venue verifies it again (with the session revision)
 * before anything happens. Every guest write is a relay command that stays pending until the venue's receipt exists.
 */
type Verified={token:JsonObject;scope:TenantScope;epoch:number;policyRevision:number};
async function verifiedToken(raw:unknown):Promise<Verified>{
 if(typeof raw!=='string')throw new Error('GUEST_TOKEN_INVALID');
 const token=decodeGuestToken(raw);
 if(token.channel!=='qr')throw new Error('GUEST_CHANNEL_MISMATCH'); // kiosk tokens are for venue devices on the LAN
 const scope={organizationId:String(token.organizationId),venueId:String(token.venueId)};
 const {owner,device,policy}=await withTenant(scope,async sql=>{
  const [owner]=await sql`SELECT owner_device_id,owner_device_epoch,epoch FROM venue_ownership WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND resource_id='coordinator' AND status='active'`;
  const [device]=owner?await sql`SELECT public_jwk FROM device_enrollment WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND device_id=${owner.owner_device_id} AND device_epoch=${owner.owner_device_epoch} AND status='active'`:[];
  const [policy]=await sql`SELECT policy_revision FROM authority WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId}`;
  return {owner,device,policy};
 });
 if(!owner||!device||token.issuerDeviceId!==owner.owner_device_id||token.issuerDeviceEpoch!==owner.owner_device_epoch||token.issuerEpoch!==Number(owner.epoch)||!verifyEs256(canonicalBytes(guestTokenCapability(token)),String(token.signature),device.public_jwk as PublicEcJwk))throw new Error('GUEST_TOKEN_INVALID');
 if(Date.now()>=Number(token.expiresAtMs))throw new Error('GUEST_TOKEN_EXPIRED');
 if(!policy)throw new Error('OWNER_OR_POLICY_UNAVAILABLE');
 return {token,scope,epoch:Number(owner.epoch),policyRevision:Number(policy.policy_revision)};
}
const lineView=(line:JsonObject)=>({name:String(line.name),quantity:String(line.quantity),cancelledQuantity:String(line.cancelledQuantity??'0')});
/** What the token's own seating may see: its table name, its orders and calls, and the receipts of its own requests. Nothing of other sessions. */
export async function guestSession(raw:unknown){
 const v=await verifiedToken(raw),sessionId=String(v.token.sessionId),actorRef=`guest:${String(v.token.id)}`;
 return withTenant(v.scope,async sql=>{
  const [session]=await sql`SELECT state FROM sync_projection WHERE organization_id=${v.scope.organizationId} AND venue_id=${v.scope.venueId} AND aggregate_type='session' AND aggregate_id=${sessionId}`;
  const [table]=await sql`SELECT state FROM sync_projection WHERE organization_id=${v.scope.organizationId} AND venue_id=${v.scope.venueId} AND aggregate_type='table' AND aggregate_id=${String(v.token.tableId)}`;
  const live=Boolean(session)&&guestSessionValid({sessionId,revision:Number(v.token.revision)},{id:sessionId,revision:Number(session.state.revision??0),status:String(session.state.status)});
  const rows=live?await sql`SELECT aggregate_type,aggregate_id,state FROM sync_projection WHERE organization_id=${v.scope.organizationId} AND venue_id=${v.scope.venueId} AND aggregate_type IN ('order','service-call') AND state->>'sessionId'=${sessionId} ORDER BY aggregate_id LIMIT 200`:[];
  const relays=await sql`SELECT operation_id,status,venue_receipt,expires_at,command->>'type' AS type FROM relay_command WHERE organization_id=${v.scope.organizationId} AND venue_id=${v.scope.venueId} AND command->>'actorRef'=${actorRef} ORDER BY created_at DESC LIMIT 20`;
  return {
   organizationId:v.scope.organizationId,venueId:v.scope.venueId,tableName:String(table?.state.name??v.token.tableId),expiresAt:String(v.token.expiresAt),
   // Projection lag: a session the cloud has not seen yet is 'unknown', never assumed open or closed.
   session:!session?'unknown':live?'open':'expired',
   orders:rows.filter(r=>r.aggregate_type==='order').map(r=>({id:r.aggregate_id,status:String(r.state.status),currency:String(r.state.currency),totalMinor:String(r.state.totalMinor),lines:((r.state.lines??[]) as JsonObject[]).map(lineView)})),
   calls:rows.filter(r=>r.aggregate_type==='service-call').map(r=>({id:r.aggregate_id,kind:String(r.state.kind),status:String(r.state.status)})),
   // 'unreachable': the venue never answered before the relay expired, so staff must take the order instead.
   requests:relays.map(r=>({operationId:r.operation_id,type:r.type,status:r.status==='pending'&&Date.parse(r.expires_at)<=Date.now()?'unreachable':r.status,code:r.venue_receipt?.code??null})),
  };
 });
}
export async function submitGuestCommand(raw:unknown,type:string,payload:JsonObject,clientOperationId:unknown){
 const v=await verifiedToken(raw);
 if(typeof clientOperationId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(clientOperationId))throw new Error('INVALID_OPERATION_ID');
 const built=guestCommand(raw as string,type,payload);
 // A seating the venue already ended or moved (synced projection) cannot keep queueing work; an unsynced one is left for the venue to judge.
 const [session]=await withTenant(v.scope,sql=>sql`SELECT state FROM sync_projection WHERE organization_id=${v.scope.organizationId} AND venue_id=${v.scope.venueId} AND aggregate_type='session' AND aggregate_id=${String(v.token.sessionId)}`);
 if(session&&!guestSessionValid({sessionId:String(v.token.sessionId),revision:Number(v.token.revision)},{id:String(v.token.sessionId),revision:Number(session.state.revision??0),status:String(session.state.status)}))throw new Error('SESSION_EXPIRED');
 // Namespaced per token, so one guest can never collide with (or probe) another guest's operation ids.
 const operationId=`guest-${hashPayload({tokenId:built.tokenId,clientOperationId}).slice(0,40)}`,now=new Date().toISOString();
 const command:CommandEnvelope={schemaVersion:1,...v.scope,operationId,type:built.type,actorRef:`guest:${built.tokenId}`,...guestRelaySource,coordinatorEpoch:v.epoch,policyRevision:v.policyRevision,occurredAt:now,recordedAt:now,payload:built.payload,payloadHash:hashPayload(built.payload)};
 return {...await enqueueGuestRelay(command,new Date(Date.now()+120000).toISOString()),operationId};
}
/** Public menu: names, prices, availability, modifiers and image ids only (no pricing rules, coupons or staff data). */
export async function guestMenu(scope:TenantScope){
 const [catalog]=await withTenant(scope,sql=>sql`SELECT state FROM sync_projection WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND aggregate_type='catalog' AND aggregate_id='current'`);
 if(!catalog)throw new Error('MENU_NOT_FOUND');
 return {version:Number(catalog.state.version),currency:String(catalog.state.currency),items:((catalog.state.items??[]) as JsonObject[]).map(i=>({id:String(i.id),name:String(i.name),unitMinor:String(i.unitMinor),available:i.available!==false,...(typeof i.imageManifestId==='string'?{imageManifestId:i.imageManifestId}:{}),...(Array.isArray(i.modifierGroups)?{modifierGroups:i.modifierGroups}:{})}))};
}
/** A menu image is served only if the current menu names it and its manifest is a ready menu_image: never a map, receipt or import file. */
export async function guestMenuImage(scope:TenantScope,assetId:string){
 const path=await withTenant(scope,async sql=>{
  const [catalog]=await sql`SELECT state FROM sync_projection WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND aggregate_type='catalog' AND aggregate_id='current'`;
  if(!((catalog?.state.items??[]) as JsonObject[]).some(i=>i.imageManifestId===assetId))throw new Error('ASSET_NOT_FOUND');
  const [row]=await sql`SELECT object_path FROM asset_manifest WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND id=${assetId} AND kind='menu_image' AND status='ready'`;
  if(!row)throw new Error('ASSET_NOT_FOUND');return String(row.object_path);
 });
 const {data,error}=await supabaseAdmin().storage.from(ASSET_BUCKET).createSignedUrl(path,300);
 if(error||!data)throw new Error('STORAGE_UNAVAILABLE');return data.signedUrl;
}
