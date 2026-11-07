import { expect, test } from 'vitest';
import { resolveAssembly } from '../../packages/lab-runtime/src/engineering/assembly';
import { validateComponentRevision } from '../../packages/lab-runtime/src/engineering/contracts';
import type { ComponentRevision } from '../../packages/lab-runtime/src/engineering/contracts';
import { assumed, engineeringFixture, scalar } from '../support/engineering';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
type Rated = ComponentRevision & { payloadRatings?: unknown; battery?: unknown; supportPoints?: unknown };
const byId = (f: ReturnType<typeof engineeringFixture>, id: string) => Object.values(f.components).find((c) => c.id === id) as Rated;
const rating = (portId: string, kg: number, nm: number) => ({ portId, maxMassKg: scalar(kg, 'kg'), maxMomentNm: scalar(nm, 'N*m') });
const resolve = (mutate: (f: ReturnType<typeof engineeringFixture>) => void) => {
  const f = clone(engineeringFixture('valid')); mutate(f);
  return resolveAssembly(f.project, f.components, { models: f.models as never });
};
const codes = (r: { problems: { code: string; blocking: boolean }[] }) => r.problems.filter((p) => p.blocking).map((p) => p.code);

test('ratings are optional and an unrated assembly resolves exactly as before', () => {
  const r = resolve(() => {});
  expect(codes(r)).toEqual([]);
  expect(r.resolved).not.toBeNull();
});

test('component contract accepts well-formed ratings and rejects bad references, units and ranges', () => {
  const good = clone(byId(engineeringFixture('valid'), 'amr-chassis')) as Rated;
  good.payloadRatings = [rating('tray-plate', 5, 12)];
  good.supportPoints = [{ linkId: 'base', pointM: [0.2, 0.2, -0.1], source: assumed }];
  expect(validateComponentRevision(good)).toMatchObject({ ok: true });
  const bat = clone(byId(engineeringFixture('valid'), 'battery-24v')) as Rated;
  bat.battery = { portId: 'out', capacityAh: scalar(20, 'Ah'), usableFraction: scalar(0.8, '1') };
  expect(validateComponentRevision(bat)).toMatchObject({ ok: true });

  const problems = (c: Rated) => validateComponentRevision(c).problems.map((p) => p.code);
  const mut = (base: Rated, patch: Partial<Rated>) => ({ ...clone(base), ...patch });
  expect(problems(mut(good, { payloadRatings: [rating('nope', 5, 12)] }))).toContain('RATING_REFERENCE_INVALID');
  expect(problems(mut(good, { payloadRatings: [rating('power-in', 5, 12)] }))).toContain('RATING_REFERENCE_INVALID'); // not a mount port
  expect(problems(mut(good, { payloadRatings: [rating('tray-plate', 5, 12), rating('tray-plate', 4, 10)] }))).toContain('DUPLICATE_ID');
  expect(problems(mut(good, { payloadRatings: [{ ...rating('tray-plate', 5, 12), maxMassKg: scalar(5, 'N') }] }))).toContain('UNIT_NOT_ALLOWED');
  expect(problems(mut(good, { payloadRatings: [rating('tray-plate', 0, 12)] }))).toContain('RATING_RANGE');
  expect(problems(mut(good, { supportPoints: [{ linkId: 'ghost', pointM: [0, 0, 0], source: assumed }] }))).toContain('RATING_REFERENCE_INVALID');
  expect(problems(mut(bat, { battery: { portId: 'mount', capacityAh: scalar(20, 'Ah'), usableFraction: scalar(0.8, '1') } }))).toContain('RATING_REFERENCE_INVALID'); // not a power output
  expect(problems(mut(bat, { battery: { portId: 'out', capacityAh: scalar(20, 'kg'), usableFraction: scalar(0.8, '1') } }))).toContain('UNIT_NOT_ALLOWED');
  expect(problems(mut(bat, { battery: { portId: 'out', capacityAh: scalar(20, 'Ah'), usableFraction: scalar(1.2, '1') } }))).toContain('RATING_RANGE');
  expect(problems(mut(bat, { battery: { portId: 'out', capacityAh: scalar(-1, 'Ah'), usableFraction: scalar(0.8, '1') } }))).toContain('RATING_RANGE');
  expect(problems({ ...clone(good), extra: 1 } as Rated)).not.toEqual([]);
});

test('PAYLOAD_EXCEEDED blocks when the mass beyond a rated port is over its limit', () => {
  const over = resolve((f) => { byId(f, 'amr-chassis').payloadRatings = [rating('tray-plate', 1.0, 100)]; }); // tray is 1.2 kg
  expect(codes(over)).toContain('PAYLOAD_EXCEEDED');
  expect(over.resolved).toBeNull();
  expect(over.problems.find((p) => p.code === 'PAYLOAD_EXCEEDED')!.detail).toMatch(/1\.2 kg of 1 kg/);
  expect(codes(resolve((f) => { byId(f, 'amr-chassis').payloadRatings = [rating('tray-plate', 1.2, 100)]; }))).not.toContain('PAYLOAD_EXCEEDED'); // exactly at the limit is allowed
});

test('PAYLOAD_EXCEEDED also blocks on the worst-case static moment about the rated port', () => {
  const offset = (f: ReturnType<typeof engineeringFixture>) => { byId(f, 'service-tray').links[0]!.comM = [0.5, 0, 0]; }; // 1.2 kg * 9.81 * 0.5 m = 5.9 N*m
  const tight = resolve((f) => { offset(f); byId(f, 'amr-chassis').payloadRatings = [rating('tray-plate', 5, 1)]; });
  expect(codes(tight)).toContain('PAYLOAD_EXCEEDED');
  expect(tight.problems.find((p) => p.code === 'PAYLOAD_EXCEEDED')!.detail).toMatch(/N\*m/);
  expect(codes(resolve((f) => { offset(f); byId(f, 'amr-chassis').payloadRatings = [rating('tray-plate', 5, 10)]; }))).not.toContain('PAYLOAD_EXCEEDED');
});

test('a rating on a port with nothing mounted beyond it checks nothing', () => {
  expect(codes(resolve((f) => { byId(f, 'amr-chassis').payloadRatings = [rating('battery-bay', 0.001, 0.001)]; }))).toContain('PAYLOAD_EXCEEDED'); // the 6 kg battery hangs there
  const f = clone(engineeringFixture('valid'));
  f.project.assembly.instances = f.project.assembly.instances.filter((i) => i.id !== 'tray');
  f.project.assembly.connections = f.project.assembly.connections.filter((c) => !c.to.startsWith('tray/'));
  f.project.entityBindings.forEach((b) => { b.instanceIds = b.instanceIds.filter((id) => id !== 'tray'); });
  byId(f, 'amr-chassis').payloadRatings = [rating('tray-plate', 0.001, 0.001)];
  expect(codes(resolveAssembly(f.project, f.components, { models: f.models as never }))).not.toContain('PAYLOAD_EXCEEDED');
});

test('a manufacturer-sourced rating must cite a document the component declares', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const { loadCatalog } = await import('../../packages/lab-runtime/src/engineering/catalog'); const { hashJson } = await import('../../packages/lab-runtime/src/v2/hash'); const { writeFixtureCatalog } = await import('../support/engineering');
  const bat = clone(byId(engineeringFixture('valid'), 'battery-24v')) as Rated;
  const ghost = { kind: 'manufacturer' as const, documentId: 'no-such-datasheet', revision: '1', locator: 'p2', contentSha256: 'c'.repeat(64) };
  bat.battery = { portId: 'out', capacityAh: { value: 20, unit: 'Ah', source: ghost }, usableFraction: scalar(0.8, '1') };
  const root = await mkdtemp(join(tmpdir(), 'eng-ratings-'));
  try {
    await writeFixtureCatalog(root, { components: { [hashJson(bat)]: bat }, models: {} });
    const result = await loadCatalog(root);
    expect(result.problems.map((p) => p.code)).toContain('PROVENANCE_UNRESOLVED');
    expect(result.problems.find((p) => p.code === 'PROVENANCE_UNRESOLVED')!.path).toMatch(/\/battery\/capacityAh\/source$/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
