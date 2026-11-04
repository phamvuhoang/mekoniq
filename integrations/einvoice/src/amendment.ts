/** Adjustments, cancellations and refunds of an issued invoice follow the provider's status machine; nothing here deletes an invoice. */
export type AdjustmentAction = 'adjust' | 'cancel';
export function adjustmentAllowed(status: string, action: AdjustmentAction): boolean {
  if (status !== 'issued') return false; // draft/unknown/rejected were never issued; a cancelled one is final
  return action === 'adjust' || action === 'cancel';
}
/**
 * A refund of money on a bill whose invoice was ISSUED must be matched by an adjustment (or a cancellation) at the provider, otherwise the books and the invoice disagree.
 * `adjustedMinor` is the sum of confirmed adjustment deltas (negative numbers reduce the invoice), `cancelled` whether the invoice was cancelled.
 */
export function refundNeedsAmendment(invoiceStatus: string, refundMinor: string, adjustedMinor: string): boolean {
  if (invoiceStatus === 'cancelled' || invoiceStatus === 'requested' || invoiceStatus === 'draft' || invoiceStatus === 'external') return false;
  return invoiceStatus === 'issued' && BigInt(refundMinor) > 0n && -BigInt(adjustedMinor) < BigInt(refundMinor);
}
