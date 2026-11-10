// X05 (R1.1 D19, D30): the Webots arm provider's registration, readiness and dispatch. The flag, interpreter, worker and Webots home are operator options; a worker double qualifies the wiring
// and never makes the provider installed. Nothing here starts Webots.
import { afterEach, expect, test } from 'vitest';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defaultCatalog, WEBOTS_ARM_UNCONFIGURED } from '../../packages/lab-runtime/src/v2/capabilities';
import { plantDispatcher, portableSimulationFromOptions } from '../../packages/lab-runtime/src/v2/navigation2d/readiness';
import { holdSlot, releaseSlot } from '../../packages/lab-runtime/src/v2/navigation2d/runner';
import { webotsFromOptions, type WebotsProvider } from '../../packages/lab-runtime/src/v2/simulation3d/readiness';
import { lockDigestOf } from '../../packages/lab-runtime/src/engineering/linkforge';
import type { WebotsRuntimeOptions } from '../../packages/lab-runtime/src/v2/simulation3d/webots';
import { coffeeProject } from '../support/lab-v2';

const root = resolve('robotics/simulation-3d'), lockPath = join(root, 'requirements.lock'), python = resolve('.venv-webots/bin/python');
const dirs: string[] = [];
afterEach(async () => { releaseSlot('webots_3d', 'other-run'); for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
const temp = async () => { const d = await mkdtemp(join(tmpdir(), 'webots-arm-ready-')); dirs.push(d); return d; };
const double = (mode: string) => [resolve('tests/support/webots_doubles/wire.py'), mode];
async function fakeHome() { const d = await temp(), exe = join(d, 'Webots.app', 'Contents', 'MacOS', 'webots'); await mkdir(join(d, 'Webots.app', 'Contents', 'MacOS'), { recursive: true }); await writeFile(exe, '#!/bin/sh\n'); await chmod(exe, 0o755); return join(d, 'Webots.app'); }
const opts = async (over: Partial<Parameters<typeof webotsFromOptions>[0]> = {}) => ({ enabled: true, python, workerRoot: root, lockPath, webotsHome: await fakeHome(), directory: await temp(), ...over });
const base = async () => ({ enabled: false, python: 'python3', workerRoot: resolve('robotics/navigation-2d'), lockPath: resolve('robotics/navigation-2d/requirements.lock'), directory: await temp() });
const arm = (c: { backends: readonly { id: string }[] }) => c.backends.find((b) => b.id === 'webots_arm') as unknown as { installed: boolean; reason?: string };
const ctx = (project: unknown = coffeeProject(), runId?: string) => ({ scenarioId: 'WB-BV01', backendSetId: 'engineering-webots-arm-v1', project, ...runId ? { runId } : {} });
const rows = (r: { id: string; reasonCodes: string[] }[]) => Object.fromEntries(r.map((x) => [x.id, x.reasonCodes]));

test('flag off: webots_arm is the catalog entry of a runtime never given the option, and nothing else moves', async () => {
  const off = await webotsFromOptions(await opts({ enabled: false }));
  expect(off.arm.capability).toEqual(WEBOTS_ARM_UNCONFIGURED);
  const b = await base(), without = await portableSimulationFromOptions(b), withOff = await portableSimulationFromOptions({ ...b, webots: off });
  expect(withOff.catalog).toEqual(without.catalog); expect(withOff.enabledBackends).toEqual(without.enabledBackends);
  expect(arm(defaultCatalog)).toMatchObject({ installed: false });
  expect(arm(without.catalog).reason?.startsWith('WEBOTS_DISABLED')).toBe(true);
  await expect(withOff.simulationFactory({ backendSetId: 'engineering-webots-arm-v1' } as never, { directory: await temp() })).rejects.toThrow('BACKEND_EXECUTION_DISABLED');
});

test('a worker double qualifies the wiring but never makes the arm installed; its readiness rows pass on the coffee project with the smoke on the arm scene', async () => {
  const p = await webotsFromOptions(await opts({ entry: double('arm') }));
  expect(p.arm.capability.reason?.startsWith('WEBOTS_TEST_DOUBLE')).toBe(true); expect(p.arm.capability.installed).toBe(false);
  const sim = await portableSimulationFromOptions({ ...(await base()), webots: p });
  expect(sim.enabledBackends).not.toContain('webots_arm');
  const checks = await sim.readinessChecks!(ctx() as never, new AbortController().signal);
  expect(rows(checks)).toEqual({ profile: [], model: [], fixture: [], clock: [], runner: [] });
  expect(checks.find((c) => c.id === 'runner')!.evidenceRef).toMatch(/^webots-arm-smoke:/);
});

test('readiness names what is missing: no arm collision profile, a foreign model, a full host, a smoke the worker refuses', async () => {
  const p = await webotsFromOptions(await opts({ entry: double('arm') })), sim = await portableSimulationFromOptions({ ...(await base()), webots: p }), signal = new AbortController().signal;
  const noProfile = coffeeProject() as { armCollisionProfile?: unknown }; delete noProfile.armCollisionProfile;
  expect(rows(await sim.readinessChecks!(ctx(noProfile) as never, signal)).fixture).toEqual(['ARM_SCENE_UNAVAILABLE']);
  const foreign = coffeeProject(); (foreign.armCollisionProfile as { modelId: string }).modelId = 'other-arm';
  expect(rows(await sim.readinessChecks!(ctx(foreign) as never, signal)).model).toEqual(['ARM_MODEL_MISMATCH']);
  holdSlot('webots_3d', 'other-run'); // webots_3d and webots_arm are one engine: a running AMR run blocks an arm run
  expect(rows(await sim.readinessChecks!(ctx() as never, signal)).runner).toContain('WEBOTS_CAPACITY');
  expect(rows(await sim.readinessChecks!(ctx(coffeeProject(), 'other-run') as never, signal)).runner).not.toContain('WEBOTS_CAPACITY'); // the holder is never counted against itself
  releaseSlot('webots_3d', 'other-run');
  const nogui = await webotsFromOptions(await opts({ entry: double('nogui') })), simNo = await portableSimulationFromOptions({ ...(await base()), webots: nogui });
  expect(rows(await simNo.readinessChecks!(ctx() as never, signal)).runner).toEqual(['WEBOTS_NO_GUI_SESSION']); // a missing window server is named, not a broken install
});

test('a live arm provider is a backend, an enabled backend, and the arm set dispatches to a run with arm ports; without the table it is refused', async () => {
  const runtime = { python, workerRoot: root, schemaDir: resolve('packages/contracts/schemas'), lockDigest: await lockDigestOf(lockPath), webotsHome: '/nonexistent', executableSha256: 'a'.repeat(64), basicTimeStepMs: 20, maxActiveRuns: 1 } as WebotsRuntimeOptions;
  const live: WebotsProvider = { capability: { id: 'webots_3d', modes: ['simulation'], accesses: ['simulated'], installed: false, compatible: false, reachable: false, commissioned: true, reason: 'not under test' },
    arm: { runtime, capability: { id: 'webots_arm', modes: ['simulation'], accesses: ['simulated'], installed: true, compatible: true, reachable: true, commissioned: true } } };
  const sim = await portableSimulationFromOptions({ ...(await base()), webots: live });
  expect(arm(sim.catalog).installed).toBe(true); expect(sim.enabledBackends).toContain('webots_arm');
  const input = { project: coffeeProject(), scenarioId: 'BV01', scenarioRevision: 1, seed: 1, mode: 'simulation', access: 'simulated', backendSetId: 'engineering-webots-arm-v1', sourceCommit: 'a'.repeat(40) } as never;
  // WB-BV01 arrives with X06; the plain BV01 is refused by the runner's own set check, which proves the run was handed to the shared runner (not to the portable AMR plants, which would say BACKEND_EXECUTION_DISABLED)
  const refused = await sim.simulationFactory(input, { directory: await temp(), catalog: sim.catalog, enabledBackends: sim.enabledBackends }).catch((e: Error) => e);
  expect(['MODE_BACKEND_MISMATCH', 'SCENARIO_UNSUPPORTED_BY_SET']).toContain((refused as Error).message);
  const without = plantDispatcher(sim.catalog, sim.plants);
  await expect(without(input, { directory: await temp() })).rejects.toThrow('BACKEND_EXECUTION_DISABLED');
});
