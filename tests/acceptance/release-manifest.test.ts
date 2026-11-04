import { expect, test } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
// @ts-expect-error plain ESM script without types
import { checkRelease, hardwareProfileReady, rollbackAllowed } from '../../scripts/verify-release.mjs';
// @ts-expect-error plain ESM script without types
import { buildManifest, validateManifest, apkSigned, findApk } from '../../scripts/release.mjs';
type Manifest = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
test('release refuses an unverified required adapter', () => {
  expect(checkRelease({ requiredProfiles: ['valetudo-r1'], profiles: { 'valetudo-r1': { status: 'integration_tested', hardwareRequired: true } } }).ok).toBe(false);
});
test('adapters and providers: hardware needs venue approval, providers need approved evidence, missing profiles block', () => {
  expect(hardwareProfileReady({ status: 'venue_approved', hardwareRequired: true })).toBe(true);
  expect(hardwareProfileReady({ status: 'hardware_validated', hardwareRequired: true })).toBe(false);
  expect(hardwareProfileReady({ status: 'simulated', hardwareRequired: false })).toBe(true);
  const profiles = { 'valetudo-r1': { status: 'venue_approved', hardwareRequired: true }, 'payment-x': { status: 'sandbox_verified', hardwareRequired: false }, 'vda-2': { status: 'contract_tested', hardwareRequired: true } };
  const r = checkRelease({ requiredProfiles: ['valetudo-r1', 'payment-x', 'vda-2', 'ghost'], profiles });
  expect(r.ok).toBe(false); expect(r.reasons).toHaveLength(3);
  expect(r.reasons.join()).toMatch(/payment-x.*production_approved/); expect(r.reasons.join()).toMatch(/vda-2.*venue_approved/); expect(r.reasons.join()).toMatch(/ghost is missing/);
  expect(checkRelease({ requiredProfiles: ['valetudo-r1'], profiles }).ok).toBe(true);
  expect(checkRelease({ requiredProfiles: [], profiles: {} }).ok).toBe(true);
});
/** A manifest that would pass a production check — every field a person must really supply is filled here, so each test removes exactly one thing. */
const good = (over: Manifest = {}): Manifest => {
  const m = buildManifest({ environment: 'production', databaseRef: 'production', ci: Object.fromEntries(['build', 'typecheck', 'lint', 'unit', 'contracts', 'integration', 'security'].map(k => [k, 'passed'])) });
  return { ...m, dirty: false, cloud: { ...m.cloud, vercelPlan: 'pro', vercelRegion: 'sin1', supabaseRegion: 'ap-southeast-1', vercelDeploymentId: 'dpl_1' }, android: { apkSha256: 'a'.repeat(64), signed: true, versionCode: 7 },
    secretsPresent: Object.fromEntries(Object.keys(m.secretsPresent).map(k => [k, true])), gates: { ...m.gates, freeFunctionalHosted: { status: 'accepted', evidence: 'docs/e1.md' }, freeCapacityHosted: { status: 'accepted', evidence: 'docs/e2.md' }, recoveryDrill: { status: 'accepted', evidence: 'docs/e3.md' } }, ...over };
};
const verdict = (m: Manifest) => checkRelease({ requiredProfiles: m.requiredProfiles, profiles: m.profiles, manifest: m });
test('a complete production manifest passes; removing any single obligation blocks it with that reason', () => {
  expect(validateManifest(good())).toEqual([]);
  expect(verdict(good())).toEqual({ ok: true, reasons: [] });
  const blocked = (over: Manifest | ((m: Manifest) => Manifest), re: RegExp) => { const m = good(); const r = verdict(typeof over === 'function' ? over(m) : { ...m, ...over }); expect(r.ok).toBe(false); expect(r.reasons.join(' | ')).toMatch(re); };
  blocked({ dirty: true }, /dirty working tree/);
  blocked(m => ({ ...m, gates: { ...m.gates, ci: { ...m.gates.ci, lint: 'failed' } } }), /CI gate lint is failed/);
  blocked(m => ({ ...m, gates: { ...m.gates, ci: { ...m.gates.ci, security: 'not_run' } } }), /CI gate security is not_run/);
  blocked(m => ({ ...m, android: { ...m.android, signed: false } }), /no signed APK/);
  blocked(m => ({ ...m, android: { ...m.android, apkSha256: null } }), /no signed APK/);
  blocked(m => ({ ...m, cloud: { ...m.cloud, nextBuildSha256: '' } }), /Next\.js build digest/);
  blocked(m => ({ ...m, cloud: { ...m.cloud, vercelPlan: 'hobby' } }), /Hobby is non-commercial/);
  blocked(m => ({ ...m, cloud: { ...m.cloud, vercelPlan: null } }), /plan that allows/);
  blocked(m => ({ ...m, cloud: { ...m.cloud, vercelRegion: 'iad1' } }), /not paired with Supabase region/);
  blocked(m => ({ ...m, supabase: { ...m.supabase, majorVersion: 15 } }), /PostgreSQL major 15/);
  blocked(m => ({ ...m, supabase: { ...m.supabase, expandOnly: false } }), /destructive migration .* without clearance/);
  blocked({ requiredPaidFeatures: ['pitr'] }, /paid prerequisite.*pitr/);
  blocked(m => ({ ...m, secretsPresent: { ...m.secretsPresent, JOB_HMAC_SECRET: false } }), /production secret JOB_HMAC_SECRET is missing/);
  blocked({ secretsPresent: {} }, /no secret inventory/);
  blocked({ databaseRef: 'staging' }, /must name the production database/);
  blocked(m => ({ ...m, gates: { ...m.gates, freeFunctionalHosted: { status: 'not_verified', evidence: null } } }), /Free functional acceptance on a hosted project is not_verified/);
  blocked(m => ({ ...m, gates: { ...m.gates, freeCapacityHosted: { status: 'accepted', evidence: null } } }), /Free capacity measured on a hosted project/);
  blocked(m => ({ ...m, gates: { ...m.gates, recoveryDrill: { status: 'failed', evidence: 'x' } } }), /production recovery drill/);
});
test('preview and staging never touch the production database; they are not held to the production-only gates', () => {
  const staging = good({ environment: 'staging', databaseRef: 'staging' });
  expect(verdict(staging).ok).toBe(true);
  const leaking = verdict(good({ environment: 'preview', databaseRef: 'production' })); expect(leaking.ok).toBe(false); expect(leaking.reasons.join()).toMatch(/preview must not use the production database/);
  expect(verdict(good({ environment: 'staging', databaseRef: 'production' })).reasons.join()).toMatch(/staging must not use the production database/);
  expect(verdict(good({ environment: 'staging', databaseRef: 'staging', gates: { ...good().gates, freeFunctionalHosted: { status: 'not_verified', evidence: null } } })).ok).toBe(true);
});
test('the manifest schema rejects malformed or secret-bearing manifests', () => {
  const m = good();
  expect(validateManifest({ ...m, commit: 'abc' }).length).toBeGreaterThan(0);
  expect(validateManifest({ ...m, environment: 'dev' }).length).toBeGreaterThan(0);
  expect(validateManifest({ ...m, extra: 1 }).length).toBeGreaterThan(0);
  expect(validateManifest({ ...m, supabase: { ...m.supabase, projectProfile: 'paid-pro' } }).length).toBeGreaterThan(0);
  expect(validateManifest({ ...m, secretsPresent: { JOB_HMAC_SECRET: 'the-value' } }).length).toBeGreaterThan(0); // names + booleans only
});
test('this checkout\'s dry-run manifest is real and honestly blocked: exact digests, expand-only migrations, an unsigned APK is refused, hosted gates are not claimed', () => {
  const m = buildManifest({ environment: 'staging', databaseRef: 'local' }) as Manifest;
  expect(validateManifest(m)).toEqual([]);
  expect(m.commit).toMatch(/^[a-f0-9]{40}$/); expect(m.cloud.nextBuildSha256).toMatch(/^[a-f0-9]{64}$/); expect(m.supabase.expandOnly).toBe(true); expect(m.supabase.majorVersion).toBe(17);
  expect(m.supabase.migrations.length).toBeGreaterThan(10); expect(m.contracts.length).toBeGreaterThan(3); expect(m.featureRegistrySha256).toMatch(/^[a-f0-9]{64}$/);
  expect(m.requiredPaidFeatures).toEqual([]); expect(m.gates.freeFunctionalHosted.status).toBe('not_verified');
  expect(m.profiles['vda5050-2.0.0']).toMatchObject({ status: 'contract_tested', hardwareRequired: true });
  const apk = findApk(); expect(apk).toMatch(/\.apk$/); expect(apkSigned(apk)).toBe(false); expect(m.android.signed).toBe(false); // the Gradle release output here is unsigned
  const r = verdict(m); expect(r.ok).toBe(false); expect(r.reasons.join()).toMatch(/no signed APK/); expect(r.reasons.join()).toMatch(/CI gate .* is not_run/);
  expect(Object.values(m.secretsPresent).every(v => typeof v === 'boolean')).toBe(true);
});
test('rollback keeps the data and only the code steps back: it needs an expand-only schema and overlapping client ranges', () => {
  const cur = good(), prev = good({ supabase: { ...good().supabase, schemaRange: { minClient: 1, maxClient: 1 } } });
  expect(rollbackAllowed(cur, prev)).toEqual({ ok: true, reasons: [] });
  expect(rollbackAllowed(good({ supabase: { ...cur.supabase, expandOnly: false } }), prev).reasons.join()).toMatch(/destructive migration/);
  expect(rollbackAllowed(good({ supabase: { ...cur.supabase, schemaRange: { minClient: 3, maxClient: 4 } } }), prev).reasons.join()).toMatch(/do not overlap/);
  expect(rollbackAllowed(cur, null).ok).toBe(false);
});
test('the CLIs use the same function: exit 1 with reasons for a blocked manifest, 0 for a good one; the dry run never deploys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rel-')), okFile = join(dir, 'ok.json'), badFile = join(dir, 'bad.json');
  writeFileSync(okFile, JSON.stringify(good())); writeFileSync(badFile, JSON.stringify(good({ dirty: true })));
  expect(spawnSync(process.execPath, ['scripts/verify-release.mjs', okFile]).status).toBe(0);
  const bad = spawnSync(process.execPath, ['scripts/verify-release.mjs', badFile], { encoding: 'utf8' }); expect(bad.status).toBe(1); expect(bad.stderr).toMatch(/RELEASE BLOCKED: production release from a dirty working tree/);
  const dry = spawnSync(process.execPath, ['scripts/release.mjs', '--env', 'staging', '--out', join(dir, 'm.json')], { encoding: 'utf8' }); expect(dry.status).toBe(1); expect(JSON.parse(dry.stdout)).toMatchObject({ dryRun: true, ok: false });
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
  expect(workflow).toMatch(/RELEASE_DEPLOY_ENABLED == 'true'/); expect(workflow).toMatch(/node scripts\/verify-release\.mjs release-manifest\.json/); expect(workflow).toMatch(/DRY RUN BY DEFAULT/);
  expect(JSON.parse(readFileSync('apps/cloud-web/vercel.json', 'utf8'))).toMatchObject({ regions: ['sin1'], functions: expect.any(Object) });
});
