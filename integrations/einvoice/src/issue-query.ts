/** Cloud-side status of one invoice request. `unknown` = an issue call was made and its outcome is not known. */
export type InvoiceState = 'draft' | 'unknown' | 'issued' | 'rejected' | 'cancelled';
/** The only safe next step: never issue while an earlier issue may have succeeded. */
export function nextInvoiceAction(status: string): 'issue' | 'query' | 'none' {
  return status === 'unknown' ? 'query' : status === 'draft' ? 'issue' : 'none';
}
/** What a `query` answer means. `not_found` proves the provider never took the request, so the request goes back to `draft` (and may be issued again). */
export function afterQuery(answer: 'issued' | 'rejected' | 'not_found'): InvoiceState {
  return answer === 'not_found' ? 'draft' : answer;
}
/** A deterministic provider key for a request: same request, same key, on every retry and on every server. */
export const requestKeyFor = (organizationId: string, venueId: string, requestId: string): string => `${organizationId}:${venueId}:${requestId}`;
