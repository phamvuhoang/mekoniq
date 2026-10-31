import {createClient} from '@supabase/supabase-js';
// Backend-only service client. Never import into a client component or tablet bundle.
export function supabaseAdmin(signal?:AbortSignal) {
 if(typeof window!=='undefined')throw new Error('SERVER_ONLY');
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw new Error('SUPABASE_ADMIN_CONFIGURATION_REQUIRED');
 return createClient(url,key,{global:signal?{fetch:(input,init)=>fetch(input,{...init,signal})}:undefined,auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
}
