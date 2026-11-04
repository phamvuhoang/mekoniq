/** What a vendor SDK adapter may do is a per-version matrix, not a promise: an operation is `supported` only with a conformance evidence reference; everything else is refused by the adapter. */
export type Operation = 'navigate' | 'cancel' | 'query' | 'stop' | 'mapChange' | 'reboot';
export type Coverage = 'supported' | 'unsupported' | 'untested';
export type VendorProfile = {
  id: string; sdkName: string; sdkVersion: string; firmware: string;
  /** Does the SDK give a native goal id we can query later? 'caller-supplied' = we choose it; 'provider-assigned' = the SDK returns it; 'none' = nothing to reconcile with. */
  nativeCommandIdentity: 'caller-supplied' | 'provider-assigned' | 'none';
  licence: { redistributable: boolean | null; reviewRef: string | null };
  coverage: Record<Operation, { status: Coverage; evidence?: string }>;
};
export const OPERATIONS: Operation[] = ['navigate', 'cancel', 'query', 'stop', 'mapChange', 'reboot'];
export function vendorProfileProblems(p: VendorProfile): string[] {
  const out: string[] = [];
  if (!p.sdkName || !p.sdkVersion || !p.firmware) out.push('exact SDK name, version and firmware are required');
  for (const op of OPERATIONS) {
    const c = p.coverage[op];
    if (!c) out.push(`coverage for ${op} is missing`);
    else if (c.status === 'supported' && !c.evidence) out.push(`${op} is "supported" without conformance evidence`);
  }
  if (p.coverage.navigate?.status === 'supported' && p.nativeCommandIdentity === 'none' && p.coverage.query?.status !== 'supported') out.push('navigation without a native command identity or a query cannot be reconciled');
  if (p.licence.redistributable === null || !p.licence.reviewRef) out.push('vendor licence / redistribution review is missing');
  return out;
}
export const untestedCoverage = (): VendorProfile['coverage'] => ({ navigate: { status: 'untested' }, cancel: { status: 'untested' }, query: { status: 'untested' }, stop: { status: 'untested' }, mapChange: { status: 'untested' }, reboot: { status: 'untested' } });
/** Adapters register by EXACT sdk + version + firmware. There is no "compatible with the 3.x family". */
export class VendorRegistry<T> {
  private entries = new Map<string, { profile: VendorProfile; adapter: T }>();
  private key = (n: string, v: string, f: string) => `${n}@${v}@${f}`;
  register(profile: VendorProfile, adapter: T): void {
    const problems = vendorProfileProblems(profile); if (problems.length) throw new Error('VENDOR_PROFILE_INVALID: ' + problems.join('; '));
    const k = this.key(profile.sdkName, profile.sdkVersion, profile.firmware); if (this.entries.has(k)) throw new Error('DUPLICATE_VENDOR_ADAPTER');
    this.entries.set(k, { profile, adapter });
  }
  resolve(sdkName: string, sdkVersion: string, firmware: string): T { const e = this.entries.get(this.key(sdkName, sdkVersion, firmware)); if (!e) throw new Error('UNSUPPORTED_VENDOR_VERSION'); return e.adapter; }
}
