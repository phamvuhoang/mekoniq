import type { ModuleRegistry } from '../modules';
import type { JsonObject } from '../../../contracts/src/index';
import type { FeatureConfig } from '../policy/registry';
import { refundNeedsAmendment } from '../../../../integrations/einvoice/src/amendment';
import { changed, created, done, fail, find, handle, note, requireCloudSource, requireState, text } from '../restaurant-context';
/** Frozen statuses of an invoice request at the venue. `issued` exists only through a provider's code (Invoice.Record); `external` is a link to something issued elsewhere, never an issue. */
export const INVOICE_STATUSES = ['requested', 'issued', 'rejected', 'cancelled', 'external'] as const;
const TAX_CODE = /^[0-9]{10}(-[0-9]{3})?$/;
/** Whether the books and an ISSUED invoice disagree: money given back after issue (`refundedAfterIssueMinor`) that the provider's confirmed adjustments (negative deltas) do not yet cover. */
export function amendmentDue(status: string, refundedAfterIssueMinor: string, adjustments: JsonObject[]): boolean {
  return refundNeedsAmendment(status, refundedAfterIssueMinor, String(adjustments.reduce((sum, a) => sum + BigInt(String(a.deltaMinor ?? '0')), 0n)));
}
export const invoiceRequestId = (billId: string): string => `inv-${billId}`;
/** Buyer data as the venue can check without a provider. Provider-specific rules (name registered against the tax code, address format) are checked by that provider's profile. */
export function validatedBuyer(raw: unknown): JsonObject {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('BUYER_REQUIRED');
  const b = raw as JsonObject, name = note(b.name, 'BUYER_NAME_REQUIRED');
  if (name.length > 120) return fail('BUYER_NAME_REQUIRED');
  if (b.taxCode !== undefined && (typeof b.taxCode !== 'string' || !TAX_CODE.test(b.taxCode))) return fail('INVALID_TAX_CODE');
  if (b.email !== undefined && (typeof b.email !== 'string' || !/^[^\s@]{1,64}@[^\s@]{1,255}$/.test(b.email))) return fail('INVALID_EMAIL');
  if (b.address !== undefined && (typeof b.address !== 'string' || b.address.length > 300)) return fail('INVALID_ADDRESS');
  return { name, ...(b.taxCode ? { taxCode: b.taxCode } : {}), ...(b.email ? { email: b.email } : {}), ...(b.address ? { address: b.address } : {}) };
}
export function registerInvoices(registry: ModuleRegistry): void {
  // Invoice.Request {billId,buyer}: ask for an e-invoice of a CLOSED bill. The bill's money and tax lines are copied now, so later configuration or refunds never change what the invoice is made from.
  handle(registry, 'Invoice.Request', (c, s) => {
    // The module must be switched on. Provider readiness is NOT checked here: a request is only a recorded wish that waits ("requested") until a certified provider profile exists in the cloud, so
    // offline tablets and venues without a provider yet lose nothing. The cloud runs a provider only for an enabled profile.
    const policy = find(s, 'configuration', 'applied') ?? fail('CONFIGURATION_REQUIRED');
    if ((policy.state.features as unknown as FeatureConfig)?.einvoice?.status !== 'enabled') return fail('FEATURE_DISABLED');
    const bill = requireState(s, 'bill', text(c.payload.billId)), id = invoiceRequestId(bill.ref.id), existing = find(s, 'invoice-request', id);
    if (existing) return done([], { requestId: id, status: String(existing.state.status), duplicate: true });
    if (bill.state.status !== 'closed') return fail('BILL_NOT_CLOSED');
    return done([created('InvoiceRequested', 'invoice-request', id, { billId: bill.ref.id, status: 'requested', buyer: validatedBuyer(c.payload.buyer), currency: bill.state.currency!, totalMinor: bill.state.totalMinor!,
      summary: (bill.state.summary ?? { subtotalMinor: bill.state.totalMinor! }) as JsonObject, requestedBy: c.actorRef, requestedAt: c.recordedAt, adjustments: [] })], { requestId: id });
  });
  // Invoice.Record {requestId,status,providerInvoiceId?,code?,reason?,adjustment?}: a provider's answer, forwarded by the cloud. "issued" needs the provider's invoice id AND code; a rejection needs the reason.
  handle(registry, 'Invoice.Record', (c, s) => {
    requireCloudSource(c, 'cloud-provider'); // an invoice is "issued" only by a provider's answer relayed by the cloud, never by a person
    const req = requireState(s, 'invoice-request', text(c.payload.requestId)), status = String(c.payload.status);
    if (!['issued', 'rejected', 'cancelled', 'adjusted'].includes(status)) return fail('INVALID_STATUS');
    const current = String(req.state.status);
    if (status === 'issued') {
      const providerInvoiceId = text(c.payload.providerInvoiceId, 'PROVIDER_ID_REQUIRED'), code = text(c.payload.code, 'PROVIDER_CODE_REQUIRED');
      if (current === 'issued') return req.state.providerInvoiceId === providerInvoiceId ? done([], { requestId: req.ref.id, duplicate: true }) : fail('INVOICE_ALREADY_ISSUED');
      if (current !== 'requested') return fail('INVOICE_NOT_PENDING');
      return done([changed('InvoiceIssued', req, { status: 'issued', providerInvoiceId, code, issuedAt: c.recordedAt })], { requestId: req.ref.id });
    }
    if (status === 'rejected') {
      if (current === 'rejected') return done([], { requestId: req.ref.id, duplicate: true });
      if (current !== 'requested') return fail('INVOICE_NOT_PENDING');
      return done([changed('InvoiceRejected', req, { status: 'rejected', rejectionReason: note(c.payload.reason, 'REASON_REQUIRED') })], { requestId: req.ref.id });
    }
    // cancel / adjust act on an issued invoice through the provider's own status machine; the venue only records what the provider confirmed
    if (current === 'cancelled' && status === 'cancelled') return done([], { requestId: req.ref.id, duplicate: true });
    if (current !== 'issued') return fail('INVOICE_NOT_ISSUED');
    const reason = note(c.payload.reason, 'REASON_REQUIRED'), providerRef = text(c.payload.providerRef, 'PROVIDER_CODE_REQUIRED');
    if (status === 'cancelled') return done([changed('InvoiceCancelled', req, { status: 'cancelled', amendmentDue: false, cancelReason: reason, cancelRef: providerRef })], { requestId: req.ref.id });
    const list = (req.state.adjustments ?? []) as JsonObject[];
    if (list.some(a => a.providerRef === providerRef)) return done([], { requestId: req.ref.id, duplicate: true });
    const next = [...list, { providerRef, reason, deltaMinor: String(c.payload.deltaMinor ?? '0'), at: c.recordedAt }];
    return done([changed('InvoiceAdjusted', req, { adjustments: next, amendmentDue: amendmentDue('issued', String(req.state.refundedAfterIssueMinor ?? '0'), next) })], { requestId: req.ref.id });
  });
  // Invoice.LinkExternal {billId,invoiceNumber,source}: a historical bill whose invoice was issued OUTSIDE this system. It is a link for lookup, never an issue.
  handle(registry, 'Invoice.LinkExternal', (c, s) => {
    const bill = requireState(s, 'bill', text(c.payload.billId)), id = invoiceRequestId(bill.ref.id);
    if (find(s, 'invoice-request', id)) return fail('INVOICE_EXISTS');
    return done([created('InvoiceLinkedExternal', 'invoice-request', id, { billId: bill.ref.id, status: 'external', externalNumber: text(c.payload.invoiceNumber), externalSource: text(c.payload.source), linkedBy: c.actorRef, linkedAt: c.recordedAt, adjustments: [] })], { requestId: id });
  });
}
