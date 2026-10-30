import postgres from 'postgres';
export async function databaseReady(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  const sql=postgres(process.env.DATABASE_URL,{max:1,prepare:false,connect_timeout:1,idle_timeout:1});
  try { await sql`select 1`; return true; }
  catch { return false; }
  finally { await sql.end({timeout:1}); }
}
