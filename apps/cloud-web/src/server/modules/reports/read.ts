import type {Actor} from '../identity/rbac';
import {requirePermission} from '../identity/rbac';
import {withTenant,type TenantScope} from '../identity/tenant-context';
import type {JsonObject,Snapshot} from '../../../../../../packages/contracts/src/index';
import {buildReport,isBusinessDate,venueTimeZone,REPORT_KINDS,REPORT_SOURCE_KINDS} from '../../../../../../packages/domain/src/reporting/report';
/**
 * GET /v1/reports/{sales|shifts|robot-kpi}: the same pure reports the tablet computes offline, over the cloud's accepted-fact projection.
 * Watermark: the newest applied sync entry and the backlog not yet applied (pending/quarantined), so a lagging projection reads as stale, an empty one as unsynced.
 * ponytail: recomputed per request over the venue's projection rows; add a checkpointed materialized table when a venue's history makes this slow.
 */
export async function readReport(actor:Actor,scope:TenantScope,kind:string,businessDate:string):Promise<JsonObject> {
 requirePermission(actor,'report.read',scope);
 if(!(REPORT_KINDS as readonly string[]).includes(kind))throw new Error('REPORT_NOT_FOUND');
 if(!isBusinessDate(businessDate))throw new Error('INVALID_BUSINESS_DATE');
 return withTenant(scope,async sql=>{
  const rows=await sql`SELECT aggregate_type,aggregate_id,version,state FROM sync_projection WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND aggregate_type IN ${sql(REPORT_SOURCE_KINDS)}`;
  const [inbox]=await sql`SELECT max(received_at) FILTER (WHERE status='applied') AS applied_at,count(*) FILTER (WHERE status<>'applied')::int AS backlog FROM sync_inbox WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId}`;
  const snapshots=rows.map(r=>({ref:{...scope,kind:String(r.aggregate_type),id:String(r.aggregate_id)},version:Number(r.version),state:r.state as JsonObject})) as Snapshot[];
  const appliedAt=inbox?.applied_at?new Date(inbox.applied_at as string).toISOString():null;
  return buildReport(kind,snapshots,{businessDate,timeZone:venueTimeZone(snapshots),watermark:{source:'cloud-projection',asOf:new Date().toISOString(),appliedAt,pending:Number(inbox?.backlog??0)}});
 });
}
