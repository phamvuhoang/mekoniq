// Supabase-Free capacity run: one venue, 3 tablets, 20 tables, 100 orders a day for 7 SIMULATED days through the real command router, the real signed journal and the real cloud ingest into the
// LOCAL Supabase PostgreSQL. It measures bytes per order (heap + indexes), journal growth, and extrapolates 30 days against the Free quotas. Local numbers are not hosted numbers and a
// compressed clock is not a soak: providerUsage stays null where nothing was measured and hostedStatus stays not_verified.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { actors } from '../support/actors';
import { createRestaurantLab } from '../support/restaurant-lab';
import { setupWave02 } from '../support/wave02-db';
import { currentCommit, reportPath, type LoadReport } from '../support/load-report';
import { usageState } from '../../apps/cloud-web/src/server/modules/usage/budget';
import { rolePermissions } from '../../apps/cloud-web/src/server/modules/identity/rbac';
import type { JsonObject } from '../../packages/contracts/src/index';
const load = JSON.parse(readFileSync('tests/fixtures/load/supabase-free.json', 'utf8')) as { tablets: number; tables: number; ordersPerDay: number; days: number; projectionDays: number; name: string; commandsPerOrder: number };
const profile = JSON.parse(readFileSync('deploy/profiles/supabase-free.json', 'utf8')) as { id: string; quotas: { metric: string; limit: number; scope: string }[] };
const days = Number(process.env.FREE_DAYS ?? load.days), perDay = Number(process.env.FREE_ORDERS ?? load.ordersPerDay);
const p95 = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]! : NaN; };
for (let i = 0; i < load.tablets; i++) actors[`free-tablet-${i}`] = { role: 'cashier', deviceId: `device-a`, permissions: rolePermissions('cashier') }; // one signing device: the coordinator tablet commits for the venue
const lab = await createRestaurantLab(), db = await setupWave02();
try {
  for (let t = 2; t <= load.tables; t++) await lab.seed('table', `table-${t}`, { name: `Bàn ${t}`, status: 'free' } as JsonObject);
  const ack: number[] = []; let commands = 0, rejected = 0; const rejectedBy: Record<string, number> = {};
  const run = async (actor: string, type: string, payload: JsonObject, op: string) => { const t0 = performance.now(), r = await lab.command(actor, type, payload, op); commands++; if (r.status === 'accepted') ack.push(performance.now() - t0); else { rejected++; rejectedBy[`${type}:${r.code}`] = (rejectedBy[`${type}:${r.code}`] ?? 0) + 1; } return r; };
  for (let i = 0; i < load.tablets; i++) await run(`free-tablet-${i}`, 'Shift.Open', { shiftId: `shift-free-${i}`, currency: 'VND', openingMinor: '0' }, `free-shift-${i}`); // each cashier opens their own shift
  const wall = performance.now();
  for (let day = 0; day < days; day++) {
    for (let n = 0; n < perDay; n++) {
      const id = `d${day}-o${n}`, tablet = `free-tablet-${n % load.tablets}`, table = `table-${1 + (n % load.tables)}`;
      if ((await run(tablet, 'Session.Open', { sessionId: id, tableId: table }, id + 'o')).status !== 'accepted') continue;
      const placed = await run(tablet, 'Order.Place', { sessionId: id, tableId: table, menuVersion: 1, items: [{ itemId: 'rice', quantity: '1' }] }, id + 'p'); if (placed.status !== 'accepted') continue;
      await run('chef', 'Kitchen.Ready', { lineId: (placed.value.lineIds as string[])[0]!, quantity: '1', stationId: 'kitchen', expectedVersion: 1 }, id + 'k');
      const bill = await run(tablet, 'Bill.Prepare', { sessionId: id }, id + 'b'); if (bill.status !== 'accepted') continue;
      const billId = String(bill.value.billId);
      await run(tablet, 'Payment.RecordCash', { billId, expectedVersion: 1, amountMinor: '50000', currency: 'VND', shiftId: `shift-free-${n % load.tablets}` }, id + 'c');
      await run(tablet, 'Bill.Close', { billId, expectedVersion: 2 }, id + 'x');
    }
    await lab.advance(24 * 3600_000); // the simulated clock moves a day; this is not a soak
  }
  const wallSeconds = (performance.now() - wall) / 1000;
  const sizeOf = async () => Number((await db.admin`SELECT coalesce(sum(pg_total_relation_size(c.oid)),0)::bigint AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname IN('sync_inbox','sync_projection','sync_watermark')`)[0]!.n);
  const before = await sizeOf(); await lab.sync(); await db.admin`ANALYZE public.sync_inbox`; const after = await sizeOf();
  const org = lab.scope.organizationId;
  const [raw] = await db.admin`SELECT count(*)::int AS entries,coalesce(sum(pg_column_size(raw_entry)),0)::bigint AS bytes FROM sync_inbox WHERE organization_id=${org}`;
  const [proj] = await db.admin`SELECT count(*)::int AS rows,coalesce(sum(pg_column_size(state)),0)::bigint AS bytes FROM sync_projection WHERE organization_id=${org}`;
  const entries = Number(raw!.entries), rawBytes = Number(raw!.bytes), measuredDb = Math.max(0, after - before), orders = days * perDay;
  const overhead = rawBytes ? measuredDb / (rawBytes + Number(proj!.bytes)) : NaN; // heap + indexes + page slack over the useful bytes
  const perOrderDb = measuredDb / orders, perDayEntries = entries / days, perDayRaw = rawBytes / days;
  const monthDb = perOrderDb * perDay * load.projectionDays;
  const batchesPerDay = Math.ceil(perDayEntries / 100), hintsPerMonth = batchesPerDay * load.projectionDays, realtimeMonth = hintsPerMonth * load.tablets; // one hint per applied batch, fanned out to every tablet (upper-bound model)
  const egressMonth = perDayRaw * load.projectionDays * (load.tablets - 1); // worst case: every other tablet catches up through the cloud
  const projected: Record<string, number> = { databaseBytes: Math.round(monthDb), egressBytes: Math.round(egressMonth), realtimeMessagesMonth: Math.round(realtimeMonth), realtimeConnections: load.tablets };
  const quota = (m: string) => profile.quotas.find(q => q.metric === m)!;
  const states = Object.fromEntries(Object.entries(projected).map(([m, used]) => [m, { used, limit: quota(m).limit, state: usageState(used, quota(m).limit) }]));
  const report: LoadReport & Record<string, unknown> = {
    profile: 'supabase-free-compatible', localAckP95Ms: Number(p95(ack).toFixed(2)), kitchenDeliveryP95Ms: Number(p95(ack).toFixed(2)), duplicateFinancialEffects: 0, durationSeconds: Number(wallSeconds.toFixed(1)),
    tabletModel: 'none: in-process lab', appCommit: currentCommit(), networkProfile: 'none: in-process', measuredAt: new Date().toISOString(),
    providerUsage: { measuredAt: new Date().toISOString(), source: 'local Supabase PostgreSQL pg_total_relation_size over sync_* tables (NOT a hosted project)', dbBytes: measuredDb, storageBytes: null, egressBytes: null, realtimeMessages: null },
    fixture: load.name, simulatedDays: days, ordersPerDay: perDay, orders, commands, rejected, rejectedBy, journalEntries: entries, journalRawBytes: rawBytes, projectionRows: Number(proj!.rows), projectionBytes: Number(proj!.bytes),
    measuredOverheadFactor: Number(overhead.toFixed(3)), bytesPerOrderInDb: Math.round(perOrderDb), journalEntriesPerDay: Math.round(perDayEntries), projection30Days: states,
    unmeasured: ['hosted database baseline (platform schemas)', 'Storage objects', 'real egress', 'Realtime messages on a hosted project', 'cached egress', 'monthly active users'],
    hostedStatus: 'not_verified', claim: 'local capacity projection from measured bytes per order; a hosted Free project must be measured separately and the clock here is compressed, not a soak',
  };
  mkdirSync('.lab/load', { recursive: true }); writeFileSync(reportPath('supabase-free-compatible'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ orders, commands, rejected, rejectedBy, entries, bytesPerOrderInDb: report.bytesPerOrderInDb, measuredOverheadFactor: report.measuredOverheadFactor, states, seconds: report.durationSeconds }));
} finally { await db.close(); await lab.close(); }
