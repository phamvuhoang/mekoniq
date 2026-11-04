/** Cloud-side life of an external order. `received` means ONLY that we have it durably; the venue has not said yes. */
export type ExternalStatus = 'received' | 'accepted' | 'rejected' | 'expired' | 'quarantined';
const next: Record<ExternalStatus, ExternalStatus[]> = { received: ['accepted', 'rejected', 'expired'], accepted: [], rejected: [], expired: [], quarantined: [] };
export const isFinal = (s: ExternalStatus): boolean => next[s].length === 0;
/** Moves only forward from `received`; a decision is never overwritten (an accepted order is not expired away by a late sweep). Returns the status to keep. */
export function advance(current: ExternalStatus, wanted: ExternalStatus): ExternalStatus {
  return current === wanted || next[current].includes(wanted) ? wanted : current;
}
/** What the cloud tells the channel when it gives up on a request nobody at the venue answered. */
export type UnavailablePolicy = 'hold' | 'reject';
export function onVenueSilent(policy: UnavailablePolicy, nowMs: number, expiresAtMs: number): 'wait' | 'reject' | 'expire' {
  if (nowMs >= expiresAtMs) return 'expire';
  return policy === 'reject' ? 'reject' : 'wait';
}
