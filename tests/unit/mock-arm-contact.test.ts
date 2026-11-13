// M05: MockArmPlant runs a program set other than PUMA's (xarm6-g2-v1), moves on quintic-sync-v1 segments and grips by contact: the cup is held only while the plant's pads
// hold it, and it is put only once the plant says it rests on the tray. The plant here is a scripted pure function (actual = commanded, a simple gripper and one cup).
import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { MockArmPlant, MOCK_ARM_PARAMS, PUMA_PROGRAMS, type ArmProgramSet, type ArmTracking, type PlantExtras } from '../../packages/cell-adapters/src/mock-arm';
import { quinticSegment } from '../../packages/cell-adapters/src/arm-motion';
import type { CellCommand, CellReport } from '../../packages/cell-adapters/src/contract';
import { forwardKinematics, PUMA560_SI, XARM6_SI } from '../../packages/lab-runtime/src/v2/models/arm-kinematics';
import { loadOracleProfile } from '../../packages/lab-runtime/src/v2/algorithm/checker';
import { qrotate } from '../../packages/lab-runtime/src/v2/frames';

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

interface Script { noCup?: boolean; contactLost?: (tick: number) => boolean; noExtras?: (tick: number) => boolean; releaseMisses?: boolean; hideHeldCup?: (tick: number) => boolean; takeRefuses?: boolean;
  /** A held cup sits at this offset in the TCP frame (it turns with the TCP) instead of keeping its pick offset in the base frame. */ heldInTcp?: (tick: number) => number[] }
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
      if (c.held && script.heldInTcp) { const f = forwardKinematics(XARM6_SI, commanded).tcp, o = qrotate(f.quaternionXyzw, script.heldInTcp(w.tick)); c.pos = t.map((v, i) => v + o[i]!); }
      else if (c.held) c.pos = t.map((v, i) => v + c.offset[i]!);
      else if (c.restingOn === null && ++c.free >= 2) c.restingOn = script.releaseMisses ? 'floor' : 'tray';
      const extras: PlantExtras = { gripper: { openingM: w.opening, heldPropIds: c.held && !script.contactLost?.(w.tick) ? ['cup-1'] : [] },
        props: script.noCup || (c.held && script.hideHeldCup?.(w.tick)) ? [] : [{ propId: 'cup-1', position: [...c.pos], restingOn: c.restingOn }] };
      return { actual: [...commanded], ...script.noExtras?.(w.tick) ? {} : { extras } };
    },
  };
}
function make(script: Script = {}, programs: ArmProgramSet = PROGRAMS) {
  const state = MockArmPlant.initial('arm', 'boot-0:arm', programs), fake = scriptedPlant(script), reports: CellReport[] = [];
  const takes: { id: string | undefined; heldNow: boolean }[] = [], puts: { id: string; restingOn: string | null | undefined }[] = [], takeTicks: number[] = [];
  let last: PlantExtras | undefined;
  const cups = { take: (id?: string) => { takes.push({ id, heldNow: !!id && !!last?.gripper?.heldPropIds.includes(id) }); takeTicks.push(fake.w.tick); return script.takeRefuses ? null : id ?? null; },
    put: (id: string) => { puts.push({ id, restingOn: last?.props?.find((p) => p.propId === id)?.restingOn }); } };
  const build = (st: typeof state) => { const p = new MockArmPlant(st, () => Date.parse('2026-11-12T00:00:00Z'), () => 'boot-2', cups, () => RX, XARM6_SI, TRACKING, programs); p.on((r) => reports.push(r)); return p; };
  const h = {
    plant: build(state), state, fake, restored: false, reports, takes, takeTicks, puts, trace: [] as string[],
    /** One tick: advance, the scripted plant, observe. Every tick's command and grip state go to `trace`, to compare a restored run with an uninterrupted one. */
    tick() { const p = h.plant; p.advance(); const out = fake.step(p.state.commandedQ ?? p.state.q, p.state.gripperCommandM ?? OPEN); last = out.extras; p.observe(out.actual, [], out.extras);
      h.trace.push(JSON.stringify([p.state.tick, p.state.commandedQ, p.state.gripperCommandM, p.state.grip ?? null, p.state.segment ?? null])); },
    /** Checkpoint: the state goes through JSON into a new plant, as a restored run would. */
    restore() { h.plant = build(JSON.parse(JSON.stringify(h.plant.state))); h.state = h.plant.state; h.restored = true; },
    drive(id: string, program: 'cup-pick' | 'cup-place', limit = 4000, restoreWhen?: (s: typeof state) => boolean) {
      expect(h.plant.execute(command(id, program)).accepted).toBe(true);
      const run = () => h.plant.state.programs.find((x) => x.commandId === id)!;
      for (let n = 0; n < limit && run().state === 'running' && !h.plant.state.stop?.latched; n++) { if (restoreWhen?.(h.plant.state)) { restoreWhen = undefined; h.restore(); } h.tick(); }
      return run();
    },
  };
  return h;
}

test('the fixture programs of xarm6-g2-v1 are accepted by MockArmPlant with XARM6_SI as they are', () => {
  const set: ArmProgramSet = FILE.programs;
  expect(Object.keys(set).sort()).toEqual(['choreography', 'modelId', 'motion', 'waypoints']);
  expect(set.motion.profile).toBe('quintic-sync-v1');
  expect(Object.values(set.choreography).flat().map((x) => x.action ?? null)).toEqual([null, 'grip', null, null, 'release', null]);
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

test.each([
  ['mid-closing', (st: ReturnType<typeof MockArmPlant.initial>) => st.grip?.phase === 'closing' && st.grip.ticks > 5 && st.holding === null],
  ['mid-quintic segment', (st: ReturnType<typeof MockArmPlant.initial>) => st.programs.at(-1)?.program === 'cup-place' && (st.segment?.k ?? 0) > 10 && st.segment!.k < 40],
  ['mid-opening', (st: ReturnType<typeof MockArmPlant.initial>) => st.grip?.phase === 'opening' && st.grip.elapsed > 3],
])('a state saved %s and restored through JSON continues tick for tick like an uninterrupted run', (_, when) => {
  const a = make(), b = make();
  for (const h of [a, b]) {
    expect(h.drive('p1', 'cup-pick', 4000, h === b ? when : undefined).state).toBe('completed');
    expect(h.drive('p2', 'cup-place', 4000, h === b ? when : undefined).state).toBe('completed');
  }
  expect(b.restored).toBe(true); expect(a.restored).toBe(false); expect(b.state).toEqual(a.state); expect(b.trace).toEqual(a.trace);
  expect(b.state.programs.map((x) => x.evidence)).toEqual(a.state.programs.map((x) => x.evidence));
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

test('a released cup that does not come to rest on the tray within releaseTimeoutTicks fails the program with RELEASE_NOT_ON_RECEIVER and latches the arm until reconciled', () => {
  const h = make({ releaseMisses: true });
  expect(h.drive('p1', 'cup-pick').state).toBe('completed');
  const place = h.drive('p2', 'cup-place');
  expect(place.state).toBe('failed');
  const last = h.reports.filter((r) => r.observation).at(-1)!;
  expect(last.observation).toMatchObject({ commandId: 'p2', result: 'failed', reasonCodes: ['RELEASE_NOT_ON_RECEIVER'] });
  expect(h.reports.some((r) => r.observation?.result === 'outcome_unknown')).toBe(false);
  expect(h.state.stop).toMatchObject({ latched: true, reconcileRequired: true, reason: 'RELEASE_NOT_ON_RECEIVER' });
  expect(h.state).toMatchObject({ holding: 'cup-1', gripper: 'open', gripperCommandM: OPEN });
  expect(h.puts).toEqual([]); expect(place.evidence.released).toBeUndefined();
  expect(h.plant.execute(command('p3', 'cup-place'))).toMatchObject({ accepted: false, reason: 'ARM_STOP_LATCHED' });
  expect(h.plant.execute(command('p4', 'cup-pick'))).toMatchObject({ accepted: false, reason: 'ARM_STOP_LATCHED' });
  for (let i = 0; i < 2 * CONTACT.dropTicks; i++) h.tick();
  expect(h.state.stop!.reason).toBe('RELEASE_NOT_ON_RECEIVER'); expect(h.state.programs.find((x) => x.commandId === 'p2')!.state).toBe('failed');
  expect(h.state.gripperCommandM).toBe(OPEN); expect(h.state.holding).toBe('cup-1'); expect(h.puts).toEqual([]);
});

test('slip and lift are null/false until the held cup has been seen: absent from props for the whole carry, then absent only for two ticks', () => {
  const ref = make();
  expect(ref.drive('p1', 'cup-pick').state).toBe('completed');
  const T = ref.takeTicks[0]!;
  const blind = make({ hideHeldCup: () => true });
  const pick = blind.drive('p1', 'cup-pick');
  expect(pick.state).toBe('completed');
  expect(pick.evidence).toMatchObject({ objectPresent: true, cupId: 'cup-1', liftPoseReached: false, maxSlipM: null });
  expect(blind.state.grip).toMatchObject({ maxSlipM: null, slipFromM: null, liftFromM: null });
  expect(blind.drive('p2', 'cup-place').evidence.maxSlipM).toBeNull();
  const late = make({ hideHeldCup: (t) => t === T || t === T + 1 });
  const p2 = late.drive('p1', 'cup-pick');
  expect(late.takeTicks).toEqual([T]);
  expect(typeof p2.evidence.maxSlipM).toBe('number'); expect(p2.evidence.liftPoseReached).toBe(true);
  expect(typeof late.drive('p2', 'cup-place').evidence.maxSlipM).toBe('number');
});

test('slip is the change of the cup position in the TCP frame: a 4 mm slip along the TCP z axis at a 22 mm offset is 4 mm, not the 0.36 mm change of the cup-TCP distance', () => {
  const ref = make();
  expect(ref.drive('p1', 'cup-pick').state).toBe('completed');
  const from = ref.fake.w.tick + 20, off = [0.022, 0, 0], slipped = [0.022, 0, 0.004];
  const h = make({ heldInTcp: (t) => (t < from ? off : slipped) });
  const pick = h.drive('p1', 'cup-pick');
  expect(pick.state).toBe('completed'); expect(pick.evidence.maxSlipM as number).toBeLessThan(1e-12); // the cup turns with the TCP through the lift: no slip
  const place = h.drive('p2', 'cup-place');
  expect(place.state).toBe('completed');
  expect(place.evidence.maxSlipM as number).toBeCloseTo(0.004, 9);
  expect(Math.abs(Math.hypot(...slipped) - Math.hypot(...off))).toBeCloseTo(0.00036, 5); // what the scalar distance metric would have reported
  expect(h.state.programs[1]!.evidence.maxSlipM).toBe(place.evidence.maxSlipM);
});

test('the transfer evidence names the plant that produced the contact grip; the state machine alone and the event grip stay mock_arm', () => {
  const h = make();
  expect(h.drive('p1', 'cup-pick').evidence).toMatchObject({ source: 'mock_arm', grip: 'contact' }); // no plant attached: the scripted plant is no provider
  const m = make(); m.state.plantId = 'mujoco_arm';
  expect(m.drive('p1', 'cup-pick').evidence).toMatchObject({ source: 'mujoco_arm', grip: 'contact', forceModel: 'none' });
  expect(m.drive('p2', 'cup-place').evidence).toMatchObject({ source: 'mujoco_arm', released: true });
  const puma = new MockArmPlant({ ...MockArmPlant.initial('arm'), plantId: 'webots_arm' }, () => 0, () => 'b', { take: () => 'cup-1', put: () => {} }, () => RX, PUMA560_SI, TRACKING, PUMA_PROGRAMS);
  puma.execute(command('w1', 'cup-pick'));
  expect(puma.reconcile('w1').evidence).toEqual({ source: 'mock_arm', grip: 'commanded_mock', forceModel: 'none' }); // the Webots arm's grip is the state machine's event
});

test('the pads hold a cup the cup world will not hand over: CUP_CUSTODY_MISMATCH, never a completed pick', () => {
  const h = make({ takeRefuses: true });
  const pick = h.drive('p1', 'cup-pick');
  expect(pick.state).toBe('unknown');
  expect(h.state.stop).toMatchObject({ latched: true, reconcileRequired: true, reason: 'CUP_CUSTODY_MISMATCH' });
  expect(h.takes).toEqual([{ id: 'cup-1', heldNow: true }]);
  expect(h.state).toMatchObject({ holding: null, gripper: 'closed', gripperCommandM: CONTACT.closedM });
  expect(h.reports.at(-1)!.observation).toMatchObject({ result: 'outcome_unknown', reasonCodes: ['CUP_CUSTODY_MISMATCH'] });
});

const cups0 = { take: () => null, put: () => {} };
const build = (set: ArmProgramSet, tracking: ArmTracking | undefined = TRACKING) => () => new MockArmPlant(MockArmPlant.initial('arm', 'b'), () => 0, () => 'b', cups0, () => null, set.modelId === PUMA560_SI.id ? PUMA560_SI : XARM6_SI, tracking, set);
test.each<[string, (s: ArmProgramSet) => ArmProgramSet]>([
  ['a waypoint with one value too few', (s) => ({ ...s, waypoints: { ...s.waypoints, lift: s.waypoints.lift!.slice(1) } })],
  ['a waypoint with a NaN', (s) => ({ ...s, waypoints: { ...s.waypoints, lift: s.waypoints.lift!.map((v, i) => (i === 2 ? NaN : v)) } })],
  ['a step naming a missing waypoint', (s) => ({ ...s, choreography: { ...s.choreography, 'cup-pick': [{ waypoint: 'nowhere' }] } })],
  ['no home', (s) => ({ ...s, waypoints: Object.fromEntries(Object.entries(s.waypoints).filter(([k]) => k !== 'home')) })],
  ['an unknown action', (s) => ({ ...s, choreography: { ...s.choreography, 'cup-pick': [{ waypoint: 'pick', action: 'squeeze' as 'grip' }] } })],
  ['a waypoint outside the joint limits', (s) => ({ ...s, waypoints: { ...s.waypoints, lift: s.waypoints.lift!.map((v, i) => (i === 1 ? 2.5 : v)) } })],
  ['five accelerations', (s) => ({ ...s, motion: { profile: 'quintic-sync-v1', maxAccelerationRadS2: [6, 6, 6, 8, 8], speedFraction: 0.5 } })],
  ['a zero acceleration', (s) => ({ ...s, motion: { profile: 'quintic-sync-v1', maxAccelerationRadS2: [6, 0, 6, 8, 8, 8], speedFraction: 0.5 } })],
  ['speedFraction 0', (s) => ({ ...s, motion: { profile: 'quintic-sync-v1', maxAccelerationRadS2: [6, 6, 6, 8, 8, 8], speedFraction: 0 } })],
  ['speedFraction above 1', (s) => ({ ...s, motion: { profile: 'quintic-sync-v1', maxAccelerationRadS2: [6, 6, 6, 8, 8, 8], speedFraction: 1.5 } })],
  ['gripSettleTicks 0', (s) => ({ ...s, contact: { ...CONTACT, gripSettleTicks: 0 } })],
  ['dropTicks 2.5', (s) => ({ ...s, contact: { ...CONTACT, dropTicks: 2.5 } })],
  ['releaseTimeoutTicks NaN', (s) => ({ ...s, contact: { ...CONTACT, releaseTimeoutTicks: NaN } })],
  ['openM not above closedM', (s) => ({ ...s, contact: { ...CONTACT, openM: 0, closedM: 0 } })],
  ['closedM below 0', (s) => ({ ...s, contact: { ...CONTACT, closedM: -0.01 } })],
  ['liftMinM NaN', (s) => ({ ...s, contact: { ...CONTACT, liftMinM: NaN } })],
])('a program set with %s is refused with ARM_PROGRAM_INVALID before anything runs', (_, bad) => {
  expect(build(PROGRAMS)).not.toThrow();
  expect(build(bad(PROGRAMS))).toThrow('ARM_PROGRAM_INVALID');
});

test('a quintic set on a model with a zero velocity limit is refused, initial() without home is a named error, and PUMA_PROGRAMS is valid on the PUMA model', () => {
  const slow = { ...XARM6_SI, limits: XARM6_SI.limits.map((l, i) => (i === 3 ? { ...l, maxVelocity: 0 } : l)) };
  expect(() => new MockArmPlant(MockArmPlant.initial('arm', 'b'), () => 0, () => 'b', cups0, () => null, slow, TRACKING, PROGRAMS)).toThrow('ARM_PROGRAM_INVALID');
  const waypoints = Object.fromEntries(Object.entries(PROGRAMS.waypoints).filter(([k]) => k !== 'home'));
  expect(() => MockArmPlant.initial('arm', 'b', { ...PROGRAMS, waypoints })).toThrow('ARM_PROGRAM_INVALID');
  expect(() => new MockArmPlant(MockArmPlant.initial('arm'), () => 0, () => 'b', cups0, () => null)).not.toThrow();
  expect(build(PUMA_PROGRAMS, undefined)).not.toThrow();
});

test("fault('arm-stop') and halt() while holding never change the gripper command", () => {
  const h = make();
  expect(h.drive('p1', 'cup-pick').state).toBe('completed');
  expect(h.state.gripperCommandM).toBe(CONTACT.closedM);
  expect(h.plant.execute(command('p2', 'cup-place')).accepted).toBe(true);
  for (let i = 0; i < 30; i++) h.tick();
  h.plant.fault('arm-stop');
  expect(h.state.stop?.reason).toBe('MODEL_STOP'); expect(h.state.gripperCommandM).toBe(CONTACT.closedM); expect(h.state.holding).toBe('cup-1');
  for (let i = 0; i < 30; i++) h.tick();
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
  for (let k = 1; k <= seg.ticks; k++) { h.tick(); commanded.push([...h.state.commandedQ!]); }
  expect(commanded.at(-1)).toEqual(goal);
  commanded.forEach((c, k) => expect(c).toEqual(seg.at(k + 1)));
  const before = commanded.at(-2)!;
  goal.forEach((v, i) => { if (Math.abs(v - home[i]!) > 1e-6) expect(before[i], `joint ${i}`).not.toBe(v); });
});
