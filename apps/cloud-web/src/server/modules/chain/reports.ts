import type {JsonObject} from '../../../../../../packages/contracts/generated/wire';
import {csvCell,isBusinessDate} from '../../../../../../packages/domain/src/reporting/report';
import {authorize,requirePermission,type Actor} from '../identity/rbac';
import {withTenant} from '../identity/tenant-context';
import {readReport} from '../reports/read';
export const CHAIN_REPORT_KINDS=['chain-sales'] as const;
const SUM_KEYS=['grossMinor','discountMinor','returnsMinor','netMinor','serviceMinor','taxMinor','salesTotalMinor','feesMinor','unappliedMinor'] as const;
type VenueLine={venueId:string;status:string;statusReason:string|null;timeZone:string|null;timeZoneAssumed:boolean;currency:string|null;lagMs:number|null;pending:number;appliedAt:string|null;totals:Record<string,string>|null;unreconciledMinor:string|null};
/**
 * Chain-wide sales for one business date: the SAME per-venue report each branch sees (applied facts only), side by side with its own freshness. A branch with no applied data is listed
 * in `incompleteVenueIds` with null figures and left out of the totals — a missing branch is never a zero. Branches the actor has no `report.read` for are not even named (scope is never widened).
 * The business date is each venue's own local date; the consolidated figure sums those local days (basis `venue-local`).
 */
export async function chainReport(actor:Actor,organizationId:string,kind:string,businessDate:string,requested?:string[]):Promise<JsonObject>{
 if(!(CHAIN_REPORT_KINDS as readonly string[]).includes(kind))throw new Error('REPORT_NOT_FOUND');
 if(!isBusinessDate(businessDate))throw new Error('INVALID_BUSINESS_DATE');
 let venues:string[];
 if(requested){if(!requested.length||requested.length>200)throw new Error('INVALID_VENUES');for(const v of requested)requirePermission(actor,'report.read',{organizationId,venueId:v});venues=[...new Set(requested)];}
 else venues=actor.venueIds.filter(v=>authorize(actor,'report.read',{organizationId,venueId:v}).ok);
 if(!venues.length)throw new Error('PERMISSION_DENIED');
 const lines:VenueLine[]=[],asOf=Date.now();
 for(const venueId of venues.sort()){
  const scope={organizationId,venueId},report=await readReport(actor,scope,'sales',businessDate),w=report.watermark as JsonObject;
  const currency=await withTenant(scope,async sql=>{const [c]=await sql`SELECT state->>'currency' AS currency FROM sync_projection WHERE organization_id=${organizationId} AND venue_id=${venueId} AND aggregate_type='catalog' AND aggregate_id='current'`;return (c?.currency as string|undefined)??null;});
  const totals=report.totals as Record<string,string>|null,appliedAt=(w.appliedAt as string|null)??null;
  lines.push({venueId,status:String(report.status),statusReason:(report.statusReason as string|null)??null,timeZone:report.timeZone as string,timeZoneAssumed:report.timeZoneAssumed===true,currency,lagMs:appliedAt?Math.max(0,asOf-Date.parse(appliedAt)):null,pending:Number(w.pending??0),appliedAt,totals:report.status==='unsynced'?null:totals,
   unreconciledMinor:report.status==='unsynced'?null:String(((report.reconciliation as JsonObject|null)?.differenceMinor)??'0')});
 }
 const byCurrency:Record<string,Record<string,string>>={},included:string[]=[],incomplete:string[]=[],noCurrency:string[]=[];
 for(const l of lines){
  if(l.status!=='current')incomplete.push(l.venueId);
  if(!l.totals)continue;
  if(!l.currency){noCurrency.push(l.venueId);if(!incomplete.includes(l.venueId))incomplete.push(l.venueId);continue;} // figures with no known currency are never added to another currency's total
  included.push(l.venueId);const sum=byCurrency[l.currency]??={};
  for(const key of SUM_KEYS)sum[key]=String(BigInt(sum[key]??'0')+BigInt(l.totals[key]??'0'));
 }
 return {kind,businessDate,businessDateBasis:'venue-local',consolidatedTimeZone:'UTC',asOf:new Date(asOf).toISOString(),venues:lines as unknown as JsonObject[],totalsByCurrency:byCurrency,includedVenueIds:included,incompleteVenueIds:incomplete,missingCurrencyVenueIds:noCurrency,complete:incomplete.length===0};
}
/** CSV carries the watermark: every line says how fresh its branch was, and the footer says whether the file is complete. */
export function chainReportCsv(report:JsonObject):string {
  const rows=[['venueId','status','statusReason','appliedAt','lagMs','pending','timeZone','currency',...SUM_KEYS,'unreconciledMinor']];
  for(const l of report.venues as unknown as VenueLine[])rows.push([l.venueId,l.status,l.statusReason??'',l.appliedAt??'',l.lagMs===null?'':String(l.lagMs),String(l.pending),l.timeZone??'',l.currency??'',...SUM_KEYS.map(k=>l.totals?.[k]??''),l.unreconciledMinor??'']);
  const note=[`# chain report ${String(report.kind)} ${String(report.businessDate)} (business date per venue's own time zone) as of ${String(report.asOf)}`,`# complete=${String(report.complete)} incomplete=${(report.incompleteVenueIds as string[]).join(' ')}`];
  return note.join('\n')+'\n'+rows.map(r=>r.map(csvCell).join(',')).join('\n')+'\n';
}
