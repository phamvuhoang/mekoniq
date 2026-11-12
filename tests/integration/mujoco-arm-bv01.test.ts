// M07 / MA05, MA07, MA08 (R2a) on the real MuJoCo 3.17.0: MJ-BV01 through the flag-on gateway factory on the fixture's xArm coffee cell, twice with one seed. The thresholds are the oracle
// profile's mujocoArm block. Skipped, with the reason, where .venv-mujoco is missing (not_run, never a pass).
import { afterEach, describe, expect, test } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadOracleProfile } from '../../packages/lab-runtime/src/v2/algorithm/checker';
import { ALLOWED_CONTACTS_STATIC_NOTE, readArmProps, readArmTrace } from '../../packages/lab-runtime/src/v2/beverage/arm-plant-report';
import { MOCK_ARM_PARAMS } from '../../packages/cell-adapters/src/mock-arm';
import { hashJson } from '../../packages/lab-runtime/src/v2/hash';
import { XARM6_SI } from '../../packages/lab-runtime/src/v2/models/arm-kinematics';
import { readXArmFixture } from '../../packages/lab-runtime/src/v2/simulation3d/arm-cell-scene';
import { MUJOCO_ARM_RELEASE_TIMEOUT_TICKS, mujocoArmProgram } from '../../packages/lab-runtime/src/v2/simulation3d/mujoco-arm-ports';
import { stepUntil } from '../support/lab-v2';
import { mujocoGateway, mujocoReady, mujocoRoot, mujocoWorkers, openMujocoRun, removeMujocoDirs } from '../support/mujoco-arm';

afterEach(removeMujocoDirs);
async function execute(gw: Awaited<ReturnType<typeof mujocoGateway>>, seed: number) {
  const t0 = Date.now(), { run, directory } = await openMujocoRun(gw, { seed });
  try {
    await run.start();
    const view = await stepUntil(run, undefined, 100, 60_000);
    const report = await run.report();
    return { view, report, directory, trace: await readArmTrace(directory, report.arm!), props: await readArmProps(directory, report.arm!), wallMs: Date.now() - t0 };
  } finally { await run.close(); }
}
const maxDiff = (a: number[][], b: number[][]) => { expect(a.map((r) => r.length)).toEqual(b.map((r) => r.length)); return Math.max(0, ...a.flatMap((row, i) => row.map((v, k) => Math.abs(v - b[i]![k]!)))); };
type Run = Awaited<ReturnType<typeof execute>>;
/** Per cup: the height it was lifted while held (from the cup trace) and the slip of its pick and place (the programs' contact evidence). */
function transfers(r: Run) {
  return r.report.coffee!.cups.map((c) => {
    const held = r.props.samples.filter((s) => s.props.some((p) => p.propId === c.cupId && p.held)).map((s) => s.props.find((p) => p.propId === c.cupId)!.positionM[2]);
    // the arm's own evidence: the pick's is the movement's, the place's is its giver half (the receiver half is the AMR's)
    const ev = c.movements.filter((m) => m.from.kind === 'arm' || m.to.kind === 'arm').map((m) => { const e = ((m.evidence?.giver ?? m.evidence) ?? {}) as Record<string, unknown>;
      return { to: m.to.kind, grip: e.grip, maxSlipM: e.maxSlipM, liftPoseReached: e.liftPoseReached, released: e.released }; });
    return { cupId: c.cupId, liftM: held.length ? Math.max(...held) - held[0]! : null, transfers: ev };
  });
}

describe.skipIf(!mujocoReady)('MJ-BV01 on the MuJoCo arm', () => {
  test('completes with both cups at the table, contact grip on every transfer, ARM03 pass on the actual joints and honest labels; a second run of the same seed repeats within repeatJointRad', async () => {
    const gw = await mujocoGateway(), profile = loadOracleProfile().profile.mujocoArm!, fixture = readXArmFixture(mujocoRoot);
    const runs = [await execute(gw, 42), await execute(gw, 42)];
    for (const r of runs) {
      const { view, report, trace, props } = r;
      // MA05 (SX-39): the business outcome, the same as the mock's
      expect(view.run.status).toBe('completed');
      expect(report.outcome).toMatchObject({ status: 'completed', served: '2' }); expect(report.attention).toEqual([]);
      expect(report.coffee!.cups.map((c) => [c.ownerKind, c.ownerId])).toEqual([['customer', 'table-1'], ['customer', 'table-1']]);
      expect(report.coffee!.armTrace.stop).toBeNull(); expect(report.coffee!.armTrace.limitsOk).toBe(true); expect(report.coffee!.armTrace.modelRevision).toBe(XARM6_SI.revision);
      // every transfer of a cup into and out of the gripper carries contact evidence: picked by contact, lifted, released onto the tray
      for (const t of transfers(r)) {
        expect(t.transfers.map((e) => e.to), t.cupId).toEqual(['arm', 'robot']);
        for (const e of t.transfers) expect(e.grip, `${t.cupId} -> ${e.to}`).toBe('contact');
        expect(t.transfers.some((e) => e.liftPoseReached === true)).toBe(true); expect(t.transfers.some((e) => e.released === true)).toBe(true);
        for (const e of t.transfers) { expect(typeof e.maxSlipM).toBe('number'); expect(e.maxSlipM as number).toBeLessThanOrEqual(profile.slipTolM); }
        expect(t.liftM!).toBeGreaterThanOrEqual(profile.liftMinM);
      }
      // what the run says it is
      expect(report.manifest).toMatchObject({ mode: 'simulation', access: 'simulated', backendSetId: 'engineering-mujoco-arm-v1', scenario: { id: 'MJ-BV01', revision: 1 }, calibration: { status: 'not_calibrated' } });
      expect(report.manifest.backends.map((b) => b.id).sort()).toEqual(['mock_amr', 'mock_coffee', 'mujoco_arm']);
      expect(report.manifest.backends.find((b) => b.id === 'mujoco_arm')).toMatchObject({ version: '3.17.0', dynamics: true });
      expect(report.manifest.models.some((m) => m.id === XARM6_SI.id && m.revision === XARM6_SI.revision)).toBe(true);
      expect(report.limitations.some((l) => l.startsWith('mujoco_arm:') && l.includes('not_calibrated'))).toBe(true);
      expect(report.limitations.some((l) => l.startsWith('webots_arm:'))).toBe(false);
      // the manifest names the program the arm ran: the fixture's program set (quintic-sync-v1, its choreography and contact block, the xArm capsule geometry) and its digests,
      // never the mock arm's motion constants or linear interpolation
      const prog = report.manifest.armProgram!, ref = mujocoArmProgram({ workerRoot: mujocoRoot });
      expect(prog).toEqual(ref); expect(prog.fixture).toEqual({ id: fixture.id, revision: fixture.revision }); expect(prog.waypointsDigest).toBe(fixture.waypoints.digest);
      expect(prog.programsDigest).toBe(hashJson(prog.programs as never)); expect(prog.programs.waypoints).toEqual(fixture.programs.waypoints); expect(prog.programs.choreography).toEqual(fixture.programs.choreography);
      expect(prog.programs.motion).toEqual({ profile: 'quintic-sync-v1', maxAccelerationRadS2: fixture.physics.maxAccelerationRadS2, speedFraction: fixture.physics.speedFraction });
      expect(prog.programs.collision!.geometry).toMatchObject({ provenance: 'assumed', linkRadiiM: fixture.physics.capsuleRadiusM, cupRadiusM: fixture.layout.cup.radiusM, cupHeightM: fixture.layout.cup.heightM });
      expect(JSON.stringify(report.manifest)).not.toContain(JSON.stringify(MOCK_ARM_PARAMS).slice(1, -1));
      expect(report.limitations.join('\n')).not.toContain('linear joint interpolation'); expect(report.limitations.some((l) => l.startsWith('mujoco_arm program:') && l.includes('quintic-sync-v1'))).toBe(true);
      expect(report.coffee!.armTrace).toMatchObject({ tag: 'mujoco_position_actuator_tracked', interpolation: 'quintic-sync-v1' });
      // MA08 (SX-41): the arm block. ARM03 on the actual joints with the xArm model, the plant labels (D49), per-joint tracking, the joint and cup trace files, the waypoint table, the allowed contacts
      const arm = report.arm!;
      expect(arm.armPlant).toMatchObject({ engine: 'mujoco_3d', engineVersion: '3.17.0', control: 'position_actuator', grip: 'contact', dynamics: 'manufacturer_nominal+assumed', calibration: 'not_calibrated' });
      expect(arm.collision).toMatchObject({ id: 'ARM03', result: 'pass', engine: 'capsule-sweep-v1', reasonCodes: [], colliding: [], modelRevision: XARM6_SI.revision });
      expect(report.coverage).toMatchObject({ armSceneCollision: true, armCollisionTraceComplete: true }); // the project's scene, with the docked robot (its asset resolved), was swept every tick
      expect(arm.collision.coverage!.intervals).toBeGreaterThan(100); expect(arm.collision.coverage!.allowedContactsApplied).toBeGreaterThan(0); expect(arm.collision.trace!.samples).toBe(arm.trace.samples);
      expect(arm.collision.attachments.map((a) => a.cupId)).toEqual(report.coffee!.cups.map((c) => c.cupId)); // each cup held through its place
      // the allowed pairs apply over the whole trace and carry the run's world revision
      expect(arm.collision.allowedContacts.map((c) => c.pair)).toEqual([['gripper', 'nozzle-stand'], ['gripper', 'tray'], ['held-cup', 'nozzle-stand'], ['held-cup', 'tray']]);
      for (const c of arm.collision.allowedContacts) expect(c).toMatchObject({ fromTick: arm.collision.trace!.fromTick, toTick: arm.collision.trace!.toTick, revision: report.manifest.world.revision });
      expect(arm.collision.allowedContactsNote).toBe(ALLOWED_CONTACTS_STATIC_NOTE); expect(arm.collision.allowedContactsNote).toContain('whole trace');
      expect(arm.allowedContacts).toEqual([{ a: 'gripper', b: 'nozzle-stand' }, { a: 'gripper', b: 'tray' }, { a: 'held_prop', b: 'nozzle-stand' }, { a: 'held_prop', b: 'tray' }]);
      expect(arm.waypoints).toEqual(fixture.waypoints); expect(arm.waypoints!.table.map((w) => w.waypoint)).toEqual(['home', 'pickApproach', 'pick', 'lift', 'placeApproach', 'place']);
      expect(arm.releaseTimeoutTicks).toBe(MUJOCO_ARM_RELEASE_TIMEOUT_TICKS);
      const notes = arm.notes!.join('\n');
      for (const s of ['not_calibrated', 'MuJoCo 3.17.0', `${MUJOCO_ARM_RELEASE_TIMEOUT_TICKS} ticks`, 'assumed', 'every physics substep', 'end of the tick', 'static for the whole trace']) expect(notes).toContain(s);
      expect(arm.tracking.samples).toBe(arm.trace.samples); expect(arm.tracking.peakRad).toHaveLength(6);
      arm.tracking.peakRad.forEach((p, i) => { expect(p, `J${i + 1}`).toBeLessThanOrEqual(profile.followTolRad); expect(arm.tracking.rmsRad[i]!).toBeLessThanOrEqual(p); });
      // the files are the evidence: read back through their sha256, one sample per tick of a running program, the cup trace at the same ticks, in the map frame
      expect(trace.note).toContain('MuJoCo'); expect(trace.note).not.toContain('Webots');
      expect(trace.samples).toHaveLength(arm.trace.samples); expect(trace.samples[0]!.tick).toBeGreaterThan(0);
      expect(trace.samples.every((s) => s.actualRad.length === 6 && s.commandedRad.length === 6 && [...s.actualRad, ...s.commandedRad].every(Number.isFinite))).toBe(true);
      expect(arm.props!.samples).toBe(arm.trace.samples); expect(props.frame).toBe('map'); expect(props.samples.map((s) => s.tick)).toEqual(trace.samples.map((s) => s.tick));
      expect(props.samples.every((s) => s.props.every((p) => p.positionM.length === 3 && p.quaternionXyzw.length === 4 && [...p.positionM, ...p.quaternionXyzw].every(Number.isFinite)))).toBe(true);
      expect(existsSync(join(r.directory, arm.trace.path)) && existsSync(join(r.directory, arm.props!.path))).toBe(true);
    }
    // MA07 (D50): the same seed on a fresh worker. The outcome and the ticks are the same; the joints, commanded and actual, agree within repeatJointRad at every sample
    const [a, b] = runs;
    expect(b!.report.outcome.tick).toBe(a!.report.outcome.tick); expect(b!.report.outcome.status).toBe(a!.report.outcome.status);
    expect(b!.trace.samples.map((s) => s.tick)).toEqual(a!.trace.samples.map((s) => s.tick));
    const actual = maxDiff(a!.trace.samples.map((s) => s.actualRad), b!.trace.samples.map((s) => s.actualRad)), commanded = maxDiff(a!.trace.samples.map((s) => s.commandedRad), b!.trace.samples.map((s) => s.commandedRad));
    const cups = maxDiff(a!.props.samples.map((s) => s.props.flatMap((p) => p.positionM)), b!.props.samples.map((s) => s.props.flatMap((p) => p.positionM)));
    console.log('MJ-BV01', JSON.stringify({ finalTicks: runs.map((r) => r.report.outcome.tick), wallMs: runs.map((r) => r.wallMs), maxActualDiffRad: actual, maxCommandedDiffRad: commanded, maxCupDiffM: cups, repeatJointRad: profile.repeatJointRad,
      peakRad: runs.map((r) => r.report.arm!.tracking.peakRad), rmsRad: runs.map((r) => r.report.arm!.tracking.rmsRad), transfers: runs.map(transfers), coverage: runs.map((r) => r.report.arm!.collision.coverage), samples: runs.map((r) => r.report.arm!.trace.samples) }));
    expect(actual).toBeLessThanOrEqual(profile.repeatJointRad); expect(commanded).toBeLessThanOrEqual(profile.repeatJointRad);
    await new Promise((r) => setTimeout(r, 500));
    expect(mujocoWorkers()).toEqual([]);
  }, 900_000);

  test('the trace files are the evidence: a changed hash is caught for the joints and for the cups', async () => {
    const gw = await mujocoGateway();
    const { report, directory } = await execute(gw, 7);
    await expect(readArmTrace(directory, { ...report.arm!, trace: { ...report.arm!.trace, sha256: '0'.repeat(64) } })).rejects.toThrow('ARM_TRACE_CORRUPT');
    await expect(readArmProps(directory, { ...report.arm!, props: { ...report.arm!.props!, sha256: '0'.repeat(64) } })).rejects.toThrow('ARM_PROPS_CORRUPT');
  }, 600_000);
});
