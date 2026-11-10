// WB04: WB-FD07 on the real Webots plant: two robots with their own drives and LiDARs, movers serialised by the source (__venue_movement__), the aisle zone one owner at a time.
// Skipped, with the reason, where Webots R2025a or the .venv-webots interpreter is missing.
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { readNavigationEvidence } from '../../packages/lab-runtime/src/v2/navigation2d/evidence';
import { SCENARIO_FIXTURES, resolveScenarioFixture, scenarioAssertions } from '../../packages/lab-runtime/src/v2/navigation2d/scenario-fixtures';
import type { NavigationSceneV1 } from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import type { RunReport } from '../../packages/lab-runtime/src/v2/report';
import type { ScenarioRun } from '../../packages/lab-runtime/src/v2/scenario-runner';
import { finish, openWebotsRun, removeBundles, temp, webotsAvailable, webotsBundle, webotsProcesses } from '../support/webots-mission';

let fleet: Awaited<ReturnType<typeof webotsBundle>>;
const runs: ScenarioRun[] = [], dirs: string[] = [];
beforeAll(async () => { if (webotsAvailable) fleet = await webotsBundle('fleet-3d'); }, 120_000);
afterEach(async () => { for (const r of runs.splice(0)) await r.close().catch(() => {}); for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
afterAll(removeBundles);

test.skipIf(!webotsAvailable)('WB04 WB-FD07: both robots deliver within 12,000 ticks, the aisle zone has one granted owner at a time, and the report carries the serialisation note', async () => {
  const dir = await temp('webots-fleet-'); dirs.push(dir);
  const run = await openWebotsRun(dir, fleet, {}, 7, 'WB-FD07'); runs.push(run);
  await run.start(); await finish(run, 500, 12000);
  const r = await run.report() as RunReport;
  const scene = JSON.parse(Buffer.from(await fleet.service.bundleFile(fleet.locked.ref.bundleDigest, 'navigation-scene.json')).toString('utf8')) as NavigationSceneV1;
  const fixture = resolveScenarioFixture('WB-FD07', scene, 7);
  const read = await readNavigationEvidence(join(dir, 'evidence'), { chunks: r.navigation2d!.artifacts, ...r.navigation2d!.recording }, { scene });
  expect(r.outcome).toMatchObject({ status: 'completed', served: '2' }); expect(r.outcome.tick).toBeLessThanOrEqual(12000);
  expect(read.complete).toBe(true);
  const oracles = scenarioAssertions({ report: r, read, scene, fixture });
  expect(oracles.filter((a) => a.result !== 'pass').map((a) => `${a.id}: ${a.actual}`)).toEqual([]);
  expect(oracles.map((a) => a.id)).toEqual(expect.arrayContaining(['BOTH_ROBOTS_MOVED', 'ZONE_SINGLE_OWNER', 'ZONE_RELEASE_AFTER_EXIT', 'ROBOT_MAPPING', 'MIN_SEPARATION_AVAILABLE', 'WITHIN_TICKS']));
  // the note travels with the scenario: movers are serialised by __venue_movement__, and this release has no contention rig for Webots
  const label = SCENARIO_FIXTURES.get('WB-FD07')!.label;
  expect(label).toContain('__venue_movement__'); expect(label).toContain('no contention rig');
  expect(r.navigation2d!.engine).toMatchObject({ id: 'webots_3d' }); expect(r.coverage.dynamics).toBe(true);
  await run.close(); runs.length = 0; await new Promise((x) => setTimeout(x, 500));
  expect(webotsProcesses()).toEqual([]);
}, 900_000);
