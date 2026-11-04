import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import postgres from 'postgres';
import {closeCloudDatabase} from '../../apps/cloud-web/src/server/modules/identity/tenant-context';
export async function setupWave02() {
 // MEKONIQ_TEST_DB lets the restore rehearsals point the whole cloud stack at a scratch database on the same local server; it defaults to the normal one.
 const database=process.env.MEKONIQ_TEST_DB??'postgres';
 const url=process.env.DATABASE_ADMIN_URL??`postgresql://postgres:postgres@127.0.0.1:57422/${database}`;
 const parsed=new URL(url);if(!['127.0.0.1','localhost'].includes(parsed.hostname)||parsed.port!=='57422')throw new Error('TEST_DATABASE_NOT_LOCAL_MEKONIQ');
 const admin=postgres(url,{max:1,prepare:false,connect_timeout:3,connection:{application_name:'mekoniq-wave02-tests'}});
 try {
 await admin`SELECT 1`;
 const version=await admin`SHOW server_version_num`;if(Number(version[0].server_version_num)<170000||Number(version[0].server_version_num)>=180000)throw new Error('POSTGRES_17_REQUIRED');
 const [role]=await admin`SELECT rolcanlogin FROM pg_roles WHERE rolname='mekoniq_app'`;
 if(!role?.rolcanlogin)await admin.unsafe("ALTER ROLE mekoniq_app LOGIN PASSWORD 'local_test_only'");
 const migrations=['20261030000200_identity_rls.sql','20261030000300_device_ownership.sql','20261030000400_sync.sql','20261030000500_jobs_realtime.sql','20261030000600_storage_usage.sql'];
 for(const filename of migrations){
  const migration=readFileSync(`supabase/migrations/${filename}`,'utf8');
  const exists=await admin`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=${{ '20261030000200_identity_rls.sql':'venue','20261030000300_device_ownership.sql':'device_enrollment','20261030000400_sync.sql':'sync_inbox','20261030000500_jobs_realtime.sql':'cloud_job','20261030000600_storage_usage.sql':'asset_manifest'}[filename]??''}`;
  if(!exists.length)await admin.unsafe(migration);
 }
 const [storageUpgrade]=await admin`SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_manifest'::regclass AND conname='asset_manifest_status_check' AND pg_get_constraintdef(oid) LIKE '%collected%') AS applied`;
 if(!storageUpgrade.applied)await admin.begin(sql=>sql.unsafe(readFileSync('supabase/migrations/20261031000100_cloud_storage_reservations.sql','utf8')));
 // Later waves add tables; each migration is applied once, detected by the table it creates.
 for(const [filename,table] of [['20261104000100_chain_rollout.sql','chain_revision'],['20261104000200_chain_shared_balance.sql','chain_shared_balance'],['20261104000300_external_orders.sql','external_order'],['20261104000400_payment_intents.sql','payment_intent'],['20261104000500_invoice_requests.sql','invoice_request'],['20261104000600_external_order_cancel.sql','external_order.cancel_status']] as const){
  // `table` detects a new table; `table.column` detects a column added to an existing one
  const [t,column]=table.split('.');
  const exists=column?await admin`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=${t!} AND column_name=${column}`:await admin`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=${t!}`;
  if(!exists.length)await admin.begin(sql=>sql.unsafe(readFileSync(`supabase/migrations/${filename}`,'utf8')));
 }
 process.env.DATABASE_URL=`postgresql://mekoniq_app:local_test_only@127.0.0.1:57422/${database}`;
 if(!process.env.SUPABASE_SERVICE_ROLE_KEY){
  let status;try{status=JSON.parse(execFileSync('pnpm',['exec','supabase','status','--output','json'],{encoding:'utf8',timeout:15000,stdio:['ignore','pipe','ignore']}));}catch{throw new Error('LOCAL_SUPABASE_STATUS_UNAVAILABLE');}
  process.env.NEXT_PUBLIC_SUPABASE_URL=status.API_URL;process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=status.ANON_KEY;process.env.SUPABASE_SERVICE_ROLE_KEY=status.SERVICE_ROLE_KEY;
 }
 return {admin,async close(){await closeCloudDatabase();await admin.end({timeout:1});}};
 }catch(error){await admin.end({timeout:1});throw error;}
}
