import type { IntegrationProfile } from '../../core/src/profile';
export type InvoiceLine = { description: string; quantity: string; unitMinor: string; amountMinor: string; taxBps?: number };
/** Everything an issue call is made from: the CLOSED bill's frozen snapshot plus the buyer. `requestKey` is stable per invoice request, so the provider (and our own `query`) can recognise a repeat. */
export type IssueInput = { requestKey: string; billId: string; currency: string; totalMinor: string; subtotalMinor: string; taxMinor: string; lines: InvoiceLine[]; buyer: { name: string; taxCode?: string; email?: string; address?: string } };
export type IssueResult =
  | { status: 'issued'; providerInvoiceId: string; code: string }
  | { status: 'rejected'; code: string; reason: string }
  | { status: 'rate_limited'; retryAfterMs: number }
  | { status: 'not_found' };
export type AdjustResult = { status: 'confirmed'; providerRef: string } | { status: 'rejected'; code: string };
/**
 * An e-invoice provider as the cloud needs it. `issue` may THROW (response lost): the caller then only `query`s with the same requestKey until the provider answers; it issues again only after
 * the provider says `not_found`. `amend` / `cancel` are optional: a provider whose status machine has no such operation does not implement them, and the cloud then refuses (never deletes).
 */
export interface InvoiceProvider {
  readonly profile: IntegrationProfile;
  issue(input: IssueInput): Promise<IssueResult>;
  query(ref: { requestKey: string }): Promise<IssueResult>;
  amend?(input: { requestKey: string; adjustmentKey: string; reason: string; deltaMinor: string }): Promise<AdjustResult>;
  cancel?(input: { requestKey: string; cancelKey: string; reason: string }): Promise<AdjustResult>;
}
