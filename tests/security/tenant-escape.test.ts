import { afterAll, beforeAll, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setupWave02 } from '../support/wave02-db';
import { createSupabaseActor } from '../support/supabase-auth';
import { createRestaurantLab } from '../support/restaurant-lab';
import { dispatchRequest } from '../../apps/cloud-web/src/server/route-registry';
import { registerWave02Routes, type CloudRoute } from '../../apps/cloud-web/src/server/modules/routes';
import { ingestSignedBatch } from '../../apps/cloud-web/src/server/modules/sync/ingest';
import { cloudDatabase, withTenant } from '../../apps/cloud-web/src/server/modules/identity/tenant-context';
import { validDeviceScope } from '../../apps/cloud-web/src/server/modules/devices/scope';
let db: Awaited<ReturnType<typeof setupWave02>>, a: Awaited<ReturnType<typeof createSupabaseActor>>;
const scopeA = { organizationId: 'sec-a-' + randomUUID(), venueId: 'venue-a' }, scopeB = { organizationId: 'sec-b-' + randomUUID(), venueId: 'venue-b' };
beforeAll(async () => {
  db = await setupWave02(); a = await createSupabaseActor(db.admin, scopeA, 'owner'); // the strongest role in tenant A
  await db.admin`INSERT INTO venue(organization_id,id,name) VALUES(${scopeB.organizationId},${scopeB.venueId},'B') ON CONFLICT DO NOTHING`;
  await db.admin`INSERT INTO sync_projection(organization_id,venue_id,aggregate_type,aggregate_id,version,state,entry_id) VALUES(${scopeB.organizationId},${scopeB.venueId},'order','secret-order',1,'{"note":"tenant B only"}','b-1')`;
});
afterAll(async () => { if (a) await a.cleanup(); if (db) await db.close(); });
type Sql = ReturnType<typeof cloudDatabase>;
const inTx = <T>(work: (sql: Sql) => Promise<T>) => cloudDatabase().begin(tx => work(tx as unknown as Sql)) as Promise<T>;
const call = (method: string, path: string, body?: unknown, token = a.accessToken) => dispatchRequest(new Request('http://x' + path, { method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
test('foreign-scope signed journal is denied before projection', async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.command('cashier', 'Session.Open', { tableId: 'table-1', sessionId: 's1' });
    await lab.sync(); // enrols the lab's devices in the lab's own scope and applies their journal there
    const entries = await (await lab.getStore('coordinator')).journal(lab.scope);
    expect(entries.length).toBeGreaterThan(0);
    const before = await db.admin`SELECT count(*)::int AS n FROM sync_projection WHERE organization_id=${scopeB.organizationId}`;
    // the same correctly signed entries, offered under another tenant: the device is not enrolled there and the entry names another scope
    await expect(ingestSignedBatch(scopeB, entries.slice(0, 5))).rejects.toThrow();
    expect((await db.admin`SELECT count(*)::int AS n FROM sync_projection WHERE organization_id=${scopeB.organizationId}`)[0]!.n).toBe(before[0]!.n);
    expect((await db.admin`SELECT count(*)::int AS n FROM sync_inbox WHERE organization_id=${scopeB.organizationId}`)[0]!.n).toBe(0);
    expect(await lab.count('ForeignFactApplied')).toBe(0);
    expect(validDeviceScope({ organizationId: 'o', venueId: 'v' }, { organizationId: 'o', venueId: 'v' })).toBe(true);
    expect(validDeviceScope({ organizationId: 'o', venueId: 'v' }, { organizationId: 'o2', venueId: 'v' })).toBe(false);
    expect(validDeviceScope({ organizationId: 'o', venueId: 'v' }, { organizationId: 'o', venueId: 'v2' })).toBe(false);
  } finally { await lab.close(); }
});
test('every route that names a venue refuses an owner of another tenant, and no response carries the other tenant\'s data', async () => {
  const routes: CloudRoute[] = []; registerWave02Routes(r => routes.push(r));
  const venueRoutes = routes.filter(r => r.path.includes(':venueId'));
  expect(venueRoutes.length).toBeGreaterThan(30); // the sweep must actually cover the API
  const hits: string[] = [];
  for (const route of venueRoutes) {
    const path = route.path.replace(':venueId', scopeB.venueId).replace(/:[A-Za-z]+/g, 'x');
    const res = await call(route.method, path + (route.method === 'GET' ? '?kind=order&businessDate=2026-10-30&a=venue-a&b=venue-b' : ''), route.method === 'GET' ? undefined : {});
    const text = await res.text();
    if (res.status < 400 || /tenant B only|secret-order/.test(text)) hits.push(`${route.method} ${route.path} -> ${res.status}`);
  }
  expect(hits).toEqual([]);
});
test('routes that take the venue in the query or body are scoped the same way', async () => {
  const foreign = [
    await call('GET', `/v1/reports/sales?venueId=${scopeB.venueId}&businessDate=2026-10-30`),
    await call('GET', `/v1/assets/00000000-0000-4000-8000-000000000000/download?venueId=${scopeB.venueId}`),
    await call('POST', '/v1/assets/uploads', { venueId: scopeB.venueId, organizationId: scopeB.organizationId, role: 'owner' }),
    await call('POST', '/v1/assets/00000000-0000-4000-8000-000000000000/finalize', { venueId: scopeB.venueId }),
    await call('POST', '/v1/sync/pull', { venueId: scopeB.venueId, after: '0' }),
    await call('POST', '/v1/sync/handshake', { venueId: scopeB.venueId, deviceId: 'x', deviceEpoch: 'e' }),
    await call('GET', `/v1/chain/reports?kind=chain-sales&businessDate=2026-10-30&venues=${scopeB.venueId}`),
    await call('GET', `/v1/chain/compare?a=${scopeA.venueId}&b=${scopeB.venueId}`),
  ];
  expect(foreign.map(r => r.status).filter(s => s < 400)).toEqual([]);
});
test('the pooled database role cannot read across tenants even with a forged context, and does not bypass RLS', async () => {
  const mine = await withTenant(scopeA, sql => sql`SELECT aggregate_id FROM sync_projection`);
  expect(mine.map(r => r.aggregate_id)).not.toContain('secret-order');
  const none = await cloudDatabase()`SELECT aggregate_id FROM sync_projection`; expect(none).toHaveLength(0); // no tenant bound: nothing, not everything
  const forged = await inTx(async tx => { await tx`SELECT set_config('app.organization_id',${scopeB.organizationId},true)`; return tx`SELECT aggregate_id FROM sync_projection`; });
  expect(forged).toHaveLength(0); // an organisation without a venue binding still sees no venue-scoped row
  const [role] = await db.admin`SELECT rolbypassrls,rolsuper FROM pg_roles WHERE rolname='mekoniq_app'`; expect(role).toMatchObject({ rolbypassrls: false, rolsuper: false });
  for (const table of ['chain_revision', 'chain_rollout_target', 'external_order', 'channel_credential', 'payment_intent', 'invoice_request']) {
    const [t] = await db.admin`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=${'public.' + table}::regclass`;
    expect(t, table).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  }
});
test('chain-wide data is scoped by organisation: tenant A cannot see or change tenant B\'s chain rows', async () => {
  await db.admin`INSERT INTO chain_revision(organization_id,revision,snapshot,created_by) VALUES(${scopeB.organizationId},1,'{"currency":"VND","items":[]}','b-owner')`;
  const rows = await inTx(async tx => { await tx`SELECT set_config('app.organization_id',${scopeA.organizationId},true)`; return tx`SELECT organization_id FROM chain_revision`; });
  expect(rows).toHaveLength(0);
  await expect(inTx(async tx => { await tx`SELECT set_config('app.organization_id',${scopeA.organizationId},true)`; await tx`INSERT INTO chain_revision(organization_id,revision,snapshot,created_by) VALUES(${scopeB.organizationId},2,'{}','a-owner')`; })).rejects.toThrow();
});
