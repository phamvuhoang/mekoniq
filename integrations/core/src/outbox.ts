import type { EffectResult } from './connector';
/**
 * Maps one attempt at a channel call onto the job runner's states. A thrown call is UNKNOWN: the channel may have acted, so the next step is `query`, never a blind repeat.
 * Rate limiting and definite refusals are retried by the runner's own back-off and end in dead_letter after its attempt limit; dead_letter is resolved only by a person (channel.operate).
 */
export type JobOutcome = { status: 'confirmed' | 'unknown' | 'failed'; value: Record<string, string | number> };
export function jobOutcome(result: EffectResult | { threw: string }): JobOutcome {
  if ('threw' in result) return { status: 'unknown', value: { code: result.threw } };
  switch (result.status) {
    case 'confirmed': return { status: 'confirmed', value: { providerRef: result.providerRef } };
    case 'rejected': return { status: 'failed', value: { code: result.code } };
    case 'rate_limited': return { status: 'failed', value: { code: 'RATE_LIMITED', retryAfterMs: result.retryAfterMs } };
    case 'not_found': return { status: 'failed', value: { code: 'NOT_FOUND_AT_PROVIDER' } };
  }
}
