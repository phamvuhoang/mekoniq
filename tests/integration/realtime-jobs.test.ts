import {beforeAll,afterAll,expect,test} from 'vitest';
import {randomUUID,randomBytes} from 'node:crypto';
import {setupWave02} from '../support/wave02-db';
import {withTenant} from '../../apps/cloud-web/src/server/modules/identity/tenant-context';
import {claimJobs} from '../../apps/cloud-web/src/server/jobs/claim';
import {JobRegistry} from '../../apps/cloud-web/src/server/jobs/registry';
import {runJobBatch,authorizeJobRequest,jobSignature} from '../../apps/cloud-web/src/server/jobs/outbox-worker';
import {publishHint} from '../../apps/cloud-web/src/server/modules/relay/subscriptions';
let db:Awaited<ReturnType<typeof setupWave02>>;const scope={organizationId:'jobs-org-'+randomUUID(),venueId:'venue-a'};
beforeAll(async()=>{db=await setupWave02();await db.admin`INSERT INTO venue(organization_id,id,name) VALUES(${scope.organizationId},${scope.venueId},'Jobs venue')`;});afterAll(async()=>{if(db)await db.close();});
test('two claimers never own the same lease',async()=>{
 await withTenant(scope,async sql=>{for(let i=0;i<3;i++)await sql`INSERT INTO cloud_job(organization_id,venue_id,id,type,payload) VALUES(${scope.organizationId},${scope.venueId},${'claim-'+i},'test.effect','{}')`;});
 const [a,b]=await Promise.all([claimJobs(scope,'worker-a'),claimJobs(scope,'worker-b')]);expect(a.length+b.length).toBe(3);expect(new Set([...a,...b].map(j=>j.id)).size).toBe(3);
});
test('expired sending lease reconciles instead of repeating execution',async()=>{
 await withTenant(scope,sql=>sql`INSERT INTO cloud_job(organization_id,venue_id,id,type,payload,status,lease_until,due_at) VALUES(${scope.organizationId},${scope.venueId},'unknown-effect','test.reconcile','{}','sending',now()-interval '1 minute',now()-interval '1 minute')`);
 let executions=0,reconciliations=0;const registry=new JobRegistry();registry.register('test.reconcile',{execute:async()=>{executions++;return {status:'confirmed',value:{}};},reconcile:async()=>{reconciliations++;return {status:'confirmed',value:{nativeReceipt:'existing'}};}});
 await runJobBatch(scope,registry);expect(executions).toBe(0);expect(reconciliations).toBe(1);
});
test('HMAC timestamp and nonce are verified durably',async()=>{
 process.env.JOB_HMAC_SECRET=randomBytes(32).toString('hex');const timestamp=String(Date.now()),nonce=randomBytes(24).toString('base64url'),body=JSON.stringify(scope);
 const signature=jobSignature(process.env.JOB_HMAC_SECRET,timestamp,nonce,body);const request=()=>new Request('http://127.0.0.1/internal/jobs/run',{method:'POST',headers:{'x-job-timestamp':timestamp,'x-job-nonce':nonce,'x-job-signature':signature},body});
 expect(await authorizeJobRequest(request(),body)).toBe(true);expect(await authorizeJobRequest(request(),body)).toBe(false);expect(await authorizeJobRequest(request(),body+' ')).toBe(false);
});
test('concurrent hint publishers coalesce at database boundary',async()=>{
 const outputs=await Promise.all([publishHint(scope,{ref:'journal',revision:1,watermark:'1'}),publishHint(scope,{ref:'journal',revision:2,watermark:'2'})]);
 expect(outputs.filter(o=>o.published)).toHaveLength(1);
});
import {createSupabaseActor} from '../support/supabase-auth';
import {supabaseServer} from '../../apps/cloud-web/src/server/supabase/server';
test('private Realtime permits venue membership and rejects foreign venue',async()=>{
 const user=await createSupabaseActor(db.admin,scope);const client=supabaseServer(user.accessToken);await client.realtime.setAuth(user.accessToken);
 const own=client.channel(`venue:${scope.organizationId}:${scope.venueId}`,{config:{private:true}});
 const foreign=client.channel('venue:foreign-organization:foreign-venue',{config:{private:true}});
 function subscribed(channel:typeof own){return new Promise<string>(resolve=>{const timeout=setTimeout(()=>resolve('TIMEOUT'),10000);channel.subscribe(status=>{if(status==='SUBSCRIBED'||status==='CHANNEL_ERROR'||status==='TIMED_OUT'){clearTimeout(timeout);resolve(status);}});});}
 try{expect(await subscribed(own)).toBe('SUBSCRIBED');expect(await subscribed(foreign)).toBe('CHANNEL_ERROR');}
 finally{await client.removeAllChannels();client.realtime.disconnect();await user.cleanup();}
});
test('Cron is installed once and does not require hosted secrets to start locally',async()=>{
 const rows=await db.admin`SELECT jobname,schedule FROM cron.job WHERE jobname='mekoniq-due-jobs'`;expect(rows.length).toBe(1);expect(rows[0].schedule).toBe('* * * * *');
 await db.admin`SELECT public.wake_due_jobs()`;
});
