import { expect, test } from 'vitest';
import { cancelledAmounts } from '../../packages/domain/src/orders/amendment';
import { quoteOrder } from '../../packages/domain/src/pricing/quote';
import fixture from '../fixtures/restaurant-v1.json';
import type { JsonObject, Snapshot } from '../../packages/contracts/src/index';

const profile = (inclusive: boolean, discountOrder: string) => ({ taxProfiles: [{ id: 'vat', name: 'VAT', rateBps: 800, inclusive }], defaultTaxProfileId: 'vat', service: { rateBps: 500, taxable: false }, discountOrder, discounts: [{ id: 'ten', name: '10%', kind: 'percent', valueBps: 1000 }] });
test('cancelling a priced line unit by unit never drifts: monotone, non-negative, exactly the line total at the end', () => {
  for (const inclusive of [true, false]) for (const order of ['before_tax', 'after_tax']) for (const unit of ['1', '7', '999', '33333', '50001']) for (let qty = 1; qty <= 12; qty++) {
    const menu = { ref: { organizationId: 'o', venueId: 'v', kind: 'catalog', id: 'current' }, version: 1, state: { ...fixture.menu, items: fixture.menu.items.map(i => ({ ...i, unitMinor: unit })), pricing: profile(inclusive, order) } as unknown as JsonObject } as Snapshot;
    const line = quoteOrder({ menu, items: [{ itemId: 'rice', quantity: String(qty) }], discountIds: ['ten'], at: '2026-11-01T00:00:00Z', timeZone: 'UTC', policyRevision: 1 }).lines[0]!;
    let previous = 0n;
    for (let n = 1; n <= qty; n++) {
      const cancelled = cancelledAmounts(line, BigInt(n)), total = BigInt(String(cancelled.totalMinor));
      expect(total, `${unit} x${qty} cancel ${n}`).toBeGreaterThanOrEqual(previous);
      expect(total).toBeLessThanOrEqual(BigInt(String(line.totalMinor)));
      previous = total;
    }
    expect(previous).toBe(BigInt(String(line.totalMinor)));
    expect(cancelledAmounts(line, BigInt(qty)).subtotalMinor).toBe(line.subtotalMinor);
  }
});
