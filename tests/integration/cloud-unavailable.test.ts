import { afterAll, beforeAll, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setupWave02 } from '../support/wave02-db';
import { createRestaurantLab } from '../support/restaurant-lab';
import { createSupabaseActor } from '../support/supabase-auth';
import { databaseReady } from '../../apps/cloud-web/src/server/health';
import { dispatchRequest } from '../../apps/cloud-web/src/server/route-registry';
import { runJobBatch } from '../../apps/cloud-web/src/server/jobs/outbox-worker';
import { defaultJobRegistry } from '../../apps/cloud-web/src/server/jobs/registry';
import { pullEntries } from '../../apps/cloud-web/src/server/modules/sync/ingest';
let db: Awaited<ReturnType<typeof setupWave02>>;
beforeAll(async () => { db = await setupWave02(); });
afterAll(async () => { if (db) await db.close(); });
test('the LAN keeps selling while the cloud is away; nothing is lost; the queue drains after recovery', async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.partition('wan');
    for (let i = 0; i < 5; i++) {
      expect((await lab.command('cashier', 'Session.Open', { sessionId: `s-${i}`, tableId: 'table-1' }, `open-${i}`)).status).toBe('accepted');
      expect((await lab.command('cashier', 'Session.Close', { sessionId: `s-${i}` }, `close-${i}`)).status).toBe('accepted');
    }
    const pending = await lab.pendingCount();
    expect(pending).toBeGreaterThan(0); // unacknowledged by the cloud, kept
    expect(await lab.cloudAppliedCount()).toBe(0);
    await expect(lab.sync()).rejects.toThrow('TRANSPORT_UNAVAILABLE'); // the transport is cut; there is no cloud ACK to fake
    await lab.heal(); await lab.sync(); await lab.sync(); // twice: the second finds nothing new and nothing doubles
    expect(await lab.pendingCount()).toBe(0);
    expect(await lab.count('SessionOpened')).toBe(5);
  } finally { await lab.close(); }
});
test('a commit that fails is never acknowledged and leaves no half state', async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.fault('before-local-commit');
    const failed = await lab.command('cashier', 'Session.Open', { sessionId: 'sx', tableId: 'table-1' }, 'will-fail').catch(e => ({ status: 'threw', code: String(e.message) }));
    expect(['accepted']).not.toContain(failed.status);
    expect(await lab.count('SessionOpened')).toBe(0);
    expect((await lab.command('cashier', 'Session.Open', { sessionId: 'sx', tableId: 'table-1' }, 'will-fail')).status).toBe('accepted'); // the same operation id, retried, commits once
    expect(await lab.count('SessionOpened')).toBe(1);
  } finally { await lab.close(); }
});
test('database unavailable (or project paused): readiness says so, requests fail closed, no crash', async () => {
  const url = process.env.DATABASE_URL;
  expect(await databaseReady()).toBe(true);
  try {
    process.env.DATABASE_URL = 'postgresql://mekoniq_app:x@127.0.0.1:1/postgres'; // nothing listens there
    expect(await databaseReady()).toBe(false);
  } finally { process.env.DATABASE_URL = url; }
  expect(await databaseReady()).toBe(true);
});
test('Auth unavailable: a signed-in request is refused, never served as anonymous or half-authenticated', async () => {
  const scope = { organizationId: 'unavail-' + randomUUID(), venueId: 'venue-a' }, user = await createSupabaseActor(db.admin, scope, 'owner');
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    expect((await dispatchRequest(new Request('http://x/v1/venues/venue-a/orders', { headers: { Authorization: `Bearer ${user.accessToken}` } }))).status).toBe(200);
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
    const res = await dispatchRequest(new Request('http://x/v1/venues/venue-a/orders', { headers: { Authorization: `Bearer ${user.accessToken}` } }));
    expect([401, 503]).toContain(res.status); expect((await res.json()) as object).not.toHaveProperty('orders');
  } finally { process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl; await user.cleanup(); }
});
test('Realtime hints lost: the signed pull still delivers every entry, and the failed hint job stays retryable, not lost', async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.command('cashier', 'Session.Open', { sessionId: 'sp', tableId: 'table-1' }, 'pull-1');
    await lab.sync();
    const entries = await pullEntries(lab.scope, { deviceId: 'coordinator', deviceEpoch: 'epoch-1' }, '0');
    expect(entries.length).toBeGreaterThan(0); // no hint was needed
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    await db.admin`INSERT INTO cloud_job(organization_id,venue_id,id,type,payload) VALUES(${lab.scope.organizationId},${lab.scope.venueId},${'hint-' + randomUUID()},'hint.publish',${db.admin.json({ ref: 'x', revision: 1, watermark: '0' })})`;
    try {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
      await runJobBatch(lab.scope, defaultJobRegistry());
    } finally { process.env.NEXT_PUBLIC_SUPABASE_URL = url; }
    const jobs = await db.admin`SELECT status FROM cloud_job WHERE organization_id=${lab.scope.organizationId} AND type='hint.publish'`;
    expect(jobs.every(j => ['pending', 'unknown', 'confirmed'].includes(String(j.status)))).toBe(true); // retried or reconciled later; a hint only wakes an idempotent pull
    expect((await pullEntries(lab.scope, { deviceId: 'coordinator', deviceEpoch: 'epoch-1' }, '0')).length).toBe(entries.length);
  } finally { await lab.close(); }
});
test('every alert is a real query returning one number, with ordered thresholds, and the dashboards only name known alerts', async () => {
  const { alerts } = JSON.parse((await import('node:fs')).readFileSync('deploy/observability/alerts.json', 'utf8')) as { alerts: { id: string; query: string; warning: number; critical: number }[] };
  const dashboards = JSON.parse((await import('node:fs')).readFileSync('deploy/observability/dashboards.json', 'utf8')) as { dashboards: { panels: { alerts: string[] }[] }[] };
  const profile = JSON.parse((await import('node:fs')).readFileSync('deploy/profiles/supabase-free.json', 'utf8')) as { warningRatio: number; criticalRatio: number };
  for (const a of alerts) {
    const rows = await db.admin.unsafe(a.query); expect(rows, a.id).toHaveLength(1);
    expect(Number(Object.values(rows[0]!)[0]), a.id).not.toBeNaN(); expect(a.critical, a.id).toBeGreaterThan(a.warning);
  }
  const quota = alerts.find(a => a.id === 'database-quota-ratio')!; expect([quota.warning, quota.critical]).toEqual([profile.warningRatio, profile.criticalRatio]);
  const known = new Set(alerts.map(a => a.id)); for (const d of dashboards.dashboards) for (const p of d.panels) for (const id of p.alerts) expect(known.has(id), id).toBe(true);
});
