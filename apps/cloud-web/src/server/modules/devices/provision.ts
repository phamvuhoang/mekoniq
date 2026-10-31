import {validateEnvelope,validateJournal,validateAuthorityProvision,validatePairingGrant} from '../../../../../../packages/contracts/src/validate';
import {canonicalBytes,hashPayload,verifyEs256,type PublicEcJwk} from '../../../../../../packages/contracts/src/index';
import {randomUUID,type JsonWebKey} from 'node:crypto';
import {buildHandoffSnapshots} from './handoff-checkpoint';
import type {Snapshot,JournalEntry,JsonObject} from '../../../../../../packages/contracts/src/index';
import {requirePermission,rolePermissions,permissionsForVenue,type Actor} from '../identity/rbac';
import {withTenant,type TenantScope} from '../identity/tenant-context';
import {issueOfflineGrant,signGrant} from './grants';
export async function createDeviceProvision(actor:Actor,scope:TenantScope,deviceId:string,options:{actorId?:string;nowMs?:number}={}){
 requirePermission(actor,'device.enroll',scope);const nowMs=options.nowMs??Date.now();
 const subjectId=options.actorId??actor.id;if(options.actorId&&!/^[0-9a-f-]{36}$/i.test(options.actorId))throw new Error('INVALID_ACTOR_ID');
 const signer=process.env.DEVICE_GRANT_PRIVATE_KEY;if(!signer)throw new Error('GRANT_SIGNER_UNAVAILABLE');
 const privateJwk=JSON.parse(signer) as JsonWebKey;
 const context=await withTenant(scope,async sql=>{
  const [device]=await sql`SELECT device_epoch,public_jwk,certificate_fingerprint FROM device_enrollment WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND device_id=${deviceId} AND status='active'`;
  const [owner]=await sql`SELECT owner_device_id,owner_device_epoch,epoch FROM venue_ownership WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND resource_id='coordinator' AND status='active'`;
  const [authority]=await sql`SELECT coordinator_epoch,policy_revision FROM authority WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId}`;
  if(!device||!device.certificate_fingerprint)throw new Error('DEVICE_CERTIFICATE_NOT_ENROLLED');
  if(!owner||!authority||Number(owner.epoch)!==authority.coordinator_epoch)throw new Error('AUTHORITY_NOT_ALIGNED');
  const [coordinator]=await sql`SELECT device_epoch,public_jwk FROM device_enrollment WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND device_id=${owner.owner_device_id} AND status='active'`;
  if(!coordinator||owner.owner_device_epoch!==coordinator.device_epoch)throw new Error('COORDINATOR_UNENROLLED');
  const stations=await sql`SELECT aggregate_id FROM sync_projection WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND aggregate_type='station'`;
  const [member]=subjectId===actor.id?[]:await sql`SELECT role,station_ids FROM venue_membership WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND user_id=${subjectId}::uuid AND active`;
  if(subjectId!==actor.id&&!member)throw new Error('SCOPE_DENIED');
  const subjectRole=member?.role??actor.role;const subjectPermissions=member?rolePermissions(member.role):permissionsForVenue(actor,scope.venueId);
  if(subjectId!==actor.id){
   const callerPermissions=permissionsForVenue(actor,scope.venueId);
   // Selecting an existing identity is a separate delegation capability. Never impersonate an owner.
   if(subjectRole==='owner'||(!callerPermissions.includes('*')&&(!callerPermissions.includes('identity.delegate')||subjectPermissions.some(permission=>!callerPermissions.includes(permission)))))throw new Error('IDENTITY_DELEGATION_DENIED');
  }
  const configured=stations.map(s=>s.aggregate_id as string);
  const assigned:unknown[]=member?member.station_ids:(actor.stationIdsByVenue?.[scope.venueId]??[]);
  const stationIds=subjectRole==='chef'?assigned.filter((id):id is string=>typeof id==='string'&&configured.includes(id)):configured;
  const [handoff]=Number(owner.epoch)>1?await sql`SELECT state FROM sync_projection WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND aggregate_type='ownership' AND aggregate_id=${scope.venueId}`:[];
  if(Number(owner.epoch)>1&&(!handoff||handoff.state.status!=='active'||handoff.state.epoch!==Number(owner.epoch)||!Array.isArray(handoff.state.proofs)))throw new Error('HANDOFF_BASIS_MISSING');
  let checkpoint:Record<string,unknown>|undefined;
  if(handoff){
   // One statement observes projections, original receipts and keys at the same MVCC snapshot.
   const [row]=await sql`SELECT jsonb_build_object(
    'entries',(SELECT coalesce(jsonb_agg(e.raw_entry),'[]'::jsonb) FROM (SELECT raw_entry FROM sync_inbox WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND status='applied' ORDER BY received_at,entry_id LIMIT 1001) e),
    'snapshots',(SELECT coalesce(jsonb_agg(s.value),'[]'::jsonb) FROM (SELECT jsonb_build_object('ref',jsonb_build_object('organizationId',organization_id,'venueId',venue_id,'kind',aggregate_type,'id',aggregate_id),'version',version,'state',state) value FROM sync_projection WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND aggregate_type<>'__scope__' LIMIT 10001) s),
    'keys',(SELECT coalesce(jsonb_agg(jsonb_build_object('deviceId',device_id,'deviceEpoch',device_epoch,'publicJwk',public_jwk)),'[]'::jsonb) FROM device_enrollment WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId}),
    'devices',(SELECT coalesce(jsonb_agg(jsonb_build_object('deviceId',device_id,'deviceEpoch',device_epoch,'publicJwk',public_jwk,'status',status)),'[]'::jsonb) FROM device_enrollment WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND status='active'),
    'pending',EXISTS(SELECT 1 FROM sync_inbox WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND status='pending')
   ) checkpoint`;
   checkpoint=row!.checkpoint;
  }
  return {device,owner,authority,coordinator,subjectRole,subjectPermissions,stationIds,handoff:handoff?.state,checkpoint};
 });
 const permissions=context.subjectPermissions;
 const expiresAt=new Date(nowMs+86400000).toISOString();
 let handoffCheckpoint={};
 if(context.checkpoint){
  const data=context.checkpoint as {entries:unknown[];snapshots:Snapshot[];devices:JsonObject[];keys:{deviceId:string;deviceEpoch:string;publicJwk:PublicEcJwk}[];pending:boolean};
  if(data.pending)throw new Error('HANDOFF_JOURNAL_PENDING');
  if(data.entries.length>1000||data.snapshots.length>10000||data.keys.length>1000)throw new Error('HANDOFF_CHECKPOINT_TOO_LARGE');
  const ownership=data.snapshots.find(s=>s.ref.kind==='ownership'&&s.ref.id===scope.venueId)?.state;
  if(!ownership||ownership.status!=='active'||ownership.epoch!==Number(context.owner.epoch)||ownership.owner!==context.owner.owner_device_id||ownership.handoffId!==context.handoff.handoffId)throw new Error('HANDOFF_CHECKPOINT_CHANGED');
  const operations=new Set<string>();
  for(const raw of data.entries){
   const entry=validateJournal(raw),payload=entry.payload;
   if(!payload.commandEnvelope||!payload.commandResult||typeof payload.commandFingerprint!=='string')throw new Error('HANDOFF_RECEIPT_METADATA_MISSING');
   const command=validateEnvelope(payload.commandEnvelope),result=payload.commandResult as {operationId?:string};
   const fingerprint=hashPayload({organizationId:command.organizationId,venueId:command.venueId,type:command.type,actorRef:command.actorRef,deviceId:command.deviceId,deviceEpoch:command.deviceEpoch,coordinatorEpoch:command.coordinatorEpoch,policyRevision:command.policyRevision,expectedVersion:command.expectedVersion??null,payloadHash:command.payloadHash});
   if(command.organizationId!==scope.organizationId||command.venueId!==scope.venueId||command.operationId!==entry.operationId||result.operationId!==entry.operationId||fingerprint!==payload.commandFingerprint)throw new Error('HANDOFF_RECEIPT_METADATA_INVALID');
   const key=data.keys.find(k=>k.deviceId===entry.deviceId&&k.deviceEpoch===entry.deviceEpoch);
   const {signature,...unsigned}=entry;
   if(!key||!verifyEs256(canonicalBytes(unsigned),signature,key.publicJwk))throw new Error('HANDOFF_PRODUCER_KEY_UNAVAILABLE');
   operations.add(entry.operationId);
  }
  const snapshots=buildHandoffSnapshots(scope,data.entries as JournalEntry[],data.snapshots,data.devices,{deviceId:context.owner.owner_device_id,deviceEpoch:context.coordinator.device_epoch,epoch:Number(context.owner.epoch)});
  handoffCheckpoint={handoffSnapshots:snapshots,handoffEntries:data.entries,handoffProducerKeys:data.keys,handoffReceiptsComplete:true,handoffReceiptCount:operations.size};
  if(Buffer.byteLength(JSON.stringify(handoffCheckpoint))>4*1024*1024-16384)throw new Error('HANDOFF_CHECKPOINT_TOO_LARGE');
 }
 const signedAuthority=signGrant({...scope,deviceEpoch:context.device.device_epoch,coordinatorEpoch:Number(context.owner.epoch),policyRevision:Number(context.authority.policy_revision),ownerDeviceId:context.owner.owner_device_id,ownerDeviceEpoch:context.coordinator.device_epoch,publicJwk:context.coordinator.public_jwk,expiresAt,...(context.handoff?{previousCoordinatorEpoch:Number(context.owner.epoch)-1,handoffId:context.handoff.handoffId,fencingProofs:context.handoff.proofs,...handoffCheckpoint}:{})},privateJwk);
 const offlineGrant=issueOfflineGrant({...scope,deviceId,deviceEpoch:context.device.device_epoch,actorRef:subjectId,permissions,stationIds:context.stationIds,coordinatorEpoch:Number(context.owner.epoch),nonce:randomUUID()},privateJwk,nowMs);
 const signedPairing=signGrant({...scope,deviceId,deviceEpoch:context.device.device_epoch,actorRef:subjectId,permissions,stationIds:context.stationIds,expiresAt,publicJwk:context.device.public_jwk,certificateFingerprint:context.device.certificate_fingerprint},privateJwk);
 const response={authority:{grant:signedAuthority.payload,signature:signedAuthority.signature},offlineGrant,pairingGrant:{grant:signedPairing.payload,signature:signedPairing.signature}};
 const authority=validateAuthorityProvision(response.authority);validatePairingGrant(response.pairingGrant);return {...response,authority};
}
