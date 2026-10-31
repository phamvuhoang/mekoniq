import {beforeAll,afterAll,expect,test} from 'vitest';
import {randomUUID} from 'node:crypto';
import {setupWave02} from '../support/wave02-db';
import {createSupabaseActor} from '../support/supabase-auth';
import {startCloud} from '../support/cloud-server';
import {actorFromToken} from '../../apps/cloud-web/src/server/modules/identity/session';
import {withTenant,cloudDatabase} from '../../apps/cloud-web/src/server/modules/identity/tenant-context';
let db:Awaited<ReturnType<typeof setupWave02>>,a:Awaited<ReturnType<typeof createSupabaseActor>>,b:Awaited<ReturnType<typeof createSupabaseActor>>,api:Awaited<ReturnType<typeof startCloud>>;
const scopeA={organizationId:'auth-a-'+randomUUID(),venueId:'venue-a'},scopeB={organizationId:'auth-b-'+randomUUID(),venueId:'venue-b'};
beforeAll(async()=>{db=await setupWave02();a=await createSupabaseActor(db.admin,scopeA);b=await createSupabaseActor(db.admin,scopeB);api=await startCloud({databaseUrl:process.env.DATABASE_URL!,port:0});});
afterAll(async()=>{if(api)await api.close();if(a)await a.cleanup();if(b)await b.cleanup();if(db)await db.close();});
test('tenant scope cannot escape a signed session via HTTP or pooled DB role',async()=>{
 const response=await fetch(api.url+'/v1/venues/venue-b/orders',{headers:{Authorization:`Bearer ${a.accessToken}`}});expect(response.status).toBe(403);
 const own=await withTenant(scopeA,sql=>sql`SELECT id FROM venue ORDER BY id`);expect(own.map(v=>v.id)).toEqual(['venue-a']);
 const second=await withTenant(scopeB,sql=>sql`SELECT id FROM venue ORDER BY id`);expect(second.map(v=>v.id)).toEqual(['venue-b']);
 const none=await cloudDatabase()`SELECT id FROM venue`;expect(none).toHaveLength(0);
 const [role]=await db.admin`SELECT rolbypassrls,rolsuper FROM pg_roles WHERE rolname='mekoniq_app'`;expect(role.rolbypassrls).toBe(false);expect(role.rolsuper).toBe(false);
});
test('forged role and tenant payload cannot authorize scoped upload',async()=>{
 const response=await fetch(api.url+'/v1/assets/uploads',{method:'POST',headers:{Authorization:`Bearer ${a.accessToken}`,'Content-Type':'application/json'},body:JSON.stringify({venueId:'venue-b',role:'owner',organizationId:scopeB.organizationId,kind:'menu_image',bytes:8,mime:'image/png'})});expect(response.status).toBe(403);
 const invalid=await fetch(api.url+'/v1/venues/venue-a/orders',{headers:{Authorization:`Bearer ${a.accessToken.slice(0,-8)}forged`}});expect(invalid.status).toBe(401);
});
test('login is CSRF-protected and current membership revocation takes effect',async()=>{
 const badOrigin=await fetch(api.url+'/v1/auth/login',{method:'POST',headers:{Origin:'https://attacker.invalid','Content-Type':'application/json'},body:JSON.stringify({email:a.email,password:a.password})});expect(badOrigin.status).toBe(403);
 expect(await actorFromToken(b.accessToken)).not.toBeNull();
 await db.admin`UPDATE venue_membership SET active=false WHERE user_id=${b.id}::uuid`;expect(await actorFromToken(b.accessToken)).toBeNull();
});
test('login issues HttpOnly cookies; logout revokes the provider refresh session',async()=>{
 const user=await createSupabaseActor(db.admin,scopeA);
 try{
  const login=await fetch(api.url+'/v1/auth/login',{method:'POST',headers:{Origin:api.url,'Content-Type':'application/json'},body:JSON.stringify({email:user.email,password:user.password})});expect(login.status).toBe(200);
  const cookies=login.headers.getSetCookie();expect(cookies.every(c=>c.includes('HttpOnly')&&c.includes('SameSite=Strict'))).toBe(true);expect(cookies).toHaveLength(2);
  const logout=await fetch(api.url+'/v1/auth/logout',{method:'POST',headers:{Authorization:`Bearer ${user.accessToken}`}});expect(logout.status).toBe(200);expect(await actorFromToken(user.accessToken)).toBeNull();
 }finally{await user.cleanup();}
});
import {authorize} from '../../apps/cloud-web/src/server/modules/identity/rbac';
test('a manager in one venue cannot inherit that role at a second venue',async()=>{
 const user=await createSupabaseActor(db.admin,scopeA,'manager');
 try{
  await db.admin`INSERT INTO venue(organization_id,id,name) VALUES(${scopeA.organizationId},'venue-other','Other venue') ON CONFLICT DO NOTHING`;
  await db.admin`INSERT INTO venue_membership(user_id,organization_id,venue_id,role) VALUES(${user.id}::uuid,${scopeA.organizationId},'venue-other','chef')`;
  const actor=await actorFromToken(user.accessToken);expect(actor).not.toBeNull();
  expect(authorize(actor,'configuration.publish',scopeA).ok).toBe(true);
  expect(authorize(actor,'configuration.publish',{...scopeA,venueId:'venue-other'}).ok).toBe(false);
  const response=await fetch(api.url+'/v1/venues/venue-other/configuration',{method:'POST',headers:{Authorization:`Bearer ${user.accessToken}`,'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:0,features:{}})});expect(response.status).toBe(403);
 }finally{await user.cleanup();}
});
test('HTTP order reads use applied sync projections, not an empty coordinator snapshot table',async()=>{
 await db.admin`INSERT INTO sync_projection(organization_id,venue_id,aggregate_type,aggregate_id,version,state,entry_id) VALUES(${scopeA.organizationId},${scopeA.venueId},'order','cloud-order-1',1,'{"status":"accepted","totalMinor":"50000"}','order-read-proof')`;
 const response=await fetch(api.url+'/v1/venues/venue-a/orders',{headers:{Authorization:`Bearer ${a.accessToken}`}});expect(response.status).toBe(200);const body=await response.json();expect(body.orders).toEqual([{id:'cloud-order-1',version:1,state:{status:'accepted',totalMinor:'50000'}}]);
});
