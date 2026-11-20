// M01 arm-only set admits MJ-BV01; the later shared-world cell has its own explicit set. Both remain unconfigured.
import { expect, test } from 'vitest';
import { defaultCatalog, MUJOCO_ARM, MUJOCO_ARM_UNCONFIGURED, WEBOTS_ARM_UNCONFIGURED } from '../../packages/lab-runtime/src/v2/capabilities';
import { resolveBackends } from '../../packages/lab-runtime/src/v2/scenario-matrix';
import { scenarioRegistry } from '../../packages/lab-runtime/src/v2/scenario-registry';
import { loadOracleProfile } from '../../packages/lab-runtime/src/v2/algorithm/checker';

// Snapshot of every set before M01 (`git show e2d1d09:packages/lab-runtime/src/v2/capabilities.ts`): id, mode, access, backends.
const BEFORE: [string, string, string, string[]][] = [
  ['mock-default', 'mock', 'simulated', ['mock_amr', 'mock_coffee', 'mock_arm']],
  ['mock-amr', 'mock', 'simulated', ['mock_amr']],
  ['simulation-default', 'simulation', 'simulated', ['gazebo_nav2', 'linuxcnc_sim', 'coffee_io_sim']],
  ['coffee-simulation', 'simulation', 'simulated', ['gazebo_nav2', 'linuxcnc_sim', 'coffee_io_sim']],
  ['engineering-rigid-v1', 'simulation', 'simulated', ['gazebo_nav2']],
  ['engineering-contact-v1', 'simulation', 'simulated', ['gazebo_nav2', 'moveit_gazebo_arm', 'engineering_coffee_process']],
  ['engineering-irsim-2d-v1', 'simulation', 'simulated', ['irsim_2d']],
  ['engineering-webots-3d-v1', 'simulation', 'simulated', ['webots_3d']],
  ['engineering-webots-arm-v1', 'simulation', 'simulated', ['mock_amr', 'webots_arm', 'mock_coffee']],
  ['hardware-shadow', 'hardware', 'shadow', ['valetudo_native']],
  ['hardware-hil', 'hardware', 'hil', ['valetudo_native', 'cell_native']],
  ['hardware-live', 'hardware', 'live', ['valetudo_native', 'cell_native']],
];
const BACKENDS_BEFORE = ['mock_amr', 'mock_coffee', 'mock_arm', 'gazebo_nav2', 'linuxcnc_sim', 'coffee_io_sim', 'moveit_gazebo_arm', 'engineering_coffee_process', 'valetudo_native', 'cell_native', 'irsim_2d', 'webots_3d', 'webots_arm'];

test('mujoco_arm is in the default catalog as not configured, with a MUJOCO_DISABLED reason', () => {
  const arm = defaultCatalog.backends.find((b) => b.id === 'mujoco_arm');
  expect(arm).toEqual(MUJOCO_ARM_UNCONFIGURED);
  expect(arm).toMatchObject({ installed: false, compatible: false, reachable: false, modes: ['simulation'], accesses: ['simulated'] });
  expect(arm!.reason).toMatch(/^MUJOCO_DISABLED/);
  expect(MUJOCO_ARM).toEqual({ id: 'mujoco_arm' });
});

test('engineering-mujoco-arm-v1 runs only MJ-BV01 with an AMR mock, the MuJoCo arm and a coffee mock, executing like the Webots arm set', () => {
  const set = defaultCatalog.sets['engineering-mujoco-arm-v1']!;
  expect(set).toMatchObject({ mode: 'simulation', access: 'simulated', backends: ['mock_amr', 'mujoco_arm', 'mock_coffee'],
    providers: { amr: 'mock_amr', arm: 'mujoco_arm', coffee: 'mock_coffee' }, scenarioIds: ['MJ-BV01'], bundle: false });
  expect(set.scenarioIds).toEqual(['MJ-BV01']);
  expect(set.execution).toEqual(defaultCatalog.sets['engineering-webots-arm-v1']!.execution);
});

test('the arm-only set refuses plain BV01 and WB-BV01; only it and the explicit cell set list mujoco_arm', () => {
  for (const id of ['BV01', 'WB-BV01']) expect(resolveBackends(scenarioRegistry.get(id)!, 'simulation', 'engineering-mujoco-arm-v1')).toMatchObject({ ok: false, reasonCodes: ['SCENARIO_UNSUPPORTED_BY_SET'] });
  expect(resolveBackends(scenarioRegistry.get('BV01')!, 'mock', 'mock-default')).toMatchObject({ ok: true });
  expect(Object.entries(defaultCatalog.sets).filter(([, v]) => v.backends.includes('mujoco_arm')).map(([k]) => k)).toEqual(['engineering-mujoco-arm-v1','engineering-mujoco-cell-v1','engineering-mujoco-bench-v1']);
});

test('every set and backend that existed before is exactly as it was', () => {
  const after = Object.entries(defaultCatalog.sets).filter(([k]) => !['engineering-mujoco-arm-v1', 'engineering-mujoco-3d-v1','engineering-mujoco-cell-v1','engineering-mujoco-bench-v1'].includes(k)).map(([k, v]) => [k, v.mode, v.access, [...v.backends]]);
  expect(after).toEqual(BEFORE);
  expect(defaultCatalog.backends.map((b) => b.id)).toEqual([...BACKENDS_BEFORE, 'mujoco_arm', 'mujoco_3d']);
  expect(defaultCatalog.backends.find((b) => b.id === 'webots_arm')).toEqual(WEBOTS_ARM_UNCONFIGURED);
  expect(defaultCatalog.sets['engineering-webots-arm-v1']).toMatchObject({ providers: { amr: 'mock_amr', arm: 'webots_arm', coffee: 'mock_coffee' }, scenarioIds: ['WB-BV01'] });
  expect(defaultCatalog.sets['engineering-webots-3d-v1']).toMatchObject({ providers: { amr: 'webots_3d' }, scenarioIds: ['WB-FD01', 'WB-FD07'] });
});

test('the explicit cell set admits only MJ-CELL-BV01 with one shared simulation world',()=>{
  expect(defaultCatalog.sets['engineering-mujoco-cell-v1']).toEqual({mode:'simulation',access:'simulated',backends:['mujoco_3d','mujoco_arm','mock_coffee'],providers:{amr:'mujoco_3d',arm:'mujoco_arm',coffee:'mock_coffee'},scenarioIds:['MJ-CELL-BV01'],bundle:false,execution:{host:'portable_python',clock:'source_fixed_step',manualStep:false,speedMultipliers:[1,4,16,64],composition:'single_world'}});
});

test('mobile catalog adds only an unconfigured simulation backend and the MJ-FD01 engineering set', () => {
  expect(defaultCatalog.backends.find(b => b.id === 'mujoco_3d')).toMatchObject({ installed: false, modes: ['simulation'], accesses: ['simulated'] });
  expect(defaultCatalog.sets['engineering-mujoco-3d-v1']).toMatchObject({ mode: 'simulation', access: 'simulated', backends: ['mujoco_3d'], providers: { amr: 'mujoco_3d' }, scenarioIds: ['MJ-FD01'] });
  expect(defaultCatalog.sets['engineering-mujoco-3d-v1']!.bundle).not.toBe(false);
  expect(resolveBackends(scenarioRegistry.get('MJ-FD01')!, 'mock', 'mock-default')).toMatchObject({ ok: false });
});

test('the oracle profile carries the M00 MuJoCo arm thresholds and leaves the Webots ones as they were', () => {
  const { profile } = loadOracleProfile();
  expect(profile.mujocoArm).toMatchObject({ reachTolRad: 0.01, settleTicks: 10, followTolRad: 0.05, followTicks: 10, repeatJointRad: 1e-9, gripSettleTicks: 25, dropTicks: 50, liftMinM: 0.14, slipTolM: 0.005, fkTolM: 1e-5 });
  expect(profile.webotsArm).toMatchObject({ reachTolRad: 0.01, settleTicks: 10, followTolRad: 0.05, followTicks: 10, repeatJointRad: 1e-6 });
  expect(profile.pid).toEqual({ sample: 1e-9 });
  expect(profile.fk).toEqual({ translationM: 1e-6, rotationRad: 1e-6 });
});

test('the bench set (V06) runs only the two bench scenarios, from fixtures (no bundle), each on the backend of its role alone',()=>{
  expect(defaultCatalog.sets['engineering-mujoco-bench-v1']).toEqual({mode:'simulation',access:'simulated',backends:['mujoco_3d','mujoco_arm'],providers:{amr:'mujoco_3d',arm:'mujoco_arm'},scenarioIds:['MJ-BENCH-WHEEL','MJ-BENCH-ARM'],bundle:false,execution:defaultCatalog.sets['engineering-mujoco-3d-v1']!.execution});
  expect(resolveBackends(scenarioRegistry.get('MJ-BENCH-WHEEL')!,'simulation','engineering-mujoco-bench-v1')).toEqual({ok:true,required:['mujoco_3d'],reasonCodes:[]});
  expect(resolveBackends(scenarioRegistry.get('MJ-BENCH-ARM')!,'simulation','engineering-mujoco-bench-v1')).toEqual({ok:true,required:['mujoco_arm'],reasonCodes:[]});
  for(const id of ['MJ-BENCH-WHEEL','MJ-BENCH-ARM'])expect(scenarioRegistry.get(id)).toMatchObject({orders:[],maxTicks:500});
  for(const set of ['engineering-mujoco-arm-v1','engineering-mujoco-cell-v1','engineering-mujoco-3d-v1','mock-default'])expect(resolveBackends(scenarioRegistry.get('MJ-BENCH-ARM')!,set==='mock-default'?'mock':'simulation',set).ok).toBe(false);
  expect(resolveBackends(scenarioRegistry.get('MJ-BV01')!,'simulation','engineering-mujoco-bench-v1')).toMatchObject({ok:false,reasonCodes:['SCENARIO_UNSUPPORTED_BY_SET']});
});
