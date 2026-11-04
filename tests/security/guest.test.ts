import { afterAll, beforeAll, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setupWave02 } from '../support/wave02-db';
import { dispatchRequest } from '../../apps/cloud-web/src/server/route-registry';
test('guest and anonymous routes expose no staff capability and no secrets', async () => {
  const asGuest = (method: string, path: string, body?: unknown) => dispatchRequest(new Request('http://x' + path, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  // a table token is not a session: it grants nothing on staff routes, and a forged one is refused
  for (const token of ['', 'guest-token-forged', 'a.b.c', 'x'.repeat(5000)]) {
    for (const path of ['/v1/guest/session', '/v1/guest/commands']) {
      const res = await asGuest('POST', path, { token, type: 'Guest.PlaceOrder', payload: {} });
      expect(res.status, path).toBeGreaterThanOrEqual(400);
      const text = await res.text(); expect(text).not.toMatch(/privateKey|secret|stack|SELECT /i);
    }
  }
  for (const path of ['/v1/venues/venue-a/orders', '/v1/venues/venue-a/catalog', '/v1/chain/revisions', '/v1/automation/venues/venue-a/events?kind=robot']) expect((await asGuest('GET', path)).status, path).toBe(401);
  // the public menu of a venue that does not exist reveals nothing about other tenants
  const menu = await asGuest('GET', '/v1/guest/menu/no-such-org/no-such-venue'); expect(menu.status).toBeGreaterThanOrEqual(400);
  const body = await menu.text(); expect(body).not.toMatch(/organization_id|venue_id|payment|bill/i);
});
let db: Awaited<ReturnType<typeof setupWave02>>;
beforeAll(async () => { db = await setupWave02(); });
afterAll(async () => { if (db) await db.close(); });
test('the web checkout sandbox is closed by default and cannot be used to reach another tenant', async () => {
  delete process.env.CHANNELS_SANDBOX_WEB;
  const res = await dispatchRequest(new Request(`http://x/v1/channels/web-sandbox/${randomUUID()}/venue-a/orders`, { method: 'POST', body: JSON.stringify({ items: [{ itemId: 'tea', quantity: '1' }], currency: 'VND' }) }));
  expect(res.status).toBe(403);
});
