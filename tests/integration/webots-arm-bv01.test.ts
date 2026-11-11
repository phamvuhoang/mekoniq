// X06 / WA05, WA07, WA08 (R1.1) on the real Webots R2025a: WB-BV01 through the flag-on gateway factory, twice with one seed. Skipped, with the reason, where Webots or .venv-webots is missing.
import { afterEach, describe, expect, test } from 'vitest';
import { loadOracleProfile } from '../../packages/lab-runtime/src/v2/algorithm/checker';
import { readArmTrace } from '../../packages/lab-runtime/src/v2/beverage/arm-plant-report';
import { armGateway, armProcesses, armWebotsAvailable, openArmRun, removeArmDirs } from '../support/webots-arm';
import { stepUntil } from '../support/lab-v2';

afterEach(removeArmDirs);
async function execute(gw: Awaited<ReturnType<typeof armGateway>>, seed: number) {
  const { run, directory } = await openArmRun(gw, { seed });
  try {
    await run.start();
    const view = await stepUntil(run, undefined, 25, 60_000);
    const report = await run.report();
    return { view, report, directory, trace: await readArmTrace(directory, report.arm!) };
  } finally { await run.close(); }
}
const maxDiff = (a: number[][], b: number[][]) => Math.max(...a.flatMap((row, i) => row.map((v, k) => Math.abs(v - b[i]![k]!))));

describe.skipIf(!armWebotsAvailable)('WB-BV01 on the Webots arm', () => {
  test('completes with both cups at the table, ARM03 pass on the actual joints and honest labels; a second run of the same seed repeats within repeatJointRad', async () => {
    const gw = await armGateway(), profile = loadOracleProfile().profile.webotsArm!;
    const runs = [await execute(gw, 42), await execute(gw, 42)];
    for (const { view, report, trace } of runs) {
      // WA05: the business outcome, the same as the mock's
      expect(view.run.status).toBe('completed');
      expect(report.outcome).toMatchObject({ status: 'completed', served: '2' }); expect(report.attention).toEqual([]);
      expect(report.coffee!.cups.map((c) => [c.ownerKind, c.ownerId])).toEqual([['customer', 'table-1'], ['customer', 'table-1']]);
      expect(report.coffee!.armTrace.stop).toBeNull(); expect(report.coffee!.armTrace.limitsOk).toBe(true);
      // what the run says it is
      expect(report.manifest).toMatchObject({ mode: 'simulation', access: 'simulated', backendSetId: 'engineering-webots-arm-v1', calibration: { status: 'not_calibrated' } });
      expect(report.manifest.backends.map((b) => b.id).sort()).toEqual(['mock_amr', 'mock_coffee', 'webots_arm']);
      expect(report.manifest.backends.find((b) => b.id === 'webots_arm')).toMatchObject({ version: 'R2025a', dynamics: true });
      expect(report.limitations.some((l) => l.startsWith('webots_arm:') && l.includes('not_calibrated'))).toBe(true);
      // WA08: the arm block. ARM03 on the actual joints, the plant labels, per-joint tracking, a trace file whose hash holds
      const arm = report.arm!;
      expect(arm.armPlant).toMatchObject({ engine: 'webots_3d', control: 'position_servo', grip: 'event', dynamics: 'assumed', calibration: 'not_calibrated' });
      expect(arm.collision).toMatchObject({ id: 'ARM03', result: 'pass', engine: 'capsule-sweep-v1', reasonCodes: [], colliding: [] });
      expect(arm.collision.coverage!.intervals).toBeGreaterThan(100); expect(arm.collision.trace!.samples).toBe(arm.trace.samples);
      expect(arm.collision.attachments.length).toBeGreaterThanOrEqual(2); // a cup held through each place
      expect(arm.tracking.samples).toBe(arm.trace.samples); expect(arm.tracking.peakRad).toHaveLength(6);
      arm.tracking.peakRad.forEach((p, i) => { expect(p, `J${i + 1}`).toBeLessThanOrEqual(profile.followTolRad); expect(arm.tracking.rmsRad[i]!).toBeLessThanOrEqual(p); });
      expect(trace.samples).toHaveLength(arm.trace.samples); expect(trace.samples[0]!.tick).toBeGreaterThan(0);
      expect(trace.samples.every((s) => s.actualRad.length === 6 && s.commandedRad.length === 6 && [...s.actualRad, ...s.commandedRad].every(Number.isFinite))).toBe(true);
    }
    // WA07: the same seed on a fresh engine. The outcome is the same; the commands are exact; the actual joints agree within the threshold (the engine is not bit-exact across processes)
    const [a, b] = runs;
    expect(b!.report.outcome.tick).toBe(a!.report.outcome.tick); expect(b!.report.outcome.status).toBe(a!.report.outcome.status);
    expect(b!.trace.samples.map((s) => s.tick)).toEqual(a!.trace.samples.map((s) => s.tick));
    expect(b!.trace.samples.map((s) => s.commandedRad)).toEqual(a!.trace.samples.map((s) => s.commandedRad));
    expect(maxDiff(a!.trace.samples.map((s) => s.actualRad), b!.trace.samples.map((s) => s.actualRad))).toBeLessThanOrEqual(profile.repeatJointRad);
    await new Promise((r) => setTimeout(r, 700));
    expect(armProcesses()).toEqual([]);
  }, 600_000);

  test('the trace file is the evidence: a changed byte is caught', async () => {
    const gw = await armGateway();
    const { report, directory } = await execute(gw, 7), tampered = { ...report.arm!, trace: { ...report.arm!.trace, sha256: '0'.repeat(64) } };
    await expect(readArmTrace(directory, tampered)).rejects.toThrow('ARM_TRACE_CORRUPT');
  }, 300_000);
});
