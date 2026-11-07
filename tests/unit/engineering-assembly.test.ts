import { expect, test } from 'vitest';
import { prepareEngineeringCompileInput, resolveAssembly, EngineeringInputError } from '../../packages/lab-runtime/src/engineering/assembly';
import { hashJson } from '../../packages/lab-runtime/src/v2/hash';
import { validateProjectV2 } from '../../packages/lab-runtime/src/v2/contracts';
import { ESPRESSO } from '../../packages/lab-runtime/src/v2/scenarios/coffee';
import type { CoffeeRecipe } from '../../packages/lab-runtime/src/v2/contracts';
import { validateEngineeringCompileInput, validateResolvedAssembly } from '../../packages/lab-runtime/src/engineering/contracts';
import { engineeringFixture } from '../support/engineering';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const resolve = (name: string, mutate?: (f: ReturnType<typeof engineeringFixture>) => void) => {
  const f = clone(engineeringFixture(name)); mutate?.(f);
  return { f, r: resolveAssembly(f.project, f.components, { models: f.models as never }) };
};
const codes = (r: { problems: { code: string; blocking: boolean }[] }) => r.problems.filter((p) => p.blocking).map((p) => p.code);

test('cycle has no resolved model', () => {
  const f = engineeringFixture('cycle');
  const r = resolveAssembly(f.project, f.components);
  expect(r.resolved).toBeNull();
  expect(r.problems.map(p => p.code)).toContain('ASSEMBLY_CYCLE');
});

test('the reference AMR resolves with namespaced links, joints, placements and explicit wheel bindings', () => {
  const { r } = resolve('valid');
  expect(r.problems).toEqual([]);
  const a = r.resolved!;
  expect(a.links.map((l) => l.id)).toContain('wheel-left/rim');
  expect(a.joints.map((j) => j.id)).toEqual(expect.arrayContaining(['wheel-left/axle', 'wheel-right/axle', 'mount:chassis/left-axle:wheel-left/mount']));
  const left = a.placements.find((p) => p.instanceId === 'wheel-left')!;
  expect(left.world.xyzM).toEqual([0, 0.225, 0]);
  expect(a.placements.find((p) => p.instanceId === 'battery')!.world.xyzM).toEqual([-0.1, 0, 0.125]);
  expect(a.models.drive).toMatchObject({ entityId: 'amr-1', instanceId: 'chassis', leftJointId: 'wheel-left/axle', rightJointId: 'wheel-right/axle' });
  expect(JSON.stringify(a).match(/wheelRadiusM/g)).toHaveLength(1); // radius lives only in the drive model document, never duplicated
  expect(a.assemblyDigest).toMatch(/^[0-9a-f]{64}$/);
  expect(resolve('valid').r.resolved!.assemblyDigest).toBe(a.assemblyDigest); // deterministic
});

test('voltage mismatch blocks with VOLTAGE_MISMATCH and returns no model', () => {
  const { r } = resolve('voltage-mismatch');
  expect(codes(r)).toContain('VOLTAGE_MISMATCH');
  expect(r.resolved).toBeNull();
});

test('unknown inertia is PARAMETER_MISSING, never a runnable model', () => {
  const { r } = resolve('missing-inertia');
  expect(r.problems.find((p) => p.code === 'PARAMETER_MISSING')?.path).toContain('battery');
  expect(r.resolved).toBeNull();
});

test('mate mismatch, dangling connection and reused port are caught', () => {
  expect(codes(resolve('valid', (f) => { f.project.assembly.connections[0]!.from = 'chassis/tray-plate'; }).r)).toEqual(expect.arrayContaining(['MOUNT_MISMATCH', 'PORT_REUSED']));
  expect(codes(resolve('valid', (f) => { f.project.assembly.connections[0]!.to = 'ghost/mount'; }).r)).toContain('DANGLING_CONNECTION');
});

test('a part with two rigid parents is MULTIPLE_PARENT', () => {
  const { r } = resolve('valid', (f) => { f.project.assembly.connections.push({ from: 'chassis/tray-plate', to: 'battery/mount', kind: 'mount' }); });
  expect(codes(r)).toEqual(expect.arrayContaining(['MULTIPLE_PARENT']));
});

test('entities must be bound and every movable joint needs an actuator model', () => {
  expect(codes(resolve('valid', (f) => { f.project.entityBindings = []; }).r)).toContain('UNBOUND_ENTITY');
  expect(codes(resolve('valid', (f) => { f.project.runtimeProject.entities.push({ id: 'arm-1', kind: 'arm', assetRef: f.project.runtimeProject.entities[0]!.assetRef }); }).r)).toContain('UNBOUND_ENTITY');
  const r = resolveAssembly(engineeringFixture('valid').project, engineeringFixture('valid').components, { models: {} });
  expect(r.problems.map((p) => p.code)).toEqual(expect.arrayContaining(['MODEL_UNAVAILABLE']));
  expect(r.resolved).toBeNull();
});

test('wheel radius in the drive model must match the wheel geometry (no inference from the body)', () => {
  const f = clone(engineeringFixture('valid'));
  const [digest, model] = Object.entries(f.models)[0] as [string, { drive: { wheelRadiusM: { value: number } } }];
  const changed = clone(model); changed.drive.wheelRadiusM.value = 0.12;
  const chassis = Object.entries(f.components).find(([, c]) => c.id === 'amr-chassis')!;
  const patched = { ...chassis[1], models: [{ ...chassis[1].models[0]!, digest: hashJson(changed) }] };
  const components = { ...f.components }; delete components[chassis[0]];
  const comp = { ...components, [hashJson(patched)]: patched };
  f.project.assembly.instances.find((i) => i.id === 'chassis')!.componentDigest = hashJson(patched);
  void digest;
  const r = resolveAssembly(f.project, comp, { models: { [hashJson(changed)]: changed } as never });
  expect(codes(r)).toContain('WHEEL_GEOMETRY_MISMATCH');
});

test('overlapping parts that are not mounted to each other are INITIAL_PENETRATION; mounted neighbours are allowed to touch', () => {
  expect(resolve('valid').r.problems).toEqual([]);
  const { r } = resolve('valid', (f) => { f.project.assembly.instances.find((i) => i.id === 'tray')!; const chassis = Object.values(f.components).find((c) => c.id === 'amr-chassis')!; chassis.ports.find((p) => p.id === 'tray-plate')!.frame.xyzM = [0.05, 0, 0.1]; });
  expect(codes(r)).toContain('INITIAL_PENETRATION');
});

test('BOM keeps unknown SKU/price as null and never counts null as zero', () => {
  const { r } = resolve('valid');
  const bom = r.resolved!.bom;
  expect(bom.incompleteTotal).toBe(true);
  expect(bom.total).toBeNull();
  expect(bom.lines.every((l) => l.price === null && l.sku === null)).toBe(true);
  expect(bom.missingPriceLineIds.length).toBe(bom.lines.length);
  expect(bom.lines.find((l) => l.componentId === 'drive-wheel')!.qty).toBe(2);
  const f = engineeringFixture('valid');
  const wheel = Object.entries(f.components).find(([, c]) => c.id === 'drive-wheel')![0];
  const priced = resolveAssembly(f.project, f.components, { models: f.models as never, quotes: { [wheel]: { amount: 10, currency: 'USD', quotedOn: '2026-11-01' } } });
  expect(priced.resolved!.bom.total).toEqual({ amount: 20, currency: 'USD', quotedOn: '2026-11-01' }); // partial sum, flagged incomplete
  expect(priced.resolved!.bom.incompleteTotal).toBe(true);
});

test('assumed sources are listed as assumptions', () => {
  expect(resolve('valid').r.resolved!.assumptions.every((s) => s.kind === 'assumed')).toBe(true);
  expect(resolve('valid').r.resolved!.assumptions.length).toBeGreaterThan(0);
});

// ---- V17: compile input keeps every semantic input of the project ----
const prepared = () => {
  const f = engineeringFixture('valid');
  const { resolved } = resolveAssembly(f.project, f.components, { models: f.models as never });
  f.project.runtimeProject.entities[0] = { ...f.project.runtimeProject.entities[0]!, speedLimitMps: 0.35, recipeRefs: [{ id: ESPRESSO.id, revision: ESPRESSO.revision, hash: ESPRESSO.hash }] };
  f.project.runtimeProject.world.points.push({ id: 'custom-9', name: 'Custom', kind: 'table', x: 5.5, y: 3.25 });
  f.project.runtimeProject.world.handoffPoints = [{ id: 'h1', name: 'Handoff', kind: 'coffee_pickup', position: [1.5, 2, 0], yawRad: 1.25 }];
  f.project.runtimeProject.world.obstacles = [{ id: 'wall-x', x: 2, y: 1, width: 0.3, height: 2 }];
  return { f, resolved: resolved!, recipes: [ESPRESSO] as unknown as CoffeeRecipe[] };
};

test('the resolved assembly and compile input conform to their own schemas', () => {
  const { f, resolved, recipes } = prepared();
  expect(validateResolvedAssembly(resolved).problems).toEqual([]);
  expect(validateEngineeringCompileInput(prepareEngineeringCompileInput(f.project, resolved, recipes)).problems).toEqual([]);
});

test('V17 compile input preserves world, handoff yaw, speed limit, recipes and project digest', () => {
  const { f, resolved, recipes } = prepared();
  const { project } = f;
  const input = prepareEngineeringCompileInput(project, resolved, recipes);
  expect(input.runtimeProjection.project.world).toEqual(project.runtimeProject.world);
  expect(input.runtimeProjection.project.entities.map(e => [e.id, e.speedLimitMps]))
    .toEqual(project.runtimeProject.entities.map(e => [e.id, e.speedLimitMps]));
  expect(input.runtimeProjection.project.entities[0]!.recipeRefs).toEqual(project.runtimeProject.entities[0]!.recipeRefs);
  expect(input.runtimeProjection.project.world.handoffPoints![0]!.yawRad).toBe(1.25);
  expect(input.projectDigest).toBe(hashJson(project));
  expect(input.recipes).toEqual(recipes);
  expect(validateProjectV2(input.runtimeProjection.project).ok).toBe(true);
});

test('V17 asset refs are regenerated from the assembly and resolve inside runtimeProjection.assets', () => {
  const { f, resolved, recipes } = prepared();
  const input = prepareEngineeringCompileInput(f.project, resolved, recipes);
  for (const e of input.runtimeProjection.project.entities) {
    const asset = input.runtimeProjection.assets.find((a) => a.id === e.assetRef.id && a.revision === e.assetRef.revision && a.contentHash === e.assetRef.contentHash);
    expect(asset, e.id).toBeDefined();
  }
  expect(input.runtimeProjection.project.entities[0]!.assetRef.contentHash).not.toBe(f.project.runtimeProject.entities[0]!.assetRef.contentHash);
  expect(input.runtimeProjection.assets[0]!.inertial!.massKg).toBe(resolved.links.reduce((s, l) => s + l.massKg.value, 0));
});

test('V17 editing the world or a point changes the project digest and projection', () => {
  const a = prepared(), b = prepared();
  b.f.project.runtimeProject.world.points[0]!.x += 1;
  const ia = prepareEngineeringCompileInput(a.f.project, a.resolved, a.recipes), ib = prepareEngineeringCompileInput(b.f.project, b.resolved, b.recipes);
  expect(ia.projectDigest).not.toBe(ib.projectDigest);
  expect(ia.runtimeProjection.project.world).not.toEqual(ib.runtimeProjection.project.world);
});

test('V17 missing or mismatching recipes are rejected, never defaulted', () => {
  const { f, resolved } = prepared();
  const attempt = (recipes: unknown[]) => { try { prepareEngineeringCompileInput(f.project, resolved, recipes as never); } catch (e) { return e; } };
  const missing = attempt([]);
  expect(missing).toBeInstanceOf(EngineeringInputError);
  expect((missing as EngineeringInputError).problems.map((p) => p.code)).toContain('RECIPE_MISSING');
  const stale = attempt([{ ...ESPRESSO, hash: 'f'.repeat(64) }]);
  expect((stale as EngineeringInputError).problems.map((p) => p.code)).toContain('RECIPE_MISMATCH');
});

test('V17 an empty or unbound draft yields no resolved model, so no compile input exists', () => {
  const { r } = resolve('valid', (f) => { f.project.assembly = { instances: [], connections: [] }; f.project.entityBindings = []; });
  expect(r.resolved).toBeNull();
  expect(codes(r)).toContain('UNBOUND_ENTITY');
});

test('V17 an input whose bindings differ from the resolved assembly is rejected', () => {
  const { f, resolved, recipes } = prepared();
  const other = { ...f.project, entityBindings: [{ entityId: 'amr-1', instanceIds: ['chassis'] }] };
  expect(() => prepareEngineeringCompileInput(other, resolved, recipes)).toThrow(EngineeringInputError);
});

test('a part can be mounted on a named moving link of its parent, never the parent base by accident', () => {
  const { r } = resolve('valid', (f) => {
    const wheel = Object.entries(f.components).find(([, c]) => c.id === 'drive-wheel')!;
    const cap = { schemaVersion: 1 as const, id: 'cap', revision: '1', identity: { manufacturer: 'fixture', family: 'cap', sku: null, status: 'candidate' as const }, joints: [], models: [], documents: [],
      links: [{ ...wheel[1].links[0]!, id: 'body', massKg: { ...wheel[1].links[0]!.massKg, value: 0.1 }, inertiaKgM2: [1e-5, 0, 0, 1e-5, 0, 1e-5] as [number, number, number, number, number, number], visual: [], collision: [] }],
      ports: [{ id: 'mount', kind: 'mount' as const, frame: { xyzM: [0, 0, 0] as [number, number, number], quaternionXyzw: [0, 0, 0, 1] as [number, number, number, number] }, mate: 'cap', direction: 'bidirectional' as const }] };
    wheel[1].ports.push({ id: 'cap', link: 'rim', kind: 'mount', frame: { xyzM: [0, 0.03, 0], quaternionXyzw: [0, 0, 0, 1] }, mate: 'cap', direction: 'bidirectional' });
    const patched = { ...wheel[1] }; const digest = hashJson(patched);
    delete f.components[wheel[0]]; f.components[digest] = patched;
    for (const i of f.project.assembly.instances) if (i.componentDigest === wheel[0]) i.componentDigest = digest;
    f.components[hashJson(cap)] = cap;
    f.project.assembly.instances.push({ id: 'wheel-cap', componentDigest: hashJson(cap), pose: { xyzM: [0, 0, 0], quaternionXyzw: [0, 0, 0, 1] } });
    f.project.assembly.connections.push({ from: 'wheel-left/cap', to: 'wheel-cap/mount', kind: 'mount' });
    f.project.entityBindings[0]!.instanceIds.push('wheel-cap');
  });
  const mount = r.resolved?.joints.find((j) => j.id === 'mount:wheel-left/cap:wheel-cap/mount');
  expect(r.problems.filter((p) => p.code !== 'INITIAL_PENETRATION')).toEqual([]);
  expect(mount?.parent).toBe('wheel-left/rim');                 // follows the wheel joint, not the hub
  expect(mount?.origin.xyzM).toEqual([0, 0.03, 0]);
});
test('a port naming a link the component does not have, or a child port on a non-root link, is refused', () => {
  const bad = resolve('valid', (f) => { Object.values(f.components).find((c) => c.id === 'amr-chassis')!.ports.find((p) => p.id === 'tray-plate')!.link = 'nope'; }).r;
  expect(codes(bad)).toContain('COMPONENT_TOPOLOGY_INVALID');
  const child = resolve('valid', (f) => { Object.values(f.components).find((c) => c.id === 'service-tray')!.ports[0]!.link = 'plate'; }).r;
  expect(codes(child)).not.toContain('MOUNT_MISMATCH'); // the root link as an explicit child link is the same as the default
});

test('the projected asset is framed on the real root link, not the alphabetically first link', () => {
  const f = clone(engineeringFixture('valid'));
  const chassis = Object.entries(f.components).find(([, c]) => c.id === 'amr-chassis')!;
  const base = chassis[1].links[0]!;
  chassis[1].links.unshift({ ...base, id: 'a_sensor', visual: [], collision: base.collision.map((c) => ({ ...c, geometry: { kind: 'box' as const, sizeM: [0.02, 0.02, 0.02] as [number, number, number] } })) });
  chassis[1].joints.push({ id: 'sensor-mount', kind: 'fixed', parent: 'base', child: 'a_sensor', origin: { xyzM: [0, 0, 0.5], quaternionXyzw: [0, 0, 0, 1] }, axis: [0, 0, 1] });
  const digest = hashJson(chassis[1]); delete f.components[chassis[0]]; f.components[digest] = chassis[1];
  for (const i of f.project.assembly.instances) if (i.componentDigest === chassis[0]) i.componentDigest = digest;
  const { resolved, problems } = resolveAssembly(f.project, f.components, { models: f.models as never });
  expect(problems.filter((p) => p.code !== 'INITIAL_PENETRATION')).toEqual([]);
  const input = prepareEngineeringCompileInput(f.project, resolved!, []);
  const frames = input.runtimeProjection.assets[0]!.frames;
  expect(frames.find((x) => x.id === 'chassis:base:c0')!.translationM).toEqual([0, 0, 0]);
  expect(frames.find((x) => x.id === 'chassis:a_sensor:c0')!.translationM).toEqual([0, 0, 0.5]);
});
