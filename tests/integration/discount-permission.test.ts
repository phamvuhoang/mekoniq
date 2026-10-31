import { expect, test } from 'vitest';
import { createRestaurantLab } from '../support/restaurant-lab';
import fixture from '../fixtures/restaurant-v1.json';
import type { JsonObject } from '../../packages/contracts/src/index';
const menu = { ...fixture.menu, pricing: { taxProfiles: [], defaultTaxProfileId: null, service: null, discountOrder: 'before_tax', discounts: [{ id: 'half', name: '50%', kind: 'percent', valueBps: 5000 }] } } as JsonObject;
const place = (discountIds?: string[]) => ({ sessionId: 'session-1', tableId: 'table-1', menuVersion: 1, items: [{ itemId: 'rice', quantity: '2' }], ...(discountIds ? { discountIds } : {}) });
async function priced() {
  const lab = await createRestaurantLab();
  await lab.seed('catalog', 'current', menu);
  await lab.command('cashier', 'Session.Open', { sessionId: 'session-1', tableId: 'table-1' });
  return lab;
}
test('coupons need discount.apply: cashier is rejected, manager accepted, plain orders unaffected', async () => {
  const lab = await priced(); try {
    expect((await lab.command('cashier', 'Order.Place', place(['half']))).code).toBe('FORBIDDEN');
    expect((await lab.command('cashier', 'Catalog.Quote', { items: [{ itemId: 'rice', quantity: '1' }], discountIds: ['half'] })).code).toBe('FORBIDDEN');
    expect((await lab.command('cashier', 'Order.Place', place([]), 'plain')).status).toBe('accepted');
    await lab.command('manager', 'Session.Open', { sessionId: 'session-2', tableId: 'table-2' });
    const accepted = await lab.command('manager', 'Order.Place', { ...place(['half']), sessionId: 'session-2', tableId: 'table-2' });
    expect(accepted.status).toBe('accepted');
    const order = await lab.state<{ totalMinor: string; lines: { discountMinor: string }[] }>('order', String(accepted.value.orderId));
    expect(order.totalMinor).toBe('50000'); expect(order.lines[0]!.discountMinor).toBe('50000');
    const amend = (actor: string, orderId: string, version: number) => lab.command(actor, 'Order.Amend', { orderId, expectedVersion: version, menuVersion: 1, items: [{ itemId: 'tea', quantity: '1' }], discountIds: ['half'] });
    expect((await amend('cashier', String(accepted.value.orderId), 1)).code).toBe('FORBIDDEN');
    expect((await amend('manager', String(accepted.value.orderId), 1)).status).toBe('accepted');
  } finally { await lab.close(); }
});
test('coupons are rejected when the discount feature is not enabled, even for a manager', async () => {
  const lab = await priced(); try {
    const configuration = fixture.configuration as unknown as { features: Record<string, unknown> };
    await lab.seed('configuration', 'applied', { ...configuration, features: { ...configuration.features, discount: { status: 'disabled', revision: 1 } } } as JsonObject);
    expect((await lab.command('manager', 'Order.Place', place(['half']))).code).toBe('FEATURE_DISABLED');
    expect((await lab.command('manager', 'Catalog.Quote', { items: [{ itemId: 'rice', quantity: '1' }], discountIds: ['half'] })).code).toBe('FEATURE_DISABLED');
    expect((await lab.command('manager', 'Order.Place', place(), 'no-coupon')).status).toBe('accepted');
  } finally { await lab.close(); }
});
