import {withTenant,type TenantScope} from '../identity/tenant-context';
export function mayAcquireOwner(current:{owner:string|null;status:string}){return current.owner===null&&current.status==='unassigned';}
export async function validateOwnership(scope:TenantScope,resourceId:string,deviceId:string,epoch:number,deviceEpoch?:string) {
 return withTenant(scope,async sql=>{
  const rows=await sql`SELECT owner_device_id,owner_device_epoch,epoch,status FROM venue_ownership WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND resource_id=${resourceId}`;
  return rows.length===1&&rows[0].owner_device_id===deviceId&&Boolean(deviceEpoch)&&rows[0].owner_device_epoch===deviceEpoch&&Number(rows[0].epoch)===epoch&&rows[0].status==='active';
 });
}
export async function acquireInitialOwnership(scope:TenantScope,resourceId:string,deviceId:string) {
 return withTenant(scope,async sql=>{
  const [enrolled]=await sql`SELECT device_epoch FROM device_enrollment WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND device_id=${deviceId} AND status='active'`;if(!enrolled)throw new Error('UNENROLLED_DEVICE');
  await sql`INSERT INTO venue_ownership(organization_id,venue_id,resource_id,status) VALUES(${scope.organizationId},${scope.venueId},${resourceId},'unassigned') ON CONFLICT DO NOTHING`;
  const [current]=await sql`SELECT owner_device_id,owner_device_epoch,epoch,status FROM venue_ownership WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND resource_id=${resourceId} FOR UPDATE`;
  if(!mayAcquireOwner({owner:current.owner_device_id,status:current.status}))throw new Error('HANDOFF_REQUIRED');
  await sql`UPDATE venue_ownership SET owner_device_id=${deviceId},owner_device_epoch=${enrolled.device_epoch},status='active' WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND resource_id=${resourceId}`;
  return {owner:deviceId,epoch:Number(current.epoch),status:'active'};
 });
}
export async function initializeVenueOwner(actor:import('../identity/rbac').Actor,scope:TenantScope,deviceId:string){
 const {requirePermission}=await import('../identity/rbac');requirePermission(actor,'device.enroll',scope);requirePermission(actor,'continuity.resolve',scope);
 return withTenant(scope,async sql=>{
  await sql`SELECT pg_advisory_xact_lock(hashtext(${JSON.stringify([scope.organizationId,scope.venueId,'owner-initialize'])}))`;
  const [device]=await sql`SELECT device_epoch FROM device_enrollment WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND device_id=${deviceId} AND status='active'`;
  if(!device)throw new Error('UNENROLLED_DEVICE');
  const [owner]=await sql`SELECT status FROM venue_ownership WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND resource_id='coordinator' FOR UPDATE`;
  if(owner)throw new Error('HANDOFF_REQUIRED');
  const [authority]=await sql`SELECT coordinator_epoch FROM authority WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId}`;
  if(authority&&Number(authority.coordinator_epoch)!==1)throw new Error('HANDOFF_REQUIRED');
  await sql`INSERT INTO venue_ownership(organization_id,venue_id,resource_id,owner_device_id,owner_device_epoch,epoch,status) VALUES(${scope.organizationId},${scope.venueId},'coordinator',${deviceId},${device.device_epoch},1,'active')`;
  await sql`INSERT INTO authority(organization_id,venue_id,coordinator_epoch,policy_revision) VALUES(${scope.organizationId},${scope.venueId},1,1) ON CONFLICT DO NOTHING`;
  return {ownerDeviceId:deviceId,ownerDeviceEpoch:device.device_epoch,coordinatorEpoch:1};
 });
}
