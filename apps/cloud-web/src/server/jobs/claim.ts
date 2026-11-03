import {withTenant,type TenantScope} from '../modules/identity/tenant-context';
export async function claimJobs(scope:TenantScope,workerId:string,limit=20,nowMs?:number){
 if(limit<1||limit>20)throw new Error('INVALID_JOB_LIMIT');
 // due_at is stamped by the database, so without a caller clock (tests inject one) every comparison uses the database clock too: app/db skew must not hide a fresh job.
 return withTenant(scope,async sql=>{const at=nowMs===undefined?sql`now()`:sql`${new Date(nowMs)}::timestamptz`;return sql`WITH due AS (
  SELECT id,status FROM cloud_job WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId}
  AND due_at<=${at} AND (status='pending' OR (status IN('leased','sending','unknown') AND lease_until<=${at}))
  ORDER BY due_at,id FOR UPDATE SKIP LOCKED LIMIT ${limit}
 ) UPDATE cloud_job j SET status='leased',lease_owner=${workerId},lease_until=${at}+interval '30 seconds',attempts=j.attempts+1
 FROM due WHERE j.organization_id=${scope.organizationId} AND j.venue_id=${scope.venueId} AND j.id=due.id
 RETURNING j.id,j.type,j.payload,j.attempts,due.status AS previous_status`;});
}
