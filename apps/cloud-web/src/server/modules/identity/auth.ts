import {createHash} from 'node:crypto';
import {supabaseServer} from '../../supabase/server';
import {cloudDatabase} from './tenant-context';
import {cookieValue,csrfAllowed,tokenHash} from './session';
function cookie(name:string,value:string,maxAge:number,secure:boolean){return `${name}=${encodeURIComponent(value)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAge}${secure?'; Secure':''}`;}
export async function login(request:Request,body:unknown) {
 if(!csrfAllowed(request))return Response.json({code:'CSRF_DENIED'},{status:403});
 if(!body||typeof body!=='object')return Response.json({code:'INVALID_LOGIN'},{status:400});
 const {email,password}=body as Record<string,unknown>;
 if(typeof email!=='string'||typeof password!=='string'||email.length>254||password.length>512)return Response.json({code:'INVALID_LOGIN'},{status:400});
 const address=request.headers.get('x-forwarded-for')?.split(',')[0]??'local';
 const throttleKey=createHash('sha256').update(`${address}:${email.toLowerCase()}`).digest('hex');
 const rows=await cloudDatabase()`INSERT INTO auth_throttle(key_hash,window_start,attempts) VALUES(${throttleKey},now(),1)
 ON CONFLICT(key_hash) DO UPDATE SET attempts=CASE WHEN auth_throttle.window_start<now()-interval '5 minutes' THEN 1 ELSE auth_throttle.attempts+1 END,
 window_start=CASE WHEN auth_throttle.window_start<now()-interval '5 minutes' THEN now() ELSE auth_throttle.window_start END RETURNING attempts`;
 if(rows[0].attempts>10)return Response.json({code:'RATE_LIMITED'},{status:429});
 const {data,error}=await supabaseServer().auth.signInWithPassword({email,password});
 if(error||!data.session)return Response.json({code:'INVALID_CREDENTIALS'},{status:401});
 const response=Response.json({expiresAt:data.session.expires_at},{headers:{'Cache-Control':'no-store'}});
 const secure=new URL(request.url).protocol==='https:';
 response.headers.append('Set-Cookie',cookie('mekoniq_access',data.session.access_token,data.session.expires_in,secure));
 response.headers.append('Set-Cookie',cookie('mekoniq_refresh',data.session.refresh_token,86400,secure));
 return response;
}
export async function refresh(request:Request) {
 if(!csrfAllowed(request))return Response.json({code:'CSRF_DENIED'},{status:403});
 const refreshToken=cookieValue(request,'mekoniq_refresh');if(!refreshToken)return Response.json({code:'UNAUTHENTICATED'},{status:401});
 const {data,error}=await supabaseServer().auth.refreshSession({refresh_token:refreshToken});
 if(error||!data.session)return Response.json({code:'UNAUTHENTICATED'},{status:401});
 const response=Response.json({expiresAt:data.session.expires_at});const secure=new URL(request.url).protocol==='https:';
 response.headers.append('Set-Cookie',cookie('mekoniq_access',data.session.access_token,data.session.expires_in,secure));
 response.headers.append('Set-Cookie',cookie('mekoniq_refresh',data.session.refresh_token,86400,secure));
 return response;
}
export async function logout(request:Request) {
 if(!csrfAllowed(request))return Response.json({code:'CSRF_DENIED'},{status:403});
 const token=request.headers.get('authorization')?.slice(7)??cookieValue(request,'mekoniq_access');
 if(token){
  const result=await supabaseServer().auth.admin.signOut(token,'local');
  if(result.error)throw new Error('AUTH_SIGN_OUT_UNAVAILABLE');
  // Locally reject this access token immediately, including its remaining JWT lifetime.
  await cloudDatabase()`INSERT INTO session_revocation(token_hash,expires_at) VALUES(${tokenHash(token)},now()+interval '24 hours') ON CONFLICT DO NOTHING`;
 }
 const response=Response.json({signedOut:true});const secure=new URL(request.url).protocol==='https:';
 response.headers.append('Set-Cookie',cookie('mekoniq_access','',0,secure));response.headers.append('Set-Cookie',cookie('mekoniq_refresh','',0,secure));return response;
}
