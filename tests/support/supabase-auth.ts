import {randomUUID} from 'node:crypto';
import {supabaseAdmin} from '../../apps/cloud-web/src/server/supabase/admin';
import {supabaseServer} from '../../apps/cloud-web/src/server/supabase/server';
import type {CloudSql} from '../../apps/cloud-web/src/server/modules/identity/tenant-context';
export async function createSupabaseActor(admin:CloudSql,scope:{organizationId:string;venueId:string},role='owner'){
 const email=`mekoniq-${randomUUID()}@example.test`;const password=randomUUID()+'Aa9!';
 const client=supabaseAdmin();const {data,error}=await client.auth.admin.createUser({email,password,email_confirm:true});if(error||!data.user)throw new Error('TEST_USER_CREATE_FAILED');
 await admin`INSERT INTO venue(organization_id,id,name) VALUES(${scope.organizationId},${scope.venueId},'Auth fixture') ON CONFLICT DO NOTHING`;
 await admin`INSERT INTO venue_membership(user_id,organization_id,venue_id,role) VALUES(${data.user.id}::uuid,${scope.organizationId},${scope.venueId},${role})`;
 const session=await supabaseServer().auth.signInWithPassword({email,password});if(session.error||!session.data.session)throw new Error('TEST_SIGN_IN_FAILED');
 return {id:data.user.id,email,password,accessToken:session.data.session.access_token,refreshToken:session.data.session.refresh_token,async cleanup(){await client.auth.admin.deleteUser(data.user!.id);}};
}
