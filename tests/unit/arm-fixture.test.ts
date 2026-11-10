// X02 (R1.1 D23, SX-18, SX-20): arm-ref-3d-v1 is generated, byte-stable, schema-valid, parity-exact with the Lab FK, and every number the table does not give is labelled assumed.
import { expect, test } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { chainFk, generateArmFixture } from '../../scripts/generate-arm-fixture.mjs';
import { validateComponentRevision } from '../../packages/lab-runtime/src/engineering/contracts';
import { forwardKinematics, PUMA560_SI } from '../../packages/lab-runtime/src/v2/models/arm-kinematics';
import { DEFAULT_ARM_GEOMETRY } from '../../packages/lab-runtime/src/v2/models/arm-collision';
import { jointNameForLinuxcnc } from '../../packages/lab-runtime/src/v2/models/arm-kinematics';

const DIR = 'robotics/simulation-3d/fixtures/arm-ref-3d-v1';
const golden = JSON.parse(await readFile('tests/fixtures/digital-twin/arm-fk-golden.json', 'utf8')) as { fk: { q: number[] }[] };
const committed = async (name: string) => readFile(join(DIR, name), 'utf8');
type Comp = Awaited<ReturnType<typeof generateArmFixture>>['component'];
const component = async () => JSON.parse(await committed('component.json')) as Comp;

test('the generator reproduces the committed bytes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'arm-fixture-'));
  try {
    const out = await generateArmFixture(dir);
    for (const name of ['component.json', 'manifest.json']) {
      expect(await readFile(join(dir, name), 'utf8'), name).toBe(await committed(name));
    }
    const manifest = JSON.parse(await committed('manifest.json')) as { files: { path: string; sha256: string; bytes: number }[]; componentDigest: string };
    const text = await committed('component.json');
    expect(manifest.files).toEqual([{ path: 'component.json', sha256: createHash('sha256').update(text).digest('hex'), bytes: Buffer.byteLength(text) }]);
    expect(manifest.componentDigest).toBe(out.componentDigest);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the component is a valid engineering component with a 7-link, 6-revolute chain named J1..J6', async () => {
  const c = await component();
  const r = validateComponentRevision(c);
  expect(r.problems).toEqual([]);
  expect(c.links.map((l) => l.id)).toEqual(['base', ...[1, 2, 3, 4, 5, 6].map((i) => `link${i}`)]);
  expect(c.joints.map((j) => [j.id, j.kind, j.parent, j.child])).toEqual([0, 1, 2, 3, 4, 5].map((i) => [jointNameForLinuxcnc(i), 'revolute', i === 0 ? 'base' : `link${i}`, `link${i + 1}`]));
  for (const j of c.joints) expect(j.axis).toEqual([0, 0, 1]);
});

test('the static chain FK equals the Lab forwardKinematics at every golden pose to 1e-9 m', async () => {
  const c = await component();
  expect(golden.fk.length).toBeGreaterThanOrEqual(4);
  for (const { q } of golden.fk) {
    const got = chainFk(c, q).flange, want = forwardKinematics(PUMA560_SI, q).flange.position;
    expect(Math.hypot(got[0] - want[0], got[1] - want[1], got[2] - want[2]), JSON.stringify(q)).toBeLessThanOrEqual(1e-9);
  }
});

test('limits come from the Lab table; masses, inertia and effort are assumed, positive and complete', async () => {
  const c = await component();
  c.joints.forEach((j, i) => {
    const l = (j as unknown as { limits: Record<'lower' | 'upper' | 'velocity' | 'effort', { value: number; source: { kind: string } }> }).limits;
    [l.lower.value, l.upper.value, l.velocity.value].forEach((v, k) => expect(v).toBeCloseTo([PUMA560_SI.limits[i]!.min, PUMA560_SI.limits[i]!.max, PUMA560_SI.limits[i]!.maxVelocity][k]!, 11)); // the fixture rounds to 12 digits
    expect(l.effort.value).toBeGreaterThan(0);
    expect(l.effort.source.kind).toBe('assumed');
  });
  for (const l of c.links) {
    expect(l.massKg.value).toBeGreaterThan(0);
    expect(l.massKg.source.kind).toBe('assumed');
    expect(l.inertiaKgM2).toHaveLength(6);
    expect(l.inertiaKgM2!.every(Number.isFinite)).toBe(true);
    expect(l.inertialSource.kind).toBe('derived');
  }
  expect(c.links.slice(1).map((l) => l.massKg.value)).toEqual([8, 6, 4, 1.5, 1, 0.5]);
  expect(c.joints.map((j) => (j as unknown as { limits: { effort: { value: number } } }).limits.effort.value)).toEqual([200, 200, 100, 30, 20, 10]);
});

test('every link is a cylinder of the collision link radius between consecutive joint origins, or a sphere when they coincide (the two segments the collision capsules also have)', async () => {
  const c = await component();
  for (const l of c.links) {
    expect(l.collision).toHaveLength(1);
    const g = l.collision[0]!.geometry as { kind: string; radiusM: number; lengthM?: number };
    expect(g.radiusM).toBe(DEFAULT_ARM_GEOMETRY.linkRadiusM);
    expect(['cylinder', 'sphere']).toContain(g.kind);
    expect(l.visual).toEqual(l.collision);
  }
  expect(c.links.map((l) => (l.collision[0]!.geometry as { kind: string }).kind)).toEqual(['sphere', 'sphere', 'cylinder', 'cylinder', 'sphere', 'sphere', 'sphere']);
});
