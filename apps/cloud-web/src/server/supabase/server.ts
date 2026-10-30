import {createClient} from '@supabase/supabase-js';
export function supabaseServer(accessToken?:string) {
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
 const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 if(!url||!key)throw new Error('SUPABASE_PUBLIC_CONFIGURATION_REQUIRED');
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
   global:accessToken?{headers:{Authorization:`Bearer ${accessToken}`}}:undefined});
}
