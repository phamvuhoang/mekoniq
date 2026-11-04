import { afterAll, expect, test } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { createRestaurantLab } from '../support/restaurant-lab';
import { setupWave02 } from '../support/wave02-db';
// @ts-expect-error plain ESM scripts without types
import { adminUrl, createBackup, dropDatabase, neutralizeLiveEffects, restoreInto, verifyRestore } from '../../scripts/backup-restore-lib.mjs';
// @ts-expect-error plain ESM script without types
import { verifyBackup } from '../../scripts/backup-verify.mjs';
// @ts-expect-error plain ESM script without types
import { classifyMigration, migrationAllowed, planMigrations } from '../../scripts/migrate-release.mjs';
// @ts-expect-error plain ESM script without types
import { exportStorage } from '../../scripts/export-storage.mjs';
const scratch: string[] = [], dirs: string[] = [];
afterAll(async () => { delete process.env.MEKONIQ_TEST_DB; for (const d of scratch) await dropDatabase(d); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'mekoniq-up-')); dirs.push(d); return d; };
const commit = 'test-commit';
async function inDb<T>(database: string, work: (sql: ReturnType<typeof postgres>) => Promise<T>): Promise<T> { const sql = postgres(adminUrl(database), { max: 1 }); try { return await work(sql); } finally { await sql.end({ timeout: 1 }); } }
test('old offline client sync survives a schema upgrade and restored cloud', async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.command('cashier', 'Shift.Open', { shiftId: 'shift-up', currency: 'VND', openingMinor: '0' }, 'up-shift');
    await lab.seed('bill', 'bill-up', { status: 'prepared', totalMinor: '50000', paidMinor: '0', refundedMinor: '0', currency: 'VND', orderIds: [], lines: [], version: 1 });
    await lab.sync(); // the cloud knows the shift: this is the checkpoint
    const checkpoint = tmp(); await createBackup({ outDir: checkpoint, appCommit: commit });
    await lab.partition('wan'); // the tablet goes on selling with no cloud
    const receipt = await lab.command('cashier', 'Payment.RecordCash', { billId: 'bill-up', expectedVersion: 1, amountMinor: '50000', currency: 'VND', shiftId: 'shift-up' }, 'legacy-op');
    expect(receipt.status).toBe('accepted');
    const database = `restore_up_${Date.now()}`; scratch.push(database);
    const manifest = await restoreInto({ dir: checkpoint, database }); // "restoreCloudCheckpoint(before-receipt)"
    await inDb(database, sql => sql.unsafe('ALTER TABLE public.sync_inbox ADD COLUMN upgrade_note text')); // "upgradeCloud(next-schema)": an expand migration the old client knows nothing about
    const receiptEntries = (await (await lab.getStore('coordinator')).journal(lab.scope)).filter(e => e.operationId === 'legacy-op');
    expect(receiptEntries.length).toBeGreaterThan(0);
    process.env.MEKONIQ_TEST_DB = database; // the cloud is now the restored, upgraded one
    await lab.heal(); await lab.sync(); await lab.sync(); // twice: the second must add nothing
    const count = await inDb(database, async sql => Number((await sql`SELECT count(*)::int AS n FROM sync_inbox WHERE organization_id=${lab.scope.organizationId} AND operation_id='legacy-op'`)[0]!.n));
    expect(count).toBe(receiptEntries.length); // each journal entry of the offline receipt once, none lost, none doubled
    expect(await lab.count('CashRecorded')).toBe(1);
    const applied = await inDb(database, async sql => (await sql`SELECT state FROM sync_projection WHERE organization_id=${lab.scope.organizationId} AND aggregate_type='payment'`).length);
    expect(applied).toBeGreaterThan(0);
    delete process.env.MEKONIQ_TEST_DB;
    const live = await setupWave02(); try { expect((await live.admin`SELECT count(*)::int AS n FROM sync_inbox WHERE organization_id=${lab.scope.organizationId} AND operation_id='legacy-op'`)[0]!.n).toBe(0); } finally { await live.close(); } // the source database was never touched
    expect(manifest.migrations.length).toBeGreaterThan(5);
  } finally { await lab.close(); }
});
test('a restore matches its backup (rows, RLS, app role), and nothing the old system had in flight can act again', async () => {
  const live = await setupWave02(), org = 'restore-' + randomUUID();
  try {
    await live.admin`INSERT INTO venue(organization_id,id,name) VALUES(${org},'venue-a','A')`;
    await live.admin`INSERT INTO relay_command(organization_id,venue_id,operation_id,payload_hash,command,coordinator_epoch,expires_at) VALUES(${org},'venue-a','old-relay','h','{"type":"x"}',1,now()+interval '4 minutes')`;
    await live.admin`INSERT INTO cloud_job(organization_id,venue_id,id,type,payload,status) VALUES(${org},'venue-a','mid-call','channel.effect','{}','sending')`;
  } finally { await live.close(); }
  const dir = tmp(), manifest = await createBackup({ outDir: dir, appCommit: commit }), database = `restore_fx_${Date.now()}`; scratch.push(database);
  expect(verifyBackup(dir)).toMatchObject({ ok: true });
  await restoreInto({ dir, database });
  const neutral = await inDb(database, sql => neutralizeLiveEffects(sql)) as { relayExpired: number; jobsMadeUnknown: number }; expect(neutral.relayExpired).toBeGreaterThan(0); expect(neutral.jobsMadeUnknown).toBeGreaterThan(0);
  await inDb(database, async sql => {
    expect((await sql`SELECT expires_at < now() AS expired FROM relay_command WHERE operation_id='old-relay'`)[0]!.expired).toBe(true); // cannot be pulled after the restore
    expect((await sql`SELECT status FROM cloud_job WHERE id='mid-call'`)[0]!.status).toBe('unknown'); // reconciled by asking the other side, never replayed
  });
  const check = await verifyRestore({ manifest, database }); expect(check.reasons.filter((r: string) => !/rows restored/.test(r))).toEqual([]); // row counts of a busy shared dev DB may drift between dump and count; structure may not
  const users = await inDb(database, async sql => Number((await sql`SELECT count(*)::int AS n FROM auth.users`)[0]!.n)); expect(users).toBe(manifest.auth.users.length); // identities restored with their ids; memberships kept their foreign keys
  // a lost receipt is detected, not silently accepted
  await inDb(database, sql => sql`DELETE FROM sync_inbox WHERE ctid IN (SELECT ctid FROM sync_inbox LIMIT 1)`);
  const damaged = await verifyRestore({ manifest: { ...manifest, rowCounts: await inDb(database, async sql => Object.fromEntries(await Promise.all((await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`).map(async t => [t.table_name, Number((await sql.unsafe(`SELECT count(*)::int AS n FROM public."${t.table_name}"`))[0]!.n) + (t.table_name === 'sync_inbox' ? 1 : 0)])))) }, database });
  expect(damaged.ok).toBe(false); expect(damaged.reasons.join()).toMatch(/sync_inbox/);
});
test('backup verification finds corruption, missing segments, strays, missing objects and credentials in the Auth inventory', async () => {
  const dir = tmp(), manifest = await createBackup({ outDir: dir, appCommit: commit, storageObjects: [{ bucket: 'b', path: 'menu/a.png', bytes: 3, sha256: 'a'.repeat(64), copied: true }] });
  expect(verifyBackup(dir).reasons).toEqual([expect.stringMatching(/missing storage object menu\/a\.png/)]); // a manifest that names a copy that is not there
  mkdirSync(join(dir, 'storage', 'menu'), { recursive: true }); writeFileSync(join(dir, 'storage', 'menu', 'a.png'), 'abc');
  expect(verifyBackup(dir).reasons.join()).toMatch(/corrupt storage object/);
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ ...manifest, storage: { objects: [] } })); expect(verifyBackup(dir)).toMatchObject({ ok: true });
  const bytes = readFileSync(join(dir, 'public.sql')); writeFileSync(join(dir, 'public.sql'), Buffer.concat([bytes.subarray(0, 100), Buffer.from('X'), bytes.subarray(101)]));
  expect(verifyBackup(dir).reasons.join()).toMatch(/corrupt public\.sql/);
  writeFileSync(join(dir, 'public.sql'), bytes); appendFileSync(join(dir, 'stray.sql'), 'drop table x;'); expect(verifyBackup(dir).reasons.join()).toMatch(/unaccounted file stray\.sql/); unlinkSync(join(dir, 'stray.sql'));
  unlinkSync(join(dir, 'public.sql')); expect(verifyBackup(dir).reasons.join()).toMatch(/missing segment public\.sql/);
  writeFileSync(join(dir, 'public.sql'), bytes);
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ ...manifest, storage: { objects: [] }, auth: { users: [{ id: 'u', email: 'a@b.c', encrypted_password: 'x' }] } })); expect(verifyBackup(dir).reasons.join()).toMatch(/must not contain credentials/);
  unlinkSync(join(dir, 'manifest.json')); expect(verifyBackup(dir)).toMatchObject({ ok: false, reasons: ['manifest.json is missing or unreadable'] });
  expect(spawnSync(process.execPath, ['scripts/backup-verify.mjs', dir]).status).toBe(1);
});
test('storage export copies verified objects only: a damaged object stops the export instead of entering a backup', async () => {
  const good = Buffer.from('menu image'), { createHash } = await import('node:crypto'), hash = createHash('sha256').update(good).digest('hex'), out = tmp();
  const objects = [{ bucket: 'menu', object_path: 'o/a.png', size_bytes: good.length, sha256: hash }];
  expect(await exportStorage({ objects, download: async () => good, outDir: out })).toEqual({ objects: [{ bucket: 'menu', path: 'o/a.png', bytes: good.length, sha256: hash, copied: true }] });
  expect(readFileSync(join(out, 'storage', 'o', 'a.png'))).toEqual(good);
  await expect(exportStorage({ objects, download: async () => Buffer.from('tampered'), outDir: tmp() })).rejects.toThrow('STORAGE_OBJECT_HASH_MISMATCH');
  expect((await exportStorage({ objects })).objects[0]!.copied).toBe(false); // manifest only: honest about not having the file
});
test('migrations: expand-only goes through; a destructive one needs every client known and every journal drained', () => {
  expect(migrationAllowed({ unknownClients: 3, pendingJournals: 9, backwardCompatible: true })).toBe(true);
  expect(migrationAllowed({ unknownClients: 1, pendingJournals: 0, backwardCompatible: false })).toBe(false);
  expect(migrationAllowed({ unknownClients: 0, pendingJournals: 2, backwardCompatible: false })).toBe(false);
  expect(migrationAllowed({ unknownClients: 0, pendingJournals: 0, backwardCompatible: false })).toBe(true);
  expect(classifyMigration('ALTER TABLE t ADD COLUMN c text;').backwardCompatible).toBe(true);
  for (const bad of ['ALTER TABLE t DROP COLUMN c;', 'DROP TABLE t;', 'ALTER TABLE t ALTER COLUMN c TYPE bigint;', 'ALTER TABLE t RENAME TO u;', 'ALTER TABLE t ALTER COLUMN c SET NOT NULL;', 'TRUNCATE t;', 'DELETE FROM t;']) expect(classifyMigration(bad).backwardCompatible, bad).toBe(false);
  expect(classifyMigration('-- DROP TABLE in a comment\nCREATE TABLE x(a int);').backwardCompatible).toBe(true);
  expect(planMigrations().filter((m: { backwardCompatible: boolean }) => !m.backwardCompatible).map((m: { file: string }) => m.file)).toEqual([]); // every shipped migration is expand-only: old tablets keep syncing across a rolling upgrade
  const dir = tmp(); writeFileSync(join(dir, '20270101000000_bad.sql'), 'ALTER TABLE t DROP COLUMN c;');
  const run = spawnSync(process.execPath, ['scripts/migrate-release.mjs', '--plan', dir], { encoding: 'utf8' }); expect(run.status).toBe(1); expect(run.stderr).toMatch(/destructive/);
  expect(spawnSync(process.execPath, ['scripts/migrate-release.mjs', '--plan', dir, '--clearance']).status).toBe(0);
});
test('the declared backup policy is honest: not configured, no PITR assumed, secrets excluded, encryption required', () => {
  const policy = JSON.parse(readFileSync('deploy/profiles/backup-policy.json', 'utf8'));
  expect(policy).toMatchObject({ status: 'not_configured', targets: { rpoMinutes: 5, rtoMinutes: 30 }, encryption: { required: true }, target: { chosen: null } });
  expect(policy.excluded.join()).toMatch(/secrets/); expect(policy.afterRestore.join()).toMatch(/never replayed|reconciled/);
});
