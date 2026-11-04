// Logical backup / restore helpers for the app database (public schema). Provider-managed schemas (auth, storage, realtime, vault, cron) are NOT dumped: Auth gets an inventory,
// Storage a manifest + object copies, and a restore recreates structure and data in a scratch database. LOCAL use drives pg_dump/psql through the Supabase DB container;
// production uses the same steps against the real connection with its own tooling (docs/operations/backup-restore.md).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { sha256 } from './backup-verify.mjs';
import { exportStorage } from './export-storage.mjs';
export const containerName = () => process.env.MEKONIQ_DB_CONTAINER ?? 'supabase_db_mekoniq-w00-w04';
const docker = (args, input) => { const r = spawnSync('docker', ['exec', ...(input ? ['-i'] : []), containerName(), ...args], { input, encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 }); if (r.status !== 0) throw new Error(`docker ${args[0]} failed: ${r.stderr?.toString().slice(0, 400)}`); return r.stdout; };
export const adminUrl = (database = 'postgres') => `postgresql://postgres:postgres@127.0.0.1:57422/${database}`;
export const appUrl = (database) => `postgresql://mekoniq_app:local_test_only@127.0.0.1:57422/${database}`;
/** Tables of the public schema, in a stable order. */
export async function publicTables(sql) { return (await sql`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY 1`).map(r => r.relname); }
export function migrationInventory(dir = 'supabase/migrations') { return readdirSync(dir).filter(f => f.endsWith('.sql')).sort().map(f => ({ file: f, sha256: sha256(readFileSync(join(dir, f))) })); }
/** Reads one Storage object through the platform's REST API (service role); undefined when this environment has no way to read Storage. */
export const storageDownloader = () => { const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY; if (!base || !key) return undefined; return async (bucket, path) => { const r = await fetch(`${base}/storage/v1/object/${bucket}/${path}`, { headers: { authorization: `Bearer ${key}` } }); if (!r.ok) throw new Error(`STORAGE_READ_FAILED ${path} ${r.status}`); return Buffer.from(await r.arrayBuffer()); }; };
/** The backup takes its own inventory of ready assets (never a caller-supplied list) and copies each through `download`; without a way to read Storage the objects stay uncopied and verifyBackup refuses the backup. */
export async function createBackup({ outDir, appCommit, download }) {
  mkdirSync(outDir, { recursive: true });
  const sql = postgres(adminUrl(), { max: 1 });
  try {
    const tables = await publicTables(sql), rowCounts = {};
    for (const t of tables) rowCounts[t] = Number((await sql.unsafe(`SELECT count(*)::int AS n FROM public."${t}"`))[0].n);
    const dump = docker(['pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema=public', '--no-owner', '--quote-all-identifiers']);
    writeFileSync(join(outDir, 'public.sql'), dump);
    const ready = await sql`SELECT 'mekoniq-private' AS bucket, object_path, expected_bytes::text AS size_bytes, expected_hash AS sha256 FROM public.asset_manifest WHERE status = 'ready' ORDER BY object_path`;
    const storage = { readyAssets: ready.length, ...(await exportStorage({ objects: ready, download, outDir })) };
    const users = (await sql`SELECT id::text AS id, email, created_at FROM auth.users ORDER BY id`).map(u => ({ id: u.id, email: u.email, createdAt: new Date(u.created_at).toISOString() })); // ids + emails only: no hashes, no tokens
    const files = [{ path: 'public.sql', bytes: dump.length, sha256: sha256(dump) }];
    const manifest = { schema: 'mekoniq-backup-1', createdAt: new Date().toISOString(), appCommit, migrations: migrationInventory(), files, rowCounts, auth: { users }, storage,
      secretNamesNeeded: ['SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL', 'JOB_HMAC_SECRET', 'DEVICE_GRANT_PRIVATE_KEY', 'CHANNEL_SECRET_MASTER'] };
    writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
    return manifest;
  } finally { await sql.end({ timeout: 1 }); }
}
/** Restore a backup directory into a NEW scratch database: Auth stub from the inventory, then structure + data. Never touches the source database. */
export async function restoreInto({ dir, database }) {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const root = postgres(adminUrl(), { max: 1 });
  try { await root.unsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`); await root.unsafe(`CREATE DATABASE "${database}"`); } finally { await root.end({ timeout: 1 }); }
  const sql = postgres(adminUrl(database), { max: 1 });
  try {
    await sql.unsafe('DROP SCHEMA public CASCADE'); // the dump creates it again, with its own grants
    await sql.unsafe('CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, created_at timestamptz)'); // identities to attach memberships to; credentials come back through the platform's own Auth restore
    for (const u of manifest.auth.users) await sql`INSERT INTO auth.users(id,email,created_at) VALUES(${u.id}::uuid,${u.email},${u.createdAt})`;
  } finally { await sql.end({ timeout: 1 }); }
  // default privileges of the PROVIDER's roles (supabase_admin …) belong to the platform, which recreates them; they need a superuser to apply and are not ours to restore
  const script = readFileSync(join(dir, 'public.sql'), 'utf8').split('\n').filter(line => !/^ALTER DEFAULT PRIVILEGES /.test(line)).join('\n');
  docker(['psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-q'], Buffer.from(script));
  const after = postgres(adminUrl(database), { max: 1 });
  try { await after.unsafe('GRANT USAGE ON SCHEMA public TO PUBLIC'); } finally { await after.end({ timeout: 1 }); } // the platform's default for `public`, which a re-created schema does not carry (without it the app role cannot even see its tables)
  return manifest;
}
/** After any restore: nothing the old system had in flight may act again. Pending relay commands expire; jobs that may have been mid-call become `unknown` (to be reconciled by querying the other side, never replayed). */
export async function neutralizeLiveEffects(sql) {
  const relay = await sql`UPDATE public.relay_command SET expires_at = now() - interval '1 second' WHERE status IN ('pending','unknown') RETURNING operation_id`;
  const jobs = await sql`UPDATE public.cloud_job SET status = 'unknown', lease_until = NULL, due_at = now() WHERE status IN ('leased','sending','pending') AND type NOT IN ('hint.publish','storage.gc','channel.sweep') RETURNING id`;
  return { relayExpired: relay.length, jobsMadeUnknown: jobs.length };
}
/** Compare a restored database with the manifest: every table present with its row count, RLS still forced, the app role still without BYPASSRLS. */
export async function verifyRestore({ manifest, database }) {
  const sql = postgres(adminUrl(database), { max: 1 }), reasons = [];
  try {
    for (const [table, count] of Object.entries(manifest.rowCounts)) {
      const exists = await sql`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=${table}`;
      if (!exists.length) { reasons.push(`table ${table} missing`); continue; }
      const n = Number((await sql.unsafe(`SELECT count(*)::int AS n FROM public."${table}"`))[0].n);
      if (n !== count) reasons.push(`${table}: ${n} rows restored, ${count} in the backup`);
    }
    const noRls = await sql`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid) AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`;
    for (const r of noRls) reasons.push(`RLS not forced on ${r.relname}`);
    const [role] = await sql`SELECT rolbypassrls FROM pg_roles WHERE rolname='mekoniq_app'`; if (role?.rolbypassrls) reasons.push('app role bypasses RLS');
  } finally { await sql.end({ timeout: 1 }); }
  return { ok: reasons.length === 0, reasons };
}
export async function dropDatabase(database) { const root = postgres(adminUrl(), { max: 1 }); try { await root.unsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`); } finally { await root.end({ timeout: 1 }); } }
export const fingerprint = text => createHash('sha256').update(text).digest('hex');
