#!/usr/bin/env node
// Verifies a MEKONIQ logical backup directory: every file named in manifest.json exists, matches its size and sha256, and the manifest itself is complete.
// Usage: node scripts/backup-verify.mjs <backup-dir>      Exit 1 and list reasons if anything is missing, corrupt or unaccounted for.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function verifyBackup(dir) {
  const reasons = [];
  let manifest;
  try { manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')); } catch { return { ok: false, reasons: ['manifest.json is missing or unreadable'] }; }
  if (manifest.schema !== 'mekoniq-backup-1') reasons.push('unknown manifest schema');
  for (const key of ['createdAt', 'appCommit', 'migrations', 'files', 'auth', 'storage', 'rowCounts']) if (manifest[key] === undefined) reasons.push(`manifest lacks ${key}`);
  const named = new Set();
  for (const f of manifest.files ?? []) {
    named.add(f.path);
    const path = join(dir, f.path);
    if (!existsSync(path)) { reasons.push(`missing segment ${f.path}`); continue; }
    const bytes = readFileSync(path);
    if (bytes.length !== f.bytes) reasons.push(`size mismatch ${f.path}`);
    else if (sha256(bytes) !== f.sha256) reasons.push(`corrupt ${f.path} (sha256)`);
  }
  for (const name of readdirSync(dir)) if (name !== 'manifest.json' && !named.has(name) && statSync(join(dir, name)).isFile()) reasons.push(`unaccounted file ${name}`);
  if (!Number.isInteger(manifest.storage?.readyAssets) || manifest.storage.readyAssets !== (manifest.storage.objects ?? []).length) reasons.push(`storage inventory lists ${(manifest.storage?.objects ?? []).length} objects for ${manifest.storage?.readyAssets ?? '?'} ready assets`);
  for (const o of manifest.storage?.objects ?? []) {
    if (!o.copied) { reasons.push(`storage object not copied ${o.path}`); continue; }
    const p = join(dir, 'storage', o.path);
    if (!existsSync(p)) reasons.push(`missing storage object ${o.path}`); else if (sha256(readFileSync(p)) !== o.sha256) reasons.push(`corrupt storage object ${o.path}`);
  }
  if (!Array.isArray(manifest.auth?.users)) reasons.push('Auth inventory missing');
  else if (manifest.auth.users.some(u => 'password' in u || 'encrypted_password' in u || 'refresh_token' in u)) reasons.push('Auth inventory must not contain credentials');
  return { ok: reasons.length === 0, reasons, manifest };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2]; if (!dir) { console.error('usage: backup-verify.mjs <backup-dir>'); process.exit(2); }
  const r = verifyBackup(dir); for (const reason of r.reasons) console.error('BACKUP PROBLEM:', reason);
  if (r.ok) console.log(`backup ok: ${r.manifest.files.length} files, ${r.manifest.auth.users.length} auth users, ${r.manifest.storage.objects.length} storage objects`);
  process.exit(r.ok ? 0 : 1);
}
