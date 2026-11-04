#!/usr/bin/env node
// Builds the release manifest for the CURRENT checkout and build outputs, validates it against deploy/vercel/release-manifest.schema.json and prints the verdict of checkRelease.
// This is a DRY RUN: it never deploys, never needs a token, never contacts Vercel or Supabase. Usage:
//   node scripts/release.mjs [--env preview|staging|production] [--database local|preview|staging|production] [--ci ci.json] [--require id,id] [--previous prev.json] [--out file]
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { REQUIRED_SECRETS, checkRelease, rollbackAllowed } from './verify-release.mjs';
import { planMigrations } from './migrate-release.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
export function findApk(root = 'apps/tablet-android/android/app/build/outputs/apk/release') {
  if (!existsSync(root)) return null;
  const apk = readdirSync(root).filter(f => f.endsWith('.apk')).sort()[0]; return apk ? join(root, apk) : null;
}
/** A signed APK is one `apksigner verify` accepts. Without the tool, or with an unsigned file, it is NOT signed — never assumed. */
export function apkSigned(path) { return !!path && !/unsigned/.test(path) && spawnSync('apksigner', ['verify', path], { stdio: 'ignore' }).status === 0; }
/** Digest of what a deployment actually runs: every file of the build output (path + bytes, sorted) except the build cache and tracing/diagnostic files, which are not deployed. '' when there is no build. */
export function nextBuildDigest(root) {
  if (!existsSync(root)) return '';
  const skip = new Set(['cache', 'trace', 'diagnostics', 'dev']), files = [];
  const walk = (dir, rel) => { for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) { const r = rel ? `${rel}/${e.name}` : e.name; if (!rel && skip.has(e.name)) continue; if (e.isDirectory()) walk(join(dir, e.name), r); else if (e.isFile()) files.push(r); } };
  walk(root, '');
  const h = createHash('sha256'); for (const f of files) { h.update(f); h.update('\0'); h.update(sha(readFileSync(join(root, f)))); h.update('\n'); } return h.digest('hex');
}
export function buildManifest({ environment = 'staging', databaseRef = 'local', ci = {}, requiredProfiles = [], previous = null } = {}) {
  const next = 'apps/cloud-web/.next', buildId = existsSync(join(next, 'BUILD_ID')) ? readFileSync(join(next, 'BUILD_ID'), 'utf8') : null, nextDigest = buildId ? nextBuildDigest(next) : '';
  const apk = findApk(), plan = planMigrations(), catalog = JSON.parse(readFileSync('integrations/profiles/catalog.json', 'utf8')), free = JSON.parse(readFileSync('deploy/profiles/supabase-free.json', 'utf8'));
  const dir = 'packages/contracts/schemas', schemas = readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  const secretNames = REQUIRED_SECRETS;
  return {
    schema: 'mekoniq-release-1', createdAt: new Date().toISOString(), commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain').length > 0, environment,
    cloud: { nextBuildId: buildId ?? 'none', nextBuildSha256: nextDigest, vercelDeploymentId: null, vercelPlan: process.env.VERCEL_PLAN ?? null, vercelRegion: process.env.VERCEL_REGION ?? null, supabaseRegion: process.env.SUPABASE_REGION ?? null, nodeMajor: Number(process.versions.node.split('.')[0]) },
    android: { apkSha256: apk ? sha(readFileSync(apk)) : null, signed: apkSigned(apk), versionCode: null },
    supabase: { majorVersion: 17, migrations: plan.map(m => ({ file: m.file, sha256: sha(readFileSync(join('supabase/migrations', m.file))) })), expandOnly: plan.every(m => m.backwardCompatible), schemaRange: { minClient: 1, maxClient: 1 }, projectProfile: 'supabase-free-compatible' },
    contracts: schemas.map(f => ({ file: f, sha256: sha(readFileSync(join(dir, f))) })),
    featureRegistrySha256: sha(readFileSync('packages/domain/src/policy/registry.ts')),
    profiles: Object.fromEntries(catalog.map(p => [p.id, { status: p.status, hardwareRequired: ['robot-protocol', 'vendor-sdk'].includes(p.kind), evidence: p.evidence.production?.ref ?? p.evidence.sandbox?.ref ?? null }])), requiredProfiles,
    gates: { ci: { build: 'not_run', typecheck: 'not_run', lint: 'not_run', unit: 'not_run', contracts: 'not_run', integration: 'not_run', security: 'not_run', ...ci }, freeFunctionalHosted: { status: 'not_verified', evidence: null }, freeCapacityHosted: { status: 'not_verified', evidence: null }, recoveryDrill: { status: 'not_verified', evidence: null } },
    secretsPresent: Object.fromEntries(secretNames.map(n => [n, Boolean(process.env[n])])), databaseRef, requiredPaidFeatures: free.requiredPaidFeatures,
    rollback: { previousDeploymentId: previous?.cloud?.vercelDeploymentId ?? null, previousSchemaRange: previous?.supabase?.schemaRange ?? null },
  };
}
export function validateManifest(manifest) {
  const ajv = addFormats(new Ajv({ allErrors: true, strict: false })), validate = ajv.compile(JSON.parse(readFileSync('deploy/vercel/release-manifest.schema.json', 'utf8')));
  return validate(manifest) ? [] : (validate.errors ?? []).map(e => `${e.instancePath || '/'} ${e.message}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const previous = arg('previous') ? JSON.parse(readFileSync(arg('previous'), 'utf8')) : null;
  const manifest = buildManifest({ environment: arg('env', 'staging'), databaseRef: arg('database', 'local'), ci: arg('ci') ? JSON.parse(readFileSync(arg('ci'), 'utf8')) : {}, requiredProfiles: (arg('require', '') || '').split(',').filter(Boolean), previous });
  const problems = validateManifest(manifest); if (problems.length) { console.error('MANIFEST INVALID:', problems.join('; ')); process.exit(2); }
  const out = arg('out', '.lab/release/release-manifest.json'); mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(manifest, null, 2));
  const verdict = checkRelease({ requiredProfiles: manifest.requiredProfiles, profiles: manifest.profiles, manifest });
  console.log(JSON.stringify({ dryRun: true, manifest: out, ok: verdict.ok, reasons: verdict.reasons, rollback: previous ? rollbackAllowed(manifest, previous) : 'no previous manifest given' }, null, 1));
  process.exit(verdict.ok ? 0 : 1);
}
