import type {JsonObject,Snapshot} from '../../../../../../packages/contracts/src/index';
import {accountingCsv,accountingLines} from '../../../../../../integrations/accounting/src/export';
import {isBusinessDate,venueZone,CLOUD_STALE_AFTER_MS} from '../../../../../../packages/domain/src/reporting/report';
import {requirePermission,type Actor} from '../identity/rbac';
import {withTenant,type TenantScope} from '../identity/tenant-context';
/** Accounting lines of one business date from what the venue has synced, with the same freshness verdict as every other report: an export from a lagging venue says it is incomplete. */
export async function exportAccounting(actor:Actor,scope:TenantScope,businessDate:string){
 requirePermission(actor,'report.read',scope);
 if(!isBusinessDate(businessDate))throw new Error('INVALID_BUSINESS_DATE');
 return withTenant(scope,async sql=>{
  const rows=await sql`SELECT aggregate_type,aggregate_id,version,state FROM sync_projection WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND aggregate_type IN('bill','invoice-request','venue-layout')`;
  const [inbox]=await sql`SELECT max(received_at) FILTER (WHERE status='applied') AS applied_at,count(*) FILTER (WHERE status<>'applied')::int AS backlog FROM sync_inbox WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId}`;
  const snapshots=rows.map(r=>({ref:{...scope,kind:String(r.aggregate_type),id:String(r.aggregate_id)},version:Number(r.version),state:r.state as JsonObject})) as Snapshot[];
  const zone=venueZone(snapshots),appliedAt=inbox?.applied_at?new Date(inbox.applied_at as string).getTime():null;
  const complete=appliedAt!==null&&Number(inbox?.backlog??0)===0&&Date.now()-appliedAt<=CLOUD_STALE_AFTER_MS;
  const lines=accountingLines(snapshots,businessDate,zone.timeZone);
  return {lines,csv:accountingCsv(lines,{venueId:scope.venueId,businessDate,asOf:new Date().toISOString(),complete}),timeZone:zone.timeZone,timeZoneAssumed:zone.assumed,complete};
 });
}
