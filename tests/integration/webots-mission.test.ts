// WB03: WB-FD01 through the real source domain on the real Webots plant: navigation only ends movement legs; the domain owns load, handoff and served.
// Skipped, with the reason, where Webots R2025a or the .venv-webots interpreter is missing.
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import { rm } from 'node:fs/promises';
import type { ScenarioRun } from '../../packages/lab-runtime/src/v2/scenario-runner';
import { join } from 'node:path';
import { readNavigationEvidence } from '../../packages/lab-runtime/src/v2/navigation2d/evidence';
import { resolveScenarioFixture, scenarioAssertions } from '../../packages/lab-runtime/src/v2/navigation2d/scenario-fixtures';
import type { NavigationSceneV1 } from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import { openWebotsRun, removeBundles, stepUntil, temp, webotsAvailable, webotsBundle, webotsProcesses } from '../support/webots-mission';

let bundle: Awaited<ReturnType<typeof webotsBundle>>;
const runs: ScenarioRun[] = [], dirs: string[] = [];
beforeAll(async () => { if (webotsAvailable) bundle = await webotsBundle(); }, 120_000);
afterEach(async () => { for (const r of runs.splice(0)) await r.close().catch(() => {}); for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
afterAll(removeBundles);

test.skipIf(!webotsAvailable)('WB03 WB-FD01: arriving at the table does not serve the order; served only after the scripted handoff, then the robot parks', async () => {
  const dir = await temp('webots-mission-'); dirs.push(dir);
  const run = await openWebotsRun(dir, bundle); runs.push(run);
  await run.start();
  let window = 0;
  const done = await stepUntil(run, async (v) => {
    const r = await run.report(), atTable = r.businessEvents.some((e) => e.type === 'RobotGoalCompleted' && e.state.position === 't-01'), handed = r.businessEvents.some((e) => e.type === 'DeliveryHandedOff');
    if (atTable && !handed) { expect(r.outcome.served).toBe('0'); window++; }
    return v.run.status === 'completed';
  }, 100);
  expect(window).toBeGreaterThan(0);
  const report = await run.report();
  expect(report.outcome).toMatchObject({ status: 'completed', served: '1' });
  expect(report.manifest.backends.map((b) => b.id)).toEqual(['webots_3d']);
  expect(report.coverage.dynamics).toBe(true);
  expect(report.limitations.join(' ')).toContain('not_calibrated');
  expect(report.navigation2d!.engine).toMatchObject({ id: 'webots_3d', engineVersion: 'R2025a', basicTimeStepMs: 20 });
  expect(report.navigation2d!.seed.engineSeedAlgorithm).toBe('webots-worldinfo-seed-v1');
  expect(report.navigation2d!.completeness).toEqual({ status: 'complete', reasons: [] });
  expect(done.tick).toBeGreaterThan(0);
  // every WB-FD01 oracle, recomputed from the stored evidence and the journal
  const scene = JSON.parse(Buffer.from(await bundle.service.bundleFile(bundle.locked.ref.bundleDigest, 'navigation-scene.json')).toString('utf8')) as NavigationSceneV1;
  const read = await readNavigationEvidence(join(dir, 'evidence'), { chunks: report.navigation2d!.artifacts, ...report.navigation2d!.recording }, { scene });
  expect(read.complete).toBe(true);
  const oracles = scenarioAssertions({ report, read, scene, fixture: resolveScenarioFixture('WB-FD01', scene, 5) });
  expect(oracles.filter((a) => a.result !== 'pass').map((a) => `${a.id}: ${a.actual}`)).toEqual([]);
  expect(oracles.map((a) => a.id)).toEqual(expect.arrayContaining(['EVIDENCE_COMPLETE', 'IDENTITY_BOUND', 'NO_SERVED_BEFORE_HANDOFF', 'BUSINESS_OUTCOME', 'NO_PHYSICAL_CONTACT']));
  await run.close(); runs.length = 0;
  await new Promise((r) => setTimeout(r, 500));
  expect(webotsProcesses()).toEqual([]);
}, 600_000);
