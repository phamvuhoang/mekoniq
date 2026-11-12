// M05: MockArmPlant runs a program set other than PUMA's (xarm6-g2-v1), moves on quintic-sync-v1 segments and grips by contact: the cup is held only while the plant's pads
// hold it, and it is put only once the plant says it rests on the tray. The plant here is a scripted pure function (actual = commanded, a simple gripper and one cup).
import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { MockArmPlant, MOCK_ARM_PARAMS, type ArmProgramSet, type ArmTracking, type PlantExtras } from '../../packages/cell-adapters/src/mock-arm';
import { quinticSegment } from '../../packages/cell-adapters/src/arm-motion';
import type { CellCommand, CellReport } from '../../packages/cell-adapters/src/contract';
import { forwardKinematics, PUMA560_SI, XARM6_SI } from '../../packages/lab-runtime/src/v2/models/arm-kinematics';
import { loadOracleProfile } from '../../packages/lab-runtime/src/v2/algorithm/checker';

const FILE = JSON.parse(readFileSync('robotics/simulation-mujoco/fixtures/xarm6-g2-v1/programs.json', 'utf8')) as { programs: ArmProgramSet };
const P = (loadOracleProfile().profile as unknown as { mujocoArm: Record<string, number> }).mujocoArm;
const TRACKING: ArmTracking = { reachTolRad: P.reachTolRad!, settleTicks: P.settleTicks!, followTolRad: P.followTolRad!, followTicks: P.followTicks! };
const OPEN = 0.0889, CUP_W = 0.0793; // physics.json openingMaxM; the opening a gripped cup reads (M04)
const CONTACT = { openM: OPEN, closedM: 0, gripSettleTicks: P.gripSettleTicks!, dropTicks: P.dropTicks!, liftMinM: P.liftMinM!, releaseTimeoutTicks: 200 };
const PROGRAMS: ArmProgramSet = { ...FILE.programs, contact: CONTACT };
const RX = { robotId: 'amr-1', slot: 1 };
const command = (id: string, program: 'cup-pick' | 'cup-place'): CellCommand => ({ runId: 'r', commandId: id, deviceId: 'arm', controlEpoch: 1, expiresAt: '2026-11-06T00:00:00Z', recipeRevision: 1,
  programRef: { id: program, hash: 'a'.repeat(64) }, payloadHash: 'a'.repeat(64), capability: 'start_job', payload: { jobId: 'j' } });
const tcp = (q: readonly number[]) => forwardKinematics(XARM6_SI, q).tcp.position;
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

interface Script { noCup?: boolean; contactLost?: (tick: number) => boolean; noExtras?: (tick: number) => boolean; releaseMisses?: boolean }
/** A scripted plant: the joints do what they are told; the fingers move 3 mm a tick towards the command and stop on the cup; the pads hold the cup 3 ticks after closing on it;
 * a held cup keeps its offset from the TCP; an opened gripper lets go at once; a cup let go at the place pose rests on the tray 2 ticks later. Positions in the arm base frame. */
function scriptedPlant(script: Script = {}) {
  const at = tcp(FILE.programs.waypoints.pick!);
  const w = { tick: 0, opening: OPEN, closedTicks: 0, cup: { pos: [...at], restingOn: 'stand' as string | null, held: false, offset: [0, 0, 0], free: 0 } };
  return {
    w,
    step(commanded: number[], gripperM: number): { actual: number[]; extras?: PlantExtras } {
      w.tick++;
      const t = tcp(commanded), c = w.cup, near = !script.noCup && dist(t, c.pos) < 0.01, target = gripperM < CUP_W && (near || c.held) ? CUP_W : gripperM;
      w.opening += Math.max(-0.003, Math.min(0.003, target - w.opening));
      w.closedTicks = gripperM < CUP_W ? w.closedTicks + 1 : 0;
      if (!c.held && near && w.closedTicks >= 3) { c.held = true; c.restingOn = null; c.offset = c.pos.map((v, i) => v - t[i]!); }
      if (c.held && gripperM >= CUP_W) { c.held = false; c.free = 0; }
      if (c.held) c.pos = t.map((v, i) => v + c.offset[i]!);
      else if (c.restingOn === null && ++c.free >= 2) c.restingOn = script.releaseMisses ? 'floor' : 'tray';
      const extras: PlantExtras = { gripper: { openingM: w.opening, heldPropIds: c.held && !script.contactLost?.(w.tick) ? ['cup-1'] : [] },
        props: script.noCup ? [] : [{ propId: 'cup-1', position: [...c.pos], restingOn: c.restingOn }] };
      return { actual: [...commanded], ...script.noExtras?.(w.tick) ? {} : { extras } };
    },
  };
}
function make(script: Script = {}, programs: ArmProgramSet = PROGRAMS) {
  const state = MockArmPlant.initial('arm', 'boot-0:arm', programs), fake = scriptedPlant(script), reports: CellReport[] = [];
  const takes: { id: string | undefined; heldNow: boolean }[] = [], puts: { id: string; restingOn: string | null | undefined }[] = [];
  let last: PlantExtras | undefined;
  const cups = { take: (id?: string) => { takes.push({ id, heldNow: !!id && !!last?.gripper?.heldPropIds.includes(id) }); return id ?? null; },
    put: (id: string) => { puts.push({ id, restingOn: last?.props?.find((p) => p.propId === id)?.restingOn }); } };
  const plant = new MockArmPlant(state, () => Date.parse('2026-11-12T00:00:00Z'), () => 'boot-2', cups, () => RX, XARM6_SI, TRACKING, programs);
  plant.on((r) => reports.push(r));
  const tick = (p: MockArmPlant) => { p.advance(); const out = fake.step(p.state.commandedQ ?? p.state.q, p.state.gripperCommandM ?? OPEN); last = out.extras; p.observe(out.actual, [], out.extras); };
  const drive = (id: string, program: 'cup-pick' | 'cup-place', limit = 4000, p = plant) => {
    expect(p.execute(command(id, program)).accepted).toBe(true);
    for (let n = 0; n < limit && p.state.programs.find((x) => x.commandId === id)!.state === 'running' && !p.state.stop?.latched; n++) tick(p);
    return p.state.programs.find((x) => x.commandId === id)!;
  };
  return { plant, state, fake, reports, takes, puts, drive, tick };
}

test('the fixture programs of xarm6-g2-v1 are an ArmProgramSet for XARM6_SI as they are', () => {
  const set: ArmProgramSet = FILE.programs;
  expect(set.modelId).toBe(XARM6_SI.id);
  expect(set.motion).toMatchObject({ profile: 'quintic-sync-v1', speedFraction: 0.5 });
  expect(set.motion.profile === 'quintic-sync-v1' && set.motion.maxAccelerationRadS2.length).toBe(6);
  expect(Object.keys(set).sort()).toEqual(['choreography', 'modelId', 'motion', 'waypoints']);
  for (const steps of Object.values(set.choreography)) for (const s of steps) expect(set.waypoints[s.waypoint], s.waypoint).toBeDefined();
  for (const [name, q] of Object.entries(set.waypoints)) {
    expect(q, name).toHaveLength(6);
    q.forEach((v, i) => { expect(v).toBeGreaterThanOrEqual(XARM6_SI.limits[i]!.min); expect(v).toBeLessThanOrEqual(XARM6_SI.limits[i]!.max); });
  }
  expect(() => new MockArmPlant(MockArmPlant.initial('arm', 'b', set), () => 0, () => 'b', { take: () => null, put: () => {} }, () => null, XARM6_SI, TRACKING, set)).not.toThrow();
});

test('contact needs tracking, and a program set must name the plant model', () => {
  const cups = { take: () => null, put: () => {} };
  expect(() => new MockArmPlant(MockArmPlant.initial('arm', 'b', PROGRAMS), () => 0, () => 'b', cups, () => null, XARM6_SI, undefined, PROGRAMS)).toThrow('ARM_CONTACT_NEEDS_TRACKING');
  expect(() => new MockArmPlant(MockArmPlant.initial('arm', 'b', PROGRAMS), () => 0, () => 'b', cups, () => null, PUMA560_SI, TRACKING, PROGRAMS)).toThrow('ARM_PROGRAM_MODEL_MISMATCH');
});

test('success: cup-pick then cup-place complete; the cup is taken only once the pads hold it and put only once it rests on the tray', () => {
  const h = make();
  const pick = h.drive('p1', 'cup-pick');
  expect(pick.state).toBe('completed');
  expect(pick.evidence).toMatchObject({ grip: 'contact', gripperClosed: true, objectPresent: true, cupId: 'cup-1', liftPoseReached: true });
  expect(h.takes).toEqual([{ id: 'cup-1', heldNow: true }]);
  expect(h.state).toMatchObject({ holding: 'cup-1', gripper: 'closed', gripperCommandM: 0 });
  const place = h.drive('p2', 'cup-place');
  expect(place.state).toBe('completed');
  expect(place.evidence).toMatchObject({ grip: 'contact', released: true, receiverId: 'amr-1', slot: 1, cupId: 'cup-1' });
  expect(h.puts).toEqual([{ id: 'cup-1', restingOn: 'tray' }]);
  expect(h.state).toMatchObject({ holding: null, gripper: 'open', gripperCommandM: OPEN });
  expect(typeof place.evidence.maxSlipM).toBe('number'); expect(place.evidence.maxSlipM as number).toBeLessThan(P.slipTolM!);
  expect(h.state.stop).toBeUndefined();
  expect(JSON.parse(JSON.stringify(h.state))).toEqual(h.state);
});

test('a state saved mid-grip and restored continues the grip the same way', () => {
  const a = make(), b = make();
  expect(a.drive('p1', 'cup-pick').state).toBe('completed');
  expect(b.plant.execute(command('p1', 'cup-pick')).accepted).toBe(true);
  for (let n = 0; n < 4000 && !(b.state.grip?.phase === 'closing' && b.state.grip.ticks > 5); n++) b.tick(b.plant);
  expect(b.state.grip).toMatchObject({ phase: 'closing' }); expect(b.state.holding).toBeNull();
  const restored = new MockArmPlant(JSON.parse(JSON.stringify(b.state)), () => Date.parse('2026-11-12T00:00:00Z'), () => 'boot-2', { take: (id?: string) => id ?? null, put: () => {} }, () => RX, XARM6_SI, TRACKING, PROGRAMS);
  for (let n = 0; n < 4000 && restored.state.programs[0]!.state === 'running'; n++) b.tick(restored);
  expect(restored.state.programs[0]!.evidence).toEqual(a.state.programs[0]!.evidence);
  expect(restored.state.tick).toBe(a.state.tick);
});

test('the gripper closes with no cup between the pads: objectPresent false, nothing held, nothing taken', () => {
  const h = make({ noCup: true });
  const pick = h.drive('p1', 'cup-pick');
  expect(pick.state).toBe('completed');
  expect(pick.evidence).toMatchObject({ grip: 'contact', gripperClosed: true, objectPresent: false, cupId: null, liftPoseReached: false });
  expect(h.state.holding).toBeNull(); expect(h.takes).toEqual([]);
});

test('the cup leaves the pads for dropTicks ticks between lift and place: CUP_DROPPED, the program is unknown and the gripper stays commanded closed', () => {
  const h = make();
  expect(h.drive('p1', 'cup-pick').state).toBe('completed');
  const from = h.fake.w.tick + 20; // the scripted loss starts 20 ticks into cup-place, while the arm travels to placeApproach
  const lost = make({ contactLost: (t) => t >= from });
  expect(lost.drive('p1', 'cup-pick').state).toBe('completed');
  const place = lost.drive('p2', 'cup-place');
  expect(place.state).toBe('unknown');
  expect(lost.state.stop).toMatchObject({ latched: true, reason: 'CUP_DROPPED' });
  expect(lost.state.tick).toBe(from + CONTACT.dropTicks - 1);
  expect(lost.state.gripperCommandM).toBe(CONTACT.closedM); expect(lost.state.holding).toBe('cup-1'); expect(lost.puts).toEqual([]);
  expect(lost.reports.at(-1)!.observation).toMatchObject({ result: 'outcome_unknown', reasonCodes: ['CUP_DROPPED'] });
  expect(typeof place.evidence.maxSlipM).toBe('number');
});

test('the cup leaves the pads for dropTicks - 1 ticks and comes back: no stop', () => {
  const h = make();
  expect(h.drive('p1', 'cup-pick').state).toBe('completed');
  const from = h.fake.w.tick + 20, h2 = make({ contactLost: (t) => t >= from && t < from + CONTACT.dropTicks - 1 });
  expect(h2.drive('p1', 'cup-pick').state).toBe('completed');
  expect(h2.drive('p2', 'cup-place').state).toBe('completed');
  expect(h2.state.stop).toBeUndefined(); expect(h2.puts).toEqual([{ id: 'cup-1', restingOn: 'tray' }]);
});

test('ticks with no plant extras while a cup is held read as no cup held: CUP_DROPPED, never a release', () => {
  const h = make();
  expect(h.drive('p1', 'cup-pick').state).toBe('completed');
  const from = h.fake.w.tick + 20, h2 = make({ noExtras: (t) => t >= from });
  expect(h2.drive('p1', 'cup-pick').state).toBe('completed');
  expect(h2.drive('p2', 'cup-place').state).toBe('unknown');
  expect(h2.state.stop?.reason).toBe('CUP_DROPPED'); expect(h2.state.tick).toBe(from + CONTACT.dropTicks - 1); expect(h2.puts).toEqual([]);
});

test('a released cup that does not come to rest on the tray within releaseTimeoutTicks fails the program with RELEASE_NOT_ON_RECEIVER', () => {
  const h = make({ releaseMisses: true });
  expect(h.drive('p1', 'cup-pick').state).toBe('completed');
  const place = h.drive('p2', 'cup-place');
  expect(place.state).toBe('failed');
  expect(h.reports.at(-1)!.observation).toMatchObject({ result: 'failed', reasonCodes: ['RELEASE_NOT_ON_RECEIVER'] });
  expect(h.puts).toEqual([]); expect(h.state.stop).toBeUndefined();
  expect(place.evidence.released).toBeUndefined();
});

test("fault('arm-stop') and halt() while holding never change the gripper command", () => {
  const h = make();
  expect(h.drive('p1', 'cup-pick').state).toBe('completed');
  expect(h.state.gripperCommandM).toBe(CONTACT.closedM);
  expect(h.plant.execute(command('p2', 'cup-place')).accepted).toBe(true);
  for (let i = 0; i < 30; i++) h.tick(h.plant);
  h.plant.fault('arm-stop');
  expect(h.state.stop?.reason).toBe('MODEL_STOP'); expect(h.state.gripperCommandM).toBe(CONTACT.closedM); expect(h.state.holding).toBe('cup-1');
  for (let i = 0; i < 30; i++) h.tick(h.plant);
  h.plant.halt('WORKER_LOST');
  expect(h.state.gripperCommandM).toBe(CONTACT.closedM); expect(h.puts).toEqual([]);
});

test('quintic-sync-v1: the command reaches the waypoint in exactly quinticSegment(...).ticks ticks, every joint on the same tick', () => {
  const h = make();
  const m = FILE.programs.motion as { maxAccelerationRadS2: number[]; speedFraction: number };
  const home = FILE.programs.waypoints.home!, goal = FILE.programs.waypoints.pickApproach!;
  const seg = quinticSegment(home, goal, { maxVelocity: XARM6_SI.limits.map((l) => l.maxVelocity), maxAcceleration: m.maxAccelerationRadS2, speedFraction: m.speedFraction, dtS: MOCK_ARM_PARAMS.dtS });
  expect(h.state.q).toEqual(home);
  expect(h.plant.execute(command('p1', 'cup-pick')).accepted).toBe(true);
  const commanded: number[][] = [];
  for (let k = 1; k <= seg.ticks; k++) { h.tick(h.plant); commanded.push([...h.state.commandedQ!]); }
  expect(commanded.at(-1)).toEqual(goal);
  commanded.forEach((c, k) => expect(c).toEqual(seg.at(k + 1)));
  const before = commanded.at(-2)!;
  goal.forEach((v, i) => { if (Math.abs(v - home[i]!) > 1e-6) expect(before[i], `joint ${i}`).not.toBe(v); });
});
