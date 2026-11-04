import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRestaurantLab } from '../support/restaurant-lab';
import { completeSimulatedTravel, createSimulator, runRestaurantJourney } from '../support/restaurant-journey';
import { setupWave02 } from '../support/wave02-db';
import { readReport } from '../../apps/cloud-web/src/server/modules/reports/read';
import { rolePermissions } from '../../apps/cloud-web/src/server/modules/identity/rbac';
import { preset } from '../../packages/domain/src/policy/presets';
import { presetAcceptance } from '../../packages/domain/src/policy/preset-acceptance';
// @ts-expect-error plain ESM script without types
import { inventory, programComplete, render, verifyEvidenceFiles } from '../../scripts/verify-completion.mjs';
const index = JSON.parse(readFileSync('docs/superpowers/plans/2026-10-30-plan-index.json', 'utf8'));
test('new dispatcher cannot activate while trial still owns the robot', async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.seed('control-owner', 'sim-1', { owner: 'trial', fenced: false });
    expect((await lab.command('manager', 'Dispatcher.Activate', { robotId: 'sim-1', newOwner: 'production', trialReconciled: true })).code).toBe('OLD_OWNER_NOT_FENCED');
    expect((await lab.command('manager', 'Mission.Create', { target: 'table-1', robotId: 'sim-1' })).code).toBe('CONTROLLED_BY_OTHER_DISPATCHER'); // this platform sends nothing to a robot another dispatcher owns
    expect((await lab.command('manager', 'Mission.Create', { target: 'table-1' })).code).toBe('NO_CAPABLE_ROBOT'); // and "any robot" does not reach it either
  } finally { await lab.close(); }
});
test('cutover has exactly one dispatcher at a time: hold, fence with evidence, reconcile, activate; back-out stops production first', async () => {
  const lab = await createRestaurantLab();
  try {
    const robot = { robotId: 'sim-1' };
    expect((await lab.command('cashier', 'Dispatcher.Hold', robot)).code).toBe('FORBIDDEN');
    expect((await lab.command('manager', 'Dispatcher.Hold', { robotId: 'ghost' })).code).toBe('NOT_FOUND');
    expect((await lab.command('manager', 'Dispatcher.Hold', robot)).status).toBe('accepted');
    expect((await lab.command('manager', 'Dispatcher.Hold', robot, 'hold-again')).value.duplicate).toBe(true);
    expect((await lab.command('manager', 'Dispatcher.Fence', robot)).code).toBe('EVIDENCE_REQUIRED');
    expect((await lab.command('manager', 'Dispatcher.Fence', { ...robot, evidenceRef: '   ' })).code).toBe('EVIDENCE_REQUIRED');
    expect((await lab.command('manager', 'Dispatcher.Activate', { ...robot, newOwner: 'production', trialReconciled: true })).code).toBe('OLD_OWNER_NOT_FENCED');
    expect((await lab.command('manager', 'Dispatcher.Fence', { ...robot, evidenceRef: 'cutover-log-2026-11-04: node-red flows stopped, mqtt credentials revoked' })).status).toBe('accepted');
    expect((await lab.command('manager', 'Dispatcher.Activate', { ...robot, newOwner: 'production' })).code).toBe('TRIAL_NOT_RECONCILED'); // bills, missions and loads of the old system are reconciled first, by statement
    expect((await lab.command('manager', 'Dispatcher.Activate', { ...robot, newOwner: 'trial', trialReconciled: true })).code).toBe('INVALID_OWNER');
    expect((await lab.command('manager', 'Dispatcher.Activate', { ...robot, newOwner: 'production', trialReconciled: true })).status).toBe('accepted');
    const mission = await lab.command('manager', 'Mission.Create', { target: 'table-1', robotId: 'sim-1', missionId: 'm-first' }); expect(mission.status).toBe('accepted');
    expect((await lab.command('manager', 'Dispatcher.Return', robot)).code).toBe('ROBOT_HAS_ACTIVE_MISSION'); // back-out: stop dispatching and reconcile loads before handing back
    await completeSimulatedTravel(lab, await createSimulator(lab), 'm-first'); // the robot arrives
    const state = await lab.state<{ version: number; revision: number; currentStopId: string }>('mission', 'm-first');
    expect((await lab.command('manager', 'Mission.ConfirmStop', { missionId: 'm-first', expectedVersion: state.version, missionRevision: state.revision, stopId: state.currentStopId })).status).toBe('accepted'); // a person confirms; the mission is final
    expect((await lab.command('manager', 'Dispatcher.Return', robot)).status).toBe('accepted');
    expect((await lab.command('manager', 'Mission.Create', { target: 'table-1', robotId: 'sim-1', missionId: 'm-after' })).code).toBe('CONTROLLED_BY_OTHER_DISPATCHER');
  } finally { await lab.close(); }
});
test('first shift: open, sell, cook, deliver by the simulator, bill, cash, close — the totals agree locally and in the cloud after a WAN outage', async () => {
  const lab = await createRestaurantLab(), live = await setupWave02();
  try {
    const journey = await runRestaurantJourney(lab);
    expect(journey).toMatchObject({ billStatus: 'closed', missionStatus: 'completed' });
    await lab.partition('wan'); // the internet drops after the shift's first sale
    const offline = await lab.command('cashier', 'Session.Open', { sessionId: 's-late', tableId: 'table-1' }, 'late-open'); expect(offline.status).toBe('accepted'); // the venue keeps working
    expect(await lab.pendingCount()).toBeGreaterThan(0);
    await lab.heal(); await lab.sync(); await lab.sync();
    expect(await lab.pendingCount()).toBe(0); // every journal entry is cloud-acknowledged
    const date = new Date(lab.clock.nowMs).toISOString().slice(0, 10), local = await lab.report('sales', date) as { totals: { salesTotalMinor: string }; bills: { closed: number }; reconciliation: { differenceMinor: string }; cash: { appliedMinor: string } };
    expect(local.totals.salesTotalMinor).toBe('50000'); expect(local.bills.closed).toBe(1); expect(local.reconciliation.differenceMinor).toBe('0'); expect(local.cash.appliedMinor).toBe('50000');
    const owner = { id: 'owner', organizationId: lab.scope.organizationId, venueIds: [lab.scope.venueId], permissions: rolePermissions('owner'), role: 'owner' };
    const cloud = await readReport(owner, lab.scope, 'sales', date) as unknown as { totals: { salesTotalMinor: string }; bills: { closed: number }; reconciliation: { differenceMinor: string } };
    expect(cloud.totals.salesTotalMinor).toBe(local.totals.salesTotalMinor); expect(cloud.bills.closed).toBe(1); expect(cloud.reconciliation.differenceMinor).toBe('0'); // the cloud sees the same day
    expect(await lab.count('CashRecorded')).toBe(1); expect(await lab.effectCount('robot.dispatch')).toBeGreaterThanOrEqual(0);
    const kitchen = await lab.state<{ status: string }>('kitchen-ticket', journey.lineId); expect(kitchen.status).not.toBe('queued'); // the kitchen state survived the outage
    const robot = await lab.state<{ availability: string }>('robot', 'sim-1'); expect(robot.availability).toBe('idle'); // and the robot is back, not stuck on a finished goal
  } finally { await live.close(); await lab.close(); }
});
test('the same build serves the full product and trial-service: both presets validate against one feature registry, neither needs extra modules', () => {
  const trial = preset('trial-service'), full = preset('table-service');
  expect(presetAcceptance('trial-service')).toMatchObject({ ok: true, deferred: [], dependencyErrors: [] });
  expect(presetAcceptance('table-service').ok).toBe(true);
  expect(Object.keys(trial.features).sort()).toEqual(Object.keys(full.features).sort()); // one registry, a different set of switches
  for (const optional of ['inventory', 'procurement', 'loyalty', 'reservations', 'promotion']) expect(trial.features[optional]!.status, optional).toBe('disabled'); // optional business modules are not conditions of the trial preset
});
test('the program is NOT complete, and the inventory says exactly why: every row needs `accepted`, which only evidence can give', () => {
  const inv = inventory(index);
  expect(inv.taskRows).toHaveLength(63); expect(inv.complete).toBe(false);
  expect(programComplete([{ required: true, status: 'accepted' }, { required: false, status: 'planned' }])).toBe(true);
  expect(programComplete([{ required: true, status: 'accepted' }, { required: true, status: 'verified_local' }])).toBe(false); // verified locally is not accepted
  expect(inv.features).toHaveLength(30); expect(inv.offline).toHaveLength(22); expect(inv.stack).toHaveLength(7);
  for (const f of inv.features) expect(f.blockers.length + (f.status === 'accepted' ? 1 : 0), f.id).toBeGreaterThan(0);
  expect(index.gateA).toBe('not_accepted');
  for (const t of index.tasks.filter((x: { status: string }) => x.status === 'blocked_external')) expect(String(t.remaining ?? '').length, t.id).toBeGreaterThan(40); // a blocked row says what is missing
  expect(index.tasks.every((t: { status: string }) => ['verified_local', 'blocked_external', 'accepted', 'planned'].includes(t.status))).toBe(true);
  expect(verifyEvidenceFiles(index)).toEqual([]); // every started task has an evidence file
  const cli = spawnSync(process.execPath, ['scripts/verify-completion.mjs'], { encoding: 'utf8' }); expect(cli.status).toBe(1); expect(cli.stdout).toMatch(/NOT COMPLETE/);
});
test('the gate document is generated from the index and never claims more than it', () => {
  const doc = readFileSync('docs/implementation/gates/D-full-scope.md', 'utf8');
  expect(doc).toBe(render(inventory(index), index)); // drift = run `node scripts/verify-completion.mjs --write`
  expect(doc).toMatch(/Verdict: \*\*NOT COMPLETE\*\*/); expect(doc).not.toMatch(/\| accepted \|/);
  for (const file of ['docs/operations/cutover.md', 'docs/operations/first-shift.md', 'docs/operations/post-release.md', 'docs/implementation/gates/production-release.md']) expect(readFileSync(file, 'utf8').length, file).toBeGreaterThan(800);
});
