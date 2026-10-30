import {withTenant,type TenantScope} from '../modules/identity/tenant-context';
export async function claimJobs(scope:TenantScope,workerId:string,limit=20,nowMs=Date.now()){
 if(limit<1||limit>20)throw new Error('INVALID_JOB_LIMIT');
 return withTenant(scope,async sql=>sql`WITH due AS (
  SELECT id,status FROM cloud_job WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId}
  AND due_at<=${new Date(nowMs)} AND (status='pending' OR (status IN('leased','sending','unknown') AND lease_until<=${new Date(nowMs)}))
  ORDER BY due_at,id FOR UPDATE SKIP LOCKED LIMIT ${limit}
 ) UPDATE cloud_job j SET status='leased',lease_owner=${workerId},lease_until=${new Date(nowMs+30000)},attempts=j.attempts+1
 FROM due WHERE j.organization_id=${scope.organizationId} AND j.venue_id=${scope.venueId} AND j.id=due.id
 RETURNING j.id,j.type,j.payload,j.attempts,due.status AS previous_status`);
}
