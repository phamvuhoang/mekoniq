import type { JsonObject, Snapshot } from '../../../packages/contracts/src/index';
import { csvCell } from '../../../packages/domain/src/reporting/report';
import { dayOf } from '../../../packages/domain/src/reporting/sales';
/**
 * Accounting export, schema "mekoniq-accounting-1": one line per CLOSED bill of the venue's business date, money in minor units as text, with the invoice status beside it.
 * This is an export for a bookkeeper's tool. It is not a general ledger, does not compute payroll, and says nothing about tax filing.
 */
export const ACCOUNTING_SCHEMA = 'mekoniq-accounting-1';
export const ACCOUNTING_COLUMNS = ['businessDate', 'billId', 'currency', 'subtotalMinor', 'discountMinor', 'serviceMinor', 'taxMinor', 'totalMinor', 'paidMinor', 'refundedMinor', 'invoiceStatus', 'invoiceCode'] as const;
const text = (v: unknown): string => (v === undefined || v === null ? '' : String(v));
export function accountingLines(snapshots: Snapshot[], businessDate: string, timeZone: string): Record<(typeof ACCOUNTING_COLUMNS)[number], string>[] {
  const invoices = new Map(snapshots.filter(s => s.ref.kind === 'invoice-request').map(s => [String(s.state.billId), s.state]));
  return snapshots.filter(s => s.ref.kind === 'bill' && s.state.status === 'closed' && dayOf(s.state.closedAt, timeZone) === businessDate)
    .sort((a, b) => a.ref.id.localeCompare(b.ref.id)).map(b => {
      const summary = (b.state.summary ?? {}) as JsonObject, inv = invoices.get(b.ref.id);
      return { businessDate, billId: b.ref.id, currency: text(b.state.currency), subtotalMinor: text(summary.subtotalMinor ?? b.state.totalMinor), discountMinor: text(summary.discountMinor ?? '0'), serviceMinor: text(summary.serviceMinor ?? '0'), taxMinor: text(summary.taxMinor ?? '0'),
        totalMinor: text(b.state.totalMinor), paidMinor: text(b.state.paidMinor ?? '0'), refundedMinor: text(b.state.refundedMinor ?? '0'),
        // "not issued" is stated, never blank-as-issued; an externally issued link is shown as such
        invoiceStatus: inv ? text(inv.status) : 'none', invoiceCode: inv ? text(inv.code ?? inv.externalNumber ?? '') : '' };
    });
}
export function accountingCsv(lines: ReturnType<typeof accountingLines>, header: { venueId: string; businessDate: string; asOf: string; complete: boolean }): string {
  const head = [`# ${ACCOUNTING_SCHEMA} venue=${header.venueId} businessDate=${header.businessDate} asOf=${header.asOf} complete=${header.complete}`, '# not a general ledger; invoiceStatus none = no invoice requested'];
  return head.join('\n') + '\n' + [ACCOUNTING_COLUMNS.join(','), ...lines.map(l => ACCOUNTING_COLUMNS.map(c => csvCell(l[c])).join(','))].join('\n') + '\n';
}
