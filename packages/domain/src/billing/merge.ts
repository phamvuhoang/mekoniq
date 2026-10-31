import type { ModuleRegistry } from '../modules';
import type { JsonObject } from '../../../contracts/src/index';
import { pricingRevisions, summarize } from '../pricing/quote';
import { changed, created, done, fail, find, handle, records, requireState, stableId, text } from '../restaurant-context';
import { assertUncollected, billSessions } from './bill';

const unique = (xs: string[]): string[] => [...new Set(xs)];
/**
 * Bill.Merge {bills:[{billId,expectedVersion}], billId?}: prepared bills that took no money, same currency, become one new prepared bill.
 * Nothing is dropped: lines keep their sourceBillId, orders/sessions are the union, sources stay as history (status merged, mergedInto).
 */
export function registerBillMerge(registry: ModuleRegistry): void {
  handle(registry, 'Bill.Merge', (c, s) => {
    const refs = Array.isArray(c.payload.bills) && c.payload.bills.length >= 2 && c.payload.bills.length <= 20 ? records(c.payload.bills) : fail('INVALID_MERGE');
    const bills = refs.map(r => {
      const bill = requireState(s, 'bill', text(r.billId));
      if (r.expectedVersion === undefined) return fail('VERSION_REQUIRED');
      if (r.expectedVersion !== bill.version) return fail('VERSION_CONFLICT');
      assertUncollected(s, bill);
      return bill;
    });
    if (new Set(bills.map(b => b.ref.id)).size !== bills.length) return fail('INVALID_MERGE');
    const currencies = new Set(bills.map(b => String(b.state.currency ?? 'VND')));
    if (currencies.size !== 1) return fail('CURRENCY_MISMATCH');
    const billId = c.payload.billId ? text(c.payload.billId) : stableId('bill', c);
    if (find(s, 'bill', billId)) return fail('BILL_EXISTS');
    const lines = bills.flatMap(b => ((b.state.lines ?? []) as JsonObject[]).map(l => ({ ...l, sourceBillId: b.ref.id })));
    const sessionIds = unique(bills.flatMap(b => billSessions(b.state)));
    const totalMinor = String(bills.reduce((a, b) => a + BigInt(String(b.state.totalMinor)), 0n));
    return done([
      created('BillsMerged', 'bill', billId, {
        sessionId: sessionIds[0] ?? null, sessionIds, tableId: bills[0]!.state.tableId ?? null, currency: [...currencies][0]!, totalMinor, paidMinor: '0', refundedMinor: '0', status: 'prepared',
        orderIds: unique(bills.flatMap(b => (b.state.orderIds ?? []) as string[])), lines, summary: summarize(lines), pricingRevisions: pricingRevisions(lines), mergedFrom: bills.map(b => b.ref.id), preparedAt: c.recordedAt,
      }),
      ...bills.map(b => changed('BillMergedInto', b, { status: 'merged', mergedInto: billId, mergedAt: c.recordedAt })),
    ], { billId, totalMinor, mergedFrom: bills.map(b => b.ref.id) });
  });
}
