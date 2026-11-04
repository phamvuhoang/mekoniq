#!/usr/bin/env node
// Release gate. `checkRelease(input)` returns {ok, reasons}: ok only when no reason is left. The CLI runs the same function: `node scripts/verify-release.mjs <manifest.json>` (exit 1 on any reason).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const regions = JSON.parse(readFileSync(new URL('../deploy/vercel/regions.json', import.meta.url), 'utf8')).pairs;
/** Plan function: hardware needs venue approval. */
export function hardwareProfileReady(p) { return !p.hardwareRequired || p.status === 'venue_approved'; }
const READY_NON_HARDWARE = new Set(['production_approved', 'venue_approved', 'hardware_validated']);
/** input: { requiredProfiles, profiles, manifest? }  — profiles alone is enough to judge adapters; with a manifest the whole release is judged. */
export function checkRelease(input) {
  const reasons = [];
  for (const id of input.requiredProfiles ?? []) {
    const p = input.profiles?.[id];
    if (!p) { reasons.push(`required profile ${id} is missing`); continue; }
    if (p.hardwareRequired ? !hardwareProfileReady(p) : !READY_NON_HARDWARE.has(p.status)) reasons.push(`required profile ${id} is "${p.status}"${p.hardwareRequired ? ' (hardware needs venue_approved)' : ' (needs production_approved evidence)'}`);
  }
  const m = input.manifest; if (!m) return { ok: reasons.length === 0, reasons };
  const prod = m.environment === 'production';
  for (const [name, state] of Object.entries(m.gates.ci)) if (state !== 'passed') reasons.push(`CI gate ${name} is ${state}`);
  if (m.dirty && prod) reasons.push('production release from a dirty working tree');
  if (m.supabase.majorVersion !== 17) reasons.push(`Supabase PostgreSQL major ${m.supabase.majorVersion}, 17 is required`);
  if (!m.supabase.expandOnly && !m.supabase.clearance) reasons.push('a destructive migration is present without clearance (unknown clients / pending journals)');
  if (m.requiredPaidFeatures.length) reasons.push(`paid prerequisite(s) for the Free profile: ${m.requiredPaidFeatures.join(', ')}`);
  if (!m.android.apkSha256 || !m.android.signed) reasons.push('no signed APK digest');
  if (!m.cloud.nextBuildSha256) reasons.push('no Next.js build digest');
  if (m.environment !== 'production' && m.databaseRef === 'production') reasons.push(`${m.environment} must not use the production database`);
  if (prod && m.databaseRef !== 'production') reasons.push('a production release must name the production database');
  if (prod) {
    if (m.cloud.vercelPlan === 'hobby' || !m.cloud.vercelPlan) reasons.push('commercial use needs a Vercel plan that allows it (Hobby is non-commercial)');
    if (!m.cloud.supabaseRegion || !m.cloud.vercelRegion || !regions.some(r => r.supabase === m.cloud.supabaseRegion && r.vercel === m.cloud.vercelRegion)) reasons.push(`Vercel region ${m.cloud.vercelRegion} is not paired with Supabase region ${m.cloud.supabaseRegion}`);
    for (const [name, present] of Object.entries(m.secretsPresent)) if (!present) reasons.push(`production secret ${name} is missing (readiness would refuse; no silent skip)`);
    if (!Object.keys(m.secretsPresent).length) reasons.push('no secret inventory recorded');
    for (const [gate, label] of [['freeFunctionalHosted', 'Free functional acceptance on a hosted project'], ['freeCapacityHosted', 'Free capacity measured on a hosted project'], ['recoveryDrill', 'production recovery drill (RPO/RTO)']])
      if (m.gates[gate].status !== 'accepted' || !m.gates[gate].evidence) reasons.push(`${label} is ${m.gates[gate].status}`);
  }
  return { ok: reasons.length === 0, reasons };
}
/** Rollback is roll-FORWARD for data: the previous app build may be re-deployed only if it still understands the schema now in place; facts written meanwhile stay. */
export function rollbackAllowed(current, previous) {
  const reasons = [];
  if (!previous) return { ok: false, reasons: ['no previous release recorded'] };
  if (!current.supabase.expandOnly) reasons.push('the current schema contains a destructive migration: the previous build may not read it');
  if (current.supabase.schemaRange.maxClient < previous.supabase.schemaRange.minClient || previous.supabase.schemaRange.maxClient < current.supabase.schemaRange.minClient) reasons.push('schema ranges of the two releases do not overlap');
  return { ok: reasons.length === 0, reasons };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2]; if (!file) { console.error('usage: verify-release.mjs <manifest.json>'); process.exit(2); }
  const manifest = JSON.parse(readFileSync(file, 'utf8')), result = checkRelease({ requiredProfiles: manifest.requiredProfiles, profiles: manifest.profiles, manifest });
  for (const r of result.reasons) console.error('RELEASE BLOCKED:', r);
  console.log(result.ok ? 'release ok' : `${result.reasons.length} reason(s)`); process.exit(result.ok ? 0 : 1);
}
