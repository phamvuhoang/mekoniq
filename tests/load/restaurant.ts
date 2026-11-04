// LAN-scale benchmark: 20 logical tablets, 100 tables, 10 seeded robots, 10 commands per second, against the REAL command router and a real SQLite coordinator store (in-process lab).
// It measures the coordinator's commit path. It is NOT a device benchmark: no tablet, no radio, no WebSocket, no Android — the report says so.
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { actors } from '../support/actors';
import { createRestaurantLab } from '../support/restaurant-lab';
import { currentCommit, reportPath, type LoadReport } from '../support/load-report';
import { rolePermissions } from '../../apps/cloud-web/src/server/modules/identity/rbac';
import fixture from '../fixtures/restaurant-v1.json';
import type { JsonObject } from '../../packages/contracts/src/index';
const TABLETS = 20, TABLES = 100, ROBOTS = 10, RATE = Number(process.env.LOAD_RATE ?? 10), DURATION = Number(process.env.LOAD_SECONDS ?? 30), SEED = Number(process.env.LOAD_SEED ?? 20261104);
const p95 = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]! : NaN; };
let state = SEED; const rand = () => (state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32; // deterministic workload
for (let i = 0; i < TABLETS; i++) actors[`tablet-${i}`] = { role: 'cashier', deviceId: `tablet-${i}`, permissions: rolePermissions('cashier') };
const lab = await createRestaurantLab();
try {
  for (let t = 2; t <= TABLES; t++) await lab.seed('table', `table-${t}`, { name: `Bàn ${t}`, status: 'free' } as JsonObject);
  for (let r = 2; r <= ROBOTS; r++) await lab.seed('robot', `sim-${r}`, { ...(fixture.robot as JsonObject), id: `sim-${r}` });
  const ack: number[] = [], kitchen: number[] = [], rejected: Record<string, number> = {};
  const shifts = new Set<string>(); // each tablet's cashier opens a shift on first use, like a real morning
  let sent = 0, duplicates = 0, cashRecorded = 0;
  const started = performance.now();
  const timed = async (actor: string, type: string, payload: JsonObject, op: string) => {
    const due = started + (sent / RATE) * 1000, wait = due - performance.now(); if (wait > 0) await new Promise(r => setTimeout(r, wait)); sent++;
    const t0 = performance.now(), result = await lab.command(actor, type, payload, op), dt = performance.now() - t0;
    if (result.status === 'accepted') ack.push(dt); else rejected[`${type}:${result.code}`] = (rejected[`${type}:${result.code}`] ?? 0) + 1;
    return { result, dt };
  };
  for (let party = 0; performance.now() - started < DURATION * 1000; party++) {
    const tablet = `tablet-${Math.floor(rand() * TABLETS)}`, table = `table-${1 + Math.floor(rand() * TABLES)}`, session = `s-${party}`, id = (s: string) => `load-${party}-${s}`;
    if ((await timed(tablet, 'Session.Open', { sessionId: session, tableId: table }, id('open'))).result.status !== 'accepted') continue; // table still occupied by an earlier party: a real refusal, counted
    const placed = await timed(tablet, 'Order.Place', { sessionId: session, tableId: table, menuVersion: 1, items: [{ itemId: 'rice', quantity: '1' }] }, id('order'));
    if (placed.result.status !== 'accepted') continue;
    const lineId = (placed.result.value.lineIds as string[])[0]!, r0 = performance.now(); await lab.state('kitchen-ticket', lineId); kitchen.push(placed.dt + (performance.now() - r0)); // commit + read by the kitchen
    await timed('chef', 'Kitchen.Ready', { lineId, quantity: '1', stationId: 'kitchen', expectedVersion: 1 }, id('ready'));
    if (!shifts.has(tablet)) { shifts.add(tablet); await timed(tablet, 'Shift.Open', { shiftId: `shift-${tablet}`, currency: 'VND', openingMinor: '0' }, `load-shift-${tablet}`); }
    const bill = await timed(tablet, 'Bill.Prepare', { sessionId: session }, id('bill')); if (bill.result.status !== 'accepted') continue;
    const billId = String(bill.result.value.billId), cash = { billId, expectedVersion: 1, amountMinor: '50000', currency: 'VND', shiftId: `shift-${tablet}` };
    const paid = await timed(tablet, 'Payment.RecordCash', cash, id('cash'));
    if (paid.result.status === 'accepted') cashRecorded++;
    const again = await lab.command(tablet, 'Payment.RecordCash', cash, id('cash')); // the same tablet retries after a lost ACK
    if (again.status === 'accepted' && !again.duplicate) duplicates++;
    await timed(tablet, 'Bill.Close', { billId, expectedVersion: 2 }, id('close'));
  }
  const seconds = (performance.now() - started) / 1000, events = await lab.count('CashPaymentRecorded');
  const report: LoadReport & Record<string, unknown> = {
    profile: 'lan-scale', localAckP95Ms: Number(p95(ack).toFixed(2)), kitchenDeliveryP95Ms: Number(p95(kitchen).toFixed(2)), duplicateFinancialEffects: duplicates + Math.max(0, events - cashRecorded), durationSeconds: Number(seconds.toFixed(1)),
    tabletModel: 'none: in-process lab, no device', appCommit: currentCommit(), networkProfile: 'none: in-process, no LAN/WebSocket/Wi-Fi', measuredAt: new Date().toISOString(),
    seed: SEED, targetRatePerSecond: RATE, achievedRatePerSecond: Number((sent / seconds).toFixed(2)), commandsSent: sent, commandsAccepted: ack.length, logicalTablets: TABLETS, tables: TABLES, seededRobots: ROBOTS, robotMissionTraffic: false,
    rejected, kitchenDeliveryMeasure: 'Order.Place commit + a kitchen-ticket read in the same process (excludes LAN and WebSocket transport)', claim: 'coordinator commit path only; not a tablet, radio or soak result',
  };
  mkdirSync('.lab/load', { recursive: true }); writeFileSync(reportPath('lan-scale'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ localAckP95Ms: report.localAckP95Ms, kitchenDeliveryP95Ms: report.kitchenDeliveryP95Ms, duplicateFinancialEffects: report.duplicateFinancialEffects, achievedRatePerSecond: report.achievedRatePerSecond, commandsSent: sent, rejected }));
} finally { await lab.close(); }
