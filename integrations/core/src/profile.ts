import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import schema from '../../profiles/profile.schema.json';
import catalogJson from '../../profiles/catalog.json';
export type Evidence = { ref: string; sha256: string; at: string } | null;
export type IntegrationProfile = {
  id: string; kind: 'payment' | 'einvoice' | 'channel' | 'robot-protocol' | 'vendor-sdk'; label: string; mode: 'simulation' | 'sandbox' | 'production';
  status: 'draft' | 'contract_tested' | 'sandbox_verified' | 'production_approved'; adapter?: string;
  provider?: { name: string; docsUrl: string; apiVersion: string; docsRetrievedAt?: string };
  webhook?: { signatureScheme: string; signedFields: string[]; timestampToleranceSeconds: number; eventIdField: string };
  idempotency?: { keyField: string; queryEndpoint?: string }; credentialRefs?: string[]; version?: string; requiredInputs: string[];
  evidence: { sandbox: Evidence; production: Evidence };
};
const ajv = addFormats(new Ajv({ allErrors: true, strict: false }));
const validateShape = ajv.compile(schema);
/** Kinds whose providers call us: a production profile must say how those calls are authenticated and de-duplicated. */
const WEBHOOK_KINDS = new Set(['payment', 'einvoice', 'channel']);
/** Structural + semantic check. Returns every problem, so an onboarding mistake is fixed in one pass. Never guesses a missing field. */
export function profileProblems(profile: unknown): string[] {
  if (!validateShape(profile)) return (validateShape.errors ?? []).map(e => `${e.instancePath || '/'} ${e.message}`);
  const p = profile as IntegrationProfile, out: string[] = [];
  if (p.mode === 'production' || p.status === 'sandbox_verified' || p.status === 'production_approved') {
    if (!p.provider) out.push('provider (name, official docsUrl, apiVersion) is required once a profile is verified');
    if (WEBHOOK_KINDS.has(p.kind) && p.mode !== 'simulation' && !p.webhook) out.push('webhook signature scheme, signed fields, tolerance and event-id field are required');
    if (WEBHOOK_KINDS.has(p.kind) && p.mode !== 'simulation' && !p.idempotency) out.push('idempotency / query mapping is required');
    if ((p.kind === 'robot-protocol' || p.kind === 'vendor-sdk') && !p.version) out.push('exact protocol / SDK version is required');
    if (!p.adapter) out.push('adapter entrypoint is required');
  }
  if (p.status === 'sandbox_verified' && !p.evidence.sandbox) out.push('sandbox_verified needs sandbox evidence');
  if (p.status === 'production_approved' && (!p.evidence.sandbox || !p.evidence.production)) out.push('production_approved needs sandbox and production evidence');
  if (p.mode === 'simulation' && p.status !== 'draft' && p.status !== 'contract_tested') out.push('a simulation profile can never be verified or approved: an emulator is not evidence about a provider');
  return out;
}
/** Only a production-mode, schema-valid profile with both evidence records may carry real money, orders or robots. */
export function profileEligible(p: { mode: string; schemaValidated: boolean; sandboxEvidence: string | null; productionEvidence: string | null }): boolean {
  return p.mode === 'production' && p.schemaValidated && p.sandboxEvidence !== null && p.productionEvidence !== null;
}
export const profileIsEligible = (p: IntegrationProfile): boolean => profileProblems(p).length === 0 && p.status === 'production_approved'
  && profileEligible({ mode: p.mode, schemaValidated: true, sandboxEvidence: p.evidence.sandbox?.ref ?? null, productionEvidence: p.evidence.production?.ref ?? null });
export const catalog: IntegrationProfile[] = catalogJson as IntegrationProfile[];
/**
 * What may run. `release` = a production release: only eligible profiles. `sandbox` (development, CI, a sandbox venue): additionally the simulation and sandbox-mode profiles that
 * are at least contract tested — they stay tagged as non-production wherever they act. A draft is never enabled.
 */
export function loadEnabledProfiles(profiles: IntegrationProfile[] = catalog, runtime: 'release' | 'sandbox' = 'release'): IntegrationProfile[] {
  return profiles.filter(p => profileProblems(p).length === 0 && (profileIsEligible(p) || (runtime === 'sandbox' && p.mode !== 'production' && p.status !== 'draft')));
}
