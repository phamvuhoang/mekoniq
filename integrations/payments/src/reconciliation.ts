import type { ProviderState } from './provider-adapter';
export type Expected = { merchant: string; currency: string; amount: string };
export function matchesPayment(expected: Expected, actual: Expected): boolean {
  return expected.merchant === actual.merchant && expected.currency === actual.currency && expected.amount === actual.amount;
}
/**
 * What an authoritative provider state means for the intent we created.
 *  settle   — captured, our merchant, our currency, exactly our amount: tell the venue.
 *  unapplied — real money arrived to OUR merchant but not as expected (other amount / currency): it is kept, shown, never applied to the bill and never deleted.
 *  foreign  — captured for another merchant: not ours, not recorded as money.
 *  wait     — still pending or not found yet (a webhook can precede the provider's own query result).
 *  close    — failed or expired: no money.
 */
export type Verdict = 'settle' | 'unapplied' | 'foreign' | 'wait' | 'close';
export function judge(expected: Expected & { payee?: string }, state: ProviderState): Verdict {
  if (state.status === 'failed' || state.status === 'expired') return 'close';
  if (state.status !== 'captured') return 'wait';
  if (state.merchantId !== expected.merchant || (expected.payee !== undefined && state.payee !== undefined && state.payee !== expected.payee)) return 'foreign';
  return matchesPayment(expected, { merchant: state.merchantId, currency: state.currency, amount: state.amountMinor }) ? 'settle' : 'unapplied';
}
/** Refund bookkeeping: a refund can never exceed what was captured and not yet refunded. */
export function refundable(capturedMinor: string, refundedMinor: string): string { return String(BigInt(capturedMinor) - BigInt(refundedMinor)); }
