// WB-BV01 through the flag-on factory over the real worker session and a fake arm engine (tests/support/webots_doubles/fake_arm_plant.py): the runner, the report block and the fault paths
// without Webots. The real engine is covered by webots-arm-bv01 and webots-arm-faults.
import { afterEach, describe, expect, test } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { portableSimulationFromOptions } from '../../packages/lab-runtime/src/v2/navigation2d/readiness';
import { lockDigestOf } from '../../packages/lab-runtime/src/engineering/linkforge';
import { readArmTrace } from '../../packages/lab-runtime/src/v2/beverage/arm-plant-report';
import type { WebotsProvider } from '../../packages/lab-runtime/src/v2/simulation3d/readiness';
import type { WebotsRuntimeOptions } from '../../packages/lab-runtime/src/v2/simulation3d/webots';
import { amrAsset, coffeeProject, stepUntil } from '../support/lab-v2';
import { armInput, armTemp, removeArmDirs } from '../support/webots-arm';

const python = resolve('.venv-webots/bin/python'), root = resolve('robotics/simulation-3d'), double = resolve('tests/support/webots_doubles/fake_arm_plant.py');
afterEach(removeArmDirs);

async function open(mode: string, at = 0) {
  const runtime: WebotsRuntimeOptions = { python, workerRoot: root, schemaDir: resolve('packages/contracts/schemas'), lockDigest: await lockDigestOf(join(root, 'requirements.lock')), webotsHome: '/nonexistent',
    executableSha256: 'a'.repeat(64), basicTimeStepMs: 20, maxActiveRuns: 1, entry: [double, mode, String(at)] };
  const installed = { modes: ['simulation' as const], accesses: ['simulated' as const], installed: true, compatible: true, reachable: true, commissioned: true };
  const webots: WebotsProvider = { capability: { ...installed, id: 'webots_3d', installed: false, compatible: false, reachable: false }, arm: { runtime, capability: { ...installed, id: 'webots_arm' } } };
  const sim = await portableSimulationFromOptions({ enabled: false, python: 'python3', workerRoot: resolve('robotics/navigation-2d'), lockPath: resolve('robotics/navigation-2d/requirements.lock'), directory: await armTemp('arm-dbl-'), webots });
  const directory = join(await armTemp('arm-dbl-run-'), 'run'); await mkdir(directory, { recursive: true });
  const run = await sim.simulationFactory(armInput(coffeeProject(), 42), { directory, assets: [amrAsset], catalog: sim.catalog, enabledBackends: ['mock_amr', 'mock_coffee', 'mock_arm', ...sim.enabledBackends] });
  return { run, directory };
}
async function finish(mode: string, at = 0) {
  const { run, directory } = await open(mode, at);
  try { await run.start(); const view = await stepUntil(run, undefined, 25, 60_000); return { view, report: await run.report(), directory }; } finally { await run.close(); }
}

// (the first cup-pick runs from about engine step 1,440 to 1,670: a fault at step 1,500 is in the middle of it)
describe.skipIf(!existsSync(python))('WB-BV01 over a fake arm engine', () => {
  test('completes through the runner with both cups at the table, the arm block, ARM03 pass and the simulation-mode labels', async () => {
    const { view, report, directory } = await finish('ok');
    expect(view.run.status).toBe('completed'); expect(report.outcome).toMatchObject({ status: 'completed', served: '2' }); expect(report.attention).toEqual([]);
    expect(report.coffee!.cups.map((c) => [c.ownerKind, c.ownerId])).toEqual([['customer', 'table-1'], ['customer', 'table-1']]);
    expect(report.manifest).toMatchObject({ mode: 'simulation', backendSetId: 'engineering-webots-arm-v1', calibration: { status: 'not_calibrated' } });
    expect(view.run).toMatchObject({ mode: 'simulation' });
    expect(report.manifest.backends.map((b) => b.id).sort()).toEqual(['mock_amr', 'mock_coffee', 'webots_arm']);
    expect(report.arm!.collision).toMatchObject({ result: 'pass', reasonCodes: [], engine: 'capsule-sweep-v1' });
    // the Webots record and manifest carry none of the MuJoCo arm's additions (M07): no static-pairs note, no program record, the mock arm's interpolation, no cup trace
    expect(report.arm!.collision.allowedContacts).toEqual([]); expect(report.arm!.collision).not.toHaveProperty('allowedContactsNote'); expect(report.manifest).not.toHaveProperty('armProgram');
    expect(report.coffee!.armTrace).toMatchObject({ tag: 'mock_kinematic', interpolation: 'linear_joint_illustrative' }); expect(report.arm).not.toHaveProperty('props');
    expect(report.arm!.armPlant).toMatchObject({ engine: 'webots_3d', control: 'position_servo', grip: 'event', dynamics: 'assumed', calibration: 'not_calibrated' });
    expect(Math.max(...report.arm!.tracking.peakRad)).toBe(0); // this engine reaches every target at once
    const trace = await readArmTrace(directory, report.arm!);
    expect(trace.samples).toHaveLength(report.arm!.trace.samples); expect(report.arm!.trace.samples).toBeGreaterThan(300);
    expect(report.limitations.some((l) => l.startsWith('webots_arm:'))).toBe(true);
    // X07: the arm's telemetry is the plant's, with the actual and the commanded joints apart (a mock arm has no encoder: observed null)
    const armSamples = report.telemetry!.samples.filter((s) => s.entityId === 'arm-1');
    expect(armSamples.length).toBeGreaterThan(5);
    expect(armSamples.every((s) => s.origin === 'physics_sim' && s.providerId === 'webots_arm' && s.quality === 'valid' && s.reasonCodes.length === 0)).toBe(true);
    expect(armSamples.every((s) => (s.observed as { jointsRad: number[] }).jointsRad.length === 6 && (s.commanded as { jointsRad: number[] }).jointsRad.length === 6)).toBe(true);
  }, 120_000);

  test('a plant that lags a tick and sits 5 mrad off still completes, and the report says how far off it was', async () => {
    const { view, report } = await finish('lag');
    expect(view.run.status).toBe('completed');
    expect(report.arm!.tracking.peakRad[0]).toBeGreaterThan(0.004); expect(report.arm!.tracking.peakRad[0]).toBeLessThan(0.02);
  }, 120_000);

  test('a plant that never moves is a following error: needs_attention, nothing served, long before maxTicks', async () => {
    const { view, report } = await finish('stuck');
    expect(view.run.status).toBe('needs_attention'); expect(report.outcome.served).toBe('0'); expect(view.tick).toBeLessThan(20_000);
    expect(report.coffee!.armTrace.stop).toMatchObject({ latched: true, reason: 'ARM_FOLLOWING_ERROR' });
  }, 120_000);

  test('a worker that is lost mid-run leaves the transfer unknown and the run in needs_attention', async () => {
    const { view, report } = await finish('quit', 1500);
    expect(view.run.status).toBe('needs_attention'); expect(report.coffee!.armTrace.stop).toMatchObject({ latched: true, reason: 'WORKER_LOST' });
    expect(report.attention.map((a) => a.reason)).toContain('TRANSFER_UNKNOWN');
  }, 120_000);

  test('a contact the engine reports stops the arm as ARM_COLLISION and ARM03 says fail', async () => {
    const { view, report } = await finish('floor', 1500);
    expect(view.run.status).toBe('needs_attention'); expect(report.coffee!.armTrace.stop).toMatchObject({ latched: true, reason: 'ARM_COLLISION' });
    expect(report.arm!.collision).toMatchObject({ result: 'fail', reasonCodes: ['ARM_COLLISION'] });
  }, 120_000);
});
