import {withTenant,type TenantScope} from '../identity/tenant-context';
export async function recordUsage(scope:TenantScope,input:{metric:string;used:string|null;source:string;estimate:boolean}){
 if(input.used!==null&&!/^(0|[1-9][0-9]*)$/.test(input.used))throw new Error('INVALID_USAGE');
 return withTenant(scope,sql=>sql`INSERT INTO cloud_usage(organization_id,venue_id,metric,used,source,is_estimate) VALUES(${scope.organizationId},${scope.venueId},${input.metric},${input.used},${input.source},${input.estimate})
 ON CONFLICT(organization_id,venue_id,metric) DO UPDATE SET used=EXCLUDED.used,source=EXCLUDED.source,is_estimate=EXCLUDED.is_estimate,measured_at=now()`);
}
