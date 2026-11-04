#!/usr/bin/env node
// Rehearse a restore: back up the LOCAL app database, verify the backup, restore it into a scratch database, neutralise live effects, verify the restore, drop the scratch database.
// Usage: node scripts/restore-rehearsal.mjs [backup-dir]   Prints a JSON report; exit 1 if any step found a problem. It never writes to the source database.
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import { verifyBackup } from './backup-verify.mjs';
import { adminUrl, createBackup, storageDownloader, dropDatabase, neutralizeLiveEffects, restoreInto, verifyRestore } from './backup-restore-lib.mjs';
const dir = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'mekoniq-backup-')), database = `restore_rehearsal_${Date.now()}`, started = Date.now();
const report = { backupDir: dir, steps: {}, ok: false };
try {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const manifest = await createBackup({ outDir: dir, appCommit: commit, download: storageDownloader() }); report.steps.backup = { tables: Object.keys(manifest.rowCounts).length, authUsers: manifest.auth.users.length, readyAssets: manifest.storage.readyAssets };
  const verified = verifyBackup(dir); report.steps.verifyBackup = { ok: verified.ok, reasons: verified.reasons }; if (!verified.ok) throw new Error('BACKUP_INVALID');
  await restoreInto({ dir, database });
  const sql = postgres(adminUrl(database), { max: 1 }); try { report.steps.neutralize = await neutralizeLiveEffects(sql); } finally { await sql.end({ timeout: 1 }); }
  const restored = await verifyRestore({ manifest: { ...manifest, rowCounts: manifest.rowCounts }, database }); report.steps.verifyRestore = restored;
  report.ok = restored.ok; report.elapsedSeconds = (Date.now() - started) / 1000;
  report.note = 'elapsed time of a LOCAL rehearsal is not an RTO measurement; production RPO/RTO need a drill against the real project';
} catch (error) { report.error = String(error.message ?? error); } finally { await dropDatabase(database); }
console.log(JSON.stringify(report, null, 1)); process.exit(report.ok ? 0 : 1);
