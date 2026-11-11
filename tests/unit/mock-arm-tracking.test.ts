// X05 (R1.1 D20, D22, D28): MockArmPlant in `tracking` mode. advance() only generates the commanded joints; observe(actualQ, collisionIds) applies what a plant (Webots) did. The program
// state machine, grip/release and evidence are the mock's own. Without `tracking` nothing changes (tests/unit/bv01-mock-golden.test.ts pins that).
import { expect, test } from 'vitest';
import { MockArmPlant, type ArmTracking } from '../../packages/cell-adapters/src/mock-arm';
import type { CellCommand, CellReport } from '../../packages/cell-adapters/src/contract';
import { PUMA560_SI } from '../../packages/lab-runtime/src/v2/models/arm-kinematics';

const TRACKING: ArmTracking = { reachTolRad: 0.01, settleTicks: 10, followTolRad: 0.05, followTicks: 10 };
const command = (id: string, program: 'cup-pick' | 'cup-place'): CellCommand => ({ runId: 'r', commandId: id, deviceId: 'arm', controlEpoch: 1, expiresAt: '2026-11-06T00:00:00Z', recipeRevision: 1,
  programRef: { id: program, hash: 'a'.repeat(64) }, payloadHash: 'a'.repeat(64), capability: 'start_job', payload: { jobId: 'j' } });
const RX = { robotId: 'amr-1', slot: 1 };

function make(tracking?: ArmTracking, setup?: (s: ReturnType<typeof MockArmPlant.initial>) => void) {
  const state = MockArmPlant.initial('arm'), puts: string[] = [], reports: CellReport[] = [];
  setup?.(state);
  const plant = new MockArmPlant(state, () => Date.parse('2026-11-05T00:00:00Z'), () => 'boot-2', { take: () => 'cup-1', put: (c) => { puts.push(c); } }, () => RX, PUMA560_SI, tracking);
  plant.on((r) => reports.push(r));
  return { plant, state, puts, reports };
}
type Plant = (commanded: number[], tick: number, previous: number[]) => { actual: number[]; collisionIds?: string[] };
/** Runs one program: advance (commanded joints), the pure plant function (actual joints), observe. Returns the ticks used. */
function drive(plant: MockArmPlant, program: 'cup-pick' | 'cup-place', id: string, fn: Plant, limit = 3000) {
  expect(plant.execute(command(id, program)).accepted).toBe(true);
  let previous = [...plant.state.q], n = 0;
  while (n < limit && plant.state.programs.find((p) => p.commandId === id)!.state === 'running' && !plant.state.stop?.latched) {
    n++; plant.advance();
    const cmd = plant.state.commandedQ ?? plant.state.q, got = fn(cmd, n, previous);
    plant.observe(got.actual, got.collisionIds ?? []);
    previous = [...got.actual];
  }
  return n;
}
const ideal: Plant = (c) => ({ actual: [...c] });
const state = (p: MockArmPlant, id: string) => p.state.programs.find((x) => x.commandId === id)!.state;

test('an ideal plant completes cup-pick then cup-place, with the same evidence as the default mode', () => {
  const a = make(TRACKING), b = make();
  expect(drive(a.plant, 'cup-pick', 'p1', ideal)).toBeGreaterThan(0); expect(state(a.plant, 'p1')).toBe('completed');
  expect(drive(a.plant, 'cup-place', 'p2', ideal)).toBeGreaterThan(0); expect(state(a.plant, 'p2')).toBe('completed');
  for (const [id, prog] of [['p1', 'cup-pick'], ['p2', 'cup-place']] as const) { expect(b.plant.execute(command(id, prog)).accepted).toBe(true); for (let i = 0; i < 4000 && state(b.plant, id) === 'running'; i++) b.plant.advance(); }
  expect(a.plant.reconcile('p1')).toEqual(b.plant.reconcile('p1'));
  expect(a.plant.reconcile('p2')).toEqual(b.plant.reconcile('p2'));
  expect(a.puts).toEqual(['cup-1']); expect(a.state.holding).toBeNull(); expect(a.state.gripper).toBe('open');
  expect(a.state.limitsOk).toBe(true); expect(a.state.collision!.evidence!.intervals.length).toBeGreaterThan(0);
  expect(a.state.collision!.last?.ok).toBe(true);
});

test('a plant that lags a tick and sits half a reach tolerance off still completes', () => {
  const { plant } = make(TRACKING);
  let last = [...plant.state.q];
  const lag: Plant = (c) => { const out = last.map((p, i) => (i === 0 ? c[0]! + 0.5 * TRACKING.reachTolRad : p)); last = [...c]; return { actual: out }; }; // J1 off by 0.005, the others a tick late
  drive(plant, 'cup-pick', 'p1', lag);
  expect(state(plant, 'p1')).toBe('completed'); expect(plant.state.stop).toBeUndefined();
});

test('a plant that does not move is a following error after exactly followTicks ticks of deviation, and the cup is not released', () => {
  const { plant, state: s, reports } = make(TRACKING, (st) => { st.holding = 'cup-1'; st.gripper = 'closed'; });
  const home = [...s.q];
  let firstOver = -1;
  drive(plant, 'cup-place', 'p1', (c, t) => { if (firstOver < 0 && Math.max(...c.map((v, i) => Math.abs(v - home[i]!))) > TRACKING.followTolRad) firstOver = t; return { actual: [...home] }; });
  expect(firstOver).toBeGreaterThan(0);
  expect(s.stop).toMatchObject({ latched: true, reconcileRequired: true, reason: 'ARM_FOLLOWING_ERROR' });
  expect(s.tick).toBe(firstOver + TRACKING.followTicks - 1);
  expect(state(plant, 'p1')).toBe('unknown'); expect(s.holding).toBe('cup-1'); expect(s.gripper).toBe('closed');
  expect(reports.at(-1)!.observation).toMatchObject({ result: 'outcome_unknown', reasonCodes: ['ARM_FOLLOWING_ERROR'] });
  expect(reports.at(-1)!.evidence).toMatchObject({ stopReason: 'ARM_FOLLOWING_ERROR', actualJointsRad: home });
});

test('a deviation that comes back inside the tolerance restarts the count (a spike every 25 ticks leaves more than settleTicks clean ticks between)', () => {
  const { plant } = make(TRACKING);
  let tick = 0;
  drive(plant, 'cup-pick', 'p1', (c) => { tick++; const bad = tick % 25 === 0; return { actual: c.map((v, i) => (i === 0 && bad ? v + 0.2 : v)) }; });
  expect(plant.state.stop).toBeUndefined(); expect(state(plant, 'p1')).toBe('completed');
});

test('a collision reported while the cup is held stops the arm at once and keeps the cup in the gripper', () => {
  const { plant, state: s } = make(TRACKING);
  drive(plant, 'cup-pick', 'p1', ideal);
  expect(s.holding).toBe('cup-1');
  let ticks = 0;
  const t0 = s.tick;
  drive(plant, 'cup-place', 'p2', (c) => ({ actual: [...c], collisionIds: ++ticks === 5 ? ['STATIC_1'] : [] }));
  expect(s.stop).toMatchObject({ latched: true, reason: 'ARM_COLLISION' });
  expect(s.holding).toBe('cup-1'); expect(s.gripper).toBe('closed'); expect(state(plant, 'p2')).toBe('unknown');
  expect(s.tick).toBe(t0 + 5); // on the tick it was reported, not at a timeout
});

test('a non-finite actual position stops the arm and never enters the collision evidence', () => {
  const { plant, state: s } = make(TRACKING);
  let n = 0;
  drive(plant, 'cup-pick', 'p1', (c) => ({ actual: ++n === 3 ? [NaN, ...c.slice(1)] : [...c] }));
  expect(s.stop).toMatchObject({ latched: true, reason: 'PLANT_UNSTABLE' });
  expect(s.q.every(Number.isFinite)).toBe(true);
  const intervals = s.collision!.evidence!.intervals;
  expect(intervals.every((i) => i.toQ.every(Number.isFinite) && i.fromQ.every(Number.isFinite))).toBe(true);
  expect(s.trace.every((t) => t.q.every(Number.isFinite))).toBe(true);
});

test('ARM03 geometry runs on the actual joints: an obstacle on the real path stops the arm even when the commanded path is clear', () => {
  const { plant, state: s } = make(TRACKING);
  const home = [...s.q];
  plant.setCollisionWorld([{ id: 'pin', kind: 'sphere', center: plant.tcp([0.2, ...home.slice(1)]), radiusM: 0.01 }]); // clear at home, and the commanded J1 is still at 0.013 on tick 3
  const wander: Plant = (c, t) => ({ actual: t > 2 ? [0.2, ...c.slice(1)] : [...c] });
  drive(plant, 'cup-pick', 'p1', wander);
  expect(s.stop).toMatchObject({ latched: true, reason: 'ARM_COLLISION' });
  expect(s.collision!.evidence!.firstFailure!.result.pair).toContain('pin');
});

test('the actual joints, not the commanded ones, are the arm state; the trace and stats are of the actual', () => {
  const { plant, state: s } = make(TRACKING);
  drive(plant, 'cup-pick', 'p1', (c) => ({ actual: c.map((v) => v - 0.002) }));
  expect(s.q).not.toEqual(s.commandedQ);
  expect(s.trace.length).toBeGreaterThan(5);
  const t = s.tracking!;
  expect(t.samples).toBeGreaterThan(0); expect(t.peakRad).toHaveLength(6); expect(Math.max(...t.peakRad)).toBeCloseTo(0.002, 6);
  expect(t.sumSq.every((v) => v >= 0)).toBe(true);
});

test('observe is refused in the default mode, and the default mode keeps assigning q = commanded', () => {
  const { plant, state: s } = make();
  expect(() => plant.observe([...s.q], [])).toThrow(/tracking/);
  plant.execute(command('p1', 'cup-pick'));
  plant.advance();
  expect(s.q).toEqual(s.commandedQ);
  expect(s.tracking).toBeUndefined();
});

test('a tracked arm that sits still but jitters stays inside the evidence budget; motion and collisions are never absorbed', () => {
  const { plant, state: s } = make(TRACKING);
  const home = [...s.q];
  plant.setCollisionScene({ available: true, scope: 'self_injected_only', revision: 'scene-1', profileRevision: 1, tick: 0, world: [], robotPoses: [] });
  for (let i = 0; i < 6000; i++) { plant.advance(); plant.observe(home.map((v, k) => v + (k === 0 ? 3e-5 * Math.sin(i) : 0)), []); }
  const ev = s.collision!.evidence!;
  expect(ev.droppedIntervals).toBe(0); expect(ev.intervals.length).toBeLessThan(5); expect(s.stop).toBeUndefined();
  // a real move of 1 mrad starts a new interval; a stop on the engine's collision report is not hidden by an earlier rest
  plant.advance(); plant.observe(home.map((v, k) => v + (k === 0 ? 1e-3 : 0)), []);
  expect(ev.intervals.length).toBeGreaterThanOrEqual(2);
  plant.advance(); plant.observe(home, ['STATIC_1']);
  expect(s.stop).toMatchObject({ reason: 'ARM_COLLISION' });
});

test('the default mode keeps merging only exactly repeated checks', () => {
  const { plant, state: s } = make();
  plant.setCollisionScene({ available: true, scope: 'self_injected_only', revision: 'scene-1', profileRevision: 1, tick: 0, world: [], robotPoses: [] });
  for (let i = 0; i < 50; i++) plant.advance();
  expect(s.collision!.evidence!.intervals).toHaveLength(1);
});
