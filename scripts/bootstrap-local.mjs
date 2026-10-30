import {execFileSync} from 'node:child_process';
import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {access,mkdir,writeFile,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import postgres from 'postgres';
import {createClient} from '@supabase/supabase-js';
if(process.argv.includes('--help')){
 console.log('Create a new dedicated LOCAL MEKONIQ venue/owner and server issuer. Run from source after pnpm supabase:start. Outputs are exclusive and secrets are not printed. Optional BOOTSTRAP_ORGANIZATION_ID, BOOTSTRAP_VENUE_ID, BOOTSTRAP_OWNER_EMAIL.');process.exit(0);
}
const root=resolve(new URL('..',import.meta.url).pathname),envPath=resolve(root,'apps/cloud-web/.env.local'),output=resolve(root,'.lab/bootstrap');
try{await access(envPath);throw new Error('LOCAL_ENV_ALREADY_EXISTS: preserve the existing file; configure a separate local workspace instead');}catch(error){if(error.code!=='ENOENT')throw error;}
let status;try{status=JSON.parse(execFileSync('pnpm',['exec','supabase','status','--output','json'],{cwd:root,encoding:'utf8',timeout:15000,stdio:['ignore','pipe','ignore']}));}catch{throw new Error('LOCAL_SUPABASE_STATUS_UNAVAILABLE');}
const dbUrl=new URL(status.DB_URL),apiUrl=new URL(status.API_URL);
if(dbUrl.hostname!=='127.0.0.1'||dbUrl.port!=='57422'||apiUrl.hostname!=='127.0.0.1'||apiUrl.port!=='57421')throw new Error('DEDICATED_LOCAL_MEKONIQ_PROJECT_REQUIRED');
const organizationId=process.env.BOOTSTRAP_ORGANIZATION_ID??'org-local',venueId=process.env.BOOTSTRAP_VENUE_ID??'venue-local',email=process.env.BOOTSTRAP_OWNER_EMAIL??'owner@mekoniq.local.test';
if(!/^[A-Za-z0-9_-]{1,128}$/.test(organizationId)||!/^[A-Za-z0-9_-]{1,128}$/.test(venueId)||!email.includes('@')||email.length>254)throw new Error('INVALID_BOOTSTRAP_INPUT');
const password=randomBytes(24).toString('base64url')+'Aa9!';const keys=generateKeyPairSync('ec',{namedCurve:'P-256'}),privateJwk=keys.privateKey.export({format:'jwk'}),publicJwk=keys.publicKey.export({format:'jwk'});
const admin=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}}),sql=postgres(status.DB_URL,{max:1,prepare:false,connect_timeout:3});
let createdUser,createdVenue=false;const written=[];
try{
 const [version]=await sql`SHOW server_version_num`;if(Number(version.server_version_num)<170000||Number(version.server_version_num)>=180000)throw new Error('POSTGRES_17_REQUIRED');
 const [tables]=await sql`SELECT to_regclass('public.venue') AS venue,to_regclass('public.authority') AS authority`;if(!tables.venue||!tables.authority)throw new Error('APPLY_LOCAL_MIGRATIONS_FIRST');
 const existing=await sql`SELECT id FROM venue WHERE organization_id=${organizationId} AND id=${venueId}`;if(existing.length)throw new Error('VENUE_ALREADY_EXISTS');
 const user=await admin.auth.admin.createUser({email,password,email_confirm:true});if(user.error||!user.data.user)throw new Error('LOCAL_OWNER_CREATE_FAILED');createdUser=user.data.user.id;
 await sql.begin(async tx=>{await tx`INSERT INTO venue(organization_id,id,name) VALUES(${organizationId},${venueId},'Local development venue')`;await tx`INSERT INTO venue_membership(user_id,organization_id,venue_id,role) VALUES(${createdUser}::uuid,${organizationId},${venueId},'owner')`;});createdVenue=true;
 await mkdir(output,{recursive:true,mode:0o700});
 const appUrl=new URL(status.DB_URL);appUrl.username='mekoniq_app';appUrl.password='local_test_only';
 const env=[`DATABASE_URL=${appUrl.toString()}`,`NEXT_PUBLIC_SUPABASE_URL=${status.API_URL}`,`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${status.ANON_KEY}`,`SUPABASE_SERVICE_ROLE_KEY=${status.SERVICE_ROLE_KEY}`,`DEVICE_GRANT_PRIVATE_KEY='${JSON.stringify(privateJwk)}'`,`JOB_HMAC_SECRET=${randomBytes(32).toString('hex')}`,''].join('\n');
 await writeFile(envPath,env,{flag:'wx',mode:0o600});written.push(envPath);
 const credentialPath=resolve(output,'owner-credentials.json');await writeFile(credentialPath,JSON.stringify({email,password,organizationId,venueId},null,2)+'\n',{flag:'wx',mode:0o600});written.push(credentialPath);
 const publicPath=resolve(output,'issuer-public.json');await writeFile(publicPath,JSON.stringify(publicJwk,null,2)+'\n',{flag:'wx',mode:0o600});written.push(publicPath);
 console.log('Local venue/owner created. Server environment: apps/cloud-web/.env.local. Credentials and managed-device issuer public key: .lab/bootstrap/. Secrets were not printed. Start pnpm dev:cloud, sign in, then enroll and explicitly initialize the fixed coordinator.');
}catch(error){
 for(const file of written.reverse())await unlink(file).catch(()=>{});
 if(createdUser)await admin.auth.admin.deleteUser(createdUser);
 if(createdVenue)await sql`DELETE FROM venue WHERE organization_id=${organizationId} AND id=${venueId}`;
 throw error;
}finally{await sql.end({timeout:1});}
