import type { AdjustResult, InvoiceProvider, IssueInput, IssueResult } from './provider-adapter';
import type { IntegrationProfile } from '../../core/src/profile';
/** Emulated e-invoice provider (mode `simulation`): our model of "a provider with a unique request key", never a statement about a real one. It checks that lines + tax add up. */
export function createSimInvoiceProvider(profile: IntegrationProfile) {
  const invoices = new Map<string, Extract<IssueResult, { status: 'issued' }> | Extract<IssueResult, { status: 'rejected' }>>();
  const adjustments = new Map<string, AdjustResult>();
  const faults = { issueResponseLostNext: 0, issueDropNext: 0, issueRateLimitNext: 0, queryFailNext: 0 }; // issueDropNext: the call dies before the provider saw it
  const calls: Record<string, number> = { issue: 0, query: 0, amend: 0, cancel: 0 };
  let serial = 0;
  const totalsOk = (i: IssueInput) => i.lines.reduce((s, l) => s + BigInt(l.amountMinor), 0n) === BigInt(i.subtotalMinor) && BigInt(i.subtotalMinor) + BigInt(i.taxMinor) === BigInt(i.totalMinor);
  const provider: InvoiceProvider = {
    profile,
    async issue(input) {
      calls.issue!++;
      if (faults.issueRateLimitNext > 0) { faults.issueRateLimitNext--; return { status: 'rate_limited', retryAfterMs: 1000 }; }
      if (faults.issueDropNext > 0) { faults.issueDropNext--; throw new Error('CONNECTION_RESET'); }
      let result = invoices.get(input.requestKey);
      if (!result) {
        result = totalsOk(input) ? { status: 'issued', providerInvoiceId: 'sim-inv-' + (++serial), code: 'SIM/' + String(serial).padStart(6, '0') } : { status: 'rejected', code: 'TOTAL_MISMATCH', reason: 'lines and tax do not add up to the total' };
        invoices.set(input.requestKey, result);
      }
      if (faults.issueResponseLostNext > 0) { faults.issueResponseLostNext--; throw new Error('PROVIDER_TIMEOUT'); } // the provider acted; the answer never arrived
      return result;
    },
    async query(ref) {
      calls.query!++;
      if (faults.queryFailNext > 0) { faults.queryFailNext--; throw new Error('PROVIDER_TIMEOUT'); }
      return invoices.get(ref.requestKey) ?? { status: 'not_found' };
    },
    async amend(input) { calls.amend!++; const r = adjustments.get(input.adjustmentKey) ?? (invoices.get(input.requestKey)?.status === 'issued' ? { status: 'confirmed', providerRef: 'sim-adj-' + input.adjustmentKey.slice(0, 8) } as const : { status: 'rejected', code: 'NOT_ISSUED' } as const); adjustments.set(input.adjustmentKey, r); return r; },
    async cancel(input) { calls.cancel!++; const r = adjustments.get(input.cancelKey) ?? (invoices.get(input.requestKey)?.status === 'issued' ? { status: 'confirmed', providerRef: 'sim-can-' + input.cancelKey.slice(0, 8) } as const : { status: 'rejected', code: 'NOT_ISSUED' } as const); adjustments.set(input.cancelKey, r); return r; },
  };
  return { provider, faults, calls, issuedCount: () => [...invoices.values()].filter(v => v.status === 'issued').length };
}
