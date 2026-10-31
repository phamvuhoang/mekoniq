import {createHash} from 'node:crypto';
import {supabaseServer} from '../../supabase/server';
import {cloudDatabase,type CloudSql} from './tenant-context';
import {rolePermissions,type Actor} from './rbac';
export function cookieValue(request:Request,name:string){
 const cookie=request.headers.get('cookie')??'';
 for(const part of cookie.split(';')){const [key,...value]=part.trim().split('=');if(key===name)return decodeURIComponent(value.join('='));}
 return undefined;
}
export function tokenHash(token:string){return createHash('sha256').update(token).digest('hex');}
export async function actorFromToken(token:string):Promise<Actor|null> {
 const client=supabaseServer();
 const {data,error}=await client.auth.getUser(token);
 if(error||!data.user)return null;
 const revoked=await cloudDatabase()`SELECT token_hash FROM session_revocation WHERE token_hash=${tokenHash(token)} AND expires_at>now()`;
 if(revoked.length)return null;
 const membership=await cloudDatabase().begin(async transaction=>{
  const sql=transaction as unknown as CloudSql;
  await sql`SELECT set_config('app.actor_id',${data.user.id},true)`;
  return sql`SELECT * FROM actor_memberships(${data.user.id}::uuid)`;
 });
 if(!membership.length)return null;
 const organizationId=membership[0].organization_id as string;
 // An active organization must be selected before mixing memberships from another org.
 const own=membership.filter(m=>m.organization_id===organizationId);
 const permissions=[...new Set(own.flatMap(m=>rolePermissions(m.role)))];
 const stationIdsByVenue=Object.fromEntries(own.map(m=>[m.venue_id,Array.isArray(m.station_ids)?m.station_ids.filter((id:unknown):id is string=>typeof id==='string'):[]]));
 const permissionsByVenue=Object.fromEntries(own.map(m=>[m.venue_id,rolePermissions(m.role)]));
 return {id:data.user.id,organizationId,venueIds:own.map(m=>m.venue_id as string),role:own[0].role,permissions,permissionsByVenue,stationIdsByVenue};
}
export async function resolveActor(request:Request):Promise<Actor|null>{
 const authorization=request.headers.get('authorization');
 const token=authorization?.startsWith('Bearer ')?authorization.slice(7):cookieValue(request,'mekoniq_access');
 if(!token)return null;
 try{return await actorFromToken(token);}catch{return null;}
}
export function csrfAllowed(request:Request){
 const origin=request.headers.get('origin');
 if(!origin)return request.headers.has('authorization');
 try{const source=new URL(origin),target=new URL(request.url);const host=request.headers.get('host')??target.host;return source.protocol===target.protocol&&source.host===host;}catch{return false;}
}
