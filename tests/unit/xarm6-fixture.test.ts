// M02 (D38, SX-..): xarm6-g2-v1 is generated from the pinned UFACTORY xarm_ros2 files, every vendor byte traces to a commit and a licence,
// the chain FK of the component matches the manufacturer's modified D-H table, and every programmed waypoint is solved within the IK tolerances.
import { expect, test } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { chainFlange, generateXarm6Fixture } from '../../scripts/generate-xarm6-fixture.mjs';
import { validateComponentRevision } from '../../packages/lab-runtime/src/engineering/contracts';
import { forwardKinematics, MAX_CONDITION, PUMA560_REFERENCE, PUMA560_REFERENCE_REVISION, armModelRevision, XARM6_REFERENCE, XARM6_SI } from '../../packages/lab-runtime/src/v2/models/arm-kinematics';
import { loadOracleProfile } from '../../packages/lab-runtime/src/v2/algorithm/checker';
import { validateProjectV2 } from '../../packages/lab-runtime/src/v2/contracts';
import { boxInArm } from '../../packages/lab-runtime/src/v2/models/arm-scene';
import { invertPose, qrotate, type Pose, type Vec3 } from '../../packages/lab-runtime/src/v2/frames';
import { hashJson } from '../../packages/lab-runtime/src/v2/hash';

const DIR = 'robotics/simulation-mujoco/fixtures/xarm6-g2-v1';
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const json = async <T>(name: string) => JSON.parse(await readFile(join(DIR, name), 'utf8')) as T;
const { profile } = loadOracleProfile();
type Box = { centerM: Vec3; sizeM: Vec3 };
interface CellLayout { schemaVersion: 1; provenance: 'assumed'; frame: 'arm_base'; nozzleStand: Box; tray: Box;
  cup: { componentId: 'cup-ref'; radiusM: number; heightM: number; emptyMassKg: number; drinkMassKg: number };
  grasp: { pick: Pose; place: Pose; approachM: number; liftM: number } }
interface WaypointRow { waypoint: string; q: number[]; positionErrorM: number; orientationErrorRad: number; condition: number }
interface XArmPhysics { schemaVersion: 1; provenance: 'assumed'; substitute: boolean; actuators: { joint: string; kp: number; kv: number }[];
  gripper: { driveJoint: string; mimic: { joint: string; multiplier: number }[]; openingMaxM: number; forceN: number; kp: number };
  pads: { link: string; centerM: Vec3; sizeM: Vec3 }[]; contact: { solref: [number, number]; solimp: [number, number, number]; impratio: number; condim: 4 };
  capsuleRadiusM: number[]; maxAccelerationRadS2: number[]; speedFraction: number }
type Scalar = { value: number; unit: string; source: { kind: string } };
type Shape = { geometry: { kind: string; blobSha256?: string }; source: { kind: string } };
type Comp = { links: { id: string; visual: Shape[]; collision: Shape[]; massKg: Scalar; inertiaKgM2: number[] | null; inertialSource: { kind: string } }[];
  joints: { id: string; kind: string; limits?: Record<'lower' | 'upper' | 'velocity' | 'effort', Scalar> }[] };
type Source = { sha256: string; license: string; commit: string; repository: string };
type Manifest = { files: { path: string; sha256: string; bytes: number }[]; blobs: { sha256: string; sourceSha256: string; triangles: number; droppedTriangles: number; bytes: number }[] };
const vendor = async () => json<{ repositories: { id: string; copyright: string; commit: string; license: string }[]; sources: Source[] }>('vendor-manifest.json');
async function files(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) out.push(...(e.isDirectory() ? await files(join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`]));
  return out.sort();
}

// Historical full-file hashes for (programs.json, manifest.json). The manifest also binds each mesh.
const v1Profiles = [
  ['af99b362b9d22ca2bbb327deef6ab820ae6de9dc181643e6ffd61b85e1ce0e48', '51bad5842206673d9f417a5f0f4813ac904f64b12a53cbfb403e1e12294b3407'],
  ['e275350cebd36a7bbf0b72c04e421f74df50a4aaaa705683ddb8eede6ebf218d', '3d6deccb7de2e4de22d912608cdf15aa36cd09f0614b97dc2e12598e345958d9'],
] as const;

async function checkV1Output(dir: string) {
  const pair = await Promise.all(['programs.json', 'manifest.json'].map(async f => sha(await readFile(join(dir, f)))));
  expect(v1Profiles).toContainEqual(pair);
  const manifest = await json<Manifest>('manifest.json');
  const want = ['manifest.json', ...manifest.files.map(e => e.path), ...manifest.blobs.map(e => `blobs/${e.sha256}.stl`)].sort();
  // The generator reads vendor-manifest.json directly from the frozen fixture.
  expect(await files(dir)).toEqual(want.filter(f => f !== 'vendor-manifest.json'));
  for (const f of want.filter(f => !['manifest.json', 'programs.json', 'vendor-manifest.json'].includes(f))) {
    expect((await readFile(join(dir, f))).equals(await readFile(join(DIR, f))), f).toBe(true);
  }
}

test('xArm v1 generator matches one complete reference profile and the frozen model and meshes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'xarm6-fixture-'));
  try {
    expect(sha(await readFile(join(DIR, 'manifest.json')))).toBe(v1Profiles[0][1]);
    const m = await json<Manifest>('manifest.json');
    for (const e of [...m.files, ...m.blobs.map(b => ({ ...b, path: `blobs/${b.sha256}.stl` }))]) {
      const bytes = await readFile(join(DIR, e.path));
      expect([sha(bytes), bytes.length], e.path).toEqual([e.sha256, e.bytes]);
    }
    expect(m.files.map(e => e.path)).toEqual((await files(DIR)).filter(f => f !== 'manifest.json' && !f.startsWith('blobs/')));
    await generateXarm6Fixture(dir);
    await checkV1Output(dir);

    const mesh = `blobs/${m.blobs[0]!.sha256}.stl`;
    for (const f of ['component.json', mesh, 'programs.json']) {
      const original = await readFile(join(dir, f));
      await writeFile(join(dir, f), Buffer.concat([original, Buffer.from(' ')]));
      await expect(checkV1Output(dir), f).rejects.toThrow();
      await writeFile(join(dir, f), original);
    }
    await writeFile(join(dir, 'extra'), '');
    await expect(checkV1Output(dir)).rejects.toThrow();
    await rm(join(dir, 'extra'));

    // Reconstruct the independently captured alternate manifest and confirm its exact bytes by hash.
    const frozenManifest = await readFile(join(DIR, 'manifest.json'), 'utf8');
    const alternate = frozenManifest.replace(v1Profiles[0][0], v1Profiles[1][0]).replace('"bytes": 3914,', '"bytes": 3915,');
    expect(sha(alternate)).toBe(v1Profiles[1][1]);
    await writeFile(join(dir, 'programs.json'), await readFile(join(DIR, 'programs.json')));
    await writeFile(join(dir, 'manifest.json'), alternate);
    await expect(checkV1Output(dir)).rejects.toThrow();
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 120_000);

test('component.json is a valid engineering component: J1..J6 revolute, manufacturer masses and inertia on every link', async () => {
  const c = await json<Comp>('component.json');
  expect(validateComponentRevision(c).problems).toEqual([]);
  const arm = c.joints.filter((j) => /^J\d$/.test(j.id));
  expect(arm.map((j) => [j.id, j.kind])).toEqual([1, 2, 3, 4, 5, 6].map((i) => [`J${i}`, 'revolute']));
  expect(c.links.map((l) => l.id).slice(0, 7)).toEqual(['base', 'link1', 'link2', 'link3', 'link4', 'link5', 'link6']);
  for (const l of c.links) {
    expect(l.massKg.value, l.id).toBeGreaterThan(0);
    expect(l.massKg.source.kind).toBe('manufacturer');
    expect(l.inertiaKgM2, l.id).toHaveLength(6);
    expect(l.inertialSource.kind).toBe('manufacturer');
    expect(l.visual.length, l.id).toBe(1);
    for (const s of [...l.visual, ...l.collision]) { expect(s.geometry.kind).toBe('mesh'); expect(s.source.kind).toBe('manufacturer'); }
  }
  for (const j of arm) for (const k of ['lower', 'upper', 'velocity', 'effort'] as const) expect(j.limits![k].source.kind, `${j.id} ${k}`).toBe('manufacturer');
});

test('every mesh blob is named by its content hash and traces to a vendor file with licence and commit; NOTICE carries each copyright', async () => {
  const c = await json<Comp>('component.json'), v = await vendor(), m = await json<Manifest>('manifest.json');
  const blobs = new Set(c.links.flatMap((l) => [...l.visual, ...l.collision]).map((s) => s.geometry.blobSha256!));
  expect((await readdir(join(DIR, 'blobs'))).sort()).toEqual([...blobs].map((b) => `${b}.stl`).sort());
  let visualBytes = 0;
  for (const b of blobs) {
    const bytes = await readFile(join(DIR, 'blobs', `${b}.stl`));
    expect(sha(bytes)).toBe(b);
    expect(bytes.length).toBe(84 + 50 * bytes.readUInt32LE(80)); // binary STL
    visualBytes += bytes.length;
    const derived = m.blobs.find((x) => x.sha256 === b), src = v.sources.find((s) => s.sha256 === (derived ? derived.sourceSha256 : b));
    expect(src, b).toBeDefined();
    expect(src!.license.length * src!.commit.length, b).toBeGreaterThan(0);
  }
  expect(visualBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
  const base = m.blobs.find((x) => x.sourceSha256 === 'd46f7e336755a7fd58ebee4b3eab2c6eca7eec611358fc6bf5f683e63efd7575')!;
  expect([base.triangles, base.droppedTriangles]).toEqual([50115, 300]); // the 300 stray triangles of base_link_g2 (spike M00) are filtered
  expect(m.blobs.filter((x) => x !== base).every((x) => x.droppedTriangles === 0)).toBe(true);
  const notice = await readFile(join(DIR, 'NOTICE'), 'utf8');
  for (const r of v.repositories) { expect(notice).toContain(r.copyright); expect(notice).toContain(r.commit); }
  expect(new Set(v.sources.map((s) => s.repository))).toEqual(new Set(v.repositories.map((r) => r.id)));
});

test('XARM6_REFERENCE is the manufacturer table: id, limits equal to the component, the PUMA table untouched', async () => {
  const c = await json<Comp>('component.json');
  expect(XARM6_REFERENCE.id).toBe('xarm6-reference');
  expect(XARM6_REFERENCE.provenance).toBe('manufacturer_nominal');
  XARM6_SI.toolM.forEach((v, i) => expect(v).toBeCloseTo([0, 0, 0.172][i]!, 15)); // Gripper G2 joint_tcp z
  c.joints.filter((j) => /^J\d$/.test(j.id)).forEach((j, i) => {
    const l = XARM6_SI.limits[i]!;
    expect(j.limits!.lower.value).toBeCloseTo(l.min, 11); expect(j.limits!.upper.value).toBeCloseTo(l.max, 11); expect(j.limits!.velocity.value).toBeCloseTo(l.maxVelocity, 11);
  });
  expect(PUMA560_REFERENCE_REVISION).toBe('bd57344faecee29df2d50b8e8535de6936b05da3778eadbf46ad0e5d626650f3');
  expect(armModelRevision(PUMA560_REFERENCE)).toBe(PUMA560_REFERENCE_REVISION);
});

test('fk-golden: the component joint chain and the D-H table agree within fkTolM at 20 seeded poses, and both columns recompute', async () => {
  const c = await json<Comp>('component.json'), g = await json<{ poses: { q: number[]; flangeChainM: Vec3; flangeDhM: Vec3 }[] }>('fk-golden.json');
  expect(g.poses).toHaveLength(20);
  const d = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
  for (const p of g.poses) {
    p.q.forEach((v, i) => { expect(v).toBeGreaterThanOrEqual(Math.max(XARM6_SI.limits[i]!.min, -Math.PI)); expect(v).toBeLessThanOrEqual(Math.min(XARM6_SI.limits[i]!.max, Math.PI)); });
    expect(d(p.flangeChainM, p.flangeDhM)).toBeLessThanOrEqual(profile.mujocoArm!.fkTolM);
    expect(d(p.flangeChainM, chainFlange(c, p.q))).toBeLessThanOrEqual(1e-11);
    expect(d(p.flangeDhM, forwardKinematics(XARM6_SI, p.q).flange.position)).toBeLessThanOrEqual(1e-11);
  }
});

test('physics.json and cell-layout.json are assumed, complete and keep the cell within 0.7 m of the base', async () => {
  const ph = await json<XArmPhysics>('physics.json'), L = await json<CellLayout>('cell-layout.json');
  expect([ph.provenance, L.provenance, L.frame]).toEqual(['assumed', 'assumed', 'arm_base']);
  expect(ph.substitute).toBe(false);
  // the vendor <dynamics damping friction> are Gazebo simulation settings: cited from the xacro, but assumed, not product data
  const jd = (ph as unknown as { jointDynamics: { source: { kind: string; documentId: string } } }).jointDynamics;
  expect([jd.source.kind, jd.source.documentId]).toEqual(['assumed', 'xarm_ros2:xarm_description/urdf/xarm6/xarm6.urdf.xacro']);
  expect(ph.actuators.map((a) => a.joint)).toEqual(['J1', 'J2', 'J3', 'J4', 'J5', 'J6']);
  expect(ph.capsuleRadiusM).toHaveLength(6);
  expect(ph.maxAccelerationRadS2).toHaveLength(6);
  expect(ph.pads).toHaveLength(2);
  for (const b of [L.nozzleStand, L.tray]) for (const sx of [-1, 1]) for (const sy of [-1, 1])
    expect(Math.hypot(b.centerM[0] + sx * b.sizeM[0] / 2, b.centerM[1] + sy * b.sizeM[1] / 2)).toBeLessThanOrEqual(0.7);
  expect(L.cup).toEqual({ componentId: 'cup-ref', radiusM: 0.04, heightM: 0.1, emptyMassKg: 0.02, drinkMassKg: 0.3 });
});

test('programs.json: six waypoints in limits, solved within the IK tolerances, TCP at pick and place on the layout, digest of the table', async () => {
  const P = await json<{ programs: { modelId: string; waypoints: Record<string, number[]>; choreography: Record<string, unknown[]>; motion: { profile: string } }; table: WaypointRow[]; digest: string }>('programs.json');
  const L = await json<CellLayout>('cell-layout.json');
  const names = ['home', 'pickApproach', 'pick', 'lift', 'placeApproach', 'place'];
  expect(P.programs.modelId).toBe('xarm6-reference');
  expect(P.table.map((r) => r.waypoint)).toEqual(names);
  expect(Object.keys(P.programs.waypoints).sort()).toEqual([...names].sort());
  expect(P.programs.motion.profile).toBe('quintic-sync-v1');
  for (const r of P.table) {
    expect(P.programs.waypoints[r.waypoint]).toEqual(r.q);
    r.q.forEach((v, i) => { expect(v, r.waypoint).toBeGreaterThanOrEqual(XARM6_SI.limits[i]!.min); expect(v, r.waypoint).toBeLessThanOrEqual(XARM6_SI.limits[i]!.max); });
    expect(r.positionErrorM, r.waypoint).toBeLessThanOrEqual(1e-3);
    expect(r.orientationErrorRad, r.waypoint).toBeLessThanOrEqual(0.0087);
    expect(r.condition, r.waypoint).toBeLessThanOrEqual(MAX_CONDITION);
  }
  for (const w of ['pick', 'place'] as const) {
    const tcp = forwardKinematics(XARM6_SI, P.programs.waypoints[w]!).tcp.position, want = L.grasp[w].position;
    expect(Math.hypot(tcp[0] - want[0], tcp[1] - want[1], tcp[2] - want[2]), w).toBeLessThanOrEqual(1e-3);
  }
  expect(P.digest).toBe(hashJson(P.table));
});

test('coffee-cell-project.json is a valid project whose tray sits on the coffee pickup and whose static obstacles clear every waypoint', async () => {
  const p = await json<{ world: { points: { kind: string; x: number; y: number }[]; obstacles: { id: string; x: number; y: number; width: number; height: number }[] };
    armCollisionProfile: { modelId: string; modelRevision: string; provenance: string; baseInMap: Pose; fixtureHeightM: number } }>('coffee-cell-project.json');
  const L = await json<CellLayout>('cell-layout.json'), P = await json<{ programs: { waypoints: Record<string, number[]> } }>('programs.json');
  expect(validateProjectV2(p).ok).toBe(true);
  const a = p.armCollisionProfile;
  expect([a.modelId, a.modelRevision, a.provenance]).toEqual(['xarm6-reference', XARM6_SI.revision, 'illustrative']);
  const r = qrotate(a.baseInMap.quaternionXyzw, L.tray.centerM), tray = r.map((v, k) => v + a.baseInMap.position[k]!);
  const pickup = p.world.points.find((x) => x.kind === 'coffee_pickup')!;
  expect(Math.hypot(tray[0]! - pickup.x, tray[1]! - pickup.y)).toBeLessThanOrEqual(0.05);
  const mapInArm = invertPose(a.baseInMap), boxes = p.world.obstacles.map((o) => boxInArm(o.id, [o.x, o.y, 0], [o.x + o.width, o.y + o.height, a.fixtureHeightM], mapInArm) as { id: string; min: Vec3; max: Vec3 });
  expect(boxes.length).toBeGreaterThan(0);
  for (const [w, q] of Object.entries(P.programs.waypoints)) {
    const f = forwardKinematics(XARM6_SI, q), pts = [...f.frames.map((x) => x.position), f.tcp.position];
    for (const b of boxes) for (const pt of pts) expect(pt.every((v, k) => v >= b.min[k]! - 0.1 && v <= b.max[k]! + 0.1), `${w} in ${b.id}`).toBe(false);
  }
});
