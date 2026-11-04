#!/usr/bin/env node
// Release security scan: public bundles must carry no secrets and no test-only routes; optional SBOM from the lockfile.
// Usage: node scripts/release-security.mjs [--sbom out.json] [dir…]   (default dirs: the public Next.js assets and the tablet bundle)
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
/** Secrets: a Supabase service-role JWT, database URLs with credentials, the names of server-only secrets, private key blocks. */
export const SECRET_RULES = [
  { id: 'service-role-jwt', test: text => [...text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.([A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)].some(m => { try { return JSON.parse(Buffer.from(m[1], 'base64url').toString()).role === 'service_role'; } catch { return false; } }) },
  { id: 'database-url', test: text => /postgres(ql)?:\/\/[^\s'"@]+:[^\s'"@]+@/.test(text) },
  { id: 'server-secret-name', test: text => /\b(SUPABASE_SERVICE_ROLE_KEY|JOB_HMAC_SECRET|DEVICE_GRANT_PRIVATE_KEY|CHANNEL_SECRET_MASTER|DATABASE_ADMIN_URL)\b/.test(text) },
  { id: 'private-key', test: text => /-----BEGIN (EC |RSA |OPENSSH )?PRIVATE KEY-----/.test(text) },
];
/** Test-only seams that must not exist in a release bundle: dev actor headers, the development transport, lab switches, simulator controls. */
export const TEST_ONLY_RULES = [
  { id: 'dev-actor-header', test: text => /x-test-actor/i.test(text) },
  { id: 'dev-lab-switch', test: text => /MEKONIQ_DEV_LAB/.test(text) },
  { id: 'development-transport', test: text => /developmentTransport/.test(text) },
];
export function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name), stat = statSync(path);
    if (stat.isDirectory()) { if (name !== 'node_modules') yield* walk(path); } else if (stat.size < 20_000_000 && /\.(js|mjs|cjs|css|html|json|map|txt)$/.test(name)) yield path;
  }
}
export function scanDirectory(dir, rules = [...SECRET_RULES, ...TEST_ONLY_RULES]) {
  const findings = [];
  for (const file of walk(dir)) {
    const text = readFileSync(file, 'utf8');
    for (const rule of rules) if (rule.test(text)) findings.push({ file, rule: rule.id });
  }
  return findings;
}
export function sbomFromLockfile(lockText) {
  const seen = new Set(), out = [];
  for (const m of lockText.matchAll(/^\s{2}'?(@?[^@\s'][^@\s']*)@([0-9][^:(\s']*)(?:\([^)]*\))*'?:\s*$/gm)) { const key = `${m[1]}@${m[2]}`; if (!seen.has(key)) { seen.add(key); out.push({ name: m[1], version: m[2] }); } }
  return { format: 'mekoniq-sbom-1', generatedFrom: 'pnpm-lock.yaml', components: out.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)) };
}
export const defaultPublicDirs = ['apps/cloud-web/.next/static', 'apps/tablet-web/dist'];
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), sbomAt = args.indexOf('--sbom');
  if (sbomAt >= 0) { const [, out] = args.splice(sbomAt, 2); writeFileSync(out, JSON.stringify(sbomFromLockfile(readFileSync('pnpm-lock.yaml', 'utf8')), null, 1)); }
  const dirs = args.length ? args : defaultPublicDirs;
  let bad = 0;
  for (const dir of dirs) { let found; try { found = scanDirectory(dir); } catch { console.error(`MISSING ${dir}: build first`); bad++; continue; } for (const f of found) { console.error(`FINDING ${f.rule} in ${f.file}`); bad++; } }
  process.exit(bad ? 1 : 0);
}
