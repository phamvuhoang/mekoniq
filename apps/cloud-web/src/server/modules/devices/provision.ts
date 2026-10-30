import {validateAuthorityProvision,validatePairingGrant} from '../../../../../../packages/contracts/src/validate';
import {randomUUID,type JsonWebKey} from 'node:crypto';
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
  const configured=stations.map(s=>s.aggregate_id as string);
  const assigned:unknown[]=member?member.station_ids:(actor.stationIdsByVenue?.[scope.venueId]??[]);
  const stationIds=subjectRole==='chef'?assigned.filter((id):id is string=>typeof id==='string'&&configured.includes(id)):configured;
  const [handoff]=Number(owner.epoch)>1?await sql`SELECT state FROM sync_projection WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND aggregate_type='ownership' AND aggregate_id=${scope.venueId}`:[];
  if(Number(owner.epoch)>1&&(!handoff||handoff.state.status!=='active'||handoff.state.epoch!==Number(owner.epoch)||!Array.isArray(handoff.state.proofs)))throw new Error('HANDOFF_BASIS_MISSING');
  return {device,owner,authority,coordinator,subjectRole,subjectPermissions,stationIds,handoff:handoff?.state};
 });
 const permissions=context.subjectPermissions;
 const expiresAt=new Date(nowMs+86400000).toISOString();
 const signedAuthority=signGrant({...scope,deviceEpoch:context.device.device_epoch,coordinatorEpoch:Number(context.owner.epoch),policyRevision:Number(context.authority.policy_revision),ownerDeviceId:context.owner.owner_device_id,ownerDeviceEpoch:context.coordinator.device_epoch,publicJwk:context.coordinator.public_jwk,expiresAt,...(context.handoff?{previousCoordinatorEpoch:Number(context.owner.epoch)-1,handoffId:context.handoff.handoffId,fencingProofs:context.handoff.proofs}:{})},privateJwk);
 const offlineGrant=issueOfflineGrant({...scope,deviceId,deviceEpoch:context.device.device_epoch,actorRef:subjectId,permissions,stationIds:context.stationIds,coordinatorEpoch:Number(context.owner.epoch),nonce:randomUUID()},privateJwk,nowMs);
 const signedPairing=signGrant({...scope,deviceId,deviceEpoch:context.device.device_epoch,actorRef:subjectId,permissions,stationIds:context.stationIds,expiresAt,publicJwk:context.device.public_jwk,certificateFingerprint:context.device.certificate_fingerprint},privateJwk);
 const response={authority:{grant:signedAuthority.payload,signature:signedAuthority.signature},offlineGrant,pairingGrant:{grant:signedPairing.payload,signature:signedPairing.signature}};
 validateAuthorityProvision(response.authority);validatePairingGrant(response.pairingGrant);return response;
}
