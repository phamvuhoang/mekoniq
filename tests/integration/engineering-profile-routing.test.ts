// V18: the backend a scenario needs depends on the server-owned backend set, not on the mode alone. Probes are injected; nothing here claims native execution.
import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startLabGateway, type LabGateway } from '../../packages/lab-runtime/src/gateway';
import { defaultCatalog, type CapabilityCatalog } from '../../packages/lab-runtime/src/v2/capabilities';
import { admitScenario, requiredBackends, resolveBackends, scenarioMatrix } from '../../packages/lab-runtime/src/v2/scenario-matrix';
import { scenarioRegistry } from '../../packages/lab-runtime/src/v2/scenario-registry';
import { collectReadiness } from '../../packages/lab-runtime/src/v2/readiness';
import { assertNativeAdmission } from '../../packages/lab-runtime/src/v2/sil/native-lifecycle';
import { preflight } from '../../packages/lab-runtime/src/v2/sil/cli';
import { coffeeProject } from '../support/lab-v2';
import { createEngineeringService } from '../../packages/lab-runtime/src/engineering/gateway';
import { testCompiler } from '../support/engineering';

const roots: string[] = [], gateways: LabGateway[] = [];
afterEach(async () => { for (const g of gateways.splice(0)) await g.close(); for (const d of roots.splice(0)) await rm(d, { recursive: true, force: true }); });
const catalog: CapabilityCatalog = defaultCatalog;
const bv01 = scenarioRegistry.get('BV01')!, fd01 = scenarioRegistry.get('FD01')!;
const LEGACY = ['gazebo_nav2', 'linuxcnc_sim', 'coffee_io_sim'];

test('the same BV01 needs different backends per set, and the mode-only call keeps its legacy answer', () => {
  expect(requiredBackends(bv01, 'simulation', 'coffee-simulation', catalog)).toEqual(LEGACY);
  expect(requiredBackends(bv01, 'simulation', 'engineering-contact-v1', catalog)).toEqual(['gazebo_nav2', 'moveit_gazebo_arm', 'engineering_coffee_process']);
  expect(requiredBackends(bv01, 'simulation')).toEqual(LEGACY);
  expect(requiredBackends(bv01, 'simulation', 'simulation-default', catalog)).toEqual(LEGACY);
  expect(requiredBackends(fd01, 'simulation', 'engineering-rigid-v1', catalog)).toEqual(['gazebo_nav2']);
  expect(requiredBackends(fd01, 'mock')).toEqual(['mock_amr']);
  expect(requiredBackends(bv01, 'mock', 'mock-default', catalog)).toEqual(['mock_amr', 'mock_coffee', 'mock_arm']);
});

test('unknown set, wrong mode and unsupported scenario are rejected, never defaulted', () => {
  expect(() => requiredBackends(bv01, 'simulation', 'nope', catalog)).toThrow(/BACKEND_SET_UNKNOWN/);
  expect(() => requiredBackends(bv01, 'simulation', 'mock-default', catalog)).toThrow(/MODE_BACKEND_MISMATCH/);
  expect(resolveBackends(bv01, 'simulation', 'engineering-rigid-v1', catalog)).toMatchObject({ ok: false, reasonCodes: ['SCENARIO_UNSUPPORTED_BY_SET'] });
  expect(resolveBackends(scenarioRegistry.get('FD03')!, 'simulation', 'engineering-contact-v1', catalog)).toMatchObject({ ok: false, reasonCodes: ['SCENARIO_UNSUPPORTED_BY_SET'] });
  const broken: CapabilityCatalog = { ...catalog, sets: { ...catalog.sets, 'engineering-contact-v1': { ...catalog.sets['engineering-contact-v1']!, providers: { amr: 'gazebo_nav2' } } } };
  expect(resolveBackends(bv01, 'simulation', 'engineering-contact-v1', broken)).toMatchObject({ ok: false, reasonCodes: ['SCENARIO_BACKEND_MISSING'] });
});

test('legacy sets, scenarios and campaign rows keep their requirements', async () => {
  for (const [id, def] of scenarioRegistry) {
    // IR-* and WB-* variants run only on a set that lists them: the mode formula and every legacy set refuse them
    if (/^(IR|WB|MJ)-/.test(id)) { for (const [mode, set] of [['mock', undefined], ['mock', 'mock-default'], ['simulation', undefined], ['simulation', 'simulation-default']] as const) expect(resolveBackends(def, mode, set, catalog), id).toMatchObject({ ok: false, reasonCodes: ['SCENARIO_UNSUPPORTED_BY_SET'] }); continue; }
    expect(requiredBackends(def, 'mock'), id).toEqual(requiredBackends(def, 'mock', 'mock-default', catalog));
    if (id !== 'FD01') expect(requiredBackends(def, 'simulation'), id).toEqual(requiredBackends(def, 'simulation', 'simulation-default', catalog));
  }
  expect(requiredBackends(scenarioRegistry.get('FD02-cups')!, 'simulation', 'coffee-simulation', catalog)).toEqual(LEGACY);
  expect(Object.keys(catalog.sets)).toEqual(expect.arrayContaining(['mock-amr', 'mock-default', 'simulation-default', 'coffee-simulation', 'hardware-shadow', 'hardware-hil', 'hardware-live']));
  const row = scenarioMatrix.find((r) => r.id === 'FD01')!;
  const admitted = await admitScenario('FD01', { mode: 'simulation', backendSetId: 'engineering-rigid-v1', available: ['gazebo_nav2'], catalog });
  expect(admitted).toMatchObject({ status: 'admitted', required: ['gazebo_nav2'] });
  expect(row.runnerScenarios).toContain('FD01');
  expect((await admitScenario('BV01', { mode: 'simulation', backendSetId: 'engineering-contact-v1', available: ['gazebo_nav2'], catalog })).reasons).toEqual(['BACKEND_MISSING:moveit_gazebo_arm', 'BACKEND_MISSING:engineering_coffee_process']);
  expect((await admitScenario('BV01', { mode: 'simulation', backendSetId: 'engineering-rigid-v1', available: ['gazebo_nav2'], catalog })).status).toBe('unavailable');
});

test('provider roles are server data: engineering sets are registered but the unimplemented providers are not installed', () => {
  expect(catalog.sets['engineering-contact-v1']!.providers).toEqual({ amr: 'gazebo_nav2', arm: 'moveit_gazebo_arm', coffee: 'engineering_coffee_process' });
  expect(catalog.sets['coffee-simulation']!.providers).toEqual({ amr: 'gazebo_nav2', arm: 'linuxcnc_sim', coffee: 'coffee_io_sim' });
  expect(catalog.sets['engineering-rigid-v1']!.scenarioIds).toEqual(['FD01']);
  for (const id of ['moveit_gazebo_arm', 'engineering_coffee_process']) {
    const b = catalog.backends.find((x) => x.id === id)!;
    expect(b).toMatchObject({ installed: false, modes: ['simulation'] });
    expect(b.reason).toMatch(/not implemented/i);
  }
  expect(catalog.sets['simulation-default']!.backends).toEqual(LEGACY);
});

test('turning LinuxCNC off blocks only the legacy set; turning MoveIt off blocks only the engineering set', async () => {
  const up = (ids: string[]): CapabilityCatalog => ({ ...catalog, backends: catalog.backends.map((b) => ids.includes(b.id) ? { ...b, installed: true, compatible: true, reachable: true, commissioned: true } : b) });
  const reasons = async (set: string, c: CapabilityCatalog, enabled: string[]) => (await collectReadiness({ scenarioId: 'BV01', backendSetId: set, project: coffeeProject() }, { catalog: c, enabledBackends: enabled })).checks.filter((x) => x.id.startsWith('backend:')).flatMap((x) => x.reasonCodes);
  const noLinuxcnc = up(['gazebo_nav2', 'coffee_io_sim', 'moveit_gazebo_arm', 'engineering_coffee_process']);
  const enabled = ['gazebo_nav2', 'coffee_io_sim', 'moveit_gazebo_arm', 'engineering_coffee_process'];
  expect(await reasons('coffee-simulation', noLinuxcnc, enabled)).toContain('BACKEND_NOT_INSTALLED:linuxcnc_sim');
  expect(await reasons('engineering-contact-v1', noLinuxcnc, enabled)).toEqual([]);
  const noMoveit = up(['gazebo_nav2', 'coffee_io_sim', 'linuxcnc_sim']);
  expect(await reasons('coffee-simulation', noMoveit, ['gazebo_nav2', 'coffee_io_sim', 'linuxcnc_sim'])).toEqual([]);
  expect(await reasons('engineering-contact-v1', noMoveit, ['gazebo_nav2'])).toEqual(expect.arrayContaining(['BACKEND_NOT_INSTALLED:moveit_gazebo_arm', 'BACKEND_NOT_INSTALLED:engineering_coffee_process']));
});

test('health keeps the legacy requirements and adds per-set requirements the engineering client must read', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eng-health-')); roots.push(directory);
  const g = await startLabGateway({ port: 0, directory, sourceCommit: 'test-commit', schemaHash: 'a'.repeat(64) }); gateways.push(g);
  const health = await (await fetch(g.url + '/lab/v2/health')).json();
  expect(health.scenarioRequirements.BV01).toEqual({ mock: ['mock_amr', 'mock_coffee', 'mock_arm'], simulation: LEGACY });
  const bySet = health.scenarioRequirementsByBackendSet;
  // this runtime has no engineering service, so engineering sets must not look usable
  expect(bySet.BV01['engineering-contact-v1']).toEqual({ supported: false, required: [], reasonCodes: ['ENGINEERING_CAPABILITY_REQUIRED'] });
  expect(bySet.BV01['coffee-simulation']).toEqual({ supported: true, required: LEGACY, reasonCodes: [] });
  expect(bySet.FD01['coffee-simulation']).toEqual({ supported: true, required: ['gazebo_nav2'], reasonCodes: [] }); // legacy answer unchanged
  expect(bySet.FD01['hardware-live']).toBeUndefined(); // hardware sets are not simulation candidates
});

test('the legacy native lifecycle and SIL preflight refuse engineering sets instead of running the wrong plant', () => {
  const input = { project: coffeeProject(), scenarioId: 'BV01', scenarioRevision: scenarioRegistry.get('BV01')!.revision, seed: 1, mode: 'simulation' as const, access: 'simulated' as const, backendSetId: 'engineering-contact-v1', sourceCommit: 'c' };
  expect(() => assertNativeAdmission(input, { directory: '/nonexistent' }, {} as never)).toThrow(/ENGINEERING_LIFECYCLE_UNAVAILABLE/);
  const r = preflight('BV01', 'engineering-contact-v1');
  expect(r.ok).toBe(false);
  expect(r.reasons.join()).toContain('BACKEND_MISSING:moveit_gazebo_arm');
  expect(preflight('FD01', 'engineering-rigid-v1').reasons.join()).toContain('ENGINEERING_LIFECYCLE_UNAVAILABLE');
});

test('with the engineering service the engineering sets are listed as supported per scenario', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eng-health2-')); roots.push(directory);
  const engineering = createEngineeringService({ directory: join(directory, 'engineering'), catalogRoot: 'robotics/catalog', compiler: testCompiler });
  const g = await startLabGateway({ port: 0, directory: join(directory, 'runs'), sourceCommit: 'test-commit', schemaHash: 'a'.repeat(64), v2: { engineering } }); gateways.push(g);
  const bySet = (await (await fetch(g.url + '/lab/v2/health')).json()).scenarioRequirementsByBackendSet;
  expect(bySet.BV01['engineering-contact-v1']).toEqual({ supported: true, required: ['gazebo_nav2', 'moveit_gazebo_arm', 'engineering_coffee_process'], reasonCodes: [] });
  expect(bySet.BV01['engineering-rigid-v1']).toEqual({ supported: false, required: [], reasonCodes: ['SCENARIO_UNSUPPORTED_BY_SET'] });
  expect(bySet.FD01['engineering-rigid-v1'].required).toEqual(['gazebo_nav2']);
});
