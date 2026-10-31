import {randomUUID,createHmac,timingSafeEqual} from 'node:crypto';
import {cloudDatabase,withTenant,type TenantScope} from '../modules/identity/tenant-context';
import {claimJobs} from './claim';
import {defaultJobRegistry,type JobRegistry,type JobResult} from './registry';
export async function runJobBatch(scope:TenantScope,registry:JobRegistry=defaultJobRegistry(),options:{now?:()=>number;budgetMs?:number}={}){
 const now=options.now??Date.now;const budgetMs=Math.min(options.budgetMs??20000,20000);const started=now();const workerId=randomUUID();
 const jobs=await claimJobs(scope,workerId,20,started);let processed=0;
 for(const job of jobs){
  const remaining=budgetMs-(now()-started);if(remaining<=0)break;
  const handler=registry.get(job.type);let result:JobResult;
  if(!handler)result={status:'failed',value:{code:'UNREGISTERED_HANDLER'}};
  else {
   await withTenant(scope,sql=>sql`UPDATE cloud_job SET status='sending' WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND id=${job.id} AND lease_owner=${workerId}`);
   const context={scope,id:job.id as string,payload:job.payload,signal:AbortSignal.timeout(Math.max(1,remaining))};
   try {
    // Any recovered lease may have performed its external side effect before dying.
    const action=job.previous_status==='pending'?handler.execute(context):handler.reconcile(context);
    result=await Promise.race([action,new Promise<JobResult>(resolve=>{const timer=setTimeout(()=>resolve({status:'unknown',value:{code:'DEADLINE'}}),remaining);timer.unref();})]);
   }catch(error){result={status:'unknown',value:{code:error instanceof Error?error.message:'EXECUTION_UNKNOWN'}};}
  }
  await withTenant(scope,sql=>sql`UPDATE cloud_job SET status=${result.status==='failed'?(job.attempts>=5?'dead_letter':'pending'):result.status},result=${sql.json(result.value)},lease_until=${new Date(now()+30000)},due_at=${new Date(now()+Math.min(300000,1000*2**Math.min(Number(job.attempts),8)))} WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND id=${job.id} AND lease_owner=${workerId}`);
  processed++;
 }
 return {claimed:jobs.length,processed,elapsedMs:now()-started};
}
export function jobSignature(secret:string,timestamp:string,nonce:string,body:string){return createHmac('sha256',secret).update(`${timestamp}.${nonce}.${body}`).digest('hex');}
export async function authorizeJobRequest(request:Request,body:string,nowMs=Date.now()){
 const secret=process.env.JOB_HMAC_SECRET;if(!secret||secret.length<32)return false;
 const timestamp=request.headers.get('x-job-timestamp')??'';const nonce=request.headers.get('x-job-nonce')??'';const signature=request.headers.get('x-job-signature')??'';
 if(!/^[0-9]{13}$/.test(timestamp)||Math.abs(Number(timestamp)-nowMs)>60000||!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)||!/^[a-f0-9]{64}$/.test(signature))return false;
 const expected=jobSignature(secret,timestamp,nonce,body);if(!timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(expected,'hex')))return false;
 await cloudDatabase()`DELETE FROM job_request_nonce WHERE expires_at<now()`;
 const rows=await cloudDatabase()`INSERT INTO job_request_nonce(nonce,expires_at) VALUES(${nonce},${new Date(nowMs+120000)}) ON CONFLICT DO NOTHING RETURNING nonce`;
 return rows.length===1;
}
