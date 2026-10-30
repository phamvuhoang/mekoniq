import postgres from 'postgres';
export type CloudSql = ReturnType<typeof postgres>;
export type CloudTransaction = CloudSql;
let database: CloudSql|undefined;
let databaseUrl:string|undefined;
export function cloudDatabase() {
  const url=process.env.DATABASE_URL;
  if(!url)throw new Error('DATABASE_URL_REQUIRED');
  if(database && databaseUrl!==url)throw new Error('DATABASE_URL_CHANGED_WITH_OPEN_POOL');
  if(!database){database=postgres(url,{max:1,prepare:false,connect_timeout:3,idle_timeout:10});databaseUrl=url;}
  return database;
}
export async function closeCloudDatabase(){if(database)await database.end({timeout:1});database=undefined;databaseUrl=undefined;}
export type TenantScope={organizationId:string;venueId:string};
export async function withTenant<T>(scope:TenantScope,work:(sql:CloudTransaction)=>Promise<T>):Promise<T> {
  if(!scope.organizationId||!scope.venueId)throw new Error('TENANT_SCOPE_REQUIRED');
  return cloudDatabase().begin(async transaction=>{
    const sql=transaction as unknown as CloudTransaction;
    await sql`SELECT set_config('app.organization_id',${scope.organizationId},true),set_config('app.venue_id',${scope.venueId},true)`;
    return work(sql);
  }) as Promise<T>;
}
