// M07 / MA06 (R2a, SX-40) on the real MuJoCo 3.17.0: what goes wrong while an MJ-BV01 arm program runs. Every fault is a runtime option set here in code (never a request field), stops the
// program with its code, ends the run in an explicit failure (never completed), never commands the gripper open, leaves no worker process and releases the MuJoCo slot. Skipped, with the
// reason, where .venv-mujoco is missing. The admission and flag-off cases need no engine and run everywhere.
import { afterEach, describe, expect, test } from 'vitest';
import { join, resolve } from 'node:path';
import { createScenarioRun, type RunView, type ScenarioRun } from '../../packages/lab-runtime/src/v2/scenario-runner';
import { readCheckpoint } from '../../packages/lab-runtime/src/v2/checkpoint';
import { loadOracleProfile } from '../../packages/lab-runtime/src/v2/algorithm/checker';
import { readArmProps, readArmTrace } from '../../packages/lab-runtime/src/v2/beverage/arm-plant-report';
import { forwardKinematics, XARM6_SI } from '../../packages/lab-runtime/src/v2/models/arm-kinematics';
import { readXArmFixture } from '../../packages/lab-runtime/src/v2/simulation3d/arm-cell-scene';
import { mujocoFromOptions, MUJOCO_SLOT } from '../../packages/lab-runtime/src/v2/simulation3d/mujoco';
import { irsimCapacity } from '../../packages/lab-runtime/src/v2/navigation2d/runner';
import { portableSimulationFromOptions } from '../../packages/lab-runtime/src/v2/navigation2d/readiness';
import { startLabGateway, type LabGateway } from '../../packages/lab-runtime/src/gateway';
import type { CoffeeState } from '../../packages/lab-runtime/src/v2/scenarios/coffee';
import { amrAsset, coffeeProject, act, stepUntil } from '../support/lab-v2';
import { killMujocoWorkers, mujocoGateway, mujocoInput, mujocoReady, mujocoRoot, mujocoTemp, mujocoWorkers, openMujocoRun, removeMujocoDirs, weakJointRoot, xarmAmrAsset, xarmProject } from '../support/mujoco-arm';

const gateways: LabGateway[] = [];
afterEach(async () => { for (const g of gateways.splice(0)) await g.close(); await removeMujocoDirs(); });
const fixture = readXArmFixture(mujocoRoot), W = fixture.programs.waypoints, physics = fixture.physics;
const heldByArm = (v: RunView) => v.coffee?.cups.some((c) => c.ownerKind === 'arm') ?? false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const toEnd = (run: ScenarioRun) => stepUntil(run, undefined, 25, 60_000);
/** The run, its end state, its report, the arm state of the checkpoint and the trace files; then the run is closed, and no worker may be left and the MuJoCo slot must be free. */
async function outcome(run: ScenarioRun, directory: string, drive: (run: ScenarioRun) => Promise<RunView>) {
  try {
    const view = await drive(run), report = await run.report(), arm = (await readCheckpoint<{ coffee: CoffeeState }>(directory))!.coffee.arm;
    const trace = report.arm ? await readArmTrace(directory, report.arm) : null, props = report.arm?.props ? await readArmProps(directory, report.arm) : null;
    return { view, report, arm, trace, props, stop: report.coffee!.armTrace.stop, cups: report.coffee!.cups.map((c) => `${c.ownerKind}:${c.ownerId}`), reasons: report.attention.map((a) => a.reason) };
  } finally {
    await run.close(); await sleep(500);
    expect(mujocoWorkers()).toEqual([]);
    expect(irsimCapacity(1, 'another-run', MUJOCO_SLOT)).toBe(true); // a following run can start
  }
}
/** After the grip, the gripper command in the trace never goes back to the open value, and the arm still commands closed at the end. */
const neverOpened = (r: Awaited<ReturnType<typeof outcome>>) => {
  const g = r.trace!.samples.map((s) => s.gripperCommandM), first = g.indexOf(0);
  expect(first).toBeGreaterThanOrEqual(0); expect(g.slice(first).every((x) => x === 0)).toBe(true); expect(r.arm.gripperCommandM).toBe(0);
};
const firstStop = (r: Awaited<ReturnType<typeof outcome>>) => r.stop!.events[0]!.tick;

describe.skipIf(!mujocoReady)('MuJoCo arm faults (MA06)', () => {
  test('a box in the MuJoCo cell on the cup-place path: the engine reports the contact, the arm stops as ARM_COLLISION with the cup held, nothing opens the gripper', async () => {
    // the flange three quarters of the way (in joint space) from the lift to the place approach: the transfer swings the held cup through it, clear of the pick and the lift.
    // The TS sweep never sees this box; only the engine does.
    const at = W.lift!.map((v, i) => v + 0.75 * (W.placeApproach![i]! - v)), [x, y, z] = forwardKinematics(XARM6_SI, at).flange.position, h = 0.05;
    const gw = await mujocoGateway({ armExtraStatics: [{ id: 'crate', kind: 'box', min: [x! - h, y! - h, z! - h], max: [x! + h, y! + h, z! + h] }] }), { run, directory } = await openMujocoRun(gw);
    const r = await outcome(run, directory, async (run) => { await run.start(); return toEnd(run); });
    console.log('MA06 collision', JSON.stringify({ tick: r.view.tick, stopTick: firstStop(r), stop: r.stop?.reason, cups: r.cups, reasons: r.reasons, programs: r.arm.programs.map((p) => [p.program, p.state]) }));
    expect(r.view.run.status).toBe('needs_attention');
    expect(r.stop).toMatchObject({ latched: true, reconcileRequired: true, reason: 'ARM_COLLISION' });
    expect(r.arm.programs.map((p) => [p.program, p.state])).toEqual([['cup-pick', 'completed'], ['cup-place', 'unknown']]);
    expect(r.cups[0]).toBe('arm:arm-1'); expect(r.arm.holding).toBe('cup-1'); // picked, never released
    expect(r.report.arm!.collision).toMatchObject({ id: 'ARM03', result: 'fail', reasonCodes: ['ARM_COLLISION'] });
    expect(r.view.tick).toBeLessThan(20_000); neverOpened(r);
  }, 300_000);

  test('J2 with 10 % of its manufacturer force cannot follow: ARM_FOLLOWING_ERROR after followTicks of error, long before maxTicks', async () => {
    const profile = loadOracleProfile().profile.mujocoArm!, weak = await weakJointRoot(1, 0.1);
    const gw = await mujocoGateway({ workerRoot: weak.root }), { run, directory } = await openMujocoRun(gw);
    const r = await outcome(run, directory, async (run) => { await run.start(); return toEnd(run); });
    // the error of each traced tick; the trace's last sample is the tick that stopped the arm
    const err = r.trace!.samples.map((s) => ({ tick: s.tick, e: Math.max(...s.actualRad.map((q, i) => Math.abs(q - s.commandedRad[i]!))) }));
    const over = err.length - 1 - [...err].reverse().findIndex((x) => x.e <= profile.followTolRad), firstOver = err[over + 1]!;
    console.log('MA06 following', JSON.stringify({ effortNm: weak.effortNm, fromNm: weak.fromNm, tick: r.view.tick, stopTick: firstStop(r), firstOverTick: firstOver.tick, programStartTick: err[0]!.tick, peakErrRad: Math.max(...err.map((x) => x.e)), stop: r.stop?.reason, cups: r.cups, reasons: r.reasons }));
    expect(r.stop).toMatchObject({ latched: true, reason: 'ARM_FOLLOWING_ERROR' });
    // the stop comes exactly followTicks ticks after the error first stayed above followTolRad
    expect(firstStop(r)).toBe(err.at(-1)!.tick); expect(firstStop(r) - firstOver.tick + 1).toBe(profile.followTicks);
    expect(r.view.run.status).toBe('needs_attention'); expect(r.view.tick).toBeLessThan(20_000); // not the scenario's 180,000-tick bound
    expect(r.cups.every((c) => c === 'cell:coffee-1')).toBe(true); // the arm never took a cup
  }, 300_000);

  test('pads with friction 0.1: the cup slips out of the pads; the run stops explicitly, the cup\'s last pose is in the evidence and nothing commanded the gripper open', async () => {
    const profile = loadOracleProfile().profile.mujocoArm!, gw = await mujocoGateway({ padFrictionOverride: 0.1 }), { run, directory } = await openMujocoRun(gw);
    let attentionTick = 0;
    const r = await outcome(run, directory, async (run) => {
      await run.start(); attentionTick = (await toEnd(run)).tick;
      // the run waits for a person, the clock still runs: keep stepping past the drop watch (dropTicks) to see what the arm concludes
      return stepUntil(run, (v) => v.tick >= attentionTick + profile.dropTicks + 25, 25, 60_000);
    });
    const last = r.props!.samples.at(-1)!, held = r.props!.samples.filter((s) => s.props.some((p) => p.held)).map((s) => s.tick), pick = r.arm.programs[0]!;
    console.log('MA06 drop', JSON.stringify({ status: r.view.run.status, attentionTick, tick: r.view.tick, heldTicks: [held[0], held.at(-1)], pick: [pick.state, pick.evidence], stopTick: r.stop ? firstStop(r) : null, stop: r.stop?.reason ?? null, cups: r.cups, reasons: r.reasons, lastCup: last }));
    // the pads held the cup, then it slid out while lifting: the pick reports the slip and no lift, so the transfer is refused; the cup never reached the arm's custody
    expect(pick).toMatchObject({ program: 'cup-pick', evidence: { grip: 'contact', objectPresent: true, liftPoseReached: false } });
    expect(pick.evidence.maxSlipM as number).toBeGreaterThan(profile.slipTolM);
    expect(r.reasons).toContain('TRANSFER_REJECTED'); expect(r.view.run.status).toBe('needs_attention'); expect(r.cups[0]).toBe('cell:coffee-1');
    // the drop watch saw the lost cup once the clock ran on: CUP_DROPPED, dropTicks after the last tick the pads held it
    expect(r.stop).toMatchObject({ latched: true, reason: 'CUP_DROPPED' }); expect(firstStop(r) - held.at(-1)!).toBe(profile.dropTicks);
    const cup = last.props.find((p) => p.propId === 'cup-1')!;
    expect(cup.positionM.every(Number.isFinite)).toBe(true); expect(cup.held).toBe(false);
    neverOpened(r);
  }, 300_000);

  test('SIGKILL of the worker in the middle of cup-pick: the outcome is unknown, nothing is resent, no process is left', async () => {
    const gw = await mujocoGateway(), { run, directory } = await openMujocoRun(gw);
    const r = await outcome(run, directory, async (run) => {
      await run.start();
      await stepUntil(run, (v) => v.coffee?.jobs.some((j) => j.status === 'transferring') ?? false, 5, 60_000);
      expect(killMujocoWorkers().length).toBe(1);
      return toEnd(run);
    });
    console.log('MA06 kill', JSON.stringify({ tick: r.view.tick, stopTick: firstStop(r), stop: r.stop, cups: r.cups, reasons: r.reasons, programs: r.arm.programs.map((p) => p.state) }));
    expect(r.stop).toMatchObject({ latched: true, reason: 'WORKER_LOST' });
    expect(r.arm.programs.map((p) => p.state)).toEqual(['unknown']);
    expect(r.view.run.status).toBe('needs_attention'); expect(r.reasons).toContain('TRANSFER_UNKNOWN'); expect(r.cups[0]).toBe('cell:coffee-1');
  }, 300_000);

  test('a cancel while the arm holds the cup: the gripper command is unchanged and the job needs a reconcile', async () => {
    const gw = await mujocoGateway(), { run, directory } = await openMujocoRun(gw);
    let before: number | undefined;
    const r = await outcome(run, directory, async (run) => {
      await run.start();
      await stepUntil(run, heldByArm, 5, 60_000);
      before = (await readCheckpoint<{ coffee: CoffeeState }>(directory))!.coffee.arm.gripperCommandM;
      await act(run, 'cancel', {});
      return toEnd(run);
    });
    const job = r.view.coffee!.jobs.find((j) => j.cupId === 'cup-1')!;
    console.log('MA06 cancel', JSON.stringify({ status: r.view.run.status, tick: r.view.tick, before, after: r.arm.gripperCommandM, holding: r.arm.holding, job, programs: r.arm.programs.map((p) => [p.program, p.state]), cups: r.cups }));
    expect(before).toBe(0); expect(r.arm.gripperCommandM).toBe(before); expect(r.arm.holding).toBe('cup-1');
    neverOpened(r);
    expect(r.cups[0]).toBe('arm:arm-1'); expect(job).toMatchObject({ status: 'needs_attention', attentionReason: 'CANCEL_DURING_TRANSFER' });
    expect(r.view.run.status).not.toBe('completed');
  }, 300_000);

  test('a pick that finds no cup (a gripper too weak to close on it) is an explicit failure, never completed; the cup is never lifted and stays at the stand', async () => {
    // a gripper drive at 0.1 % of the fixture's force range: the pads cannot close on the cup, the first cup-pick ends with no object between them. The design's next failure (the second
    // cup arriving at an occupied stand, PROP_PLACEMENT_OCCUPIED) is not reached on the real engine: lifting the open gripper past the cup that stayed on the stand touches it, and an
    // arm touching a cup it does not hold is a collision.
    const gw = await mujocoGateway({ physicsOverride: { gripper: { ...physics.gripper, forceRangeNm: physics.gripper.forceRangeNm * 0.001 } } }), { run, directory } = await openMujocoRun(gw);
    const r = await outcome(run, directory, async (run) => { await run.start(); return toEnd(run); });
    const last = r.props!.samples.at(-1)!;
    console.log('MA06 occupied', JSON.stringify({ tick: r.view.tick, status: r.view.run.status, stopTick: r.stop ? firstStop(r) : null, stop: r.stop?.reason, cups: r.cups, reasons: r.reasons, programs: r.arm.programs.map((p) => [p.program, p.state, p.evidence.objectPresent]), padsTouchingTicks: r.props!.samples.filter((x) => x.props.some((p) => p.held)).map((x) => x.tick), lastCup: last }));
    expect(r.arm.programs.map((p) => p.program)).toEqual(['cup-pick']);
    expect(r.arm.programs[0]!.evidence).toMatchObject({ grip: 'contact', gripperClosed: true, objectPresent: false });
    expect(r.stop).toMatchObject({ latched: true, reason: 'ARM_COLLISION' });
    expect(r.view.run.status).toBe('needs_attention'); expect(r.cups).toEqual(['cell:coffee-1']); // the second cup was never made
    // the cup is still at the stand, never lifted (pushed by the gripper in the collision tick, so its height is the first sample's within 5 mm)
    const z0 = r.props!.samples[0]!.props[0]!.positionM[2];
    expect(last.props.map((p) => p.propId)).toEqual(['cup-1']); expect(Math.abs(last.props[0]!.positionM[2] - z0)).toBeLessThan(0.005);
  }, 300_000);
});

describe('admission and the flag (no engine)', () => {
  const noPorts = () => { throw new Error('PORTS_OPENED'); };
  test('BV01 and WB-BV01 are refused by the MuJoCo arm set; MJ-BV01 by mock-default and by the Webots arm set; before any provider effect', async () => {
    for (const id of ['BV01', 'WB-BV01'])
      await expect(createScenarioRun(mujocoInput(xarmProject(), 1, id), { directory: await mujocoTemp('adm-'), assets: [xarmAmrAsset], enabledBackends: ['mock_amr', 'mock_coffee', 'mock_arm', 'mujoco_arm'], coffeePorts: noPorts })).rejects.toThrow('SCENARIO_UNSUPPORTED_BY_SET');
    await expect(createScenarioRun({ ...mujocoInput(coffeeProject(), 1, 'MJ-BV01', 'mock-default'), mode: 'mock' }, { directory: await mujocoTemp('adm-'), assets: [amrAsset], enabledBackends: ['mock_amr', 'mock_coffee', 'mock_arm'] })).rejects.toThrow('SCENARIO_UNSUPPORTED_BY_SET');
    await expect(createScenarioRun(mujocoInput(coffeeProject(), 1, 'MJ-BV01', 'engineering-webots-arm-v1'), { directory: await mujocoTemp('adm-'), assets: [amrAsset], enabledBackends: ['mock_amr', 'mock_coffee', 'mock_arm', 'webots_arm'], coffeePorts: noPorts })).rejects.toThrow('SCENARIO_UNSUPPORTED_BY_SET');
  });

  // the scenario list a runtime without the MuJoCo option has always served (lab-runtime-artifact, lab-v2-mock)
  const BEFORE = ['FD01', 'FD07', 'FD02', 'FD03', 'FD04', 'FD04-blocked', 'FD04-reopen', 'FD05-payload', 'FD05-battery', 'FD05-capability', 'FD05-binding', 'BV01', 'FD02-cups', 'CAMPAIGN-FD02-FD07-BV01-BV03', 'IR-FD01', 'IR-FD03', 'IR-FD04', 'IR-FD04-blocked', 'IR-FD07', 'WB-FD01', 'WB-FD07', 'WB-BV01'];
  async function gateway(enabled: boolean, python = '/nonexistent/.venv-mujoco/bin/python') {
    const d = await mujocoTemp('mj-flag-'), mujoco = await mujocoFromOptions({ enabled, python, workerRoot: mujocoRoot, lockPath: join(mujocoRoot, 'requirements.lock'), directory: d });
    const sim = await portableSimulationFromOptions({ enabled: false, python: 'python3', workerRoot: resolve('robotics/navigation-2d'), lockPath: resolve('robotics/navigation-2d/requirements.lock'), directory: d, mujoco });
    const g = await startLabGateway({ port: 0, directory: join(d, 'runs'), sourceCommit: 'test-commit', schemaHash: 'a'.repeat(64), v2: { catalog: sim.catalog, enabledBackends: ['mock_amr', 'mock_coffee', 'mock_arm', ...sim.enabledBackends], simulationFactory: sim.simulationFactory } });
    gateways.push(g);
    const r = await fetch(g.url + '/lab/v2/sessions', { method: 'POST', headers: { origin: 'http://127.0.0.1:4175', 'content-type': 'application/json' }, body: JSON.stringify({ token: g.issuePairingToken() }) });
    const h = { cookie: r.headers.get('set-cookie')!.split(';')[0]!, origin: 'http://127.0.0.1:4175', 'content-type': 'application/json', 'x-csrf-token': String((await r.json()).csrfToken) };
    const health = await (await fetch(g.url + '/lab/v2/health')).json() as { scenarioIds: string[]; scenarioRequirements: Record<string, unknown>; scenarioRequirementsByBackendSet: Record<string, unknown> };
    const create = async (scenarioId: string, backendSetId: string, mode = 'simulation') => {
      const res = await fetch(g.url + '/lab/v2/runs', { method: 'POST', headers: h, body: JSON.stringify({ project: xarmProject(), scenarioId, scenarioRevision: 1, seed: 1, mode, access: 'simulated', backendSetId, runtimeIdentity: { sourceCommit: 'test-commit', schemaHash: 'a'.repeat(64) } }) });
      return { status: res.status, body: await res.json() as { error: string; reasonCodes: string[] } };
    };
    return { health, create };
  }
  test('flag off: MJ-BV01 is neither offered nor admitted, and /health lists exactly the scenarios it listed before', async () => {
    const { health, create } = await gateway(false);
    expect(health.scenarioIds).toEqual(BEFORE);
    expect(Object.keys(health.scenarioRequirements)).toEqual(BEFORE); expect(Object.keys(health.scenarioRequirementsByBackendSet)).toEqual(BEFORE);
    for (const set of ['engineering-mujoco-arm-v1', 'engineering-webots-arm-v1']) expect(await create('MJ-BV01', set)).toEqual({ status: 422, body: { error: 'SCENARIO_UNSUPPORTED', reasonCodes: [] } });
    expect(await create('MJ-BV01', 'mock-default', 'mock')).toEqual({ status: 422, body: { error: 'SCENARIO_UNSUPPORTED', reasonCodes: [] } });
  });
  test('flag on: MJ-BV01 is offered; without a working environment it is still not admitted, and never on another set', async () => {
    const { health, create } = await gateway(true);
    expect(health.scenarioIds).toEqual([...BEFORE, 'MJ-BV01']);
    expect((await create('MJ-BV01', 'engineering-mujoco-arm-v1')).status).toBe(422);
    expect(await create('MJ-BV01', 'mock-default', 'mock')).toMatchObject({ status: 422, body: { error: 'BACKEND_UNAVAILABLE', reasonCodes: ['SCENARIO_UNSUPPORTED_BY_SET'] } });
    expect(await create('BV01', 'engineering-mujoco-arm-v1')).toMatchObject({ status: 422, body: { error: 'BACKEND_UNAVAILABLE', reasonCodes: ['SCENARIO_UNSUPPORTED_BY_SET'] } });
  });
});
