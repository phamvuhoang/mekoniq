/** Cloud-side life of an external order. `received` means ONLY that we have it durably; the venue has not said yes. */
export type ExternalStatus = 'received' | 'accepted' | 'rejected' | 'expired' | 'cancelled' | 'quarantined';
// a cancellation is the one thing that may follow an acceptance — and only because the venue itself applied it under the normal order-cancel rules
const next: Record<ExternalStatus, ExternalStatus[]> = { received: ['accepted', 'rejected', 'expired', 'cancelled'], accepted: ['cancelled'], rejected: [], expired: [], cancelled: [], quarantined: [] };
export const isFinal = (s: ExternalStatus): boolean => next[s].length === 0;
/** The wording a channel sees: `awaiting_restaurant` until the venue itself has said yes. */
export function channelStatus(venueAck: boolean, expired: boolean): 'accepted' | 'rejected' | 'awaiting_restaurant' {
  return expired ? 'rejected' : venueAck ? 'accepted' : 'awaiting_restaurant';
}
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
