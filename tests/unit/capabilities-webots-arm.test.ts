// X01 (R1.1 D18, D30): the Webots arm provider and its backend set exist in the default catalog, unconfigured, and only WB-BV01 may use the set.
import { expect, test } from 'vitest';
import { defaultCatalog, WEBOTS_ARM, WEBOTS_UNCONFIGURED, WEBOTS_ARM_UNCONFIGURED } from '../../packages/lab-runtime/src/v2/capabilities';
import { resolveBackends } from '../../packages/lab-runtime/src/v2/scenario-matrix';
import { scenarioRegistry } from '../../packages/lab-runtime/src/v2/scenario-registry';

test('webots_arm is in the default catalog as not configured, with the same flag reason as webots_3d', () => {
  const arm = defaultCatalog.backends.find((b) => b.id === 'webots_arm');
  expect(arm).toEqual(WEBOTS_ARM_UNCONFIGURED);
  expect(arm).toMatchObject({ installed: false, compatible: false, reachable: false, modes: ['simulation'], accesses: ['simulated'] });
  expect(arm!.reason).toMatch(/^WEBOTS_DISABLED/);
  expect(arm!.reason).toContain('MEKONIQ_LAB_WEBOTS=1');
  expect(WEBOTS_ARM).toEqual({ id: 'webots_arm', version: 'R2025a' });
  expect(defaultCatalog.backends.find((b) => b.id === 'webots_3d')).toEqual(WEBOTS_UNCONFIGURED);
});

test('engineering-webots-arm-v1 runs only WB-BV01 with an AMR mock, the Webots arm and a coffee mock', () => {
  const set = defaultCatalog.sets['engineering-webots-arm-v1']!;
  expect(set).toMatchObject({ mode: 'simulation', access: 'simulated', backends: ['mock_amr', 'webots_arm', 'mock_coffee'],
    providers: { amr: 'mock_amr', arm: 'webots_arm', coffee: 'mock_coffee' }, scenarioIds: ['WB-BV01'] });
  expect(set.execution).toEqual(defaultCatalog.sets['engineering-webots-3d-v1']!.execution);
});

test('the plain BV01 and every other set are unchanged by the new set', () => {
  const bv01 = scenarioRegistry.get('BV01')!;
  expect(resolveBackends(bv01, 'simulation', 'engineering-webots-arm-v1')).toMatchObject({ ok: false, reasonCodes: ['SCENARIO_UNSUPPORTED_BY_SET'] });
  expect(resolveBackends(bv01, 'mock', 'mock-default')).toMatchObject({ ok: true });
  expect(Object.entries(defaultCatalog.sets).filter(([, v]) => v.backends.includes('webots_arm')).map(([k]) => k)).toEqual(['engineering-webots-arm-v1']);
  expect(defaultCatalog.sets['engineering-webots-3d-v1']).toMatchObject({ backends: ['webots_3d'], providers: { amr: 'webots_3d' }, scenarioIds: ['WB-FD01', 'WB-FD07'] });
  expect(defaultCatalog.sets['mock-default']!.backends).toEqual(['mock_amr', 'mock_coffee', 'mock_arm']);
});
