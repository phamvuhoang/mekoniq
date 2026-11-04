import { afterAll, beforeAll, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setupWave02 } from '../support/wave02-db';
import { createSupabaseActor } from '../support/supabase-auth';
import { dispatchRequest } from '../../apps/cloud-web/src/server/route-registry';
import { registerWave02Routes, type CloudRoute } from '../../apps/cloud-web/src/server/modules/routes';
let db: Awaited<ReturnType<typeof setupWave02>>, user: Awaited<ReturnType<typeof createSupabaseActor>>;
const scope = { organizationId: 'pay-' + randomUUID(), venueId: 'venue-a' };
const routes: CloudRoute[] = []; registerWave02Routes(r => routes.push(r));
const fill = (path: string) => path.replace(':venueId', scope.venueId).replace(/:[A-Za-z]+/g, 'x');
beforeAll(async () => { db = await setupWave02(); user = await createSupabaseActor(db.admin, scope, 'owner'); });
afterAll(async () => { if (user) await user.cleanup(); if (db) await db.close(); });
const send = (route: CloudRoute, body: string, auth = true) => dispatchRequest(new Request('http://x' + fill(route.path), { method: route.method, headers: { ...(auth ? { Authorization: `Bearer ${user.accessToken}` } : {}), 'Content-Type': 'application/json' }, body }));
test('no route reads a body larger than its own limit: 413 before any parsing or work', async () => {
  const posting = routes.filter(r => r.method !== 'GET');
  expect(posting.length).toBeGreaterThan(40);
  const bad: string[] = [];
  for (const route of posting) {
    const res = await send(route, '{"a":"' + 'x'.repeat(route.bodyLimit + 1) + '"}', route.permission !== null);
    if (res.status !== 413) bad.push(`${route.method} ${route.path} (${route.bodyLimit}) -> ${res.status}`);
  }
  expect(bad).toEqual([]);
});
test('hostile JSON is refused cleanly: duplicate keys, absurd nesting, prototype pollution, non-objects', async () => {
  const route = routes.find(r => r.path === '/v1/venues/:venueId/commands')!;
  const bomb = '['.repeat(5000) + ']'.repeat(5000);
  for (const body of ['{"type":"a","type":"b"}', bomb, '{"__proto__":{"polluted":"yes"},"type":"x","payload":{}}', '{"type":"x","payload":{"__proto__":{"polluted":"yes"}}}', '[]', '"text"', 'null', '{"type":"Promotion.Publish","payload":[]}']) {
    const res = await send(route, body);
    expect(res.status, body.slice(0, 40)).toBeGreaterThanOrEqual(400); expect(res.status).toBeLessThan(500);
  }
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
});
test('signed webhooks: an oversized body is refused before the signature work; a bad signature never reaches the parser', async () => {
  const hook = routes.find(r => r.path === '/v1/channels/:provider/webhooks')!, pay = routes.find(r => r.path === '/v1/payments/:profileId/webhooks')!;
  for (const route of [hook, pay]) {
    expect((await send(route, '{"a":"' + 'x'.repeat(70000) + '"}', false)).status).toBe(413);
    const res = await send(route, '{not json at all', false); expect([400, 403, 404, 503]).toContain(res.status); expect(res.status).not.toBe(200);
  }
  const bad = await dispatchRequest(new Request('http://x/v1/channels/sandbox-channel/webhooks', { method: 'POST', headers: { 'x-mekoniq-key-id': 'ck_doesnotexist0', 'x-mekoniq-timestamp': String(Date.now()), 'x-mekoniq-signature': 'v1=' + '0'.repeat(64) }, body: '{not json at all' }));
  expect(bad.status).toBe(403); // the signature is judged first: garbage JSON from an unauthenticated sender is not even parsed
});
test('amount and quantity fields are decimal strings: floats, exponents, negatives and huge numbers are refused', async () => {
  const route = routes.find(r => r.path === '/v1/venues/:venueId/payments/intents')!;
  for (const amountMinor of ['1.5', '1e3', '-5', '0', '1'.repeat(40), ' 5', '0x10', 'NaN']) {
    const res = await send(route, JSON.stringify({ billId: 'b', amountMinor, profileId: 'sim-payment' }));
    expect(res.status, amountMinor).toBeGreaterThanOrEqual(400);
  }
});
