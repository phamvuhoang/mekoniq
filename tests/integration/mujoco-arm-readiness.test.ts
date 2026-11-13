// M06 step 4: the MuJoCo arm provider's registration, readiness, dispatch and health capability. The flag, interpreter, worker and lock are operator options. The provider rows run
// the real worker (.venv-mujoco): a describe at boot and a create smoke on the project's cell scene. Skipped, with the reason, where .venv-mujoco is missing (not_run, never a pass).
import { afterEach, describe, expect, test, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MUJOCO_ARM_UNCONFIGURED } from '../../packages/lab-runtime/src/v2/capabilities';
import { plantDispatcher, portableSimulationFromOptions } from '../../packages/lab-runtime/src/v2/navigation2d/readiness';
import { holdSlot, releaseSlot } from '../../packages/lab-runtime/src/v2/navigation2d/runner';
import { mujocoFromOptions, MUJOCO_SLOT } from '../../packages/lab-runtime/src/v2/simulation3d/mujoco';
import { XARM_FIXTURE_ID } from '../../packages/lab-runtime/src/v2/simulation3d/arm-cell-scene';
import { startLabGateway, type LabGateway } from '../../packages/lab-runtime/src/gateway';
import type { LabProjectV2 } from '../../packages/lab-runtime/src/v2/contracts';
import { coffeeProject } from '../support/lab-v2';

const otherVenv = resolve('.venv-webots/bin/python'), root = resolve('robotics/simulation-mujoco'), lockPath = join(root, 'requirements.lock'), python = resolve('.venv-mujoco/bin/python');
const mujocoReady = existsSync(python) && (() => { try { return execFileSync(python, ['-I', '-B', '-c', 'import mujoco;print(mujoco.__version__)'], { encoding: 'utf8', timeout: 30_000 }).trim() === '3.17.0'; } catch { return false; } })();
const running = () => { try { return execFileSync('pgrep', ['-f', 'mujoco_worker --run-id'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean); } catch { return []; } };
const dirs: string[] = [], gateways: LabGateway[] = [];
afterEach(async () => { releaseSlot(MUJOCO_SLOT, 'other-run'); for (const g of gateways.splice(0)) await g.close(); for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
const temp = async () => { const d = await mkdtemp(join(tmpdir(), 'mujoco-ready-')); dirs.push(d); return d; };
const opts = async (over: Partial<Parameters<typeof mujocoFromOptions>[0]> = {}) => ({ enabled: true, python, workerRoot: root, lockPath, directory: await temp(), ...over });
const base = async () => ({ enabled: false, python: 'python3', workerRoot: resolve('robotics/navigation-2d'), lockPath: resolve('robotics/navigation-2d/requirements.lock'), directory: await temp() });
const arm = (c: { backends: readonly { id: string }[] }) => c.backends.find((b) => b.id === 'mujoco_arm') as unknown as { installed: boolean; reason?: string };
const xarm = async () => JSON.parse(await readFile(join(root, 'fixtures', XARM_FIXTURE_ID, 'coffee-cell-project.json'), 'utf8')) as LabProjectV2;
const ctx = (project: unknown, runId?: string) => ({ scenarioId: 'MJ-BV01', backendSetId: 'engineering-mujoco-arm-v1', project, ...runId ? { runId } : {} });
const rows = (r: { id: string; reasonCodes: string[] }[]) => Object.fromEntries(r.map((x) => [x.id, x.reasonCodes]));
async function health(sim: Awaited<ReturnType<typeof portableSimulationFromOptions>>) {
  const g = await startLabGateway({ port: 0, directory: await temp(), sourceCommit: 'test-commit', schemaHash: 'a'.repeat(64), v2: { catalog: sim.catalog, enabledBackends: ['mock_amr', 'mock_coffee', 'mock_arm', ...sim.enabledBackends], simulationFactory: sim.simulationFactory, ...sim.readinessChecks ? { portableChecks: sim.readinessChecks } : {} } });
  gateways.push(g);
  return await (await fetch(g.url + '/lab/v2/health')).json() as { capabilities: string[]; backends: { id: string; installed: boolean; enabled: boolean; reason?: string }[] };
}

test('flag off: mujoco_arm is the catalog entry of a runtime never given the option (MUJOCO_DISABLED), and nothing else moves', async () => {
  const off = await mujocoFromOptions(await opts({ enabled: false }));
  expect(off.arm.capability).toEqual(MUJOCO_ARM_UNCONFIGURED); expect(off.arm.capability.reason).toMatch(/^MUJOCO_DISABLED/); expect(off.arm.runtime).toBeUndefined();
  const b = await base(), without = await portableSimulationFromOptions(b), withOff = await portableSimulationFromOptions({ ...b, mujoco: off });
  expect(withOff.catalog).toEqual(without.catalog); expect(withOff.enabledBackends).toEqual(without.enabledBackends);
  await expect(withOff.simulationFactory({ backendSetId: 'engineering-mujoco-arm-v1' } as never, { directory: await temp() })).rejects.toThrow('BACKEND_EXECUTION_DISABLED');
  const h = await health(withOff);
  expect(h.capabilities).not.toContain('sim3d_arm_contact_v1'); expect(h.backends.find((x) => x.id === 'mujoco_arm')).toMatchObject({ installed: false, enabled: false });
  expect(h).toEqual(await health(without));
});

// another worker's venv (Python 3.11 without MuJoCo) stands for a venv that lacks the lock's packages; skipped where it does not exist
test.skipIf(!existsSync(otherVenv))('an interpreter whose venv lacks the packages of the lock is MUJOCO_LOCK_MISMATCH, never installed', async () => {
  const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    const p = await mujocoFromOptions(await opts({ python: otherVenv }));
    expect(p.arm.capability.installed).toBe(false); expect(p.arm.capability.reason).toBe('MUJOCO_LOCK_MISMATCH: the interpreter does not hold exactly the packages of requirements.lock'); expect(p.arm.runtime).toBeUndefined();
    expect(err.mock.calls.map((c) => String(c[0])).join('')).toMatch(/MUJOCO_LOCK_MISMATCH: .*mujoco==3\.17\.0/); // the package list goes to stderr
  } finally { err.mockRestore(); }
});

test('flag on without any environment: an unavailable capability with its reason, never a crash; the gateway advertises nothing', async () => {
  const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  let written = '';
  const none = await mujocoFromOptions(await opts({ python: '/nonexistent/.venv-mujoco/bin/python' })).finally(() => { written = err.mock.calls.map((c) => String(c[0])).join(''); err.mockRestore(); });
  expect(none.arm.capability).toMatchObject({ id: 'mujoco_arm', installed: false, reachable: false });
  // health may be public: a code and fixed wording, never the exception text or the path (that goes to the runtime's stderr)
  expect(none.arm.capability.reason).toBe('MUJOCO_WORKER_UNAVAILABLE: the MuJoCo worker could not be started or did not answer describe');
  expect(written).toContain('/nonexistent/.venv-mujoco/bin/python');
  const sim = await portableSimulationFromOptions({ ...(await base()), mujoco: none });
  expect(sim.enabledBackends).not.toContain('mujoco_arm'); expect((await health(sim)).capabilities).not.toContain('sim3d_arm_contact_v1');
});

describe.skipIf(!mujocoReady)('the MuJoCo arm provider on the real worker', () => {
  test('flag on: a real describe makes the provider installed; it is an enabled backend, /health advertises sim3d_arm_contact_v1, and readiness passes on the xArm cell with a create smoke', async () => {
    const p = await mujocoFromOptions(await opts());
    expect(p.arm.capability).toMatchObject({ id: 'mujoco_arm', installed: true, compatible: true, reachable: true }); expect(p.arm.runtime).toMatchObject({ engineVersion: '3.17.0', maxActiveRuns: 1 });
    const sim = await portableSimulationFromOptions({ ...(await base()), mujoco: p });
    expect(arm(sim.catalog).installed).toBe(true); expect(sim.enabledBackends).toContain('mujoco_arm');
    expect((await health(sim)).capabilities).toContain('sim3d_arm_contact_v1');
    const checks = await sim.readinessChecks!(ctx(await xarm()) as never, new AbortController().signal);
    expect(rows(checks)).toEqual({ profile: [], model: [], fixture: [], clock: [], runner: [] });
    expect(checks.find((c) => c.id === 'runner')!.evidenceRef).toMatch(/^mujoco-arm-smoke:[0-9a-f]{64}$/);
    expect(checks.find((c) => c.id === 'profile')!.evidenceRef).toMatch(/^mujoco:3\.17\.0\/python-3\.11\./);
    expect(running()).toEqual([]); // the describe and the smoke left no worker behind
  }, 120_000);

  test('readiness names what is missing: the PUMA coffee project, a pickup point the tray misses, a full host', async () => {
    const sim = await portableSimulationFromOptions({ ...(await base()), mujoco: await mujocoFromOptions(await opts()) }), signal = new AbortController().signal;
    expect(rows(await sim.readinessChecks!(ctx(coffeeProject()) as never, signal)).model).toEqual(['ARM_MODEL_MISMATCH']);
    const moved = await xarm(); moved.world.points.find((x) => x.kind === 'coffee_pickup')!.x += 0.2;
    expect(rows(await sim.readinessChecks!(ctx(moved) as never, signal)).fixture).toEqual(['ARM_CELL_LAYOUT_MISMATCH']);
    holdSlot(MUJOCO_SLOT, 'other-run');
    expect(rows(await sim.readinessChecks!(ctx(await xarm()) as never, signal)).runner).toContain('MUJOCO_CAPACITY');
    expect(rows(await sim.readinessChecks!(ctx(await xarm(), 'other-run') as never, signal)).runner).toEqual([]); // the holder is never counted against itself, and its own engine is the proof
  }, 120_000);

  test('the arm set dispatches to a run with the MuJoCo ports; without the arm table it is refused', async () => {
    const sim = await portableSimulationFromOptions({ ...(await base()), mujoco: await mujocoFromOptions(await opts()) });
    const input = { project: await xarm(), scenarioId: 'BV01', scenarioRevision: 1, seed: 1, mode: 'simulation', access: 'simulated', backendSetId: 'engineering-mujoco-arm-v1', sourceCommit: 'a'.repeat(40) } as never;
    // MJ-BV01 arrives with M07; the plain BV01 is refused by the runner's own set check, which proves the run was handed to the shared runner (not to the portable AMR plants)
    const refused = await sim.simulationFactory(input, { directory: await temp(), catalog: sim.catalog, enabledBackends: sim.enabledBackends }).catch((e: Error) => e);
    expect(['MODE_BACKEND_MISMATCH', 'SCENARIO_UNSUPPORTED_BY_SET']).toContain((refused as Error).message);
    await expect(plantDispatcher(sim.catalog, sim.plants)(input, { directory: await temp() })).rejects.toThrow('BACKEND_EXECUTION_DISABLED');
  }, 120_000);
});
