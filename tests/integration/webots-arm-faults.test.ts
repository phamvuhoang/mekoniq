// X06 / WA06 (R1.1) on the real Webots R2025a: what goes wrong while a WB-BV01 arm program runs. Every fault ends the run in needs_attention with the cup still in the gripper and
// nothing resent; every run leaves no Webots, no controller and no worker. Skipped, with the reason, where Webots or .venv-webots is missing.
import { afterEach, describe, expect, test } from 'vitest';
import { createScenarioRun } from '../../packages/lab-runtime/src/v2/scenario-runner';
import { loadOracleProfile } from '../../packages/lab-runtime/src/v2/algorithm/checker';
import type { RunView, ScenarioRun } from '../../packages/lab-runtime/src/v2/scenario-runner';
import { amrAsset, coffeeProject, act, stepUntil } from '../support/lab-v2';
import { armGateway, armInput, armProcesses, armWebotsAvailable, killProcesses, obstacleAtPose, openArmRun, removeArmDirs, weakJointFixture, armTemp } from '../support/webots-arm';

afterEach(removeArmDirs);
const PLACE = [-0.5, -0.3, 0.9, 0, 0.9, 0];
const heldByArm = (v: RunView) => v.coffee?.cups.some((c) => c.ownerKind === 'arm') ?? false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The run, its end state, and the report; the run is closed and the processes are checked gone. */
async function outcome(run: ScenarioRun, drive: (run: ScenarioRun) => Promise<RunView>) {
  try {
    const view = await drive(run), report = await run.report();
    return { view, report, stop: report.coffee!.armTrace.stop, cups: report.coffee!.cups.map((c) => `${c.ownerKind}:${c.ownerId}`), reasons: report.attention.map((a) => a.reason) };
  } finally { await run.close(); await sleep(800); }
}
const toEnd = (run: ScenarioRun) => stepUntil(run, undefined, 25, 60_000);
const nothingLeft = () => expect(armProcesses()).toEqual([]);

describe.skipIf(!armWebotsAvailable)('Webots arm faults (WA06)', () => {
  test('a real obstacle on the cup-place path: the engine reports the contact, the arm stops as ARM_COLLISION and the cup is still held', async () => {
    const gw = await armGateway({ armExtraStatics: [obstacleAtPose(PLACE)] }), { run } = await openArmRun(gw);
    const r = await outcome(run, async (run) => { await run.start(); return toEnd(run); });
    expect(r.view.run.status).toBe('needs_attention');
    expect(r.stop).toMatchObject({ latched: true, reconcileRequired: true, reason: 'ARM_COLLISION' });
    expect(r.cups[0]).toBe('arm:arm-1'); // picked, never released
    expect(r.reasons.length).toBeGreaterThan(0); expect(r.view.tick).toBeLessThan(20_000);
    expect(r.report.arm!.collision).toMatchObject({ id: 'ARM03', result: 'fail', reasonCodes: ['ARM_COLLISION'] });
    expect(r.report.arm!.armPlant.dynamics).toBe('assumed');
    nothingLeft();
  }, 300_000);

  test('an obstacle injected into the arm scene while the cup is held stops the arm the same way', async () => {
    const gw = await armGateway(), { run } = await openArmRun(gw);
    const r = await outcome(run, async (run) => {
      await run.start();
      await stepUntil(run, heldByArm, 5, 60_000); await stepUntil(run, (v) => v.tick % 5 === 0, 5, 60_000);
      await act(run, 'injectFault', { faultId: 'arm-collision' });
      return toEnd(run);
    });
    expect(r.stop).toMatchObject({ latched: true, reason: 'ARM_COLLISION' }); expect(r.cups[0]).toBe('arm:arm-1'); expect(r.view.run.status).toBe('needs_attention');
    nothingLeft();
  }, 300_000);

  test('a joint whose motor is 10 % of the fixture\'s cannot follow: ARM_FOLLOWING_ERROR within followTicks of the start, long before maxTicks', async () => {
    const profile = loadOracleProfile().profile.webotsArm!;
    const gw = await armGateway({ armFixtureDir: await weakJointFixture(1, 20) }), { run } = await openArmRun(gw);
    const r = await outcome(run, async (run) => { await run.start(); return toEnd(run); });
    expect(r.stop).toMatchObject({ latched: true, reason: 'ARM_FOLLOWING_ERROR' });
    const firstTick = r.report.coffee!.armTrace.stop!.events[0]!.tick;
    expect(firstTick).toBeLessThanOrEqual(profile.followTicks + 10); // the arm sags from the first tick: the deviation passes followTolRad within a few ticks, then followTicks of it
    expect(r.view.run.status).toBe('needs_attention'); expect(r.view.tick).toBeLessThan(20_000); // not the scenario's 180,000-tick bound
    expect(r.cups.every((c) => c === 'cell:coffee-1')).toBe(true); // the arm never took a cup
    nothingLeft();
  }, 300_000);

  test('SIGKILL of the worker in the middle of cup-pick: the outcome is unknown, nothing is resent, no process is left', async () => {
    const gw = await armGateway(), { run } = await openArmRun(gw);
    const r = await outcome(run, async (run) => {
      await run.start();
      await stepUntil(run, (v) => v.coffee?.jobs.some((j) => j.status === 'transferring') ?? false, 5, 60_000);
      expect(killProcesses('webots_worker.*--run-id').length).toBeGreaterThan(0);
      return toEnd(run);
    });
    expect(r.stop).toMatchObject({ latched: true, reason: 'WORKER_LOST' });
    expect(r.view.run.status).toBe('needs_attention'); expect(r.reasons).toContain('TRANSFER_UNKNOWN'); expect(r.cups[0]).toBe('cell:coffee-1');
    nothingLeft();
  }, 300_000);

  test('SIGKILL of Webots in the middle of cup-place: unknown, the cup is still the arm\'s, no process is left', async () => {
    const gw = await armGateway(), { run } = await openArmRun(gw);
    const r = await outcome(run, async (run) => {
      await run.start();
      await stepUntil(run, heldByArm, 5, 60_000);
      expect(killProcesses('^[^ ]*/Contents/MacOS/webots ').length).toBe(1);
      return toEnd(run);
    });
    expect(r.stop?.latched).toBe(true); expect(['ENGINE_LOST', 'ENGINE_TIMEOUT', 'WORKER_LOST', 'WORKER_FAILED']).toContain(r.stop!.reason);
    expect(r.view.run.status).toBe('needs_attention'); expect(r.cups[0]).toBe('arm:arm-1');
    nothingLeft();
  }, 300_000);

  test('a cancel while the arm holds the cup does not release it: the job needs a reconcile', async () => {
    const gw = await armGateway(), { run } = await openArmRun(gw);
    const r = await outcome(run, async (run) => {
      await run.start();
      await stepUntil(run, heldByArm, 5, 60_000);
      await act(run, 'cancel', {});
      return toEnd(run);
    });
    expect(r.cups[0]).toBe('arm:arm-1'); expect(r.reasons).toContain('CANCEL_DURING_TRANSFER');
    expect(r.view.run.status).toBe('needs_attention');
    nothingLeft();
  }, 300_000);
});

describe('admission (no engine)', () => {
  test('BV01 is refused by the Webots arm set, and WB-BV01 by the mock set, before any provider effect', async () => {
    const gw = await armGateway().catch(() => null);
    if (gw) {
      await expect(gw.sim.simulationFactory(armInput(coffeeProject(), 1, 'BV01'), { directory: await armTemp('adm-'), catalog: gw.sim.catalog, enabledBackends: ['mock_amr', 'mock_coffee', 'mock_arm', ...gw.sim.enabledBackends] }))
        .rejects.toThrow('SCENARIO_UNSUPPORTED_BY_SET');
    }
    const mockInput = { ...armInput(coffeeProject(), 1, 'WB-BV01', 'mock-default'), mode: 'mock' as const };
    await expect(createScenarioRun(mockInput, { directory: await armTemp('adm-'), assets: [amrAsset], enabledBackends: ['mock_amr', 'mock_coffee', 'mock_arm'] })).rejects.toThrow('SCENARIO_UNSUPPORTED_BY_SET');
  });
});
