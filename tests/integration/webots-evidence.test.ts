// WB06 / WB07 on the real Webots plant: the durable evidence of WB-FD01 (every tick, 3D pose present, a missing chunk is a failed read) and its repeatability by seed.
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { loadOracleProfile } from '../../packages/lab-runtime/src/v2/algorithm/checker';
import { readNavigationEvidence } from '../../packages/lab-runtime/src/v2/navigation2d/evidence';
import type { NavigationSceneV1 } from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import type { RunReport } from '../../packages/lab-runtime/src/v2/report';
import type { ScenarioRun } from '../../packages/lab-runtime/src/v2/scenario-runner';
import { finish, openWebotsRun, removeBundles, temp, webotsAvailable, webotsBundle } from '../support/webots-mission';

let bundle: Awaited<ReturnType<typeof webotsBundle>>;
const runs: ScenarioRun[] = [], dirs: string[] = [];
beforeAll(async () => { if (webotsAvailable) bundle = await webotsBundle(); }, 120_000);
afterEach(async () => { for (const r of runs.splice(0)) await r.close().catch(() => {}); for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
afterAll(removeBundles);
const scene = async () => JSON.parse(Buffer.from(await bundle.service.bundleFile(bundle.locked.ref.bundleDigest, 'navigation-scene.json')).toString('utf8')) as NavigationSceneV1;
async function complete(seed: number) {
  const dir = await temp('webots-evidence-'); dirs.push(dir);
  const run = await openWebotsRun(dir, bundle, {}, seed); runs.push(run);
  await run.start(); await finish(run, 500, 30000);
  const report = await run.report() as RunReport;
  const read = await readNavigationEvidence(join(dir, 'evidence'), { chunks: report.navigation2d!.artifacts, ...report.navigation2d!.recording }, { scene: await scene() });
  return { dir, report, read };
}

test.skipIf(!webotsAvailable)('WB07 evidence: every tick of the four streams is stored, every trajectory record has its 3D pose, and a missing chunk makes the read fail', async () => {
  const { dir, report, read } = await complete(5);
  expect(report.outcome.status).toBe('completed');
  expect(read.complete).toBe(true); expect(read.issues).toEqual([]);
  expect(read.trajectory.map((t) => t.tick)).toEqual([...Array(report.outcome.tick + 1).keys()]);
  expect(read.trajectory.every((t) => t.robots.every((r) => r.pose3d && Number.isFinite(r.pose3d.z) && Math.abs(r.pose3d.roll) < 0.35 && Math.abs(r.pose3d.pitch) < 0.35))).toBe(true);
  expect(read.sensors.length).toBeGreaterThan(0); expect(read.control.length).toBe(report.outcome.tick);
  expect(read.sensors.every((s, i) => s.tick === i * 5)).toBe(true); // LiDAR at 10 Hz from tick 0
  expect(report.navigation2d!.completeness).toEqual({ status: 'complete', reasons: [] });
  // dropping one stored chunk is detected: a partial recording never reads as complete
  const files = (await readdir(join(dir, 'evidence'))).filter((f) => f.startsWith('trajectory-')).sort();
  expect(files.length).toBeGreaterThan(1);
  await rm(join(dir, 'evidence', files[1]!));
  const broken = await readNavigationEvidence(join(dir, 'evidence'), { chunks: report.navigation2d!.artifacts, ...report.navigation2d!.recording }, { scene: await scene() });
  expect(broken.complete).toBe(false); expect(broken.issues.length + broken.gaps.length).toBeGreaterThan(0);
}, 300_000);

test.skipIf(!webotsAvailable)('WB06 repeatability: three runs with the same seed give the same trajectory within the profile tolerance', async () => {
  const tol = loadOracleProfile().profile.webots!.repeatPoseM;
  const runsRead = [await complete(5), await complete(5), await complete(5)].map((x) => x.read);
  let worst = 0;
  for (const other of runsRead.slice(1)) {
    expect(other.trajectory.length).toBe(runsRead[0]!.trajectory.length);
    runsRead[0]!.trajectory.forEach((t, i) => t.robots.forEach((r, k) => { const o = other.trajectory[i]!.robots[k]!; worst = Math.max(worst, ...r.poseDriveMap.map((v, j) => Math.abs(v - o.poseDriveMap[j]!))); }));
  }
  console.log(`WB06 worst pose difference over all ticks: ${worst}`);
  expect(worst).toBeLessThanOrEqual(tol);
}, 600_000);
